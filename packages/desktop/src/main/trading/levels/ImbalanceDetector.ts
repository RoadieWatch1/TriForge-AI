// ── main/trading/levels/ImbalanceDetector.ts ─────────────────────────────────
//
// Detects Fair Value Gaps (FVGs) from 5m bar data.
//
// Bullish FVG: 3-candle pattern where bar[i+1].low > bar[i-1].high
//   → gap between bar[i-1] top and bar[i+1] bottom that price may return to fill.
//
// Bearish FVG: 3-candle pattern where bar[i+1].high < bar[i-1].low
//   → gap between bar[i-1] bottom and bar[i+1] top.
//
// Only returns unfilled gaps — gaps that subsequent price action has not
// yet closed.
//
// Pure function — no side effects, no state.

import type { NormalizedBar, PriceLevel, LevelQualityFactors } from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(): string {
  return `fvg_${Date.now()}_${++_idCounter}`;
}

function _defaultFactors(): LevelQualityFactors {
  return {
    displacementAway: 0,
    reactionStrength: 0,
    htfAlignment: 0,
    freshness: 100,
    imbalancePresent: 100, // FVG is itself an imbalance
    volumeSurge: 0,
    liquidityRelevance: 0,
    touchCountQuality: 100,
    recency: 50,
    structuralBreak: 0,
  };
}

// ── Core Detection ────────────────────────────────────────────────────────────

interface RawFvg {
  gapHigh: number;
  gapLow: number;
  midpoint: number;
  direction: 'bullish' | 'bearish';
  timestamp: number;
  gapSize: number;
}

/**
 * Scan bars for 3-candle FVG patterns.
 */
function _detectRawFvgs(bars: NormalizedBar[]): RawFvg[] {
  const fvgs: RawFvg[] = [];
  if (bars.length < 3) return fvgs;

  for (let i = 1; i < bars.length - 1; i++) {
    const prev = bars[i - 1];
    const next = bars[i + 1];

    // Bullish FVG: gap up — next candle's low is above prev candle's high
    if (next.low > prev.high) {
      const gapLow = prev.high;
      const gapHigh = next.low;
      fvgs.push({
        gapHigh,
        gapLow,
        midpoint: (gapHigh + gapLow) / 2,
        direction: 'bullish',
        timestamp: bars[i].timestamp,
        gapSize: gapHigh - gapLow,
      });
    }

    // Bearish FVG: gap down — next candle's high is below prev candle's low
    if (next.high < prev.low) {
      const gapHigh = prev.low;
      const gapLow = next.high;
      fvgs.push({
        gapHigh,
        gapLow,
        midpoint: (gapHigh + gapLow) / 2,
        direction: 'bearish',
        timestamp: bars[i].timestamp,
        gapSize: gapHigh - gapLow,
      });
    }
  }

  return fvgs;
}

/**
 * Check whether an FVG has been filled by subsequent price action.
 * A bullish FVG is filled if any bar after the FVG has low <= gapLow.
 * A bearish FVG is filled if any bar after the FVG has high >= gapHigh.
 */
function _isFilled(
  fvg: RawFvg,
  bars: NormalizedBar[],
  fvgBarIndex: number,
): boolean {
  // Check bars after the FVG's 3-candle pattern (start from i+2)
  for (let j = fvgBarIndex + 2; j < bars.length; j++) {
    if (fvg.direction === 'bullish' && bars[j].low <= fvg.gapLow) return true;
    if (fvg.direction === 'bearish' && bars[j].high >= fvg.gapHigh) return true;
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect unfilled Fair Value Gaps from 5m bars.
 *
 * @param bars5m - 5-minute normalized bars (sorted ascending by timestamp)
 * @returns Array of PriceLevel objects with type 'fvg'.
 *          Only unfilled gaps are returned.
 */
export function detectFairValueGaps(bars5m: NormalizedBar[]): PriceLevel[] {
  if (bars5m.length < 3) return [];

  const levels: PriceLevel[] = [];

  for (let i = 1; i < bars5m.length - 1; i++) {
    const prev = bars5m[i - 1];
    const next = bars5m[i + 1];

    let fvg: RawFvg | null = null;

    // Bullish FVG
    if (next.low > prev.high) {
      fvg = {
        gapHigh: next.low,
        gapLow: prev.high,
        midpoint: (next.low + prev.high) / 2,
        direction: 'bullish',
        timestamp: bars5m[i].timestamp,
        gapSize: next.low - prev.high,
      };
    }

    // Bearish FVG
    if (next.high < prev.low) {
      fvg = {
        gapHigh: prev.low,
        gapLow: next.high,
        midpoint: (prev.low + next.high) / 2,
        direction: 'bearish',
        timestamp: bars5m[i].timestamp,
        gapSize: prev.low - next.high,
      };
    }

    if (!fvg) continue;

    // Skip if this FVG has been filled by subsequent bars
    if (_isFilled(fvg, bars5m, i)) continue;

    levels.push({
      id: _nextId(),
      type: 'fvg',
      price: fvg.midpoint,
      priceHigh: fvg.gapHigh,
      strength: fvg.gapSize > 0 ? 'moderate' : 'weak',
      touchCount: 0,
      createdAt: fvg.timestamp,
      broken: false,
      label: fvg.direction === 'bullish'
        ? `Bullish FVG ${fvg.gapLow.toFixed(2)}–${fvg.gapHigh.toFixed(2)}`
        : `Bearish FVG ${fvg.gapLow.toFixed(2)}–${fvg.gapHigh.toFixed(2)}`,
      qualityScore: 0,
      grade: 'informational',
      qualityFactors: _defaultFactors(),
      sourceTimeframe: '5m',
      directionalBias: fvg.direction === 'bullish' ? 'long' : 'short',
    });
  }

  return levels;
}
