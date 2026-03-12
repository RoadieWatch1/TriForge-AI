// ── main/trading/tradovateClient.ts ───────────────────────────────────────────
//
// Low-level Tradovate REST + WebSocket client.
// Responsible for auth, account lookup, and live quote subscription.
// Returns normalized types only — no raw Tradovate payloads reach renderer.
//
// Tradovate API docs: https://api.tradovate.com/
// Demo endpoint: https://demo.tradovateapi.com/v1
// Live endpoint: https://live.tradovateapi.com/v1
// MD WebSocket (live): wss://md.tradovateapi.com/v1/websocket
// MD WebSocket (demo): wss://md-demo.tradovateapi.com/v1/websocket

import https from 'https';
import type WebSocket from 'ws';
import type { LiveTradeSnapshot, VwapRelation, BarTrend, SessionLabel, VolatilityRegime, IndicatorState } from '@triforge/engine';

// ── Credentials ───────────────────────────────────────────────────────────────

export interface TradovateCredentials {
  username: string;
  password: string;
  /** Tradovate partner client ID. 0 = public/demo. */
  cid?: number;
  /** Tradovate partner secret. '' = public/demo. */
  sec?: string;
  accountMode: 'simulation' | 'live';
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface TradovateSession {
  accessToken: string;
  mdAccessToken: string;
  expirationTime: string;
  accountMode: 'simulation' | 'live';
  userId: number;
  name: string;
}

// ── Internal quote cache ──────────────────────────────────────────────────────

interface QuoteTick {
  symbol: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  highOfDay?: number;
  lowOfDay?: number;
  totalVolume?: number;
  receivedAt: number;
}

// ── REST helper ───────────────────────────────────────────────────────────────

function restPost(url: string, body: unknown, token?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed  = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch {
          resolve(raw);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function restGet(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Account state types ───────────────────────────────────────────────────────

export interface TradovateAccountPosition {
  contractId: number;
  symbol: string;
  netPos: number;         // positive = long, negative = short
  netPrice: number;       // average fill price
  openPnl: number;
  closedPnl: number;
}

export interface TradovateWorkingOrder {
  id: number;
  contractId: number;
  symbol: string;
  side: 'Buy' | 'Sell';
  qty: number;
  orderType: string;      // 'Limit' | 'Stop' | 'Market' etc.
  price?: number;
  stopPrice?: number;
  status: string;
}

export interface TradovateAccountState {
  accountId: number;
  accountName: string;
  accountMode: 'simulation' | 'live';
  cashBalance: number;
  openPnl: number;
  realizedPnl: number;
  buyingPower: number;
  positions: TradovateAccountPosition[];
  workingOrders: TradovateWorkingOrder[];
  fetchedAt: number;
}

// ── Phase 2: OHLC bars + indicators ─────────────────────────────────────────

export interface OhlcBar {
  timestamp: number;   // bar open time (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function _aggregateBars(bars: OhlcBar[]): OhlcBar {
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
function _floorToTimeframe(tsMs: number, minutes: number): number {
  const msPerBucket = minutes * 60_000;
  return Math.floor(tsMs / msPerBucket) * msPerBucket;
}

/** Aggregate 1m bars into N-minute bars aligned to clock-time boundaries. */
function _aggregateBarsByTimeframe(bars1m: OhlcBar[], minutes: number): OhlcBar[] {
  if (bars1m.length === 0) return [];
  const buckets = new Map<number, OhlcBar[]>();
  for (const bar of bars1m) {
    const key = _floorToTimeframe(bar.timestamp, minutes);
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(bar);
  }
  const sorted = [...buckets.keys()].sort((a, b) => a - b);
  return sorted.map(k => _aggregateBars(buckets.get(k)!));
}

/** Check if a bar timestamp falls within RTH session (09:30-16:00 ET). */
function _isRthBar(tsMs: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(tsMs));
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const t = h * 60 + m;
  return t >= 570 && t < 960; // 09:30 <= t < 16:00
}

function _getETHoursMinutes(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  return {
    hour:   Number(parts.find(p => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find(p => p.type === 'minute')?.value ?? 0),
  };
}

function _getSessionLabel(): SessionLabel {
  const { hour, minute } = _getETHoursMinutes();
  const t = hour * 60 + minute;  // minutes since midnight ET
  if (t < 570)  return 'premarket';    // before 9:30
  if (t < 600)  return 'opening';      // 9:30 – 10:00
  if (t < 690)  return 'midmorning';   // 10:00 – 11:30
  if (t < 780)  return 'lunch';        // 11:30 – 13:00
  if (t < 900)  return 'afternoon';    // 13:00 – 15:00
  if (t < 960)  return 'close';        // 15:00 – 16:00
  return 'afterhours';                 // after 16:00
}

function _getETDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

class BarAccumulator {
  private _bars1m: OhlcBar[] = [];
  private _bars5m: OhlcBar[] = [];
  private _bars15m: OhlcBar[] = [];
  private _currentBar: { open: number; high: number; low: number; close: number; volume: number; minuteKey: number } | null = null;
  private _vwapSumPV = 0;
  private _vwapSumV = 0;
  private _prevTotalVolume: number | null = null;
  private _state: IndicatorState = 'warming';
  private _lastSessionResetKey = '';

  get state(): IndicatorState { return this._state; }

  onTick(price: number, totalVolume: number | undefined, tickTs: number): void {
    // Use one consistent timestamp for all time-based decisions
    const minuteKey = Math.floor(tickTs / 60000);

    // Close current bar if new minute started
    if (this._currentBar && this._currentBar.minuteKey !== minuteKey) {
      this._closeCurrentBar();
    }

    // Start new bar if needed
    if (!this._currentBar) {
      this._currentBar = { open: price, high: price, low: price, close: price, volume: 0, minuteKey };
    }

    // Update OHLC
    this._currentBar.high  = Math.max(this._currentBar.high, price);
    this._currentBar.low   = Math.min(this._currentBar.low, price);
    this._currentBar.close = price;

    // Volume delta from TotalTradeVolume
    let tickVolume = 1; // fallback: count 1 per tick
    let volumeValid = true;
    if (totalVolume != null && this._prevTotalVolume != null) {
      const delta = totalVolume - this._prevTotalVolume;
      if (delta > 0 && delta < 100000) {
        tickVolume = delta;
      } else {
        // Negative or huge delta (reconnect boundary / reset) — discard
        volumeValid = false;
        if (delta < 0) {
          console.log(`[BarAccumulator] Invalid volume delta=${delta} (negative) — ignoring for VWAP`);
        } else if (delta >= 100000) {
          console.log(`[BarAccumulator] Invalid volume delta=${delta} (too large) — ignoring for VWAP`);
        }
      }
    }
    if (totalVolume != null) {
      this._prevTotalVolume = totalVolume;
    }

    this._currentBar.volume += tickVolume;

    // Session reset BEFORE VWAP accumulation — prevents first RTH tick from being dropped
    this._checkSessionReset(tickTs);

    // Accumulate VWAP — RTH session only, skip invalid volume deltas
    if (_isRthBar(tickTs) && volumeValid) {
      this._vwapSumPV += price * tickVolume;
      this._vwapSumV  += tickVolume;
    }

    this._updateState();
  }

  loadHistorical(bars: OhlcBar[]): void {
    bars.sort((a, b) => a.timestamp - b.timestamp);
    this._bars1m = bars.slice(-300);

    // Clock-aligned aggregation (not array-chunked)
    this._bars5m  = _aggregateBarsByTimeframe(this._bars1m, 5).slice(-60);
    this._bars15m = _aggregateBarsByTimeframe(this._bars1m, 15).slice(-20);

    // Seed VWAP from today's RTH bars only (09:30-16:00 ET)
    const todayKey = _getETDateKey();
    this._vwapSumPV = 0;
    this._vwapSumV  = 0;
    let rthBarCount = 0;
    for (const b of this._bars1m) {
      const barKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(b.timestamp));
      if (barKey !== todayKey) continue;
      if (!_isRthBar(b.timestamp)) continue;
      const typicalPrice = (b.high + b.low + b.close) / 3;
      this._vwapSumPV += typicalPrice * b.volume;
      this._vwapSumV  += b.volume;
      rthBarCount++;
    }

    const readiness = this._computeReadiness();
    console.log(
      `[BarAccumulator] Loaded ${bars.length} 1m bars → ${this._bars5m.length} aligned 5m, ${this._bars15m.length} aligned 15m. ` +
      `VWAP seeded from ${rthBarCount} RTH bars. ` +
      `indicatorState=${readiness.state}${readiness.missing.length ? ` missing=[${readiness.missing.join(',')}]` : ''}`,
    );
    this._state = readiness.state;
  }

  reset(reason: string): void {
    this._bars1m  = [];
    this._bars5m  = [];
    this._bars15m = [];
    this._currentBar = null;
    this._prevTotalVolume = null;
    this._vwapSumPV = 0;
    this._vwapSumV  = 0;
    this._state = 'warming';
    console.log(`[BarAccumulator] Reset — reason: ${reason}`);
  }

  resetVwap(): void {
    this._vwapSumPV = 0;
    this._vwapSumV  = 0;
    this._prevTotalVolume = null;
  }

  getATR(): number | undefined {
    if (this._bars5m.length < 15) return undefined;
    const bars = this._bars5m.slice(-15);
    let sum = 0;
    for (let i = 1; i < bars.length; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low  - bars[i - 1].close),
      );
      sum += tr;
    }
    return sum / 14;
  }

  getVWAP(): number | undefined {
    return this._vwapSumV > 0 ? this._vwapSumPV / this._vwapSumV : undefined;
  }

  getTrend(tf: '5m' | '15m'): BarTrend {
    const bars = tf === '5m' ? this._bars5m : this._bars15m;
    if (bars.length < 6) return 'unknown';
    const recent = bars.slice(-6);
    let rising  = 0;
    let falling = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].close > recent[i - 1].close) rising++;
      else if (recent[i].close < recent[i - 1].close) falling++;
    }
    if (rising >= 4)  return 'up';
    if (falling >= 4) return 'down';
    return 'range';
  }

  getVolatilityRegime(): VolatilityRegime | undefined {
    if (this._bars5m.length < 28) return undefined;
    const atrOf = (slice: OhlcBar[]): number => {
      let s = 0;
      for (let i = 1; i < slice.length; i++) {
        s += Math.max(
          slice[i].high - slice[i].low,
          Math.abs(slice[i].high - slice[i - 1].close),
          Math.abs(slice[i].low  - slice[i - 1].close),
        );
      }
      return s / (slice.length - 1);
    };
    const currentATR = atrOf(this._bars5m.slice(-14));
    const prevATR    = atrOf(this._bars5m.slice(-28, -14));
    if (prevATR === 0) return undefined;
    const ratio = currentATR / prevATR;
    if (ratio < 0.6) return 'low';
    if (ratio > 1.5) return 'high';
    return 'normal';
  }

  /**
   * Return bar arrays including the in-progress (forming) candle.
   * This is critical for chart display — without it, the chart lags by up to
   * one full candle period (5 min for 5m, 15 min for 15m).
   */
  getBarsWithLive(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } {
    // Snapshot the current forming 1m bar (if any)
    const liveBar: OhlcBar | null = this._currentBar
      ? {
          timestamp: this._currentBar.minuteKey * 60_000,
          open:   this._currentBar.open,
          high:   this._currentBar.high,
          low:    this._currentBar.low,
          close:  this._currentBar.close,
          volume: this._currentBar.volume,
        }
      : null;

    // 1m: completed bars + forming bar
    const bars1m = liveBar ? [...this._bars1m, liveBar] : [...this._bars1m];

    // 5m: completed 5m bars + live partial 5m bar from current bucket.
    // Replace last bar if it's already in the same bucket to avoid duplicates.
    const bars5m = [...this._bars5m];
    if (liveBar) {
      const liveBucket5m = _floorToTimeframe(liveBar.timestamp, 5);
      const barsInBucket = bars1m.filter(b => _floorToTimeframe(b.timestamp, 5) === liveBucket5m);
      if (barsInBucket.length > 0) {
        const live5mBar = _aggregateBars(barsInBucket);
        const last = bars5m[bars5m.length - 1];
        if (last && _floorToTimeframe(last.timestamp, 5) === liveBucket5m) {
          bars5m[bars5m.length - 1] = live5mBar;
        } else {
          bars5m.push(live5mBar);
        }
      }
    }

    // 15m: same replace-if-same-bucket pattern
    const bars15m = [...this._bars15m];
    if (liveBar) {
      const liveBucket15m = _floorToTimeframe(liveBar.timestamp, 15);
      const barsInBucket = bars1m.filter(b => _floorToTimeframe(b.timestamp, 15) === liveBucket15m);
      if (barsInBucket.length > 0) {
        const live15mBar = _aggregateBars(barsInBucket);
        const last = bars15m[bars15m.length - 1];
        if (last && _floorToTimeframe(last.timestamp, 15) === liveBucket15m) {
          bars15m[bars15m.length - 1] = live15mBar;
        } else {
          bars15m.push(live15mBar);
        }
      }
    }

    return { bars1m, bars5m, bars15m };
  }

  // ── Private helpers ──

  private _closeCurrentBar(): void {
    if (!this._currentBar) return;
    const barTs = this._currentBar.minuteKey * 60000;
    const bar: OhlcBar = {
      timestamp: barTs,
      open:   this._currentBar.open,
      high:   this._currentBar.high,
      low:    this._currentBar.low,
      close:  this._currentBar.close,
      volume: this._currentBar.volume,
    };
    this._bars1m.push(bar);
    if (this._bars1m.length > 300) this._bars1m.shift();

    // Clock-aligned aggregation: check if this bar is the last minute in its 5m/15m bucket
    const nextMinuteTs = barTs + 60_000;
    const bucket5m  = _floorToTimeframe(barTs, 5);
    const bucket15m = _floorToTimeframe(barTs, 15);

    // If the next minute would start a new 5m bucket, this bar closes the current one
    if (_floorToTimeframe(nextMinuteTs, 5) !== bucket5m) {
      const barsInBucket = this._bars1m.filter(b => _floorToTimeframe(b.timestamp, 5) === bucket5m);
      if (barsInBucket.length > 0) {
        this._bars5m.push(_aggregateBars(barsInBucket));
        if (this._bars5m.length > 60) this._bars5m.shift();
      }
    }
    if (_floorToTimeframe(nextMinuteTs, 15) !== bucket15m) {
      const barsInBucket = this._bars1m.filter(b => _floorToTimeframe(b.timestamp, 15) === bucket15m);
      if (barsInBucket.length > 0) {
        this._bars15m.push(_aggregateBars(barsInBucket));
        if (this._bars15m.length > 20) this._bars15m.shift();
      }
    }

    this._currentBar = null;
  }

  private _checkSessionReset(tsMs: number): void {
    const d = new Date(tsMs);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(d);
    const hour   = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    if (dateKey !== this._lastSessionResetKey && hour === 9 && minute >= 30) {
      this._lastSessionResetKey = dateKey;
      this.resetVwap();
      console.log('[BarAccumulator] Session VWAP reset at 9:30 ET');
    }
  }

  /** Centralized readiness: all 5 required components must be available. */
  private _computeReadiness(): { state: IndicatorState; missing: string[] } {
    // If already degraded from bad data, stay degraded until reset
    if (this._state === 'degraded') return { state: 'degraded', missing: [] };

    const missing: string[] = [];
    if (this.getATR() == null)                         missing.push('atr5m');
    if (this.getVWAP() == null)                        missing.push('vwap');
    if (this.getTrend('5m') === 'unknown')             missing.push('trend5m');
    if (this.getTrend('15m') === 'unknown')            missing.push('trend15m');
    if (this.getVolatilityRegime() == null)            missing.push('volatilityRegime');

    if (missing.length === 0) return { state: 'ready', missing: [] };
    return { state: 'warming', missing };
  }

  /** Update state and log on state transitions. */
  private _updateState(): void {
    const { state, missing } = this._computeReadiness();
    const prev = this._state;
    this._state = state;
    if (state !== prev) {
      console.log(`[BarAccumulator] indicatorState=${state}${missing.length ? ` missing=[${missing.join(',')}]` : ''}`);
    }
  }
}

// ── TradovateClient ───────────────────────────────────────────────────────────

export class TradovateClient {
  private session: TradovateSession | null = null;
  private ws: WebSocket | null = null;
  private quotes: Map<string, QuoteTick> = new Map();
  private wsReady = false;
  private _pendingResolvers: Map<number, (data: unknown) => void> = new Map();
  private _msgId = 1;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _targetSymbol: string | null = null;
  private _accumulator = new BarAccumulator();

  get isConnected(): boolean {
    return this.session !== null && this.wsReady;
  }

  get accountMode(): 'simulation' | 'live' | 'unknown' {
    return this.session?.accountMode ?? 'unknown';
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  async authenticate(creds: TradovateCredentials): Promise<void> {
    const base = creds.accountMode === 'live'
      ? 'https://live.tradovateapi.com/v1'
      : 'https://demo.tradovateapi.com/v1';

    const body = {
      name:       creds.username,
      password:   creds.password,
      appId:      'TriForge',
      appVersion: '1.0',
      deviceId:   'triforge-desktop',
      cid:        creds.cid ?? 0,
      sec:        creds.sec ?? '',
    };

    const res = await restPost(`${base}/auth/accesstokenrequest`, body) as Record<string, unknown>;

    if (res.errorText) {
      throw new Error(String(res.errorText));
    }
    if (!res.accessToken) {
      throw new Error('Authentication failed — no access token returned. Check credentials and API access.');
    }

    this.session = {
      accessToken:    String(res.accessToken),
      mdAccessToken:  String(res.mdAccessToken ?? res.accessToken),
      expirationTime: String(res.expirationTime ?? ''),
      accountMode:    creds.accountMode,
      userId:         Number(res.userId ?? 0),
      name:           String(res.name ?? creds.username),
    };

    // Start market data WebSocket
    await this._connectMdWebSocket();
  }

  // ── Market data WebSocket ────────────────────────────────────────────────────

  private async _connectMdWebSocket(): Promise<void> {
    if (!this.session) return;

    // Lazy import ws to avoid renderer access
    const { default: WsClass } = await import('ws') as { default: typeof WebSocket };

    const mdUrl = this.session.accountMode === 'live'
      ? 'wss://md.tradovateapi.com/v1/websocket'
      : 'wss://md-demo.tradovateapi.com/v1/websocket';

    this.ws = new (WsClass as unknown as new (url: string) => WebSocket)(mdUrl);

    this.ws.on('open', () => {
      // Authorize on the MD WebSocket
      this._wsSend(`authorize\n${this._msgId++}\n\n${JSON.stringify({ token: this.session!.mdAccessToken })}`);
    });

    this.ws.on('message', (raw: Buffer) => {
      this._handleWsMessage(raw.toString());
    });

    this.ws.on('close', () => {
      this.wsReady = false;
      this._accumulator.reset('reconnect');
      this._scheduleReconnect();
    });

    this.ws.on('error', () => {
      this.wsReady = false;
    });
  }

  private _wsSend(msg: string): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(msg);
    }
  }

  private _handleWsMessage(raw: string): void {
    // Tradovate protocol: first char is frame type
    if (raw.startsWith('o')) {
      // Connection open — nothing needed yet
      return;
    }
    if (raw.startsWith('h')) {
      // Heartbeat
      return;
    }
    if (raw.startsWith('a')) {
      // Array of JSON messages
      try {
        const msgs = JSON.parse(raw.slice(1)) as string[];
        for (const msgStr of msgs) {
          const msg = JSON.parse(msgStr) as Record<string, unknown>;
          this._processMessage(msg);
        }
      } catch { /* ignore malformed */ }
    }
  }

  private _processMessage(msg: Record<string, unknown>): void {
    const e = msg['e'] as string | undefined;
    const s = msg['s'] as number | undefined;
    const d = msg['d'] as Record<string, unknown> | undefined;

    // Authorization response
    if (e === 'response' && d?.['i'] === 1) {
      this.wsReady = true;
      // Re-subscribe to active symbol if any
      if (this._targetSymbol) {
        this.subscribeQuote(this._targetSymbol);
      }
      return;
    }

    // Token renewal confirmation
    if (s === 200 && !e) {
      this.wsReady = true;
      return;
    }

    // Market data event
    if (e === 'md') {
      const quotes = (d?.['quotes'] ?? []) as Array<Record<string, unknown>>;
      for (const q of quotes) {
        this._processQuote(q);
      }
      return;
    }

    // Resolve pending request promises (used by _fetchHistoricalBars)
    const responseId = d?.['i'] !== undefined ? Number(d['i']) : undefined;
    if (responseId !== undefined && this._pendingResolvers.has(responseId)) {
      const resolver = this._pendingResolvers.get(responseId)!;
      this._pendingResolvers.delete(responseId);
      resolver(d);
      return;
    }

    // Generic 200 response (auth success in some protocol versions)
    if (s === 200) {
      this.wsReady = true;
    }
  }

  private _processQuote(q: Record<string, unknown>): void {
    const entries = q['entries'] as Record<string, Record<string, unknown>> | undefined;
    if (!entries) return;

    const contractId = String(q['contractId'] ?? '');
    // Use symbol from subscription tracking — we key by symbol
    const symbol = this._symbolForContract(contractId) ?? this._targetSymbol;
    if (!symbol) return;

    const existing = this.quotes.get(symbol) ?? { symbol, receivedAt: 0 };

    if (entries['Trade']) {
      existing.lastPrice = Number(entries['Trade']['price']);
    }
    if (entries['Bid']) {
      existing.bidPrice = Number(entries['Bid']['price']);
    }
    if (entries['Ask']) {
      existing.askPrice = Number(entries['Ask']['price']);
    }
    if (entries['HighPrice']) {
      existing.highOfDay = Number(entries['HighPrice']['price']);
    }
    if (entries['LowPrice']) {
      existing.lowOfDay = Number(entries['LowPrice']['price']);
    }
    if (entries['TotalTradeVolume']) {
      existing.totalVolume = Number(entries['TotalTradeVolume']['price']);
    }
    existing.receivedAt = Date.now();
    this.quotes.set(symbol, existing);

    // Feed tick to bar accumulator for ATR / VWAP / trend computation
    if (existing.lastPrice != null) {
      this._accumulator.onTick(existing.lastPrice, existing.totalVolume, existing.receivedAt);
    }
  }

  private _contractMap: Map<string, string> = new Map(); // contractId → symbol

  private _symbolForContract(contractId: string): string | undefined {
    return this._contractMap.get(contractId);
  }

  // ── Account state (REST) ─────────────────────────────────────────────────────

  async getAccountState(): Promise<TradovateAccountState> {
    if (!this.session) throw new Error('Not authenticated.');

    const base  = this.session.accountMode === 'live'
      ? 'https://live.tradovateapi.com/v1'
      : 'https://demo.tradovateapi.com/v1';
    const token = this.session.accessToken;

    const [accountsRaw, positionsRaw, ordersRaw] = await Promise.all([
      restGet(`${base}/account/list`, token),
      restGet(`${base}/position/list`, token),
      restGet(`${base}/order/list`,    token),
    ]) as [unknown[], unknown[], unknown[]];

    // Pick first account (most users have one)
    const acct = (Array.isArray(accountsRaw) ? accountsRaw[0] : {}) as Record<string, unknown>;

    const positions: TradovateAccountPosition[] = (Array.isArray(positionsRaw) ? positionsRaw : [])
      .filter((p: unknown) => {
        const pos = p as Record<string, unknown>;
        return typeof pos['netPos'] === 'number' && (pos['netPos'] as number) !== 0;
      })
      .map((p: unknown) => {
        const pos = p as Record<string, unknown>;
        return {
          contractId: Number(pos['contractId'] ?? 0),
          symbol:     String(pos['contractSymbol'] ?? pos['symbol'] ?? pos['contractId'] ?? ''),
          netPos:     Number(pos['netPos'] ?? 0),
          netPrice:   Number(pos['netPrice'] ?? 0),
          openPnl:    Number(pos['openPnl'] ?? 0),
          closedPnl:  Number(pos['closedPnl'] ?? 0),
        };
      });

    const workingOrders: TradovateWorkingOrder[] = (Array.isArray(ordersRaw) ? ordersRaw : [])
      .filter((o: unknown) => {
        const ord = o as Record<string, unknown>;
        const status = String(ord['ordStatus'] ?? '');
        return status === 'Working' || status === 'Accepted';
      })
      .map((o: unknown) => {
        const ord = o as Record<string, unknown>;
        const action = String(ord['action'] ?? 'Buy');
        return {
          id:         Number(ord['id'] ?? 0),
          contractId: Number(ord['contractId'] ?? 0),
          symbol:     String(ord['contractSymbol'] ?? ord['symbol'] ?? ord['contractId'] ?? ''),
          side:       (action === 'Sell' ? 'Sell' : 'Buy') as 'Buy' | 'Sell',
          qty:        Number(ord['totalQty'] ?? ord['qty'] ?? 0),
          orderType:  String(ord['orderType'] ?? 'Market'),
          price:      ord['price']     !== undefined ? Number(ord['price'])     : undefined,
          stopPrice:  ord['stopPrice'] !== undefined ? Number(ord['stopPrice']) : undefined,
          status:     String(ord['ordStatus'] ?? ''),
        };
      });

    return {
      accountId:   Number(acct['id'] ?? 0),
      accountName: String(acct['name'] ?? acct['nickname'] ?? ''),
      accountMode: this.session.accountMode,
      cashBalance: Number(acct['cashBalance'] ?? acct['balance'] ?? 0),
      openPnl:     Number(acct['openPnl'] ?? 0),
      realizedPnl: Number(acct['realizedPnl'] ?? 0),
      buyingPower: Number(acct['buyingPower'] ?? acct['availableFunds'] ?? acct['cashBalance'] ?? 0),
      positions,
      workingOrders,
      fetchedAt:   Date.now(),
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  subscribeQuote(symbol: string): void {
    const newSymbol = symbol.toUpperCase();
    const changed   = this._targetSymbol !== newSymbol;
    this._targetSymbol = newSymbol;

    if (changed) {
      this._accumulator.reset('symbol_change');
    }

    if (!this.wsReady) return;
    const id = this._msgId++;
    this._wsSend(`md/subscribequote\n${id}\n\n${JSON.stringify({ symbol: this._targetSymbol })}`);

    // Request historical bars for warm start (non-blocking, non-fatal)
    if (changed) {
      this._fetchHistoricalBars(this._targetSymbol).catch(() => { /* logged inside */ });
    }
  }

  unsubscribeAll(): void {
    if (!this.wsReady) return;
    this._wsSend(`md/unsubscribequote\n${this._msgId++}\n\n{}`);
    this._targetSymbol = null;
  }

  getSnapshot(symbol: string): LiveTradeSnapshot {
    const sym   = symbol.toUpperCase();
    const quote = this.quotes.get(sym);
    const now   = Date.now();

    if (!this.session) {
      return { connected: false, accountMode: 'unknown', symbol: sym };
    }

    if (!quote) {
      return {
        connected:   true,
        accountMode: this.session.accountMode,
        symbol:      sym,
        warning:     this.wsReady ? 'Waiting for first tick...' : 'Market data WebSocket connecting...',
        feedFreshnessMs: undefined,
      };
    }

    const feedFreshnessMs = now - quote.receivedAt;
    const trend = this._inferTrend(quote);

    // Phase 2 enrichments
    const atr5m = this._accumulator.getATR();
    const vwap  = this._accumulator.getVWAP();
    const range = (quote.highOfDay && quote.lowOfDay) ? quote.highOfDay - quote.lowOfDay : 0;

    return {
      connected:       true,
      accountMode:     this.session.accountMode,
      symbol:          sym,
      lastPrice:       quote.lastPrice,
      bidPrice:        quote.bidPrice,
      askPrice:        quote.askPrice,
      highOfDay:       quote.highOfDay,
      lowOfDay:        quote.lowOfDay,
      trend,
      feedFreshnessMs,
      warning:         feedFreshnessMs > 8000 ? 'Feed may be stale' : undefined,
      // Phase 2
      atr5m,
      vwap,
      vwapRelation:     this._computeVwapRelation(quote.lastPrice, vwap, atr5m),
      trend5m:          this._accumulator.getTrend('5m'),
      trend15m:         this._accumulator.getTrend('15m'),
      sessionLabel:     _getSessionLabel(),
      volatilityRegime: this._accumulator.getVolatilityRegime(),
      rangePct:         range > 0 && quote.lastPrice ? (range / quote.lastPrice) * 100 : undefined,
      indicatorState:   this._accumulator.state,
    };
  }

  private _inferTrend(quote: QuoteTick): 'up' | 'down' | 'range' | 'unknown' {
    if (!quote.lastPrice || !quote.highOfDay || !quote.lowOfDay) return 'unknown';
    const range = quote.highOfDay - quote.lowOfDay;
    if (range === 0) return 'unknown';
    const pos = (quote.lastPrice - quote.lowOfDay) / range;
    if (pos > 0.65) return 'up';
    if (pos < 0.35) return 'down';
    return 'range';
  }

  private _computeVwapRelation(price?: number, vwap?: number, atr?: number): VwapRelation | undefined {
    if (price == null || vwap == null) return undefined;
    const diff = price - vwap;
    const absDiff = Math.abs(diff);
    // Use ATR-scaled thresholds when available, else 2 ticks (0.5 pts)
    const nearThreshold = atr != null ? atr * 0.3 : 0.5;
    const extThreshold  = atr != null ? atr * 1.5 : Infinity;
    if (absDiff < nearThreshold) return 'at';
    if (diff > 0 && absDiff >= extThreshold) return 'extended_above';
    if (diff < 0 && absDiff >= extThreshold) return 'extended_below';
    return diff > 0 ? 'above' : 'below';
  }

  // ── Historical bar warm start ──────────────────────────────────────────────

  private async _fetchHistoricalBars(symbol: string): Promise<void> {
    if (!this.wsReady || !this.session) return;

    const id = this._msgId++;
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    const body = JSON.stringify({
      symbol,
      chartDescription: {
        underlyingType: 'MinuteBar',
        elementSize: 1,
        elementSizeUnit: 'UnderlyingUnits',
      },
      timeRange: {
        asFarAsTimestamp: fiveHoursAgo,
      },
    });

    try {
      const data = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pendingResolvers.delete(id);
          reject(new Error('Chart request timed out'));
        }, 15000);

        this._pendingResolvers.set(id, (d: unknown) => {
          clearTimeout(timer);
          resolve(d);
        });

        this._wsSend(`md/getChart\n${id}\n\n${body}`);
      });

      const d = data as Record<string, unknown>;
      const charts = d['charts'] as Array<Record<string, unknown>> | undefined;
      if (!charts || charts.length === 0) {
        console.log('[TradovateClient] No historical chart data returned');
        return;
      }

      const rawBars = charts[0]['bars'] as Array<Record<string, unknown>> | undefined;
      if (!rawBars || rawBars.length === 0) {
        console.log('[TradovateClient] Chart returned but no bars');
        return;
      }

      const ohlcBars: OhlcBar[] = rawBars.map(b => ({
        timestamp: new Date(String(b['timestamp'])).getTime(),
        open:      Number(b['open'] ?? 0),
        high:      Number(b['high'] ?? 0),
        low:       Number(b['low'] ?? 0),
        close:     Number(b['close'] ?? 0),
        volume:    Number(b['upVolume'] ?? 0) + Number(b['downVolume'] ?? 0),
      })).filter(b => b.timestamp > 0 && b.open > 0);

      if (ohlcBars.length > 0) {
        this._accumulator.loadHistorical(ohlcBars);
        console.log(`[TradovateClient] Loaded ${ohlcBars.length} historical bars for ${symbol}`);
      }
    } catch (err) {
      console.warn(`[TradovateClient] Historical bar fetch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Return OHLC bars including the live forming candle for all timeframes. */
  getBars(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } {
    return this._accumulator.getBarsWithLive();
  }

  disconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch { /* ok */ }
      this.ws = null;
    }
    this.session  = null;
    this.wsReady  = false;
    this.quotes.clear();
    this._accumulator.reset('disconnect');
  }

  private _scheduleReconnect(): void {
    if (!this.session) return; // disconnected intentionally
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this.session) {
        try { await this._connectMdWebSocket(); } catch { /* will retry next close */ }
      }
    }, 5000);
  }
}
