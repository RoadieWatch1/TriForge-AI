// ── experts/index.ts — Public API for Expert Workforce Engine ────────────────

// Types
export type {
  ExpertRole,
  ExpertStatus,
  ExpertProtectionLevel,
  ExpertPool,
  ExpertProfile,
  ExpertTaskResult,
  ExpertSelectionDecision,
  ExpertHiringNeed,
  ExpertReplacementDecision,
  ExpertPerformanceRecord,
  RosterSummary,
  WorkforceHealthReport,
  RosterLedgerEntry,
  RosterAction,
} from './expertTypes';

export { PROTECTED_EXPERT_ROLES, TASK_TYPE_EXPERT_MAP } from './expertTypes';

// Registry
export { ExpertRegistry, isProtectedRole } from './expertRegistry';

// Router
export { ExpertRouter } from './expertRouter';
export type { ExpertRoutingContext } from './expertRouter';

// Performance tracking
export { ExpertPerformanceTracker } from './expertPerformanceTracker';

// Workforce engine
export { ExpertWorkforceEngine } from './expertWorkforceEngine';

// Roster ledger
export { ExpertRosterLedger } from './expertRosterLedger';

// Hiring
export { ExpertHiringEngine } from './expertHiringEngine';

// Promotion
export { ExpertPromotionEngine } from './expertPromotionEngine';
export type { PromotionDecision } from './expertPromotionEngine';

// Bench management
export { ExpertBenchManager } from './expertBenchManager';

// Replacement
export { ExpertReplacementEngine } from './expertReplacementEngine';
