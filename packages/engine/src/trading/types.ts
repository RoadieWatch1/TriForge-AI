// ── engine/src/trading/types.ts ───────────────────────────────────────────────
//
// Shared trading types: snapshot, shadow trades, council votes, Phase 2 unions.
// All shadow trades are simulation only — no real orders.

// ── Phase 2 union types ─────────────────────────────────────────────────────

export type VwapRelation = 'above' | 'below' | 'at' | 'extended_above' | 'extended_below';
export type BarTrend = 'up' | 'down' | 'range' | 'unknown';
export type SessionLabel = 'premarket' | 'opening' | 'midmorning' | 'lunch' | 'afternoon' | 'close' | 'afterhours';
export type VolatilityRegime = 'low' | 'normal' | 'high';
export type IndicatorState = 'warming' | 'ready' | 'degraded';

// ── Live market snapshot ────────────────────────────────────────────────────

export interface LiveTradeSnapshot {
  connected: boolean;
  accountMode: 'simulation' | 'live' | 'unknown';
  symbol: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  highOfDay?: number;
  lowOfDay?: number;
  /** Positive = bullish session, negative = bearish. */
  trend?: 'up' | 'down' | 'range' | 'unknown';
  /** Milliseconds since last quote tick. >5000 = stale. */
  feedFreshnessMs?: number;
  warning?: string;

  // ── Phase 2 enrichments (optional — fallback gracefully when absent) ──
  /** ATR(14) on 5-min bars. Undefined during warm-up. */
  atr5m?: number;
  /** Session VWAP. Undefined until first bar completes. */
  vwap?: number;
  /** Qualitative VWAP relation for the current price. */
  vwapRelation?: VwapRelation;
  /** 5-min bar trend (short timeframe). */
  trend5m?: BarTrend;
  /** 15-min bar trend (higher timeframe bias). */
  trend15m?: BarTrend;
  /** Current session time window (ET). */
  sessionLabel?: SessionLabel;
  /** Volatility regime derived from ATR vs recent ATR average. */
  volatilityRegime?: VolatilityRegime;
  /** Day range as percentage of price: (HOD-LOD)/price * 100. */
  rangePct?: number;
  /** Indicator computation readiness. */
  indicatorState?: IndicatorState;
}

// ── Council vote ──────────────────────────────────────────────────────────────

export interface CouncilVote {
  provider: string;
  vote: 'TAKE' | 'WAIT' | 'REJECT';
  /** 0–100 confidence score parsed from the AI response. */
  confidence: number;
  reason: string;
}

export interface ShadowTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  status: 'open' | 'closed';
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  /** Why the trade was closed: 'stop' | 'target' | 'manual' | 'session_end' */
  exitReason?: string;
  /** Realized P/L in dollars (set on close). */
  pnl?: number;
  /** P/L expressed in R-multiples (set on close). */
  pnlR?: number;
  /** Unrealized P/L in dollars (updated on each price tick for open trades). */
  unrealizedPnl?: number;
  /** Human-readable reason Triforge entered this trade. */
  reason: string;
  /** The rule-engine verdict that triggered entry. */
  verdict: string;
  /** Setup type detected by buildTradeLevels (e.g. 'breakout_long'). */
  setupType?: string;
  /** What condition would have invalidated this trade before entry. */
  invalidationRule?: string;
  /** Quality score 0–100: confidence + R:R + trend alignment. */
  qualityScore?: number;
  /** Individual votes from the 3-AI council before this trade was opened. */
  councilVotes?: CouncilVote[];
  /** True when council approved this trade (always true for opened trades). */
  councilPassed?: boolean;

  // ── Phase 2 Market Context (logged at entry) ─────────
  atr5m?: number;
  vwap?: number;
  vwapRelation?: VwapRelation;
  trend5m?: BarTrend;
  trend15m?: BarTrend;
  sessionLabel?: SessionLabel;
  volatilityRegime?: VolatilityRegime;
}

export interface ShadowAccountSettings {
  startingBalance: number;
  /** Percent of shadow balance risked per trade (e.g. 1 = 1%). */
  riskPercentPerTrade: number;
  /** If daily P/L drops below -(startingBalance * maxDailyLossPercent / 100), stop trading. */
  maxDailyLossPercent: number;
  /** Max shadow trades opened per day. */
  maxTradesPerDay: number;
  /** Max concurrent open shadow positions. */
  maxConcurrentPositions: number;
  /** Symbols shadow trading is allowed on. */
  allowedSymbols: string[];
}

export interface ShadowAccountState {
  enabled: boolean;
  /** Paused = enabled but not opening new positions. */
  paused: boolean;
  settings: ShadowAccountSettings;
  startingBalance: number;
  currentBalance: number;
  /** Sum of closed-trade P/L for today. */
  dailyPnL: number;
  tradesToday: number;
  openTrades: ShadowTrade[];
  /** Last N closed trades (newest first). */
  closedTrades: ShadowTrade[];
  lastEvalAt?: number;
  /** Why no new trades are being opened (if applicable). */
  blockedReason?: string;
  /** Set when council voted on a setup but rejected it. */
  councilBlockedReason?: string;
}
