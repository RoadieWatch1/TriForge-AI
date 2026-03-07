// ── engine/src/trading/tradeScoring.ts ────────────────────────────────────────
//
// Phase 3: Pure helpers for MFE/MAE tracking and excursion-R computation.
// No I/O — consumed by shadowTradingController.

/**
 * Update the MFE/MAE tracking prices for a trade given a new price tick.
 * Returns updated { mfPrice, maPrice }. Does NOT mutate the trade.
 */
export function updateExcursions(
  side: 'long' | 'short',
  entryPrice: number,
  currentMfPrice: number | undefined,
  currentMaPrice: number | undefined,
  tickPrice: number,
): { mfPrice: number; maPrice: number } {
  if (side === 'long') {
    return {
      mfPrice: Math.max(currentMfPrice ?? entryPrice, tickPrice),
      maPrice: Math.min(currentMaPrice ?? entryPrice, tickPrice),
    };
  }
  return {
    mfPrice: Math.min(currentMfPrice ?? entryPrice, tickPrice),
    maPrice: Math.max(currentMaPrice ?? entryPrice, tickPrice),
  };
}

/**
 * Compute MFE and MAE in R-multiples at trade close.
 * Both values are positive (0 = no excursion).
 */
export function computeExcursionR(
  side: 'long' | 'short',
  entryPrice: number,
  stopPrice: number,
  mfPrice: number,
  maPrice: number,
): { mfeR: number; maeR: number } {
  const riskPoints = Math.abs(entryPrice - stopPrice);
  if (riskPoints === 0) return { mfeR: 0, maeR: 0 };

  if (side === 'long') {
    return {
      mfeR: (mfPrice - entryPrice) / riskPoints,
      maeR: (entryPrice - maPrice) / riskPoints,
    };
  }
  return {
    mfeR: (entryPrice - mfPrice) / riskPoints,
    maeR: (maPrice - entryPrice) / riskPoints,
  };
}
