// ── main/trading/learning/SessionRegimeMemory.ts ───────────────────────────────
//
// Detects and labels the current session regime based on market structure
// and bar behavior heuristics. Stores lightweight recent regime history
// for use in decisions and council prompts.
//
// Regimes:
//   open_drive  — Strong directional move in the first 30 min (opening range breakout)
//   trend       — Sustained directional movement with higher highs / lower lows
//   range       — Oscillating between levels, no clear direction
//   reversal    — Market reversed direction after an initial move
//   expansion   — Sharp expansion in volatility / range beyond normal
//   drift       — Low volatility, narrow range, directionless grind
//
// Detection uses only currently available data (bars, HOD, LOD, trends)
// and is fully deterministic. No AI calls.
//
// SIMULATION ONLY. No real brokerage orders.

import type { NormalizedMarketData, NormalizedBar } from '@triforge/engine';

// ── Regime Types ────────────────────────────────────────────────────────────

export type SessionRegime =
  | 'open_drive'
  | 'trend'
  | 'range'
  | 'reversal'
  | 'expansion'
  | 'drift';

export interface RegimeSnapshot {
  regime: SessionRegime;
  confidence: number;    // 0–100
  detectedAt: number;    // ms epoch
  description: string;   // Human-readable
}

export interface RegimeContext {
  /** Current regime (most recently detected). */
  current: RegimeSnapshot | null;
  /** Previous regime (for transition detection). */
  previous: RegimeSnapshot | null;
  /** History of regimes detected this session (most recent first, max 10). */
  history: RegimeSnapshot[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_REGIME_HISTORY = 10;

/**
 * Minimum number of 5m bars needed before regime detection runs.
 * 6 bars = 30 minutes of data.
 */
const MIN_BARS_FOR_DETECTION = 6;

/**
 * Fraction of session range relative to ATR that constitutes "expansion".
 * If day range > 2.5x ATR → expansion.
 */
const EXPANSION_ATR_MULTIPLE = 2.5;

/**
 * Fraction of session range relative to ATR below which we call "drift".
 * If day range < 0.6x ATR → drift.
 */
const DRIFT_ATR_MULTIPLE = 0.6;

/**
 * Percentage of day range that must be consumed by the opening 30 min
 * to qualify as open_drive. 60% = the open drove most of the day's range.
 */
const OPEN_DRIVE_RANGE_THRESHOLD = 0.6;

// ── Detector ────────────────────────────────────────────────────────────────

export class SessionRegimeMemory {
  private _history: RegimeSnapshot[] = [];

  /**
   * Detect the current session regime based on market data.
   * Should be called once per eval tick. Deduplicates consecutive
   * identical regimes (only records transitions).
   *
   * @param data - Normalized market data from the provider.
   * @returns The current RegimeContext.
   */
  detect(data: NormalizedMarketData): RegimeContext {
    const bars = data.bars5m;

    if (bars.length < MIN_BARS_FOR_DETECTION) {
      return this._buildContext();
    }

    const atr = data.atr5m ?? this._estimateATR(bars);
    if (atr <= 0) return this._buildContext();

    const dayRange = data.highOfDay - data.lowOfDay;
    const now = Date.now();

    // Run detection heuristics (ordered by specificity)
    const regime = this._classify(data, bars, atr, dayRange);

    // Only record if regime changed from the most recent
    const lastRegime = this._history.length > 0 ? this._history[0].regime : null;
    if (regime.regime !== lastRegime) {
      this._history = [regime, ...this._history].slice(0, MAX_REGIME_HISTORY);
    } else {
      // Update the confidence/description of the current regime
      if (this._history.length > 0) {
        this._history[0] = regime;
      }
    }

    return this._buildContext();
  }

  /**
   * Get the current regime context without re-detecting.
   */
  getContext(): RegimeContext {
    return this._buildContext();
  }

  /**
   * Reset all regime history (e.g. on session reset).
   */
  reset(): void {
    this._history = [];
  }

  // ── Classification Logic ──────────────────────────────────────────────

  private _classify(
    data: NormalizedMarketData,
    bars: NormalizedBar[],
    atr: number,
    dayRange: number,
  ): RegimeSnapshot {
    const now = Date.now();

    // 1. Expansion — day range far exceeds normal ATR
    if (dayRange > atr * EXPANSION_ATR_MULTIPLE) {
      return {
        regime: 'expansion',
        confidence: Math.min(90, 60 + (dayRange / atr - EXPANSION_ATR_MULTIPLE) * 20),
        detectedAt: now,
        description: `Day range ${dayRange.toFixed(1)} pts exceeds ${EXPANSION_ATR_MULTIPLE}x ATR (${atr.toFixed(1)}) — expansion day`,
      };
    }

    // 2. Drift — day range much smaller than normal ATR
    if (dayRange < atr * DRIFT_ATR_MULTIPLE) {
      return {
        regime: 'drift',
        confidence: Math.min(85, 50 + (1 - dayRange / (atr * DRIFT_ATR_MULTIPLE)) * 40),
        detectedAt: now,
        description: `Day range ${dayRange.toFixed(1)} pts is below ${DRIFT_ATR_MULTIPLE}x ATR (${atr.toFixed(1)}) — drift/low volatility`,
      };
    }

    // 3. Open drive — check if opening bars drove most of the day's range
    const openDrive = this._detectOpenDrive(bars, data, dayRange);
    if (openDrive) return openDrive;

    // 4. Reversal — check if trend reversed after initial move
    const reversal = this._detectReversal(bars, data);
    if (reversal) return reversal;

    // 5. Trend — sustained directional movement
    const trend = this._detectTrend(data, bars);
    if (trend) return trend;

    // 6. Default: Range
    return {
      regime: 'range',
      confidence: 60,
      detectedAt: now,
      description: `Price oscillating within ${dayRange.toFixed(1)} pt range — range-bound session`,
    };
  }

  private _detectOpenDrive(
    bars: NormalizedBar[],
    data: NormalizedMarketData,
    dayRange: number,
  ): RegimeSnapshot | null {
    // Only applicable in the first ~12 bars (60 min)
    if (bars.length > 12) return null;
    if (dayRange <= 0) return null;

    // Take the first 6 bars (30 min) and measure their range
    const openBars = bars.slice(0, Math.min(6, bars.length));
    if (openBars.length < 3) return null;

    const openHigh = Math.max(...openBars.map(b => b.high));
    const openLow = Math.min(...openBars.map(b => b.low));
    const openRange = openHigh - openLow;

    if (openRange / dayRange >= OPEN_DRIVE_RANGE_THRESHOLD) {
      const direction = data.currentPrice > (openBars[0].open + openBars[openBars.length - 1].close) / 2
        ? 'bullish' : 'bearish';
      return {
        regime: 'open_drive',
        confidence: Math.min(90, 65 + (openRange / dayRange) * 30),
        detectedAt: Date.now(),
        description: `${direction} open drive — opening 30m covered ${Math.round(openRange / dayRange * 100)}% of day range`,
      };
    }

    return null;
  }

  private _detectReversal(
    bars: NormalizedBar[],
    data: NormalizedMarketData,
  ): RegimeSnapshot | null {
    if (bars.length < 8) return null;

    // Split bars into first half and second half
    const mid = Math.floor(bars.length / 2);
    const firstHalf = bars.slice(0, mid);
    const secondHalf = bars.slice(mid);

    const firstMove = firstHalf[firstHalf.length - 1].close - firstHalf[0].open;
    const secondMove = secondHalf[secondHalf.length - 1].close - secondHalf[0].open;

    // Reversal: significant move in one direction, then significant move back
    const firstMag = Math.abs(firstMove);
    const secondMag = Math.abs(secondMove);

    // Both moves must be meaningful and in opposite directions
    if (firstMag > 0 && secondMag > 0 &&
        Math.sign(firstMove) !== Math.sign(secondMove) &&
        secondMag >= firstMag * 0.5) {
      const from = firstMove > 0 ? 'bullish' : 'bearish';
      const to = secondMove > 0 ? 'bullish' : 'bearish';
      return {
        regime: 'reversal',
        confidence: Math.min(85, 55 + (secondMag / firstMag) * 25),
        detectedAt: Date.now(),
        description: `Reversal from ${from} to ${to} — initial move ${firstMove > 0 ? '+' : ''}${firstMove.toFixed(1)} pts then ${secondMove > 0 ? '+' : ''}${secondMove.toFixed(1)} pts`,
      };
    }

    return null;
  }

  private _detectTrend(
    data: NormalizedMarketData,
    bars: NormalizedBar[],
  ): RegimeSnapshot | null {
    // Both timeframe trends must agree
    if (data.trend5m === data.trend15m && (data.trend5m === 'up' || data.trend5m === 'down')) {
      // Verify with bar structure: count higher highs / lower lows
      const direction = data.trend5m;
      let confirmCount = 0;
      for (let i = 1; i < bars.length; i++) {
        if (direction === 'up' && bars[i].high > bars[i - 1].high) confirmCount++;
        if (direction === 'down' && bars[i].low < bars[i - 1].low) confirmCount++;
      }

      const confirmRatio = confirmCount / (bars.length - 1);
      if (confirmRatio >= 0.55) {
        return {
          regime: 'trend',
          confidence: Math.min(90, 55 + confirmRatio * 40),
          detectedAt: Date.now(),
          description: `${direction === 'up' ? 'Bullish' : 'Bearish'} trend — ${Math.round(confirmRatio * 100)}% of bars confirm ${direction} structure`,
        };
      }
    }

    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private _buildContext(): RegimeContext {
    return {
      current: this._history.length > 0 ? this._history[0] : null,
      previous: this._history.length > 1 ? this._history[1] : null,
      history: [...this._history],
    };
  }

  private _estimateATR(bars: NormalizedBar[], period = 14): number {
    if (bars.length < 2) return 0;
    const count = Math.min(period, bars.length - 1);
    let sum = 0;
    for (let i = bars.length - count; i < bars.length; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      );
      sum += tr;
    }
    return sum / count;
  }
}
