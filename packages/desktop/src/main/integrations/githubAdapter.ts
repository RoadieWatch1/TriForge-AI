// ── githubAdapter.ts — GitHub REST API wrapper (Phase 3) ─────────────────────
//
// Uses Node's built-in https module — no external dependencies.
// All write operations (postComment) are explicitly annotated so callers can
// route them through the ApprovalRequest queue before invoking them.
//
// Rate limits: GitHub allows 5,000 authenticated requests/hour.
// Diff truncation: PRs with >300 changed files or >50KB diffs are truncated
// to prevent overwhelming the council context window.

import https from 'https';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  open_issues_count: number;
  stargazers_count: number;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  user: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
  head_ref: string;
  base_ref: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  user: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  labels: string[];
  comments: number;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  public_repos: number;
  avatar_url: string;
}

export interface GitHubComment {
  id: number;
  html_url: string;
  body: string;
  created_at: string;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function ghRequest<T>(
  pat: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const method = opts.method ?? 'GET';
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;

    const reqOpts: https.RequestOptions = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TriForge-Desktop/3.0',
        ...(bodyStr ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        } : {}),
      },
    };

    const req = https.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          let errMsg = `GitHub API error ${status}`;
          try { errMsg += ': ' + (JSON.parse(raw) as { message?: string }).message; } catch { /* ignore */ }
          reject(new Error(errMsg));
          return;
        }
        try {
          resolve(raw ? JSON.parse(raw) as T : {} as T);
        } catch {
          reject(new Error('GitHub API: invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── API surface ───────────────────────────────────────────────────────────────

export async function testConnection(pat: string): Promise<GitHubUser> {
  return ghRequest<GitHubUser>(pat, '/user');
}

export async function listRepos(pat: string, page = 1): Promise<GitHubRepo[]> {
  const raw = await ghRequest<Array<{
    id: number; full_name: string; name: string;
    owner: { login: string }; private: boolean;
    description: string | null; default_branch: string;
    open_issues_count: number; stargazers_count: number;
  }>>(pat, `/user/repos?sort=updated&per_page=30&page=${page}`);

  return raw.map(r => ({
    id: r.id,
    full_name: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    description: r.description,
    default_branch: r.default_branch,
    open_issues_count: r.open_issues_count,
    stargazers_count: r.stargazers_count,
  }));
}

export async function listPullRequests(
  pat: string,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GitHubPR[]> {
  const raw = await ghRequest<Array<{
    number: number; title: string; state: string;
    user: { login: string }; body: string | null;
    created_at: string; updated_at: string; html_url: string;
    draft: boolean; additions: number; deletions: number;
    changed_files: number;
    head: { ref: string }; base: { ref: string };
  }>>(pat, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=20`);

  return raw.map(r => ({
    number: r.number,
    title: r.title,
    state: r.state,
    user: r.user.login,
    body: r.body,
    created_at: r.created_at,
    updated_at: r.updated_at,
    html_url: r.html_url,
    draft: r.draft,
    additions: r.additions ?? 0,
    deletions: r.deletions ?? 0,
    changed_files: r.changed_files ?? 0,
    head_ref: r.head?.ref ?? '',
    base_ref: r.base?.ref ?? '',
  }));
}

/** Fetches the unified diff for a PR. Truncates to maxBytes to stay within council context. */
export async function getPRDiff(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
  maxBytes = 40_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reqOpts: https.RequestOptions = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${owner}/${repo}/pulls/${prNumber}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github.diff',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TriForge-Desktop/3.0',
      },
    };

    const req = https.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;

      res.on('data', (chunk: Buffer) => {
        if (totalBytes >= maxBytes) {
          if (!truncated) {
            truncated = true;
            chunks.push(Buffer.from('\n\n[DIFF TRUNCATED — showing first 40KB]'));
          }
          return;
        }
        chunks.push(chunk);
        totalBytes += chunk.length;
      });

      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          reject(new Error(`GitHub diff fetch error: ${status}`));
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });

    req.on('error', reject);
    req.end();
  });
}

export async function listIssues(
  pat: string,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GitHubIssue[]> {
  const raw = await ghRequest<Array<{
    number: number; title: string; state: string;
    user: { login: string }; body: string | null;
    created_at: string; updated_at: string; html_url: string;
    labels: Array<{ name: string }>; comments: number;
    pull_request?: unknown;
  }>>(pat, `/repos/${owner}/${repo}/issues?state=${state}&per_page=20`);

  // Filter out pull requests (GitHub issues API returns both)
  return raw
    .filter(r => !r.pull_request)
    .map(r => ({
      number: r.number,
      title: r.title,
      state: r.state,
      user: r.user.login,
      body: r.body,
      created_at: r.created_at,
      updated_at: r.updated_at,
      html_url: r.html_url,
      labels: r.labels.map(l => l.name),
      comments: r.comments,
    }));
}

/** Post a comment on a PR or issue (both use the same endpoint). */
export async function postComment(
  pat: string,
  owner: string,
  repo: string,
  issueOrPRNumber: number,
  body: string,
): Promise<GitHubComment> {
  return ghRequest<GitHubComment>(
    pat,
    `/repos/${owner}/${repo}/issues/${issueOrPRNumber}/comments`,
    { method: 'POST', body: { body } },
  );
}
