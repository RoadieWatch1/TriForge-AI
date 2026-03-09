// ── learningTypes.ts — Domain model for the Venture Learning Brain ───────────
//
// All types for the learning subsystem: signals, profiles, trends, expert
// contribution tracking, and configuration.

import type { MarketSignal } from '../ventures/ventureTypes';

// ── Signal types ────────────────────────────────────────────────────────────

export type LearningSignalType =
  | 'user_decision'
  | 'venture_outcome'
  | 'market_shift'
  | 'trend_update'
  | 'performance_metric'
  | 'component_health'
  | 'expert_contribution';

export interface LearningSignal {
  id: string;
  type: LearningSignalType;
  source: string;
  timestamp: number;
  data: Record<string, unknown>;
  ventureId?: string;
  expertId?: string;
  weight: number; // 0-1
}

// ── Venture outcome records ─────────────────────────────────────────────────

export type VentureDecision = 'approved' | 'rejected' | 'alternative' | 'hold' | 'plan_only';

export interface VentureOutcomeRecord {
  ventureId: string;
  category: string;
  concept: string;
  decision: VentureDecision;
  timestamp: number;
  performanceScore?: number;    // 0-100
  revenueReached?: boolean;
  subscriberCount?: number;
  daysActive?: number;
  contributingExperts?: string[]; // expert IDs that contributed
}

// ── Expert contribution ─────────────────────────────────────────────────────

export interface ExpertContributionRecord {
  expertId: string;
  ventureId: string;
  taskType: string;
  contributionScore: number;    // 0-100
  outputSurvived: boolean;      // did expert output make it into final proposal
  timestamp: number;
}

// ── Learning profile ────────────────────────────────────────────────────────

export interface LearningProfile {
  biases: Record<string, number>;               // dimension → multiplier [0.3, 3.0]
  categoryPreferences: Record<string, number>;   // category → affinity score
  avoidPatterns: string[];
  boostPatterns: string[];
  lastUpdated: number;
  signalCount: number;
  ventureHistory: VentureOutcomeRecord[];
  expertPerformanceHistory: ExpertContributionRecord[];
}

export const DEFAULT_LEARNING_PROFILE: LearningProfile = {
  biases: {},
  categoryPreferences: {},
  avoidPatterns: [],
  boostPatterns: [],
  lastUpdated: 0,
  signalCount: 0,
  ventureHistory: [],
  expertPerformanceHistory: [],
};

// ── Trend snapshots ─────────────────────────────────────────────────────────

export type TrendMomentum = 'rising' | 'stable' | 'declining';

export interface TrendSnapshot {
  id: string;
  timestamp: number;
  category: string;
  signals: MarketSignal[];
  momentum: TrendMomentum;
  confidence: number;           // 0-100
}

export interface TrendData {
  snapshots: TrendSnapshot[];
}

// ── Configuration ───────────────────────────────────────────────────────────

export interface LearningConfig {
  maxSignals: number;
  decayRate: number;            // per-day multiplier, default 0.98
  minSignalWeight: number;      // prune below this, default 0.05
  biasClampMin: number;         // never go below, default 0.3
  biasClampMax: number;         // never go above, default 3.0
  trendRefreshIntervalMs: number;
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  maxSignals: 500,
  decayRate: 0.98,
  minSignalWeight: 0.05,
  biasClampMin: 0.3,
  biasClampMax: 3.0,
  trendRefreshIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
};
