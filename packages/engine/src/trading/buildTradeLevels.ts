// ── engine/src/trading/buildTradeLevels.ts ────────────────────────────────────
//
// Proposes entry / stop / target levels from a live snapshot.
// Detects the most likely setup type based on price position within the day's
// range and session trend, then returns concrete price levels the user can
// accept, adjust, or ignore.
//
// Setup taxonomy (v1):
//   breakout_long    — price near HOD, trend=up → buy the break
//   breakout_short   — price near LOD, trend=down → sell the break
//   pullback_long    — trend=up, price mid-range → buy the dip
//   pullback_short   — trend=down, price mid-range → sell the bounce
//   reversal_long    — trend=up but price near LOD → failed breakdown / reclaim
//   reversal_short   — trend=down but price near HOD → failed breakout
//   none             — insufficient data or range too narrow to classify

import type { LiveTradeSnapshot } from './types';
import { INSTRUMENT_META } from './buildLiveTradeAdvice';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SetupType =
  | 'breakout_long'
  | 'breakout_short'
  | 'pullback_long'
  | 'pullback_short'
  | 'reversal_long'
  | 'reversal_short'
  | 'none';

export interface ProposedTradeSetup {
  setupType: SetupType;
  side: 'long' | 'short' | null;
  entry?: number;
  stop?: number;
  target?: number;
  stopPoints?: number;
  /** Human-readable description of why this setup was detected. */
  thesis: string;
  confidence: 'low' | 'medium' | 'high';
}

// ── Default stop distances per instrument (points) ────────────────────────────

const DEFAULT_STOP_POINTS: Record<string, number> = {
  NQ:  15,
  MNQ: 15,
  ES:   5,
  MES:  5,
  RTY:  8,
  M2K:  8,
  CL:   0.5,
  GC:   5,
};

function stopFor(symbol: string, atr5m?: number): number {
  if (atr5m != null) {
    const meta = INSTRUMENT_META[symbol.toUpperCase()];
    const minStop = meta ? meta.tickSize * 3 : 0.75;
    return Math.max(atr5m * 1.5, minStop);
  }
  return DEFAULT_STOP_POINTS[symbol.toUpperCase()] ?? 10;
}

function round(v: number, tickSize: number): number {
  return Math.round(v / tickSize) * tickSize;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function buildTradeLevels(
  snapshot: LiveTradeSnapshot,
  symbol: string,
): ProposedTradeSetup {
  const sym  = symbol.toUpperCase();
  const meta = INSTRUMENT_META[sym];
  const tick = meta?.tickSize ?? 0.25;
  const N    = stopFor(sym, snapshot.atr5m);
  const usingATR = snapshot.atr5m != null;

  const NONE: ProposedTradeSetup = {
    setupType: 'none',
    side: null,
    thesis: 'Insufficient price data to propose levels.',
    confidence: 'low',
  };

  const price = snapshot.lastPrice;
  const hod   = snapshot.highOfDay;
  const lod   = snapshot.lowOfDay;
  const trend = snapshot.trend;

  if (!price || !hod || !lod) return NONE;

  // ATR sanity: reject if ATR-based stop is unreliable
  if (usingATR && meta) {
    if (N < meta.tickSize * 3) {
      return { setupType: 'none', side: null, thesis: 'ATR-based stop too tight for reliable execution.', confidence: 'low' };
    }
    if (N / price > 0.05) {
      return { setupType: 'none', side: null, thesis: 'ATR-based stop exceeds 5% of price — volatility too extreme.', confidence: 'low' };
    }
  }

  const range = hod - lod;
  // Require at least 2× the stop distance of range to be meaningful
  if (range < N * 2) {
    return {
      setupType: 'none',
      side: null,
      thesis: `Day range (${range.toFixed(2)} pts) is too narrow to classify a setup reliably.`,
      confidence: 'low',
    };
  }

  const pos = (price - lod) / range; // 0 = at LOD, 1 = at HOD
  const vwapCtx = snapshot.vwapRelation;
  const stopLabel = usingATR ? `${N.toFixed(2)} pts (1.5×ATR)` : `${N} pts`;

  // ── Breakout long: price near HOD + uptrend ────────────────────────────────
  if (pos >= 0.78 && (trend === 'up' || trend === 'range')) {
    const entry  = round(price, tick);
    const stop   = round(entry - N, tick);
    const target = round(entry + N * 2, tick);
    return {
      setupType:  'breakout_long',
      side:       'long',
      entry, stop, target,
      stopPoints: N,
      thesis:     `Breakout long — ${sym} pressing HOD (${hod}), ${trend === 'up' ? 'bullish' : 'neutral'} trend. Stop ${stopLabel}, target 2:1 at ${target}.`,
      confidence: trend === 'up' ? 'high' : 'medium',
    };
  }

  // ── Breakout short: price near LOD + downtrend ─────────────────────────────
  if (pos <= 0.22 && (trend === 'down' || trend === 'range')) {
    const entry  = round(price, tick);
    const stop   = round(entry + N, tick);
    const target = round(entry - N * 2, tick);
    return {
      setupType:  'breakout_short',
      side:       'short',
      entry, stop, target,
      stopPoints: N,
      thesis:     `Breakout short — ${sym} pressing LOD (${lod}), ${trend === 'down' ? 'bearish' : 'neutral'} trend. Stop ${stopLabel}, target 2:1 at ${target}.`,
      confidence: trend === 'down' ? 'high' : 'medium',
    };
  }

  // ── Pullback long: uptrend, price in mid range (consolidating) ─────────────
  if (trend === 'up' && pos >= 0.35 && pos <= 0.65) {
    const entry  = round(price, tick);
    const stop   = round(entry - N, tick);
    // ATR-aware target: use 2.5×ATR when available, else HOD + N
    const target = usingATR
      ? round(entry + snapshot.atr5m! * 2.5, tick)
      : round(hod + N, tick);
    // VWAP-aware confidence upgrade
    const vwapSupports = vwapCtx === 'at' || vwapCtx === 'above';
    const vwapNote = vwapCtx ? `, VWAP ${vwapCtx}` : '';
    return {
      setupType:  'pullback_long',
      side:       'long',
      entry, stop, target,
      stopPoints: N,
      thesis:     `Pullback long — ${sym} mid-range (${(pos * 100).toFixed(0)}%), uptrend. Stop ${stopLabel}${vwapNote}, target at ${target}.`,
      confidence: vwapSupports ? 'high' : 'medium',
    };
  }

  // ── Pullback short: downtrend, price in mid range (bouncing) ──────────────
  if (trend === 'down' && pos >= 0.35 && pos <= 0.65) {
    const entry  = round(price, tick);
    const stop   = round(entry + N, tick);
    const target = usingATR
      ? round(entry - snapshot.atr5m! * 2.5, tick)
      : round(lod - N, tick);
    const vwapSupports = vwapCtx === 'at' || vwapCtx === 'below';
    const vwapNote = vwapCtx ? `, VWAP ${vwapCtx}` : '';
    return {
      setupType:  'pullback_short',
      side:       'short',
      entry, stop, target,
      stopPoints: N,
      thesis:     `Pullback short — ${sym} mid-range (${(pos * 100).toFixed(0)}%), downtrend. Stop ${stopLabel}${vwapNote}, target at ${target}.`,
      confidence: vwapSupports ? 'high' : 'medium',
    };
  }

  // ── Reversal long: uptrend but price near LOD (failed breakdown) ───────────
  if (trend === 'up' && pos < 0.28) {
    const entry  = round(price, tick);
    const stop   = round(lod - N * 0.5, tick);
    const target = round(entry + N * 2, tick);
    return {
      setupType:  'reversal_long',
      side:       'long',
      entry, stop, target,
      stopPoints: N,
      thesis:     `Reversal long — ${sym} has a bullish session trend but price is near the low of day. Potential failed breakdown / reclaim setup. Tight stop just below LOD, target at ${target}.`,
      confidence: 'medium',
    };
  }

  // ── Reversal short: downtrend but price near HOD (failed breakout) ─────────
  if (trend === 'down' && pos > 0.72) {
    const entry  = round(price, tick);
    const stop   = round(hod + N * 0.5, tick);
    const target = round(entry - N * 2, tick);
    return {
      setupType:  'reversal_short',
      side:       'short',
      entry, stop, target,
      stopPoints: N,
      thesis:     `Reversal short — ${sym} has a bearish session trend but price is near the high of day. Potential failed breakout setup. Stop just above HOD, target at ${target}.`,
      confidence: 'medium',
    };
  }

  // ── No clear setup ─────────────────────────────────────────────────────────
  return {
    setupType:  'none',
    side:       null,
    thesis:     `No clean setup detected on ${sym} (trend: ${trend ?? 'unknown'}, position: ${(pos * 100).toFixed(0)}% of range). Wait for price to approach HOD/LOD or trend to clarify.`,
    confidence: 'low',
  };
}
