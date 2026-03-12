// ── biasEngine.ts — Convert learning signals into scoring biases ────────────
//
// Applies user decisions, venture outcomes, trends, and expert contributions
// to the learning profile. All deltas are clamped to [biasClampMin, biasClampMax].

import type {
  LearningProfile, VentureOutcomeRecord, TrendSnapshot,
  ExpertContributionRecord, LearningConfig,
} from './learningTypes';
import { DEFAULT_LEARNING_CONFIG } from './learningTypes';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply bias from a user decision (approve, reject, alternative, hold, plan_only).
 */
export function applyUserDecisionBias(
  profile: LearningProfile,
  decision: VentureOutcomeRecord,
  config?: Partial<LearningConfig>,
): void {
  const cfg = { ...DEFAULT_LEARNING_CONFIG, ...config };
  const cat = decision.category;

  switch (decision.decision) {
    case 'approved':
      adjustBias(profile, cat, 0.1, cfg);
      adjustCategoryPreference(profile, cat, 1.0);
      break;
    case 'rejected':
      adjustBias(profile, cat, -0.15, cfg);
      adjustCategoryPreference(profile, cat, -1.5);
      if (!profile.avoidPatterns.includes(cat)) {
        // Only add to avoid after 3+ rejections
        const rejections = profile.ventureHistory.filter(
          v => v.category === cat && v.decision === 'rejected'
        ).length;
        if (rejections >= 3) profile.avoidPatterns.push(cat);
      }
      break;
    case 'alternative':
      adjustBias(profile, cat, -0.05, cfg);
      adjustCategoryPreference(profile, cat, -0.3);
      break;
    case 'hold':
      // No bias change for hold
      break;
    case 'plan_only':
      adjustBias(profile, cat, 0.03, cfg);
      adjustCategoryPreference(profile, cat, 0.2);
      break;
  }
}

/**
 * Apply bias from a venture outcome (performance metrics).
 */
export function applyOutcomeBias(
  profile: LearningProfile,
  outcome: VentureOutcomeRecord,
  config?: Partial<LearningConfig>,
): void {
  const cfg = { ...DEFAULT_LEARNING_CONFIG, ...config };
  const cat = outcome.category;
  const score = outcome.performanceScore ?? 0;

  if (score >= 80) {
    adjustBias(profile, cat, 0.15, cfg);
    adjustCategoryPreference(profile, cat, 2.0);
    // Boost pattern
    if (!profile.boostPatterns.includes(cat)) {
      profile.boostPatterns.push(cat);
    }
  } else if (score >= 50) {
    adjustBias(profile, cat, 0.05, cfg);
    adjustCategoryPreference(profile, cat, 0.5);
  } else if (score > 0) {
    adjustBias(profile, cat, -0.1, cfg);
    adjustCategoryPreference(profile, cat, -1.0);
  }

  // Revenue bonus
  if (outcome.revenueReached) {
    adjustBias(profile, cat, 0.2, cfg);
    adjustCategoryPreference(profile, cat, 3.0);
  }

  // Subscriber milestone bonus
  if (outcome.subscriberCount && outcome.subscriberCount >= 250) {
    adjustBias(profile, cat, 0.08, cfg);
  }
}

/**
 * Apply bias from trend data (rising/declining momentum).
 */
export function applyTrendBias(
  profile: LearningProfile,
  trends: TrendSnapshot[],
  config?: Partial<LearningConfig>,
): void {
  const cfg = { ...DEFAULT_LEARNING_CONFIG, ...config };

  for (const trend of trends) {
    const cat = trend.category;
    switch (trend.momentum) {
      case 'rising':
        adjustBias(profile, cat, 0.03, cfg);
        adjustCategoryPreference(profile, cat, 0.3);
        break;
      case 'declining':
        adjustBias(profile, cat, -0.03, cfg);
        adjustCategoryPreference(profile, cat, -0.3);
        break;
      // stable: no change
    }
  }
}

/**
 * Apply bias from expert contribution data.
 * Boosts categories where top experts contributed successfully.
 */
export function applyExpertBias(
  profile: LearningProfile,
  contributions: ExpertContributionRecord[],
  config?: Partial<LearningConfig>,
): void {
  const cfg = { ...DEFAULT_LEARNING_CONFIG, ...config };

  // Group by venture, check if expert output survived
  const survivedByVenture: Record<string, number> = {};
  const failedByVenture: Record<string, number> = {};

  for (const c of contributions) {
    if (c.outputSurvived) {
      survivedByVenture[c.ventureId] = (survivedByVenture[c.ventureId] ?? 0) + c.contributionScore;
    } else {
      failedByVenture[c.ventureId] = (failedByVenture[c.ventureId] ?? 0) + 1;
    }
  }

  // Find venture categories from profile history
  for (const [ventureId, score] of Object.entries(survivedByVenture)) {
    const venture = profile.ventureHistory.find(v => v.ventureId === ventureId);
    if (venture) {
      const delta = Math.min(0.05, score / 1000);
      adjustBias(profile, venture.category, delta, cfg);
    }
  }
}

/**
 * Compute current biases as a flat record for the scoring engine.
 */
export function computeBiases(profile: LearningProfile): Record<string, number> {
  // Merge category preferences into biases as secondary influence
  const result = { ...profile.biases };

  for (const [cat, pref] of Object.entries(profile.categoryPreferences)) {
    const biasKey = `category:${cat}`;
    if (!result[biasKey]) {
      // Convert preference (unbounded) to bias (clamped multiplier)
      const normalized = 1.0 + Math.tanh(pref / 10) * 0.5; // maps to ~[0.5, 1.5]
      result[biasKey] = normalized;
    }
  }

  return result;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function adjustBias(
  profile: LearningProfile,
  dimension: string,
  delta: number,
  cfg: LearningConfig,
): void {
  const current = profile.biases[dimension] ?? 1.0;
  profile.biases[dimension] = clamp(current + delta, cfg.biasClampMin, cfg.biasClampMax);
}

function adjustCategoryPreference(
  profile: LearningProfile,
  category: string,
  delta: number,
): void {
  profile.categoryPreferences[category] = (profile.categoryPreferences[category] ?? 0) + delta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
