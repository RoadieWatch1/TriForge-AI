// ── main/trading/levels/LevelScorer.ts ────────────────────────────────────────
//
// Scores the quality of a PriceLevel using a 10-factor weighted model.
//
// Each factor is normalized to 0–100. The final score is a weighted sum
// mapped to 0–100. Grade bands:
//   A = 80+           (institutional-quality level)
//   B = 65–79         (tradeable level)
//   C = 50–64         (marginal level — confirmation-dependent)
//   informational < 50 (reference only, do not trade)
//
// ── Heuristic Notes ──────────────────────────────────────────────────────────
//
// Several factors depend on context that the detectors alone cannot fully
// provide at detection time. This scorer uses practical heuristics:
//
//  1. displacementAway — If the detector pre-filled this factor (e.g.
//     SupplyDemandDetector measures displacement candle size), that value is
//     kept. Otherwise estimated from the distance between the level price
//     and the current market price relative to ATR.
//
//  2. reactionStrength — Estimated from the level's strength field set by
//     detectors ('strong'=80, 'moderate'=55, 'weak'=30). In Phase 5, the
//     ConfirmationEngine will provide precise reaction measurements.
//
//  3. htfAlignment — Computed from the 15m trend direction vs the level's
//     directional bias. Full agreement = 90, no bias = 50, conflict = 15.
//
//  4. freshness — Based on touchCount. 0 touches = 100 (pristine/untested),
//     1 = 85, 2 = 60, 3 = 40, 4+ = 20.
//
//  5. imbalancePresent — Kept from detector pre-fill (ImbalanceDetector
//     sets this to 100 for FVG levels). Cross-level proximity to an FVG is
//     evaluated by LevelMapEngine after all levels are detected.
//
//  6. volumeSurge — Kept from detector pre-fill (VolumeProfileDetector sets
//     POC to 80). If 0, falls back to a neutral 30 (data not available).
//
//  7. liquidityRelevance — Kept from detector pre-fill (LiquidityPoolDetector
//     sets to 100). Cross-level proximity is evaluated by LevelMapEngine.
//
//  8. touchCountQuality — 1 touch = 100 (pristine), 2 = 75, 3 = 50, 4+ = 25.
//     Same degradation curve as institutional "level freshness" logic.
//
//  9. recency — Linear decay from 100 (just created) to 0 over a
//     configurable window (default 4 hours = session length).
//
// 10. structuralBreak — Estimated from level type: swing points imply
//     structural shifts (60), supply/demand with strong displacement (50),
//     session levels and volume levels get 20 (they mark structure but
//     didn't "break" it). In later phases, this can be refined by
//     detecting actual BOS (break of structure) events.
//
// All heuristics are documented, deterministic, and will be progressively
// replaced with precise calculations as later phases add data.

import type {
  PriceLevel, LevelGrade, LevelQualityFactors, NormalizedMarketData,
} from '@triforge/engine';
import { LEVEL_QUALITY_WEIGHTS } from '@triforge/engine';
import type { BarTrend } from '@triforge/engine';

// ── Scoring Context ──────────────────────────────────────────────────────────

/**
 * Context provided to the scorer for each evaluation pass.
 * Assembled by LevelMapEngine from NormalizedMarketData.
 */
export interface ScoringContext {
  currentPrice: number;
  atr: number;                   // ATR(14) on 5m bars, or fallback
  trend15m: BarTrend;            // higher-timeframe trend direction
  nowMs: number;                 // current timestamp for recency calc
  /** Max age in ms before recency score drops to 0. Default 4h. */
  recencyWindowMs?: number;
  /** All FVG-type levels detected this pass, for proximity cross-check. */
  fvgLevels?: PriceLevel[];
  /** All liquidity pool levels detected this pass, for proximity cross-check. */
  liquidityLevels?: PriceLevel[];
}

// ── Score Result ──────────────────────────────────────────────────────────────

export interface LevelScoreResult {
  score: number;
  factors: LevelQualityFactors;
  grade: LevelGrade;
}

// ── Factor Computation ────────────────────────────────────────────────────────

function _clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Factor 1: displacementAway (weight 15)
 * How far price moved away from this level after it formed.
 */
function _scoreDisplacement(level: PriceLevel, ctx: ScoringContext): number {
  // If detector pre-filled, honor it
  if (level.qualityFactors.displacementAway > 0) {
    return _clamp(level.qualityFactors.displacementAway);
  }
  // Heuristic: distance from level to current price in ATR units
  if (ctx.atr <= 0) return 50;
  const dist = Math.abs(ctx.currentPrice - level.price);
  const atrMultiple = dist / ctx.atr;
  // 0 ATR away = 20 (price sitting on it, no displacement proven)
  // 1 ATR = 60, 2+ ATR = 90+
  return _clamp(20 + atrMultiple * 35);
}

/**
 * Factor 2: reactionStrength (weight 15)
 * Speed/size of rejection at this level.
 */
function _scoreReaction(level: PriceLevel): number {
  if (level.qualityFactors.reactionStrength > 0) {
    return _clamp(level.qualityFactors.reactionStrength);
  }
  // Heuristic from detector-assigned strength
  switch (level.strength) {
    case 'strong':   return 80;
    case 'moderate': return 55;
    case 'weak':     return 30;
    default:         return 40;
  }
}

/**
 * Factor 3: htfAlignment (weight 15)
 * Does the 15m trend agree with this level's directional bias?
 */
function _scoreHtfAlignment(level: PriceLevel, ctx: ScoringContext): number {
  const bias = level.directionalBias;
  const trend = ctx.trend15m;

  if (!bias || bias === 'neutral' || trend === 'unknown' || trend === 'range') {
    return 50; // no opinion either way
  }

  const trendIsUp = trend === 'up';
  const biasIsLong = bias === 'long';

  // Full agreement: demand zone + uptrend, or supply zone + downtrend
  if (trendIsUp === biasIsLong) return 90;
  // Conflict: demand zone in downtrend, supply zone in uptrend
  return 15;
}

/**
 * Factor 4: freshness (weight 10)
 * Untested levels are higher quality. Each test degrades.
 */
function _scoreFreshness(level: PriceLevel): number {
  const tc = level.touchCount;
  if (tc <= 0) return 100; // pristine / untested
  if (tc === 1) return 85;
  if (tc === 2) return 60;
  if (tc === 3) return 40;
  return 20; // 4+ touches — heavily tested, likely weakened
}

/**
 * Factor 5: imbalancePresent (weight 10)
 * Is there an FVG/imbalance at or near this level?
 */
function _scoreImbalance(level: PriceLevel, ctx: ScoringContext): number {
  // If detector pre-filled (FVG levels self-mark 100), honor it
  if (level.qualityFactors.imbalancePresent > 0) {
    return _clamp(level.qualityFactors.imbalancePresent);
  }
  // Cross-check: is there an FVG level near this level?
  if (ctx.fvgLevels && ctx.fvgLevels.length > 0 && ctx.atr > 0) {
    const proximity = ctx.atr * 0.5;
    const nearbyFvg = ctx.fvgLevels.some(
      f => f.id !== level.id && Math.abs(f.price - level.price) <= proximity,
    );
    if (nearbyFvg) return 75;
  }
  return 0; // no imbalance detected near this level
}

/**
 * Factor 6: volumeSurge (weight 10)
 * Was there volume confirmation when this level formed?
 */
function _scoreVolumeSurge(level: PriceLevel): number {
  if (level.qualityFactors.volumeSurge > 0) {
    return _clamp(level.qualityFactors.volumeSurge);
  }
  // No volume data available for this level — conservative neutral
  return 30;
}

/**
 * Factor 7: liquidityRelevance (weight 10)
 * Is this level near a liquidity pool?
 */
function _scoreLiquidity(level: PriceLevel, ctx: ScoringContext): number {
  if (level.qualityFactors.liquidityRelevance > 0) {
    return _clamp(level.qualityFactors.liquidityRelevance);
  }
  // Cross-check: is there a liquidity pool near this level?
  if (ctx.liquidityLevels && ctx.liquidityLevels.length > 0 && ctx.atr > 0) {
    const proximity = ctx.atr * 0.5;
    const nearbyPool = ctx.liquidityLevels.some(
      p => p.id !== level.id && Math.abs(p.price - level.price) <= proximity,
    );
    if (nearbyPool) return 70;
  }
  return 0;
}

/**
 * Factor 8: touchCountQuality (weight 5)
 * 1 touch = pristine (100), degrades with more touches.
 */
function _scoreTouchCount(level: PriceLevel): number {
  // Some detectors pre-fill this; honor if non-default
  if (level.qualityFactors.touchCountQuality > 0 &&
      level.qualityFactors.touchCountQuality !== 100) {
    return _clamp(level.qualityFactors.touchCountQuality);
  }
  const tc = level.touchCount;
  if (tc <= 1) return 100;
  if (tc === 2) return 75;
  if (tc === 3) return 50;
  return 25; // 4+ touches
}

/**
 * Factor 9: recency (weight 5)
 * Linear decay from 100 (just created) to 0 over recencyWindowMs.
 */
function _scoreRecency(level: PriceLevel, ctx: ScoringContext): number {
  const window = ctx.recencyWindowMs ?? 4 * 60 * 60_000; // 4 hours
  const age = ctx.nowMs - level.createdAt;
  if (age <= 0) return 100;
  if (age >= window) return 0;
  return _clamp(100 * (1 - age / window));
}

/**
 * Factor 10: structuralBreak (weight 5)
 * Did this level cause a break of market structure?
 */
function _scoreStructuralBreak(level: PriceLevel): number {
  if (level.qualityFactors.structuralBreak > 0) {
    return _clamp(level.qualityFactors.structuralBreak);
  }
  // Heuristic by level type:
  // Swing points and displacement origins imply structural shifts
  switch (level.type) {
    case 'swing_high':
    case 'swing_low':
      return 60;
    case 'supply':
    case 'demand':
    case 'displacement_origin':
      return 50;
    case 'fvg':
    case 'imbalance':
      return 40;
    case 'liquidity_pool':
      return 30;
    // Session/volume levels mark structure but don't "break" it
    case 'volume_poc':
    case 'volume_vah':
    case 'volume_val':
    case 'session_high':
    case 'session_low':
    case 'prev_day_high':
    case 'prev_day_low':
    case 'overnight_high':
    case 'overnight_low':
    case 'opening_range_high':
    case 'opening_range_low':
      return 20;
    default:
      return 10;
  }
}

// ── Grade Derivation ──────────────────────────────────────────────────────────

function _deriveGrade(score: number): LevelGrade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'informational';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score the quality of a PriceLevel using the 10-factor weighted model.
 *
 * @param level - The level to score. Its existing qualityFactors may contain
 *                pre-filled values from detectors; these are respected when > 0.
 * @param ctx   - Scoring context from the current market state.
 * @returns Score result with final score (0–100), per-factor breakdown, and grade.
 */
export function scoreLevelQuality(
  level: PriceLevel,
  ctx: ScoringContext,
): LevelScoreResult {
  const factors: LevelQualityFactors = {
    displacementAway:   _scoreDisplacement(level, ctx),
    reactionStrength:   _scoreReaction(level),
    htfAlignment:       _scoreHtfAlignment(level, ctx),
    freshness:          _scoreFreshness(level),
    imbalancePresent:   _scoreImbalance(level, ctx),
    volumeSurge:        _scoreVolumeSurge(level),
    liquidityRelevance: _scoreLiquidity(level, ctx),
    touchCountQuality:  _scoreTouchCount(level),
    recency:            _scoreRecency(level, ctx),
    structuralBreak:    _scoreStructuralBreak(level),
  };

  // Weighted sum
  let score = 0;
  for (const key of Object.keys(LEVEL_QUALITY_WEIGHTS) as (keyof LevelQualityFactors)[]) {
    score += (factors[key] / 100) * LEVEL_QUALITY_WEIGHTS[key];
  }
  // score is now 0–100 (since weights sum to 100)
  score = _clamp(Math.round(score * 100) / 100); // keep 2 decimal places

  return {
    score,
    factors,
    grade: _deriveGrade(score),
  };
}
