// ── evolutionTypes.ts — Performance Hunter type definitions ─────────────────
//
// Types for component health tracking, shadow testing, quarantine management,
// and evolution audit logging.

// ── Component Health ────────────────────────────────────────────────────────

export type ComponentHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'dormant'
  | 'quarantined'
  | 'restored';

export interface ComponentRecord {
  id: string;
  name: string;
  category: string;
  lastUsed: number;            // timestamp
  useCount: number;
  useCountLast30Days: number;
  errorCount: number;
  errorCountLast30Days: number;
  averageLatencyMs: number;
  healthStatus: ComponentHealthStatus;
  isProtected: boolean;
  quarantinedAt?: number;
  restoredAt?: number;
  shadowTestResults?: ShadowTestResult[];
  linkedExpertId?: string;     // maps to an expert if applicable
}

// ── Shadow Testing ──────────────────────────────────────────────────────────

export interface ShadowTestResult {
  testId: string;
  timestamp: number;
  componentId: string;
  baseline: PerformanceSnapshot;
  withoutComponent: PerformanceSnapshot;
  impact: ShadowTestImpact;
  recommendation: ShadowTestRecommendation;
}

export type ShadowTestImpact = 'none' | 'minor' | 'significant' | 'critical';

export type ShadowTestRecommendation = 'quarantine' | 'keep' | 'investigate';

export interface PerformanceSnapshot {
  responseTimeMs: number;
  errorRate: number;
  throughput: number;
  memoryUsageMb: number;
}

// ── Quarantine ──────────────────────────────────────────────────────────────

export interface QuarantineAction {
  componentId: string;
  reason: string;
  timestamp: number;
  reversible: true;
  autoRestoreAfterMs: number;  // default: 86400000 (24h)
}

// ── Audit / Ledger ──────────────────────────────────────────────────────────

export type EvolutionAction =
  | 'component_tracked'
  | 'health_scan'
  | 'quarantined'
  | 'restored'
  | 'auto_restored'
  | 'shadow_test_run'
  | 'shadow_test_completed'
  | 'dormant_detected'
  | 'degraded_detected';

export interface EvolutionLogEntry {
  timestamp: number;
  action: EvolutionAction;
  componentId: string;
  details: Record<string, unknown>;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface EvolutionReport {
  timestamp: number;
  totalComponents: number;
  healthy: number;
  degraded: number;
  dormant: number;
  quarantined: number;
  recommendations: EvolutionRecommendation[];
}

export interface EvolutionRecommendation {
  componentId: string;
  action: 'quarantine' | 'investigate' | 'keep' | 'restore';
  reason: string;
}

// ── Configuration ───────────────────────────────────────────────────────────

export interface EvolutionConfig {
  dormantThresholdDays: number;
  minUseCountForHealth: number;
  maxQuarantineDurationMs: number;
  autoRestoreMs: number;
  shadowTestDurationMs: number;
  protectedCategories: string[];
}

export const PROTECTED_CATEGORIES: readonly string[] = [
  'auth',
  'billing',
  'wallet',
  'trading_safety',
  'filing',
  'legal',
  'memory_persistence',
  'store_schema',
  'core_ipc',
  'phone_security',
];

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  dormantThresholdDays: 30,
  minUseCountForHealth: 5,
  maxQuarantineDurationMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  autoRestoreMs: 24 * 60 * 60 * 1000,                 // 24 hours
  shadowTestDurationMs: 60_000,                         // 60 seconds
  protectedCategories: [...PROTECTED_CATEGORIES],
};
