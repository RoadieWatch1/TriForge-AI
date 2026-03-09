// ── expertPromotionEngine.ts — Trial-to-active promotion logic ──────────────
//
// Promotes trial experts to active when they demonstrate value.
// Criteria: minimum task completions, output survival rate, contribution score,
// and acceptable error rate.

import type { ExpertRegistry } from './expertRegistry';
import type { ExpertPerformanceTracker } from './expertPerformanceTracker';
import type { ExpertRosterLedger } from './expertRosterLedger';

export interface PromotionDecision {
  expertId: string;
  shouldPromote: boolean;
  reason: string;
  metrics: {
    taskCompletions: number;
    survivalRate: number;
    contributionScore: number;
    errorRate: number;
  };
}

const MIN_TASK_COMPLETIONS = 5;
const MIN_SURVIVAL_RATE = 0.4;
const MIN_CONTRIBUTION_SCORE = 30;
const MAX_ERROR_RATE = 0.2;

export class ExpertPromotionEngine {
  constructor(
    private _registry: ExpertRegistry,
    private _tracker: ExpertPerformanceTracker,
    private _ledger: ExpertRosterLedger,
  ) {}

  // ── Evaluation ────────────────────────────────────────────────────────────

  evaluateForPromotion(expertId: string): PromotionDecision {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'trial') {
      return {
        expertId,
        shouldPromote: false,
        reason: 'Expert not in trial status',
        metrics: { taskCompletions: 0, survivalRate: 0, contributionScore: 0, errorRate: 0 },
      };
    }

    const perf = this._tracker.getPerformanceRecord(expertId);
    const contributionScore = this._tracker.computeContributionScore(expertId);

    const metrics = {
      taskCompletions: perf.selectionCount,
      survivalRate: perf.outputSurvivedRate,
      contributionScore,
      errorRate: perf.errorRate,
    };

    // Not enough data yet
    if (perf.selectionCount < MIN_TASK_COMPLETIONS) {
      return {
        expertId,
        shouldPromote: false,
        reason: `Needs ${MIN_TASK_COMPLETIONS - perf.selectionCount} more task completions`,
        metrics,
      };
    }

    // Check criteria
    const reasons: string[] = [];
    let pass = true;

    if (perf.outputSurvivedRate < MIN_SURVIVAL_RATE) {
      reasons.push(`survival rate ${Math.round(perf.outputSurvivedRate * 100)}% < ${MIN_SURVIVAL_RATE * 100}%`);
      pass = false;
    }

    if (contributionScore < MIN_CONTRIBUTION_SCORE) {
      reasons.push(`contribution ${contributionScore} < ${MIN_CONTRIBUTION_SCORE}`);
      pass = false;
    }

    if (perf.errorRate > MAX_ERROR_RATE) {
      reasons.push(`error rate ${Math.round(perf.errorRate * 100)}% > ${MAX_ERROR_RATE * 100}%`);
      pass = false;
    }

    return {
      expertId,
      shouldPromote: pass,
      reason: pass
        ? `Trial passed: ${perf.selectionCount} tasks, ${Math.round(perf.outputSurvivedRate * 100)}% survival, score ${contributionScore}`
        : `Trial criteria not met: ${reasons.join('; ')}`,
      metrics,
    };
  }

  // ── Execute promotion ─────────────────────────────────────────────────────

  promote(expertId: string): boolean {
    const decision = this.evaluateForPromotion(expertId);
    if (!decision.shouldPromote) return false;

    this._registry.updateStatus(expertId, 'active');
    this._ledger.record('promoted', expertId, {
      from: 'trial',
      to: 'active',
      reason: decision.reason,
      metrics: decision.metrics,
    });

    return true;
  }

  // ── Batch evaluation ──────────────────────────────────────────────────────

  evaluateAllTrials(): PromotionDecision[] {
    const trials = this._registry.getExpertsByStatus('trial');
    return trials.map(e => this.evaluateForPromotion(e.id));
  }

  promoteEligible(): string[] {
    const promoted: string[] = [];
    const trials = this._registry.getExpertsByStatus('trial');

    for (const expert of trials) {
      if (this.promote(expert.id)) {
        promoted.push(expert.id);
      }
    }
    return promoted;
  }
}
