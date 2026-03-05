// ── EvolutionEngine.ts — Multi-generation candidate evolution loop ─────────────
//
// Runs candidates through up to 3 experiment generations. After each generation,
// top survivors are mutated by ThinkTankPlanner into an improved next generation.
// The strongest candidate found across all generations is returned as the winner.
//
// Safety guarantees (inherited from ExperimentEngine):
//   • Never writes to the real workspace — all experiments run in isolated sandboxes
//   • No git commits, no approval bypasses
//   • Sandboxes are cleaned up after every run
//
// Performance limits:
//   • Max 3 generations
//   • Max 3 candidates per generation
//   • Max 60 s per generation (hard timeout via Promise.race)
//   • If a generation times out or fails, best result so far is returned

import { ExperimentEngine } from './ExperimentEngine';
import { ThinkTankPlanner } from '@triforge/engine';
import type { PatchCandidate, ExperimentResult } from './types';
import { emitConsensusMeta } from '../orchestrator/CouncilDecisionBus';
import { createLogger } from '../logging/log';

const log = createLogger('EvolutionEngine');

const DEFAULT_CONFIG = {
  generations:             3,
  candidatesPerGeneration: 3,
  topSurvivors:            2,
  generationTimeoutMs:     60_000,  // 1 min per generation
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`EvolutionEngine: generation timed out after ${ms}ms`)), ms),
  );
}

// ── EvolutionEngine ───────────────────────────────────────────────────────────

export class EvolutionEngine {
  constructor(
    private readonly workspaceRoot: string,
    private readonly experimentEngine: ExperimentEngine,
    private readonly planner: ThinkTankPlanner,
  ) {}

  /**
   * Evolve candidates across multiple generations.
   *
   * @param missionId         Mission identifier (namespaces sandbox dirs)
   * @param initialCandidates Starting candidate set from ThinkTankPlanner
   * @param goal              Original mission goal (used in mutation prompts)
   * @returns Best ExperimentResult found across all generations
   */
  async evolveCandidates(
    missionId:          string,
    initialCandidates:  PatchCandidate[],
    goal:               string,
  ): Promise<ExperimentResult> {
    let candidates  = initialCandidates.slice(0, DEFAULT_CONFIG.candidatesPerGeneration);
    let bestResult: ExperimentResult | null = null;

    for (let gen = 1; gen <= DEFAULT_CONFIG.generations; gen++) {
      log.info(`generation ${gen}/${DEFAULT_CONFIG.generations} — ${candidates.length} candidates`);

      // ── Run experiments (with hard timeout) ──────────────────────────────────
      let genResult: { results: ExperimentResult[]; winner: ExperimentResult };
      try {
        genResult = await Promise.race([
          this.experimentEngine.runExperiments(missionId, candidates),
          _timeout(DEFAULT_CONFIG.generationTimeoutMs),
        ]);
      } catch (e) {
        log.warn(`generation ${gen} aborted (${String(e).slice(0, 100)}) — using best result so far`);
        break;
      }

      // ── Track overall best across all generations ─────────────────────────────
      if (!bestResult || genResult.winner.score > bestResult.score) {
        bestResult = genResult.winner;
        log.info(`new best: "${bestResult.approach}" score=${bestResult.score} (gen ${gen})`);
      }

      // ── Emit generation progress signal ───────────────────────────────────────
      emitConsensusMeta({
        missionId,
        winnerApproach: genResult.winner.approach,
        score:          genResult.winner.score,
        reason:         `Generation ${gen}/${DEFAULT_CONFIG.generations} — best score ${genResult.winner.score}/100`,
        ts:             Date.now(),
      });

      // ── Perfect score or final generation — stop early ────────────────────────
      if (genResult.winner.score === 100 || gen === DEFAULT_CONFIG.generations) {
        log.info(`stopping after generation ${gen} (score=${genResult.winner.score})`);
        break;
      }

      // ── Select survivors for next generation ──────────────────────────────────
      const ranked    = [...genResult.results].sort((a, b) => b.score - a.score);
      const survivors = ranked.slice(0, DEFAULT_CONFIG.topSurvivors);
      log.info(`survivors: ${survivors.map(s => `"${s.approach}"(${s.score})`).join(', ')}`);

      // ── Mutate survivors into next generation ─────────────────────────────────
      try {
        candidates = await this._generateNextGeneration(missionId, gen, survivors, goal);
      } catch (e) {
        log.warn(`mutation for generation ${gen + 1} failed — keeping survivors`, e);
        // Fall back to re-running the same survivors rather than crashing
        candidates = survivors.map(s => ({
          id:                 `${missionId}-g${gen + 1}-fallback-${s.candidateId}`,
          approach:           s.approach,
          rationale:          'Carried forward from previous generation (mutation failed)',
          patches:            [],
          filesLikelyTouched: [],
        }));
      }
    }

    // bestResult is always set after at least one successful generation
    // If every generation failed (should be impossible unless 0 candidates), return empty sentinel
    if (!bestResult) {
      log.warn('no successful generation — returning zero-score sentinel');
      return {
        candidateId: 'none',
        approach:    'none',
        sandboxPath: '',
        score:       0,
        checks:      [{ name: 'evolution', ok: false, details: 'all generations failed' }],
      };
    }

    log.info(`final winner: "${bestResult.approach}" score=${bestResult.score}`);
    return bestResult;
  }

  // ── Private: mutate survivors + synthesize hybrid ────────────────────────────
  //
  // With 2 survivors A and B, generates 3 next-gen candidates:
  //   1. mutate(A)     — deepen A's strengths, fix its failures
  //   2. mutate(B)     — deepen B's strengths, fix its failures
  //   3. hybrid(A, B)  — merge best architecture of A with best performance of B
  //
  // With only 1 survivor (tie-break case), generates 3 mutations of that survivor.

  private async _generateNextGeneration(
    missionId:    string,
    completedGen: number,
    survivors:    ExperimentResult[],
    goal:         string,
  ): Promise<PatchCandidate[]> {
    const [survivorA, survivorB] = survivors;
    const nextGen = completedGen + 1;

    const failedChecks = survivors
      .flatMap(s => s.checks.filter(c => !c.ok && !c.skipped).map(c => c.name))
      .filter((v, i, a) => a.indexOf(v) === i);

    const weaknesses = failedChecks.length > 0
      ? `Failed checks: ${failedChecks.join(', ')}. The next generation must fix these.`
      : 'All checks passed — focus on reducing complexity and safer rollback logic.';

    const hybridInstruction = survivorB
      ? `3. HYBRID candidate — combine the best architectural decisions from "${survivorA.approach}" with the best performance characteristics from "${survivorB.approach}". Preserve minimal file changes. This should be the strongest possible synthesis.`
      : `3. OPTIMIZED variant of "${survivorA.approach}" — push it further toward zero complexity and maximum stability.`;

    const plan = await this.planner.makePlan(
      goal,
      'general',
      `You are evolving engineering candidates for: ${goal}

Survivors from generation ${completedGen}:
  A: "${survivorA.approach}" — score: ${survivorA.score}/100
${survivorB ? `  B: "${survivorB.approach}" — score: ${survivorB.score}/100` : '  (single survivor)'}

${weaknesses}

Generate exactly 3 improved candidates:
  1. MUTATION of "${survivorA.approach}" — deepen its strengths, fix its weaknesses.
  2. MUTATION of "${survivorB ? survivorB.approach : survivorA.approach}" — improve on ${survivorB ? 'B' : 'it'} from a different angle.
  ${hybridInstruction}

Each candidate must:
  - Reduce complexity and files touched
  - Improve performance and stability
  - Strengthen test coverage
  - Provide safer rollback logic

Return structured JSON: { "candidates": [ { "id": "c1", "title": "...", "steps": [...] }, ... ] }`,
    );

    const LABELS = ['mutant-A', 'mutant-B', 'hybrid'];
    return plan.steps
      .slice(0, DEFAULT_CONFIG.candidatesPerGeneration)
      .map((s, i) => {
        const label = LABELS[i] ?? `variant-${i + 1}`;
        const isHybrid = i === 2 && !!survivorB;
        return {
          id:                 `${missionId}-g${nextGen}-${label}`,
          approach:           s.title ?? (isHybrid
            ? `Hybrid(${survivorA.approach} × ${survivorB!.approach})`
            : `Gen ${nextGen} ${label}`),
          rationale:          s.description ?? (isHybrid
            ? `Cross-breed of generation ${completedGen} top survivors`
            : `Mutation of generation ${completedGen} survivor`),
          patches:            [],
          filesLikelyTouched: [],
        };
      });
  }
}
