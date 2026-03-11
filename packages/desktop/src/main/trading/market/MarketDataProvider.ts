// ── main/trading/market/MarketDataProvider.ts ─────────────────────────────────
//
// Broker-agnostic market data provider interface.
// The Shadow Simulator consumes this interface rather than Tradovate-specific
// types directly. Tradovate is one adapter; future brokers plug in here.

import type { LiveTradeSnapshot } from '@triforge/engine';
import type { NormalizedBar, NormalizedMarketData } from '@triforge/engine';
import type { OhlcBar } from '../tradovateClient';

// ── Provider Interface ──────────────────────────────────────────────────────

export interface IMarketDataProvider {
  /** Get the current live snapshot for the active symbol. */
  getSnapshot(): LiveTradeSnapshot | null;

  /** Get accumulated OHLC bars for all timeframes. */
  getBars(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } | null;

  /** Subscribe to a symbol for live market data. */
  subscribe(symbol: string): void;

  /** Unsubscribe from live market data. */
  unsubscribe(): void;

  /** Whether the provider is connected and receiving data. */
  isConnected(): boolean;

  /** Milliseconds since last tick. >5000 = stale. */
  feedFreshness(): number | undefined;

  /** The currently subscribed symbol, or null if none. */
  activeSymbol(): string | null;

  /** Build a NormalizedMarketData object for the level engine. */
  getNormalizedData(): NormalizedMarketData | null;
}
