// ── engine/src/trading/types.ts ───────────────────────────────────────────────
//
// Shared types for Shadow Trading Mode.
// All shadow trades are simulation only — no real orders.

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
