// ── jiraAdapter.ts — Phase 9: Jira Cloud REST API client ───────────────────────
//
// Uses the Jira REST API v3 with HTTP Basic Authentication (email + API token).
// No external dependencies — built on Node's built-in `https` module.
//
// API surface:
//   GET  /rest/api/3/myself                          — validate credentials
//   GET  /rest/api/3/project/search                  — list projects
//   GET  /rest/api/3/search                          — JQL issue search
//   GET  /rest/api/3/issue/{key}                     — issue details
//   GET  /rest/api/3/issue/{key}/comment             — issue comments
//   GET  /rest/api/3/issue/{key}/transitions         — available transitions
//   POST /rest/api/3/issue                           — create issue
//   PUT  /rest/api/3/issue/{key}                     — update issue fields
//   POST /rest/api/3/issue/{key}/comment             — add comment
//   POST /rest/api/3/issue/{key}/transitions         — do a transition
//
// Descriptions from Jira are in Atlassian Document Format (ADF); they are
// converted to plain text by adfToText() before being returned.

import https from 'https';

// ── ADF → plain text ──────────────────────────────────────────────────────────

function adfToText(node: unknown): string {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (typeof node !== 'object') return String(node);
  const n = node as Record<string, unknown>;
  if (n.type === 'text')      return (n.text as string) ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention')   return `@${(n.attrs as Record<string, string>)?.text ?? 'user'}`;
  const inner = adfToText(n.content);
  if (n.type === 'paragraph')  return inner + '\n';
  if (n.type === 'heading')    return inner + '\n';
  if (n.type === 'listItem')   return '• ' + inner;
  if (n.type === 'codeBlock')  return '```\n' + inner + '\n```\n';
  if (n.type === 'blockquote') return '> ' + inner;
  return inner;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface JiraUserInfo {
  accountId:    string;
  displayName:  string;
  emailAddress: string;
}

export interface JiraIssueType {
  id:      string;
  name:    string;
  subtask: boolean;
}

export interface JiraProject {
  id:         string;
  key:        string;
  name:       string;
  issueTypes: JiraIssueType[];
}

export interface JiraIssue {
  id:            string;
  key:           string;
  summary:       string;
  status:        string;
  statusCategory: string;   // 'To Do' | 'In Progress' | 'Done'
  priority:      string;
  issueType:     string;
  projectKey:    string;
  projectName:   string;
  assigneeName?: string;
  reporterName?: string;
  description:   string;   // plain text extracted from ADF
  created:       string;
  updated:       string;
}

export interface JiraComment {
  id:         string;
  authorName: string;
  body:       string;
  created:    string;
}

export interface JiraTransition {
  id:       string;
  name:     string;
  toStatus: string;
}

// ── JiraAdapter ───────────────────────────────────────────────────────────────

export class JiraAdapter {
  private _workspaceUrl: string;
  private _email:        string;
  private _apiToken:     string;

  constructor(workspaceUrl: string, email: string, apiToken: string) {
    // Normalise: strip trailing slash, ensure https://
    const base = workspaceUrl.trim().replace(/\/$/, '');
    this._workspaceUrl = base.startsWith('http') ? base : `https://${base}`;
    this._email        = email.trim();
    this._apiToken     = apiToken.trim();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Validate credentials and return the authenticated user's info. */
  async getMyself(): Promise<JiraUserInfo> {
    const res = await this._get<{ accountId: string; displayName: string; emailAddress: string }>(
      '/rest/api/3/myself',
    );
    return { accountId: res.accountId, displayName: res.displayName, emailAddress: res.emailAddress ?? this._email };
  }

  /** List projects accessible to the token holder. */
  async listProjects(maxResults = 50): Promise<JiraProject[]> {
    const res = await this._get<{
      values: Array<{
        id: string; key: string; name: string;
        issueTypes?: Array<{ id: string; name: string; subtask: boolean }>;
      }>;
    }>(`/rest/api/3/project/search?maxResults=${maxResults}&orderBy=name&expand=issueTypes`);

    return (res.values ?? []).map(p => ({
      id:         p.id,
      key:        p.key,
      name:       p.name,
      issueTypes: (p.issueTypes ?? []).filter(t => !t.subtask),
    }));
  }

  /** Execute a JQL query and return normalised issues. */
  async searchIssues(jql: string, maxResults = 30): Promise<JiraIssue[]> {
    const res = await this._get<{ issues: Array<RawIssue> }>(
      `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,priority,assignee,reporter,issuetype,project,created,updated,description`,
    );
    return (res.issues ?? []).map(normaliseIssue);
  }

  /** Fetch a single issue with full field set. */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this._get<RawIssue>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,priority,assignee,reporter,issuetype,project,created,updated,description`,
    );
    return normaliseIssue(res);
  }

  /** Fetch the most recent comments for an issue (newest first). */
  async getComments(issueKey: string, maxResults = 10): Promise<JiraComment[]> {
    const res = await this._get<{
      comments: Array<{ id: string; author: { displayName: string }; body: unknown; created: string }>;
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=${maxResults}&orderBy=-created`);

    return (res.comments ?? []).map(c => ({
      id:         c.id,
      authorName: c.author?.displayName ?? 'Unknown',
      body:       adfToText(c.body).trim().slice(0, 400),
      created:    c.created,
    }));
  }

  /** List transitions available for an issue in its current state. */
  async listTransitions(issueKey: string): Promise<JiraTransition[]> {
    const res = await this._get<{
      transitions: Array<{ id: string; name: string; to: { name: string } }>;
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);

    return (res.transitions ?? []).map(t => ({
      id:       t.id,
      name:     t.name,
      toStatus: t.to?.name ?? t.name,
    }));
  }

  /** Create a new issue. Returns the key (e.g. "PROJ-123"). */
  async createIssue(
    projectKey:  string,
    issueTypeId: string,
    summary:     string,
    description?: string,
  ): Promise<{ id: string; key: string }> {
    const body: Record<string, unknown> = {
      fields: {
        project:   { key: projectKey },
        issuetype: { id: issueTypeId },
        summary,
        ...(description
          ? {
              description: {
                version: 1, type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
              },
            }
          : {}),
      },
    };
    const res = await this._post<{ id: string; key: string }>('/rest/api/3/issue', body);
    return { id: res.id, key: res.key };
  }

  /** Add a plain-text comment to an issue. Returns the comment ID. */
  async addComment(issueKey: string, text: string): Promise<{ id: string }> {
    const body = {
      body: {
        version: 1, type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: text.slice(0, 32_767) }] }],
      },
    };
    const res = await this._post<{ id: string }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      body,
    );
    return { id: res.id };
  }

  /** Transition an issue to a new status. */
  async doTransition(issueKey: string, transitionId: string): Promise<void> {
    await this._post(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      { transition: { id: transitionId } },
    );
  }

  /** Update mutable fields on an issue (summary and/or description). */
  async updateIssue(issueKey: string, patch: { summary?: string; description?: string }): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (patch.summary) fields.summary = patch.summary;
    if (patch.description) {
      fields.description = {
        version: 1, type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: patch.description }] }],
      };
    }
    await this._put(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, { fields });
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  private _authHeader(): string {
    const token = Buffer.from(`${this._email}:${this._apiToken}`).toString('base64');
    return `Basic ${token}`;
  }

  private _hostAndPath(path: string): { host: string; path: string } {
    const url = new URL(this._workspaceUrl + path);
    return { host: url.host, path: url.pathname + url.search };
  }

  private _get<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const { host, path: p } = this._hostAndPath(path);
      const req = https.get(
        {
          host, path: p, timeout: 15_000,
          headers: { Authorization: this._authHeader(), Accept: 'application/json' },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 400) {
              try {
                const err = JSON.parse(raw) as { errorMessages?: string[]; errors?: Record<string, string> };
                reject(new Error(err.errorMessages?.[0] ?? `HTTP ${res.statusCode}`));
              } catch { reject(new Error(`HTTP ${res.statusCode}`)); }
              return;
            }
            try   { resolve(JSON.parse(raw) as T); }
            catch (e) { reject(e); }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Jira request timed out')); });
    });
  }

  private _post<T = void>(path: string, body: Record<string, unknown>): Promise<T> {
    return this._send<T>('POST', path, body);
  }

  private _put<T = void>(path: string, body: Record<string, unknown>): Promise<T> {
    return this._send<T>('PUT', path, body);
  }

  private _send<T>(method: string, path: string, body: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const { host, path: p } = this._hostAndPath(path);
      const payload = Buffer.from(JSON.stringify(body));
      const req = https.request(
        {
          host, path: p, method, timeout: 15_000,
          headers: {
            Authorization:    this._authHeader(),
            'Content-Type':   'application/json',
            'Content-Length': payload.length,
            Accept:           'application/json',
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 400) {
              try {
                const err = JSON.parse(raw) as { errorMessages?: string[]; errors?: Record<string, string> };
                reject(new Error(err.errorMessages?.[0] ?? `HTTP ${res.statusCode}`));
              } catch { reject(new Error(`HTTP ${res.statusCode}`)); }
              return;
            }
            // 204 No Content → resolve with empty
            if (res.statusCode === 204 || !raw.trim()) { resolve(undefined as T); return; }
            try   { resolve(JSON.parse(raw) as T); }
            catch (e) { reject(e); }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Jira request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}

// ── Issue normaliser ──────────────────────────────────────────────────────────

interface RawIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status:   { name: string; statusCategory: { name: string } };
    priority: { name: string } | null;
    issuetype: { name: string };
    project:  { key: string; name: string };
    assignee: { displayName: string } | null;
    reporter: { displayName: string } | null;
    description: unknown;
    created: string;
    updated: string;
  };
}

function normaliseIssue(raw: RawIssue): JiraIssue {
  const f = raw.fields;
  return {
    id:             raw.id,
    key:            raw.key,
    summary:        f.summary ?? '',
    status:         f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.name ?? '',
    priority:       f.priority?.name ?? 'None',
    issueType:      f.issuetype?.name ?? '',
    projectKey:     f.project?.key ?? '',
    projectName:    f.project?.name ?? '',
    assigneeName:   f.assignee?.displayName,
    reporterName:   f.reporter?.displayName,
    description:    adfToText(f.description).trim().slice(0, 1_000),
    created:        f.created ?? '',
    updated:        f.updated ?? '',
  };
}
