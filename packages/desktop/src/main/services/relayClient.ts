// ── relayClient.ts ────────────────────────────────────────────────────────────
//
// Phase 7 — Cloud Relay Desktop Client
//
// Polls the TriForge relay server for pending jobs and executes them locally
// via WorkflowPackService. Reports status back to the relay so remote callers
// can track job progress.
//
// Flow:
//   1. User configures relay URL + device credentials in Settings
//   2. relayClient connects (registers device if first time)
//   3. Every 2s: GET /api/jobs/pending → pick up queued jobs
//   4. Execute each job via WorkflowPackService.runPack()
//   5. PATCH /api/jobs/:id/status with result or error
//   6. Remote caller polls GET /api/jobs/:id to see completion
//
// Security:
//   - All requests signed with HMAC-SHA256(deviceSecret, deviceId:timestamp:body)
//   - deviceSecret never leaves the device — stored encrypted via safeStorage
//   - Replay protection: 5-minute timestamp window enforced on server
//
// Jobs run with explicit approval gates intact — operator approval is required
// for any destructive action, even when triggered remotely.

import https  from 'https';
import http   from 'http';
import crypto from 'crypto';
import { app, safeStorage } from 'electron';
import path from 'path';
import fs   from 'fs';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RelayCredentials {
  deviceId:     string;
  deviceSecret: string;
  relayUrl:     string;
}

export interface RelayJob {
  id:          string;
  deviceId:    string;
  packId:      string;
  opts:        Record<string, unknown>;
  submittedAt: number;
  status:      string;
  label?:      string;
  submittedBy?: string;
}

export interface RelayClientState {
  connected:     boolean;
  relayUrl:      string | null;
  deviceId:      string | null;
  lastPollAt?:   number;
  lastJobAt?:    number;
  jobsExecuted:  number;
  jobsFailed:    number;
  error?:        string;
}

// ── Credential storage ────────────────────────────────────────────────────────

const CRED_FILE = path.join(app.getPath('userData'), 'relay-credentials.enc');

function saveCredentials(creds: RelayCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: plain JSON (not recommended for production)
    fs.writeFileSync(CRED_FILE, JSON.stringify(creds), 'utf8');
    return;
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(creds));
  fs.writeFileSync(CRED_FILE, encrypted);
}

function loadCredentials(): RelayCredentials | null {
  try {
    if (!fs.existsSync(CRED_FILE)) return null;
    const raw = fs.readFileSync(CRED_FILE);
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(raw as unknown as Buffer);
      return JSON.parse(json) as RelayCredentials;
    }
    return JSON.parse(raw.toString('utf8')) as RelayCredentials;
  } catch {
    return null;
  }
}

// ── HMAC signing ──────────────────────────────────────────────────────────────

function sign(deviceSecret: string, deviceId: string, body: string): {
  timestamp: number;
  signature: string;
} {
  const timestamp = Date.now();
  const message   = `${deviceId}:${timestamp}:${body}`;
  const signature = crypto
    .createHmac('sha256', deviceSecret)
    .update(message)
    .digest('hex');
  return { timestamp, signature };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(
  relayUrl:  string,
  method:    string,
  urlPath:   string,
  body:      string,
  creds:     RelayCredentials,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const { timestamp, signature } = sign(creds.deviceSecret, creds.deviceId, body);
    const base    = new URL(relayUrl);
    const useHttps = base.protocol === 'https:';
    const mod     = useHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: base.hostname,
      port:     base.port ? parseInt(base.port) : (useHttps ? 443 : 80),
      path:     urlPath,
      method,
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Device-Id':    creds.deviceId,
        'X-Timestamp':    String(timestamp),
        'X-Signature':    signature,
      },
    };

    const req = mod.request(options, res => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: { raw: data } });
        }
      });
    });

    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

let _timer:    ReturnType<typeof setInterval> | null = null;
let _running   = false;
let _creds:    RelayCredentials | null = null;
let _state:    RelayClientState = {
  connected:    false,
  relayUrl:     null,
  deviceId:     null,
  jobsExecuted: 0,
  jobsFailed:   0,
};

// ── Job execution ─────────────────────────────────────────────────────────────

async function executeJob(job: RelayJob): Promise<void> {
  console.log(`[relay-client] Executing job ${job.id}: ${job.packId}`);

  // Dynamic import to avoid circular dep at module init time
  const { WorkflowPackService } = await import('./workflowPackService.js');

  try {
    const startResult = await WorkflowPackService.startRun(job.packId, (job.opts ?? {}) as import('@triforge/engine').WorkflowRunOptions);

    if (!startResult.ok || !startResult.run) {
      await reportJobStatus(job.id, 'failed', undefined, startResult.error ?? 'Pack failed readiness check.');
      _state.jobsFailed++;
      return;
    }

    // Wait for completion (poll every 500ms, max 10 minutes)
    const deadline = Date.now() + 10 * 60 * 1000;
    let finalRun = startResult.run;

    while (
      (finalRun.status === 'running' || finalRun.status === 'awaiting_approval') &&
      Date.now() < deadline
    ) {
      await sleep(500);
      const updated = WorkflowPackService.getRun(finalRun.id);
      if (updated) finalRun = updated;
    }

    const succeeded = finalRun.status === 'completed';

    await reportJobStatus(job.id, succeeded ? 'completed' : 'failed', {
      runId:    finalRun.id,
      status:   finalRun.status,
      artifact: (finalRun as unknown as Record<string, unknown>).artifact ?? null,
      error:    finalRun.error ?? null,
    });

    if (succeeded) {
      _state.jobsExecuted++;
      _state.lastJobAt = Date.now();
    } else {
      _state.jobsFailed++;
    }
  } catch (err) {
    console.error(`[relay-client] Job ${job.id} threw: ${err}`);
    await reportJobStatus(job.id, 'failed', undefined, String(err));
    _state.jobsFailed++;
  }
}

async function reportJobStatus(
  jobId:   string,
  status:  'completed' | 'failed',
  result?: unknown,
  error?:  string,
): Promise<void> {
  if (!_creds) return;
  const body = JSON.stringify({ status, result, error });
  try {
    await request(_creds.relayUrl, 'PATCH', `/api/jobs/${jobId}/status`, body, _creds);
  } catch (err) {
    console.warn(`[relay-client] Could not report job status: ${err}`);
  }
}

// ── Poll tick ─────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (!_creds || !_running) return;

  _state.lastPollAt = Date.now();

  let result: { status: number; data: unknown };
  try {
    result = await request(_creds.relayUrl, 'GET', '/api/jobs/pending', '', _creds);
  } catch (err) {
    _state.error = String(err);
    return;
  }

  if (result.status !== 200) {
    _state.error = `Poll returned HTTP ${result.status}`;
    return;
  }

  _state.error = undefined;
  _state.connected = true;

  const { jobs } = result.data as { jobs?: RelayJob[] };
  if (!jobs || jobs.length === 0) return;

  console.log(`[relay-client] Received ${jobs.length} job(s)`);

  // Execute jobs sequentially — one at a time to avoid overloading the desktop
  for (const job of jobs) {
    await executeJob(job);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register this device with the relay server and save credentials.
 * Call once during first-time setup.
 */
export async function registerDevice(
  relayUrl: string,
  label?:   string,
): Promise<{ ok: boolean; deviceId?: string; deviceSecret?: string; error?: string }> {
  try {
    const base     = new URL(relayUrl);
    const useHttps = base.protocol === 'https:';
    const mod      = useHttps ? https : http;

    const body    = JSON.stringify({ label: label ?? 'TriForge Desktop' });
    const result  = await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: base.hostname,
        port:     base.port ? parseInt(base.port) : (useHttps ? 443 : 80),
        path:     '/api/devices/register',
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = mod.request(options, res => {
        let d = '';
        res.on('data', (c: Buffer) => { d += c.toString(); });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: {} }); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (result.status !== 200) {
      return { ok: false, error: `Registration failed: HTTP ${result.status}` };
    }

    const { deviceId, deviceSecret } = result.data as { deviceId: string; deviceSecret: string };
    const creds: RelayCredentials = { deviceId, deviceSecret, relayUrl };
    saveCredentials(creds);
    _creds = creds;

    return { ok: true, deviceId, deviceSecret };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Configure the relay client with existing credentials (saved from a previous registration).
 */
export function configureRelay(creds: RelayCredentials): void {
  _creds = creds;
  saveCredentials(creds);
  _state.relayUrl = creds.relayUrl;
  _state.deviceId = creds.deviceId;
}

/**
 * Load saved credentials from disk and configure the client.
 * Returns true if credentials were found.
 */
export function loadSavedCredentials(): boolean {
  const creds = loadCredentials();
  if (!creds) return false;
  _creds = creds;
  _state.relayUrl = creds.relayUrl;
  _state.deviceId = creds.deviceId;
  return true;
}

/**
 * Start the polling loop. No-op if already running.
 * @param intervalMs  Poll interval in ms (default: 2000)
 */
export function startRelayClient(intervalMs = 2000): RelayClientState {
  if (_running) return _state;
  if (!_creds) {
    _state.error = 'No credentials configured. Call configureRelay() or registerDevice() first.';
    return _state;
  }

  _running = true;
  _state.connected = false;
  _state.relayUrl  = _creds.relayUrl;
  _state.deviceId  = _creds.deviceId;

  // First poll immediately
  poll().catch(console.warn);

  _timer = setInterval(() => {
    poll().catch(console.warn);
  }, intervalMs);

  console.log(`[relay-client] Started polling ${_creds.relayUrl} every ${intervalMs}ms`);
  return _state;
}

/** Stop the relay client. */
export function stopRelayClient(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running = false;
  _state.connected = false;
  console.log('[relay-client] Stopped.');
}

/** Get current relay client state. */
export function getRelayState(): RelayClientState {
  return { ..._state };
}

/**
 * Submit a job to the relay from the desktop itself.
 * Useful for testing the relay connection locally.
 */
export async function submitLocalJob(
  packId: string,
  opts:   Record<string, unknown> = {},
  label?: string,
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  if (!_creds) return { ok: false, error: 'Relay not configured.' };
  const body = JSON.stringify({ packId, opts, label, submittedBy: 'desktop-self' });
  try {
    const result = await request(_creds.relayUrl, 'POST', '/api/jobs', body, _creds);
    if (result.status === 201) {
      const { jobId } = result.data as { jobId: string };
      return { ok: true, jobId };
    }
    return { ok: false, error: `HTTP ${result.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Check the status of a job on the relay server.
 */
export async function getJobStatus(
  jobId: string,
): Promise<{ ok: boolean; job?: RelayJob; error?: string }> {
  if (!_creds) return { ok: false, error: 'Relay not configured.' };
  try {
    const result = await request(_creds.relayUrl, 'GET', `/api/jobs/${jobId}`, '', _creds);
    if (result.status === 200) {
      const { job } = result.data as { job: RelayJob };
      return { ok: true, job };
    }
    return { ok: false, error: `HTTP ${result.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Clear saved credentials and disconnect. */
export function clearRelayCredentials(): void {
  stopRelayClient();
  _creds = null;
  _state = { connected: false, relayUrl: null, deviceId: null, jobsExecuted: 0, jobsFailed: 0 };
  try { if (fs.existsSync(CRED_FILE)) fs.unlinkSync(CRED_FILE); } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
