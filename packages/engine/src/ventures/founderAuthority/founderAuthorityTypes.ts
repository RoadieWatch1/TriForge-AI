// ── founderAuthorityTypes.ts — Types for founder authority + operator policy ──
//
// Re-exports core types and adds authority-pipeline-specific types.

// Re-export from central types
export type {
  ActionGateLevel, OperatorPolicy, FounderProfile,
} from '../ventureTypes';

// ── Action classification ────────────────────────────────────────────────────

export type VentureActionCategory =
  | 'content'
  | 'social'
  | 'email'
  | 'advertising'
  | 'website'
  | 'brand'
  | 'budget'
  | 'purchase'
  | 'filing'
  | 'legal'
  | 'financial';

export interface VentureAction {
  id: string;
  category: VentureActionCategory;
  description: string;
  estimatedCost?: number;       // USD, 0 for free actions
  requiresExternalAccount?: boolean;
  isLegalBinding?: boolean;
}

export interface GateDecision {
  action: VentureAction;
  gateLevel: import('../ventureTypes').ActionGateLevel;
  reason: string;
  canProceed: boolean;
  requiresUserApproval: boolean;
}

// ── Default operator policy ──────────────────────────────────────────────────

export const DEFAULT_OPERATOR_POLICY: import('../ventureTypes').OperatorPolicy = {
  contentCreation:         'fully_autonomous',
  socialPosting:           'fully_autonomous',
  emailOutreach:           'autonomous_under_cap',
  adSpend:                 'autonomous_under_cap',
  websiteChanges:          'fully_autonomous',
  brandChanges:            'requires_approval',
  budgetReallocation:      'requires_approval',
  externalPurchases:       'requires_approval',
  filingPreparation:       'fully_autonomous',
  filingSubmission:        'requires_legal_auth',
  einPreparation:          'fully_autonomous',
  einSubmission:           'requires_legal_auth',
  complianceCalendarSetup: 'fully_autonomous',
  bookkeepingSetup:        'fully_autonomous',
  legalFilings:            'requires_legal_auth',
  financialTransfers:      'requires_legal_auth',
};
