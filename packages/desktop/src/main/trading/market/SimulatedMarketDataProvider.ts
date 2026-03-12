// ── main/trading/market/SimulatedMarketDataProvider.ts ────────────────────────
//
// IMarketDataProvider implementation that generates simulated market data
// using a random-walk price engine. Allows the shadow trading simulator
// to run WITHOUT a Tradovate (or any broker) connection.
//
// Key design:
//   - On subscribe(symbol), preseeds ~90 synthetic 1m bars immediately so
//     ATR, trends, VWAP, and indicatorReady are valid from the first call.
//   - On-demand tick advancement: each getSnapshot() / getNormalizedData()
//     call advances the walk by elapsed wall-clock time.
//   - Session labels use CT (America/Chicago) to stay aligned with
//     ShadowSessionController.
//
// Provider-switch note (v1):
//   When switching between this provider and TradovateMarketDataAdapter
//   mid-session, existing open positions in ShadowPositionBook are preserved
//   but the new price source becomes authoritative for mark-to-market and
//   exit triggers. Positions entered at a simulated price may be exited at
//   a real price (or vice versa). No seamless continuity is guaranteed.
//
// SIMULATION ONLY. No real market data. No real brokerage orders.

import type { LiveTradeSnapshot } from '@triforge/engine';
import type { NormalizedBar, NormalizedMarketData } from '@triforge/engine';
import type { SessionLabel, BarTrend, VwapRelation, VolatilityRegime } from '@triforge/engine';
import type { OhlcBar } from '../tradovateClient';
import type { IMarketDataProvider } from './MarketDataProvider';

// ── Per-Symbol Configuration ─────────────────────────────────────────────────

interface SimSymbolConfig {
  basePrice: number;
  volatilityPerMin: number;  // points per minute standard deviation
  tickSize: number;
}

const SIM_CONFIGS: Record<string, SimSymbolConfig> = {
  NQ:  { basePrice: 21000, volatilityPerMin: 8,    tickSize: 0.25 },
  MNQ: { basePrice: 21000, volatilityPerMin: 8,    tickSize: 0.25 },
  ES:  { basePrice: 5900,  volatilityPerMin: 2,    tickSize: 0.25 },
  MES: { basePrice: 5900,  volatilityPerMin: 2,    tickSize: 0.25 },
  RTY: { basePrice: 2200,  volatilityPerMin: 3,    tickSize: 0.1  },
  M2K: { basePrice: 2200,  volatilityPerMin: 3,    tickSize: 0.1  },
  CL:  { basePrice: 72,    volatilityPerMin: 0.15, tickSize: 0.01 },
  GC:  { basePrice: 2650,  volatilityPerMin: 3,    tickSize: 0.1  },
};

const DEFAULT_CONFIG: SimSymbolConfig = { basePrice: 5000, volatilityPerMin: 5, tickSize: 0.25 };

// ── Constants ────────────────────────────────────────────────────────────────

const PRESEED_1M_COUNT = 90;   // bars to generate on subscribe
const MAX_1M_BARS = 90;
const MAX_5M_BARS = 30;
const MAX_15M_BARS = 20;
const TICK_INTERVAL_MS = 1000;  // simulate ~1 tick per second
const MEAN_REVERSION = 0.001;   // drift coefficient toward base price

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Box-Muller transform for Gaussian random numbers. */
function _gaussian(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Snap a price to the nearest tick. */
function _snap(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

/** Get current CT time using Intl (handles CDT/CST automatically). */
function _getCTTime(now: Date = new Date()): { hour: number; minute: number; totalMinutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

/**
 * Session label from CT time.
 * Maps to engine SessionLabel type using CT boundaries equivalent to
 * the ET-based boundaries in tradovateClient._getSessionLabel().
 *
 * CT boundaries (ET - 1 hour):
 *   premarket:  before 8:30 CT
 *   opening:    8:30 – 9:00 CT
 *   midmorning: 9:00 – 10:30 CT
 *   lunch:      10:30 – 12:00 CT
 *   afternoon:  12:00 – 14:00 CT
 *   close:      14:00 – 15:00 CT
 *   afterhours: after 15:00 CT
 */
function _getSessionLabelCT(now?: Date): SessionLabel {
  const { totalMinutes } = _getCTTime(now);
  if (totalMinutes < 510)  return 'premarket';    // before 8:30 CT
  if (totalMinutes < 540)  return 'opening';       // 8:30 – 9:00 CT
  if (totalMinutes < 630)  return 'midmorning';    // 9:00 – 10:30 CT
  if (totalMinutes < 720)  return 'lunch';         // 10:30 – 12:00 CT
  if (totalMinutes < 840)  return 'afternoon';     // 12:00 – 14:00 CT
  if (totalMinutes < 900)  return 'close';         // 14:00 – 15:00 CT
  return 'afterhours';                             // after 15:00 CT
}

/** Simple SMA computation. */
function _sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Derive trend from SMA crossover: SMA(5) vs SMA(10). */
function _deriveTrend(closes: number[]): BarTrend {
  const fast = _sma(closes, 5);
  const slow = _sma(closes, 10);
  if (fast === null || slow === null) return 'unknown';
  const diff = fast - slow;
  const threshold = slow * 0.0002; // 0.02% threshold to avoid noise
  if (diff > threshold) return 'up';
  if (diff < -threshold) return 'down';
  return 'range';
}

/** Aggregate an array of 1m bars into a single bar. */
function _aggregate1mBars(bars: OhlcBar[], timeframe: '5m' | '15m'): OhlcBar | null {
  if (bars.length === 0) return null;
  return {
    timestamp: bars[0].timestamp,
    open:      bars[0].open,
    high:      Math.max(...bars.map(b => b.high)),
    low:       Math.min(...bars.map(b => b.low)),
    close:     bars[bars.length - 1].close,
    volume:    bars.reduce((s, b) => s + b.volume, 0),
  };
}

/** Floor a millisecond timestamp to the start of its N-minute bucket. */
function _floorToBucket(tsMs: number, minutes: number): number {
  const msPerBucket = minutes * 60_000;
  return Math.floor(tsMs / msPerBucket) * msPerBucket;
}

/** Clock-aligned aggregation: group 1m bars into N-minute buckets by timestamp. */
function _aggregateByClockTime(bars1m: OhlcBar[], minutes: number): OhlcBar[] {
  if (bars1m.length === 0) return [];
  const buckets = new Map<number, OhlcBar[]>();
  for (const bar of bars1m) {
    const key = _floorToBucket(bar.timestamp, minutes);
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(bar);
  }
  const sorted = [...buckets.keys()].sort((a, b) => a - b);
  return sorted.map(k => _aggregate1mBars(buckets.get(k)!, minutes === 5 ? '5m' : '15m')!).filter(Boolean);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class SimulatedMarketDataProvider implements IMarketDataProvider {
  private _symbol: string | null = null;
  private _config: SimSymbolConfig = DEFAULT_CONFIG;
  private _connected = false;

  // Walk state
  private _price = 0;
  private _basePrice = 0;
  private _highOfDay = 0;
  private _lowOfDay = 0;
  private _lastTickAt = 0;

  // Bars
  private _bars1m: OhlcBar[] = [];
  private _bars5m: OhlcBar[] = [];
  private _bars15m: OhlcBar[] = [];
  private _currentBar: { open: number; high: number; low: number; close: number; volume: number; startMs: number } | null = null;

  // VWAP
  private _vwapSumPV = 0;
  private _vwapSumV = 0;

  // ── IMarketDataProvider ──────────────────────────────────────────────────

  subscribe(symbol: string): void {
    // Same-symbol guard: don't reset if already subscribed to this symbol
    if (this._symbol === symbol && this._connected) return;

    this._symbol = symbol;
    this._config = SIM_CONFIGS[symbol] ?? DEFAULT_CONFIG;
    this._connected = true;

    // Initialize walk
    this._basePrice = this._config.basePrice;
    this._price = this._basePrice;
    this._highOfDay = this._price;
    this._lowOfDay = this._price;
    this._lastTickAt = Date.now();

    // Reset bars and VWAP
    this._bars1m = [];
    this._bars5m = [];
    this._bars15m = [];
    this._currentBar = null;
    this._vwapSumPV = 0;
    this._vwapSumV = 0;

    // Preseed history: generate synthetic bars so indicators are immediately valid
    this._preseedHistory();
  }

  unsubscribe(): void {
    this._connected = false;
    this._symbol = null;
  }

  isConnected(): boolean {
    return this._connected;
  }

  feedFreshness(): number | undefined {
    if (!this._connected) return undefined;
    return Date.now() - this._lastTickAt;
  }

  activeSymbol(): string | null {
    return this._symbol;
  }

  getSnapshot(): LiveTradeSnapshot | null {
    if (!this._connected || !this._symbol) return null;

    // Advance simulation to current time
    this._advance();

    const tickHalf = this._config.tickSize * 0.5;

    return {
      connected:       true,
      accountMode:     'simulation',
      symbol:          this._symbol,
      lastPrice:       this._price,
      bidPrice:        _snap(this._price - tickHalf, this._config.tickSize),
      askPrice:        _snap(this._price + tickHalf, this._config.tickSize),
      highOfDay:       this._highOfDay,
      lowOfDay:        this._lowOfDay,
      trend:           this._bars5m.length >= 10 ? _deriveTrend(this._bars5m.map(b => b.close)) : 'unknown',
      feedFreshnessMs: Date.now() - this._lastTickAt,
      atr5m:           this._computeATR(),
      vwap:            this._computeVWAP(),
      vwapRelation:    this._computeVWAPRelation(),
      trend5m:         this._computeTrend5m(),
      trend15m:        this._computeTrend15m(),
      sessionLabel:    _getSessionLabelCT(),
      volatilityRegime: this._computeVolatilityRegime(),
      indicatorState:  'ready',
    };
  }

  getBars(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } | null {
    if (!this._connected) return null;
    this._advance();

    // Include the live forming 1m bar so the chart shows the current candle
    const liveBar: OhlcBar | null = this._currentBar
      ? {
          timestamp: this._currentBar.startMs,
          open:   this._currentBar.open,
          high:   this._currentBar.high,
          low:    this._currentBar.low,
          close:  this._currentBar.close,
          volume: this._currentBar.volume,
        }
      : null;

    const bars1m = liveBar ? [...this._bars1m, liveBar] : [...this._bars1m];

    // Build 5m/15m including the live bar's bucket.
    // _rebuild*Bars() may already contain a partial bar for the forming bucket —
    // replace it (not append) to avoid duplicate candles at the chart tail.
    const bars5m = [...this._bars5m];
    if (liveBar) {
      const bucket = _floorToBucket(liveBar.timestamp, 5);
      const barsInBucket = bars1m.filter(b => _floorToBucket(b.timestamp, 5) === bucket);
      if (barsInBucket.length > 0) {
        const partial = _aggregate1mBars(barsInBucket, '5m')!;
        if (bars5m.length > 0 && _floorToBucket(bars5m[bars5m.length - 1].timestamp, 5) === bucket) {
          bars5m[bars5m.length - 1] = partial;   // replace stale partial
        } else {
          bars5m.push(partial);                   // new bucket
        }
      }
    }

    const bars15m = [...this._bars15m];
    if (liveBar) {
      const bucket = _floorToBucket(liveBar.timestamp, 15);
      const barsInBucket = bars1m.filter(b => _floorToBucket(b.timestamp, 15) === bucket);
      if (barsInBucket.length > 0) {
        const partial = _aggregate1mBars(barsInBucket, '15m')!;
        if (bars15m.length > 0 && _floorToBucket(bars15m[bars15m.length - 1].timestamp, 15) === bucket) {
          bars15m[bars15m.length - 1] = partial;
        } else {
          bars15m.push(partial);
        }
      }
    }

    return { bars1m, bars5m, bars15m };
  }

  getNormalizedData(): NormalizedMarketData | null {
    if (!this._connected || !this._symbol) return null;

    this._advance();

    const bars = this.getBars();
    if (!bars) return null;

    const tickHalf = this._config.tickSize * 0.5;
    const vwap = this._computeVWAP();

    return {
      symbol:           this._symbol,
      currentPrice:     this._price,
      bidPrice:         _snap(this._price - tickHalf, this._config.tickSize),
      askPrice:         _snap(this._price + tickHalf, this._config.tickSize),
      highOfDay:        this._highOfDay,
      lowOfDay:         this._lowOfDay,
      vwap:             vwap,
      atr5m:            this._computeATR(),
      trend5m:          this._computeTrend5m(),
      trend15m:         this._computeTrend15m(),
      vwapRelation:     this._computeVWAPRelation(),
      sessionLabel:     _getSessionLabelCT(),
      volatilityRegime: this._computeVolatilityRegime(),
      bars1m:           bars.bars1m.map(b => _toNormalized(b, '1m')),
      bars5m:           bars.bars5m.map(b => _toNormalized(b, '5m')),
      bars15m:          bars.bars15m.map(b => _toNormalized(b, '15m')),
      feedFreshnessMs:  Date.now() - this._lastTickAt,
      indicatorReady:   true,
      snapshotTime:     Date.now(),
    };
  }

  // ── Preseed ──────────────────────────────────────────────────────────────

  /**
   * Generate PRESEED_1M_COUNT synthetic 1m bars immediately so all
   * indicators are valid from the first getNormalizedData() call.
   */
  private _preseedHistory(): void {
    const now = Date.now();
    let price = this._basePrice;
    const volPerTick = this._config.volatilityPerMin / Math.sqrt(60);

    for (let i = 0; i < PRESEED_1M_COUNT; i++) {
      const barStart = now - (PRESEED_1M_COUNT - i) * 60_000;
      const open = price;
      let high = price;
      let low = price;

      // Simulate ~60 ticks within the 1m bar
      for (let t = 0; t < 60; t++) {
        const drift = -MEAN_REVERSION * (price - this._basePrice);
        const noise = _gaussian() * volPerTick;
        price = _snap(price + drift + noise, this._config.tickSize);
        if (price > high) high = price;
        if (price < low) low = price;
      }

      const volume = Math.floor(50 + Math.random() * 200);

      const bar: OhlcBar = {
        timestamp: barStart,
        open,
        high,
        low,
        close: price,
        volume,
      };

      this._bars1m.push(bar);

      // VWAP accumulation
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      this._vwapSumPV += typicalPrice * volume;
      this._vwapSumV += volume;
    }

    // Keep last N
    this._bars1m = this._bars1m.slice(-MAX_1M_BARS);

    // Aggregate into 5m and 15m
    this._rebuild5mBars();
    this._rebuild15mBars();

    // Set current price and day range from preseed
    this._price = price;
    this._highOfDay = Math.max(...this._bars1m.map(b => b.high));
    this._lowOfDay = Math.min(...this._bars1m.map(b => b.low));

    // Start a fresh current bar
    this._currentBar = {
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      startMs: now,
    };

    this._lastTickAt = now;
  }

  // ── Walk Advancement ─────────────────────────────────────────────────────

  /**
   * Advance the simulation by the elapsed wall-clock time since last call.
   * Generates ticks at ~1/sec rate for the gap period.
   */
  private _advance(): void {
    if (!this._connected) return;

    const now = Date.now();
    const elapsed = now - this._lastTickAt;
    if (elapsed < TICK_INTERVAL_MS) return; // not yet time for a new tick

    const tickCount = Math.min(Math.floor(elapsed / TICK_INTERVAL_MS), 300); // cap at 5 min of catchup
    const volPerTick = this._config.volatilityPerMin / Math.sqrt(60);

    for (let i = 0; i < tickCount; i++) {
      const tickTime = this._lastTickAt + (i + 1) * TICK_INTERVAL_MS;

      // Random walk step
      const drift = -MEAN_REVERSION * (this._price - this._basePrice);
      const noise = _gaussian() * volPerTick;
      this._price = _snap(this._price + drift + noise, this._config.tickSize);

      // Day range
      if (this._price > this._highOfDay) this._highOfDay = this._price;
      if (this._price < this._lowOfDay) this._lowOfDay = this._price;

      // Current bar update
      if (!this._currentBar) {
        this._currentBar = {
          open: this._price,
          high: this._price,
          low: this._price,
          close: this._price,
          volume: 0,
          startMs: Math.floor(tickTime / 60_000) * 60_000,
        };
      }

      this._currentBar.close = this._price;
      if (this._price > this._currentBar.high) this._currentBar.high = this._price;
      if (this._price < this._currentBar.low) this._currentBar.low = this._price;
      this._currentBar.volume += Math.floor(1 + Math.random() * 5);

      // Check if 1m bar is complete
      if (tickTime - this._currentBar.startMs >= 60_000) {
        const completedBar: OhlcBar = {
          timestamp: this._currentBar.startMs,
          open:      this._currentBar.open,
          high:      this._currentBar.high,
          low:       this._currentBar.low,
          close:     this._currentBar.close,
          volume:    this._currentBar.volume,
        };

        this._bars1m.push(completedBar);
        if (this._bars1m.length > MAX_1M_BARS) this._bars1m.shift();

        // VWAP
        const tp = (completedBar.high + completedBar.low + completedBar.close) / 3;
        this._vwapSumPV += tp * completedBar.volume;
        this._vwapSumV += completedBar.volume;

        // Re-aggregate higher timeframes
        this._rebuild5mBars();
        this._rebuild15mBars();

        // Start new bar
        this._currentBar = {
          open: this._price,
          high: this._price,
          low: this._price,
          close: this._price,
          volume: 0,
          startMs: Math.floor(tickTime / 60_000) * 60_000,
        };
      }
    }

    this._lastTickAt = now;
  }

  // ── Bar Aggregation ──────────────────────────────────────────────────────

  private _rebuild5mBars(): void {
    this._bars5m = _aggregateByClockTime(this._bars1m, 5).slice(-MAX_5M_BARS);
  }

  private _rebuild15mBars(): void {
    this._bars15m = _aggregateByClockTime(this._bars1m, 15).slice(-MAX_15M_BARS);
  }

  // ── Indicator Computation ────────────────────────────────────────────────

  private _computeATR(): number | undefined {
    if (this._bars5m.length < 2) return undefined;
    const bars = this._bars5m.slice(-14);
    const ranges = bars.map(b => b.high - b.low);
    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }

  private _computeVWAP(): number | undefined {
    if (this._vwapSumV === 0) return undefined;
    return this._vwapSumPV / this._vwapSumV;
  }

  private _computeVWAPRelation(): VwapRelation | undefined {
    const vwap = this._computeVWAP();
    if (vwap === undefined) return undefined;
    const diff = this._price - vwap;
    const threshold = vwap * 0.001; // 0.1%
    const extThreshold = vwap * 0.003; // 0.3%
    if (diff > extThreshold) return 'extended_above';
    if (diff > threshold) return 'above';
    if (diff < -extThreshold) return 'extended_below';
    if (diff < -threshold) return 'below';
    return 'at';
  }

  private _computeTrend5m(): BarTrend {
    if (this._bars5m.length < 10) return 'unknown';
    return _deriveTrend(this._bars5m.map(b => b.close));
  }

  private _computeTrend15m(): BarTrend {
    if (this._bars15m.length < 10) return 'unknown';
    return _deriveTrend(this._bars15m.map(b => b.close));
  }

  private _computeVolatilityRegime(): VolatilityRegime {
    const atr = this._computeATR();
    if (atr === undefined) return 'normal';
    // Compare ATR to expected volatility for this symbol
    const expectedATR = this._config.volatilityPerMin * 5; // rough 5m bar range
    const ratio = atr / expectedATR;
    if (ratio > 1.2) return 'high';
    if (ratio < 0.6) return 'low';
    return 'normal';
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
