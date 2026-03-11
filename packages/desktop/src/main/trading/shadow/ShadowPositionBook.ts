// ── main/trading/shadow/ShadowPositionBook.ts ─────────────────────────────────
//
// In-memory book tracking pending orders, open positions, and closed
// positions for the level-to-level shadow simulator.
//
// Deterministic and broker-agnostic. All state is in-memory; no persistence.
// Reset clears everything.
//
// SIMULATION ONLY. No real brokerage orders.

import type { RouteDirection } from '@triforge/engine';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStatus = 'pending' | 'filled' | 'cancelled';
export type PositionStatus = 'open' | 'closed';

export interface ShadowOrder {
  id: string;
  symbol: string;
  side: RouteDirection;
  /** Intended entry price (may differ from fill price due to slippage). */
  intendedEntry: number;
  stopPrice: number;
  targetPrice: number;
  /** Size in contracts. */
  qty: number;
  status: OrderStatus;
  /** Reference to the TradeIntent that generated this order. */
  intentId: string;
  /** Reference to the WatchAlert that confirmed this trade. */
  watchId: string;
  createdAt: number;
  filledAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
}

export interface ShadowPosition {
  id: string;
  orderId: string;
  symbol: string;
  side: RouteDirection;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  status: PositionStatus;
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  exitReason?: string;
  /** Realized P&L in points (not dollars). */
  realizedPnlPoints?: number;
  /** Maximum favorable excursion in points. */
  mfePoints: number;
  /** Maximum adverse excursion in points. */
  maePoints: number;
  /** R-multiple (realized P&L / stop distance). */
  rMultiple?: number;
  /** Reference IDs for traceability. */
  intentId: string;
  watchId: string;
}

// ── Book ──────────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

export class ShadowPositionBook {
  private _orders: ShadowOrder[] = [];
  private _positions: ShadowPosition[] = [];

  // ── Orders ──────────────────────────────────────────────────────────────

  /** Add a new pending order. */
  addPendingOrder(params: {
    symbol: string;
    side: RouteDirection;
    intendedEntry: number;
    stopPrice: number;
    targetPrice: number;
    qty: number;
    intentId: string;
    watchId: string;
  }): ShadowOrder {
    const order: ShadowOrder = {
      id: _nextId('ord'),
      ...params,
      status: 'pending',
      createdAt: Date.now(),
    };
    this._orders.push(order);
    return order;
  }

  /** Get all pending orders. */
  getPendingOrders(): ShadowOrder[] {
    return this._orders.filter(o => o.status === 'pending');
  }

  /** Cancel a pending order. */
  cancelOrder(orderId: string, reason: string): void {
    const order = this._orders.find(o => o.id === orderId);
    if (order && order.status === 'pending') {
      order.status = 'cancelled';
      order.cancelledAt = Date.now();
      order.cancelReason = reason;
    }
  }

  /**
   * Fill a pending order into an open position.
   *
   * @param orderId   - The order to fill
   * @param fillPrice - Actual fill price (may include slippage)
   * @returns The new open position, or null if the order was not pending.
   */
  fillOrderToPosition(orderId: string, fillPrice: number): ShadowPosition | null {
    const order = this._orders.find(o => o.id === orderId);
    if (!order || order.status !== 'pending') return null;

    const now = Date.now();
    order.status = 'filled';
    order.filledAt = now;

    const position: ShadowPosition = {
      id: _nextId('pos'),
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      entryPrice: fillPrice,
      stopPrice: order.stopPrice,
      targetPrice: order.targetPrice,
      qty: order.qty,
      status: 'open',
      openedAt: now,
      mfePoints: 0,
      maePoints: 0,
      intentId: order.intentId,
      watchId: order.watchId,
    };

    this._positions.push(position);
    return position;
  }

  // ── Positions ───────────────────────────────────────────────────────────

  /** Get all open positions. */
  getOpenPositions(): ShadowPosition[] {
    return this._positions.filter(p => p.status === 'open');
  }

  /** Get all closed positions. */
  getClosedPositions(): ShadowPosition[] {
    return this._positions.filter(p => p.status === 'closed');
  }

  /** Number of open positions. */
  get openCount(): number {
    return this._positions.filter(p => p.status === 'open').length;
  }

  /**
   * Close a position.
   *
   * @param positionId - The position to close
   * @param exitPrice  - Exit fill price
   * @param reason     - Why the position was closed (stop, target, flatten, etc.)
   */
  closePosition(positionId: string, exitPrice: number, reason: string): void {
    const pos = this._positions.find(p => p.id === positionId);
    if (!pos || pos.status !== 'open') return;

    pos.status = 'closed';
    pos.closedAt = Date.now();
    pos.exitPrice = exitPrice;
    pos.exitReason = reason;

    // Compute realized P&L in points
    pos.realizedPnlPoints = pos.side === 'long'
      ? exitPrice - pos.entryPrice
      : pos.entryPrice - exitPrice;

    // Compute R-multiple
    const stopDistance = Math.abs(pos.entryPrice - pos.stopPrice);
    pos.rMultiple = stopDistance > 0
      ? pos.realizedPnlPoints / stopDistance
      : 0;
  }

  /**
   * Flatten all open positions at the given price.
   *
   * @param currentPrice - Current market price for exit
   * @param reason       - Flatten reason (e.g. 'session_close', 'manual')
   */
  flattenAll(currentPrice: number, reason: string): void {
    for (const pos of this._positions) {
      if (pos.status === 'open') {
        this.closePosition(pos.id, currentPrice, reason);
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Clear all orders and positions. */
  reset(): void {
    this._orders = [];
    this._positions = [];
  }
}
