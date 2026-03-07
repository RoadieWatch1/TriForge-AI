// ── engine/src/trading/promotion.ts ───────────────────────────────────────────
//
// Phase 6: Pure promotion eligibility evaluator.
// No I/O — operates on readiness reports and current mode.
// Advisory only — does not execute mode transitions.

import type {
  StrategyReadinessReport, StrategyReadinessState,
  TradingOperationMode, PromotionGuardrails, PromotionDecision,
} from './types';

/** Map from current mode to: required readiness state and next mode. */
const PROMOTION_LADDER: Record<
  TradingOperationMode,
  { nextMode: TradingOperationMode; requiredState: StrategyReadinessState } | null
> = {
  shadow:                 { nextMode: 'paper',                  requiredState: 'paper_ready' },
  paper:                  { nextMode: 'guarded_live_candidate', requiredState: 'guarded_live_candidate' },
  guarded_live_candidate: null,
};

/** Readiness states ranked from lowest to highest. */
const STATE_RANK: Record<StrategyReadinessState, number> = {
  not_ready: 0,
  developing: 1,
  paper_ready: 2,
  guarded_live_candidate: 3,
};

const ADVISORY_SUFFIX = ' This is advisory only. Mode changes require explicit user action.';

export function evaluatePromotionEligibility(
  readinessReport: StrategyReadinessReport,
  currentMode: TradingOperationMode,
  _guardrails: PromotionGuardrails,
): PromotionDecision {
  const ladder = PROMOTION_LADDER[currentMode];

  // Already at top
  if (!ladder) {
    return {
      eligible: false,
      targetMode: currentMode,
      requiredState: 'guarded_live_candidate',
      currentState: readinessReport.state,
      blockers: ['Already at highest operation mode.'],
      advisory: `Operating in guarded_live_candidate mode.${ADVISORY_SUFFIX}`,
    };
  }

  const { nextMode, requiredState } = ladder;
  const blockers: string[] = [];

  // Check readiness state meets or exceeds requirement
  const currentRank = STATE_RANK[readinessReport.state];
  const requiredRank = STATE_RANK[requiredState];

  if (currentRank < requiredRank) {
    blockers.push(
      `Readiness state is "${readinessReport.state}" — requires "${requiredState}" for promotion to ${nextMode}.`,
    );
  }

  // Append any readiness-level blockers
  for (const b of readinessReport.blockers) {
    blockers.push(b);
  }

  // Stability must pass for promotion
  if (!readinessReport.stabilityPassed) {
    blockers.push('Strategy stability checks have not passed.');
  }

  const eligible = blockers.length === 0;
  const advisory = eligible
    ? `Eligible for promotion to ${nextMode}.${ADVISORY_SUFFIX}`
    : `Not yet eligible for promotion to ${nextMode}.${ADVISORY_SUFFIX}`;

  return {
    eligible,
    targetMode: nextMode,
    requiredState,
    currentState: readinessReport.state,
    blockers,
    advisory,
  };
}
