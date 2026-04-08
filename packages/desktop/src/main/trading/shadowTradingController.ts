// ── main/trading/shadowTradingController.ts ───────────────────────────────────
//
// Shadow Trading Mode — Triforge places simulated trades alongside the user.
// SIMULATION ONLY. No real brokerage orders are ever placed.
//
// Architecture:
//   - Runs an eval loop every EVAL_INTERVAL_MS in the main process.
//   - Gets market data from the active provider (Tradovate if connected,
//     SimulatedMarketDataProvider otherwise).
//   - Calls buildLiveTradeAdvice (pure rule engine) to validate setups.
//   - Manages a shadow account: virtual balance, open/closed positions, daily limits.
//
// Provider-switch note (v1):
//   When switching between simulated and Tradovate mid-session, existing open
//   positions in ShadowPositionBook are preserved. The new price source becomes
//   authoritative for mark-to-market and exit triggers. Positions entered at a
//   simulated price may be exited at a real price (or vice versa). No seamless
//   continuity is guaranteed across provider switches.
//
// Autonomous setup generation (v1):
//   - Long  when trend='up':   entry=lastPrice, stop=entry−N, target=entry+2N  (2:1 R:R)
//   - Short when trend='down': entry=lastPrice, stop=entry+N, target=entry−2N  (2:1 R:R)
//   - N is per-instrument (NQ=15pts, ES=5pts, etc.)
//   - No new trade opened if trend is 'range' or 'unknown'.
//
// Trade lifecycle:
//   - Open: verdict is 'buy' + confidence is 'medium'|'high' + all limits clear
//   - Close: stop hit | target hit | manual reset
//   - P/L: (exit − entry) × qty × pointValue  (long); inverted for short

import crypto from 'crypto';
import { tradovateService } from './tradovateService';
import { shadowAnalyticsStore } from './shadowAnalyticsStore';
import {
  buildLiveTradeAdvice, buildTradeLevels, INSTRUMENT_META,
  updateExcursions, computeExcursionR,
} from '@triforge/engine';
import type { LiveTradeSnapshot, ProposedTradeSetup } from '@triforge/engine';
import type {
  ShadowTrade, ShadowAccountState, ShadowAccountSettings, CouncilVote,
  ShadowDecisionEvent, ShadowBlockReason, ShadowDecisionStage,
  ShadowStrategyConfig,
  TradingOperationMode, PromotionGuardrails, ModeGuardrails,
  PromotionWorkflowStatus, StrategyReadinessState,
  SetupGrade, TradeDecisionExplanation,
} from '@triforge/engine';
import { DEFAULT_PROMOTION_GUARDRAILS, computeSetupGrade, computeAgreementLabel, buildTradeDecisionExplanation } from '@triforge/engine';
import { TriForgeShadowSimulator } from './shadow/TriForgeShadowSimulator';
import { broadcastTradeAlert, symbolLabel } from './tradeAlertBroadcaster';
import { TradovateMarketDataAdapter } from './market/TradovateMarketDataAdapter';
import { SimulatedMarketDataProvider } from './market/SimulatedMarketDataProvider';
import { tastytradeProvider } from './market/TastytradeMarketDataProvider';
import type { IMarketDataProvider } from './market/MarketDataProvider';
import { MarketSnapshotStore } from './market/MarketSnapshotStore';

// ── Council review callback type ──────────────────────────────────────────────
// Injected from ipc.ts after engine init. Runs the 3-AI vote in the main process.

export type CouncilBlockedCode =
  | 'insufficient_seats'
  | 'grok_veto'
  | 'low_confidence'
  | 'insufficient_take_votes';

export interface CouncilReviewResult {
  approved: boolean;
  votes: CouncilVote[];
  blockedReason?: string;
  blockedCode?: CouncilBlockedCode;
}

export type CouncilReviewFn = (
  setup: ProposedTradeSetup,
  snap: LiveTradeSnapshot,
  symbol: string,
) => Promise<CouncilReviewResult>;

// ── Constants ─────────────────────────────────────────────────────────────────

const EVAL_INTERVAL_MS = 15_000;          // re-evaluate every 15s
const TRADE_COOLDOWN_MS = 3 * 60_000;    // wait 3 min before new entry after a trade
const MAX_CLOSED_HISTORY = 50;
const BLOCK_THROTTLE_MS = 60_000;         // suppress duplicate block events for 60s

/** Default stop-loss distance in points per instrument. */
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

const DEFAULT_SETTINGS: ShadowAccountSettings = {
  startingBalance:       10_000,
  riskPercentPerTrade:   1,
  maxDailyLossPercent:   5,
  maxTradesPerDay:       5,
  maxConcurrentPositions:1,
  allowedSymbols:        ['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'M2K', 'CL', 'GC'],
};

// ── Controller ────────────────────────────────────────────────────────────────

class ShadowTradingControllerClass {
  private _state: ShadowAccountState = this._freshState();
  private _evalTimer: ReturnType<typeof setInterval> | null = null;
  private _lastTradeOpenedAt = 0;
  private _todayKey = '';   // YYYY-MM-DD, resets on new day
  private _councilFn: CouncilReviewFn | null = null;
  private _activeSymbol: string = 'NQ';
  private _firstTastytradeMarketStateLogged = false;
  private _lastLimitBlockReason: ShadowBlockReason | undefined;
  private _lastEmittedBlock = new Map<string, number>();
  private _strategyConfig: ShadowStrategyConfig = {};

  // ── Level-to-Level Engine (Phase 1 skeleton) ──────────────────────────
  private readonly _simulator = new TriForgeShadowSimulator();
  private readonly _marketAdapter = new TradovateMarketDataAdapter();
  private readonly _simulatedAdapter = new SimulatedMarketDataProvider();
  private readonly _snapshotStore = new MarketSnapshotStore();

  /**
   * Returns the active market data provider.
   * Provider priority: Tradovate → Tastytrade → Simulated.
   */
  private _getActiveProvider(): IMarketDataProvider {
    if (this._marketAdapter.isConnected()) return this._marketAdapter;
    if (tastytradeProvider.isConnected()) return tastytradeProvider;
    return this._simulatedAdapter;
  }

  /** Get the level-to-level simulator instance (for IPC accessors). */
  getSimulator(): TriForgeShadowSimulator { return this._simulator; }

  /** Get OHLC bars from the active market data provider. */
  getBars() { return this._getActiveProvider().getBars(); }

  /** Unified market state: snapshot + bars + source in one payload. */
  getMarketState() {
    const provider = this._getActiveProvider();
    const bars = provider.getBars();
    const source = this._marketAdapter.isConnected() ? 'tradovate' as const
                 : tastytradeProvider.isConnected()  ? 'tastytrade' as const
                 : 'simulated' as const;
    if (!this._firstTastytradeMarketStateLogged && source === 'tastytrade' && bars && bars.bars1m.length > 0) {
      this._firstTastytradeMarketStateLogged = true;
      const latest = bars.bars1m[bars.bars1m.length - 1];
      console.log('[ShadowController] First getMarketState() with Tastytrade bars:', {
        source,
        bars1m: bars.bars1m.length,
        bars5m: bars.bars5m.length,
        latestTs: latest?.timestamp,
        latestClose: latest?.close,
        symbol: provider.activeSymbol(),
      });
    }
    return {
      snapshot: provider.getSnapshot(),
      bars,
      source,
      connected: provider.isConnected(),
      symbol: provider.activeSymbol(),
    };
  }

  // ── Phase 6: Promotion workflow state ─────────────────────────────────────
  private _operationMode: TradingOperationMode = 'shadow';
  private _promotionGuardrails: PromotionGuardrails = { paper: { ...DEFAULT_PROMOTION_GUARDRAILS.paper }, guardedLiveCandidate: { ...DEFAULT_PROMOTION_GUARDRAILS.guardedLiveCandidate } };
  private _promotedAt?: number;
  private _demotedAt?: number;
  private _demotionReason?: string;
  private _dailyLossRPromoted = 0;
  private _tradesTodayPromoted = 0;
  private _consecutiveLosses = 0;
  private _lastReadinessState: StrategyReadinessState = 'not_ready';
  private _pendingTrade: {
    symbol: string; setup: ProposedTradeSetup; advice: ReturnType<typeof buildLiveTradeAdvice>;
    snap: LiveTradeSnapshot; councilVotes: CouncilVote[]; candidateId: string; createdAt: number;
  } | null = null;
  private _pendingTradeTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Inject the council review callback from the main process (ipc.ts). Must be
   *  called once after engine init. Without this, no shadow trades will open. */
  setCouncilFn(fn: CouncilReviewFn): void {
    this._councilFn = fn;
    // Wire the simulator's dependencies
    this._simulator.setCouncilFn(fn);
    this._simulator.setProvider(this._getActiveProvider());
    this._marketAdapter.setSnapshotStore(this._snapshotStore);
  }

  /** Get the current strategy config (Phase 4). Returns a copy. */
  getStrategyConfig(): ShadowStrategyConfig { return { ...this._strategyConfig }; }

  /** Set strategy config (Phase 4). Default `{}` changes nothing. */
  setStrategyConfig(cfg: ShadowStrategyConfig): void { this._strategyConfig = { ...cfg }; }

  enable(): void {
    this._resetDailyIfNeeded();
    this._state.enabled = true;
    this._state.paused  = false;

    // If Tradovate is not connected, force level engine on — the legacy
    // pipeline hardcodes tradovateService calls and cannot use the simulated
    // provider. The level engine path uses the IMarketDataProvider interface.
    if (!this._marketAdapter.isConnected() && !this._strategyConfig.useLevelEngine) {
      this._strategyConfig = { ...this._strategyConfig, useLevelEngine: true };
    }

    // Subscribe simulated provider to the active symbol (Tradovate symbol if
    // available, otherwise default to MNQ for micro-contract affordability)
    const tvSymbol = tradovateService.status().symbol;
    const sym = tvSymbol ?? 'MNQ';
    this._simulatedAdapter.subscribe(sym);

    // Set the correct provider based on current connection state
    this._simulator.setProvider(this._getActiveProvider());

    if (this._strategyConfig.useLevelEngine) this._simulator.activate();
    this._startEvalLoop();
  }

  disable(): void {
    this._state.enabled = false;
    this._state.paused  = false;
    this._simulator.deactivate();
    this._stopEvalLoop();
  }

  pause(): void {
    this._state.paused = true;
    this._stopEvalLoop();
  }

  resume(): void {
    if (!this._state.enabled) return;
    this._state.paused = false;
    this._startEvalLoop();
  }

  reset(newBalance?: number): void {
    const bal = newBalance ?? this._state.settings.startingBalance;
    this._state = this._freshState();
    this._state.startingBalance = bal;
    this._state.currentBalance  = bal;
    this._state.settings        = { ...DEFAULT_SETTINGS, startingBalance: bal };
    this._todayKey = '';
    this._lastTradeOpenedAt = 0;
    // NOTE: analytics NOT cleared here — use explicit shadowAnalyticsStore.clear()
    // Phase 6: reset promoted counters but keep mode + guardrails intact
    this._resetPromotedCounters();
    this._clearPendingTrade();
  }

  updateSettings(partial: Partial<ShadowAccountSettings>): void {
    this._state.settings = { ...this._state.settings, ...partial };
  }

  /**
   * Centralized symbol change — updates all providers.
   * Same-symbol guard: skips providers already on this symbol.
   */
  setActiveSymbol(symbol: string): void {
    this._activeSymbol = symbol;
    const simSame = this._simulatedAdapter.activeSymbol() === symbol;
    const tvSame  = this._marketAdapter.activeSymbol()   === symbol;
    const ttSame  = tastytradeProvider.activeSymbol()    === symbol;
    if (!simSame) this._simulatedAdapter.subscribe(symbol);
    if (!tvSame)  this._marketAdapter.subscribe(symbol);
    // Always call subscribe() — it is safe in any auth state.
    // subscribe() stores _dxSymbol immediately; if the channel is not open yet,
    // the subscription is deferred and fires automatically when AUTHORIZED fires.
    if (!ttSame) tastytradeProvider.subscribe(symbol);
  }

  getActiveSymbol(): string {
    return this._activeSymbol;
  }

  getState(): ShadowAccountState {
    this._updateUnrealizedPnl();
    return JSON.parse(JSON.stringify(this._state)) as ShadowAccountState;
  }

  /** Force-close all open trades at current price (e.g., end of session). */
  flattenAll(): void {
    // Use active provider price — works with both Tradovate and simulated data
    const provider = this._getActiveProvider();
    const snap = provider.getSnapshot();
    const price = snap?.lastPrice;
    for (const t of [...this._state.openTrades]) {
      this._closeTrade(t, price ?? t.entryPrice, 'manual');
    }
  }

  // ── Phase 6: Promotion workflow API ────────────────────────────────────────

  getOperationMode(): TradingOperationMode { return this._operationMode; }

  setOperationMode(mode: TradingOperationMode): void {
    const prev = this._operationMode;
    this._operationMode = mode;
    if (mode !== 'shadow' && prev === 'shadow') {
      this._promotedAt = Date.now();
      this._demotedAt = undefined;
      this._demotionReason = undefined;
      this._resetPromotedCounters();
    }
    if (mode === 'shadow' && prev !== 'shadow') {
      this._demotedAt = Date.now();
      this._resetPromotedCounters();
      this._clearPendingTrade();
    }
  }

  demoteToShadow(reason: string): void {
    this._operationMode = 'shadow';
    this._demotedAt = Date.now();
    this._demotionReason = reason;
    this._resetPromotedCounters();
    this._clearPendingTrade();
  }

  getPromotionGuardrails(): PromotionGuardrails {
    return { paper: { ...this._promotionGuardrails.paper }, guardedLiveCandidate: { ...this._promotionGuardrails.guardedLiveCandidate } };
  }

  setPromotionGuardrails(g: PromotionGuardrails): void {
    this._promotionGuardrails = { paper: { ...g.paper }, guardedLiveCandidate: { ...g.guardedLiveCandidate } };
  }

  private _activeGuardrails(): ModeGuardrails {
    return this._operationMode === 'guarded_live_candidate'
      ? this._promotionGuardrails.guardedLiveCandidate
      : this._promotionGuardrails.paper;
  }

  getPromotionWorkflowStatus(): PromotionWorkflowStatus {
    return {
      currentMode: this._operationMode,
      promotedAt: this._promotedAt,
      demotedAt: this._demotedAt,
      demotionReason: this._demotionReason,
      dailyLossR: this._dailyLossRPromoted,
      tradesTodayPromoted: this._tradesTodayPromoted,
      consecutiveLosses: this._consecutiveLosses,
      activeGuardrails: { ...this._activeGuardrails() },
      guardrails: this.getPromotionGuardrails(),
      lastReadinessState: this._lastReadinessState,
    };
  }

  setLastReadinessState(state: StrategyReadinessState): void {
    this._lastReadinessState = state;
  }

  confirmPendingTrade(): boolean {
    if (!this._pendingTrade) return false;
    const { symbol, setup, advice, snap, councilVotes, candidateId } = this._pendingTrade;
    this._clearPendingTradeTimeout();
    this._pendingTrade = null;
    this._openTrade(symbol, setup, advice, snap, councilVotes, candidateId);
    return true;
  }

  rejectPendingTrade(): boolean {
    if (!this._pendingTrade) return false;
    const { snap, candidateId } = this._pendingTrade;
    this._clearPendingTrade();
    this._emitEvent(this._buildBlockEvent(
      'council_review', 'manual_confirmation_rejected',
      'Trade rejected by user (manual confirmation denied).',
      snap, { candidateId },
    ));
    return true;
  }

  hasPendingTrade(): boolean { return this._pendingTrade !== null; }

  getPendingTradeInfo(): { symbol: string; side: string; entry: number; stop: number; target: number; createdAt: number } | null {
    if (!this._pendingTrade) return null;
    const { symbol, setup, createdAt } = this._pendingTrade;
    return { symbol, side: setup.side!, entry: setup.entry!, stop: setup.stop!, target: setup.target!, createdAt };
  }

  private _resetPromotedCounters(): void {
    this._dailyLossRPromoted = 0;
    this._tradesTodayPromoted = 0;
    this._consecutiveLosses = 0;
  }

  private _clearPendingTrade(): void {
    this._clearPendingTradeTimeout();
    this._pendingTrade = null;
  }

  private _clearPendingTradeTimeout(): void {
    if (this._pendingTradeTimeout) {
      clearTimeout(this._pendingTradeTimeout);
      this._pendingTradeTimeout = null;
    }
  }

  // ── Eval loop ───────────────────────────────────────────────────────────────

  private _startEvalLoop(): void {
    this._stopEvalLoop();
    // Run immediately, then on interval
    void this._evalTick();
    this._evalTimer = setInterval(() => { void this._evalTick(); }, EVAL_INTERVAL_MS);
  }

  private _stopEvalLoop(): void {
    if (this._evalTimer) { clearInterval(this._evalTimer); this._evalTimer = null; }
  }

  private async _evalTick(): Promise<void> {
    this._resetDailyIfNeeded();

    // Re-check active provider each tick — Tradovate may have connected or
    // disconnected mid-session. The new price source becomes authoritative
    // for ongoing mark-to-market and exit triggers on existing positions.
    this._simulator.setProvider(this._getActiveProvider());

    // 1. Check existing open positions first (legacy path — uses Tradovate
    //    snapshot directly; when level engine is active, exits are handled
    //    by TriForgeShadowSimulator._checkExits() instead)
    const snap = tradovateService.getLastSnapshot();
    if (snap?.lastPrice !== undefined) {
      this._checkExitsOnSnapshot(snap);
    }

    // 2. Try to open a new position
    await this._evaluateEntry();
  }

  // ── Entry evaluation ─────────────────────────────────────────────────────────

  private async _evaluateEntry(): Promise<void> {
    // Phase 6: Block new evaluations while a manual confirmation is pending
    if (this._pendingTrade) return;

    // ── Level-to-Level engine path ───────────────────────────────────────────
    // When useLevelEngine=true, the new simulator is authoritative. It runs
    // its own analysis pipeline, council review, and simulated execution.
    // The legacy pipeline below is skipped entirely — no competing entries.
    if (this._strategyConfig.useLevelEngine) {
      await this._simulator.evalTick();
      // The simulator handles everything internally: analysis, council
      // review, and execution through ShadowOrderEngine. Regardless of
      // whether it produced a trade or not, the level engine is in charge.
      return;
    }

    const snap = tradovateService.getLastSnapshot();

    // ── limits_check ──────────────────────────────────────────────────────────
    if (!this._state.enabled) {
      this._emitBlock('limits_check', 'disabled', 'Shadow trading disabled.', snap);
      return;
    }
    if (this._state.paused) {
      this._emitBlock('limits_check', 'paused', 'Shadow trading paused.', snap);
      return;
    }
    if (!this._canOpenTrade()) {
      this._emitBlock('limits_check', this._lastLimitBlockReason!, this._state.blockedReason ?? '', snap);
      return;
    }

    // ── feed_check ────────────────────────────────────────────────────────────
    if (!snap || !snap.connected || !snap.lastPrice) {
      const reason: ShadowBlockReason = !snap ? 'no_snapshot' : !snap.connected ? 'not_connected' : 'no_price';
      this._state.blockedReason = 'Waiting for live price data.';
      this._emitBlock('feed_check', reason, this._state.blockedReason, snap);
      return;
    }
    if (snap.feedFreshnessMs !== undefined && snap.feedFreshnessMs > 8_000) {
      this._state.blockedReason = 'Feed stale — skipping evaluation.';
      this._emitBlock('feed_check', 'feed_stale', this._state.blockedReason, snap);
      return;
    }

    // Phase 2: require indicators to be ready before opening shadow trades
    if (snap.indicatorState !== 'ready') {
      this._state.blockedReason = `Indicators ${snap.indicatorState ?? 'unavailable'} — waiting for market data to warm up.`;
      this._emitBlock('feed_check', 'indicators_not_ready', this._state.blockedReason, snap);
      return;
    }

    const symbol = snap.symbol.toUpperCase();
    if (!this._state.settings.allowedSymbols.includes(symbol)) {
      this._state.blockedReason = `${symbol} not in allowed symbols.`;
      this._emitBlock('feed_check', 'symbol_not_allowed', this._state.blockedReason, snap);
      return;
    }

    // ── setup_detection (unthrottled from here on) ────────────────────────────
    const candidateId = crypto.randomUUID();
    const { setup, blockReason: setupBlockReason } = this._buildSetup(snap, symbol);
    if (!setup) {
      this._state.blockedReason = `No valid setup on ${symbol} (trend: ${snap.trend ?? 'unknown'}, position in range unclear).`;
      this._emitEvent(this._buildBlockEvent('setup_detection', setupBlockReason ?? 'no_setup', this._state.blockedReason, snap, { candidateId }));
      return;
    }

    // ── Phase 4: strategy config guard 1 (session/volatility/vwap/symbol) ────
    const cfgBlock = this._checkStrategyConfig(snap, setup);
    if (cfgBlock) {
      this._state.blockedReason = cfgBlock;
      this._emitEvent(this._buildBlockEvent('setup_detection', 'strategy_config_blocked', cfgBlock, snap, { candidateId, setupType: setup.setupType, side: setup.side as 'long' | 'short', entryPrice: setup.entry, stopPrice: setup.stop, targetPrice: setup.target }));
      return;
    }

    // ── rule_engine ───────────────────────────────────────────────────────────
    const advice = buildLiveTradeAdvice({
      snapshot:    snap,
      balance:     this._state.currentBalance,
      riskPercent: this._state.settings.riskPercentPerTrade,
      symbol,
      side:        setup.side!,
      entry:       setup.entry,
      stop:        setup.stop,
      target:      setup.target,
      thesis:      setup.thesis,
    });

    const ruleCtx: Partial<ShadowDecisionEvent> = {
      candidateId,
      setupType:      setup.setupType,
      side:           setup.side as 'long' | 'short',
      entryPrice:     setup.entry,
      stopPrice:      setup.stop,
      targetPrice:    setup.target,
      ruleVerdict:    advice.verdict,
      ruleConfidence: advice.confidence,
      rr:             advice.rr,
      suggestedSize:  advice.suggestedSize,
      strengthCount:  advice.strengths?.length ?? 0,
      warningCount:   advice.warnings?.length ?? 0,
      violationCount: advice.ruleViolations?.length ?? 0,
    };

    // ── Phase 4: strategy config guard 2 (warning cap) ──────────────────────
    if (this._strategyConfig.maxWarningsAllowed !== undefined &&
        (advice.warnings?.length ?? 0) > this._strategyConfig.maxWarningsAllowed) {
      const msg = `Config: warnings (${advice.warnings?.length ?? 0}) exceed max ${this._strategyConfig.maxWarningsAllowed}`;
      this._state.blockedReason = msg;
      this._emitEvent(this._buildBlockEvent('rule_engine', 'strategy_config_blocked', msg, snap, ruleCtx));
      return;
    }

    if (advice.verdict !== 'buy') {
      this._state.blockedReason = `Rule engine: ${advice.verdict} (${advice.confidence}). ${advice.summary}`;
      this._emitEvent(this._buildBlockEvent('rule_engine', 'verdict_not_buy', this._state.blockedReason, snap, ruleCtx));
      return;
    }
    if (advice.confidence === 'low') {
      this._state.blockedReason = `Rule engine: ${advice.verdict} (${advice.confidence}). ${advice.summary}`;
      this._emitEvent(this._buildBlockEvent('rule_engine', 'low_confidence', this._state.blockedReason, snap, ruleCtx));
      return;
    }
    if (!advice.suggestedSize || advice.suggestedSize < 1) {
      this._state.blockedReason = 'Shadow balance too small for 1 contract at this stop.';
      this._emitEvent(this._buildBlockEvent('rule_engine', 'size_too_small', this._state.blockedReason, snap, ruleCtx));
      return;
    }

    // ── council_review ────────────────────────────────────────────────────────
    if (!this._councilFn) {
      this._state.blockedReason = 'Council review not initialized — cannot open trade.';
      this._emitEvent(this._buildCouncilEvent(
        'council_not_initialized', this._state.blockedReason, snap, setup, advice, candidateId,
      ));
      return;
    }

    this._state.blockedReason = 'Council reviewing setup\u2026';
    let review: CouncilReviewResult;
    try {
      review = await this._councilFn(setup, snap, symbol);
    } catch (err) {
      this._state.blockedReason = `Council review error: ${err instanceof Error ? err.message : String(err)}`;
      this._emitEvent(this._buildCouncilEvent(
        'council_error', this._state.blockedReason, snap, setup, advice, candidateId,
      ));
      return;
    }

    if (!review.approved) {
      this._state.blockedReason = review.blockedReason ?? 'Council did not approve this setup.';
      this._state.councilBlockedReason = review.blockedReason;
      const rawCode = review.blockedCode;
      const code: ShadowBlockReason = rawCode === 'low_confidence'
        ? 'low_council_confidence'
        : (rawCode as ShadowBlockReason) ?? 'council_rejected';
      this._emitEvent(this._buildCouncilEvent(
        code, this._state.blockedReason, snap, setup, advice, candidateId, review.votes, false,
      ));
      return;
    }

    this._state.councilBlockedReason = undefined;

    // ── Phase 4: strategy config guard 3 (council confidence floor) ─────────
    if (this._strategyConfig.minCouncilAvgConfidence !== undefined && review.votes.length > 0) {
      const avgConf = review.votes.reduce((s, v) => s + (v.confidence ?? 0), 0) / review.votes.length;
      if (avgConf < this._strategyConfig.minCouncilAvgConfidence) {
        const msg = `Config: council avg confidence ${avgConf.toFixed(0)} < min ${this._strategyConfig.minCouncilAvgConfidence}`;
        this._state.blockedReason = msg;
        this._emitEvent(this._buildCouncilEvent(
          'strategy_config_blocked', msg, snap, setup, advice, candidateId, review.votes, true,
        ));
        return;
      }
    }

    // ── Phase 6: Manual confirmation gate (promoted modes only) ──────────────
    if (this._operationMode !== 'shadow' && this._activeGuardrails().manualConfirmation) {
      this._clearPendingTrade();
      this._pendingTrade = {
        symbol, setup, advice, snap, councilVotes: review.votes, candidateId, createdAt: Date.now(),
      };
      this._state.blockedReason = 'Awaiting manual confirmation to open trade.';
      this._emitEvent(this._buildBlockEvent(
        'council_review', 'manual_confirmation_pending',
        'Trade approved by council — awaiting manual user confirmation.',
        snap, { candidateId, setupType: setup.setupType, side: setup.side as 'long' | 'short', entryPrice: setup.entry, stopPrice: setup.stop, targetPrice: setup.target, councilVotes: review.votes, councilApproved: true },
      ));
      // Auto-expire after 60 seconds with distinct timeout reason
      this._pendingTradeTimeout = setTimeout(() => {
        if (this._pendingTrade?.candidateId === candidateId) {
          this._emitEvent(this._buildBlockEvent(
            'council_review', 'manual_confirmation_timeout',
            'Pending trade expired (60s timeout — no user response).',
            snap, { candidateId },
          ));
          this._pendingTrade = null;
          this._state.blockedReason = 'Pending trade expired (60s timeout).';
        }
      }, 60_000);
      return;
    }

    // ── trade_opened ──────────────────────────────────────────────────────────
    this._openTrade(symbol, setup, advice, snap, review.votes, candidateId);
  }

  // ── Setup builder (autonomous) ───────────────────────────────────────────────

  private _buildSetup(
    snap: LiveTradeSnapshot, symbol: string,
  ): { setup: ProposedTradeSetup | null; blockReason?: ShadowBlockReason } {
    const setup = buildTradeLevels(snap, symbol);
    if (setup.setupType === 'none' || !setup.side || !setup.entry || !setup.stop || !setup.target) {
      return { setup: null, blockReason: 'no_setup' };
    }
    // Phase 2: shadow trading only takes pullback continuations
    if (setup.setupType !== 'pullback_long' && setup.setupType !== 'pullback_short') {
      return { setup: null, blockReason: 'non_pullback' };
    }
    return { setup };
  }

  // ── Trade open ───────────────────────────────────────────────────────────────

  private _openTrade(
    symbol: string,
    setup: ProposedTradeSetup,
    advice: ReturnType<typeof buildLiveTradeAdvice>,
    snap: LiveTradeSnapshot,
    councilVotes: CouncilVote[] | undefined,
    candidateId: string,
  ): void {
    // Quality score: base 50, +20 for high confidence, +10 for medium,
    //   +20 if R:R >= 2.5, +10 if R:R >= 1.5, +10 if strengths >= 3, -10 per warning
    const rr = advice.rr ?? 0;
    const confidenceBonus = setup.confidence === 'high' ? 20 : setup.confidence === 'medium' ? 10 : 0;
    const rrBonus         = rr >= 2.5 ? 20 : rr >= 1.5 ? 10 : 0;
    const strengthBonus   = (advice.strengths?.length ?? 0) >= 3 ? 10 : 0;
    const warningPenalty  = (advice.warnings?.length ?? 0) * 10;
    const qualityScore    = Math.max(0, Math.min(100, 50 + confidenceBonus + rrBonus + strengthBonus - warningPenalty));

    // Invalidation rule: what price level would negate the setup
    const invalidationRule = setup.side === 'long'
      ? `Below stop at ${setup.stop} \u2014 setup fails if price violates this level before entry.`
      : `Above stop at ${setup.stop} \u2014 setup fails if price violates this level before entry.`;

    // Phase 7: Compute setup grade + explanation
    const avgCouncilConfidence = (councilVotes ?? []).length > 0
      ? (councilVotes ?? []).reduce((s: number, v: CouncilVote) => s + v.confidence, 0) / (councilVotes ?? []).length : 0;
    const agreementLabel = computeAgreementLabel(councilVotes ?? []);
    const trendAligned = setup.side === 'long'
      ? (snap.trend5m === 'up' || snap.trend15m === 'up')
      : (snap.trend5m === 'down' || snap.trend15m === 'down');
    const supportiveVwap = setup.side === 'long'
      ? (snap.vwapRelation === 'above' || snap.vwapRelation === 'at')
      : (snap.vwapRelation === 'below' || snap.vwapRelation === 'at');
    const setupGradeVal: SetupGrade = computeSetupGrade({
      councilVotes: councilVotes ?? [], councilApproved: true,
      warningCount: advice.warnings?.length ?? 0,
      violationCount: advice.ruleViolations?.length ?? 0,
      strengthCount: advice.strengths?.length ?? 0,
      sessionLabel: snap.sessionLabel, vwapRelation: snap.vwapRelation,
      trend5m: snap.trend5m, trend15m: snap.trend15m,
      side: setup.side as 'long' | 'short', volatilityRegime: snap.volatilityRegime,
    });
    const explanation: TradeDecisionExplanation = buildTradeDecisionExplanation({
      councilVotes: councilVotes ?? [], councilApproved: true,
      strengthCount: advice.strengths?.length ?? 0,
      warningCount: advice.warnings?.length ?? 0,
      violationCount: advice.ruleViolations?.length ?? 0,
      strengths: advice.strengths, warnings: advice.warnings,
      violations: advice.ruleViolations,
      side: setup.side! as 'long' | 'short',
      stopPrice: setup.stop, invalidationRule,
      sessionLabel: snap.sessionLabel, vwapRelation: snap.vwapRelation,
      trend5m: snap.trend5m, trend15m: snap.trend15m,
      volatilityRegime: snap.volatilityRegime,
      trendAligned, supportiveVwap, avgCouncilConfidence, agreementLabel,
      setupGrade: setupGradeVal,
    });

    const trade: ShadowTrade = {
      id:               crypto.randomUUID(),
      symbol,
      side:             setup.side!,
      entryPrice:       setup.entry!,
      stopPrice:        setup.stop!,
      targetPrice:      setup.target!,
      qty:              advice.suggestedSize!,
      status:           'open',
      openedAt:         Date.now(),
      reason:           setup.thesis,
      verdict:          `${advice.verdict} (${advice.confidence})`,
      setupType:        setup.setupType,
      invalidationRule,
      qualityScore,
      councilVotes,
      councilPassed:    true,
      // Phase 2: market context at entry
      atr5m:            snap.atr5m,
      vwap:             snap.vwap,
      vwapRelation:     snap.vwapRelation,
      trend5m:          snap.trend5m,
      trend15m:         snap.trend15m,
      sessionLabel:     snap.sessionLabel,
      volatilityRegime: snap.volatilityRegime,
      // Phase 3: MFE/MAE init at entry price
      mfPrice:          setup.entry!,
      maPrice:          setup.entry!,
      // Phase 7: Explainability
      explanation,
      setupGrade:       setupGradeVal,
    };
    this._state.openTrades.push(trade);
    this._state.tradesToday++;
    if (this._operationMode !== 'shadow') this._tradesTodayPromoted++;
    this._lastTradeOpenedAt = Date.now();
    this._state.lastEvalAt  = Date.now();
    this._state.blockedReason = undefined;

    // Phase 3: Emit trade_opened event
    this._emitEvent(this._buildOpenEvent(snap, trade, advice, candidateId, councilVotes));

    // Real-time copy-trade signal to renderer
    broadcastTradeAlert({
      type: 'trade_opened',
      source: 'controller',
      tradeId: trade.id,
      symbol: trade.symbol,
      symbolLabel: symbolLabel(trade.symbol),
      side: trade.side,
      entryPrice: trade.entryPrice,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice,
      qty: trade.qty,
      timestamp: trade.openedAt,
      setupGrade: trade.setupGrade,
      confidence: setup.confidence,
      qualityScore,
    });
  }

  // ── Price-based exit check ───────────────────────────────────────────────────

  private _checkExitsOnSnapshot(snap: LiveTradeSnapshot): void {
    const price = snap.lastPrice!;
    for (const trade of [...this._state.openTrades]) {
      // Phase 3: Update MFE/MAE tracking on every tick
      const excursions = updateExcursions(
        trade.side, trade.entryPrice,
        trade.mfPrice, trade.maPrice, price,
      );
      trade.mfPrice = excursions.mfPrice;
      trade.maPrice = excursions.maPrice;

      if (trade.side === 'long') {
        if (price <= trade.stopPrice)  { this._closeTrade(trade, trade.stopPrice,  'stop');   continue; }
        if (price >= trade.targetPrice){ this._closeTrade(trade, trade.targetPrice, 'target'); continue; }
      } else {
        if (price >= trade.stopPrice)  { this._closeTrade(trade, trade.stopPrice,  'stop');   continue; }
        if (price <= trade.targetPrice){ this._closeTrade(trade, trade.targetPrice, 'target'); continue; }
      }
    }
  }

  // ── Trade close ──────────────────────────────────────────────────────────────

  private _closeTrade(trade: ShadowTrade, exitPrice: number, reason: string): void {
    const meta = INSTRUMENT_META[trade.symbol];
    const pointValue = meta?.pointValue ?? 1;

    const pnl = trade.side === 'long'
      ? (exitPrice - trade.entryPrice) * trade.qty * pointValue
      : (trade.entryPrice - exitPrice) * trade.qty * pointValue;

    const riskPoints  = Math.abs(trade.entryPrice - trade.stopPrice);
    const pnlPoints   = trade.side === 'long'
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;
    const pnlR        = riskPoints > 0 ? pnlPoints / riskPoints : 0;

    // Phase 3: Compute excursion-R at close
    const excR = computeExcursionR(
      trade.side, trade.entryPrice, trade.stopPrice,
      trade.mfPrice ?? trade.entryPrice,
      trade.maPrice ?? trade.entryPrice,
    );

    trade.status     = 'closed';
    trade.closedAt   = Date.now();
    trade.exitPrice  = exitPrice;
    trade.exitReason = reason;
    trade.pnl        = pnl;
    trade.pnlR       = pnlR;
    trade.mfeR       = excR.mfeR;
    trade.maeR       = excR.maeR;
    delete trade.unrealizedPnl;

    this._state.openTrades   = this._state.openTrades.filter(t => t.id !== trade.id);
    this._state.closedTrades = [trade, ...this._state.closedTrades].slice(0, MAX_CLOSED_HISTORY);
    this._state.currentBalance += pnl;
    this._state.dailyPnL       += pnl;

    // Phase 6: Update promoted-mode loss counters and check demotion
    if (this._operationMode !== 'shadow') {
      if (pnlR < 0) {
        this._dailyLossRPromoted += Math.abs(pnlR);
        this._consecutiveLosses++;
      } else {
        this._consecutiveLosses = 0;
      }
      const g = this._activeGuardrails();
      if (g.autoDemotionEnabled) {
        if (this._dailyLossRPromoted >= g.dailyLossCapR) {
          this.demoteToShadow(`Daily loss cap breached: ${this._dailyLossRPromoted.toFixed(2)}R >= ${g.dailyLossCapR}R`);
        } else if (this._consecutiveLosses >= g.lossStreakDemotion) {
          this.demoteToShadow(`Loss streak: ${this._consecutiveLosses} consecutive losses >= limit of ${g.lossStreakDemotion}`);
        }
      }
    }

    // Phase 3: Emit trade_closed event
    this._emitEvent(this._buildCloseEvent(trade));

    // Real-time copy-trade signal to renderer
    broadcastTradeAlert({
      type: 'trade_closed',
      source: 'controller',
      tradeId: trade.id,
      symbol: trade.symbol,
      symbolLabel: symbolLabel(trade.symbol),
      side: trade.side,
      entryPrice: trade.entryPrice,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice,
      qty: trade.qty,
      timestamp: Date.now(),
      exitPrice: trade.exitPrice,
      exitReason: trade.exitReason,
      pnl: trade.pnl,
      pnlR: trade.pnlR,
    });
  }

  // ── Unrealized P/L update ────────────────────────────────────────────────────

  private _updateUnrealizedPnl(): void {
    // Use active provider price — works with both Tradovate and simulated data
    const provider = this._getActiveProvider();
    const snap = provider.getSnapshot();
    if (!snap?.lastPrice) return;
    const price = snap.lastPrice;
    for (const trade of this._state.openTrades) {
      const meta = INSTRUMENT_META[trade.symbol];
      const pv   = meta?.pointValue ?? 1;
      trade.unrealizedPnl = trade.side === 'long'
        ? (price - trade.entryPrice) * trade.qty * pv
        : (trade.entryPrice - price) * trade.qty * pv;
    }
  }

  // ── Limit checks ─────────────────────────────────────────────────────────────

  private _canOpenTrade(): boolean {
    const s = this._state;

    if (s.openTrades.length >= s.settings.maxConcurrentPositions) {
      s.blockedReason = `Max ${s.settings.maxConcurrentPositions} concurrent position(s) active.`;
      this._lastLimitBlockReason = 'max_concurrent';
      return false;
    }
    if (s.tradesToday >= s.settings.maxTradesPerDay) {
      s.blockedReason = `Daily limit of ${s.settings.maxTradesPerDay} trades reached.`;
      this._lastLimitBlockReason = 'daily_trade_limit';
      return false;
    }
    const maxLoss = -(s.startingBalance * s.settings.maxDailyLossPercent / 100);
    if (s.dailyPnL <= maxLoss) {
      s.blockedReason = `Daily loss limit hit ($${Math.abs(maxLoss).toFixed(0)}).`;
      this._lastLimitBlockReason = 'daily_loss_limit';
      return false;
    }
    if (Date.now() - this._lastTradeOpenedAt < TRADE_COOLDOWN_MS) {
      const remaining = Math.ceil((TRADE_COOLDOWN_MS - (Date.now() - this._lastTradeOpenedAt)) / 1000);
      s.blockedReason = `Cooling down \u2014 next eval in ${remaining}s.`;
      this._lastLimitBlockReason = 'cooldown_active';
      return false;
    }

    // ── Phase 6: Promoted-mode guardrail limits ─────────────────────────────
    if (this._operationMode !== 'shadow') {
      const g = this._activeGuardrails();
      if (this._tradesTodayPromoted >= g.maxTradesPerDay) {
        s.blockedReason = `Promoted-mode daily trade limit (${g.maxTradesPerDay}) reached.`;
        this._lastLimitBlockReason = 'promotion_guardrail_blocked';
        return false;
      }
      if (this._dailyLossRPromoted >= g.dailyLossCapR) {
        s.blockedReason = `Promoted-mode daily loss cap (${g.dailyLossCapR}R) reached.`;
        this._lastLimitBlockReason = 'promotion_guardrail_blocked';
        if (g.autoDemotionEnabled) {
          this.demoteToShadow(`Daily loss cap breached: ${this._dailyLossRPromoted.toFixed(2)}R >= ${g.dailyLossCapR}R`);
        }
        return false;
      }
    }

    s.blockedReason = undefined;
    this._lastLimitBlockReason = undefined;
    return true;
  }

  // ── Daily reset ──────────────────────────────────────────────────────────────

  private _resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this._todayKey !== today) {
      this._todayKey          = today;
      this._state.dailyPnL    = 0;
      this._state.tradesToday = 0;
      // Phase 6: reset promoted-mode daily counters (consecutive losses persist)
      this._dailyLossRPromoted = 0;
      this._tradesTodayPromoted = 0;
    }
  }

  // ── Analytics event builders (Phase 3) ─────────────────────────────────────

  /** Extract snapshot fields relevant to analytics events. */
  private _snapContext(snap?: LiveTradeSnapshot | null): Partial<ShadowDecisionEvent> {
    if (!snap) return {};
    return {
      symbol:           snap.symbol?.toUpperCase(),
      lastPrice:        snap.lastPrice,
      feedFreshnessMs:  snap.feedFreshnessMs,
      sessionLabel:     snap.sessionLabel,
      volatilityRegime: snap.volatilityRegime,
      trend5m:          snap.trend5m,
      trend15m:         snap.trend15m,
      vwapRelation:     snap.vwapRelation,
      atr5m:            snap.atr5m,
    };
  }

  /** Build a generic block event (limits_check, feed_check, setup_detection, rule_engine). */
  private _buildBlockEvent(
    stage: ShadowDecisionStage,
    blockReason: ShadowBlockReason,
    blockMessage: string,
    snap?: LiveTradeSnapshot | null,
    extra?: Partial<ShadowDecisionEvent>,
  ): ShadowDecisionEvent {
    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      stage,
      operationMode: this._operationMode,
      blockReason,
      blockMessage,
      ...this._snapContext(snap),
      ...(extra ?? {}),
    } as ShadowDecisionEvent;
  }

  /** Build a council_review event (blocked or approved-but-rejected). */
  private _buildCouncilEvent(
    blockReason: ShadowBlockReason,
    blockMessage: string,
    snap: LiveTradeSnapshot,
    setup: ProposedTradeSetup,
    advice: ReturnType<typeof buildLiveTradeAdvice>,
    candidateId: string,
    votes?: CouncilVote[],
    approved?: boolean,
  ): ShadowDecisionEvent {
    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      stage: 'council_review' as ShadowDecisionStage,
      operationMode: this._operationMode,
      blockReason,
      blockMessage,
      candidateId,
      ...this._snapContext(snap),
      setupType:      setup.setupType,
      side:           setup.side as 'long' | 'short',
      entryPrice:     setup.entry,
      stopPrice:      setup.stop,
      targetPrice:    setup.target,
      ruleVerdict:    advice.verdict,
      ruleConfidence: advice.confidence,
      rr:             advice.rr,
      suggestedSize:  advice.suggestedSize,
      strengthCount:  advice.strengths?.length ?? 0,
      warningCount:   advice.warnings?.length ?? 0,
      violationCount: advice.ruleViolations?.length ?? 0,
      councilVotes:   votes,
      councilApproved: approved ?? false,
      setupGrade: votes ? computeSetupGrade({
        councilVotes: votes, councilApproved: approved ?? false,
        warningCount: advice.warnings?.length ?? 0,
        violationCount: advice.ruleViolations?.length ?? 0,
        strengthCount: advice.strengths?.length ?? 0,
        sessionLabel: snap.sessionLabel, vwapRelation: snap.vwapRelation,
        trend5m: snap.trend5m, trend15m: snap.trend15m,
        side: setup.side as 'long' | 'short', volatilityRegime: snap.volatilityRegime,
      }) : undefined,
    } as ShadowDecisionEvent;
  }

  /** Build a trade_opened event. */
  private _buildOpenEvent(
    snap: LiveTradeSnapshot,
    trade: ShadowTrade,
    advice: ReturnType<typeof buildLiveTradeAdvice>,
    candidateId: string,
    councilVotes?: CouncilVote[],
  ): ShadowDecisionEvent {
    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      stage: 'trade_opened' as ShadowDecisionStage,
      operationMode: this._operationMode,
      candidateId,
      ...this._snapContext(snap),
      setupType:      trade.setupType,
      side:           trade.side,
      entryPrice:     trade.entryPrice,
      stopPrice:      trade.stopPrice,
      targetPrice:    trade.targetPrice,
      qualityScore:   trade.qualityScore,
      setupGrade:     trade.setupGrade,
      ruleVerdict:    advice.verdict,
      ruleConfidence: advice.confidence,
      rr:             advice.rr,
      suggestedSize:  advice.suggestedSize,
      strengthCount:  advice.strengths?.length ?? 0,
      warningCount:   advice.warnings?.length ?? 0,
      violationCount: advice.ruleViolations?.length ?? 0,
      councilVotes,
      councilApproved: true,
      tradeId:        trade.id,
    } as ShadowDecisionEvent;
  }

  /** Build a trade_closed event. */
  private _buildCloseEvent(trade: ShadowTrade): ShadowDecisionEvent {
    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      stage: 'trade_closed' as ShadowDecisionStage,
      operationMode: this._operationMode,
      tradeId:          trade.id,
      symbol:           trade.symbol,
      side:             trade.side,
      entryPrice:       trade.entryPrice,
      stopPrice:        trade.stopPrice,
      targetPrice:      trade.targetPrice,
      setupType:        trade.setupType,
      sessionLabel:     trade.sessionLabel,
      volatilityRegime: trade.volatilityRegime,
      exitPrice:        trade.exitPrice,
      exitReason:       trade.exitReason,
      pnl:              trade.pnl,
      pnlR:             trade.pnlR,
      mfeR:             trade.mfeR,
      maeR:             trade.maeR,
      timeInTradeMs:    trade.closedAt ? trade.closedAt - trade.openedAt : 0,
      councilVotes:     trade.councilVotes,
      councilApproved:  true,
      setupGrade:       trade.setupGrade,
    } as ShadowDecisionEvent;
  }

  // ── Emit helpers ────────────────────────────────────────────────────────────

  /** Emit a block event for limits_check or feed_check with throttle. */
  private _emitBlock(
    stage: 'limits_check' | 'feed_check',
    blockReason: ShadowBlockReason,
    blockMessage: string,
    snap?: LiveTradeSnapshot | null,
  ): void {
    const symbol = snap?.symbol?.toUpperCase() ?? '';
    const key = `${stage}:${blockReason}:${symbol}`;
    const now = Date.now();
    const last = this._lastEmittedBlock.get(key);
    if (last && now - last < BLOCK_THROTTLE_MS) return;
    this._lastEmittedBlock.set(key, now);
    shadowAnalyticsStore.append(this._buildBlockEvent(stage, blockReason, blockMessage, snap));
  }

  /** Emit an event unconditionally (setup_detection, rule_engine, council, open, close). */
  private _emitEvent(event: ShadowDecisionEvent): void {
    shadowAnalyticsStore.append(event);
  }

  // ── Phase 4: Strategy config check ──────────────────────────────────────────

  /**
   * Check strategy config against current snapshot and setup.
   * Returns a block message string if blocked, or null if allowed.
   * Each check is no-op when the config field is undefined or empty.
   */
  private _checkStrategyConfig(snap: LiveTradeSnapshot, setup: ProposedTradeSetup): string | null {
    const cfg = this._strategyConfig;

    if (cfg.allowedSessions && cfg.allowedSessions.length > 0 && snap.sessionLabel) {
      if (!cfg.allowedSessions.includes(snap.sessionLabel)) {
        return `Config: session ${snap.sessionLabel} not in allowedSessions [${cfg.allowedSessions.join(', ')}]`;
      }
    }

    if (cfg.blockedVolatilityRegimes && cfg.blockedVolatilityRegimes.length > 0 && snap.volatilityRegime) {
      if (cfg.blockedVolatilityRegimes.includes(snap.volatilityRegime)) {
        return `Config: volatility ${snap.volatilityRegime} blocked by config`;
      }
    }

    if (cfg.blockedVwapRelations && cfg.blockedVwapRelations.length > 0 && snap.vwapRelation) {
      if (cfg.blockedVwapRelations.includes(snap.vwapRelation)) {
        return `Config: VWAP ${snap.vwapRelation} blocked by config`;
      }
    }

    const symbol = snap.symbol?.toUpperCase();
    if (cfg.preferredSymbols && cfg.preferredSymbols.length > 0 && symbol) {
      if (!cfg.preferredSymbols.includes(symbol as never)) {
        return `Config: symbol ${symbol} not in preferredSymbols [${cfg.preferredSymbols.join(', ')}]`;
      }
    }

    return null;
  }

  // ── Fresh state ──────────────────────────────────────────────────────────────

  private _freshState(): ShadowAccountState {
    return {
      enabled:         false,
      paused:          false,
      settings:        { ...DEFAULT_SETTINGS },
      startingBalance: DEFAULT_SETTINGS.startingBalance,
      currentBalance:  DEFAULT_SETTINGS.startingBalance,
      dailyPnL:        0,
      tradesToday:     0,
      openTrades:      [],
      closedTrades:    [],
    };
  }
}

export const shadowTradingController = new ShadowTradingControllerClass();
