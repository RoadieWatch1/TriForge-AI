// ── pushNotifier.ts — Phase 10: Mobile push notification system ────────────────
//
// Provides a provider-agnostic notification abstraction with two concrete
// implementations:
//
//   ntfy     — POST to https://ntfy.sh/{topic} (or self-hosted server)
//              No auth required for public topics; optional Bearer token for
//              protected topics. Human-friendly priority 1–5.
//
//   Pushover — POST to api.pushover.net/1/messages.json with app + user keys.
//              Priority -2 to +1 (emergency=2 omitted: needs retry/expire).
//
// All network calls use Node's built-in `https` module (zero external deps).
// Every fire() call is logged to an in-memory ring buffer (100 entries).

import https from 'https';

// ── Public types ───────────────────────────────────────────────────────────────

export type NotifyProvider = 'ntfy' | 'pushover' | 'disabled';

export type NotifyEvent =
  | 'approval_required'
  | 'approval_processed'
  | 'task_completed'
  | 'high_risk_blocked'
  | 'github_review_ready'
  | 'jira_action_queued'
  | 'agent_unhealthy'
  | 'runbook';

export type NotifyPriority = 'min' | 'low' | 'normal' | 'high' | 'urgent';

export interface EventSetting {
  enabled:  boolean;
  priority: NotifyPriority;
}

export interface PushConfig {
  provider:      NotifyProvider;
  ntfyTopic?:    string;
  ntfyServer?:   string;   // default: https://ntfy.sh
  ntfyToken?:    string;   // Bearer token for protected topics
  pushoverApp?:  string;   // Pushover app/API token
  pushoverUser?: string;   // Pushover user key
}

export interface PushLogEntry {
  id:        string;
  event:     NotifyEvent;
  title:     string;
  provider:  NotifyProvider;
  success:   boolean;
  error?:    string;
  timestamp: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

export const ALL_NOTIFY_EVENTS: NotifyEvent[] = [
  'approval_required',
  'approval_processed',
  'task_completed',
  'high_risk_blocked',
  'github_review_ready',
  'jira_action_queued',
  'agent_unhealthy',
  'runbook',
];

export const DEFAULT_EVENT_SETTINGS: Record<NotifyEvent, EventSetting> = {
  approval_required:   { enabled: true,  priority: 'high'   },
  approval_processed:  { enabled: false, priority: 'normal' },
  task_completed:      { enabled: false, priority: 'normal' },
  high_risk_blocked:   { enabled: true,  priority: 'urgent' },
  github_review_ready: { enabled: true,  priority: 'normal' },
  jira_action_queued:  { enabled: true,  priority: 'normal' },
  agent_unhealthy:     { enabled: true,  priority: 'high'   },
  runbook:             { enabled: false, priority: 'normal' },
};

export const EVENT_LABELS: Record<NotifyEvent, { label: string; description: string }> = {
  approval_required:   { label: 'Approval required',    description: 'A task needs human approval before proceeding' },
  approval_processed:  { label: 'Approval processed',   description: 'A queued action was approved or dismissed' },
  task_completed:      { label: 'Task completed',        description: 'An agent task finished' },
  high_risk_blocked:   { label: 'High-risk blocked',     description: 'A high-risk task was blocked by policy' },
  github_review_ready: { label: 'GitHub review ready',   description: 'PR review synthesized and ready to post' },
  jira_action_queued:  { label: 'Jira action queued',    description: 'A Jira write action added to the approval queue' },
  agent_unhealthy:     { label: 'Agent unhealthy',       description: 'Background agent restarted or reported an error' },
  runbook:             { label: 'Runbook notification',  description: 'A runbook step triggered a push notification' },
};

// ── Priority mappings ─────────────────────────────────────────────────────────

const NTFY_PRIORITY: Record<NotifyPriority, number> = {
  min: 1, low: 2, normal: 3, high: 4, urgent: 5,
};

// Pushover: emergency (2) requires retry + expire params — we cap at high (1)
const PUSHOVER_PRIORITY: Record<NotifyPriority, number> = {
  min: -2, low: -1, normal: 0, high: 1, urgent: 1,
};

// Emoji tags for ntfy notifications
const EVENT_TAGS: Record<NotifyEvent, string> = {
  approval_required:   'white_check_mark,bell',
  approval_processed:  'ballot_box_with_check',
  task_completed:      'tada',
  high_risk_blocked:   'rotating_light,no_entry',
  github_review_ready: 'octocat',
  jira_action_queued:  'blue_square',
  agent_unhealthy:     'warning,robot_face',
  runbook:             'scroll',
};

// ── Deep-link targets per event (relative path appended to dispatch base URL) ───

const EVENT_DISPATCH_PATH: Partial<Record<NotifyEvent, string>> = {
  approval_required:   '/',
  high_risk_blocked:   '/',
  jira_action_queued:  '/',
  github_review_ready: '/',
  agent_unhealthy:     '/',
};

// ── PushNotifier ──────────────────────────────────────────────────────────────

export class PushNotifier {
  private _config: PushConfig    = { provider: 'disabled' };
  private _events: Record<NotifyEvent, EventSetting> = { ...DEFAULT_EVENT_SETTINGS };
  private _log:    PushLogEntry[] = [];
  private _seq     = 0;
  private _dispatchBaseUrl: string | null = null;

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(config: PushConfig): void {
    this._config = { ...config };
  }

  /** Set the public base URL for TriForge Dispatch (e.g. http://192.168.1.x:4242).
   *  When set, ntfy notifications for actionable events include an X-Click header
   *  so tapping the notification opens the Dispatch UI directly. */
  setDispatchBaseUrl(url: string | null): void {
    this._dispatchBaseUrl = url ? url.replace(/\/$/, '') : null;
  }

  getDispatchBaseUrl(): string | null {
    return this._dispatchBaseUrl;
  }

  getConfig(): Omit<PushConfig, 'ntfyToken' | 'pushoverApp'> {
    const { ntfyToken: _, pushoverApp: __, ...safe } = this._config;
    return safe;
  }

  setEventSetting(event: NotifyEvent, setting: EventSetting): void {
    this._events[event] = { ...setting };
  }

  setAllEventSettings(settings: Partial<Record<NotifyEvent, EventSetting>>): void {
    for (const [k, v] of Object.entries(settings)) {
      if (v) this._events[k as NotifyEvent] = v as EventSetting;
    }
  }

  getEventSettings(): Record<NotifyEvent, EventSetting> {
    return { ...this._events };
  }

  getLog(limit = 50): PushLogEntry[] {
    return this._log.slice(-limit).reverse();
  }

  // ── Fire ───────────────────────────────────────────────────────────────────

  /**
   * Send a push notification for the given event.
   * Silently no-ops if the event is disabled or the provider is 'disabled'.
   * Returns true when the notification was delivered successfully.
   */
  async fire(event: NotifyEvent, title: string, body: string): Promise<boolean> {
    const setting = this._events[event];
    if (!setting?.enabled)                   return false;
    if (this._config.provider === 'disabled') return false;

    let success = false;
    let error:   string | undefined;

    try {
      if (this._config.provider === 'ntfy') {
        success = await this._sendNtfy(title, body, setting.priority, EVENT_TAGS[event], event);
      } else if (this._config.provider === 'pushover') {
        success = await this._sendPushover(title, body, setting.priority);
      }
    } catch (err) {
      error   = err instanceof Error ? err.message : String(err);
      success = false;
    }

    const entry: PushLogEntry = {
      id:        `push_${++this._seq}`,
      event, title,
      provider:  this._config.provider,
      success, error,
      timestamp: Date.now(),
    };
    this._log.push(entry);
    if (this._log.length > 100) this._log.shift();

    return success;
  }

  // ── ntfy ───────────────────────────────────────────────────────────────────

  private async _sendNtfy(
    title:    string,
    body:     string,
    priority: NotifyPriority,
    tags:     string,
    event?:   NotifyEvent,
  ): Promise<boolean> {
    const server = (this._config.ntfyServer ?? 'https://ntfy.sh').replace(/\/$/, '');
    const topic  = this._config.ntfyTopic?.trim() ?? '';
    if (!topic) throw new Error('ntfy topic not configured');

    const url     = new URL(`${server}/${encodeURIComponent(topic)}`);
    const payload = Buffer.from(body.slice(0, 4096), 'utf8');

    const headers: Record<string, string | number> = {
      Title:            title.slice(0, 255),
      Priority:         NTFY_PRIORITY[priority],
      'Content-Length': payload.length,
      'Content-Type':   'text/plain; charset=utf-8',
    };
    if (tags)                     headers.Tags          = tags;
    if (this._config.ntfyToken)   headers.Authorization = `Bearer ${this._config.ntfyToken}`;

    // X-Click deep-link: tap notification → open Dispatch UI
    if (event && this._dispatchBaseUrl) {
      const relPath = EVENT_DISPATCH_PATH[event];
      if (relPath !== undefined) {
        headers['X-Click'] = `${this._dispatchBaseUrl}${relPath}`;
      }
    }

    return this._postRaw(url.host, url.pathname, payload, headers);
  }

  // ── Pushover ──────────────────────────────────────────────────────────────

  private async _sendPushover(
    title:    string,
    body:     string,
    priority: NotifyPriority,
  ): Promise<boolean> {
    if (!this._config.pushoverApp || !this._config.pushoverUser) {
      throw new Error('Pushover app token or user key not configured');
    }
    const form = new URLSearchParams({
      token:    this._config.pushoverApp,
      user:     this._config.pushoverUser,
      title:    title.slice(0, 250),
      message:  body.slice(0, 1024),
      priority: String(PUSHOVER_PRIORITY[priority]),
    });
    const payload = Buffer.from(form.toString(), 'utf8');
    return this._postRaw(
      'api.pushover.net',
      '/1/messages.json',
      payload,
      { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': payload.length },
    );
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────

  private _postRaw(
    host:    string,
    path:    string,
    payload: Buffer,
    headers: Record<string, string | number>,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { host, path, method: 'POST', timeout: 10_000, headers },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            const s = res.statusCode ?? 0;
            if (s >= 200 && s < 300) resolve(true);
            else reject(new Error(`HTTP ${s}: ${raw.slice(0, 200)}`));
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Push request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}
