/**
 * credentials.ts — Secure credential manager for Phase 4 real execution
 *
 * Stores integration credentials (SMTP, Twitter, etc.) encrypted via Electron
 * safeStorage, namespaced under 'cred:' prefix in the existing Store.
 */

import type { Store } from './store';

export type CredentialKey =
  | 'smtp_host'
  | 'smtp_port'
  | 'smtp_user'
  | 'smtp_pass'
  | 'smtp_from'
  | 'smtp_from_name'
  | 'twitter_api_key'
  | 'twitter_api_secret'
  | 'twitter_access_token'
  | 'twitter_access_secret'
  // Phase 3 — GitHub
  | 'github_pat'
  | 'github_webhook_secret'
  // Phase 6 — Telegram
  | 'telegram_bot_token'
  // Phase 8 — Slack
  | 'slack_bot_token'
  // Phase 9 — Jira
  | 'jira_api_token'
  // Phase 10 — Push Notifications
  | 'ntfy_token'
  | 'pushover_app_token'
  // Phase 11 — Linear
  | 'linear_api_key'
  // Phase 12 — Discord
  | 'discord_bot_token'
  // Phase 17 — Dispatch
  | 'dispatch_token'
  // Phase 28 — Workspace-scoped credential mirrors
  | 'ws_github_pat'
  | 'ws_slack_bot_token'
  | 'ws_jira_api_token'
  | 'ws_linear_api_key'
  | 'ws_ntfy_token'
  | 'ws_pushover_app_token';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

export interface TwitterConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

const CRED_NS = 'cred:';

export class CredentialManager {
  constructor(private store: Store) {}

  async set(key: CredentialKey, value: string): Promise<void> {
    await this.store.setSecret(CRED_NS + key, value);
  }

  async get(key: CredentialKey): Promise<string | undefined> {
    return this.store.getSecret(CRED_NS + key);
  }

  async delete(key: CredentialKey): Promise<void> {
    await this.store.deleteSecret(CRED_NS + key);
  }

  async list(): Promise<CredentialKey[]> {
    const all: CredentialKey[] = [
      'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_from_name',
      'twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret',
      'github_pat', 'github_webhook_secret',
      'telegram_bot_token',
      'slack_bot_token',
      'jira_api_token',
      'ntfy_token',
      'pushover_app_token',
      'linear_api_key',
      'discord_bot_token',
    ];
    const set: CredentialKey[] = [];
    for (const k of all) {
      const v = await this.get(k);
      if (v !== undefined && v !== '') set.push(k);
    }
    return set;
  }

  async getSmtp(): Promise<SmtpConfig | null> {
    const [host, port, user, pass, from, fromName] = await Promise.all([
      this.get('smtp_host'),
      this.get('smtp_port'),
      this.get('smtp_user'),
      this.get('smtp_pass'),
      this.get('smtp_from'),
      this.get('smtp_from_name'),
    ]);
    if (!host || !user || !pass) return null;
    return {
      host,
      port: Number(port) || 587,
      user,
      pass,
      from: from || user,
      fromName: fromName || 'Triforge AI',
    };
  }

  async getTwitter(): Promise<TwitterConfig | null> {
    const [apiKey, apiSecret, accessToken, accessSecret] = await Promise.all([
      this.get('twitter_api_key'),
      this.get('twitter_api_secret'),
      this.get('twitter_access_token'),
      this.get('twitter_access_secret'),
    ]);
    if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
    return { apiKey, apiSecret, accessToken, accessSecret };
  }

  /** Used by serviceLocator.getCredential() adapter */
  async getByName(name: string): Promise<string | undefined> {
    // Allow either raw key or credential key
    const credKey = (CRED_NS + name) as string;
    const val = await this.store.getSecret(credKey);
    if (val !== undefined) return val;
    // Fallback: try without prefix (for generic secrets)
    return this.store.getSecret(name);
  }
}
