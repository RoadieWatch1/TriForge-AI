// ── main/trading/reliability/SetupQualityEngine.ts ──────────────────────────────
//
// Setup family classification and quality scoring for the level-to-level engine.
//
// Deterministically classifies each confirmed watch into a known setup family
// and scores it. Rejected/unclassified setups are blocked from actionability
// but remain visible in diagnostics with reasons and missing components.

import type { WatchAlert, SessionContext } from '@triforge/engine';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SetupFamily =
  | 'level_bounce'
  | 'fvg_fill'
  | 'liquidity_sweep'
  | 'swing_retest'
  | 'session_reference'
  | 'displacement_return'
  | 'unclassified';

export interface SetupClassification {
  family: SetupFamily;
  qualityScore: number;
  qualityBand: 'elite' | 'qualified' | 'marginal' | 'rejected';
  reasons: string[];
  missingComponents: string[];
}

// ── Family Rules ───────────────────────────────────────────────────────────────

interface FamilyRule {
  family: SetupFamily;
  levelTypes: string[];
  /** Confirmation predicate: receives detected confirmation type set. */
  confirmationCheck: (types: Set<string>) => boolean;
  /** What confirmations are considered ideal. */
  idealConfirmations: string[];
}

const FAMILY_RULES: FamilyRule[] = [
  {
    family: 'level_bounce',
    levelTypes: ['supply', 'demand'],
    confirmationCheck: (t) => t.has('rejection_wick') || t.has('displacement_candle'),
    idealConfirmations: ['rejection_wick', 'displacement_candle', 'volume_expansion'],
  },
  {
    family: 'fvg_fill',
    levelTypes: ['fvg', 'imbalance'],
    confirmationCheck: (t) => t.has('displacement_candle') || t.has('volume_expansion'),
    idealConfirmations: ['displacement_candle', 'volume_expansion'],
  },
  {
    family: 'liquidity_sweep',
    levelTypes: ['liquidity_pool'],
    confirmationCheck: (t) => t.has('reclaim_failure') && (t.has('rejection_wick') || t.has('micro_structure_break')),
    idealConfirmations: ['reclaim_failure', 'rejection_wick', 'micro_structure_break'],
  },
  {
    family: 'swing_retest',
    levelTypes: ['swing_high', 'swing_low'],
    confirmationCheck: (t) => t.has('retest_hold') || t.has('micro_structure_break'),
    idealConfirmations: ['retest_hold', 'micro_structure_break', 'rejection_wick'],
  },
  {
    family: 'session_reference',
    levelTypes: [
      'session_high', 'session_low',
      'prev_day_high', 'prev_day_low',
      'overnight_high', 'overnight_low',
      'opening_range_high', 'opening_range_low',
    ],
    confirmationCheck: (t) => t.size >= 2,
    idealConfirmations: ['rejection_wick', 'displacement_candle', 'retest_hold', 'volume_expansion'],
  },
  {
    family: 'displacement_return',
    levelTypes: ['displacement_origin'],
    confirmationCheck: (t) => t.has('displacement_candle'),
    idealConfirmations: ['displacement_candle', 'volume_expansion'],
  },
];

// ── Quality Scoring ────────────────────────────────────────────────────────────

function _clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function _qualityBand(score: number): SetupClassification['qualityBand'] {
  if (score >= 80) return 'elite';
  if (score >= 60) return 'qualified';
  if (score >= 40) return 'marginal';
  return 'rejected';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify a confirmed watch into a setup family and score its quality.
 *
 * Returns full classification with reasons and missing components for
 * diagnostics — even if the result is 'unclassified' or 'rejected'.
 */
export function classifySetup(
  watch: WatchAlert,
  session: SessionContext | null,
): SetupClassification {
  const levelType = watch.level.type;
  const detectedTypes = new Set(
    (watch.confirmations ?? [])
      .filter((c: any) => c.detected)
      .map((c: any) => c.type as string),
  );

  const reasons: string[] = [];
  const missing: string[] = [];

  // ── Find matching family ────────────────────────────────────────────
  let matched: FamilyRule | null = null;
  for (const rule of FAMILY_RULES) {
    if (rule.levelTypes.includes(levelType)) {
      if (rule.confirmationCheck(detectedTypes)) {
        matched = rule;
        break;
      }
      // Level matched but confirmations didn't — record what's missing
      for (const ideal of rule.idealConfirmations) {
        if (!detectedTypes.has(ideal)) missing.push(ideal);
      }
    }
  }

  if (!matched) {
    // Check if level type matches any family at all
    const anyLevelMatch = FAMILY_RULES.some(r => r.levelTypes.includes(levelType));
    if (anyLevelMatch) {
      reasons.push(`Level type ${levelType} matched a family but required confirmations not present`);
    } else {
      reasons.push(`Level type ${levelType} does not match any known setup family`);
    }
    return {
      family: 'unclassified',
      qualityScore: 0,
      qualityBand: 'rejected',
      reasons,
      missingComponents: missing,
    };
  }

  reasons.push(`Matched family: ${matched.family}`);

  // ── Compute quality factors ─────────────────────────────────────────

  // 1. Level-family match (30%): how well the level fits
  const levelFamilyMatch = 100; // exact match (we already matched the rule)
  reasons.push(`Level ${levelType} is a direct match for ${matched.family}`);

  // 2. Confirmation coverage (25%): % of ideal confirmations present
  const idealCount = matched.idealConfirmations.length;
  let presentCount = 0;
  for (const ideal of matched.idealConfirmations) {
    if (detectedTypes.has(ideal)) presentCount++;
    else missing.push(ideal);
  }
  const confirmationCoverage = _clamp((presentCount / Math.max(idealCount, 1)) * 100);
  reasons.push(`${presentCount}/${idealCount} ideal confirmations present`);

  // 3. Route structure (25%): destination quality + clean path
  const routeScore = _clamp(watch.route?.qualityScore ?? 50);
  const obstacleCount = watch.route?.intermediateObstacles?.length ?? 0;
  const routeStructure = _clamp(routeScore - obstacleCount * 10);
  if (obstacleCount > 0) reasons.push(`${obstacleCount} obstacle(s) in route`);

  // 4. Context alignment (20%): session + direction agreement
  let contextAlignment = 50; // neutral default
  if (session) {
    if (session.windowLabel === 'prime') contextAlignment = 90;
    else if (session.windowLabel === 'opening') contextAlignment = 75;
    else if (session.windowLabel === 'reduced') contextAlignment = 40;
    else if (session.windowLabel === 'closed' || session.windowLabel === 'outside') contextAlignment = 10;
    else contextAlignment = 50;
  }
  // Boost if confirmation is strong
  const confirmTotal = watch.confirmationScore?.total ?? 0;
  if (confirmTotal >= 80) contextAlignment = Math.min(100, contextAlignment + 15);

  // ── Weighted composite ──────────────────────────────────────────────
  const qualityScore = Math.round(
    (levelFamilyMatch / 100) * 30 +
    (confirmationCoverage / 100) * 25 +
    (routeStructure / 100) * 25 +
    (contextAlignment / 100) * 20,
  );

  return {
    family: matched.family,
    qualityScore: _clamp(qualityScore),
    qualityBand: _qualityBand(qualityScore),
    reasons,
    missingComponents: [...new Set(missing)],
  };
}
