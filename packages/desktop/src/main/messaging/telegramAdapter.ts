// ── telegramAdapter.ts — Phase 6: Telegram Bot long-polling adapter ───────────
//
// Implements a minimal Telegram Bot API client using Node's built-in `https`
// module. No external dependencies.
//
// Approach: long-polling via getUpdates (timeout=30s). The polling loop runs
// in the background until stop() is called.
//
// API surface used:
//   GET  /getMe                 — validate token + fetch bot info
//   GET  /getUpdates            — long-poll for new messages
//   POST /sendMessage           — reply to a chat
//
// Security: the adapter itself has no trust logic. Allowlist enforcement and
// risk classification happen in the IPC handlers before calling sendMessage.

import https from 'https';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;    // unix timestamp
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export type MessageHandler = (msg: TgMessage) => void;

export interface TgBotInfo {
  id: number;
  username: string;
  first_name: string;
}

// ── TelegramAdapter ───────────────────────────────────────────────────────────

export class TelegramAdapter {
  private _token:   string;
  private _polling  = false;
  private _offset   = 0;
  private _onMessage: MessageHandler | null = null;

  constructor(token: string) {
    this._token = token;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Validate token and return bot info. Throws on failure. */
  async getMe(): Promise<TgBotInfo> {
    const res = await this._get<{ result: TgBotInfo }>('getMe');
    if (!res.result) throw new Error('getMe returned no result');
    return res.result;
  }

  /** Send a text message to a chat. Returns true on success. */
  async sendMessage(chatId: number, text: string): Promise<boolean> {
    try {
      await this._post('sendMessage', { chat_id: chatId, text: text.slice(0, 4096) });
      return true;
    } catch {
      return false;
    }
  }

  /** Start long-polling. Calls onMessage for each inbound message. */
  start(onMessage: MessageHandler): void {
    if (this._polling) return;
    this._polling   = true;
    this._onMessage = onMessage;
    void this._pollLoop();
  }

  /** Stop the polling loop. */
  stop(): void {
    this._polling   = false;
    this._onMessage = null;
  }

  isRunning(): boolean {
    return this._polling;
  }

  // ── Polling loop ─────────────────────────────────────────────────────────────

  private async _pollLoop(): Promise<void> {
    while (this._polling) {
      try {
        const res = await this._get<{ result: TgUpdate[] }>(
          `getUpdates?offset=${this._offset}&timeout=30&allowed_updates=["message"]`,
        );
        const updates = res.result ?? [];
        for (const update of updates) {
          this._offset = update.update_id + 1;
          if (update.message && this._onMessage) {
            try { this._onMessage(update.message); } catch { /* never crash loop */ }
          }
        }
      } catch {
        // Brief pause before retry — avoids tight loop on repeated error
        if (this._polling) await this._sleep(5_000);
      }
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────────

  private _baseUrl(): string {
    return `api.telegram.org`;
  }

  private _get<T>(method: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const path = `/bot${this._token}/${method}`;
      const req  = https.get({ host: this._baseUrl(), path, timeout: 35_000 }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw) as { ok: boolean; result?: unknown; description?: string };
            if (!parsed.ok) {
              reject(new Error(parsed.description ?? 'Telegram API error'));
            } else {
              resolve(parsed as T);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
  }

  private _post<T>(method: string, body: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const path    = `/bot${this._token}/${method}`;
      const payload = Buffer.from(JSON.stringify(body));
      const req = https.request(
        {
          host:    this._baseUrl(),
          path,
          method:  'POST',
          timeout: 15_000,
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': payload.length,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw) as { ok: boolean; result?: unknown; description?: string };
              if (!parsed.ok) {
                reject(new Error(parsed.description ?? 'Telegram API error'));
              } else {
                resolve(parsed as T);
              }
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(payload);
      req.end();
    });
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
