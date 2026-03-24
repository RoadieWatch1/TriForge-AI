// ── controlPlane.ts — Secure localhost control plane (Phase 2) ───────────────
//
// Binds to 127.0.0.1 only. Never exposed to external networks.
//
// Endpoints:
//   GET  /health          — no auth; liveness probe
//   GET  /status          — bearer auth; background loop + webhook state
//   GET  /missions        — bearer auth; registered mission list
//   POST /task            — bearer auth; create task via inbound trust gate
//   GET  /events          — bearer auth; recent engine events
//   POST /mission/:id/run — bearer auth; fire a specific mission
//
// Security model mirrors approvalServer.ts + webhookServer.ts:
//   - localhost bind only
//   - bearer token in Authorization header (never in URL params)
//   - 401 on bad or missing auth
//   - all task creation routes through the provided createTask callback,
//     which wraps the inbound trust gate before reaching AgentLoop
//
// Usage: instantiate once, call start()/stop() from ipc.ts.

import http from 'http';
import type { InboundTaskSource } from '@triforge/engine';

// ── Callback interfaces ───────────────────────────────────────────────────────

export interface ControlPlaneMission {
  id: string;
  name: string;
  description?: string;
  goal: string;
  category: string;
  schedule?: string;
  enabled: boolean;
}

export interface ControlPlaneStatusPayload {
  backgroundLoop: { enabled: boolean; running: boolean; lastTickAt: number | null };
  webhook: { enabled: boolean; port: number; running: boolean };
  controlPlane: { running: boolean; port: number; startedAt: number | null };
  uptime: number;
}

export interface ControlPlaneTaskResult {
  ok: boolean;
  taskId?: string;
  blocked?: boolean;
  blockReason?: string;
  requiresApproval?: boolean;
  riskClass?: string;
  error?: string;
}

export interface ControlPlaneCallbacks {
  getStatus: () => ControlPlaneStatusPayload;
  getMissions: () => ControlPlaneMission[];
  createTask: (goal: string, category: string, source: InboundTaskSource) => Promise<ControlPlaneTaskResult>;
  runMission: (missionId: string) => Promise<void>;
  getRecentEvents: () => Array<Record<string, unknown>>;
}

// ── ControlPlaneServer ────────────────────────────────────────────────────────

export class ControlPlaneServer {
  private _server: http.Server | null = null;
  private _startedAt: number | null = null;

  constructor(private _callbacks: ControlPlaneCallbacks) {}

  start(port: number, token: string): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      if (this._server) {
        resolve({ ok: true, port });
        return;
      }

      const server = http.createServer((req, res) => {
        this._handleRequest(req, res, port, token).catch((err: unknown) => {
          try {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
          } catch { /* ignore write errors after response partial-sent */ }
        });
      });

      server.on('error', (err) => {
        console.error('[ControlPlane] Server error:', err.message);
        this._server = null;
        this._startedAt = null;
        resolve({ ok: false, error: err.message });
      });

      server.listen(port, '127.0.0.1', () => {
        this._server = server;
        this._startedAt = Date.now();
        console.log(`[ControlPlane] Listening on 127.0.0.1:${port}`);
        resolve({ ok: true, port });
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._server) {
        resolve();
        return;
      }
      this._server.close(() => {
        this._server = null;
        this._startedAt = null;
        console.log('[ControlPlane] Stopped');
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this._server !== null && this._server.listening;
  }

  getStartedAt(): number | null {
    return this._startedAt;
  }

  // ── Request router ──────────────────────────────────────────────────────────

  private async _handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    _port: number,
    token: string,
  ): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // ── /health — no auth required ──────────────────────────────────────────
    if (url === '/health' && method === 'GET') {
      this._json(res, 200, {
        ok: true,
        service: 'triforge-control-plane',
        ts: Date.now(),
      });
      return;
    }

    // ── All other routes require Bearer auth ────────────────────────────────
    if (!this._checkAuth(req, token)) {
      this._json(res, 401, { error: 'Unauthorized' });
      return;
    }

    // ── GET /status ─────────────────────────────────────────────────────────
    if (url === '/status' && method === 'GET') {
      this._json(res, 200, this._callbacks.getStatus());
      return;
    }

    // ── GET /missions ───────────────────────────────────────────────────────
    if (url === '/missions' && method === 'GET') {
      this._json(res, 200, { missions: this._callbacks.getMissions() });
      return;
    }

    // ── POST /task ──────────────────────────────────────────────────────────
    if (url === '/task' && method === 'POST') {
      const body = await this._readBody(req);
      let parsed: { goal?: string; category?: string } = {};
      try {
        parsed = JSON.parse(body) as { goal?: string; category?: string };
      } catch {
        this._json(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const goal = (parsed.goal ?? '').trim();
      if (!goal) {
        this._json(res, 400, { error: 'Missing required field: goal' });
        return;
      }

      const category = (parsed.category ?? 'general').trim();
      const result = await this._callbacks.createTask(goal, category, 'localhost_api');
      const status = result.blocked ? 403 : result.ok ? 201 : 500;
      this._json(res, status, result);
      return;
    }

    // ── GET /events ─────────────────────────────────────────────────────────
    if (url === '/events' && method === 'GET') {
      this._json(res, 200, { events: this._callbacks.getRecentEvents() });
      return;
    }

    // ── POST /mission/:id/run ────────────────────────────────────────────────
    const missionRunMatch = url.match(/^\/mission\/([^/?#]+)\/run$/);
    if (missionRunMatch && method === 'POST') {
      const missionId = decodeURIComponent(missionRunMatch[1]);
      try {
        await this._callbacks.runMission(missionId);
        this._json(res, 200, { ok: true, missionId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._json(res, 500, { error: msg });
      }
      return;
    }

    // ── 404 ─────────────────────────────────────────────────────────────────
    this._json(res, 404, { error: 'Not found' });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _checkAuth(req: http.IncomingMessage, token: string): boolean {
    const auth = req.headers['authorization'] ?? '';
    return auth === `Bearer ${token}`;
  }

  private _json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private _readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
}
