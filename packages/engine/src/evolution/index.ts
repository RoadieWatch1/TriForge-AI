// ── evolution/index.ts — Public API for Performance Hunter ──────────────────

// Types
export type {
  ComponentHealthStatus,
  ComponentRecord,
  ShadowTestResult,
  ShadowTestImpact,
  ShadowTestRecommendation,
  PerformanceSnapshot,
  QuarantineAction,
  EvolutionAction,
  EvolutionLogEntry,
  EvolutionReport,
  EvolutionRecommendation,
  EvolutionConfig,
} from './evolutionTypes';

export { PROTECTED_CATEGORIES, DEFAULT_EVOLUTION_CONFIG } from './evolutionTypes';

// Component tracking
export { ComponentUseTracker } from './componentUseTracker';

// Health scanning
export { HealthScanner } from './healthScanner';

// Audit ledger
export { EvolutionAuditLedger } from './evolutionAuditLedger';

// Quarantine
export { SafeQuarantineManager } from './safeQuarantineManager';

// Shadow testing
export { ShadowTestRunner } from './shadowTestRunner';

// Orchestrator
export { EvolutionOrchestrator } from './evolutionOrchestrator';

// Bridge (tri-directional integration)
export { LearningEvolutionBridge } from './learningEvolutionBridge';
export type { UnifiedReport } from './learningEvolutionBridge';
