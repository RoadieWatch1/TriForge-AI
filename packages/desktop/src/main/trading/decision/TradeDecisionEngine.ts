// ── main/trading/decision/TradeDecisionEngine.ts ──────────────────────────────
//
// Final trade-decision layer. Evaluates confirmed watch alerts and produces
// scored TradeIntent objects (or block reasons explaining why not).
//
// ── Pipeline ──────────────────────────────────────────────────────────────────
//
//   1. Filter to confirmed watches only
//   2. For each confirmed watch:
//      a. Apply hard blockers (level quality, route quality, feed, session)
//      b. Derive entry, stop, target from level/route structure
//      c. Compute 5-component weighted score
//      d. Apply final score threshold
//      e. Validate through RiskModel
//      f. If all pass → produce TradeIntent
//   3. Return intents + all block reasons for diagnostics
//
// ── Score Formula ─────────────────────────────────────────────────────────────
//
//   final = level(30%) + route(25%) + confirmation(20%) + session(10%) + rr(15%)
//
//   Bands:
//     elite    = 85–100
//     A        = 75–84
//     B        = 65–74
//     no_trade = below 65
//
// ── Behavior ──────────────────────────────────────────────────────────────────
//
//   - Destination-first: the route destination defines the target, not a
//     fixed ATR offset.
//   - Entry is derived from the watched level (the level that confirmed).
//   - Stop is placed on the opposite side of the entry level/zone + ATR padding.
//   - A confirmed watch still does not guarantee a trade. Hard blockers,
//     the risk model, and the final score threshold can all refuse.

import type {
  WatchAlert, NormalizedMarketData, SessionContext,
  LevelMap, PriceLevel, TradeIntent, TradeScore, TradeScoreBand,
  SetupGrade,
} from '@triforge/engine';
import { deriveScoreBand } from '@triforge/engine';
import { validateRisk, type AccountState, type RiskSettings } from './RiskModel';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface DecisionEngineConfig {
  /** Minimum entry level quality to proceed. Default 50. */
  minLevelQuality: number;
  /** Minimum route quality to proceed. Default 40. */
  minRouteQuality: number;
  /** ATR multiplier for stop padding beyond zone edge. Default 0.3. */
  stopPaddingAtrMult: number;
  /** Maximum stop width as ATR multiplier. Default 3.0. */
  maxStopAtrMult: number;
  /** Feed staleness threshold in ms. Default 5000. */
  feedStaleMs: number;
}

const DEFAULT_CONFIG: DecisionEngineConfig = {
  minLevelQuality: 50,
  minRouteQuality: 40,
  stopPaddingAtrMult: 0.3,
  maxStopAtrMult: 3.0,
  feedStaleMs: 5000,
};

// ── Decision Result ───────────────────────────────────────────────────────────

export interface DecisionResult {
  /** Trade intents that passed all checks. */
  intents: TradeIntent[];
  /** Blocked evaluations with reasons. */
  blocked: BlockedEvaluation[];
}

export interface BlockedEvaluation {
  watchId: string;
  levelLabel: string;
  reasons: string[];
}

// ── ID Generator ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextIntentId(): string {
  return `intent_${Date.now()}_${++_idCounter}`;
}

// ── Score Helpers ─────────────────────────────────────────────────────────────

function _clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Compute session/news quality score.
 * Prime = 90, Opening = 75, Reduced = 50, Pre-map = 20, Closed = 0.
 * News buffer penalizes by capping at 30.
 */
function _sessionScore(session: SessionContext | null): number {
  if (!session) return 50; // neutral when unknown

  let score: number;
  switch (session.windowLabel) {
    case 'prime':   score = 90; break;
    case 'opening': score = 75; break;
    case 'reduced': score = 50; break;
    case 'pre_map': score = 20; break;
    case 'closed':
    case 'outside': score = 0; break;
    default:        score = 50;
  }

  if (session.newsBuffer) {
    score = Math.min(score, 30);
  }

  // Penalize approaching close
  if (session.minutesUntilClose >= 0 && session.minutesUntilClose < 15) {
    score = Math.min(score, 35);
  }

  return score;
}

/**
 * Compute RR quality score.
 * RR 1.5 = 50, RR 2.0 = 70, RR 3.0 = 90, RR 4.0+ = 100.
 * Below 1.5 = linearly scaled 0–50.
 */
function _rrScore(rr: number): number {
  if (rr <= 0) return 0;
  if (rr < 1.5) return _clamp((rr / 1.5) * 50);
  if (rr < 2.0) return _clamp(50 + ((rr - 1.5) / 0.5) * 20); // 50–70
  if (rr < 3.0) return _clamp(70 + ((rr - 2.0) / 1.0) * 20); // 70–90
  return _clamp(90 + ((rr - 3.0) / 1.0) * 10); // 90–100
}

/**
 * Map TradeScoreBand to SetupGrade for backward compatibility.
 */
function _bandToGrade(band: TradeScoreBand): SetupGrade {
  switch (band) {
    case 'elite': return 'A';
    case 'A':     return 'A';
    case 'B':     return 'B';
    default:      return 'C';
  }
}

/**
 * Derive confidence label from score and confirmation strength.
 */
function _deriveConfidence(
  finalScore: number,
  confirmationTotal: number,
): 'high' | 'medium' | 'low' {
  if (finalScore >= 80 && confirmationTotal >= 75) return 'high';
  if (finalScore >= 65 && confirmationTotal >= 55) return 'medium';
  return 'low';
}

// ── Entry / Stop / Target Derivation ──────────────────────────────────────────

interface DerivedLevels {
  entry: number;
  stop: number;
  target: number;
  stopPoints: number;
  rr: number;
}

/**
 * Derive entry, stop, and target prices from the watch and its route.
 *
 * Entry: the watched level's price (where confirmation occurred).
 * Stop: opposite side of the entry level/zone + ATR padding, refined by
 *       nearby structural levels when available.
 * Target: route destination level price.
 *
 * Stop placement priority:
 *   1. Look for a valid structural level beyond the zone edge (opposite side
 *      of the trade). If found and within maxStopAtrMult * ATR, place stop
 *      just beyond it (the wider, safer option).
 *   2. Fall back to zone-edge + ATR padding (original behavior).
 *
 * @param watch     - Confirmed watch alert
 * @param atr       - Current ATR for padding
 * @param padding   - ATR multiplier for zone-edge stop padding (default 0.3)
 * @param allLevels - All active levels from the level map (optional, for
 *                    structure-based stop refinement)
 * @param maxStopAtr - Maximum stop distance in ATR multiples (default 3.0)
 */
function _deriveLevels(
  watch: WatchAlert,
  atr: number,
  padding: number,
  allLevels?: PriceLevel[],
  maxStopAtr = 3.0,
): DerivedLevels {
  const level = watch.level;
  const dest = watch.route.toLevel;
  const direction = watch.direction;
  const atrPad = atr * padding;

  // Entry = level price (where confirmation was detected)
  const entry = level.price;

  // ── Zone-edge stop (baseline — always computed) ─────────────────────
  let zoneEdgeStop: number;
  if (direction === 'long') {
    const zoneLow = level.priceHigh != null
      ? Math.min(level.price, level.priceHigh)
      : level.price;
    zoneEdgeStop = zoneLow - atrPad;
  } else {
    const zoneHigh = level.priceHigh != null
      ? Math.max(level.price, level.priceHigh)
      : level.price;
    zoneEdgeStop = zoneHigh + atrPad;
  }

  // ── Structure-based stop (refinement — when level map available) ────
  let stop = zoneEdgeStop;

  if (allLevels && allLevels.length > 0 && atr > 0) {
    const structureStop = _findStructureStop(
      entry, direction, allLevels, atr, maxStopAtr,
    );
    if (structureStop !== null) {
      // Use structure stop only if it is wider than zone-edge stop
      // (further from entry = safer, doesn't put stop inside the zone)
      if (direction === 'long') {
        stop = Math.min(stop, structureStop); // lower = wider for longs
      } else {
        stop = Math.max(stop, structureStop); // higher = wider for shorts
      }
    }
  }

  // ── Final clamp: stop never wider than maxStopAtr * ATR ─────────────
  const maxDist = maxStopAtr * atr;
  if (Math.abs(entry - stop) > maxDist) {
    stop = direction === 'long' ? entry - maxDist : entry + maxDist;
  }

  // Target = route destination level price
  const target = dest.price;

  const stopPoints = Math.abs(entry - stop);
  const targetPoints = Math.abs(target - entry);
  const rr = stopPoints > 0 ? targetPoints / stopPoints : 0;

  return { entry, stop, target, stopPoints, rr };
}

/**
 * Find a structure-based stop price by looking for the nearest valid
 * structural level on the opposite side of the entry.
 *
 * For LONG: find nearest active level below the entry zone.
 * For SHORT: find nearest active level above the entry zone.
 *
 * Returns null if no suitable structure found within range.
 */
function _findStructureStop(
  entry: number,
  direction: 'long' | 'short',
  allLevels: PriceLevel[],
  atr: number,
  maxStopAtr: number,
): number | null {
  const maxDist = maxStopAtr * atr;
  const structurePad = atr * 0.20; // padding beyond structure to survive wicks

  let bestLevel: PriceLevel | null = null;
  let bestDist = Infinity;

  for (const l of allLevels) {
    if (l.broken) continue;
    if (l.qualityScore < 50) continue; // only trust levels at minimum tradeable quality

    if (direction === 'long') {
      // Looking for support structure below entry
      if (l.price >= entry) continue;
      const dist = entry - l.price;
      if (dist > maxDist) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestLevel = l;
      }
    } else {
      // Looking for resistance structure above entry
      if (l.price <= entry) continue;
      const dist = l.price - entry;
      if (dist > maxDist) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestLevel = l;
      }
    }
  }

  if (!bestLevel) return null;

  // Place stop just beyond the structural level
  return direction === 'long'
    ? bestLevel.price - structurePad
    : bestLevel.price + structurePad;
}

// ── Advisory Targets ──────────────────────────────────────────────────────────
//
// Derives T2/T3 from the level map — strictly advisory, not used for execution.
// Finds the next 1–2 meaningful levels beyond the primary target in the trade
// direction, with minimum spacing to prevent clustering.

function _deriveAdvisoryTargets(
  primaryTarget: number,
  entry: number,
  direction: 'long' | 'short',
  allLevels: PriceLevel[] | undefined,
  atr: number,
): number[] {
  if (!allLevels || allLevels.length === 0) return [];

  const maxDist = atr * 5;                // max 5 ATR from entry
  const minSpacing = atr * 0.3;           // minimum gap between targets
  const candidates: { price: number; distFromT1: number }[] = [];

  for (const l of allLevels) {
    if (l.broken) continue;
    if (l.qualityScore < 50) continue;

    if (direction === 'long') {
      // Must be beyond T1 + minimum spacing
      if (l.price <= primaryTarget + minSpacing) continue;
      if (l.price - entry > maxDist) continue;
      candidates.push({ price: l.price, distFromT1: l.price - primaryTarget });
    } else {
      // Must be beyond T1 - minimum spacing (lower for short)
      if (l.price >= primaryTarget - minSpacing) continue;
      if (entry - l.price > maxDist) continue;
      candidates.push({ price: l.price, distFromT1: primaryTarget - l.price });
    }
  }

  // Sort by proximity to T1 (nearest first)
  candidates.sort((a, b) => a.distFromT1 - b.distFromT1);

  // Enforce minSpacing between consecutive advisory targets
  const result: number[] = [];
  let lastPrice = primaryTarget;
  for (const c of candidates) {
    if (Math.abs(c.price - lastPrice) < minSpacing) continue;
    result.push(c.price);
    lastPrice = c.price;
    if (result.length >= 2) break;
  }

  return result;
}

// ── Hard Blockers ─────────────────────────────────────────────────────────────

function _checkHardBlockers(
  watch: WatchAlert,
  data: NormalizedMarketData,
  session: SessionContext | null,
  derived: DerivedLevels,
  config: DecisionEngineConfig,
): string[] {
  const blocks: string[] = [];

  // Entry level quality
  if (watch.level.qualityScore < config.minLevelQuality) {
    blocks.push('level_degraded');
  }

  // Route quality
  if (watch.route.qualityScore < config.minRouteQuality) {
    blocks.push('route_quality_too_low');
  }

  // Destination unclear (broken or too low quality)
  if (watch.route.toLevel.broken || watch.route.toLevel.qualityScore < config.minLevelQuality) {
    blocks.push('no_valid_route');
  }

  // Feed staleness
  if (data.feedFreshnessMs != null && data.feedFreshnessMs > config.feedStaleMs) {
    blocks.push('feed_stale');
  }

  // Session closed
  if (session && (session.windowLabel === 'closed' || session.windowLabel === 'outside')) {
    blocks.push('session_closed');
  }

  // News buffer
  if (session?.newsBuffer) {
    blocks.push('news_buffer_active');
  }

  // Insufficient RR
  if (derived.rr < 1.5) {
    blocks.push('insufficient_rr');
  }

  // Stop too wide
  const atr = data.atr5m ?? 10;
  if (atr > 0 && derived.stopPoints > atr * config.maxStopAtrMult) {
    blocks.push('stop_too_wide');
  }

  // Confirmation too weak (shouldn't happen for confirmed watches, but defensive)
  if (watch.confirmationScore && watch.confirmationScore.total < 65) {
    blocks.push('confirmation_too_weak');
  }

  // Invalid market data
  if (!data.currentPrice || data.currentPrice <= 0) {
    blocks.push('invalid_market_data');
  }

  return blocks;
}

// ── Reason / Risk Generators ──────────────────────────────────────────────────

function _buildReasons(watch: WatchAlert, derived: DerivedLevels): string[] {
  const reasons: string[] = [];
  const level = watch.level;
  const dest = watch.route.toLevel;

  reasons.push(`${level.label} confirmed with score ${watch.confirmationScore?.total.toFixed(1) ?? '?'}`);
  reasons.push(`Route to ${dest.label} (${derived.rr.toFixed(1)}R)`);

  if (watch.route.intermediateObstacles.length === 0) {
    reasons.push('Clean path with no intermediate obstacles');
  }

  // Add strongest confirmation signal
  if (watch.confirmations.length > 0) {
    const strongest = watch.confirmations.reduce((a, b) => a.strength > b.strength ? a : b);
    reasons.push(`Key signal: ${strongest.description}`);
  }

  return reasons;
}

function _buildRisks(
  watch: WatchAlert,
  derived: DerivedLevels,
  session: SessionContext | null,
): string[] {
  const risks: string[] = [];

  if (watch.route.intermediateObstacles.length > 0) {
    risks.push(`${watch.route.intermediateObstacles.length} obstacle(s) in path`);
  }

  if (session?.isReduced) {
    risks.push('Reduced session window — lower follow-through expected');
  }

  if (derived.rr < 2.0) {
    risks.push(`RR is modest at ${derived.rr.toFixed(1)}`);
  }

  if (watch.level.touchCount >= 3) {
    risks.push(`Level tested ${watch.level.touchCount} times — may be weakening`);
  }

  return risks;
}

// ── Expected Path Description ─────────────────────────────────────────────────

function _buildExpectedPath(watch: WatchAlert, derived: DerivedLevels): string {
  const dir = watch.direction === 'long' ? 'up' : 'down';
  const from = watch.level.label;
  const to = watch.route.toLevel.label;
  return `Price expected to move ${dir} from ${from} to ${to} (${derived.rr.toFixed(1)}R, ${Math.abs(derived.target - derived.entry).toFixed(1)} pts)`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate confirmed watches and produce trade intents or block reasons.
 *
 * @param confirmedWatches - Watches in 'confirmed' state from the scheduler
 * @param data             - Current normalized market data
 * @param session          - Session context (or null for neutral session scoring)
 * @param account          - Account state for risk model validation
 * @param riskSettings     - Risk settings overrides (optional)
 * @param config           - Decision engine config overrides (optional)
 * @returns DecisionResult with intents and blocked evaluations.
 */
export function evaluateDecisions(
  confirmedWatches: WatchAlert[],
  data: NormalizedMarketData,
  session: SessionContext | null,
  account: AccountState,
  riskSettings?: Partial<RiskSettings>,
  config?: Partial<DecisionEngineConfig>,
  levelMap?: LevelMap | null,
): DecisionResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const intents: TradeIntent[] = [];
  const blocked: BlockedEvaluation[] = [];
  const atr = data.atr5m ?? 10;

  // Extract active levels for structure-based stop placement
  const allLevels = levelMap?.levels;

  for (const watch of confirmedWatches) {
    // Only process confirmed watches
    if (watch.state !== 'confirmed') continue;

    // ── Derive entry / stop / target ────────────────────────────────────
    const derived = _deriveLevels(watch, atr, cfg.stopPaddingAtrMult, allLevels, cfg.maxStopAtrMult);

    // ── Hard blockers ───────────────────────────────────────────────────
    const hardBlocks = _checkHardBlockers(watch, data, session, derived, cfg);
    if (hardBlocks.length > 0) {
      blocked.push({ watchId: watch.id, levelLabel: watch.level.label, reasons: hardBlocks });
      continue;
    }

    // ── Compute 5-component score ───────────────────────────────────────
    const levelScore = _clamp(watch.level.qualityScore);
    const routeScore = _clamp(watch.route.qualityScore);
    const confirmScore = _clamp(watch.confirmationScore?.total ?? 0);
    const sessScore = _clamp(_sessionScore(session));
    const rrScoreVal = _clamp(_rrScore(derived.rr));

    const finalScore = Math.round((
      (levelScore / 100) * 30 +
      (routeScore / 100) * 25 +
      (confirmScore / 100) * 20 +
      (sessScore / 100) * 10 +
      (rrScoreVal / 100) * 15
    ) * 100) / 100;

    const band = deriveScoreBand(finalScore);

    // ── Score threshold ─────────────────────────────────────────────────
    if (band === 'no_trade') {
      blocked.push({
        watchId: watch.id,
        levelLabel: watch.level.label,
        reasons: ['score_below_threshold'],
      });
      continue;
    }

    // ── Build preliminary intent for risk model ─────────────────────────
    const score: TradeScore = {
      final: finalScore,
      band,
      levelScore,
      routeScore,
      confirmationScore: confirmScore,
      sessionScore: sessScore,
      rrScore: rrScoreVal,
      weights: { level: 30, route: 25, confirmation: 20, session: 10, rr: 15 },
    };

    const intent: TradeIntent = {
      id: _nextIntentId(),
      symbol: data.symbol,
      side: watch.direction,
      entry: derived.entry,
      stop: derived.stop,
      target: derived.target,
      stopPoints: derived.stopPoints,
      riskRewardRatio: derived.rr,
      expectedPath: _buildExpectedPath(watch, derived),
      setupGrade: _bandToGrade(band),
      confidence: _deriveConfidence(finalScore, confirmScore),
      reasons: _buildReasons(watch, derived),
      risks: _buildRisks(watch, derived, session),
      score,
      entryLevel: watch.level,
      route: watch.route,
      watchId: watch.id,
      createdAt: Date.now(),
    };

    // ── Advisory targets (T2/T3) — informational only ──────────────────
    intent.additionalTargets = _deriveAdvisoryTargets(
      derived.target, derived.entry, watch.direction, allLevels, atr,
    );

    // ── Risk model validation ───────────────────────────────────────────
    const riskResult = validateRisk(intent, account, riskSettings, session);
    if (!riskResult.allowed) {
      blocked.push({
        watchId: watch.id,
        levelLabel: watch.level.label,
        reasons: riskResult.blockReasons,
      });
      continue;
    }

    // ── Reduced session downgrade ───────────────────────────────────────
    // In reduced window, downgrade B-band trades to no_trade
    if (session?.isReduced && band === 'B') {
      blocked.push({
        watchId: watch.id,
        levelLabel: watch.level.label,
        reasons: ['score_below_threshold'],
      });
      continue;
    }

    // ── All checks passed → emit intent ─────────────────────────────────
    intents.push(intent);
  }

  return { intents, blocked };
}
