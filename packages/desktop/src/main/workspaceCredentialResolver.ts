/**
 * workspaceCredentialResolver.ts — Phase 28
 *
 * Resolves integration credentials for workspace-aware actions.
 * Resolution order (for each integration):
 *   1. Workspace credential if configured + useWorkspaceByDefault = true
 *   2. Personal fallback if workspace is missing and allowPersonalFallback = true
 *   3. Personal credential if workspace not configured
 *   4. none — caller must handle missing credential
 */

import type { Store } from './store';
import { CredentialManager, type CredentialKey } from './credentials';

export type IntegrationName = 'github' | 'slack' | 'jira' | 'linear' | 'push';

export interface ResolutionResult {
  scopeUsed:    'workspace' | 'personal' | 'none';
  fallbackUsed: boolean;
  explanation:  string;
  // Resolved credential values — populated based on integration type:
  token?:        string;  // GitHub PAT, Slack token, Jira API token, Linear API key, ntfy token
  url?:          string;  // Jira workspace URL
  email?:        string;  // Jira email
  pushProvider?: 'ntfy' | 'pushover' | 'disabled';
  pushTopic?:    string;
  pushServer?:   string;
  pushoverApp?:  string;
  pushoverUser?: string;
}

const WS_CRED_KEY: Partial<Record<IntegrationName, CredentialKey>> = {
  github: 'ws_github_pat',
  slack:  'ws_slack_bot_token',
  jira:   'ws_jira_api_token',
  linear: 'ws_linear_api_key',
};

const PERSONAL_CRED_KEY: Partial<Record<IntegrationName, CredentialKey>> = {
  github: 'github_pat',
  slack:  'slack_bot_token',
  jira:   'jira_api_token',
  linear: 'linear_api_key',
};

export class WorkspaceCredentialResolver {
  private cm: CredentialManager;

  constructor(private store: Store) {
    this.cm = new CredentialManager(store);
  }

  async resolve(integration: IntegrationName): Promise<ResolutionResult> {
    const wsConfig = this.store.getWorkspaceIntegration(integration);

    // Try workspace credential if configured and preferred
    if (wsConfig?.configured && wsConfig.useWorkspaceByDefault) {
      const wsResult = await this._resolveWorkspace(integration, wsConfig);
      if (wsResult.scopeUsed === 'workspace') return wsResult;

      // Workspace is configured but credential is missing/incomplete
      if (!wsConfig.allowPersonalFallback) {
        return {
          scopeUsed:    'none',
          fallbackUsed: false,
          explanation:  `Workspace ${integration} credential unavailable and personal fallback is disabled`,
        };
      }
      // Attempt personal fallback
      const personal = await this._resolvePersonal(integration);
      return { ...personal, fallbackUsed: true };
    }

    // No workspace preference — use personal directly
    return this._resolvePersonal(integration);
  }

  private async _resolveWorkspace(
    integration: IntegrationName,
    config: NonNullable<ReturnType<Store['getWorkspaceIntegration']>>,
  ): Promise<ResolutionResult> {
    if (integration === 'push') {
      const provider = config.pushProvider ?? 'disabled';
      if (provider === 'ntfy') {
        const token = await this.cm.get('ws_ntfy_token');
        if (config.pushTopic) {
          return {
            scopeUsed: 'workspace', fallbackUsed: false,
            explanation: 'Using workspace ntfy config',
            pushProvider: 'ntfy', pushTopic: config.pushTopic,
            pushServer: config.pushServer, token: token ?? undefined,
          };
        }
      } else if (provider === 'pushover') {
        const appToken = await this.cm.get('ws_pushover_app_token');
        const userKey  = config.pushoverUser ?? '';
        if (appToken && userKey) {
          return {
            scopeUsed: 'workspace', fallbackUsed: false,
            explanation: 'Using workspace Pushover config',
            pushProvider: 'pushover', pushoverApp: appToken, pushoverUser: userKey,
          };
        }
      }
      return { scopeUsed: 'none', fallbackUsed: false, explanation: 'Workspace push credential incomplete' };
    }

    if (integration === 'jira') {
      const token = await this.cm.get('ws_jira_api_token');
      const url   = config.url;
      const email = config.email;
      if (token && url && email) {
        return { scopeUsed: 'workspace', fallbackUsed: false, explanation: 'Using workspace Jira config', token, url, email };
      }
      return { scopeUsed: 'none', fallbackUsed: false, explanation: 'Workspace Jira credential incomplete (url, email, and token all required)' };
    }

    // GitHub, Slack, Linear — single token
    const wsKey = WS_CRED_KEY[integration];
    if (wsKey) {
      const token = await this.cm.get(wsKey);
      if (token) {
        return { scopeUsed: 'workspace', fallbackUsed: false, explanation: `Using workspace ${integration} credential`, token };
      }
    }
    return { scopeUsed: 'none', fallbackUsed: false, explanation: `Workspace ${integration} credential not saved` };
  }

  private async _resolvePersonal(integration: IntegrationName): Promise<ResolutionResult> {
    if (integration === 'push') {
      const provider = this.store.getPushProvider();
      if (provider === 'ntfy') {
        const token = await this.cm.get('ntfy_token');
        return {
          scopeUsed: 'personal', fallbackUsed: false,
          explanation: 'Using personal ntfy config',
          pushProvider: 'ntfy', pushTopic: this.store.getPushNtfyTopic(),
          pushServer: this.store.getPushNtfyServer(), token: token ?? undefined,
        };
      } else if (provider === 'pushover') {
        const appToken = await this.cm.get('pushover_app_token');
        const userKey  = this.store.getPushoverUserKey();
        if (appToken && userKey) {
          return {
            scopeUsed: 'personal', fallbackUsed: false,
            explanation: 'Using personal Pushover config',
            pushProvider: 'pushover', pushoverApp: appToken, pushoverUser: userKey,
          };
        }
      }
      return { scopeUsed: 'none', fallbackUsed: false, explanation: 'No push credentials configured' };
    }

    if (integration === 'jira') {
      const token = await this.cm.get('jira_api_token');
      const url   = this.store.getJiraWorkspaceUrl();
      const email = this.store.getJiraEmail();
      if (token && url && email) {
        return { scopeUsed: 'personal', fallbackUsed: false, explanation: 'Using personal Jira config', token, url, email };
      }
      return { scopeUsed: 'none', fallbackUsed: false, explanation: 'Personal Jira credentials incomplete' };
    }

    const personalKey = PERSONAL_CRED_KEY[integration];
    if (personalKey) {
      const token = await this.cm.get(personalKey);
      if (token) {
        return { scopeUsed: 'personal', fallbackUsed: false, explanation: `Using personal ${integration} credential`, token };
      }
    }
    return { scopeUsed: 'none', fallbackUsed: false, explanation: `No ${integration} credentials configured` };
  }
}
