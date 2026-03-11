// ── main/trading/shadow/ShadowFillModel.ts ────────────────────────────────────
//
// Simulates order fill logic for the shadow simulator.
//
// - Market orders fill at the current price with 0–1 tick of slippage.
// - Limit orders fill when the market price crosses the limit price.
// - Slippage is deterministic: based on a simple hash of the order ID
//   to produce 0 or 1 tick of slippage in the adverse direction.
//
// Tick sizes are per-instrument. Falls back to 0.25 (NQ/ES default) if
// the instrument is unknown.
//
// SIMULATION ONLY. No real brokerage orders.

import type { RouteDirection } from '@triforge/engine';

// ── Tick Size Lookup ──────────────────────────────────────────────────────────

const TICK_SIZES: Record<string, number> = {
  NQ:  0.25,
  MNQ: 0.25,
  ES:  0.25,
  MES: 0.25,
  RTY: 0.10,
  M2K: 0.10,
  CL:  0.01,
  GC:  0.10,
};

function _tickSize(symbol: string): number {
  return TICK_SIZES[symbol] ?? 0.25;
}

// ── Deterministic Slippage ────────────────────────────────────────────────────

/**
 * Simple deterministic hash of an order ID to decide slippage.
 * Returns 0 or 1 (number of ticks of slippage).
 */
function _slippageTicks(orderId: string): number {
  // Sum char codes and check parity
  let sum = 0;
  for (let i = 0; i < orderId.length; i++) {
    sum += orderId.charCodeAt(i);
  }
  return sum % 2; // 0 or 1 tick
}

// ── Fill Result ───────────────────────────────────────────────────────────────

export interface FillResult {
  filled: boolean;
  fillPrice: number;
  slippagePoints: number;
  slippageTicks: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Simulate a market order fill.
 *
 * Fills immediately at currentPrice + slippage (0–1 tick adverse).
 *
 * @param orderId      - Order ID for deterministic slippage
 * @param symbol       - Instrument symbol
 * @param side         - Trade direction
 * @param currentPrice - Current market price
 */
export function simulateMarketFill(
  orderId: string,
  symbol: string,
  side: RouteDirection,
  currentPrice: number,
): FillResult {
  const tick = _tickSize(symbol);
  const ticks = _slippageTicks(orderId);
  const slippagePoints = ticks * tick;

  // Adverse slippage: longs fill higher, shorts fill lower
  const fillPrice = side === 'long'
    ? currentPrice + slippagePoints
    : currentPrice - slippagePoints;

  return {
    filled: true,
    fillPrice,
    slippagePoints,
    slippageTicks: ticks,
  };
}

/**
 * Check whether a limit order would fill at the current price.
 *
 * A buy limit fills when currentPrice <= limitPrice.
 * A sell limit fills when currentPrice >= limitPrice.
 *
 * If the limit is crossed, fills at the limit price (no slippage on limits).
 *
 * @param side         - Trade direction
 * @param limitPrice   - Limit order price
 * @param currentPrice - Current market price
 */
export function checkLimitFill(
  side: RouteDirection,
  limitPrice: number,
  currentPrice: number,
): FillResult {
  let filled = false;

  if (side === 'long' && currentPrice <= limitPrice) {
    filled = true;
  } else if (side === 'short' && currentPrice >= limitPrice) {
    filled = true;
  }

  return {
    filled,
    fillPrice: filled ? limitPrice : 0,
    slippagePoints: 0,
    slippageTicks: 0,
  };
}

/**
 * Check whether a stop-loss or target has been hit by the current price.
 *
 * @param side         - Position direction
 * @param stopPrice    - Stop-loss price
 * @param targetPrice  - Take-profit price
 * @param currentPrice - Current market price
 * @returns 'stop', 'target', or null if neither hit.
 */
export function checkExitTrigger(
  side: RouteDirection,
  stopPrice: number,
  targetPrice: number,
  currentPrice: number,
): 'stop' | 'target' | null {
  if (side === 'long') {
    if (currentPrice <= stopPrice) return 'stop';
    if (currentPrice >= targetPrice) return 'target';
  } else {
    if (currentPrice >= stopPrice) return 'stop';
    if (currentPrice <= targetPrice) return 'target';
  }
  return null;
}
