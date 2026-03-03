// ── Service Locator (Phase 4 — Real Execution) ────────────────────────────────
//
// Tools delegate real-world side effects to adapters registered at runtime
// by the desktop main process. Falls back to paper/log mode if not registered.

import type { TaskToolName, ExecutionResult } from './taskTypes';

// ── Adapter type definitions ──────────────────────────────────────────────────

export interface MailOptions {
  to: string | string[];
  subject: string;
  body: string;
  from?: string;
  isHtml?: boolean;
}

export interface MailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  paperMode: boolean;
}

export interface TweetOptions {
  content: string;
  replyToId?: string;
}

export interface TweetResult {
  tweetId: string;
  url: string;
  content: string;
  paperMode: boolean;
}

type MailSender      = (opts: MailOptions) => Promise<MailResult>;
type TwitterPoster   = (opts: TweetOptions) => Promise<TweetResult>;
type Notifier        = (title: string, body: string, category?: string) => void;
type ResultLogger    = (result: ExecutionResult) => void;
type ResultQuerier   = (taskId?: string) => ExecutionResult[];
type CredentialGetter = (key: string) => string | null | undefined | Promise<string | null | undefined>;

// ── Registered adapters (set by desktop main, null = paper mode) ──────────────

let _mail:       MailSender      | null = null;
let _twitter:    TwitterPoster   | null = null;
let _notify:     Notifier        | null = null;
let _logResult:  ResultLogger    | null = null;
let _queryResults: ResultQuerier | null = null;
let _getCred:    CredentialGetter | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export const serviceLocator = {

  // ── Registration (called from desktop/main) ─────────────────────────────

  registerMailSender(fn: MailSender): void       { _mail      = fn; },
  registerTwitterPoster(fn: TwitterPoster): void  { _twitter   = fn; },
  registerNotifier(fn: Notifier): void            { _notify    = fn; },
  registerResultLogger(fn: ResultLogger): void    { _logResult = fn; },
  registerResultQuerier(fn: ResultQuerier): void  { _queryResults = fn; },
  registerCredentialGetter(fn: CredentialGetter): void { _getCred = fn; },

  // ── Tool-facing methods ─────────────────────────────────────────────────

  async sendMail(opts: MailOptions): Promise<MailResult> {
    if (_mail) return _mail(opts);
    // Paper mode: log to console, return mock result
    const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
    console.log(`[serviceLocator] PAPER EMAIL → ${toList.join(', ')} | "${opts.subject}"`);
    return {
      messageId: `paper-${Date.now()}@triforge.local`,
      accepted: toList,
      rejected: [],
      paperMode: true,
    };
  },

  async postTweet(opts: TweetOptions): Promise<TweetResult> {
    if (_twitter) return _twitter(opts);
    console.log(`[serviceLocator] PAPER TWEET → "${opts.content.slice(0, 80)}…"`);
    return {
      tweetId:  `paper-${Date.now()}`,
      url:      '#paper-mode',
      content:  opts.content,
      paperMode: true,
    };
  },

  notify(title: string, body: string, category?: string): void {
    if (_notify) { _notify(title, body, category); return; }
    console.log(`[serviceLocator] NOTIFY [${category ?? 'general'}] ${title}: ${body}`);
  },

  logResult(result: ExecutionResult): void {
    if (_logResult) { _logResult(result); return; }
    console.log(`[serviceLocator] RESULT ${result.tool} success=${result.success}`);
  },

  queryResults(taskId?: string): ExecutionResult[] {
    return _queryResults ? _queryResults(taskId) : [];
  },

  async getCredential(key: string): Promise<string | null> {
    if (!_getCred) return null;
    const result = await _getCred(key);
    return result ?? null;
  },

  // ── Status checks ───────────────────────────────────────────────────────

  isMailConfigured():    boolean { return _mail    !== null; },
  isTwitterConfigured(): boolean { return _twitter !== null; },

  getStatus(): Record<string, boolean> {
    return {
      mail:    _mail    !== null,
      twitter: _twitter !== null,
      notify:  _notify  !== null,
      storage: _getCred !== null,
    };
  },
};
