// ── expertReplacementEngine.ts — Expert replacement logic ───────────────────
//
// Replaces weak active experts with stronger candidates when the replacement
// outperforms by a significant margin (30%+ higher contribution score).

import type { ExpertRegistry } from './expertRegistry';
import { isProtectedRole } from './expertRegistry';
import type { ExpertPerformanceTracker } from './expertPerformanceTracker';
import type { ExpertRosterLedger } from './expertRosterLedger';
import type { ExpertProfile, ExpertReplacementDecision, ExpertRole } from './expertTypes';

const REPLACEMENT_SCORE_THRESHOLD = 1.3; // new expert must score 30% higher

export class ExpertReplacementEngine {
  constructor(
    private _registry: ExpertRegistry,
    private _tracker: ExpertPerformanceTracker,
    private _ledger: ExpertRosterLedger,
  ) {}

  // ── Evaluation ────────────────────────────────────────────────────────────

  evaluateForReplacement(expertId: string): ExpertReplacementDecision | null {
    const expert = this._registry.getExpert(expertId);
    if (!expert) return null;

    // Only replace active or watchlisted experts
    if (expert.status !== 'active' && expert.status !== 'watchlist') return null;

    // Protected experts need stronger evidence
    const threshold = isProtectedRole(expert.role) ? 1.5 : REPLACEMENT_SCORE_THRESHOLD;

    const currentScore = this._tracker.computeContributionScore(expertId);
    const candidates = this.findReplacementCandidates(expert.role);

    for (const candidate of candidates) {
      const candidateScore = this._tracker.computeContributionScore(candidate.id);
      if (candidateScore >= currentScore * threshold && candidate.selectionCount >= 5) {
        return {
          outgoingExpertId: expertId,
          incomingExpertId: candidate.id,
          reason: `${candidate.name} (score ${candidateScore}) outperforms ${expert.name} (score ${currentScore}) by ${Math.round((candidateScore / currentScore - 1) * 100)}%`,
          confidence: Math.min(95, Math.round(candidateScore - currentScore + 50)),
          timestamp: Date.now(),
        };
      }
    }

    return null;
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  executeReplacement(decision: ExpertReplacementDecision): boolean {
    const outgoing = this._registry.getExpert(decision.outgoingExpertId);
    const incoming = this._registry.getExpert(decision.incomingExpertId);
    if (!outgoing || !incoming) return false;

    // Protected experts: extra gating
    if (isProtectedRole(outgoing.role) && decision.confidence < 80) return false;

    // Replace
    this._registry.updateStatus(decision.outgoingExpertId, 'replaced');
    this._registry.updateStatus(decision.incomingExpertId, 'active');

    // Inherit pool from outgoing
    this._registry.updateExpert(decision.incomingExpertId, {
      pool: outgoing.pool,
    });

    this._ledger.record('replaced', decision.outgoingExpertId, {
      replacedBy: decision.incomingExpertId,
      reason: decision.reason,
      confidence: decision.confidence,
    });

    return true;
  }

  // ── Candidate search ──────────────────────────────────────────────────────

  findReplacementCandidates(role: ExpertRole): ExpertProfile[] {
    const allExperts = this._registry.getAllExperts();
    return allExperts.filter(e =>
      e.role === role &&
      (e.status === 'trial' || e.status === 'candidate') &&
      e.selectionCount >= 3 // must have some track record
    ).sort((a, b) => {
      const aScore = this._tracker.computeContributionScore(a.id);
      const bScore = this._tracker.computeContributionScore(b.id);
      return bScore - aScore;
    });
  }

  // ── Batch evaluation ──────────────────────────────────────────────────────

  evaluateAllForReplacement(): ExpertReplacementDecision[] {
    const decisions: ExpertReplacementDecision[] = [];
    const activeExperts = this._registry.getExpertsByStatus('active');
    const watchlistExperts = this._registry.getExpertsByStatus('watchlist');

    for (const expert of [...watchlistExperts, ...activeExperts]) {
      const decision = this.evaluateForReplacement(expert.id);
      if (decision) decisions.push(decision);
    }

    return decisions;
  }
}
