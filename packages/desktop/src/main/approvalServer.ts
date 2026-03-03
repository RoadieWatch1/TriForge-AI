// approvalServer.ts — local HTTP approval server for remote/phone-based action approvals
// Runs on port 7337. All approvals route through AutonomyEngine.executeApprovedAction()
// which re-validates enforcePolicy() before execution. No direct mutations happen here.

import http from 'http';
import type { AutonomyEngine } from '@triforge/engine';

export interface ApprovalServerStatus {
  running: boolean;
  port: number;
  url: string;
}

const PORT = 7337;

export class ApprovalServer {
  private server: http.Server | null = null;

  constructor(private engine: AutonomyEngine) {}

  start(): { ok: boolean; url?: string; error?: string } {
    if (this.server) return { ok: true, url: `http://localhost:${PORT}` };

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(err => {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore response errors */ }
      });
    });

    return new Promise<{ ok: boolean; url?: string; error?: string }>(resolve => {
      this.server!.once('error', (err: Error) => {
        this.server = null;
        resolve({ ok: false, error: err.message });
      });
      this.server!.listen(PORT, '127.0.0.1', () => {
        resolve({ ok: true, url: `http://localhost:${PORT}` });
      });
    }) as unknown as { ok: boolean; url?: string; error?: string };
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  status(): ApprovalServerStatus {
    return {
      running: this.server !== null && this.server.listening,
      port: PORT,
      url: `http://localhost:${PORT}`,
    };
  }

  // ── Request handling ──────────────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url  = req.url  ?? '/';
    const method = req.method ?? 'GET';

    // Only accept requests from localhost
    res.setHeader('Content-Type', 'application/json');

    // GET / — human-readable status page (auto-refreshes every 10s)
    if (method === 'GET' && url === '/') {
      await this.serveStatusPage(res);
      return;
    }

    // GET /pending — machine-readable list
    if (method === 'GET' && url === '/pending') {
      res.writeHead(200);
      res.end(JSON.stringify({ pending: this.engine.listPendingActions() }));
      return;
    }

    // POST /approve/:id — approve a pending action
    // All execution routes through executeApprovedAction which re-validates enforcePolicy
    const approveMatch = url.match(/^\/approve\/([a-z0-9-]+)$/i);
    if (method === 'POST' && approveMatch) {
      const result = await this.engine.executeApprovedAction(approveMatch[1]);
      res.writeHead(result.ok ? 200 : 400);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /discard/:id
    const discardMatch = url.match(/^\/discard\/([a-z0-9-]+)$/i);
    if (method === 'POST' && discardMatch) {
      const ok = this.engine.discardPendingAction(discardMatch[1]);
      res.writeHead(200);
      res.end(JSON.stringify({ ok }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async serveStatusPage(res: http.ServerResponse): Promise<void> {
    const pending = this.engine.listPendingActions();

    const items = pending.length === 0
      ? '<p style="color:#888">No pending approvals right now.</p>'
      : pending.map(p => `
          <div style="border:1px solid #334;background:#1a1a2e;padding:14px;margin:10px 0;border-radius:8px">
            <div style="font-weight:700;color:#e2e8f0">${p.workflowName}</div>
            <div style="color:#a0aec0;font-size:13px;margin:4px 0">Action: <code style="color:#6366f1">${p.actionType}</code></div>
            <div style="color:#718096;font-size:11px">Queued: ${new Date(p.queuedAt).toLocaleString()}</div>
            <div style="margin-top:10px;display:flex;gap:8px">
              <form method="POST" action="/approve/${p.id}">
                <button style="background:#10a37f;color:#fff;border:none;padding:7px 18px;border-radius:5px;cursor:pointer;font-weight:600">Approve</button>
              </form>
              <form method="POST" action="/discard/${p.id}">
                <button style="background:#ef4444;color:#fff;border:none;padding:7px 18px;border-radius:5px;cursor:pointer;font-weight:600">Discard</button>
              </form>
            </div>
          </div>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>TriForge — Pending Approvals</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0d0d1a; color: #e2e8f0;
           max-width: 600px; margin: 40px auto; padding: 0 16px; }
    h1   { font-size: 18px; font-weight: 800; color: #fff; }
    p    { font-size: 13px; color: #718096; }
    code { background: rgba(99,102,241,0.15); padding: 1px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>TriForge — Pending Approvals</h1>
  <p>All actions are revalidated by the engine before execution. Page auto-refreshes every 10s.</p>
  ${items}
</body>
</html>`);
  }
}
