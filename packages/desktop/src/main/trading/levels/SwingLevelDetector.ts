// ── main/trading/levels/SwingLevelDetector.ts ────────────────────────────────
//
// Detects swing highs and swing lows from 5m and 15m bar arrays.
// A swing high is a bar whose high exceeds all neighbors within a lookback window.
// A swing low is a bar whose low is below all neighbors within a lookback window.
//
// Multi-timeframe: detects on both 5m and 15m, deduplicates within tolerance.
// Pure function — no side effects, no state.

import type { NormalizedBar, PriceLevel, LevelQualityFactors } from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

/** Default quality factors — placeholder until LevelScorer scores them in Phase 3. */
function _defaultFactors(): LevelQualityFactors {
  return {
    displacementAway: 0,
    reactionStrength: 0,
    htfAlignment: 0,
    freshness: 100,  // untested = fresh
    imbalancePresent: 0,
    volumeSurge: 0,
    liquidityRelevance: 0,
    touchCountQuality: 100, // 1 touch = pristine
    recency: 50,
    structuralBreak: 0,
  };
}

/** Compute a simple ATR proxy from bars (average true range over last N bars). */
function _simpleAtr(bars: NormalizedBar[], period = 14): number {
  if (bars.length < 2) return 0;
  const start = Math.max(0, bars.length - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < bars.length; i++) {
    const tr = bars[i].high - bars[i].low;
    sum += tr;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// ── Core Detection ────────────────────────────────────────────────────────────

interface RawSwing {
  price: number;
  type: 'swing_high' | 'swing_low';
  timestamp: number;
  timeframe: '1m' | '5m' | '15m';
}

/**
 * Detect swing highs and lows in a single bar array.
 * A swing high at index i requires: bars[i].high > bars[j].high for all j in
 * [i - lookback, i + lookback] where j !== i.
 * Symmetric logic for swing lows.
 */
function _detectSwings(
  bars: NormalizedBar[],
  lookback: number,
): RawSwing[] {
  const swings: RawSwing[] = [];
  if (bars.length < lookback * 2 + 1) return swings;

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      swings.push({
        price: bars[i].high,
        type: 'swing_high',
        timestamp: bars[i].timestamp,
        timeframe: bars[i].timeframe,
      });
    }
    if (isLow) {
      swings.push({
        price: bars[i].low,
        type: 'swing_low',
        timestamp: bars[i].timestamp,
        timeframe: bars[i].timeframe,
      });
    }
  }

  return swings;
}

/**
 * Deduplicate swing points that are within `tolerance` of each other.
 * When two are close, keep the one from the higher timeframe, or if same
 * timeframe, keep the more recent.
 */
function _deduplicateSwings(swings: RawSwing[], tolerance: number): RawSwing[] {
  if (swings.length === 0) return [];

  // Sort by price for clustering
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const kept: RawSwing[] = [];

  let i = 0;
  while (i < sorted.length) {
    // Collect cluster of swings within tolerance of the first
    const cluster: RawSwing[] = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && Math.abs(sorted[j].price - sorted[i].price) <= tolerance) {
      // Only cluster same-type swings
      if (sorted[j].type === sorted[i].type) {
        cluster.push(sorted[j]);
      }
      j++;
    }

    // Pick the best from the cluster
    const tfRank = (tf: string) => (tf === '15m' ? 2 : tf === '5m' ? 1 : 0);
    cluster.sort((a, b) => {
      const tfDiff = tfRank(b.timeframe) - tfRank(a.timeframe);
      if (tfDiff !== 0) return tfDiff;
      return b.timestamp - a.timestamp; // more recent wins
    });
    kept.push(cluster[0]);

    // Advance past all items that were within tolerance of sorted[i]
    // (including different-type swings we skipped)
    i = j;
  }

  return kept;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect swing highs and swing lows from 5m and 15m bar arrays.
 *
 * @param bars5m  - 5-minute normalized bars (sorted ascending by timestamp)
 * @param bars15m - 15-minute normalized bars (sorted ascending by timestamp)
 * @param lookback - Number of bars on each side to compare (default: 5)
 * @returns Array of PriceLevel objects with type 'swing_high' or 'swing_low'.
 *          Quality factors are defaults — LevelScorer will refine in Phase 3.
 */
export function detectSwingLevels(
  bars5m: NormalizedBar[],
  bars15m: NormalizedBar[],
  lookback = 5,
): PriceLevel[] {
  const swings5m = _detectSwings(bars5m, lookback);
  const swings15m = _detectSwings(bars15m, lookback);
  const allSwings = [...swings5m, ...swings15m];

  // Deduplicate within ATR*0.2 tolerance
  const atr = _simpleAtr(bars5m) || _simpleAtr(bars15m) || 1;
  const tolerance = atr * 0.2;
  const deduped = _deduplicateSwings(allSwings, tolerance);

  const now = Date.now();
  return deduped.map((s): PriceLevel => ({
    id: _nextId(s.type),
    type: s.type,
    price: s.price,
    strength: s.timeframe === '15m' ? 'strong' : 'moderate',
    touchCount: 1,
    createdAt: s.timestamp,
    broken: false,
    label: s.type === 'swing_high'
      ? `Swing High ${s.price.toFixed(2)} (${s.timeframe})`
      : `Swing Low ${s.price.toFixed(2)} (${s.timeframe})`,
    qualityScore: 0,  // LevelScorer will set this
    grade: 'informational',
    qualityFactors: _defaultFactors(),
    sourceTimeframe: s.timeframe,
    directionalBias: s.type === 'swing_high' ? 'short' : 'long',
  }));
}

// ── Break of Structure Detection ──────────────────────────────────────────────

/**
 * A detected break of market structure.
 * Bullish BOS = price broke above a prior swing high (higher high formed).
 * Bearish BOS = price broke below a prior swing low (lower low formed).
 */
export interface BreakOfStructure {
  /** Direction of the break. */
  direction: 'bullish' | 'bearish';
  /** Price of the swing point that was broken. */
  brokenSwingPrice: number;
  /** Timestamp of the bar that broke through the swing. */
  breakTimestamp: number;
  /** Close price of the bar that confirmed the break. */
  breakPrice: number;
}

/**
 * Detect breaks of market structure from bar data.
 *
 * Algorithm:
 *   1. Detect swing highs/lows on the given timeframe bars
 *   2. Walk forward through bars, tracking the most recent swing high and low
 *   3. When a bar's close exceeds the most recent swing high → bullish BOS
 *   4. When a bar's close drops below the most recent swing low → bearish BOS
 *   5. Only return BOS events from the last 4 hours (session relevance)
 *
 * @param bars5m  - 5-minute bars (primary)
 * @param bars15m - 15-minute bars (for stronger structure)
 * @param lookback - Swing detection lookback (default 5)
 * @returns Array of BOS events, most recent first.
 */
export function detectBreaksOfStructure(
  bars5m: NormalizedBar[],
  bars15m: NormalizedBar[],
  lookback = 5,
): BreakOfStructure[] {
  const results: BreakOfStructure[] = [];
  const maxAge = 4 * 60 * 60_000; // 4 hours
  const now = Date.now();
  const cutoff = now - maxAge;

  // Detect swings on both timeframes for richer structure
  const swings5m = _detectSwings(bars5m, lookback);
  const swings15m = _detectSwings(bars15m, lookback);
  const allSwings = [...swings5m, ...swings15m].sort((a, b) => a.timestamp - b.timestamp);

  if (allSwings.length < 2) return results;

  // Walk through swings and bars to detect breaks.
  // We use the 5m bars as the price sequence since they have finer resolution.
  let lastSwingHigh: RawSwing | null = null;
  let lastSwingLow: RawSwing | null = null;
  // Track which swing prices have already produced a BOS to avoid duplicates
  const brokenPrices = new Set<string>();

  // Initialize from the first few swings
  for (const sw of allSwings) {
    if (sw.type === 'swing_high') lastSwingHigh = sw;
    else lastSwingLow = sw;
    if (lastSwingHigh && lastSwingLow) break;
  }

  if (!lastSwingHigh || !lastSwingLow) return results;

  // Now scan bars for breaks of the tracked swing points
  for (const bar of bars5m) {
    // Update tracked swings as new swing points are reached
    for (const sw of allSwings) {
      if (sw.timestamp > bar.timestamp) break;
      if (sw.timestamp <= bar.timestamp) {
        if (sw.type === 'swing_high' && sw.price > (lastSwingHigh?.price ?? 0)) {
          lastSwingHigh = sw;
        }
        if (sw.type === 'swing_low' && sw.price < (lastSwingLow?.price ?? Infinity)) {
          lastSwingLow = sw;
        }
      }
    }

    // Skip bars that are too old for relevance
    if (bar.timestamp < cutoff) continue;

    // Check for bullish BOS: bar closes above the most recent swing high
    if (lastSwingHigh && bar.close > lastSwingHigh.price) {
      const key = `bullish_${lastSwingHigh.price.toFixed(2)}`;
      if (!brokenPrices.has(key)) {
        brokenPrices.add(key);
        results.push({
          direction: 'bullish',
          brokenSwingPrice: lastSwingHigh.price,
          breakTimestamp: bar.timestamp,
          breakPrice: bar.close,
        });
      }
    }

    // Check for bearish BOS: bar closes below the most recent swing low
    if (lastSwingLow && bar.close < lastSwingLow.price) {
      const key = `bearish_${lastSwingLow.price.toFixed(2)}`;
      if (!brokenPrices.has(key)) {
        brokenPrices.add(key);
        results.push({
          direction: 'bearish',
          brokenSwingPrice: lastSwingLow.price,
          breakTimestamp: bar.timestamp,
          breakPrice: bar.close,
        });
      }
    }
  }

  // Most recent first
  results.sort((a, b) => b.breakTimestamp - a.breakTimestamp);
  return results;
}
