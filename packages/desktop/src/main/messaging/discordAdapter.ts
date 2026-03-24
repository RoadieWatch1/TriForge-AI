// ── discordAdapter.ts — Phase 12: Discord REST polling bot ───────────────────
//
// Connects a Discord bot token to TriForge without any external dependencies.
// Uses Discord REST API v10 for all operations and polls monitored channels
// for new messages via per-channel snowflake cursors — the same pattern used
// by the SlackAdapter (conversations.history).
//
// Polling rate: 10 s per cycle, ~6 requests/min per channel.
// Discord REST: no rate limit on GET /channels/{id}/messages at this cadence.
//
// Cursor seeding: on start each channel cursor is set to a Discord snowflake
// representing "right now" so historical messages are never backfilled.
//
//   Discord snowflake = (unixMs - DISCORD_EPOCH) << 22
//   where DISCORD_EPOCH = 1420070400000 (ms, Jan 1 2015 UTC)

import https from 'https';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DiscordBotInfo {
  id:            string;
  username:      string;
  discriminator: string;
}

export interface DiscordGuild {
  id:   string;
  name: string;
}

export interface DiscordChannel {
  id:   string;
  name: string;
  /** 0 = GUILD_TEXT, 2 = GUILD_VOICE, 4 = CATEGORY, 5 = GUILD_NEWS, etc. */
  type: number;
}

export interface DiscordMessage {
  id:         string;
  channelId:  string;
  authorId:   string;
  authorName: string;
  isBot:      boolean;
  content:    string;
  timestamp:  string;
}

// ── Snowflake helper ──────────────────────────────────────────────────────────

const DISCORD_EPOCH = 1420070400000n;

function snowflakeNow(): string {
  return ((BigInt(Date.now()) - DISCORD_EPOCH) << 22n).toString();
}

// ── DiscordAdapter ────────────────────────────────────────────────────────────

const BASE = { host: 'discord.com' };

export class DiscordAdapter {
  private _running   = false;
  private _botId     = '';
  private _channels: string[] = [];
  private _cursors   = new Map<string, string>();    // channelId → last message snowflake
  private _timer:    ReturnType<typeof setInterval> | null = null;
  private _handler:  ((msg: DiscordMessage) => void) | null = null;

  constructor(private readonly _token: string) {}

  // ── Info/meta ──────────────────────────────────────────────────────────────

  async getMe(): Promise<DiscordBotInfo> {
    return this._get<DiscordBotInfo>('/api/v10/users/@me');
  }

  async listGuilds(): Promise<DiscordGuild[]> {
    const guilds = await this._get<Array<{ id: string; name: string }>>('/api/v10/users/@me/guilds');
    return guilds;
  }

  async listChannels(guildId: string): Promise<DiscordChannel[]> {
    const channels = await this._get<Array<{ id: string; name: string; type: number }>>(
      `/api/v10/guilds/${encodeURIComponent(guildId)}/channels`,
    );
    // Only return text-capable channels (type 0 = GUILD_TEXT, 5 = GUILD_NEWS)
    return channels.filter(c => c.type === 0 || c.type === 5).map(c => ({
      id: c.id, name: c.name, type: c.type,
    }));
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async sendMessage(channelId: string, content: string): Promise<{ id: string }> {
    const body = { content: content.slice(0, 2000) };
    return this._post<{ id: string }>(
      `/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      body,
    );
  }

  // ── Polling lifecycle ──────────────────────────────────────────────────────

  start(channels: string[], onMessage: (msg: DiscordMessage) => void): void {
    if (this._running) return;
    this._handler  = onMessage;
    this._running  = true;
    this._channels = [...channels];

    // Seed cursors to "now" for all channels (avoids backfilling history)
    const now = snowflakeNow();
    for (const cid of this._channels) {
      if (!this._cursors.has(cid)) this._cursors.set(cid, now);
    }

    this._timer = setInterval(() => { void this._poll(); }, 10_000);
  }

  stop(): void {
    this._running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._handler = null;
  }

  isRunning(): boolean { return this._running; }

  setBotId(id: string): void { this._botId = id; }

  /** Update the monitored channel list without restarting the adapter. */
  setChannels(channels: string[]): void {
    this._channels = [...channels];
    const now = snowflakeNow();
    for (const cid of this._channels) {
      if (!this._cursors.has(cid)) this._cursors.set(cid, now);
    }
  }

  // ── Internal polling ───────────────────────────────────────────────────────

  private async _poll(): Promise<void> {
    if (!this._running || !this._handler) return;

    for (const channelId of this._channels) {
      try {
        const cursor = this._cursors.get(channelId) ?? snowflakeNow();
        const msgs   = await this._get<Array<RawDiscordMessage>>(
          `/api/v10/channels/${encodeURIComponent(channelId)}/messages?limit=5&after=${cursor}`,
        );

        // Discord returns newest-last when using `after`, so iterate in order
        for (const m of msgs) {
          // Skip own messages and other bots
          if (m.author.bot)               continue;
          if (m.author.id === this._botId) continue;

          const msg: DiscordMessage = {
            id:         m.id,
            channelId,
            authorId:   m.author.id,
            authorName: m.author.username,
            isBot:      m.author.bot ?? false,
            content:    m.content.slice(0, 4000),
            timestamp:  m.timestamp,
          };

          this._handler(msg);
          this._cursors.set(channelId, m.id);
        }

        // Advance cursor even if no messages (keep it at latest received)
        if (msgs.length > 0) {
          const lastId = msgs[msgs.length - 1].id;
          this._cursors.set(channelId, lastId);
        }
      } catch {
        // Per-channel errors are swallowed — one bad channel shouldn't stop others
      }
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  private _get<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        {
          ...BASE,
          path,
          timeout: 12_000,
          headers: {
            Authorization: `Bot ${this._token}`,
            'User-Agent':  'TriForge (1.0)',
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            const s = res.statusCode ?? 0;
            if (s === 429) {
              // Rate limited — resolve empty so caller can skip gracefully
              resolve([] as unknown as T);
              return;
            }
            if (s >= 400) {
              reject(new Error(`Discord HTTP ${s}: ${raw.slice(0, 200)}`));
              return;
            }
            try   { resolve(JSON.parse(raw) as T); }
            catch (e) { reject(e); }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Discord request timed out')); });
    });
  }

  private _post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      const req = https.request(
        {
          ...BASE,
          path,
          method:  'POST',
          timeout: 12_000,
          headers: {
            Authorization:    `Bot ${this._token}`,
            'Content-Type':   'application/json',
            'Content-Length': payload.length,
            'User-Agent':     'TriForge (1.0)',
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            const s = res.statusCode ?? 0;
            if (s >= 400) {
              reject(new Error(`Discord HTTP ${s}: ${raw.slice(0, 200)}`));
              return;
            }
            if (!raw.trim()) { resolve(undefined as T); return; }
            try   { resolve(JSON.parse(raw) as T); }
            catch (e) { reject(e); }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Discord send timed out')); });
      req.write(payload);
      req.end();
    });
  }
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawDiscordMessage {
  id:        string;
  content:   string;
  timestamp: string;
  author: {
    id:            string;
    username:      string;
    discriminator: string;
    bot?:          boolean;
  };
}
