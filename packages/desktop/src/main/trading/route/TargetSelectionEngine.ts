// ── main/trading/route/TargetSelectionEngine.ts ───────────────────────────────
//
// Scores and ranks RouteCandidate objects using the 6-factor weighted model,
// then selects the best valid route or returns null.
//
// 6-factor model (total weights = 100):
//   destination_clarity:   20  — Is the destination a clear, well-defined level?
//   clean_travel_space:    20  — Is the space between entry and target unobstructed?
//   congestion_penalty:    15  — How many opposing obstacles sit in the path?
//   destination_liquidity: 15  — Is there a liquidity pocket at the destination?
//   session_alignment:     15  — Does the route align with the session window?
//   htf_alignment:         15  — Does the route align with 15m trend?
//
// Rejection rules (hard filters — route is discarded, not scored):
//   - Destination level quality < 50
//   - Distance < 1.5x a reasonable stop distance (insufficient RR)
//   - 3+ intermediate obstacles (too crowded)
//   - Session is closed or pre-map
//
// The engine is deterministic: same inputs produce the same output.

import type {
  RouteQualityFactors, PriceLevel, SessionContext,
} from '@triforge/engine';
import { ROUTE_QUALITY_WEIGHTS } from '@triforge/engine';
import type { BarTrend } from '@triforge/engine';
import { RouteCandidate } from './RouteCandidate';

// ── Scoring Context ──────────────────────────────────────────────────────────

export interface RouteSelectionContext {
  /** ATR for the current session (from 5m bars). */
  atr: number;
  /** 15m trend direction. */
  trend15m: BarTrend;
  /** Session context, if available. Null = session scoring uses neutral 50. */
  session: SessionContext | null;
  /** Minimum acceptable risk-reward ratio. Default 1.5. */
  minRR?: number;
  /** Maximum intermediate obstacles before rejection. Default 2. */
  maxObstacles?: number;
  /** Minimum destination level quality score. Default 50. */
  minDestinationQuality?: number;
}

// ── Score Result ──────────────────────────────────────────────────────────────

export interface RouteScoreResult {
  candidate: RouteCandidate;
  score: number;
  factors: RouteQualityFactors;
  rejected: boolean;
  rejectReason?: string;
}

// ── Factor Computation ────────────────────────────────────────────────────────

function _clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Factor 1: destinationClarity (weight 20)
 * How clear and well-defined is the destination level?
 * Based on the destination level's quality score and grade.
 */
function _scoreDestinationClarity(candidate: RouteCandidate): number {
  const dest = candidate.toLevel;
  // Direct mapping from the destination level's quality score.
  // A-grade (80+) destination → high clarity.
  // Below 50 → low clarity (should have been rejected, but score anyway).
  return _clamp(dest.qualityScore);
}

/**
 * Factor 2: cleanTravelSpace (weight 20)
 * Is the space between entry and target relatively free of obstacles?
 */
function _scoreCleanSpace(candidate: RouteCandidate): number {
  const n = candidate.intermediateObstacles.length;
  if (n === 0) return 100;
  if (n === 1) {
    // One obstacle: score depends on how "strong" it is
    const obs = candidate.intermediateObstacles[0];
    // Weak/informational obstacles barely matter
    if (obs.qualityScore < 50) return 80;
    if (obs.qualityScore < 65) return 60;
    return 40; // strong obstacle in the way
  }
  if (n === 2) return 25;
  return 10; // 3+ should have been rejected, but score defensively
}

/**
 * Factor 3: congestionPenalty (weight 15)
 * Inverse penalty: higher score = less congestion = better route.
 * Measures density of obstacles per unit distance.
 */
function _scoreCongestion(candidate: RouteCandidate, atr: number): number {
  const n = candidate.intermediateObstacles.length;
  if (n === 0) return 100;

  // Obstacle density: obstacles per ATR of travel distance
  const distInAtr = atr > 0 ? candidate.distancePoints / atr : 1;
  const density = n / Math.max(distInAtr, 0.5);

  // density < 0.5 per ATR = mild congestion (score ~70)
  // density 0.5–1.0 = moderate (score ~40)
  // density > 1.0 = heavy (score ~15)
  if (density < 0.5) return _clamp(90 - density * 40);
  if (density < 1.0) return _clamp(70 - density * 40);
  return _clamp(30 - density * 10);
}

/**
 * Factor 4: destinationLiquidity (weight 15)
 * Is there a liquidity pocket at or near the destination?
 * Levels of type liquidity_pool score highest. Levels near swing
 * clusters also score well.
 */
function _scoreDestinationLiquidity(candidate: RouteCandidate): number {
  const dest = candidate.toLevel;

  // Direct liquidity pool destination
  if (dest.type === 'liquidity_pool') return 95;

  // Session extremes and prev-day levels attract institutional liquidity
  const highLiquidityTypes = new Set([
    'session_high', 'session_low',
    'prev_day_high', 'prev_day_low',
    'overnight_high', 'overnight_low',
  ]);
  if (highLiquidityTypes.has(dest.type)) return 75;

  // Supply/demand zones imply order flow presence
  if (dest.type === 'supply' || dest.type === 'demand') return 65;

  // Volume profile levels are high-activity zones
  if (dest.type === 'volume_poc') return 70;
  if (dest.type === 'volume_vah' || dest.type === 'volume_val') return 55;

  // FVGs and swings are structural but not inherently liquidity-rich
  if (dest.type === 'fvg' || dest.type === 'imbalance') return 45;
  if (dest.type === 'swing_high' || dest.type === 'swing_low') return 50;

  // Opening range
  if (dest.type === 'opening_range_high' || dest.type === 'opening_range_low') return 60;

  return 30;
}

/**
 * Factor 5: sessionAlignment (weight 15)
 * Does the route make sense given the current session window?
 */
function _scoreSessionAlignment(
  candidate: RouteCandidate,
  session: SessionContext | null,
): number {
  if (!session) return 50; // neutral if no session context

  // Closed or outside session → strongly discourage
  if (session.windowLabel === 'closed' || session.windowLabel === 'outside') return 10;
  // Pre-map → too early to commit
  if (session.windowLabel === 'pre_map') return 15;

  // Use the session quality score as baseline (prime=high, reduced=lower)
  let score = session.sessionScore;

  // News buffer active → penalize
  if (session.newsBuffer) {
    score = Math.min(score, 25);
  }

  // Less than 15 minutes to close → only take strong setups
  if (session.minutesUntilClose < 15 && session.minutesUntilClose >= 0) {
    score = Math.min(score, 35);
  }

  return _clamp(score);
}

/**
 * Factor 6: htfAlignment (weight 15)
 * Does the route direction agree with the 15m trend?
 */
function _scoreHtfAlignment(
  candidate: RouteCandidate,
  trend15m: BarTrend,
): number {
  if (trend15m === 'unknown' || trend15m === 'range') return 50;

  const trendIsUp = trend15m === 'up';
  const routeIsLong = candidate.direction === 'long';

  // Full agreement
  if (trendIsUp === routeIsLong) return 90;
  // Counter-trend
  return 20;
}

// ── Hard Rejection ────────────────────────────────────────────────────────────

interface RejectionResult {
  rejected: boolean;
  reason?: string;
}

function _checkRejection(
  candidate: RouteCandidate,
  ctx: RouteSelectionContext,
): RejectionResult {
  const minDestQ = ctx.minDestinationQuality ?? 50;
  const maxObs = ctx.maxObstacles ?? 2;
  const minRR = ctx.minRR ?? 1.5;

  // 1. Destination level quality too low
  if (candidate.toLevel.qualityScore < minDestQ) {
    return { rejected: true, reason: `Destination quality ${candidate.toLevel.qualityScore.toFixed(1)} < ${minDestQ}` };
  }

  // 2. Too many intermediate obstacles
  if (candidate.intermediateObstacles.length > maxObs) {
    return { rejected: true, reason: `${candidate.intermediateObstacles.length} obstacles > max ${maxObs}` };
  }

  // 3. Insufficient RR potential
  // Use 1 ATR as a reasonable default stop distance
  const impliedStop = ctx.atr > 0 ? ctx.atr : candidate.distancePoints * 0.5;
  const rr = candidate.riskRewardRatio(impliedStop);
  if (rr < minRR) {
    return { rejected: true, reason: `RR ${rr.toFixed(2)} < minimum ${minRR}` };
  }

  // 4. Session is closed or pre-map
  if (ctx.session) {
    const w = ctx.session.windowLabel;
    if (w === 'closed' || w === 'outside') {
      return { rejected: true, reason: `Session ${w} — no new routes` };
    }
  }

  // 5. Basic validity
  if (!candidate.isValid()) {
    return { rejected: true, reason: 'Route failed basic validity checks' };
  }

  return { rejected: false };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a single route candidate.
 *
 * Populates the candidate's qualityFactors and qualityScore, and returns
 * whether it was rejected by hard filters.
 */
export function scoreRouteCandidate(
  candidate: RouteCandidate,
  ctx: RouteSelectionContext,
): RouteScoreResult {
  // Check hard rejections first
  const rejection = _checkRejection(candidate, ctx);
  if (rejection.rejected) {
    return {
      candidate,
      score: 0,
      factors: candidate.qualityFactors,
      rejected: true,
      rejectReason: rejection.reason,
    };
  }

  // Score all 6 factors
  const factors: RouteQualityFactors = {
    destinationClarity:   _scoreDestinationClarity(candidate),
    cleanTravelSpace:     _scoreCleanSpace(candidate),
    congestionPenalty:     _scoreCongestion(candidate, ctx.atr),
    destinationLiquidity: _scoreDestinationLiquidity(candidate),
    sessionAlignment:     _scoreSessionAlignment(candidate, ctx.session),
    htfAlignment:         _scoreHtfAlignment(candidate, ctx.trend15m),
  };

  // Weighted sum → 0–100
  let score = 0;
  for (const key of Object.keys(ROUTE_QUALITY_WEIGHTS) as (keyof RouteQualityFactors)[]) {
    score += (factors[key] / 100) * ROUTE_QUALITY_WEIGHTS[key];
  }
  score = Math.round(score * 100) / 100;

  // Write back to candidate
  candidate.qualityFactors = factors;
  candidate.qualityScore = score;

  return { candidate, score, factors, rejected: false };
}

/**
 * Score and rank multiple route candidates. Returns the best valid
 * candidate, or null if all are rejected or no candidates are provided.
 *
 * @param candidates - Route candidates to evaluate
 * @param ctx - Selection context with market/session state
 * @returns The highest-scoring non-rejected candidate, or null.
 *          Also returns all scored results for inspection.
 */
export function selectBestRoute(
  candidates: RouteCandidate[],
  ctx: RouteSelectionContext,
): { best: RouteCandidate | null; results: RouteScoreResult[] } {
  if (candidates.length === 0) return { best: null, results: [] };

  const results: RouteScoreResult[] = candidates.map(c => scoreRouteCandidate(c, ctx));

  // Find the highest-scoring non-rejected candidate
  let best: RouteCandidate | null = null;
  let bestScore = -1;

  for (const r of results) {
    if (r.rejected) continue;
    if (r.score > bestScore) {
      bestScore = r.score;
      best = r.candidate;
    }
  }

  return { best, results };
}
