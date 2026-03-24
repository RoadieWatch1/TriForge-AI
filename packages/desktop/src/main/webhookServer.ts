// ── webhookServer.ts — Minimal webhook HTTP server for mission triggering ────
//
// Binds to 127.0.0.1 only. Accepts:
//   POST /trigger/:missionId          — Bearer auth
//   POST /webhook/github              — GitHub HMAC (X-Hub-Signature-256)
//
// No external dependencies — uses Node core `http` module only.

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

type TriggerFn = (missionId: string) => Promise<void>;
type GitHubHandlerFn = (req: IncomingMessage, res: ServerResponse, body: Buffer) => Promise<void>;

let _server: http.Server | null = null;
// Optional GitHub webhook handler — registered after Phase 3 IPC is set up.
let _githubHandler: GitHubHandlerFn | null = null;

export function registerGitHubWebhookHandler(fn: GitHubHandlerFn): void {
  _githubHandler = fn;
}

export function unregisterGitHubWebhookHandler(): void {
  _githubHandler = null;
}

export interface WebhookStartResult {
  ok: boolean;
  port?: number;
  error?: string;
}

export function startWebhookServer(
  port: number,
  token: string,
  onTrigger: TriggerFn,
): Promise<WebhookStartResult> {
  return new Promise((resolve) => {
    if (_server) {
      resolve({ ok: true, port });
      return;
    }

    const server = http.createServer((req, res) => {
      // Buffer the full body first (needed for HMAC validation + JSON parse)
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // ── GitHub webhook route — HMAC-validated, no bearer required ─────
        if (req.url === '/webhook/github' && req.method === 'POST') {
          if (_githubHandler) {
            _githubHandler(req, res, body).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error('[WebhookServer] GitHub handler error:', msg);
              try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: msg }));
              } catch { /* response already sent */ }
            });
          } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'GitHub webhook handler not registered' }));
          }
          return;
        }

        // ── Bearer auth required for all other routes ─────────────────────
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const auth = req.headers['authorization'] ?? '';
        const expectedBearer = `Bearer ${token}`;
        if (auth !== expectedBearer) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        // ── Route: /trigger/:missionId ────────────────────────────────────
        const match = req.url?.match(/^\/trigger\/([^/?#]+)$/);
        if (!match) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        const missionId = decodeURIComponent(match[1]);
        console.log(`[WebhookServer] Triggering mission "${missionId}"`);

        onTrigger(missionId).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, missionId }));
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[WebhookServer] Trigger error:', msg);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        });
      });
    });

    server.on('error', (err) => {
      console.error('[WebhookServer] Server error:', err.message);
      _server = null;
      resolve({ ok: false, error: err.message });
    });

    server.listen(port, '127.0.0.1', () => {
      _server = server;
      console.log(`[WebhookServer] Listening on 127.0.0.1:${port}`);
      resolve({ ok: true, port });
    });
  });
}

export function stopWebhookServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!_server) {
      resolve();
      return;
    }
    _server.close(() => {
      _server = null;
      console.log('[WebhookServer] Stopped');
      resolve();
    });
  });
}

export function isWebhookServerRunning(): boolean {
  return _server !== null && _server.listening;
}
