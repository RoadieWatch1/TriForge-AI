// ── main/trading/paperEngine.ts ───────────────────────────────────────────────
//
// Paper Trading Execution Engine
//
// Tracks open paper positions, computes unrealized P/L from the last known
// price tick, handles position close with realized P/L, and persists all
// state to the store KV so it survives app restarts.
//
// Storage keys:
//   paper_balance         → number  (current virtual cash balance)
//   paper_positions       → PaperPosition[] (open positions, JSON)
//   paper_closed_trades   → PaperClosedTrade[] (last 100, newest first, JSON)

import crypto from 'crypto';
import type { Store } from '../store';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaperPosition {
  id: string;
  ticker: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  size: number;
  riskPercent: number;
  thesis: string;
  openedAt: number;
  /** Updated on each getState() call when a price is provided. */
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
}

export interface PaperClosedTrade {
  id: string;
  ticker: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  size: number;
  riskPercent: number;
  thesis: string;
  openedAt: number;
  closedAt: number;
  exitReason: 'manual' | 'stop' | 'target';
  pnl: number;
  pnlPct: number;
  pnlR: number;
}

export interface PaperEngineState {
  balance: number;
  startingBalance: number;
  openPositions: PaperPosition[];
  closedTrades: PaperClosedTrade[];
  totalRealizedPnl: number;
  totalRealizedPnlPct: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KEY_BALANCE        = 'paper_balance';
const KEY_POSITIONS      = 'paper_positions';
const KEY_CLOSED         = 'paper_closed_trades';
const MAX_CLOSED_HISTORY = 100;
const DEFAULT_BALANCE    = 10_000;

// ── Engine ────────────────────────────────────────────────────────────────────

export class PaperEngine {
  constructor(private readonly store: Store) {}

  // ── Balance ──────────────────────────────────────────────────────────────

  getBalance(): number {
    return this.store.get<number>(KEY_BALANCE, DEFAULT_BALANCE);
  }

  setBalance(amount: number): void {
    this.store.update(KEY_BALANCE, amount);
  }

  // ── Open positions ────────────────────────────────────────────────────────

  getOpenPositions(): PaperPosition[] {
    return this.store.get<PaperPosition[]>(KEY_POSITIONS, []);
  }

  private _saveOpenPositions(positions: PaperPosition[]): void {
    this.store.update(KEY_POSITIONS, positions);
  }

  // ── Closed trades ─────────────────────────────────────────────────────────

  getClosedTrades(): PaperClosedTrade[] {
    return this.store.get<PaperClosedTrade[]>(KEY_CLOSED, []);
  }

  private _saveClosedTrades(trades: PaperClosedTrade[]): void {
    this.store.update(KEY_CLOSED, trades.slice(0, MAX_CLOSED_HISTORY));
  }

  // ── Open a position ───────────────────────────────────────────────────────

  openPosition(params: {
    ticker: string;
    side: 'long' | 'short';
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    size: number;
    riskPercent: number;
    thesis: string;
  }): PaperPosition {
    const position: PaperPosition = {
      id:          crypto.randomUUID(),
      ticker:      params.ticker.toUpperCase(),
      side:        params.side,
      entryPrice:  params.entryPrice,
      stopPrice:   params.stopPrice,
      targetPrice: params.targetPrice,
      size:        params.size,
      riskPercent: params.riskPercent,
      thesis:      params.thesis,
      openedAt:    Date.now(),
    };

    const positions = this.getOpenPositions();
    positions.push(position);
    this._saveOpenPositions(positions);
    return position;
  }

  // ── Close a position ──────────────────────────────────────────────────────

  closePosition(id: string, exitPrice: number, reason: 'manual' | 'stop' | 'target'): PaperClosedTrade | null {
    const positions = this.getOpenPositions();
    const idx       = positions.findIndex(p => p.id === id);
    if (idx === -1) return null;

    const pos  = positions[idx];
    const pnl  = pos.side === 'long'
      ? (exitPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - exitPrice) * pos.size;

    const startBalance = this.store.get<number>('paper_balance_start', DEFAULT_BALANCE);
    const pnlPct       = startBalance > 0 ? (pnl / startBalance) * 100 : 0;
    const riskPts      = Math.abs(pos.entryPrice - pos.stopPrice);
    const pnlPts       = pos.side === 'long'
      ? exitPrice - pos.entryPrice
      : pos.entryPrice - exitPrice;
    const pnlR         = riskPts > 0 ? pnlPts / riskPts : 0;

    const closed: PaperClosedTrade = {
      id:          pos.id,
      ticker:      pos.ticker,
      side:        pos.side,
      entryPrice:  pos.entryPrice,
      exitPrice,
      stopPrice:   pos.stopPrice,
      targetPrice: pos.targetPrice,
      size:        pos.size,
      riskPercent: pos.riskPercent,
      thesis:      pos.thesis,
      openedAt:    pos.openedAt,
      closedAt:    Date.now(),
      exitReason:  reason,
      pnl,
      pnlPct,
      pnlR,
    };

    // Update balance
    const newBalance = this.getBalance() + pnl;
    this.setBalance(newBalance);

    // Remove from open, prepend to closed
    positions.splice(idx, 1);
    this._saveOpenPositions(positions);

    const closed_list = this.getClosedTrades();
    this._saveClosedTrades([closed, ...closed_list]);

    return closed;
  }

  // ── Full state snapshot ───────────────────────────────────────────────────

  getState(lastPriceByTicker?: Record<string, number>): PaperEngineState {
    const balance    = this.getBalance();
    const positions  = this.getOpenPositions();
    const closed     = this.getClosedTrades();

    // Update unrealized P/L for open positions
    if (lastPriceByTicker) {
      for (const pos of positions) {
        const price = lastPriceByTicker[pos.ticker];
        if (price !== undefined) {
          const pnl       = pos.side === 'long'
            ? (price - pos.entryPrice) * pos.size
            : (pos.entryPrice - price) * pos.size;
          const startBal  = this.store.get<number>('paper_balance_start', DEFAULT_BALANCE);
          pos.unrealizedPnl    = pnl;
          pos.unrealizedPnlPct = startBal > 0 ? (pnl / startBal) * 100 : 0;
        }
      }
    }

    const totalRealizedPnl    = closed.reduce((s, t) => s + t.pnl, 0);
    const startingBalance     = this.store.get<number>('paper_balance_start', DEFAULT_BALANCE);
    const totalRealizedPnlPct = startingBalance > 0 ? (totalRealizedPnl / startingBalance) * 100 : 0;
    const winCount  = closed.filter(t => t.pnl > 0).length;
    const lossCount = closed.filter(t => t.pnl < 0).length;
    const winRate   = (winCount + lossCount) > 0
      ? (winCount / (winCount + lossCount)) * 100
      : 0;

    return {
      balance,
      startingBalance,
      openPositions:        positions,
      closedTrades:         closed,
      totalRealizedPnl,
      totalRealizedPnlPct,
      winCount,
      lossCount,
      winRate,
    };
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset(newBalance?: number): void {
    const bal = newBalance ?? DEFAULT_BALANCE;
    this.store.update(KEY_BALANCE, bal);
    this.store.update('paper_balance_start', bal);
    this.store.update(KEY_POSITIONS, []);
    this.store.update(KEY_CLOSED, []);
  }

  // ── Init (set starting balance if not already set) ─────────────────────────

  init(): void {
    const existing = this.store.get<number | undefined>('paper_balance_start', undefined as any);
    if (existing === undefined || existing === null) {
      const current = this.getBalance();
      this.store.update('paper_balance_start', current);
    }
  }
}
