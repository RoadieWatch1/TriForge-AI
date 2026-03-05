// ── MissionEvolutionEngine.ts — Self-improving mission planning ─────────────────
//
// Tracks mission execution outcomes and evolves underperforming mission goals
// into improved variants using past metrics.
//
// Flow:
//   mission executed → recordOutcome() → evolveMission() if successRate < 0.5
//   → generateVariants() → selectBestVariant() → return improved goal
//
// Metrics sources:
//   • MissionController results (verification score, step completion)
//   • CompoundEngine strategy scores (outreach/content effectiveness)
//   • Workflow outcomes (success/fail counts per goal pattern)
//
// Storage: outcomes tracked in-memory per session.
// Persistence: top-scoring goal patterns written to CouncilMemoryGraph as
//   architecture decisions so they survive session restarts.

import { engineMemoryGraph } from '../memory/CouncilMemoryGraph';
import { createLogger } from '../logging/log';

const log = createLogger('MissionEvolutionEngine');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MissionOutcome {
  missionId:    string;
  goal:         string;
  /** 0–100, from VerificationRunner or manual scoring. */
  score:        number;
  stepsTotal:   number;
  stepsApplied: number;
  verifiedOk:   boolean;
  ts:           number;
}

export interface MissionMetrics {
  goal:        string;
  runs:        number;
  successRate: number;   // 0–1
  avgScore:    number;   // 0–100
  lastTs:      number;
}

export interface MissionVariant {
  goal:        string;
  rationale:   string;
}

// ── MissionEvolutionEngine ────────────────────────────────────────────────────

export class MissionEvolutionEngine {
  private readonly _outcomes  = new Map<string, MissionOutcome[]>(); // keyed by goal prefix
  private _activeProfession: string | null = null;

  // ── Outcome recording ─────────────────────────────────────────────────────

  /**
   * Record the outcome of an executed mission.
   * Called by MissionController after verification completes.
   */
  recordOutcome(outcome: MissionOutcome): void {
    const key = this._goalKey(outcome.goal);
    const list = this._outcomes.get(key) ?? [];
    list.push(outcome);
    // Keep last 20 outcomes per goal pattern
    if (list.length > 20) list.splice(0, list.length - 20);
    this._outcomes.set(key, list);

    log.info(`recorded outcome for "${key}": score=${outcome.score} verified=${outcome.verifiedOk}`);

    // Persist successful patterns to long-term memory
    if (outcome.verifiedOk && outcome.score >= 80) {
      try {
        engineMemoryGraph.recordArchitectureDecision({
          missionId: outcome.missionId,
          decision:  `High-scoring mission approach: "${outcome.goal.slice(0, 100)}"`,
          rationale: `Score ${outcome.score}/100, all steps applied, verification passed`,
          tradeoffs: 'None identified — this is a confirmed successful pattern',
        });
      } catch { /* non-fatal */ }
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  /**
   * Compute rolling metrics for a given goal pattern.
   */
  getMetrics(goal: string): MissionMetrics {
    const key      = this._goalKey(goal);
    const outcomes = this._outcomes.get(key) ?? [];

    if (outcomes.length === 0) {
      return { goal, runs: 0, successRate: 0, avgScore: 0, lastTs: 0 };
    }

    const successes = outcomes.filter(o => o.verifiedOk).length;
    const avgScore  = outcomes.reduce((sum, o) => sum + o.score, 0) / outcomes.length;

    return {
      goal,
      runs:        outcomes.length,
      successRate: successes / outcomes.length,
      avgScore:    Math.round(avgScore),
      lastTs:      outcomes[outcomes.length - 1]!.ts,
    };
  }

  // ── Evolution ─────────────────────────────────────────────────────────────

  /**
   * Given a mission and its accumulated outcomes, return an evolved variant
   * if the success rate is below 0.5. Otherwise returns the original goal.
   *
   * Does not call any AI model — uses deterministic heuristics so it never
   * blocks the mission pipeline.
   */
  evolveMission(goal: string, outcomes: MissionOutcome[]): string {
    if (outcomes.length === 0) return goal;

    const successRate = outcomes.filter(o => o.verifiedOk).length / outcomes.length;
    if (successRate >= 0.5) return goal; // performing well — no change

    const variants = this.generateVariants(goal, outcomes);
    return this.selectBestVariant(variants)?.goal ?? goal;
  }

  /**
   * Generate heuristic variants of a failing goal.
   * Variants apply different framing strategies known to improve success rates.
   */
  generateVariants(goal: string, outcomes: MissionOutcome[]): MissionVariant[] {
    const failedChecks = outcomes
      .flatMap(o => []) // placeholder — real check names would come from ExperimentResult
      .slice(0, 3);

    const variants: MissionVariant[] = [
      {
        goal:      `${goal} — apply minimal, targeted changes only`,
        rationale: 'Narrow scope reduces risk of verification failures',
      },
      {
        goal:      `${goal} — prioritize build stability and test coverage`,
        rationale: 'Stability-first framing improves verification pass rate',
      },
      {
        goal:      `${goal} — break into smaller sequential sub-tasks`,
        rationale: 'Smaller steps lower individual step failure probability',
      },
    ];

    // If specific failure patterns are known, add a targeted variant
    if (failedChecks.length > 0) {
      variants.push({
        goal:      `${goal} — explicitly avoid: ${failedChecks.join(', ')}`,
        rationale: `Directly addresses known failure patterns from ${outcomes.length} previous runs`,
      });
    }

    return variants;
  }

  /**
   * Select the best variant from a set of candidates.
   * Currently selects by rationale specificity (most targeted first).
   * Future: rank by similarity to past successful patterns in CouncilMemoryGraph.
   */
  selectBestVariant(variants: MissionVariant[]): MissionVariant | null {
    if (variants.length === 0) return null;

    // Prefer variants that reference past failures (most informed)
    const sorted = [...variants].sort((a, b) => {
      const aScore = a.rationale.includes('previous runs') ? 1 : 0;
      const bScore = b.rationale.includes('previous runs') ? 1 : 0;
      return bScore - aScore;
    });

    const winner = sorted[0]!;
    log.info(`selected variant: "${winner.goal.slice(0, 80)}" — ${winner.rationale}`);
    return winner;
  }

  // ── Profession context ────────────────────────────────────────────────────

  /**
   * Set the active profession — used to weight evolution strategies.
   * Called by applyBlueprint() integration.
   */
  setActiveProfession(blueprintId: string): void {
    this._activeProfession = blueprintId;
    log.info(`active profession set to: ${blueprintId}`);
  }

  getActiveProfession(): string | null {
    return this._activeProfession;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Normalize goal to a stable key for outcome grouping. */
  private _goalKey(goal: string): string {
    return goal.toLowerCase().trim().slice(0, 60).replace(/\s+/g, ' ');
  }
}

/** Singleton — shared by MissionController and applyBlueprint. */
export const missionEvolutionEngine = new MissionEvolutionEngine();
