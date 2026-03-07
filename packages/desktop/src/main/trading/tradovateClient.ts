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
import type { LiveTradeSnapshot } from '@triforge/engine';

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
    existing.receivedAt = Date.now();
    this.quotes.set(symbol, existing);
  }

  private _contractMap: Map<string, string> = new Map(); // contractId → symbol

  private _symbolForContract(contractId: string): string | undefined {
    return this._contractMap.get(contractId);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  subscribeQuote(symbol: string): void {
    this._targetSymbol = symbol.toUpperCase();
    if (!this.wsReady) return;
    const id = this._msgId++;
    this._wsSend(`md/subscribequote\n${id}\n\n${JSON.stringify({ symbol: this._targetSymbol })}`);
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
