// ── main/trading/market/TradovateMarketDataAdapter.ts ──────────────────────────
//
// Implements IMarketDataProvider by wrapping the existing tradovateService
// singleton. This adapter normalizes Tradovate-specific data into the
// broker-agnostic format consumed by the level-to-level engine.
//
// The adapter does NOT own the connection — tradovateService handles auth,
// reconnection, and symbol subscription lifecycle.

import type { LiveTradeSnapshot } from '@triforge/engine';
import type { NormalizedBar, NormalizedMarketData } from '@triforge/engine';
import type { OhlcBar } from '../tradovateClient';
import { tradovateService } from '../tradovateService';
import type { IMarketDataProvider } from './MarketDataProvider';
import type { MarketSnapshotStore } from './MarketSnapshotStore';

// ── Adapter ─────────────────────────────────────────────────────────────────

export class TradovateMarketDataAdapter implements IMarketDataProvider {
  private _snapshotStore: MarketSnapshotStore | null = null;

  /** Optionally attach a MarketSnapshotStore for prev-day/overnight tracking. */
  setSnapshotStore(store: MarketSnapshotStore): void {
    this._snapshotStore = store;
  }

  getSnapshot(): LiveTradeSnapshot | null {
    return tradovateService.getLastSnapshot();
  }

  getBars(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } | null {
    return tradovateService.getBars();
  }

  subscribe(symbol: string): void {
    tradovateService.setSymbol(symbol);
  }

  unsubscribe(): void {
    // tradovateService does not have a dedicated unsubscribe — no-op
  }

  isConnected(): boolean {
    return tradovateService.status().connected;
  }

  feedFreshness(): number | undefined {
    const snap = this.getSnapshot();
    return snap?.feedFreshnessMs;
  }

  activeSymbol(): string | null {
    return tradovateService.status().symbol ?? null;
  }

  getNormalizedData(): NormalizedMarketData | null {
    const snap = this.getSnapshot();
    if (!snap || !snap.connected || snap.lastPrice == null) return null;

    const bars = this.getBars();
    if (!bars) return null;

    const prevDay = this._snapshotStore?.getPrevDayLevels() ?? {};
    const overnight = this._snapshotStore?.getOvernightLevels() ?? {};

    return {
      symbol:           snap.symbol,
      currentPrice:     snap.lastPrice,
      bidPrice:         snap.bidPrice,
      askPrice:         snap.askPrice,
      highOfDay:        snap.highOfDay ?? snap.lastPrice,
      lowOfDay:         snap.lowOfDay ?? snap.lastPrice,
      openPrice:        undefined, // not available from Tradovate snapshot
      prevDayHigh:      prevDay.high,
      prevDayLow:       prevDay.low,
      prevDayClose:     prevDay.close,
      overnightHigh:    overnight.high,
      overnightLow:     overnight.low,
      vwap:             snap.vwap,
      atr5m:            snap.atr5m,
      trend5m:          snap.trend5m ?? 'unknown',
      trend15m:         snap.trend15m ?? 'unknown',
      vwapRelation:     snap.vwapRelation,
      sessionLabel:     snap.sessionLabel ?? 'premarket',
      volatilityRegime: snap.volatilityRegime,
      bars1m:           bars.bars1m.map(b => _toNormalized(b, '1m')),
      bars5m:           bars.bars5m.map(b => _toNormalized(b, '5m')),
      bars15m:          bars.bars15m.map(b => _toNormalized(b, '15m')),
      feedFreshnessMs:  snap.feedFreshnessMs,
      indicatorReady:   snap.indicatorState === 'ready',
      snapshotTime:     Date.now(),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _toNormalized(bar: OhlcBar, tf: '1m' | '5m' | '15m'): NormalizedBar {
  return {
    timestamp: bar.timestamp,
    open:      bar.open,
    high:      bar.high,
    low:       bar.low,
    close:     bar.close,
    volume:    bar.volume,
    timeframe: tf,
  };
}
