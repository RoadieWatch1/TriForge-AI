// ── relay-server/src/index.ts ─────────────────────────────────────────────────
//
// TriForge Cloud Relay Server
//
// A lightweight HTTP server that bridges remote job submissions to connected
// TriForge desktop clients. No WebSocket library needed — uses HTTP polling.
//
// Deploy anywhere Node.js runs:
//   Railway:  railway up
//   Render:   connect GitHub repo, build: npm run build, start: npm start
//   Fly.io:   fly launch
//   Self:     node dist/index.js
//
// Environment variables:
//   PORT              HTTP port (default: 3847)
//   RELAY_ADMIN_KEY   Secret for the /admin endpoints (default: random, logged at startup)
//   RELAY_ORIGIN      Allowed CORS origin (default: *)
//
// REST API:
//   POST /api/devices/register          — register a new desktop device
//   POST /api/jobs                      — submit a job (authenticated)
//   GET  /api/jobs/pending              — poll for pending jobs (authenticated)
//   GET  /api/jobs/:id                  — get job status (authenticated)
//   PATCH /api/jobs/:id/status          — update job status from desktop (authenticated)
//   DELETE /api/jobs/:id                — cancel a pending job (authenticated)
//   GET  /api/status                    — server health + stats (public)
//   GET  /admin/jobs                    — all jobs (admin key required)
//   GET  /admin/devices                 — all devices (admin key required)

import http    from 'http';
import crypto  from 'crypto';
import {
  registerDevice,
  verifyRequest,
  generateDeviceId,
  generateDeviceSecret,
  listDevices,
  getDevice,
} from './auth';
import {
  submitJob,
  getJob,
  getPendingJobs,
  getJobHistory,
  markRunning,
  markCompleted,
  markFailed,
  cancelJob,
  getAllJobs,
} from './jobQueue';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT ?? '3847', 10);
const ADMIN_KEY   = process.env.RELAY_ADMIN_KEY ?? crypto.randomBytes(16).toString('hex');
const CORS_ORIGIN = process.env.RELAY_ORIGIN ?? '*';

console.log(`[relay] Starting TriForge Relay Server on port ${PORT}`);
console.log(`[relay] Admin key: ${ADMIN_KEY}  (set RELAY_ADMIN_KEY to pin this)`);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

type ReqHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  body: string,
) => void | Promise<void>;

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type,X-Device-Id,X-Timestamp,X-Signature,X-Admin-Key',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── Simple router ─────────────────────────────────────────────────────────────

interface Route {
  method:  string;
  pattern: RegExp;
  keys:    string[];
  handler: ReqHandler;
}

const routes: Route[] = [];

function addRoute(method: string, path: string, handler: ReqHandler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:([^/]+)/g, (_: string, key: string) => { keys.push(key); return '([^/]+)'; }) + '$',
  );
  routes.push({ method, pattern, keys, handler });
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET / — mobile-friendly relay web portal (single-file, no external deps)
addRoute('GET', '/', (_req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TriForge Relay</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0f;color:#e1e1e3;min-height:100vh;padding:16px}
h1{font-size:20px;font-weight:700;margin-bottom:4px}
.sub{font-size:13px;color:#888;margin-bottom:20px}
.card{background:#18181b;border:1px solid #2a2a2e;border-radius:10px;padding:16px;margin-bottom:14px}
.card-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:12px}
label{display:block;font-size:12px;color:#999;margin-bottom:4px;margin-top:10px}
label:first-of-type{margin-top:0}
input,select,textarea{width:100%;background:#0d0d0f;border:1px solid #2a2a2e;border-radius:6px;color:#e1e1e3;font-size:14px;padding:9px 11px;outline:none}
input:focus,select:focus,textarea:focus{border-color:#6366f1}
textarea{resize:vertical;min-height:60px;font-family:monospace;font-size:12px}
button{background:#6366f1;color:#fff;border:none;border-radius:7px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;width:100%;margin-top:12px}
button:disabled{opacity:.5;cursor:not-allowed}
button.danger{background:#ef4444}
button.secondary{background:#27272a;color:#e1e1e3;border:1px solid #3a3a3e}
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px}
.dot-green{background:#10a37f}.dot-yellow{background:#f59e0b}.dot-red{background:#ef4444}.dot-gray{background:#555}
.msg{font-size:13px;padding:9px 12px;border-radius:6px;margin-top:10px}
.msg.ok{background:#10a37f20;border:1px solid #10a37f;color:#10a37f}
.msg.err{background:#ef444420;border:1px solid #ef4444;color:#ef4444}
.job-row{padding:10px 0;border-bottom:1px solid #222;display:flex;flex-direction:column;gap:3px}
.job-row:last-child{border-bottom:none}
.job-id{font-size:11px;font-family:monospace;color:#555}
.job-pack{font-size:13px;font-weight:600}
.job-status{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.s-pending{color:#f59e0b}.s-running{color:#6366f1}.s-completed{color:#10a37f}.s-failed{color:#ef4444}.s-cancelled{color:#555}
.stat-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #222;font-size:13px}
.stat-row:last-child{border-bottom:none}
.stat-key{color:#888}.stat-val{font-weight:600}
.tabs{display:flex;gap:8px;margin-bottom:14px}
.tab{flex:1;background:#18181b;border:1px solid #2a2a2e;border-radius:7px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;color:#888;text-align:center}
.tab.active{background:#6366f120;border-color:#6366f1;color:#6366f1}
.section{display:none}.section.active{display:block}
.cred-row{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.cred-label{font-size:11px;color:#888;min-width:80px}
.cred-val{font-size:11px;font-family:monospace;color:#e1e1e3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
</head>
<body>
<h1>⚡ TriForge Relay</h1>
<p class="sub">Remote job portal</p>

<div class="tabs">
  <div class="tab active" onclick="switchTab('submit')">Submit Job</div>
  <div class="tab" onclick="switchTab('history')">History</div>
  <div class="tab" onclick="switchTab('status')">Status</div>
  <div class="tab" onclick="switchTab('creds')">Credentials</div>
</div>

<!-- SUBMIT JOB -->
<div id="tab-submit" class="section active">
  <div class="card">
    <div class="card-title">Submit a Job</div>
    <label>Pack ID</label>
    <input id="packId" placeholder="e.g. pack.unreal-bootstrap" value=""/>
    <label>Job Label (optional)</label>
    <input id="jobLabel" placeholder="My automation run"/>
    <label>Pack Options (JSON, optional)</label>
    <textarea id="packOpts" placeholder='{"key":"value"}'></textarea>
    <button onclick="submitJob()">Submit Job</button>
    <div id="submit-msg"></div>
  </div>
</div>

<!-- HISTORY -->
<div id="tab-history" class="section">
  <div class="card">
    <div class="card-title">Job History <button class="secondary" style="width:auto;margin:0;padding:5px 12px;font-size:12px;float:right" onclick="loadHistory()">Refresh</button></div>
    <div id="history-list"><p style="color:#555;font-size:13px">Loading…</p></div>
  </div>
</div>

<!-- SERVER STATUS -->
<div id="tab-status" class="section">
  <div class="card">
    <div class="card-title">Server Status <button class="secondary" style="width:auto;margin:0;padding:5px 12px;font-size:12px;float:right" onclick="loadStatus()">Refresh</button></div>
    <div id="status-info"><p style="color:#555;font-size:13px">Loading…</p></div>
  </div>
</div>

<!-- CREDENTIALS -->
<div id="tab-creds" class="section">
  <div class="card">
    <div class="card-title">Device Credentials</div>
    <p style="font-size:12px;color:#888;margin-bottom:12px">Paste the deviceId and deviceSecret from your TriForge desktop registration. These are stored in your browser only.</p>
    <label>Device ID</label>
    <input id="inp-deviceId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/>
    <label>Device Secret</label>
    <input id="inp-deviceSecret" type="password" placeholder="64-char hex secret"/>
    <button onclick="saveCreds()">Save Credentials</button>
    <div id="creds-msg"></div>
  </div>
  <div class="card" id="creds-current" style="display:none">
    <div class="card-title">Stored Credentials</div>
    <div id="creds-display"></div>
    <button class="danger" onclick="clearCreds()" style="margin-top:12px">Clear Credentials</button>
  </div>
</div>

<script>
// ── Credential store (localStorage) ─────────────────────────────────────────
function getCreds(){
  return{deviceId:localStorage.getItem('tf_relay_did')||'',deviceSecret:localStorage.getItem('tf_relay_dsec')||''};
}
function saveCreds(){
  const did=document.getElementById('inp-deviceId').value.trim();
  const sec=document.getElementById('inp-deviceSecret').value.trim();
  if(!did||!sec){showMsg('creds-msg','Device ID and secret are required.','err');return;}
  localStorage.setItem('tf_relay_did',did);
  localStorage.setItem('tf_relay_dsec',sec);
  showMsg('creds-msg','Credentials saved.','ok');
  renderStoredCreds();
}
function clearCreds(){
  localStorage.removeItem('tf_relay_did');localStorage.removeItem('tf_relay_dsec');
  renderStoredCreds();showMsg('creds-msg','Credentials cleared.','ok');
}
function renderStoredCreds(){
  const{deviceId,deviceSecret}=getCreds();
  const card=document.getElementById('creds-current');
  const disp=document.getElementById('creds-display');
  if(!deviceId){card.style.display='none';return;}
  card.style.display='block';
  disp.innerHTML='<div class="cred-row"><span class="cred-label">Device ID</span><span class="cred-val">'+esc(deviceId)+'</span></div>'
    +'<div class="cred-row"><span class="cred-label">Secret</span><span class="cred-val">'+deviceSecret.slice(0,8)+'…</span></div>';
}

// ── HMAC-SHA256 via Web Crypto ────────────────────────────────────────────────
async function hmacHex(secret,message){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',hexToBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function hexToBytes(hex){
  const arr=new Uint8Array(hex.length/2);
  for(let i=0;i<hex.length;i+=2)arr[i/2]=parseInt(hex.slice(i,i+2),16);
  return arr.buffer;
}

// ── Authenticated fetch ────────────────────────────────────────────────────────
async function authFetch(path,method,body){
  const{deviceId,deviceSecret}=getCreds();
  if(!deviceId||!deviceSecret)throw new Error('No credentials — go to the Credentials tab first.');
  const ts=Date.now();
  const bodyStr=body?JSON.stringify(body):'';
  const message=deviceId+':'+ts+':'+bodyStr;
  const sig=await hmacHex(deviceSecret,message);
  const headers={'Content-Type':'application/json','X-Device-Id':deviceId,'X-Timestamp':String(ts),'X-Signature':sig};
  const res=await fetch(path,{method:method||'GET',headers,body:bodyStr||undefined});
  return res.json();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name){
  document.querySelectorAll('.tab').forEach((t,i)=>{
    const names=['submit','history','status','creds'];
    t.classList.toggle('active',names[i]===name);
  });
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  if(name==='history')loadHistory();
  if(name==='status')loadStatus();
  if(name==='creds')renderStoredCreds();
}

// ── Submit job ────────────────────────────────────────────────────────────────
async function submitJob(){
  const packId=document.getElementById('packId').value.trim();
  const label=document.getElementById('jobLabel').value.trim();
  const optsRaw=document.getElementById('packOpts').value.trim();
  if(!packId){showMsg('submit-msg','Pack ID is required.','err');return;}
  let opts={};
  if(optsRaw){try{opts=JSON.parse(optsRaw);}catch{showMsg('submit-msg','Pack Options must be valid JSON.','err');return;}}
  try{
    const res=await authFetch('/api/jobs','POST',{packId,label:label||undefined,opts});
    if(res.ok){showMsg('submit-msg','Job submitted — ID: '+res.jobId,'ok');}
    else{showMsg('submit-msg',res.error||'Submission failed.','err');}
  }catch(e){showMsg('submit-msg',e.message,'err');}
}

// ── Job history ────────────────────────────────────────────────────────────────
async function loadHistory(){
  const el=document.getElementById('history-list');
  el.innerHTML='<p style="color:#555;font-size:13px">Loading…</p>';
  try{
    const res=await authFetch('/api/jobs/history','GET',null);
    if(!res.ok){el.innerHTML='<p class="msg err">'+esc(res.error||'Failed to load history.')+'</p>';return;}
    const jobs=res.jobs||[];
    if(!jobs.length){el.innerHTML='<p style="color:#555;font-size:13px">No jobs yet.</p>';return;}
    el.innerHTML=jobs.slice().reverse().map(j=>{
      const dt=new Date(j.submittedAt).toLocaleString();
      return '<div class="job-row">'
        +'<div class="job-pack">'+esc(j.packId)+(j.label?' — '+esc(j.label):'')+'</div>'
        +'<div><span class="job-status s-'+j.status+'">'+j.status+'</span><span style="color:#555;font-size:11px;margin-left:8px">'+dt+'</span></div>'
        +'<div class="job-id">'+esc(j.id)+'</div>'
        +'</div>';
    }).join('');
  }catch(e){el.innerHTML='<p class="msg err">'+esc(e.message)+'</p>';}
}

// ── Server status ─────────────────────────────────────────────────────────────
async function loadStatus(){
  const el=document.getElementById('status-info');
  el.innerHTML='<p style="color:#555;font-size:13px">Loading…</p>';
  try{
    const res=await fetch('/api/status');
    const d=await res.json();
    if(!d.ok){el.innerHTML='<p class="msg err">Server error.</p>';return;}
    const dotColor=d.devices>0?'dot-green':'dot-yellow';
    el.innerHTML='<div class="stat-row"><span class="stat-key">Status</span><span class="stat-val"><span class="status-dot '+dotColor+'"></span>Online</span></div>'
      +'<div class="stat-row"><span class="stat-key">Version</span><span class="stat-val">'+esc(d.version)+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Uptime</span><span class="stat-val">'+uptimeStr(d.uptime)+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Devices</span><span class="stat-val">'+d.devices+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Jobs (total)</span><span class="stat-val">'+d.jobs.total+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Pending</span><span class="stat-val">'+d.jobs.pending+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Running</span><span class="stat-val">'+d.jobs.running+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Completed</span><span class="stat-val">'+d.jobs.completed+'</span></div>'
      +'<div class="stat-row"><span class="stat-key">Failed</span><span class="stat-val">'+d.jobs.failed+'</span></div>';
  }catch(e){el.innerHTML='<p class="msg err">'+esc(e.message)+'</p>';}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showMsg(id,msg,type){const el=document.getElementById(id);if(el){el.className='msg '+type;el.textContent=msg;}}
function uptimeStr(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?h+'h '+m+'m':m+'m';}

// Init
renderStoredCreds();
loadStatus();
</script>
</body>
</html>`;
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type':   'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  res.end(buf);
});

// GET /api/status — public health check
addRoute('GET', '/api/status', (_req, res) => {
  const devices = listDevices();
  const jobs    = getAllJobs(1000);
  json(res, 200, {
    ok:      true,
    version: '1.0.0',
    uptime:  Math.round(process.uptime()),
    devices: devices.length,
    jobs: {
      total:     jobs.length,
      pending:   jobs.filter(j => j.status === 'pending').length,
      running:   jobs.filter(j => j.status === 'running').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed:    jobs.filter(j => j.status === 'failed').length,
    },
  });
});

// POST /api/devices/register — register a new desktop
addRoute('POST', '/api/devices/register', async (req, res, _params, body) => {
  let data: { label?: string; deviceId?: string; deviceSecret?: string };
  try { data = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }

  // Allow the client to supply its own deviceId + deviceSecret (deterministic re-registration)
  // or let the server generate fresh ones
  const deviceId     = data.deviceId     ?? generateDeviceId();
  const deviceSecret = data.deviceSecret ?? generateDeviceSecret();
  const device       = registerDevice(deviceId, deviceSecret, data.label);

  console.log(`[relay] Device registered: ${deviceId} "${data.label ?? ''}"`);

  json(res, 200, {
    ok:           true,
    deviceId:     device.deviceId,
    deviceSecret, // returned ONCE — client must store this securely
    registeredAt: device.registeredAt,
    message:      'Store deviceSecret securely — it will not be shown again.',
  });
});

// POST /api/jobs — submit a job (from phone/web/curl)
addRoute('POST', '/api/jobs', async (req, res, _params, body) => {
  const auth = verifyRequest(
    req.headers['x-device-id'] as string,
    req.headers['x-timestamp'] as string,
    req.headers['x-signature'] as string,
    body,
  );
  if (!auth.ok) return json(res, 401, { error: auth.error });

  let data: { packId?: string; opts?: Record<string, unknown>; label?: string };
  try { data = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }

  if (!data.packId) return json(res, 400, { error: 'packId is required.' });

  const job = submitJob({
    deviceId:    auth.device!.deviceId,
    packId:      data.packId,
    opts:        data.opts ?? {},
    label:       data.label,
    submittedBy: req.headers['x-submitted-by'] as string ?? 'api',
  });

  console.log(`[relay] Job submitted: ${job.id} (${job.packId}) for device ${job.deviceId}`);

  json(res, 201, {
    ok:    true,
    jobId: job.id,
    status: job.status,
    pollUrl: `/api/jobs/${job.id}`,
  });
});

// GET /api/jobs/pending — desktop polls this to pick up work
addRoute('GET', '/api/jobs/pending', (req, res, _params, body) => {
  const auth = verifyRequest(
    req.headers['x-device-id'] as string,
    req.headers['x-timestamp'] as string,
    req.headers['x-signature'] as string,
    body,
  );
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const jobs = getPendingJobs(auth.device!.deviceId);

  // Mark them all as running immediately so they aren't dispatched twice
  const dispatched = jobs.map(j => {
    markRunning(j.id);
    return j;
  });

  json(res, 200, { ok: true, jobs: dispatched });
});

// GET /api/jobs/:id — check job status
addRoute('GET', '/api/jobs/:id', (req, res, params, body) => {
  const auth = verifyRequest(
    req.headers['x-device-id'] as string,
    req.headers['x-timestamp'] as string,
    req.headers['x-signature'] as string,
    body,
  );
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const job = getJob(params.id);
  if (!job) return json(res, 404, { error: 'Job not found.' });
  if (job.deviceId !== auth.device!.deviceId) return json(res, 403, { error: 'Forbidden.' });

  json(res, 200, { ok: true, job });
});

// GET /api/jobs/history — desktop fetches its job history
addRoute('GET', '/api/jobs/history', (req, res, _params, body) => {
  const auth = verifyRequest(
    req.headers['x-device-id'] as string,
    req.headers['x-timestamp'] as string,
    req.headers['x-signature'] as string,
    body,
  );
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const jobs = getJobHistory(auth.device!.deviceId);
  json(res, 200, { ok: true, jobs });
});

// PATCH /api/jobs/:id/status — desktop reports completion
addRoute('PATCH', '/api/jobs/:id/status', async (req, res, params, body) => {
  const auth = verifyRequest(
    req.headers['x-device-id'] as string,
    req.headers['x-timestamp'] as string,
    req.headers['x-signature'] as string,
    body,
  );
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const job = getJob(params.id);
  if (!job) return json(res, 404, { error: 'Job not found.' });
  if (job.deviceId !== auth.device!.deviceId) return json(res, 403, { error: 'Forbidden.' });

  let data: { status?: string; result?: unknown; error?: string };
  try { data = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }

  let updated = job;
  if (data.status === 'completed') {
    updated = markCompleted(params.id, data.result) ?? job;
    console.log(`[relay] Job completed: ${params.id}`);
  } else if (data.status === 'failed') {
    updated = markFailed(params.id, data.error ?? 'Unknown error') ?? job;
    console.log(`[relay] Job failed: ${params.id} — ${data.error}`);
  }

  json(res, 200, { ok: true, job: updated });
});

// DELETE /api/jobs/:id — cancel a pending job
addRoute('DELETE', '/api/jobs/:id', (req, res, params, body) => {
  const auth = verifyRequest(
    req.headers['x-device-id'] as string,
    req.headers['x-timestamp'] as string,
    req.headers['x-signature'] as string,
    body,
  );
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const job = getJob(params.id);
  if (!job) return json(res, 404, { error: 'Job not found.' });
  if (job.deviceId !== auth.device!.deviceId) return json(res, 403, { error: 'Forbidden.' });

  const cancelled = cancelJob(params.id);
  if (!cancelled) return json(res, 409, { error: 'Job cannot be cancelled (not pending).' });

  json(res, 200, { ok: true, jobId: params.id, status: 'cancelled' });
});

// GET /admin/jobs — admin dashboard
addRoute('GET', '/admin/jobs', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return json(res, 403, { error: 'Invalid admin key.' });
  json(res, 200, { ok: true, jobs: getAllJobs() });
});

// GET /admin/devices — admin dashboard
addRoute('GET', '/admin/devices', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return json(res, 403, { error: 'Invalid admin key.' });
  json(res, 200, { ok: true, devices: listDevices() });
});

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type,X-Device-Id,X-Timestamp,X-Signature,X-Admin-Key,X-Submitted-By',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    });
    res.end();
    return;
  }

  const url    = req.url?.split('?')[0] ?? '/';
  const method = req.method ?? 'GET';

  let body = '';
  try { body = await readBody(req); } catch { /* ignore read errors */ }

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(url);
    if (!match) continue;

    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => { params[key] = match[i + 1]; });

    try {
      await route.handler(req, res, params, body);
    } catch (err) {
      console.error(`[relay] Handler error: ${err}`);
      json(res, 500, { error: 'Internal server error.' });
    }
    return;
  }

  json(res, 404, { error: `No route for ${method} ${url}` });
});

server.listen(PORT, () => {
  console.log(`[relay] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[relay] Health check: GET http://localhost:${PORT}/api/status`);
});

server.on('error', (err) => {
  console.error(`[relay] Server error:`, err);
  process.exit(1);
});

export default server;
