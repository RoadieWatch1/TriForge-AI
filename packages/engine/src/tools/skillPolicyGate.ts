// ── Skill Policy Gate — Phase 2: Skill Trust Layer ───────────────────────────
//
// Takes a SkillAnalysisResult and returns a final PolicyGateDecision.
//
// Separation of concerns:
//   skillTrustEvaluator  — "what is in this skill?"
//   skillPolicyGate      — "what do we do about it?"
//
// Policy rules (in order of precedence):
//
//   1. BLOCK     — riskLevel === 'critical' OR blocked === true
//   2. COUNCIL   — councilReviewRequired === true (riskLevel === 'high', undeclared caps)
//   3. APPROVAL  — requiresApproval === true (riskLevel === 'medium', declared dangerous caps)
//   4. ALLOW     — riskLevel === 'low', no dangerous patterns

import type { SkillAnalysisResult, PolicyGateDecision } from './skillRiskTypes';

export function evaluate(result: SkillAnalysisResult): PolicyGateDecision {
  // Rule 1: Hard block
  if (result.blocked || result.riskLevel === 'critical') {
    return {
      allowed: false,
      requiresApproval: false,
      requiresCouncilReview: false,
      blockReason: result.blockReason ?? 'Skill blocked due to critical risk patterns.',
    };
  }

  // Rule 2: Council review required
  if (result.councilReviewRequired || result.riskLevel === 'high') {
    return {
      allowed: true,
      requiresApproval: true,
      requiresCouncilReview: true,
    };
  }

  // Rule 3: Human approval required
  if (result.requiresApproval || result.riskLevel === 'medium') {
    return {
      allowed: true,
      requiresApproval: true,
      requiresCouncilReview: false,
    };
  }

  // Rule 4: Allow
  return {
    allowed: true,
    requiresApproval: false,
    requiresCouncilReview: false,
  };
}

/** Convenience wrapper: analyze + gate in one call. */
export function gate(result: SkillAnalysisResult): PolicyGateDecision {
  return evaluate(result);
}
