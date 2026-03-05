/**
 * compoundTypes.ts — Phase 7: Compound Engine shared types
 */

export interface StrategyProfile {
  id: string;

  /** Which growth loop this strategy was observed on (optional — may span loops) */
  loopId?: string;

  type: 'outreach' | 'content';

  /** Human-readable summary, e.g. 'Subject: Quick idea for your leads' */
  description: string;

  /**
   * A/B test variant label. Set to 'A' or 'B' when this strategy is part of an
   * A/B test pair. CompoundEngine tracks A vs B performance separately and
   * uses getScalingDecision() → 'replace' action to retire the loser variant.
   */
  variantLabel?: 'A' | 'B' | string;

  inputs: {
    subjectLine?: string;
    tone?: string;
    contentType?: string;
    keywords?: string[];
  };

  performance: {
    sent?: number;
    replies?: number;
    leads?: number;
    conversions?: number;
    replyRate?: number;
    conversionRate?: number;
  };

  /** Computed: replyRate*0.5 + conversionRate*0.4 + min(leads/10, 1)*0.1 */
  score: number;

  /** active = HIGH PERFORMER (score > 0.7), testing = mid, deprecated = LOW (score < 0.3) */
  status: 'active' | 'testing' | 'deprecated';

  createdAt: number;
  updatedAt: number;
}

export interface CompoundStats {
  totalStrategies: number;
  highPerformers: number;    // status === 'active'
  lowPerformers: number;     // status === 'deprecated'
  testingStrategies: number;
  avgScore: number;
  lastOptimizedAt: number | null;
}
