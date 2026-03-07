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

  // ── Phase 3: MFE/MAE tracking ─────────
  /** Maximum favorable price seen during the trade (updated on each tick). */
  mfPrice?: number;
  /** Maximum adverse price seen during the trade (updated on each tick). */
  maPrice?: number;
  /** MFE in R-multiples (set on close). */
  mfeR?: number;
  /** MAE in R-multiples (set on close). */
  maeR?: number;
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

// ── Phase 3: Shadow Trading Analytics ─────────────────────────────────────────

export type ShadowDecisionStage =
  | 'limits_check'    | 'feed_check'      | 'setup_detection'
  | 'rule_engine'     | 'council_review'   | 'trade_opened'
  | 'trade_closed';

export type ShadowBlockReason =
  // limits_check
  | 'disabled' | 'paused' | 'max_concurrent' | 'daily_trade_limit'
  | 'daily_loss_limit' | 'cooldown_active'
  // feed_check
  | 'no_snapshot' | 'not_connected' | 'no_price' | 'feed_stale'
  | 'indicators_not_ready' | 'symbol_not_allowed'
  // setup_detection
  | 'no_setup' | 'non_pullback'
  // rule_engine
  | 'verdict_not_buy' | 'low_confidence' | 'size_too_small'
  // council_review
  | 'council_not_initialized' | 'council_error' | 'council_rejected'
  | 'insufficient_seats' | 'grok_veto' | 'low_council_confidence'
  | 'insufficient_take_votes'
  // strategy_config (Phase 4 — logged under natural stage, not a new funnel stage)
  | 'strategy_config_blocked';

export interface ShadowDecisionEvent {
  /** Schema version for forward-compatible JSONL evolution. */
  schemaVersion: 1;
  id: string;
  timestamp: number;
  stage: ShadowDecisionStage;
  /** Correlates all events from the same _evaluateEntry() pass (set from setup_detection onward). */
  candidateId?: string;
  blockReason?: ShadowBlockReason;
  blockMessage?: string;

  // ── Market context ──
  symbol?: string;
  lastPrice?: number;
  feedFreshnessMs?: number;
  sessionLabel?: SessionLabel;
  volatilityRegime?: VolatilityRegime;
  trend5m?: BarTrend;
  trend15m?: BarTrend;
  vwapRelation?: VwapRelation;
  atr5m?: number;

  // ── Setup context (from setup_detection onward) ──
  setupType?: string;
  side?: 'long' | 'short';
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  qualityScore?: number;

  // ── Rule engine context (from rule_engine onward) ──
  ruleVerdict?: string;
  ruleConfidence?: string;
  rr?: number;
  suggestedSize?: number;
  strengthCount?: number;
  warningCount?: number;
  violationCount?: number;

  // ── Council context (from council_review onward) ──
  councilVotes?: CouncilVote[];
  councilApproved?: boolean;

  // ── Trade outcome (trade_opened / trade_closed) ──
  tradeId?: string;
  exitPrice?: number;
  exitReason?: string;
  pnl?: number;
  pnlR?: number;
  mfeR?: number;
  maeR?: number;
  timeInTradeMs?: number;
}

// ── Analytics summary types ──────────────────────────────────────────────────

export interface ShadowPerformanceSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlR: number;
  avgWinR: number;
  avgLossR: number;
  /** sum(winning R) / |sum(losing R)|. Infinity if no losses. */
  profitFactor: number;
  /** (winRate * avgWinR) + ((1 - winRate) * avgLossR) */
  expectancyR: number;
  totalPnlDollars: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgTimeInTradeMs: number;
  avgMfeR: number;
  avgMaeR: number;
  /** avgPnlR / avgMfeR — how much of the favorable move was captured. */
  edgeCaptureRatio: number;
}

export interface BucketPerformanceSummary {
  bucket: string;
  trades: number;
  winRate: number;
  avgPnlR: number;
  totalPnlDollars: number;
}

export interface CouncilEffectivenessSummary {
  totalReviews: number;
  approvals: number;
  rejections: number;
  approvalRate: number;
  approvedWinRate: number;
  avgConfidenceWins: number;
  avgConfidenceLosses: number;
  /** Provider agreement with outcomes — only computed on opened/closed trades. */
  providerAccuracy: Record<string, { votes: number; correctCalls: number; accuracy: number }>;
}

export interface ShadowAnalyticsSummary {
  overall: ShadowPerformanceSummary;
  bySession: BucketPerformanceSummary[];
  bySetupType: BucketPerformanceSummary[];
  bySymbol: BucketPerformanceSummary[];
  council: CouncilEffectivenessSummary;
  decisionFunnel: Record<ShadowDecisionStage, number>;
  topBlockReasons: Array<{ reason: ShadowBlockReason; count: number; pct: number }>;
  eventCount: number;
  oldestEventTs: number;
  newestEventTs: number;
}

// ── Phase 4: Strategy Refinement ─────────────────────────────────────────────

export type InsightRecommendation = 'promote' | 'keep' | 'watch' | 'demote' | 'block';

export interface StrategyInsight {
  category: 'session' | 'volatility' | 'vwap' | 'instrument' | 'council_confidence' | 'warnings';
  bucket: string;
  trades: number;
  winRate: number;
  avgPnlR: number;
  totalPnlDollars: number;
  baselineWinRate: number;
  baselineAvgPnlR: number;
  /** <10=watch, 10-24=limited, 25+=full */
  sampleTier: 'watch' | 'limited' | 'full';
  recommendation: InsightRecommendation;
  rationale: string;
}

export interface StrategyRefinementSummary {
  generatedAt: number;
  totalClosedTrades: number;
  baselineWinRate: number;
  baselineAvgPnlR: number;
  insights: StrategyInsight[];
  config: ShadowStrategyConfig;
}

export interface ShadowStrategyConfig {
  /** Allowed session windows — empty/undefined = all allowed. */
  allowedSessions?: SessionLabel[];
  /** Blocked volatility regimes — trades in these regimes are rejected. */
  blockedVolatilityRegimes?: VolatilityRegime[];
  /** Blocked VWAP relations — trades with these VWAP positions are rejected. */
  blockedVwapRelations?: VwapRelation[];
  /** Override the tier-default council confidence floor. */
  minCouncilAvgConfidence?: number;
  /** Block if rule-engine warnings exceed this count. */
  maxWarningsAllowed?: number;
  /** Preferred symbols — empty/undefined = all allowed. */
  preferredSymbols?: string[];
}
