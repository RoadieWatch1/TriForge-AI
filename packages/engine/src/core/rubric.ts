/**
 * Rubric — voting logic, confidence scoring, and tie-breaking for the TriForge council.
 * Extracted from orchestrator so it can be reused by both code and think-tank modes.
 */

import { ProviderName } from '../protocol';
import { ReviewResult } from './types';

export interface VoteResult {
  verdict: 'consensus' | 'majority' | 'disagreement';
  approvals: number;
  total: number;
  /** 0–1: fraction of reviewers who approved */
  confidence: number;
  winningVerdict: 'APPROVE' | 'REQUEST_CHANGES';
  dissenting: ProviderName[];
}

/**
 * Judge a set of review verdicts and return a structured vote result.
 */
export function judgeVotes(reviews: ReviewResult[]): VoteResult {
  const total = reviews.length;
  if (total === 0) {
    return {
      verdict: 'disagreement',
      approvals: 0,
      total: 0,
      confidence: 0,
      winningVerdict: 'REQUEST_CHANGES',
      dissenting: [],
    };
  }

  const approvals = reviews.filter(r => r.verdict === 'APPROVE').length;
  const dissenting = reviews
    .filter(r => r.verdict !== 'APPROVE')
    .map(r => r.provider);
  const confidence = approvals / total;

  let verdict: VoteResult['verdict'];
  if (approvals === total) {
    verdict = 'consensus';
  } else if (approvals > total / 2) {
    verdict = 'majority';
  } else {
    verdict = 'disagreement';
  }

  return {
    verdict,
    approvals,
    total,
    confidence,
    winningVerdict: approvals >= Math.ceil(total / 2) ? 'APPROVE' : 'REQUEST_CHANGES',
    dissenting,
  };
}

/**
 * Select the provider best suited to break a tie (fewest accumulated
 * REQUEST_CHANGES verdicts in this run — least biased toward rejection).
 * Falls back to the first provider.
 */
export function selectTiebreaker(
  providers: ProviderName[],
  rejectionCounts: Partial<Record<ProviderName, number>>
): ProviderName {
  let best = providers[0];
  let bestCount = rejectionCounts[best] ?? 0;
  for (const p of providers.slice(1)) {
    const count = rejectionCounts[p] ?? 0;
    if (count < bestCount) {
      best = p;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Compute an overall session confidence score from an array of per-file VoteResults.
 * Returns a value in [0, 1].
 */
export function sessionConfidence(votes: VoteResult[]): number {
  if (votes.length === 0) { return 0; }
  const sum = votes.reduce((acc, v) => acc + v.confidence, 0);
  return Math.round((sum / votes.length) * 100) / 100;
}
