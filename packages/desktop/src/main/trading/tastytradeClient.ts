// ── main/trading/tastytradeClient.ts ──────────────────────────────────────────
//
// Tastytrade REST + dxLink WebSocket client.
// Provides real-time NQ/ES/etc. futures data via Tastytrade's free paper account.
// No Tradovate API subscription required.
//
// Flow:
//   1. POST /sessions          → session-token
//   2. GET  /quote-streamer-tokens → streamer websocket URL + token
//   3. Connect dxLink WebSocket
//   4. SETUP → AUTH → CHANNEL_REQUEST → FEED_SUBSCRIPTION
//   5. Candle events  → build 1m bar history
//   6. Trade events   → live tick price + forming bar
//   7. Quote events   → bid/ask
//
// Tastytrade API: https://developer.tastytrade.com
// dxLink WebSocket protocol: https://dxfeed.com/dxlink
//
// Symbol mapping (Triforge → Tastytrade dxFeed):
//   NQ  → /NQ:XCME     MNQ → /MNQ:XCME
//   ES  → /ES:XCME     MES → /MES:XCME
//   RTY → /RTY:XCME    M2K → /M2K:XCME
//   CL  → /CL:NYMEX    GC  → /GC:COMEX

import https from 'https';
import type WebSocket from 'ws';
import type { LiveTradeSnapshot, VwapRelation, BarTrend, SessionLabel, VolatilityRegime, IndicatorState } from '@triforge/engine';
import type { OhlcBar } from './tradovateClient';

// ── Symbol map ────────────────────────────────────────────────────────────────

const DX_SYMBOL_MAP: Record<string, string> = {
  NQ:  '/NQ:XCME',
  MNQ: '/MNQ:XCME',
  ES:  '/ES:XCME',
  MES: '/MES:XCME',
  RTY: '/RTY:XCME',
  M2K: '/M2K:XCME',
  CL:  '/CL:NYMEX',
  GC:  '/GC:COMEX',
};

function _toDxSymbol(symbol: string): string {
  return DX_SYMBOL_MAP[symbol.toUpperCase()] ?? `/${symbol.toUpperCase()}:XCME`;
}

// ── REST helpers ──────────────────────────────────────────────────────────────

function _restGet(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  {
        'Authorization': token,
        'Accept':        'application/json',
        'Content-Type':  'application/json; charset=utf-8',
        'User-Agent':    'TriForge-AI/1.0 (Electron)',
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}: ${raw.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

interface _PostOpts {
  token?:        string;
  extraHeaders?: Record<string, string>;
}

function _restPost(url: string, body: unknown, opts: _PostOpts = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed  = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Accept':         'application/json',
        'User-Agent':     'TriForge-AI/1.0 (Electron)',
        ...(opts.token        ? { 'Authorization': opts.token } : {}),
        ...(opts.extraHeaders ?? {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed2: unknown;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = raw; }

        // Device challenge is not a hard error — return a tagged object so caller handles it
        if (res.statusCode === 403) {
          const b = parsed2 as Record<string, unknown> | undefined;
          const code = (b?.['error'] as Record<string, unknown> | undefined)?.['code'];
          if (code === 'device_challenge_required') {
            const challengeToken = res.headers['x-tastyworks-challenge-token'] as string ?? '';
            return resolve({ _deviceChallenge: true, challengeToken, body: parsed2 });
          }
        }

        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}: ${raw.slice(0, 300)}`));
        }
        resolve(parsed2);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Bar helpers ───────────────────────────────────────────────────────────────

function _floorToMin(tsMs: number, minutes: number): number {
  return Math.floor(tsMs / (minutes * 60_000)) * (minutes * 60_000);
}

function _aggregateBars(bars: OhlcBar[]): OhlcBar {
  return {
    timestamp: bars[0].timestamp,
    open:   bars[0].open,
    high:   Math.max(...bars.map(b => b.high)),
    low:    Math.min(...bars.map(b => b.low)),
    close:  bars[bars.length - 1].close,
    volume: bars.reduce((s, b) => s + b.volume, 0),
  };
}

function _aggregateByTf(bars1m: OhlcBar[], minutes: number): OhlcBar[] {
  if (bars1m.length === 0) return [];
  const buckets = new Map<number, OhlcBar[]>();
  for (const b of bars1m) {
    const k = _floorToMin(b.timestamp, minutes);
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(b);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map(k => _aggregateBars(buckets.get(k)!));
}

function _isRthBar(tsMs: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(tsMs));
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const t = h * 60 + m;
  return t >= 570 && t < 960;
}

function _getSessionLabel(): SessionLabel {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const t = h * 60 + m;
  if (t < 570) return 'premarket';
  if (t < 600) return 'opening';
  if (t < 690) return 'midmorning';
  if (t < 780) return 'lunch';
  if (t < 900) return 'afternoon';
  if (t < 960) return 'close';
  return 'afterhours';
}

// ── Indicator helpers ─────────────────────────────────────────────────────────

function _computeATR(bars5m: OhlcBar[]): number | undefined {
  if (bars5m.length < 15) return undefined;
  const slice = bars5m.slice(-15);
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    sum += Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low  - slice[i - 1].close),
    );
  }
  return sum / 14;
}

function _computeTrend(bars: OhlcBar[]): BarTrend {
  if (bars.length < 6) return 'unknown';
  const recent = bars.slice(-6);
  let rising = 0, falling = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].close > recent[i - 1].close) rising++;
    else if (recent[i].close < recent[i - 1].close) falling++;
  }
  if (rising >= 4)  return 'up';
  if (falling >= 4) return 'down';
  return 'range';
}

function _computeVolatilityRegime(bars5m: OhlcBar[]): VolatilityRegime | undefined {
  if (bars5m.length < 28) return undefined;
  const atrOf = (s: OhlcBar[]) => {
    let sum = 0;
    for (let i = 1; i < s.length; i++) {
      sum += Math.max(s[i].high - s[i].low, Math.abs(s[i].high - s[i-1].close), Math.abs(s[i].low - s[i-1].close));
    }
    return sum / (s.length - 1);
  };
  const cur  = atrOf(bars5m.slice(-14));
  const prev = atrOf(bars5m.slice(-28, -14));
  if (prev === 0) return undefined;
  const r = cur / prev;
  if (r < 0.6) return 'low';
  if (r > 1.5) return 'high';
  return 'normal';
}

function _computeVwapRelation(price?: number, vwap?: number, atr?: number): VwapRelation | undefined {
  if (price == null || vwap == null) return undefined;
  const diff    = price - vwap;
  const absDiff = Math.abs(diff);
  const near    = atr != null ? atr * 0.3 : 0.5;
  const ext     = atr != null ? atr * 1.5 : Infinity;
  if (absDiff < near) return 'at';
  if (diff > 0 && absDiff >= ext) return 'extended_above';
  if (diff < 0 && absDiff >= ext) return 'extended_below';
  return diff > 0 ? 'above' : 'below';
}

// ── TastytradeClient ──────────────────────────────────────────────────────────

const TASTYTRADE_API = 'https://api.tastytrade.com';
const DX_CHANNEL     = 1;

// ── Auth state machine ────────────────────────────────────────────────────────

export type TastytradeAuthState =
  | 'disconnected'
  | 'authenticating'
  | 'device_challenge_required'
  | 'authenticated'
  | 'quote_token_ready'
  | 'dxlink_connected'
  | 'ready';

// ── Device challenge error ────────────────────────────────────────────────────

export class TastytradeDeviceChallengeError extends Error {
  constructor(public readonly challengeToken: string) {
    super('DEVICE_CHALLENGE_REQUIRED');
    this.name = 'TastytradeDeviceChallengeError';
  }
}

// ── Client ────────────────────────────────────────────────────────────────────

export class TastytradeClient {
  private _authState: TastytradeAuthState = 'disconnected';
  private _sessionToken: string | null = null;
  private _pendingChallengeToken: string | null = null;
  private _ws: WebSocket | null = null;
  private _wsReady   = false;
  private _channelOpen = false;
  private _msgCounter = 0;

  get authState(): TastytradeAuthState { return this._authState; }

  // Active subscription
  private _symbol:   string | null = null;   // Triforge symbol e.g. "NQ"
  private _dxSymbol: string | null = null;   // dxFeed symbol  e.g. "/NQ:XCME"

  // Candle store: timestamp → OhlcBar (1m server-side bars)
  private _bars1mMap = new Map<number, OhlcBar>();
  private _historyDone = false;
  private _historyEndTimer: ReturnType<typeof setTimeout> | null = null;

  // Live forming bar (from Trade events between bar closes)
  private _formingBar: { open: number; high: number; low: number; close: number; volume: number; minuteKey: number } | null = null;

  // Live quote
  private _bid   = 0;
  private _ask   = 0;
  private _last  = 0;
  private _highOfDay = 0;
  private _lowOfDay  = 0;
  private _lastTickAt = 0;

  // VWAP accumulation (reset at 09:30 ET)
  private _vwapPV  = 0;
  private _vwapV   = 0;
  private _lastVwapResetKey = '';

  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  get isConnected(): boolean { return this._authState === 'ready'; }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async authenticate(username: string, password: string): Promise<void> {
    this._authState = 'authenticating';
    const res = await _restPost(`${TASTYTRADE_API}/sessions`, {
      login:         username,
      password:      password,
      'remember-me': false,
    }) as Record<string, unknown>;

    // Device challenge — must complete a second step before we have a session
    if (res['_deviceChallenge']) {
      this._pendingChallengeToken = (res['challengeToken'] as string) ?? '';
      this._authState = 'device_challenge_required';
      console.log('[TastytradeClient] Device challenge required — awaiting OTP');
      throw new TastytradeDeviceChallengeError(this._pendingChallengeToken);
    }

    const data = res['data'] as Record<string, unknown> | undefined;
    if (!data?.['session-token']) {
      this._authState = 'disconnected';
      const errMsg = (res['error'] as Record<string, unknown>)?.['message'] ?? JSON.stringify(res);
      throw new Error(`Tastytrade auth failed: ${errMsg}`);
    }

    this._sessionToken = String(data['session-token']);
    this._authState = 'authenticated';
    console.log('[TastytradeClient] Authenticated — connecting streamer');
    await this._connectStreamer();
  }

  /** Complete device challenge with the OTP the user received via email/SMS. */
  async verifyDevice(otp: string): Promise<void> {
    if (this._authState !== 'device_challenge_required' || !this._pendingChallengeToken) {
      throw new Error('No pending device challenge');
    }

    const res = await _restPost(`${TASTYTRADE_API}/sessions/device-challenge`, { answer: otp }, {
      extraHeaders: { 'X-Tastyworks-Challenge-Token': this._pendingChallengeToken },
    }) as Record<string, unknown>;

    const data = res['data'] as Record<string, unknown> | undefined;
    if (!data?.['session-token']) {
      const errMsg = (res['error'] as Record<string, unknown>)?.['message'] ?? JSON.stringify(res);
      throw new Error(`Device verification failed: ${errMsg}`);
    }

    this._sessionToken = String(data['session-token']);
    this._pendingChallengeToken = null;
    this._authState = 'authenticated';
    console.log('[TastytradeClient] Device verified — connecting streamer');
    await this._connectStreamer();
  }

  // ── Streamer connection ───────────────────────────────────────────────────

  private async _connectStreamer(): Promise<void> {
    if (!this._sessionToken) return;

    // Get dxLink WebSocket URL + token
    const tokenRes = await _restGet(
      `${TASTYTRADE_API}/quote-streamer-tokens`,
      this._sessionToken,
    ) as Record<string, unknown>;

    const tData = tokenRes['data'] as Record<string, unknown> | undefined;
    if (!tData) {
      this._authState = 'disconnected';
      console.error('[TastytradeClient] Failed to get streamer token:', JSON.stringify(tokenRes));
      throw new Error('Could not retrieve Tastytrade streamer token');
    }
    this._authState = 'quote_token_ready';

    // Tastytrade returns the token WITH "Bearer " prefix already in some versions
    const rawToken     = String(tData['token'] ?? '');
    const wsUrl        = String(tData['streamer-url'] ?? tData['websocket-url'] ?? 'wss://tasty-openapi-ws.dxfeed.com/realtime');
    const streamerToken = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;

    console.log(`[TastytradeClient] Connecting to dxLink at ${wsUrl}`);

    const { default: WsClass } = await import('ws') as { default: typeof WebSocket };
    this._ws = new (WsClass as unknown as new (url: string) => WebSocket)(wsUrl);

    this._ws.on('open', () => {
      this._authState = 'dxlink_connected';
      // Step 1: SETUP
      this._wsSend({ type: 'SETUP', channel: 0, version: '0.1-js/1.0.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
      // Step 2: AUTH
      this._wsSend({ type: 'AUTH', channel: 0, token: streamerToken });
    });

    this._ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        this._handleMessage(msg);
      } catch { /* ignore malformed */ }
    });

    this._ws.on('close', () => {
      this._wsReady    = false;
      this._channelOpen = false;
      console.log('[TastytradeClient] WebSocket closed — scheduling reconnect');
      this._scheduleReconnect();
    });

    this._ws.on('error', (err) => {
      console.error('[TastytradeClient] WebSocket error:', err.message);
      this._wsReady = false;
    });
  }

  private _wsSend(msg: Record<string, unknown>): void {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private _handleMessage(msg: Record<string, unknown>): void {
    const type = msg['type'] as string | undefined;

    if (type === 'SETUP') {
      // Server confirms setup — open a feed channel
      this._wsSend({ type: 'CHANNEL_REQUEST', channel: DX_CHANNEL, service: 'FEED', parameters: { contract: 'AUTO' } });
      return;
    }

    if (type === 'AUTH_STATE') {
      const state = msg['state'] as string | undefined;
      console.log(`[TastytradeClient] Auth state: ${state}`);
      if (state === 'AUTHORIZED') {
        this._wsReady = true;
        // If we already have a symbol to subscribe, do it now
        if (this._dxSymbol) {
          this._sendSubscription(this._dxSymbol);
        }
      }
      return;
    }

    if (type === 'CHANNEL_OPENED') {
      this._channelOpen = true;
      console.log('[TastytradeClient] Feed channel opened');
      if (this._dxSymbol && this._wsReady) {
        this._sendSubscription(this._dxSymbol);
      }
      return;
    }

    if (type === 'KEEPALIVE') {
      // Respond to server keepalive
      this._wsSend({ type: 'KEEPALIVE', channel: 0 });
      return;
    }

    if (type === 'FEED_DATA') {
      const data = msg['data'] as unknown[] | undefined;
      if (Array.isArray(data)) {
        for (const item of data) {
          this._handleFeedItem(item as Record<string, unknown>);
        }
      }
      return;
    }

    if (type === 'ERROR') {
      console.error('[TastytradeClient] dxLink error:', JSON.stringify(msg));
    }
  }

  private _handleFeedItem(item: Record<string, unknown>): void {
    const evType = item['eventType'] as string | undefined;
    if (!evType) return;

    if (evType === 'Candle') {
      this._handleCandleEvent(item);
      return;
    }
    if (evType === 'Trade' || evType === 'TradeL2') {
      this._handleTradeEvent(item);
      return;
    }
    if (evType === 'Quote') {
      this._handleQuoteEvent(item);
      return;
    }
    if (evType === 'Summary') {
      // Summary has high/low of day
      const high = Number(item['dayHighPrice'] ?? item['highPrice'] ?? 0);
      const low  = Number(item['dayLowPrice']  ?? item['lowPrice']  ?? 0);
      if (high > 0) this._highOfDay = high;
      if (low  > 0) this._lowOfDay  = low;
    }
  }

  private _handleCandleEvent(ev: Record<string, unknown>): void {
    const tsRaw = ev['time'] ?? ev['eventTime'];
    const ts    = typeof tsRaw === 'number' ? tsRaw : Number(tsRaw ?? 0);
    if (ts <= 0) return;

    const open   = Number(ev['open']   ?? 0);
    const high   = Number(ev['high']   ?? 0);
    const low    = Number(ev['low']    ?? 0);
    const close  = Number(ev['close']  ?? 0);
    const volume = Number(ev['volume'] ?? 0);

    if (open <= 0) return; // incomplete or invalid candle

    const bar: OhlcBar = { timestamp: ts, open, high, low, close, volume };
    this._bars1mMap.set(ts, bar);

    // Keep last 300 bars
    if (this._bars1mMap.size > 300) {
      const oldest = [...this._bars1mMap.keys()].sort((a, b) => a - b)[0];
      this._bars1mMap.delete(oldest);
    }

    // Debounce "history done" detection: if no new candle arrives in 2s, assume history is loaded
    if (this._historyEndTimer) clearTimeout(this._historyEndTimer);
    this._historyEndTimer = setTimeout(() => {
      if (!this._historyDone) {
        this._historyDone = true;
        this._seedVwap();
        console.log(`[TastytradeClient] History loaded — ${this._bars1mMap.size} 1m bars for ${this._symbol}`);
      }
    }, 2000);
  }

  private _handleTradeEvent(ev: Record<string, unknown>): void {
    const price  = Number(ev['price']  ?? ev['tradePrice']  ?? 0);
    const size   = Number(ev['size']   ?? ev['tradeSize']   ?? 1);
    const tsRaw  = ev['time'] ?? ev['eventTime'];
    const ts     = typeof tsRaw === 'number' ? tsRaw : (Date.now());

    if (price <= 0) return;

    this._last      = price;
    this._lastTickAt = Date.now();
    if (this._authState === 'dxlink_connected') this._authState = 'ready';

    // Update forming 1m bar
    const minuteKey = Math.floor(ts / 60_000);
    if (this._formingBar && this._formingBar.minuteKey !== minuteKey) {
      // Close the old forming bar
      this._formingBar = null;
    }
    if (!this._formingBar) {
      this._formingBar = { open: price, high: price, low: price, close: price, volume: 0, minuteKey };
    }
    this._formingBar.high   = Math.max(this._formingBar.high, price);
    this._formingBar.low    = Math.min(this._formingBar.low,  price);
    this._formingBar.close  = price;
    this._formingBar.volume += size;

    // Accumulate VWAP (RTH only)
    this._checkVwapReset(ts);
    if (_isRthBar(ts)) {
      this._vwapPV += price * size;
      this._vwapV  += size;
    }
  }

  private _handleQuoteEvent(ev: Record<string, unknown>): void {
    const bid = Number(ev['bidPrice'] ?? 0);
    const ask = Number(ev['askPrice'] ?? 0);
    if (bid > 0) this._bid = bid;
    if (ask > 0) this._ask = ask;
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  private _sendSubscription(dxSymbol: string): void {
    const fiveHoursAgoMs = Date.now() - 5 * 60 * 60 * 1000;
    const candleSymbol   = `${dxSymbol}{=1m}`;

    this._wsSend({
      type:    'FEED_SUBSCRIPTION',
      channel: DX_CHANNEL,
      add: [
        { type: 'Quote',   symbol: dxSymbol },
        { type: 'Trade',   symbol: dxSymbol },
        { type: 'Summary', symbol: dxSymbol },
        { type: 'Candle',  symbol: candleSymbol, fromTime: fiveHoursAgoMs },
      ],
    });
    console.log(`[TastytradeClient] Subscribed to ${dxSymbol} (candles from 5h ago)`);
  }

  subscribe(symbol: string): void {
    const newSym   = symbol.toUpperCase();
    const newDxSym = _toDxSymbol(newSym);

    if (this._symbol === newSym) return;

    // Unsubscribe old symbol if any
    if (this._dxSymbol && this._wsReady && this._channelOpen) {
      this._wsSend({
        type:    'FEED_SUBSCRIPTION',
        channel: DX_CHANNEL,
        remove:  [
          { type: 'Quote',   symbol: this._dxSymbol },
          { type: 'Trade',   symbol: this._dxSymbol },
          { type: 'Summary', symbol: this._dxSymbol },
          { type: 'Candle',  symbol: `${this._dxSymbol}{=1m}` },
        ],
      });
    }

    this._symbol    = newSym;
    this._dxSymbol  = newDxSym;
    this._bars1mMap.clear();
    this._formingBar   = null;
    this._historyDone  = false;
    this._vwapPV = 0;
    this._vwapV  = 0;

    if (this._wsReady && this._channelOpen) {
      this._sendSubscription(newDxSym);
    }
  }

  unsubscribeAll(): void {
    this._symbol   = null;
    this._dxSymbol = null;
    this._bars1mMap.clear();
    this._formingBar = null;
  }

  // ── VWAP helpers ─────────────────────────────────────────────────────────

  private _seedVwap(): void {
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    this._vwapPV = 0;
    this._vwapV  = 0;
    for (const b of this._bars1mMap.values()) {
      const bKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(b.timestamp));
      if (bKey !== todayKey || !_isRthBar(b.timestamp)) continue;
      const tp = (b.high + b.low + b.close) / 3;
      this._vwapPV += tp * b.volume;
      this._vwapV  += b.volume;
    }
  }

  private _checkVwapReset(tsMs: number): void {
    const d = new Date(tsMs);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(d);
    const h = Number(parts.find(p => p.type === 'hour')?.value   ?? 0);
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    if (dateKey !== this._lastVwapResetKey && h === 9 && m >= 30) {
      this._lastVwapResetKey = dateKey;
      this._vwapPV = 0;
      this._vwapV  = 0;
      console.log('[TastytradeClient] VWAP reset at 09:30 ET');
    }
  }

  // ── Public data accessors ─────────────────────────────────────────────────

  getBars(): { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } {
    const sorted1m = [...this._bars1mMap.values()].sort((a, b) => a.timestamp - b.timestamp);

    // Append the live forming bar
    let bars1m: OhlcBar[] = sorted1m;
    if (this._formingBar) {
      const liveBar: OhlcBar = {
        timestamp: this._formingBar.minuteKey * 60_000,
        open:   this._formingBar.open,
        high:   this._formingBar.high,
        low:    this._formingBar.low,
        close:  this._formingBar.close,
        volume: this._formingBar.volume,
      };
      // Replace or append depending on whether the last stored bar is the same minute
      const lastStored = sorted1m[sorted1m.length - 1];
      if (lastStored && lastStored.timestamp === liveBar.timestamp) {
        bars1m = [...sorted1m.slice(0, -1), liveBar];
      } else {
        bars1m = [...sorted1m, liveBar];
      }
    }

    const bars5m  = _aggregateByTf(bars1m, 5).slice(-60);
    const bars15m = _aggregateByTf(bars1m, 15).slice(-20);

    return { bars1m: bars1m.slice(-300), bars5m, bars15m };
  }

  getSnapshot(): LiveTradeSnapshot | null {
    if (!this._symbol || !this.isConnected) return null;

    const { bars1m, bars5m, bars15m } = this.getBars();

    const vwap   = this._vwapV > 0 ? this._vwapPV / this._vwapV : undefined;
    const atr5m  = _computeATR(bars5m);
    const trend5m  = _computeTrend(bars5m);
    const trend15m = _computeTrend(bars15m);

    const indicatorState: IndicatorState =
      atr5m != null && vwap != null && trend5m !== 'unknown' && trend15m !== 'unknown' && bars5m.length >= 28
        ? 'ready'
        : 'warming';

    const range = this._highOfDay > 0 && this._lowOfDay > 0
      ? this._highOfDay - this._lowOfDay
      : 0;

    const last = this._last || (bars1m.length > 0 ? bars1m[bars1m.length - 1].close : undefined);

    // Simple trend from price position vs high/low
    const trend = (() => {
      if (!last || !this._highOfDay || !this._lowOfDay) return 'unknown' as const;
      const pos = (last - this._lowOfDay) / (this._highOfDay - this._lowOfDay || 1);
      if (pos > 0.65) return 'up' as const;
      if (pos < 0.35) return 'down' as const;
      return 'range' as const;
    })();

    return {
      connected:        true,
      accountMode:      'simulation',
      symbol:           this._symbol,
      lastPrice:        last,
      bidPrice:         this._bid  || undefined,
      askPrice:         this._ask  || undefined,
      highOfDay:        this._highOfDay || undefined,
      lowOfDay:         this._lowOfDay  || undefined,
      trend,
      feedFreshnessMs:  this._lastTickAt > 0 ? Date.now() - this._lastTickAt : undefined,
      warning:          this._lastTickAt > 0 && Date.now() - this._lastTickAt > 8000 ? 'Feed may be stale' : undefined,
      atr5m,
      vwap,
      vwapRelation:     _computeVwapRelation(last, vwap, atr5m),
      trend5m,
      trend15m,
      sessionLabel:     _getSessionLabel(),
      volatilityRegime: _computeVolatilityRegime(bars5m),
      rangePct:         range > 0 && last ? (range / last) * 100 : undefined,
      indicatorState,
    };
  }

  feedFreshness(): number | undefined {
    return this._lastTickAt > 0 ? Date.now() - this._lastTickAt : undefined;
  }

  activeSymbol(): string | null {
    return this._symbol;
  }

  // ── Disconnect / reconnect ────────────────────────────────────────────────

  disconnect(): void {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._historyEndTimer) { clearTimeout(this._historyEndTimer); this._historyEndTimer = null; }
    if (this._ws) {
      this._ws.removeAllListeners();
      try { this._ws.close(); } catch { /* ok */ }
      this._ws = null;
    }
    this._sessionToken          = null;
    this._pendingChallengeToken = null;
    this._authState             = 'disconnected';
    this._wsReady               = false;
    this._channelOpen           = false;
    this._bars1mMap.clear();
    this._formingBar            = null;
    console.log('[TastytradeClient] Disconnected');
  }

  private _scheduleReconnect(): void {
    if (!this._sessionToken) return; // intentional disconnect
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._sessionToken) {
        try { await this._connectStreamer(); } catch { /* will retry next close */ }
      }
    }, 5000);
  }
}
