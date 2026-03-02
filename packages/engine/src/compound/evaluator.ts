/**
 * evaluator.ts — Pure scoring functions (Phase 7)
 *
 * No I/O, no side effects. Import and call freely.
 */

import type { StrategyProfile } from './compoundTypes';

/**
 * Score = replyRate * 0.5 + conversionRate * 0.4 + leads_normalized * 0.1
 * leads_normalized = min(leads / 10, 1)  → 10+ leads → full weight
 */
export function computeScore(perf: StrategyProfile['performance']): number {
  const rr       = perf.replyRate      ?? 0;
  const cr       = perf.conversionRate ?? 0;
  const leadsN   = Math.min((perf.leads ?? 0) / 10, 1);
  return rr * 0.5 + cr * 0.4 + leadsN * 0.1;
}

/**
 * Categorize a score into a strategy status.
 * > 0.7 → active (HIGH PERFORMER)
 * < 0.3 → deprecated (LOW PERFORMER)
 * else  → testing
 */
export function categorize(score: number): StrategyProfile['status'] {
  if (score > 0.7) return 'active';
  if (score < 0.3) return 'deprecated';
  return 'testing';
}

/**
 * Evaluate a strategy: compute score + determine status.
 */
export function evaluate(profile: StrategyProfile): { score: number; status: StrategyProfile['status'] } {
  const score  = computeScore(profile.performance);
  const status = categorize(score);
  return { score, status };
}
