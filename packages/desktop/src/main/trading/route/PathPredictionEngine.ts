// ── main/trading/route/PathPredictionEngine.ts ────────────────────────────────
//
// Determines the most likely next destination for price and constructs
// a scored route from the current position to that destination.
//
// This engine is destination-first, not entry-first. It answers:
//   1. What level are we near?
//   2. What level is price most likely seeking next?
//   3. Is the path clean enough to matter?
//
// ── Directional Bias Determination ───────────────────────────────────────────
//
// The engine computes a directional bias score from -100 (strong short)
// to +100 (strong long) using multiple inputs:
//
//   1. trend5m  — Short-term momentum. Up=+25, Down=-25, Range/Unknown=0.
//   2. trend15m — HTF bias. Up=+30, Down=-30, Range/Unknown=0.
//   3. Level proximity — If price is near a demand zone → +15 bias toward
//      long (expecting bounce). If near supply → -15 bias toward short.
//   4. Recent displacement — Looks at the last 5 bars for strong directional
//      candles. Strong bullish bodies → positive bias, bearish → negative.
//   5. VWAP relation — If available: above VWAP = +10, below = -10.
//
// If |bias| < 15, the engine considers the situation ambiguous and returns
// null (no prediction). This prevents forced predictions in no-man's-land.
//
// ── Route Generation ─────────────────────────────────────────────────────────
//
// Once a direction is determined:
//   1. The engine looks for the nearest quality level (>= 50) in that
//      direction as the primary destination.
//   2. It looks for one alternate destination further away.
//   3. If bias is moderate (|bias| 15–40), it also generates one counter-
//      direction alternate for the "what if we're wrong" scenario.
//   4. Each route is scored through TargetSelectionEngine.
//   5. The best scoring route becomes the primary prediction.
//
// Pure function — no internal state across calls.

import type {
  LevelMap, PriceLevel, NormalizedMarketData,
  PathPrediction, SessionContext, NormalizedBar,
} from '@triforge/engine';
import type { BarTrend } from '@triforge/engine';
import { RouteCandidate } from './RouteCandidate';
import {
  selectBestRoute, scoreRouteCandidate,
  type RouteSelectionContext,
} from './TargetSelectionEngine';

// ── Bias Computation ──────────────────────────────────────────────────────────

interface BiasResult {
  /** Directional bias: positive = long, negative = short. Range: -100 to +100. */
  score: number;
  /** Derived direction, or null if ambiguous. */
  direction: 'long' | 'short' | null;
  /** Component contributions for debugging/logging. */
  components: {
    trend5m: number;
    trend15m: number;
    levelProximity: number;
    recentDisplacement: number;
    vwap: number;
  };
}

function _trendBias(trend: BarTrend, weight: number): number {
  switch (trend) {
    case 'up':   return weight;
    case 'down': return -weight;
    default:     return 0;
  }
}

/**
 * Measure recent displacement from the last N bars.
 * Looks for strong directional candle bodies relative to average bar range.
 * Returns a value from -20 to +20.
 */
function _recentDisplacement(bars: NormalizedBar[], lookback = 5): number {
  if (bars.length < 3) return 0;

  const start = Math.max(0, bars.length - lookback);
  const recentBars = bars.slice(start);

  // Average range across all available bars for normalization
  const avgPeriod = Math.min(20, bars.length);
  const avgStart = Math.max(0, bars.length - avgPeriod);
  let avgRange = 0;
  for (let i = avgStart; i < bars.length; i++) {
    avgRange += bars[i].high - bars[i].low;
  }
  avgRange /= avgPeriod;
  if (avgRange <= 0) return 0;

  // Sum signed body sizes, normalized by average range
  let signedSum = 0;
  for (const bar of recentBars) {
    const body = bar.close - bar.open; // positive = bullish, negative = bearish
    signedSum += body / avgRange;
  }

  // Normalize: divide by lookback so individual bars contribute proportionally,
  // then scale to a -20 to +20 range
  const normalized = (signedSum / recentBars.length) * 20;
  return Math.max(-20, Math.min(20, normalized));
}

/**
 * Level proximity bias: if price is sitting at a demand zone, bias long.
 * If at a supply zone, bias short. Based on the nearest level within 0.5 ATR.
 */
function _levelProximityBias(
  map: LevelMap,
  currentPrice: number,
  atr: number,
): number {
  if (atr <= 0) return 0;
  const proximity = atr * 0.5;

  // Check nearest above and below within proximity
  let bias = 0;

  for (const level of map.levels) {
    if (level.broken) continue;
    const dist = Math.abs(level.price - currentPrice);
    if (dist > proximity) continue;

    // At a demand zone → expect bounce up → long bias
    if (level.directionalBias === 'long') bias += 15;
    // At a supply zone → expect rejection down → short bias
    if (level.directionalBias === 'short') bias -= 15;
    // Only consider the single nearest relevant level
    break;
  }

  return Math.max(-15, Math.min(15, bias));
}

/**
 * VWAP relation bias: above VWAP = slight long, below = slight short.
 */
function _vwapBias(data: NormalizedMarketData): number {
  if (!data.vwap || !data.currentPrice) return 0;
  if (data.currentPrice > data.vwap) return 10;
  if (data.currentPrice < data.vwap) return -10;
  return 0;
}

/**
 * Compute the overall directional bias from all available signals.
 */
function _computeBias(
  map: LevelMap,
  data: NormalizedMarketData,
  atr: number,
): BiasResult {
  const t5 = _trendBias(data.trend5m, 25);
  const t15 = _trendBias(data.trend15m, 30);
  const lp = _levelProximityBias(map, data.currentPrice, atr);
  const rd = _recentDisplacement(data.bars5m);
  const vw = _vwapBias(data);

  const score = Math.max(-100, Math.min(100, t5 + t15 + lp + rd + vw));

  let direction: 'long' | 'short' | null = null;
  if (score >= 15) direction = 'long';
  else if (score <= -15) direction = 'short';

  return {
    score,
    direction,
    components: {
      trend5m: t5,
      trend15m: t15,
      levelProximity: lp,
      recentDisplacement: rd,
      vwap: vw,
    },
  };
}

// ── Obstacle Detection ────────────────────────────────────────────────────────

/**
 * Find all active levels between two prices that could impede a move.
 * For a long route, obstacles are levels above entry and below target.
 * Excludes the from/to levels themselves.
 */
function _findObstacles(
  allLevels: PriceLevel[],
  fromPrice: number,
  toPrice: number,
): PriceLevel[] {
  const low = Math.min(fromPrice, toPrice);
  const high = Math.max(fromPrice, toPrice);

  return allLevels.filter(l =>
    !l.broken &&
    l.price > low &&
    l.price < high,
  );
}

// ── Current Level Detection ───────────────────────────────────────────────────

/**
 * Find the level that price is currently "at" — within ATR * 0.3 of price.
 * Returns the closest non-broken level, or null.
 */
function _findCurrentLevel(
  map: LevelMap,
  currentPrice: number,
  atr: number,
): PriceLevel | null {
  const proximity = atr * 0.3;
  let best: PriceLevel | null = null;
  let bestDist = Infinity;

  for (const level of map.levels) {
    if (level.broken) continue;
    const dist = Math.abs(level.price - currentPrice);
    if (dist <= proximity && dist < bestDist) {
      bestDist = dist;
      best = level;
    }
  }

  return best;
}

// ── Candidate Generation ──────────────────────────────────────────────────────

/**
 * Find destination levels in a given direction, sorted by distance from
 * current price (nearest first). Only returns levels with quality >= minQuality.
 */
function _findDestinations(
  map: LevelMap,
  currentPrice: number,
  direction: 'long' | 'short',
  minQuality: number,
): PriceLevel[] {
  return map.levels
    .filter(l => {
      if (l.broken) return false;
      if (l.qualityScore < minQuality) return false;
      if (direction === 'long') return l.price > currentPrice;
      return l.price < currentPrice;
    })
    .sort((a, b) => {
      // Nearest first
      const dA = Math.abs(a.price - currentPrice);
      const dB = Math.abs(b.price - currentPrice);
      return dA - dB;
    });
}

/**
 * Create a synthetic "current position" PriceLevel to use as the route's
 * fromLevel when price is not at any known level.
 */
function _syntheticCurrentLevel(
  currentPrice: number,
  direction: 'long' | 'short',
): PriceLevel {
  return {
    id: `current_pos_${Date.now()}`,
    type: direction === 'long' ? 'session_low' : 'session_high',
    price: currentPrice,
    strength: 'weak',
    touchCount: 0,
    createdAt: Date.now(),
    broken: false,
    label: `Current Price ${currentPrice.toFixed(2)}`,
    qualityScore: 50,
    grade: 'C',
    qualityFactors: {
      displacementAway: 0,
      reactionStrength: 0,
      htfAlignment: 50,
      freshness: 100,
      imbalancePresent: 0,
      volumeSurge: 0,
      liquidityRelevance: 0,
      touchCountQuality: 100,
      recency: 100,
      structuralBreak: 0,
    },
    directionalBias: 'neutral',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Predict the most likely next price destination.
 *
 * @param map      - Current LevelMap from LevelMapEngine
 * @param data     - Normalized market data snapshot
 * @param session  - Session context, or null if not yet available
 * @returns A PathPrediction with primary route and up to 2 alternates,
 *          or null if the situation is ambiguous or no valid route exists.
 */
export function predictPath(
  map: LevelMap,
  data: NormalizedMarketData,
  session: SessionContext | null = null,
): PathPrediction | null {
  if (map.levels.length === 0) return null;

  const atr = data.atr5m ?? 10;
  const currentPrice = data.currentPrice;
  const minQuality = 50;

  // ── Step 1: Compute directional bias ──────────────────────────────────

  const bias = _computeBias(map, data, atr);
  if (bias.direction === null) {
    // Ambiguous — no prediction
    return null;
  }

  // ── Step 2: Find current level ────────────────────────────────────────

  const currentLevel = _findCurrentLevel(map, currentPrice, atr);

  // ── Step 3: Find destination candidates ───────────────────────────────

  const destinations = _findDestinations(map, currentPrice, bias.direction, minQuality);
  if (destinations.length === 0) {
    // No quality levels in the predicted direction
    return null;
  }

  // ── Step 4: Build route candidates ────────────────────────────────────

  const fromLevel = currentLevel ?? _syntheticCurrentLevel(currentPrice, bias.direction);

  const selectionCtx: RouteSelectionContext = {
    atr,
    trend15m: data.trend15m,
    session,
  };

  const candidates: RouteCandidate[] = [];

  // Primary: nearest quality level in predicted direction
  const primaryDest = destinations[0];
  const primaryObstacles = _findObstacles(map.levels, currentPrice, primaryDest.price);
  candidates.push(new RouteCandidate({
    fromLevel,
    toLevel: primaryDest,
    direction: bias.direction,
    intermediateObstacles: primaryObstacles,
  }));

  // Alternate 1: second-nearest level in same direction (if exists)
  if (destinations.length > 1) {
    const altDest = destinations[1];
    const altObstacles = _findObstacles(map.levels, currentPrice, altDest.price);
    candidates.push(new RouteCandidate({
      fromLevel,
      toLevel: altDest,
      direction: bias.direction,
      intermediateObstacles: altObstacles,
    }));
  }

  // Alternate 2: If bias is moderate (|score| < 40), generate a counter-
  // direction route for the "what if" scenario
  if (Math.abs(bias.score) < 40) {
    const counterDir: 'long' | 'short' = bias.direction === 'long' ? 'short' : 'long';
    const counterDests = _findDestinations(map, currentPrice, counterDir, minQuality);
    if (counterDests.length > 0) {
      const counterObstacles = _findObstacles(map.levels, currentPrice, counterDests[0].price);
      candidates.push(new RouteCandidate({
        fromLevel,
        toLevel: counterDests[0],
        direction: counterDir,
        intermediateObstacles: counterObstacles,
      }));
    }
  }

  // ── Step 5: Score and select ──────────────────────────────────────────

  const { best, results } = selectBestRoute(candidates, selectionCtx);
  if (!best) {
    // All candidates were rejected — no valid route
    return null;
  }

  // Build alternate routes from remaining non-rejected candidates
  const alternates = results
    .filter(r => !r.rejected && r.candidate.id !== best.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(r => r.candidate.toRoute(false));

  // ── Step 6: Assemble prediction ───────────────────────────────────────

  // Confidence: derived from bias strength and route quality
  // |bias| 15–30 = low, 30–60 = medium, 60+ = high
  // Route quality modulates: high quality boosts, low quality dampens
  const biasConfidence = Math.min(100, (Math.abs(bias.score) / 80) * 100);
  const routeConfidence = best.qualityScore;
  const confidence = Math.round((biasConfidence * 0.4 + routeConfidence * 0.6) * 100) / 100;

  return {
    currentLevel,
    nextTargetLevel: best.toLevel,
    direction: best.direction,
    route: best.toRoute(true),
    alternateRoutes: alternates,
    confidence: Math.max(0, Math.min(100, confidence)),
  };
}

// ── Extended Result (desktop-local, not exported to shared engine types) ─────

/**
 * Desktop-local result type that includes the raw bias score alongside the
 * prediction. Used by the simulator's prediction stabilizer for hysteresis
 * logic. Keeps the shared PathPrediction type unchanged.
 */
export interface PredictionWithBias {
  prediction: PathPrediction | null;
  /** Raw directional bias score from -100 (strong short) to +100 (strong long). */
  biasScore: number;
}

/**
 * Same as `predictPath` but returns the raw bias score alongside the
 * prediction. The bias score is used by the simulator for hysteresis
 * (route stability) without modifying shared engine types.
 */
export function predictPathWithBias(
  map: LevelMap,
  data: NormalizedMarketData,
  session: SessionContext | null = null,
): PredictionWithBias {
  if (map.levels.length === 0) return { prediction: null, biasScore: 0 };

  const atr = data.atr5m ?? 10;
  const bias = _computeBias(map, data, atr);

  const prediction = predictPath(map, data, session);
  return { prediction, biasScore: bias.score };
}
