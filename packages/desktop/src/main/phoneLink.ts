// ── phoneLink.ts ─────────────────────────────────────────────────────────────
//
// Local HTTP server (port 4587) that allows any device on the same network
// to send tasks to Council and receive responses.
//
// Pairing flow:
//   1. Desktop generates a pair token and displays it (QR or URL).
//   2. Phone opens: GET http://<host>:4587/pair?token=<PAIR_TOKEN>
//   3. Server returns a session token (persisted across restarts).
//   4. Phone includes `Authorization: Bearer <SESSION_TOKEN>` on all requests.
//
// Endpoints:
//   GET  /                           Status page + QR pairing info
//   GET  /pair?token=XXXX            Exchange pair token → session token (persisted)
//   POST /remote/task                { message: string } → { taskId, ok }
//   POST /remote/voice               { transcript: string } → { taskId, ok } (alias)
//   GET  /remote/updates?since=N     Poll updates since Unix ms timestamp

import http from 'http';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';

const PORT = 4587;
const DEVICES_FILE_NAME = 'paired_devices.json';

export interface RemoteUpdate {
  id: string;
  taskId: string;
  text: string;
  timestamp: number;
  error?: string;
}

/** A persisted paired device record. */
export interface PairedDevice {
  deviceId:   string;
  token:      string;
  createdAt:  number;
  label?:     string;   // optional friendly name set during pairing
}

type TaskHandler = (message: string) => Promise<string>;

export class PhoneLinkServer {
  private server: http.Server | null = null;
  private pairToken       = '';
  private sessionTokens   = new Set<string>();   // in-memory fast lookup
  private pairedDevices: PairedDevice[] = [];   // persistent record
  private updates: RemoteUpdate[] = [];
  private onTask: TaskHandler = async () => 'No task handler registered.';
  private devicesFilePath = '';

  /** Set the directory where paired_devices.json is stored. Call before start(). */
  setStorageDir(dir: string): void {
    this.devicesFilePath = path.join(dir, DEVICES_FILE_NAME);
    this._loadDevices();
  }

  /** Push a council update to all connected devices' update queues. */
  pushUpdate(text: string, taskId = 'council'): void {
    this.updates.push({ id: crypto.randomUUID(), taskId, text, timestamp: Date.now() });
    if (this.updates.length > 200) this.updates = this.updates.slice(-200);
  }

  setTaskHandler(fn: TaskHandler) { this.onTask = fn; }

  async start(): Promise<{ ok: boolean; url?: string; pairToken?: string; pairUrl?: string; qrData?: string; error?: string }> {
    if (this.server?.listening) {
      const { pairToken, pairUrl } = this._pairInfo();
      return { ok: true, url: this._baseUrl(), pairToken, pairUrl, qrData: await this._qrData(pairUrl) };
    }
    this.pairToken = crypto.randomBytes(12).toString('hex'); // 24-char hex
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch(err => {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        } catch { /* ignore */ }
      });
    });
    return new Promise(resolve => {
      this.server!.once('error', (err: Error) => {
        this.server = null;
        resolve({ ok: false, error: err.message });
      });
      this.server!.listen(PORT, '0.0.0.0', async () => {
        const { pairToken, pairUrl } = this._pairInfo();
        resolve({ ok: true, url: this._baseUrl(), pairToken, pairUrl, qrData: await this._qrData(pairUrl) });
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    // Keep session tokens in memory so paired devices survive a restart
    // (they're persisted to disk; re-loaded on next start())
  }

  status() {
    return {
      running: this.server !== null && this.server.listening,
      port: PORT,
      url: this._baseUrl(),
      pairedDevices: this.pairedDevices.length,
    };
  }

  listPairedDevices(): PairedDevice[] {
    return [...this.pairedDevices];
  }

  unpairDevice(deviceId: string): boolean {
    const before = this.pairedDevices.length;
    this.pairedDevices = this.pairedDevices.filter(d => d.deviceId !== deviceId);
    this.sessionTokens.delete(deviceId); // deviceId is the session token here
    this._saveDevices();
    return this.pairedDevices.length < before;
  }

  async generateNewPairToken(): Promise<{ pairToken: string; pairUrl: string; qrData: string }> {
    this.pairToken = crypto.randomBytes(12).toString('hex');
    const { pairUrl } = this._pairInfo();
    return { pairToken: this.pairToken, pairUrl, qrData: await this._qrData(pairUrl) };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private _baseUrl(): string {
    return `http://${this._localIP()}:${PORT}`;
  }

  private _localIP(): string {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return 'localhost';
  }

  private _pairInfo(): { pairToken: string; pairUrl: string } {
    const host = this._localIP();
    return {
      pairToken: this.pairToken,
      pairUrl: `http://${host}:${PORT}/pair?token=${this.pairToken}`,
    };
  }

  /** Generates a QR code as a PNG data URL using the local qrcode package. No external requests. */
  private async _qrData(pairUrl: string): Promise<string> {
    try {
      return await QRCode.toDataURL(pairUrl, { width: 200, margin: 1 });
    } catch {
      return '';
    }
  }

  // ── Persistence helpers ───────────────────────────────────────────────────────

  private _loadDevices(): void {
    if (!this.devicesFilePath) return;
    try {
      if (!fs.existsSync(this.devicesFilePath)) return;
      const raw = fs.readFileSync(this.devicesFilePath, 'utf8');
      const list = JSON.parse(raw) as PairedDevice[];
      this.pairedDevices = Array.isArray(list) ? list : [];
      // Rebuild in-memory session token set from persisted records
      for (const d of this.pairedDevices) this.sessionTokens.add(d.token);
    } catch { /* file corrupt or missing — start fresh */ }
  }

  private _saveDevices(): void {
    if (!this.devicesFilePath) return;
    try {
      const dir = path.dirname(this.devicesFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = this.devicesFilePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.pairedDevices, null, 2), 'utf8');
      fs.renameSync(tmp, this.devicesFilePath);
    } catch { /* ignore write errors */ }
  }

  private _authOk(req: http.IncomingMessage): boolean {
    const header = req.headers['authorization'] ?? '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
    return this.sessionTokens.has(token);
  }

  private _readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end',  () => resolve(data));
      req.on('error', reject);
    });
  }

  private async _handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/';
    const url    = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── GET / — human-readable status page ─────────────────────────────────────
    if (method === 'GET' && url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>TriForge Phone Link</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0d1a;color:#e2e8f0;padding:32px;max-width:480px;margin:auto}
h1{color:#6366f1}p{color:#94a3b8}code{background:rgba(99,102,241,.15);padding:2px 6px;border-radius:4px}</style>
</head><body>
<h1>TriForge Phone Link</h1>
<p>Server is running on port <code>${PORT}</code>.</p>
<p>Paired devices: <code>${this.pairedDevices.length}</code></p>
<p>To pair: <code>GET /pair?token=&lt;PAIR_TOKEN&gt;</code> shown in the TriForge desktop app.</p>
</body></html>`);
      return;
    }

    // ── GET /pair?token=XXXX — exchange pair token for session token ─────────────
    if (method === 'GET' && url.pathname === '/pair') {
      const tok   = url.searchParams.get('token') ?? '';
      const label = url.searchParams.get('label') ?? undefined;   // optional device name
      if (!this.pairToken || tok !== this.pairToken) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Invalid or expired pair token.' }));
        return;
      }
      const session  = crypto.randomBytes(16).toString('hex');
      const deviceId = `device_${Date.now()}`;

      this.sessionTokens.add(session);

      // Persist the new device
      const device: PairedDevice = { deviceId, token: session, createdAt: Date.now(), label };
      this.pairedDevices.push(device);
      this._saveDevices();

      // Invalidate pair token so it can only be used once
      this.pairToken = '';

      res.writeHead(200);
      res.end(JSON.stringify({ sessionToken: session, deviceId, ok: true }));
      return;
    }

    // All routes below require a valid session token
    if (!this._authOk(req)) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized. Pair device first via GET /pair?token=...' }));
      return;
    }

    // ── POST /remote/task or /remote/voice — submit a text task ─────────────────
    if (method === 'POST' && (url.pathname === '/remote/task' || url.pathname === '/remote/voice')) {
      const body = await this._readBody(req);
      let message = '';
      try {
        const parsed = JSON.parse(body);
        message = parsed.message ?? parsed.transcript ?? '';
      } catch { message = body.trim(); }

      if (!message.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '`message` field is required.' }));
        return;
      }

      const taskId = crypto.randomUUID();
      res.writeHead(202);
      res.end(JSON.stringify({ taskId, ok: true }));

      // Process asynchronously — push result to the updates list
      this.onTask(message.trim()).then(text => {
        this.updates.push({ id: crypto.randomUUID(), taskId, text, timestamp: Date.now() });
        if (this.updates.length > 100) this.updates = this.updates.slice(-100);
      }).catch(err => {
        this.updates.push({ id: crypto.randomUUID(), taskId, text: '', error: String(err), timestamp: Date.now() });
        if (this.updates.length > 100) this.updates = this.updates.slice(-100);
      });
      return;
    }

    // ── GET /remote/updates?since=N — poll for new updates ──────────────────────
    if (method === 'GET' && url.pathname === '/remote/updates') {
      const since   = parseInt(url.searchParams.get('since') ?? '0') || 0;
      const results = this.updates.filter(u => u.timestamp > since);
      res.writeHead(200);
      res.end(JSON.stringify({ updates: results, serverTime: Date.now() }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found.' }));
  }
}
