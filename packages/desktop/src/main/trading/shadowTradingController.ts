// ── main/trading/shadowTradingController.ts ───────────────────────────────────
//
// Shadow Trading Mode — Triforge places simulated trades alongside the user.
// SIMULATION ONLY. No real brokerage orders are ever placed.
//
// Architecture:
//   - Runs an eval loop every EVAL_INTERVAL_MS in the main process.
//   - Gets live price data from tradovateService (already connected).
//   - Calls buildLiveTradeAdvice (pure rule engine) to validate setups.
//   - Manages a shadow account: virtual balance, open/closed positions, daily limits.
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
import { buildLiveTradeAdvice, buildTradeLevels, INSTRUMENT_META } from '@triforge/engine';
import type { LiveTradeSnapshot, ProposedTradeSetup } from '@triforge/engine';
import type { ShadowTrade, ShadowAccountState, ShadowAccountSettings, CouncilVote } from '@triforge/engine';

// ── Council review callback type ──────────────────────────────────────────────
// Injected from ipc.ts after engine init. Runs the 3-AI vote in the main process.

export interface CouncilReviewResult {
  approved: boolean;
  votes: CouncilVote[];
  blockedReason?: string;
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

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Inject the council review callback from the main process (ipc.ts). Must be
   *  called once after engine init. Without this, no shadow trades will open. */
  setCouncilFn(fn: CouncilReviewFn): void {
    this._councilFn = fn;
  }

  enable(): void {
    this._resetDailyIfNeeded();
    this._state.enabled = true;
    this._state.paused  = false;
    this._startEvalLoop();
  }

  disable(): void {
    this._state.enabled = false;
    this._state.paused  = false;
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
  }

  updateSettings(partial: Partial<ShadowAccountSettings>): void {
    this._state.settings = { ...this._state.settings, ...partial };
  }

  getState(): ShadowAccountState {
    this._updateUnrealizedPnl();
    return JSON.parse(JSON.stringify(this._state)) as ShadowAccountState;
  }

  /** Force-close all open trades at current price (e.g., end of session). */
  flattenAll(): void {
    const snap = tradovateService.getLastSnapshot();
    const price = snap?.lastPrice;
    for (const t of [...this._state.openTrades]) {
      this._closeTrade(t, price ?? t.entryPrice, 'manual');
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

    // 1. Check existing open positions first
    const snap = tradovateService.getLastSnapshot();
    if (snap?.lastPrice !== undefined) {
      this._checkExitsOnSnapshot(snap);
    }

    // 2. Try to open a new position
    await this._evaluateEntry();
  }

  // ── Entry evaluation ─────────────────────────────────────────────────────────

  private async _evaluateEntry(): Promise<void> {
    if (!this._state.enabled || this._state.paused) return;
    if (!this._canOpenTrade()) return;

    const snap = tradovateService.getLastSnapshot();
    if (!snap || !snap.connected || !snap.lastPrice) {
      this._state.blockedReason = 'Waiting for live price data.';
      return;
    }
    if (snap.feedFreshnessMs !== undefined && snap.feedFreshnessMs > 8_000) {
      this._state.blockedReason = 'Feed stale — skipping evaluation.';
      return;
    }

    const symbol = snap.symbol.toUpperCase();
    if (!this._state.settings.allowedSymbols.includes(symbol)) {
      this._state.blockedReason = `${symbol} not in allowed symbols.`;
      return;
    }

    // Build autonomous setup from live snapshot using buildTradeLevels
    const setup = this._buildSetup(snap, symbol);
    if (!setup) {
      this._state.blockedReason = `No valid setup on ${symbol} (trend: ${snap.trend ?? 'unknown'}, position in range unclear).`;
      return;
    }

    // Validate with rule engine
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

    if (advice.verdict !== 'buy' || advice.confidence === 'low') {
      this._state.blockedReason = `Rule engine: ${advice.verdict} (${advice.confidence}). ${advice.summary}`;
      return;
    }

    if (!advice.suggestedSize || advice.suggestedSize < 1) {
      this._state.blockedReason = 'Shadow balance too small for 1 contract at this stop.';
      return;
    }

    // ── Council gate — required before any shadow trade opens ─────────────────
    // All 3 AIs must vote. ≥2 TAKE + Grok does not REJECT + avg confidence ≥ 60.
    if (!this._councilFn) {
      this._state.blockedReason = 'Council review not initialized — cannot open trade.';
      return;
    }

    this._state.blockedReason = 'Council reviewing setup…';
    let review: CouncilReviewResult;
    try {
      review = await this._councilFn(setup, snap, symbol);
    } catch (err) {
      this._state.blockedReason = `Council review error: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    if (!review.approved) {
      this._state.blockedReason = review.blockedReason ?? 'Council did not approve this setup.';
      this._state.councilBlockedReason = review.blockedReason;
      return;
    }

    this._state.councilBlockedReason = undefined;

    // Open the shadow trade — council approved
    this._openTrade(symbol, setup, advice, review.votes);
  }

  // ── Setup builder (autonomous) ───────────────────────────────────────────────

  private _buildSetup(snap: LiveTradeSnapshot, symbol: string): ProposedTradeSetup | null {
    const setup = buildTradeLevels(snap, symbol);
    if (setup.setupType === 'none' || !setup.side || !setup.entry || !setup.stop || !setup.target) {
      return null;
    }
    return setup;
  }

  // ── Trade open ───────────────────────────────────────────────────────────────

  private _openTrade(
    symbol: string,
    setup: ProposedTradeSetup,
    advice: ReturnType<typeof buildLiveTradeAdvice>,
    councilVotes?: CouncilVote[],
  ): void {
    // Quality score: base 50, +20 for high confidence, +10 for medium,
    //   +20 if R:R ≥ 2.5, +10 if R:R ≥ 1.5, +10 if strengths ≥ 3, -10 per warning
    const rr = advice.rr ?? 0;
    const confidenceBonus = setup.confidence === 'high' ? 20 : setup.confidence === 'medium' ? 10 : 0;
    const rrBonus         = rr >= 2.5 ? 20 : rr >= 1.5 ? 10 : 0;
    const strengthBonus   = (advice.strengths?.length ?? 0) >= 3 ? 10 : 0;
    const warningPenalty  = (advice.warnings?.length ?? 0) * 10;
    const qualityScore    = Math.max(0, Math.min(100, 50 + confidenceBonus + rrBonus + strengthBonus - warningPenalty));

    // Invalidation rule: what price level would negate the setup
    const invalidationRule = setup.side === 'long'
      ? `Below stop at ${setup.stop} — setup fails if price violates this level before entry.`
      : `Above stop at ${setup.stop} — setup fails if price violates this level before entry.`;

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
    };
    this._state.openTrades.push(trade);
    this._state.tradesToday++;
    this._lastTradeOpenedAt = Date.now();
    this._state.lastEvalAt  = Date.now();
    this._state.blockedReason = undefined;
  }

  // ── Price-based exit check ───────────────────────────────────────────────────

  private _checkExitsOnSnapshot(snap: LiveTradeSnapshot): void {
    const price = snap.lastPrice!;
    for (const trade of [...this._state.openTrades]) {
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

    trade.status     = 'closed';
    trade.closedAt   = Date.now();
    trade.exitPrice  = exitPrice;
    trade.exitReason = reason;
    trade.pnl        = pnl;
    trade.pnlR       = pnlR;
    delete trade.unrealizedPnl;

    this._state.openTrades   = this._state.openTrades.filter(t => t.id !== trade.id);
    this._state.closedTrades = [trade, ...this._state.closedTrades].slice(0, MAX_CLOSED_HISTORY);
    this._state.currentBalance += pnl;
    this._state.dailyPnL       += pnl;
  }

  // ── Unrealized P/L update ────────────────────────────────────────────────────

  private _updateUnrealizedPnl(): void {
    const snap = tradovateService.getLastSnapshot();
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
      return false;
    }
    if (s.tradesToday >= s.settings.maxTradesPerDay) {
      s.blockedReason = `Daily limit of ${s.settings.maxTradesPerDay} trades reached.`;
      return false;
    }
    const maxLoss = -(s.startingBalance * s.settings.maxDailyLossPercent / 100);
    if (s.dailyPnL <= maxLoss) {
      s.blockedReason = `Daily loss limit hit ($${Math.abs(maxLoss).toFixed(0)}).`;
      return false;
    }
    if (Date.now() - this._lastTradeOpenedAt < TRADE_COOLDOWN_MS) {
      const remaining = Math.ceil((TRADE_COOLDOWN_MS - (Date.now() - this._lastTradeOpenedAt)) / 1000);
      s.blockedReason = `Cooling down — next eval in ${remaining}s.`;
      return false;
    }

    s.blockedReason = undefined;
    return true;
  }

  // ── Daily reset ──────────────────────────────────────────────────────────────

  private _resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this._todayKey !== today) {
      this._todayKey          = today;
      this._state.dailyPnL    = 0;
      this._state.tradesToday = 0;
    }
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
