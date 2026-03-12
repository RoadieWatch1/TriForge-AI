// ── main/trading/shadow/TradeIntentAdapter.ts ─────────────────────────────────
//
// Converts a TradeIntent (level-to-level engine output) into the legacy
// ProposedTradeSetup + LiveTradeSnapshot pair expected by CouncilReviewFn.
//
// This is a thin bridge — it maps fields one-to-one where possible and
// synthesizes minimal defaults for fields the legacy interface requires
// but the new engine does not produce.
//
// No business logic. Pure data mapping.

import type { TradeIntent } from '@triforge/engine';
import type { ProposedTradeSetup } from '@triforge/engine';
import type { LiveTradeSnapshot } from '@triforge/engine';
import type { IMarketDataProvider } from '../market/MarketDataProvider';

// ── Adapter Output ──────────────────────────────────────────────────────────

export interface AdaptedCouncilInput {
  setup: ProposedTradeSetup;
  snapshot: LiveTradeSnapshot;
  symbol: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a TradeIntent to the legacy council review input format.
 *
 * @param intent   - The level-to-level trade intent
 * @param provider - Market data provider for snapshot fields
 * @returns Adapted input, or null if market data is unavailable.
 */
export function adaptIntentForCouncil(
  intent: TradeIntent,
  provider: IMarketDataProvider | null,
): AdaptedCouncilInput | null {
  const data = provider?.getNormalizedData();
  if (!data) return null;

  // Map TradeIntent → ProposedTradeSetup
  const setup: ProposedTradeSetup = {
    setupType: `level_${intent.side}` as ProposedTradeSetup['setupType'],
    side: intent.side,
    entry: intent.entry,
    stop: intent.stop,
    target: intent.target,
    stopPoints: intent.stopPoints,
    thesis: intent.reasons.join('; ') || `Level-to-level ${intent.side} from ${intent.entryLevel.label ?? intent.entryLevel.type}`,
    confidence: intent.confidence,
  };

  // Build minimal LiveTradeSnapshot from normalized data
  const snapshot: LiveTradeSnapshot = {
    connected: true,
    accountMode: 'simulation',
    symbol: intent.symbol,
    lastPrice: data.currentPrice,
    bidPrice: data.currentPrice,
    askPrice: data.currentPrice,
    highOfDay: data.highOfDay,
    lowOfDay: data.lowOfDay,
    trend: data.trend5m === 'up' ? 'up' : data.trend5m === 'down' ? 'down' : 'range',
    feedFreshnessMs: data.feedFreshnessMs,
    atr5m: data.atr5m,
    vwap: data.vwap,
    vwapRelation: data.vwapRelation,
    trend5m: data.trend5m,
    trend15m: data.trend15m,
    indicatorState: 'ready',
  };

  return { setup, snapshot, symbol: intent.symbol };
}
