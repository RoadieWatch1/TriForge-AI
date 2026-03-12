// ── main/trading/levels/SupplyDemandDetector.ts ──────────────────────────────
//
// Detects supply and demand zones from 5m bar data.
//
// Supply zone: consolidation (3+ bars with range < 0.5*ATR) followed by a
//   strong bearish displacement candle (body > 1.5x average body).
//   The consolidation area becomes a supply zone (price rallied back here = sell).
//
// Demand zone: consolidation followed by a strong bullish displacement candle.
//   The consolidation area becomes a demand zone (price dropped back here = buy).
//
// Pure function — no side effects, no state.

import type { NormalizedBar, PriceLevel, LevelQualityFactors } from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(): string {
  return `sd_${Date.now()}_${++_idCounter}`;
}

function _defaultFactors(): LevelQualityFactors {
  return {
    displacementAway: 0,
    reactionStrength: 0,
    htfAlignment: 0,
    freshness: 100,
    imbalancePresent: 0,
    volumeSurge: 0,
    liquidityRelevance: 0,
    touchCountQuality: 100,
    recency: 50,
    structuralBreak: 0,
  };
}

function _simpleAtr(bars: NormalizedBar[], period = 14): number {
  if (bars.length < 2) return 0;
  const start = Math.max(0, bars.length - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < bars.length; i++) {
    sum += bars[i].high - bars[i].low;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function _bodySize(bar: NormalizedBar): number {
  return Math.abs(bar.close - bar.open);
}

function _isBullish(bar: NormalizedBar): boolean {
  return bar.close > bar.open;
}

// ── Core Detection ────────────────────────────────────────────────────────────

interface ConsolidationRange {
  startIdx: number;
  endIdx: number;
  high: number;
  low: number;
  midpoint: number;
}

/**
 * Find consolidation clusters: runs of 3+ consecutive bars where each bar's
 * range is below rangeThreshold.
 */
function _findConsolidations(
  bars: NormalizedBar[],
  rangeThreshold: number,
  minBars = 3,
): ConsolidationRange[] {
  const ranges: ConsolidationRange[] = [];
  let runStart = -1;

  for (let i = 0; i < bars.length; i++) {
    const range = bars[i].high - bars[i].low;
    if (range < rangeThreshold) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1 && i - runStart >= minBars) {
        let high = -Infinity;
        let low = Infinity;
        for (let j = runStart; j < i; j++) {
          if (bars[j].high > high) high = bars[j].high;
          if (bars[j].low < low) low = bars[j].low;
        }
        ranges.push({
          startIdx: runStart,
          endIdx: i - 1,
          high,
          low,
          midpoint: (high + low) / 2,
        });
      }
      runStart = -1;
    }
  }

  // Handle trailing consolidation
  if (runStart !== -1 && bars.length - runStart >= minBars) {
    let high = -Infinity;
    let low = Infinity;
    for (let j = runStart; j < bars.length; j++) {
      if (bars[j].high > high) high = bars[j].high;
      if (bars[j].low < low) low = bars[j].low;
    }
    ranges.push({
      startIdx: runStart,
      endIdx: bars.length - 1,
      high,
      low,
      midpoint: (high + low) / 2,
    });
  }

  return ranges;
}

/**
 * Compute average body size over last N bars for displacement threshold.
 */
function _avgBodySize(bars: NormalizedBar[], count = 20): number {
  const start = Math.max(0, bars.length - count);
  let sum = 0;
  let n = 0;
  for (let i = start; i < bars.length; i++) {
    sum += _bodySize(bars[i]);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect supply and demand zones from 5m bars.
 *
 * @param bars5m - 5-minute normalized bars (sorted ascending by timestamp)
 * @param atrOverride - Optional ATR value. If not provided, computed from bars.
 * @returns Array of PriceLevel objects with type 'supply' or 'demand'.
 */
export function detectSupplyDemandZones(
  bars5m: NormalizedBar[],
  atrOverride?: number,
): PriceLevel[] {
  if (bars5m.length < 10) return [];

  const atr = atrOverride ?? _simpleAtr(bars5m);
  if (atr <= 0) return [];

  const rangeThreshold = atr * 0.5;
  const consolidations = _findConsolidations(bars5m, rangeThreshold);
  const avgBody = _avgBodySize(bars5m);
  const displacementThreshold = avgBody * 1.5;

  const levels: PriceLevel[] = [];

  for (const consol of consolidations) {
    // Look at the bar immediately after the consolidation
    const nextIdx = consol.endIdx + 1;
    if (nextIdx >= bars5m.length) continue;

    const displacementBar = bars5m[nextIdx];
    const body = _bodySize(displacementBar);

    if (body < displacementThreshold) continue;

    const bullish = _isBullish(displacementBar);

    if (bullish) {
      // Displacement was upward → consolidation is a demand zone
      levels.push({
        id: _nextId(),
        type: 'demand',
        price: consol.midpoint,
        priceHigh: consol.high,
        strength: body > avgBody * 2.5 ? 'strong' : 'moderate',
        touchCount: 0,
        createdAt: bars5m[consol.startIdx].timestamp,
        broken: false,
        label: `Demand Zone ${consol.low.toFixed(2)}–${consol.high.toFixed(2)}`,
        qualityScore: 0,
        grade: 'informational',
        qualityFactors: {
          ..._defaultFactors(),
          // Pre-fill displacement factor based on displacement candle size
          displacementAway: Math.min(100, (body / atr) * 50),
        },
        sourceTimeframe: '5m',
        directionalBias: 'long',
      });
    } else {
      // Displacement was downward → consolidation is a supply zone
      levels.push({
        id: _nextId(),
        type: 'supply',
        price: consol.midpoint,
        priceHigh: consol.high,
        strength: body > avgBody * 2.5 ? 'strong' : 'moderate',
        touchCount: 0,
        createdAt: bars5m[consol.startIdx].timestamp,
        broken: false,
        label: `Supply Zone ${consol.low.toFixed(2)}–${consol.high.toFixed(2)}`,
        qualityScore: 0,
        grade: 'informational',
        qualityFactors: {
          ..._defaultFactors(),
          displacementAway: Math.min(100, (body / atr) * 50),
        },
        sourceTimeframe: '5m',
        directionalBias: 'short',
      });
    }
  }

  return levels;
}
