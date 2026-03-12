// ── main/trading/shadow/ShadowOrderEngine.ts ──────────────────────────────────
//
// Accepts TradeIntent objects and processes them into simulated orders
// through the ShadowPositionBook and ShadowFillModel.
//
// Lifecycle:
//   TradeIntent → validate → create pending order → simulate fill → open position
//
// No broker dependencies. All fills are simulated.
//
// SIMULATION ONLY. No real brokerage orders.

import type { TradeIntent } from '@triforge/engine';
import { ShadowPositionBook, type ShadowOrder, type ShadowPosition } from './ShadowPositionBook';
import { simulateMarketFill } from './ShadowFillModel';

// ── Order Result ──────────────────────────────────────────────────────────────

export interface OrderResult {
  success: boolean;
  order: ShadowOrder | null;
  position: ShadowPosition | null;
  rejectReason?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

function _validateIntent(intent: TradeIntent): string | null {
  if (!intent.symbol || intent.symbol.length === 0) return 'Missing symbol';
  if (intent.entry <= 0) return 'Invalid entry price';
  if (intent.stop <= 0) return 'Invalid stop price';
  if (intent.target <= 0) return 'Invalid target price';
  if (intent.stopPoints <= 0) return 'Invalid stop distance';

  // Direction consistency
  if (intent.side === 'long') {
    if (intent.stop >= intent.entry) return 'Long stop must be below entry';
    if (intent.target <= intent.entry) return 'Long target must be above entry';
  } else {
    if (intent.stop <= intent.entry) return 'Short stop must be above entry';
    if (intent.target >= intent.entry) return 'Short target must be below entry';
  }

  return null;
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class ShadowOrderEngine {
  private _book: ShadowPositionBook;

  constructor(book: ShadowPositionBook) {
    this._book = book;
  }

  /**
   * Process a trade intent: validate, create order, simulate fill.
   *
   * Currently all orders are treated as market orders (filled immediately
   * at current price with simulated slippage). Limit order support can be
   * added when the watch-and-confirm engine provides precise limit prices.
   *
   * @param intent       - The trade intent to execute
   * @param currentPrice - Current market price for fill simulation
   * @returns OrderResult with the created order and position (or rejection).
   */
  processIntent(intent: TradeIntent, currentPrice: number): OrderResult {
    // Validate
    const rejectReason = _validateIntent(intent);
    if (rejectReason) {
      return { success: false, order: null, position: null, rejectReason };
    }

    // Check for duplicate (same intent ID already in the book)
    const pending = this._book.getPendingOrders();
    if (pending.some(o => o.intentId === intent.id)) {
      return { success: false, order: null, position: null, rejectReason: 'Duplicate intent ID' };
    }

    // Create pending order
    const order = this._book.addPendingOrder({
      symbol: intent.symbol,
      side: intent.side,
      intendedEntry: intent.entry,
      stopPrice: intent.stop,
      targetPrice: intent.target,
      qty: 1, // fixed 1 contract for shadow simulation
      intentId: intent.id,
      watchId: intent.watchId,
    });

    // Simulate market fill
    const fill = simulateMarketFill(order.id, intent.symbol, intent.side, currentPrice);
    const position = this._book.fillOrderToPosition(order.id, fill.fillPrice);

    if (!position) {
      return { success: false, order, position: null, rejectReason: 'Fill failed' };
    }

    return { success: true, order, position };
  }

  /**
   * Get the position book for external inspection.
   */
  getBook(): ShadowPositionBook {
    return this._book;
  }
}
