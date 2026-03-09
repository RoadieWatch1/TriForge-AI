// ── operatorPolicyEngine.ts — Action gating against operator policy ──────────
//
// Classifies venture actions against the operator policy and determines
// whether the Council can auto-execute or needs user approval.

import type { ActionGateLevel, OperatorPolicy } from '../ventureTypes';
import type { VentureAction, GateDecision } from './founderAuthorityTypes';
import { DEFAULT_OPERATOR_POLICY } from './founderAuthorityTypes';

/**
 * Classify an action against the operator policy.
 * Returns the gate level from the policy for the action's category.
 */
export function classifyAction(
  action: VentureAction,
  policy: OperatorPolicy = DEFAULT_OPERATOR_POLICY,
): ActionGateLevel {
  // Map action category to policy field
  const policyField = categoryToPolicyField(action.category);
  if (policyField && policyField in policy) {
    return policy[policyField as keyof OperatorPolicy];
  }

  // Default: if legal-binding or requires external account, require approval
  if (action.isLegalBinding) return 'requires_legal_auth';
  if (action.requiresExternalAccount) return 'requires_approval';

  return 'fully_autonomous';
}

/**
 * Check if an action can be auto-executed given the policy and current daily spend.
 */
export function canAutoExecute(
  action: VentureAction,
  policy: OperatorPolicy = DEFAULT_OPERATOR_POLICY,
  dailySpent: number = 0,
  dailyCap: number = Infinity,
): boolean {
  const gate = classifyAction(action, policy);

  switch (gate) {
    case 'fully_autonomous':
      return true;

    case 'autonomous_under_cap':
      // Can auto-execute if cost stays under daily cap
      return (dailySpent + (action.estimatedCost ?? 0)) <= dailyCap;

    case 'requires_approval':
    case 'requires_legal_auth':
      return false;
  }
}

/**
 * Get a full gate decision for an action.
 */
export function getGateDecision(
  action: VentureAction,
  policy: OperatorPolicy = DEFAULT_OPERATOR_POLICY,
  dailySpent: number = 0,
  dailyCap: number = Infinity,
): GateDecision {
  const gateLevel = classifyAction(action, policy);
  const canProceed = canAutoExecute(action, policy, dailySpent, dailyCap);

  return {
    action,
    gateLevel,
    reason: buildGateReason(action, gateLevel, dailySpent, dailyCap),
    canProceed,
    requiresUserApproval: gateLevel === 'requires_approval' || gateLevel === 'requires_legal_auth',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function categoryToPolicyField(category: string): string | null {
  const map: Record<string, string> = {
    content: 'contentCreation',
    social: 'socialPosting',
    email: 'emailOutreach',
    advertising: 'adSpend',
    website: 'websiteChanges',
    brand: 'brandChanges',
    budget: 'budgetReallocation',
    purchase: 'externalPurchases',
    filing: 'filingPreparation',
    legal: 'legalFilings',
    financial: 'financialTransfers',
  };
  return map[category] ?? null;
}

function buildGateReason(
  action: VentureAction,
  gate: ActionGateLevel,
  dailySpent: number,
  dailyCap: number,
): string {
  switch (gate) {
    case 'fully_autonomous':
      return `"${action.description}" is within Council authority — executing automatically.`;

    case 'autonomous_under_cap': {
      const cost = action.estimatedCost ?? 0;
      const remaining = dailyCap - dailySpent;
      if (cost <= remaining) {
        return `"${action.description}" costs $${cost} — within daily cap ($${remaining} remaining). Executing.`;
      }
      return `"${action.description}" costs $${cost} — exceeds daily cap ($${remaining} remaining). Requires approval.`;
    }

    case 'requires_approval':
      return `"${action.description}" requires your approval before the Council can proceed.`;

    case 'requires_legal_auth':
      return `"${action.description}" is a legal/financial action that requires explicit authorization.`;
  }
}
