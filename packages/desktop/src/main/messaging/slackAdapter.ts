// ── slackAdapter.ts — Phase 8: Slack Bot polling adapter ───────────────────────
//
// Implements a minimal Slack Web API client using Node's built-in `https`
// module. No external dependencies.
//
// Approach: polling via conversations.history per allowed channel, every
// POLL_INTERVAL_MS milliseconds. The adapter tracks the latest `ts` seen per
// channel so it only fetches new messages on each tick.
//
// API surface used:
//   GET  auth.test                 — validate token + fetch workspace info
//   GET  conversations.list        — enumerate channels bot is member of
//   GET  conversations.history     — fetch messages since last seen ts
//   POST chat.postMessage          — send a message to a channel
//
// Security: the adapter itself has no trust logic. Allowlist enforcement and
// risk classification happen in the IPC handlers before calling postMessage.

import https from 'https';

// ── Constants ─────────────────────────────────────────────────────────────────

const SLACK_HOST    = 'slack.com';
const SLACK_API     = '/api';
const POLL_INTERVAL = 10_000;   // 10 s between channel sweeps
const HISTORY_LIMIT = 50;       // messages per poll tick per channel

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlackBotInfo {
  botUserId:     string;
  botUserName:   string;
  workspaceName: string;
  workspaceId:   string;
}

export interface SlackChannel {
  id:         string;
  name:       string;
  isMember:   boolean;
  numMembers: number;
}

export interface SlackMessage {
  ts:       string;        // Slack timestamp — also the message ID
  userId:   string;        // sender user ID
  userName?: string;       // display name (populated lazily)
  channelId: string;       // which channel this came from
  text:      string;
}

export type SlackMessageHandler = (msg: SlackMessage) => void;

// ── SlackAdapter ───────────────────────────────────────────────────────────────

export class SlackAdapter {
  private _token:    string;
  private _polling   = false;
  private _timer:    ReturnType<typeof setTimeout> | null = null;
  /** channel_id → latest ts seen (Slack timestamp string) */
  private _cursors:  Map<string, string> = new Map();
  private _channels: string[]            = [];   // channel IDs to watch
  private _onMessage: SlackMessageHandler | null = null;

  constructor(token: string) {
    this._token = token;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Validate the bot token and return workspace info. Throws on failure. */
  async authTest(): Promise<SlackBotInfo> {
    const res = await this._get<{
      ok: boolean; user_id: string; user: string; team: string; team_id: string; error?: string;
    }>('auth.test');
    if (!res.ok) throw new Error(res.error ?? 'auth.test failed');
    return {
      botUserId:     res.user_id,
      botUserName:   res.user,
      workspaceName: res.team,
      workspaceId:   res.team_id,
    };
  }

  /** List channels the bot is a member of. */
  async listChannels(): Promise<SlackChannel[]> {
    const res = await this._get<{
      ok: boolean; channels?: Array<{ id: string; name: string; is_member: boolean; num_members: number }>; error?: string;
    }>('conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true');
    if (!res.ok) throw new Error(res.error ?? 'conversations.list failed');
    return (res.channels ?? []).map(c => ({
      id:         c.id,
      name:       c.name,
      isMember:   c.is_member,
      numMembers: c.num_members ?? 0,
    }));
  }

  /** Send a message to a Slack channel. Returns true on success. */
  async postMessage(channelId: string, text: string): Promise<boolean> {
    try {
      const res = await this._post<{ ok: boolean; error?: string }>('chat.postMessage', {
        channel: channelId,
        text:    text.slice(0, 3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start polling. Calls onMessage for each new inbound message from a
   * non-bot user in any of the configured channels.
   */
  start(channels: string[], onMessage: SlackMessageHandler): void {
    if (this._polling) return;
    this._polling    = true;
    this._channels   = channels;
    this._onMessage  = onMessage;
    // Seed cursors to "now" so we don't backfill historical messages
    const nowTs = String(Date.now() / 1000);
    for (const ch of channels) {
      if (!this._cursors.has(ch)) this._cursors.set(ch, nowTs);
    }
    void this._poll();
  }

  /** Update the set of channels being watched without restarting. */
  setChannels(channels: string[]): void {
    this._channels = channels;
    const nowTs = String(Date.now() / 1000);
    for (const ch of channels) {
      if (!this._cursors.has(ch)) this._cursors.set(ch, nowTs);
    }
  }

  stop(): void {
    this._polling   = false;
    this._onMessage = null;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  isRunning(): boolean {
    return this._polling;
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  private async _poll(): Promise<void> {
    if (!this._polling) return;
    try {
      for (const channelId of this._channels) {
        await this._pollChannel(channelId);
      }
    } catch {
      // Swallow errors; loop must keep running
    }
    if (this._polling) {
      this._timer = setTimeout(() => { void this._poll(); }, POLL_INTERVAL);
    }
  }

  private async _pollChannel(channelId: string): Promise<void> {
    const oldest = this._cursors.get(channelId) ?? String(Date.now() / 1000);
    let res: {
      ok: boolean;
      messages?: Array<{ ts: string; user?: string; bot_id?: string; subtype?: string; text?: string }>;
      error?: string;
    };
    try {
      res = await this._get(
        `conversations.history?channel=${encodeURIComponent(channelId)}&oldest=${oldest}&limit=${HISTORY_LIMIT}&inclusive=false`,
      );
    } catch {
      return;
    }
    if (!res.ok || !res.messages?.length) return;

    // Messages from Slack arrive newest-first; process oldest-first
    const sorted = [...res.messages].reverse();
    let latestTs = oldest;

    for (const msg of sorted) {
      if (!msg.ts) continue;
      // Skip bot messages and non-text subtypes
      if (msg.bot_id || msg.subtype || !msg.text) {
        latestTs = msg.ts;
        continue;
      }
      const userId = msg.user ?? '';
      if (!userId) { latestTs = msg.ts; continue; }

      latestTs = msg.ts;

      if (this._onMessage) {
        try {
          this._onMessage({
            ts:        msg.ts,
            userId,
            channelId,
            text:      msg.text,
          });
        } catch { /* never crash loop */ }
      }
    }

    this._cursors.set(channelId, latestTs);
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  private _get<T>(method: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const path = `${SLACK_API}/${method}`;
      const req  = https.get(
        {
          host:    SLACK_HOST,
          path,
          timeout: 15_000,
          headers: { Authorization: `Bearer ${this._token}` },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end',  () => {
            try   { resolve(JSON.parse(raw) as T); }
            catch (e) { reject(e); }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Slack request timed out')); });
    });
  }

  private _post<T>(method: string, body: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const path    = `${SLACK_API}/${method}`;
      const payload = Buffer.from(JSON.stringify(body));
      const req = https.request(
        {
          host:    SLACK_HOST,
          path,
          method:  'POST',
          timeout: 15_000,
          headers: {
            Authorization:   `Bearer ${this._token}`,
            'Content-Type':  'application/json; charset=utf-8',
            'Content-Length': payload.length,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end',  () => {
            try   { resolve(JSON.parse(raw) as T); }
            catch (e) { reject(e); }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Slack request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}
