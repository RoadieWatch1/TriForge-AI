// ── engine/src/trading/types.ts ───────────────────────────────────────────────
//
// Shared trading types: snapshot, shadow trades, council votes, Phase 2 unions.
// All shadow trades are simulation only — no real orders.

// ── Phase 2 union types ─────────────────────────────────────────────────────
// Canonical const arrays → derived union types. One source of truth.

export const VWAP_RELATIONS = ['above', 'below', 'at', 'extended_above', 'extended_below'] as const;
export type VwapRelation = typeof VWAP_RELATIONS[number];

export const BAR_TRENDS = ['up', 'down', 'range', 'unknown'] as const;
export type BarTrend = typeof BAR_TRENDS[number];

export const SESSION_LABELS = ['premarket', 'opening', 'midmorning', 'lunch', 'afternoon', 'close', 'afterhours'] as const;
export type SessionLabel = typeof SESSION_LABELS[number];

export const VOLATILITY_REGIMES = ['low', 'normal', 'high'] as const;
export type VolatilityRegime = typeof VOLATILITY_REGIMES[number];

export type IndicatorState = 'warming' | 'ready' | 'degraded';

// ── Supported symbols (canonical source) ────────────────────────────────────
export const SHADOW_SUPPORTED_SYMBOLS = ['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'M2K', 'CL', 'GC'] as const;
export type ShadowSymbol = typeof SHADOW_SUPPORTED_SYMBOLS[number];

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
  | 'strategy_config_blocked'
  // promotion workflow (Phase 6 — workflow states, not failure blocks)
  | 'manual_confirmation_pending' | 'manual_confirmation_timeout' | 'manual_confirmation_rejected'
  | 'promotion_guardrail_blocked';

export interface ShadowDecisionEvent {
  /** Schema version for forward-compatible JSONL evolution. */
  schemaVersion: 1;
  id: string;
  timestamp: number;
  stage: ShadowDecisionStage;
  /** The operation mode when this event was generated (Phase 6). */
  operationMode?: TradingOperationMode;
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
  preferredSymbols?: ShadowSymbol[];
}

// ── Phase 5: Strategy Readiness ──────────────────────────────────────────────

export type StrategyReadinessState = 'not_ready' | 'developing' | 'paper_ready' | 'guarded_live_candidate';
export const READINESS_STATES = ['not_ready', 'developing', 'paper_ready', 'guarded_live_candidate'] as const;

export interface ReadinessThresholds {
  minTrades: number;
  minWinRate: number;
  minAvgPnlR?: number;
  minProfitFactor?: number;
  maxConsecutiveLosses?: number;
  minEdgeCaptureRatio?: number;
  /** Max cumulative drawdown in R-multiples. */
  maxDrawdownR?: number;
}

export const DEFAULT_READINESS_THRESHOLDS: Record<
  Exclude<StrategyReadinessState, 'not_ready'>,
  ReadinessThresholds
> = {
  developing:             { minTrades: 15, minWinRate: 0.35 },
  paper_ready:            { minTrades: 30, minWinRate: 0.50, minAvgPnlR: 0.10, minProfitFactor: 1.2, maxConsecutiveLosses: 5, maxDrawdownR: 8 },
  guarded_live_candidate: { minTrades: 75, minWinRate: 0.55, minAvgPnlR: 0.20, minProfitFactor: 1.5, maxConsecutiveLosses: 4, minEdgeCaptureRatio: 0.25, maxDrawdownR: 5 },
};

export interface ThresholdCheck {
  key: string;
  currentValue: number;
  requiredValue: number;
  passed: boolean;
  rationale: string;
}

export interface StabilityCheck {
  category: 'session' | 'volatility_regime';
  bucket: string;
  trades: number;
  /** winRate for session, avgPnlR for volatility. */
  metric: number;
  metricName: string;
  passed: boolean;
  rationale: string;
}

export interface StrategyReadinessReport {
  state: StrategyReadinessState;
  generatedAt: number;
  performance: ShadowPerformanceSummary;
  /** Threshold checks for the next state up (or own state if at top). */
  thresholdChecks: ThresholdCheck[];
  /** Max cumulative drawdown in R-multiples. */
  maxDrawdownR: number;
  stabilityChecks: StabilityCheck[];
  stabilityPassed: boolean;
  /** Human-readable reasons preventing next state. */
  blockers: string[];
  /** One-line summary — always ends with advisory disclaimer. */
  advisory: string;
}

// ── Phase 6: Promotion Workflow ──────────────────────────────────────────────

export type TradingOperationMode = 'shadow' | 'paper' | 'guarded_live_candidate';

export interface ModeGuardrails {
  dailyLossCapR: number;
  maxTradesPerDay: number;
  maxPositionSize: number;
  manualConfirmation: boolean;
  autoDemotionEnabled: boolean;
  lossStreakDemotion: number;
}

/** Guardrails split by promoted mode. guarded_live_candidate is stricter by default. */
export interface PromotionGuardrails {
  paper: ModeGuardrails;
  guardedLiveCandidate: ModeGuardrails;
}

export const DEFAULT_PROMOTION_GUARDRAILS: PromotionGuardrails = {
  paper: {
    dailyLossCapR: 3,
    maxTradesPerDay: 3,
    maxPositionSize: 1,
    manualConfirmation: true,
    autoDemotionEnabled: true,
    lossStreakDemotion: 3,
  },
  guardedLiveCandidate: {
    dailyLossCapR: 2,
    maxTradesPerDay: 2,
    maxPositionSize: 1,
    manualConfirmation: true,
    autoDemotionEnabled: true,
    lossStreakDemotion: 2,
  },
};

export interface PromotionDecision {
  eligible: boolean;
  targetMode: TradingOperationMode;
  requiredState: StrategyReadinessState;
  currentState: StrategyReadinessState;
  blockers: string[];
  advisory: string;
}

export interface PromotionWorkflowStatus {
  currentMode: TradingOperationMode;
  promotedAt?: number;
  demotedAt?: number;
  demotionReason?: string;
  dailyLossR: number;
  tradesTodayPromoted: number;
  consecutiveLosses: number;
  activeGuardrails: ModeGuardrails;
  guardrails: PromotionGuardrails;
  lastReadinessState: StrategyReadinessState;
}

// ── Strategy config validation (Phase 4.1) ──────────────────────────────────

export interface StrategyConfigValidation {
  config: ShadowStrategyConfig;
  warnings: string[];
}

/** Sanitize raw input into a valid ShadowStrategyConfig. Drops invalid values,
 *  clamps numerics, and returns warnings for anything that was corrected. */
export function validateStrategyConfig(raw: unknown): StrategyConfigValidation {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { config: {}, warnings: ['Input is not an object — using empty config.'] };
  }
  const input = raw as Record<string, unknown>;
  const config: ShadowStrategyConfig = {};

  // allowedSessions
  if (input.allowedSessions !== undefined) {
    if (Array.isArray(input.allowedSessions)) {
      const valid = input.allowedSessions.filter((v): v is SessionLabel =>
        typeof v === 'string' && (SESSION_LABELS as readonly string[]).includes(v));
      const dropped = input.allowedSessions.length - valid.length;
      if (dropped > 0) warnings.push(`allowedSessions: dropped ${dropped} invalid value(s).`);
      if (valid.length > 0) config.allowedSessions = valid;
    } else {
      warnings.push('allowedSessions: expected array, ignored.');
    }
  }

  // blockedVolatilityRegimes
  if (input.blockedVolatilityRegimes !== undefined) {
    if (Array.isArray(input.blockedVolatilityRegimes)) {
      const valid = input.blockedVolatilityRegimes.filter((v): v is VolatilityRegime =>
        typeof v === 'string' && (VOLATILITY_REGIMES as readonly string[]).includes(v));
      const dropped = input.blockedVolatilityRegimes.length - valid.length;
      if (dropped > 0) warnings.push(`blockedVolatilityRegimes: dropped ${dropped} invalid value(s).`);
      if (valid.length > 0) config.blockedVolatilityRegimes = valid;
    } else {
      warnings.push('blockedVolatilityRegimes: expected array, ignored.');
    }
  }

  // blockedVwapRelations
  if (input.blockedVwapRelations !== undefined) {
    if (Array.isArray(input.blockedVwapRelations)) {
      const valid = input.blockedVwapRelations.filter((v): v is VwapRelation =>
        typeof v === 'string' && (VWAP_RELATIONS as readonly string[]).includes(v));
      const dropped = input.blockedVwapRelations.length - valid.length;
      if (dropped > 0) warnings.push(`blockedVwapRelations: dropped ${dropped} invalid value(s).`);
      if (valid.length > 0) config.blockedVwapRelations = valid;
    } else {
      warnings.push('blockedVwapRelations: expected array, ignored.');
    }
  }

  // preferredSymbols
  if (input.preferredSymbols !== undefined) {
    if (Array.isArray(input.preferredSymbols)) {
      const valid = input.preferredSymbols.filter((v): v is ShadowSymbol =>
        typeof v === 'string' && (SHADOW_SUPPORTED_SYMBOLS as readonly string[]).includes(v.toUpperCase()));
      const dropped = input.preferredSymbols.length - valid.length;
      if (dropped > 0) warnings.push(`preferredSymbols: dropped ${dropped} invalid value(s).`);
      if (valid.length > 0) config.preferredSymbols = valid;
    } else {
      warnings.push('preferredSymbols: expected array, ignored.');
    }
  }

  // minCouncilAvgConfidence
  if (input.minCouncilAvgConfidence !== undefined) {
    const n = Number(input.minCouncilAvgConfidence);
    if (isNaN(n)) {
      warnings.push('minCouncilAvgConfidence: not a number, ignored.');
    } else if (n < 0 || n > 100) {
      const clamped = Math.max(0, Math.min(100, n));
      config.minCouncilAvgConfidence = clamped;
      warnings.push(`minCouncilAvgConfidence: clamped ${n} to ${clamped} (range 0–100).`);
    } else {
      config.minCouncilAvgConfidence = n;
    }
  }

  // maxWarningsAllowed
  if (input.maxWarningsAllowed !== undefined) {
    const n = Number(input.maxWarningsAllowed);
    if (isNaN(n) || !Number.isInteger(n)) {
      warnings.push('maxWarningsAllowed: must be an integer >= 0, ignored.');
    } else if (n < 0) {
      warnings.push(`maxWarningsAllowed: ${n} is negative, ignored.`);
    } else {
      config.maxWarningsAllowed = n;
    }
  }

  return { config, warnings };
}

// ── Promotion guardrail validation (Phase 6) ─────────────────────────────────

function _validateModeGuardrails(
  raw: unknown,
  prefix: string,
  defaults: ModeGuardrails,
): { guardrails: ModeGuardrails; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { guardrails: { ...defaults }, warnings: [`${prefix}: not an object — using defaults.`] };
  }
  const input = raw as Record<string, unknown>;
  const g: ModeGuardrails = { ...defaults };

  if (input.dailyLossCapR !== undefined) {
    const n = Number(input.dailyLossCapR);
    if (isNaN(n) || n <= 0) warnings.push(`${prefix}.dailyLossCapR must be > 0, using default.`);
    else g.dailyLossCapR = Math.min(10, n);
  }
  if (input.maxTradesPerDay !== undefined) {
    const n = Number(input.maxTradesPerDay);
    if (isNaN(n) || !Number.isInteger(n) || n < 1) warnings.push(`${prefix}.maxTradesPerDay must be integer >= 1, using default.`);
    else g.maxTradesPerDay = Math.min(10, n);
  }
  if (input.maxPositionSize !== undefined) {
    const n = Number(input.maxPositionSize);
    if (isNaN(n) || !Number.isInteger(n) || n < 1) warnings.push(`${prefix}.maxPositionSize must be integer >= 1, using default.`);
    else g.maxPositionSize = Math.min(5, n);
  }
  if (input.manualConfirmation !== undefined) g.manualConfirmation = input.manualConfirmation !== false;
  if (input.autoDemotionEnabled !== undefined) g.autoDemotionEnabled = input.autoDemotionEnabled !== false;
  if (input.lossStreakDemotion !== undefined) {
    const n = Number(input.lossStreakDemotion);
    if (isNaN(n) || !Number.isInteger(n) || n < 1) warnings.push(`${prefix}.lossStreakDemotion must be integer >= 1, using default.`);
    else g.lossStreakDemotion = Math.min(10, n);
  }
  return { guardrails: g, warnings };
}

export function validatePromotionGuardrails(raw: unknown): { guardrails: PromotionGuardrails; warnings: string[] } {
  if (!raw || typeof raw !== 'object') {
    return { guardrails: { ...DEFAULT_PROMOTION_GUARDRAILS }, warnings: ['Input is not an object — using defaults.'] };
  }
  const input = raw as Record<string, unknown>;
  const allWarnings: string[] = [];

  const paperResult = _validateModeGuardrails(input.paper, 'paper', DEFAULT_PROMOTION_GUARDRAILS.paper);
  allWarnings.push(...paperResult.warnings);

  const glcResult = _validateModeGuardrails(input.guardedLiveCandidate, 'guardedLiveCandidate', DEFAULT_PROMOTION_GUARDRAILS.guardedLiveCandidate);
  allWarnings.push(...glcResult.warnings);

  return {
    guardrails: { paper: paperResult.guardrails, guardedLiveCandidate: glcResult.guardrails },
    warnings: allWarnings,
  };
}
