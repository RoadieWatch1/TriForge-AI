// ── githubWebhook.ts — GitHub webhook receiver with HMAC validation (Phase 3)
//
// Registers a /webhook/github route on the existing localhost webhook server
// (webhookServer.ts). Validates X-Hub-Signature-256 before processing any payload.
//
// Dispatches:
//   pull_request.opened  → inbound trust gate → creates a review task
//   issues.opened        → inbound trust gate → creates a triage task
//
// All other event types are acknowledged (200) but not processed.
// No external network calls — webhook only dispatches to local callbacks.

import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Callback types ─────────────────────────────────────────────────────────────

export type WebhookDispatchFn = (
  eventType: 'pr_opened' | 'issue_opened',
  payload: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    user: string;
    htmlUrl: string;
  },
) => Promise<void>;

// ── HMAC validation ───────────────────────────────────────────────────────────

function verifySignature(secret: string, rawBody: Buffer, sigHeader: string): boolean {
  if (!sigHeader.startsWith('sha256=')) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const received = sigHeader.slice(7); // strip "sha256="
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(`sha256=${expected}`),
      Buffer.from(sigHeader),
    );
  } catch {
    // Buffers different lengths → no match
    return false;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
// Called by webhookServer when it receives a request matching /webhook/github.

export async function handleGitHubWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: Buffer,
  secret: string,
  onDispatch: WebhookDispatchFn,
): Promise<void> {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // Validate signature
  const sigHeader = String(req.headers['x-hub-signature-256'] ?? '');
  if (!secret || !verifySignature(secret, rawBody, sigHeader)) {
    console.warn('[GitHubWebhook] HMAC validation failed — request rejected');
    json(401, { error: 'Invalid signature' });
    return;
  }

  const eventName = String(req.headers['x-github-event'] ?? '');

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    json(400, { error: 'Invalid JSON payload' });
    return;
  }

  const action = String((payload['action'] as string) ?? '');

  // ── pull_request.opened ───────────────────────────────────────────────────
  if (eventName === 'pull_request' && action === 'opened') {
    const pr = payload['pull_request'] as Record<string, unknown> | undefined;
    const repoObj = payload['repository'] as Record<string, unknown> | undefined;

    if (pr && repoObj) {
      const owner = String((repoObj['owner'] as Record<string, unknown>)?.['login'] ?? '');
      const repo  = String((repoObj['name'] as string) ?? '');
      const number = Number(pr['number'] ?? 0);
      const title  = String((pr['title'] as string) ?? '');
      const user   = String((pr['user'] as Record<string, unknown>)?.['login'] ?? '');
      const htmlUrl = String((pr['html_url'] as string) ?? '');

      if (owner && repo && number) {
        console.log(`[GitHubWebhook] PR #${number} opened in ${owner}/${repo} by ${user}`);
        await onDispatch('pr_opened', { owner, repo, number, title, user, htmlUrl });
      }
    }
    json(200, { ok: true, dispatched: true });
    return;
  }

  // ── issues.opened ─────────────────────────────────────────────────────────
  if (eventName === 'issues' && action === 'opened') {
    const issue   = payload['issue'] as Record<string, unknown> | undefined;
    const repoObj = payload['repository'] as Record<string, unknown> | undefined;

    if (issue && repoObj) {
      const owner   = String((repoObj['owner'] as Record<string, unknown>)?.['login'] ?? '');
      const repo    = String((repoObj['name'] as string) ?? '');
      const number  = Number(issue['number'] ?? 0);
      const title   = String((issue['title'] as string) ?? '');
      const user    = String((issue['user'] as Record<string, unknown>)?.['login'] ?? '');
      const htmlUrl = String((issue['html_url'] as string) ?? '');

      if (owner && repo && number) {
        console.log(`[GitHubWebhook] Issue #${number} opened in ${owner}/${repo} by ${user}`);
        await onDispatch('issue_opened', { owner, repo, number, title, user, htmlUrl });
      }
    }
    json(200, { ok: true, dispatched: true });
    return;
  }

  // ── All other events: acknowledge without processing ─────────────────────
  json(200, { ok: true, dispatched: false, event: eventName, action });
}
