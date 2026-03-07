// ── main/trading/tradovateService.ts ─────────────────────────────────────────
//
// Singleton service wrapping TradovateClient.
// Manages connection lifecycle and credential persistence via store.getSecret/setSecret.
// Returned by getTradovateService() — call once after Store is ready.

import type { Store } from '../store';
import { TradovateClient, type TradovateCredentials, type TradovateAccountState } from './tradovateClient';
import type { LiveTradeSnapshot } from '@triforge/engine';

const CRED_KEY_USER = 'tradovate.username';
const CRED_KEY_PASS = 'tradovate.password';
const CRED_KEY_MODE = 'tradovate.mode';
const CRED_KEY_CID  = 'tradovate.cid';
const CRED_KEY_SEC  = 'tradovate.sec';

export interface TradovateConnectionStatus {
  connected: boolean;
  accountMode: 'simulation' | 'live' | 'unknown';
  symbol?: string;
  error?: string;
}

class TradovateService {
  private client = new TradovateClient();
  private store: Store | null = null;
  private lastError: string | null = null;
  private activeSymbol: string | null = null;

  init(store: Store): void {
    this.store = store;
  }

  // ── Connection ───────────────────────────────────────────────────────────────

  async connect(creds: TradovateCredentials): Promise<{ ok: boolean; error?: string }> {
    if (!this.store) return { ok: false, error: 'Service not initialized.' };
    try {
      // Disconnect any existing session
      this.client.disconnect();
      await this.client.authenticate(creds);
      // Persist credentials
      await this.store.setSecret(CRED_KEY_USER, creds.username);
      await this.store.setSecret(CRED_KEY_PASS, creds.password);
      await this.store.setSecret(CRED_KEY_MODE, creds.accountMode);
      if (creds.cid) await this.store.setSecret(CRED_KEY_CID, String(creds.cid));
      if (creds.sec) await this.store.setSecret(CRED_KEY_SEC, creds.sec);
      this.lastError = null;
      // Re-subscribe to active symbol if any
      if (this.activeSymbol) {
        this.client.subscribeQuote(this.activeSymbol);
      }
      return { ok: true };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return { ok: false, error: this.lastError };
    }
  }

  /** Attempt auto-reconnect using stored credentials. */
  async autoConnect(): Promise<void> {
    if (!this.store) return;
    const username = await this.store.getSecret(CRED_KEY_USER);
    const password = await this.store.getSecret(CRED_KEY_PASS);
    const mode     = await this.store.getSecret(CRED_KEY_MODE);
    if (!username || !password) return;
    const cidRaw = await this.store.getSecret(CRED_KEY_CID);
    const sec    = await this.store.getSecret(CRED_KEY_SEC);
    await this.connect({
      username,
      password,
      accountMode: (mode ?? 'simulation') as 'simulation' | 'live',
      cid: cidRaw ? Number(cidRaw) : undefined,
      sec: sec ?? undefined,
    });
  }

  disconnect(): void {
    this.client.disconnect();
    this.lastError = null;
  }

  /** Clear persisted credentials and disconnect. */
  async forget(): Promise<void> {
    if (this.store) {
      await this.store.deleteSecret(CRED_KEY_USER);
      await this.store.deleteSecret(CRED_KEY_PASS);
      await this.store.deleteSecret(CRED_KEY_MODE);
      await this.store.deleteSecret(CRED_KEY_CID);
      await this.store.deleteSecret(CRED_KEY_SEC);
    }
    this.disconnect();
  }

  // ── Status ───────────────────────────────────────────────────────────────────

  status(): TradovateConnectionStatus {
    return {
      connected:   this.client.isConnected,
      accountMode: this.client.accountMode,
      symbol:      this.activeSymbol ?? undefined,
      error:       this.lastError ?? undefined,
    };
  }

  // ── Quote ─────────────────────────────────────────────────────────────────────

  setSymbol(symbol: string): void {
    const sym = symbol.toUpperCase().trim();
    if (sym !== this.activeSymbol) {
      this.activeSymbol = sym;
      if (this.client.isConnected) {
        this.client.subscribeQuote(sym);
      }
    }
  }

  getSnapshot(symbol: string): LiveTradeSnapshot {
    const sym = symbol.toUpperCase().trim();
    if (sym !== this.activeSymbol) {
      this.setSymbol(sym);
    }
    return this.client.getSnapshot(sym);
  }

  /** Return snapshot without changing active symbol. */
  getLastSnapshot(): LiveTradeSnapshot | null {
    if (!this.activeSymbol) return null;
    return this.client.getSnapshot(this.activeSymbol);
  }

  // ── Account state (REST) ──────────────────────────────────────────────────────

  async getAccountState(): Promise<TradovateAccountState | null> {
    if (!this.client.isConnected) return null;
    try {
      return await this.client.getAccountState();
    } catch {
      return null;
    }
  }
}

export const tradovateService = new TradovateService();
