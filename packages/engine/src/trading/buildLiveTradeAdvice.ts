// ── engine/src/trading/buildLiveTradeAdvice.ts ────────────────────────────────
//
// Pure, synchronous rule engine for live futures trade advice.
// No AI call — verdicts are instant and deterministic.
// Designed to run before an optional Council review pass.
//
// Supported symbols (v1): NQ, MNQ, ES, MES
// Sizing is advisory only — no live orders.

// ── Public types ──────────────────────────────────────────────────────────────

import type { LiveTradeSnapshot } from './types';
import { SHADOW_SUPPORTED_SYMBOLS } from './types';
export type { LiveTradeSnapshot } from './types';

export type TradeAdviceVerdict =
  | 'buy'
  | 'wait'
  | 'skip'
  | 'reduce_size'
  | 'missing_confirmation';

export type TradeAdviceConfidence = 'low' | 'medium' | 'high';

export interface TradeAdviceInput {
  snapshot: LiveTradeSnapshot;
  /** Paper or sim balance in dollars. */
  balance: number;
  /** Percent of balance to risk per trade (e.g. 1 = 1%). */
  riskPercent: number;
  symbol: string;
  side: 'long' | 'short';
  thesis?: string;
  entry?: number;
  stop?: number;
  target?: number;
}

export interface TradeAdviceResult {
  verdict: TradeAdviceVerdict;
  confidence: TradeAdviceConfidence;
  summary: string;
  strengths: string[];
  warnings: string[];
  ruleViolations: string[];
  /** Advisory position size in contracts. */
  suggestedSize?: number;
  riskDollars?: number;
  rewardDollars?: number;
  rr?: number;
}

// ── Instrument metadata ───────────────────────────────────────────────────────

interface InstrumentMeta {
  tickSize: number;
  tickValue: number;
  /** Dollars per full point (for sizing). */
  pointValue: number;
  label: string;
}

const INSTRUMENT_META: Record<string, InstrumentMeta> = {
  NQ:  { tickSize: 0.25, tickValue:  5,   pointValue:  20,   label: 'Nasdaq-100 Futures (Full)' },
  MNQ: { tickSize: 0.25, tickValue:  0.5, pointValue:  2,    label: 'Micro Nasdaq-100 Futures' },
  ES:  { tickSize: 0.25, tickValue: 12.5, pointValue:  50,   label: 'S&P 500 Futures (Full)' },
  MES: { tickSize: 0.25, tickValue:  1.25,pointValue:  5,    label: 'Micro S&P 500 Futures' },
  RTY: { tickSize: 0.1,  tickValue:  5,   pointValue:  50,   label: 'Russell 2000 Futures' },
  M2K: { tickSize: 0.1,  tickValue:  0.5, pointValue:  5,    label: 'Micro Russell 2000 Futures' },
  CL:  { tickSize: 0.01, tickValue: 10,   pointValue: 1000,  label: 'Crude Oil Futures' },
  GC:  { tickSize: 0.1,  tickValue: 10,   pointValue: 100,   label: 'Gold Futures' },
};

function getMeta(symbol: string): InstrumentMeta | null {
  return INSTRUMENT_META[symbol.toUpperCase()] ?? null;
}

const SUPPORTED_SYMBOLS: readonly string[] = SHADOW_SUPPORTED_SYMBOLS;

// ── Main function ─────────────────────────────────────────────────────────────

export function buildLiveTradeAdvice(input: TradeAdviceInput): TradeAdviceResult {
  const { snapshot, balance, riskPercent, side } = input;
  const symbol = input.symbol.toUpperCase().trim();
  const entry  = input.entry;
  const stop   = input.stop;
  const target = input.target;
  const thesis = input.thesis?.trim() ?? '';

  const violations: string[] = [];
  const warnings:   string[] = [];
  const strengths:  string[] = [];

  // ── 1. Data availability checks ─────────────────────────────────────────────

  if (!snapshot.connected) {
    return {
      verdict: 'missing_confirmation',
      confidence: 'low',
      summary: 'Tradovate is not connected. Connect your account to receive live data and advice.',
      strengths: [],
      warnings: ['No live data feed. Cannot validate price or trend.'],
      ruleViolations: ['Live feed required for advisory mode.'],
    };
  }

  if (snapshot.feedFreshnessMs !== undefined && snapshot.feedFreshnessMs > 8000) {
    warnings.push(`Feed is stale (${(snapshot.feedFreshnessMs / 1000).toFixed(1)}s since last tick). Treat advice with caution.`);
  }

  if (snapshot.warning) {
    warnings.push(`Feed warning: ${snapshot.warning}`);
  }

  // ── 2. Symbol support ────────────────────────────────────────────────────────

  const meta = getMeta(symbol);
  if (!meta) {
    warnings.push(`${symbol} is not in the v1 supported list (${SUPPORTED_SYMBOLS.join(', ')}). Sizing estimates will be generic.`);
  }

  // ── 3. Entry / stop / target validation ─────────────────────────────────────

  const hasSetup = entry !== undefined && stop !== undefined && target !== undefined;

  if (!hasSetup) {
    return {
      verdict: 'missing_confirmation',
      confidence: 'low',
      summary: 'Enter your entry, stop, and target to receive a verdict.',
      strengths: [],
      warnings: [],
      ruleViolations: ['Entry, stop, and target are required.'],
    };
  }

  // Stop side
  if (side === 'long'  && stop! >= entry!) violations.push('Stop is at or above entry — invalid for a long trade.');
  if (side === 'short' && stop! <= entry!) violations.push('Stop is at or below entry — invalid for a short trade.');

  // Target side
  if (side === 'long'  && target! <= entry!) violations.push('Target is at or below entry — no upside for a long.');
  if (side === 'short' && target! >= entry!) violations.push('Target is at or above entry — no downside for a short.');

  // ── 4. Sizing math ───────────────────────────────────────────────────────────

  const riskPerShare    = Math.abs(entry! - stop!);
  const rewardPerShare  = Math.abs(target! - entry!);
  const rr              = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

  const riskDollars = balance * (riskPercent / 100);

  let suggestedSize: number | undefined;
  let actualRiskDollars: number | undefined;
  let actualRewardDollars: number | undefined;

  if (meta && riskPerShare > 0) {
    const costPerContract = riskPerShare * meta.pointValue;
    suggestedSize = costPerContract > 0 ? Math.floor(riskDollars / costPerContract) : 0;
    if (suggestedSize < 1) {
      violations.push(`Risk budget ($${riskDollars.toFixed(0)}) is too small for 1 contract at this stop width. Widen risk % or tighten stop.`);
      suggestedSize = undefined;
    } else {
      actualRiskDollars   = suggestedSize * riskPerShare * meta.pointValue;
      actualRewardDollars = suggestedSize * rewardPerShare * meta.pointValue;
    }
  }

  // ── 5. R:R check ────────────────────────────────────────────────────────────

  if (rr < 1.5 && violations.length === 0) {
    violations.push(`R:R of ${rr.toFixed(2)} is below the 1.5 minimum. Tighten stop or push target further.`);
  } else if (rr >= 2.5) {
    strengths.push(`Strong R:R of ${rr.toFixed(2)}:1.`);
  } else if (rr >= 1.5) {
    strengths.push(`Acceptable R:R of ${rr.toFixed(2)}:1.`);
  }

  // ── 6. Risk % check ─────────────────────────────────────────────────────────

  if (riskPercent > 2) {
    violations.push(`Risk of ${riskPercent}% exceeds the 2% per-trade guideline. Reduce risk or size down.`);
  } else if (riskPercent <= 0.1) {
    warnings.push('Risk is very low (<0.1%). Consider if this size is meaningful.');
  } else {
    strengths.push(`Risk is within guideline at ${riskPercent}%.`);
  }

  // ── 7. Trend alignment ───────────────────────────────────────────────────────

  if (snapshot.trend && snapshot.trend !== 'unknown' && snapshot.trend !== 'range') {
    if (side === 'long' && snapshot.trend === 'down') {
      warnings.push('Trend is currently bearish. Trading long against trend — confirm strong reversal signal.');
    } else if (side === 'short' && snapshot.trend === 'up') {
      warnings.push('Trend is currently bullish. Trading short against trend — confirm strong reversal signal.');
    } else {
      strengths.push(`Trading with the ${snapshot.trend === 'up' ? 'bullish' : 'bearish'} session trend.`);
    }
  }

  // ── 8. Price proximity check ─────────────────────────────────────────────────

  if (snapshot.lastPrice !== undefined) {
    const distance = Math.abs(snapshot.lastPrice - entry!);
    const pct      = (distance / entry!) * 100;
    if (pct > 1.5) {
      warnings.push(`Price is ${pct.toFixed(2)}% away from your entry. Confirm entry is still valid.`);
    } else if (pct < 0.3) {
      strengths.push('Price is near your entry level.');
    }

    // Extended from highs/lows
    if (snapshot.highOfDay && snapshot.lowOfDay) {
      const sessionRange = snapshot.highOfDay - snapshot.lowOfDay;
      if (sessionRange > 0) {
        const posInRange = (snapshot.lastPrice - snapshot.lowOfDay) / sessionRange;
        if (side === 'long' && posInRange > 0.85) {
          warnings.push('Price is near the high of day. Long entries here carry increased reversal risk.');
        } else if (side === 'short' && posInRange < 0.15) {
          warnings.push('Price is near the low of day. Short entries here carry increased reversal risk.');
        }
      }
    }
  }

  // ── 9. Thesis check ─────────────────────────────────────────────────────────

  if (!thesis) {
    violations.push('No thesis provided. A trade without a thesis is speculation.');
  } else if (thesis.length < 15) {
    warnings.push('Thesis is very brief. Add entry catalyst and invalidation condition.');
  } else {
    strengths.push('Trade thesis is documented.');
  }

  // ── 10. Session filter (Phase 2) ─────────────────────────────────────────────

  if (snapshot.sessionLabel) {
    switch (snapshot.sessionLabel) {
      case 'premarket':  violations.push('Pre-market — waiting for RTH open.');                 break;
      case 'lunch':      violations.push('Lunch session (11:30-13:00 ET) — no new setups.');    break;
      case 'close':      violations.push('Close session (15:00-16:00 ET) — blocked.');          break;
      case 'afterhours': violations.push('After-hours — shadow trading disabled.');             break;
      case 'opening':    strengths.push('Opening session — high liquidity window.');            break;
      case 'midmorning': strengths.push('Mid-morning continuation window.');                    break;
      // 'afternoon' — neutral, no strength/warning
    }
  }

  // ── 11. Multi-timeframe alignment (Phase 2) ───────────────────────────────

  if (snapshot.trend5m && snapshot.trend5m !== 'unknown'
   && snapshot.trend15m && snapshot.trend15m !== 'unknown') {
    if (side === 'long') {
      if (snapshot.trend5m === 'up' && snapshot.trend15m === 'up') {
        strengths.push('5m and 15m trends aligned bullish.');
      } else if (snapshot.trend5m === 'up' && snapshot.trend15m === 'down') {
        violations.push('5m trend up but 15m bias down — conflicting signals.');
      } else if (snapshot.trend5m === 'down') {
        warnings.push('Short-term (5m) trend is bearish for a long setup.');
      } else {
        warnings.push('Timeframe trend unclear — proceed with caution.');
      }
    } else {
      if (snapshot.trend5m === 'down' && snapshot.trend15m === 'down') {
        strengths.push('5m and 15m trends aligned bearish.');
      } else if (snapshot.trend5m === 'down' && snapshot.trend15m === 'up') {
        violations.push('5m trend down but 15m bias up — conflicting signals.');
      } else if (snapshot.trend5m === 'up') {
        warnings.push('Short-term (5m) trend is bullish for a short setup.');
      } else {
        warnings.push('Timeframe trend unclear — proceed with caution.');
      }
    }
  }

  // ── 12. ATR sanity (Phase 2) ───────────────────────────────────────────────

  if (snapshot.atr5m != null && entry != null && stop != null) {
    const stopDistance = Math.abs(entry - stop);
    if (stopDistance < 0.5 * snapshot.atr5m) {
      violations.push(`Stop too tight relative to volatility (${stopDistance.toFixed(2)} pts < 0.5 ATR ${(snapshot.atr5m * 0.5).toFixed(2)} pts).`);
    } else if (stopDistance > 3.0 * snapshot.atr5m) {
      violations.push(`Stop too wide relative to volatility (${stopDistance.toFixed(2)} pts > 3.0 ATR ${(snapshot.atr5m * 3).toFixed(2)} pts).`);
    } else {
      strengths.push('Stop-loss sized within ATR bounds.');
    }
  }

  // ── 13. VWAP context (Phase 2) ────────────────────────────────────────────

  if (snapshot.vwapRelation) {
    if (snapshot.vwapRelation === 'at') {
      strengths.push('Price at VWAP — pullback to value.');
    } else if (side === 'long') {
      if (snapshot.vwapRelation === 'above')          strengths.push('Price above VWAP — supportive for longs.');
      else if (snapshot.vwapRelation === 'extended_above') warnings.push('Extended above VWAP — chasing risk.');
      else if (snapshot.vwapRelation === 'below')          warnings.push('Buying below VWAP — counter-value.');
      else if (snapshot.vwapRelation === 'extended_below') warnings.push('Far below VWAP — counter-value for longs.');
    } else {
      if (snapshot.vwapRelation === 'below')               strengths.push('Price below VWAP — supportive for shorts.');
      else if (snapshot.vwapRelation === 'extended_below')  warnings.push('Extended below VWAP — chasing risk.');
      else if (snapshot.vwapRelation === 'above')           warnings.push('Shorting above VWAP — counter-value.');
      else if (snapshot.vwapRelation === 'extended_above')  warnings.push('Far above VWAP — counter-value for shorts.');
    }
  }

  // ── 14. Environment rejection (Phase 2) ───────────────────────────────────

  if (snapshot.volatilityRegime === 'low') {
    violations.push('Volatility too low — compressed range, skip.');
  } else if (snapshot.volatilityRegime === 'high') {
    warnings.push('Elevated volatility — reduce sizing or skip.');
  }

  if (snapshot.rangePct != null && snapshot.rangePct < 0.15) {
    warnings.push(`Day range extremely compressed (${snapshot.rangePct.toFixed(3)}%).`);
  }

  // HOD/LOD hard rejection for pullback setups
  if (snapshot.lastPrice != null && snapshot.highOfDay != null && snapshot.lowOfDay != null) {
    const sessionRange = snapshot.highOfDay - snapshot.lowOfDay;
    if (sessionRange > 0) {
      const posInRange = (snapshot.lastPrice - snapshot.lowOfDay) / sessionRange;
      if (side === 'long'  && posInRange > 0.90) violations.push('Price at session high — no room for pullback long.');
      if (side === 'short' && posInRange < 0.10) violations.push('Price at session low — no room for pullback short.');
    }
  }

  // ── 15. Verdict logic ──────────────────────────────────────────────────────

  let verdict: TradeAdviceVerdict;
  let confidence: TradeAdviceConfidence;
  let summary: string;

  if (violations.length > 0) {
    // Hard rule violations → skip or reduce
    const hasStructural  = violations.some(v => v.includes('stop') || v.includes('target') || v.includes('thesis'));
    const hasSizing      = violations.some(v => v.includes('R:R') || v.includes('risk') || v.includes('budget'));
    const hasEnvironment = violations.some(v =>
      v.includes('session') || v.includes('Session') || v.includes('Pre-market')
      || v.includes('After-hours') || v.includes('Volatility') || v.includes('ATR')
      || v.includes('conflicting') || v.includes('no room'));

    if (hasStructural || hasEnvironment) {
      verdict    = 'skip';
      confidence = 'high';
      summary    = `${violations.length} rule violation${violations.length > 1 ? 's' : ''} detected. ${hasEnvironment ? 'Environment or session blocked.' : 'Fix the setup before trading.'}`;
    } else if (hasSizing) {
      verdict    = 'reduce_size';
      confidence = 'medium';
      summary    = 'Setup has merit but sizing or R:R needs adjustment.';
    } else {
      verdict    = 'wait';
      confidence = 'medium';
      summary    = 'Setup has issues. Monitor and wait for better conditions.';
    }
  } else if (warnings.length > 2) {
    verdict    = 'wait';
    confidence = 'medium';
    summary    = 'Setup is technically valid but has multiple caution flags. Wait for cleaner conditions.';
  } else if (warnings.length === 0 && strengths.length >= 3) {
    verdict    = 'buy';
    confidence = 'high';
    summary    = `Clean ${side} setup on ${symbol}. Rules pass and structure is aligned.`;
  } else {
    verdict    = 'buy';
    confidence = 'medium';
    summary    = `${side.charAt(0).toUpperCase() + side.slice(1)} setup on ${symbol} passes core rules. Monitor warnings before entry.`;
  }

  return {
    verdict,
    confidence,
    summary,
    strengths,
    warnings,
    ruleViolations: violations,
    suggestedSize,
    riskDollars:   actualRiskDollars,
    rewardDollars: actualRewardDollars,
    rr: rr > 0 ? rr : undefined,
  };
}

export { SUPPORTED_SYMBOLS, INSTRUMENT_META };
export type { InstrumentMeta };
