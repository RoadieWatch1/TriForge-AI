// ── main/trading/market/TastytradeMarketDataProvider.ts ──────────────────────
//
// Implements IMarketDataProvider using TastytradeClient.
// Provides free real-time CME futures data via Tastytrade's paper account.
// No Tradovate API subscription required.
//
// Usage:
//   await tastytradeProvider.connect(username, password);
//   tastytradeProvider.subscribe('NQ');
//   const snap = tastytradeProvider.getSnapshot();

import type { LiveTradeSnapshot, NormalizedMarketData, NormalizedBar } from '@triforge/engine';
import type { OhlcBar } from '../tradovateClient';
import { TastytradeClient, TastytradeDeviceChallengeError } from '../tastytradeClient';
import type { TastytradeAuthState } from '../tastytradeClient';
import type { IMarketDataProvider } from './MarketDataProvider';

// ── Provider class ────────────────────────────────────────────────────────────

class TastytradeMarketDataProviderClass implements IMarketDataProvider {
  private readonly _client = new TastytradeClient();
  private _firstBarsLogged = false;

  /** Connect and authenticate. Throws TastytradeDeviceChallengeError if device challenge required. */
  async connect(username: string, password: string): Promise<void> {
    await this._client.authenticate(username, password);
  }

  /** Complete the device challenge with the OTP received by the user. */
  async verifyDevice(otp: string): Promise<void> {
    await this._client.verifyDevice(otp);
  }

  /** Re-trigger OTP delivery without re-entering credentials. */
  async resendDeviceChallenge(): Promise<boolean> {
    return this._client.resendDeviceChallenge();
  }

  /** Current auth state — use to drive UI (e.g. show OTP input when 'device_challenge_required'). */
  authState(): TastytradeAuthState {
    return this._client.authState;
  }

  /** Disconnect and clear all state. */
  disconnect(): void {
    this._client.disconnect();
  }

  // Re-export error class so IPC layer can instanceof-check without importing the client
  static readonly DeviceChallengeError = TastytradeDeviceChallengeError;

  // ── IMarketDataProvider ──────────────────────────────────────────────────

  getSnapshot(): LiveTradeSnapshot | null {
    return this._client.getSnapshot();
  }

  getBars(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } | null {
    if (!this._client.isConnected) return null;
    const bars = this._client.getBars();
    if (bars.bars1m.length === 0) return null;
    if (!this._firstBarsLogged) {
      this._firstBarsLogged = true;
      const latest = bars.bars1m[bars.bars1m.length - 1];
      console.log('[TastytradeProvider] First getBars() → bars ready:', {
        bars1m: bars.bars1m.length,
        bars5m: bars.bars5m.length,
        bars15m: bars.bars15m.length,
        latestTs: latest?.timestamp,
        latestClose: latest?.close,
      });
    }
    return bars;
  }

  subscribe(symbol: string): void {
    this._client.subscribe(symbol);
  }

  unsubscribe(): void {
    this._client.unsubscribeAll();
  }

  isConnected(): boolean {
    return this._client.isConnected;
  }

  feedFreshness(): number | undefined {
    return this._client.feedFreshness();
  }

  activeSymbol(): string | null {
    return this._client.activeSymbol();
  }

  getNormalizedData(): NormalizedMarketData | null {
    const snap = this.getSnapshot();
    if (!snap || !snap.connected || snap.lastPrice == null) return null;

    const bars = this.getBars();
    if (!bars) return null;

    return {
      symbol:           snap.symbol,
      currentPrice:     snap.lastPrice,
      bidPrice:         snap.bidPrice,
      askPrice:         snap.askPrice,
      highOfDay:        snap.highOfDay ?? snap.lastPrice,
      lowOfDay:         snap.lowOfDay ?? snap.lastPrice,
      openPrice:        undefined,
      prevDayHigh:      undefined,
      prevDayLow:       undefined,
      prevDayClose:     undefined,
      overnightHigh:    undefined,
      overnightLow:     undefined,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Singleton ─────────────────────────────────────────────────────────────────

export const tastytradeProvider = new TastytradeMarketDataProviderClass();
