// ── main/trading/shadow/ShadowPnLEngine.ts ────────────────────────────────────
//
// Computes P&L, MFE/MAE, and R-multiples for shadow positions.
//
// All computations are in points (not dollars) to stay broker-agnostic.
// Dollar conversion can be applied at the UI layer using INSTRUMENT_META.
//
// SIMULATION ONLY.

import type { ShadowPosition } from './ShadowPositionBook';

// ── P&L Result Types ──────────────────────────────────────────────────────────

export interface UnrealizedPnL {
  positionId: string;
  /** P&L in points from entry to current price. */
  pnlPoints: number;
  /** R-multiple of unrealized P&L. */
  rMultiple: number;
  /** Maximum favorable excursion in points (updated). */
  mfePoints: number;
  /** Maximum adverse excursion in points (updated). */
  maePoints: number;
}

export interface RealizedPnL {
  positionId: string;
  pnlPoints: number;
  rMultiple: number;
  mfePoints: number;
  maePoints: number;
  exitReason: string;
}

export interface SessionPnLSummary {
  /** Total realized P&L in points across all closed positions. */
  totalRealizedPoints: number;
  /** Total unrealized P&L in points across all open positions. */
  totalUnrealizedPoints: number;
  /** Count of winning trades. */
  wins: number;
  /** Count of losing trades. */
  losses: number;
  /** Count of breakeven trades. */
  breakevens: number;
  /** Average R-multiple of closed trades. */
  avgRMultiple: number;
  /** Current consecutive loss streak. */
  consecutiveLosses: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute unrealized P&L for an open position and update MFE/MAE.
 *
 * This mutates the position's mfePoints and maePoints fields as a side
 * effect (excursion tracking requires state updates each tick).
 *
 * @param position     - Open position to evaluate
 * @param currentPrice - Current market price
 * @returns Unrealized P&L data.
 */
export function computeUnrealizedPnL(
  position: ShadowPosition,
  currentPrice: number,
): UnrealizedPnL {
  const pnlPoints = position.side === 'long'
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;

  const stopDistance = Math.abs(position.entryPrice - position.stopPrice);
  const rMultiple = stopDistance > 0 ? pnlPoints / stopDistance : 0;

  // Update excursions
  if (pnlPoints > position.mfePoints) {
    position.mfePoints = pnlPoints;
  }
  if (pnlPoints < 0 && Math.abs(pnlPoints) > position.maePoints) {
    position.maePoints = Math.abs(pnlPoints);
  }

  return {
    positionId: position.id,
    pnlPoints,
    rMultiple,
    mfePoints: position.mfePoints,
    maePoints: position.maePoints,
  };
}

/**
 * Compute realized P&L for a closed position.
 *
 * @param position - Closed position with exitPrice set
 * @returns Realized P&L data, or null if position is not closed.
 */
export function computeRealizedPnL(position: ShadowPosition): RealizedPnL | null {
  if (position.status !== 'closed' || position.exitPrice == null) return null;

  const pnlPoints = position.side === 'long'
    ? position.exitPrice - position.entryPrice
    : position.entryPrice - position.exitPrice;

  const stopDistance = Math.abs(position.entryPrice - position.stopPrice);
  const rMultiple = stopDistance > 0 ? pnlPoints / stopDistance : 0;

  return {
    positionId: position.id,
    pnlPoints,
    rMultiple,
    mfePoints: position.mfePoints,
    maePoints: position.maePoints,
    exitReason: position.exitReason ?? 'unknown',
  };
}

/**
 * Compute a summary of session P&L across all positions.
 *
 * @param openPositions   - Currently open positions
 * @param closedPositions - Closed positions from this session
 * @param currentPrice    - Current price for unrealized calc
 */
export function computeSessionSummary(
  openPositions: ShadowPosition[],
  closedPositions: ShadowPosition[],
  currentPrice: number,
): SessionPnLSummary {
  let totalRealizedPoints = 0;
  let totalUnrealizedPoints = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let rSum = 0;
  let consecutiveLosses = 0;

  // Closed positions
  for (const pos of closedPositions) {
    const realized = computeRealizedPnL(pos);
    if (!realized) continue;

    totalRealizedPoints += realized.pnlPoints;
    rSum += realized.rMultiple;

    if (realized.pnlPoints > 0.01) {
      wins++;
    } else if (realized.pnlPoints < -0.01) {
      losses++;
    } else {
      breakevens++;
    }
  }

  // Consecutive losses: count from most recent backward
  const sorted = [...closedPositions]
    .filter(p => p.closedAt != null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  for (const pos of sorted) {
    const realized = computeRealizedPnL(pos);
    if (!realized || realized.pnlPoints >= -0.01) break;
    consecutiveLosses++;
  }

  // Open positions
  for (const pos of openPositions) {
    const unrealized = computeUnrealizedPnL(pos, currentPrice);
    totalUnrealizedPoints += unrealized.pnlPoints;
  }

  const closedCount = wins + losses + breakevens;
  const avgRMultiple = closedCount > 0 ? rSum / closedCount : 0;

  return {
    totalRealizedPoints,
    totalUnrealizedPoints,
    wins,
    losses,
    breakevens,
    avgRMultiple,
    consecutiveLosses,
  };
}
