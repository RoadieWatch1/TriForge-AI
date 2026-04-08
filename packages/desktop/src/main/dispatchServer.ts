/**
 * dispatchServer.ts — TriForge Dispatch HTTP server (Phase 17 + Phase 18 hardening)
 *
 * Security model (Phase 18):
 *  - Master token: internal admin secret, stored encrypted. Never transmitted
 *    in normal use. Still accepted for backward-compat / quick testing.
 *  - Pairing codes: 6-digit, 10-min TTL, single-use. Generated on desktop,
 *    entered on the device. Device receives a session token on successful pair.
 *  - Session tokens: per-device, short-lived (default 7 days), refreshable,
 *    revokable individually without affecting other devices.
 *  - Network mode: 'local' | 'lan' | 'remote'. Requests from outside the
 *    configured network are rejected before auth even runs.
 *  - Remote-approve policy: per risk-level gate + optional desktop confirm flow.
 *  - Audit: every mutating action logged with device ID, session, client IP.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as qrcode from 'qrcode';
import {
  validateAuth,
  isNetworkAllowed,
  createDevice,
  rotateSessionToken,
  isPairingCodeValid,
  isRiskAllowed,
  generateConfirmationId,
  toDeviceView,
} from './dispatchSession';
import type {
  PairedDevice,
  PairingCode,
  NetworkMode,
  RemoteApprovePolicy,
  RiskLevel,
  PendingConfirmation,
  DeviceView,
} from './dispatchSession';

// ── Public types used by ipc.ts ─────────────────────────────────────────────────

export interface DispatchActionItem {
  id:        string;
  source:    string;
  label:     string;
  detail?:   string;
  severity:  RiskLevel;
  age:       number;
  canApprove:  boolean;
  canDismiss:  boolean;
  canRetry:    boolean;
  // Phase 20 — rich context for informed remote decisions
  rationale?:          string;   // why this is queued/blocked
  triggeredBy?:        string;   // rule/classifier that caused it
  willTouch?:          string[]; // systems affected if approved
  isDestructive?:      boolean;  // hard-to-reverse action
  affectedTarget?:     string;   // issue key, PR #, channel name
  relatedProject?:     string;   // project name from shared context
  relatedRepo?:        string;   // GitHub repo from context
  needsDesktopConfirm?: boolean; // desktop confirmation still required
  policyRule?:         string;   // exact policy / risk rule in force
  contextNotes?:       string;   // project automationContext from shared context
}

export interface DispatchHistoryEntry {
  id:          string;
  timestamp:   number;
  verb:        string;   // 'approve' | 'dismiss' | 'retry' | 'run' | 'blocked'
  label:       string;   // human-readable action description
  source:      string;   // 'jira' | 'linear' | 'agent' | 'recipe' | 'dispatch_remote' | …
  deviceLabel: string | null;
  isAdmin:     boolean;
  clientIp:    string;
  outcome:     string;   // 'ok' | 'pending' | 'error'
}

export interface DispatchRecipeItem {
  id:            string;
  name:          string;
  trigger:       string;
  enabled:       boolean;
  lastRunAt?:    number;
  lastRunStatus?: string;
}

export interface DispatchMissionItem {
  id:           string;
  name:         string;
  description?: string;
  category:     string;
  enabled:      boolean;
  schedule?:    string;
  lastRunAt?:   number;
}

export interface DispatchOpsOverview {
  actionsTotal:     number;
  approvedToday:    number;
  blockedToday:     number;
  failedRecipes:    number;
  unhealthyServices: number;
}

// ── Phase 31 — Runbook types ──────────────────────────────────────────────────

export interface DispatchRunbookItem {
  id:                  string;
  title:               string;
  description:         string;
  trigger:             string;
  enabled:             boolean;
  incidentMode:        boolean;
  linkedIntegrations:  string[];
  allowedRunnerRoles:  string[];
  lastExecutionStatus?:string;
  lastExecutionAt?:    number;
  stepCount:           number;
  // Phase 35 — pack provenance
  version?:            string;
  packId?:             string;
  packVersion?:        string;
}

export interface DispatchRunbookExecution {
  id:               string;
  runbookId:        string;
  runbookTitle:     string;
  status:           string;
  startedAt:        number;
  completedAt?:     number;
  actorId?:         string;
  isIncident:       boolean;
  currentStepIdx:   number;
  currentStepId?:   string;
  steps:            Array<{ stepId: string; type: string; label: string; status: string; result?: string; error?: string; branchedTo?: string }>;
  error?:           string;
  pausedAtStepIdx?: number;
  pausedReason?:    string;
  pauseTokenId?:    string;
  pausedAt?:        number;
  deadlineAt?:      number;
  escalatedAt?:     number;
  escalationCount?: number;
  // Phase 33 — branch audit trail
  branchDecisions?: Array<{ fromStepId: string; toStepId: string; branchType: string; reason: string; decidedAt: number }>;
  // Phase 35 — pack provenance at run time
  packId?:          string;
  packVersion?:     string;
}

// ── Phase 32 — Human handoff queue (Dispatch surface) ────────────────────────

export interface DispatchHandoffItem {
  id:              string;
  executionId:     string;
  runbookId:       string;
  runbookTitle:    string;
  stepId:          string;
  stepLabel:       string;
  type:            string;    // 'approval' | 'confirm' | 'manual' | 'escalation'
  status:          string;    // 'pending' | 'resolved' | 'expired' | 'aborted'
  blockedReason:   string;
  actorNeeded?:    string;
  isIncident:      boolean;
  createdAt:       number;
  expiresAt?:      number;
  escalateAt?:     number;
  escalatedAt?:    number;
  escalationCount?:number;
  // Phase 33 — derived display fields
  overdue:         boolean;   // expiresAt < now
  minutesRemaining?:number;   // positive = time left, negative = overdue by N min
  hasTimeout:      boolean;
  hasEscalation:   boolean;
  // Branch routing (for Dispatch UI)
  onRejection?:    string;
  onTimeout?:      string;
}

// ── Phase 21 — Dispatch Tasks ────────────────────────────────────────────────

export type TaskCategory = 'informational' | 'recipe' | 'mission' | 'write';

// ── Phase 23 — Artifacts + Remote Deliverables ───────────────────────────────

export type ArtifactType =
  | 'report'          // full markdown analysis/answer
  | 'draft_slack'     // Slack message ready to post
  | 'draft_jira'      // Jira comment/issue ready to create
  | 'draft_linear'    // Linear comment/issue ready to create
  | 'draft_github'    // GitHub review/comment ready to post
  | 'result_summary'  // recipe / write result
  | 'launch_summary'; // mission launch confirmation

export interface ArtifactMeta {
  channel?:    string;  // Slack channel id/name
  projectKey?: string;  // Jira project key
  issueKey?:   string;  // Jira issue key
  teamId?:     string;  // Linear team ID
  issueId?:    string;  // Linear issue ID
  repoOwner?:  string;  // GitHub owner
  repoName?:   string;  // GitHub repo
  prNumber?:   number;  // GitHub PR number
  status?:     'draft' | 'sent' | 'cancelled';
}

export interface DispatchArtifact {
  id:        string;
  taskId:    string;
  createdAt: number;
  type:      ArtifactType;
  title:     string;
  preview:   string;   // first ~200 chars for card display
  content:   string;   // full content (markdown, Jira wiki, etc.)
  meta?:     ArtifactMeta;
  threadId?: string;   // Phase 25
}

// ── Phase 25 — Dispatch Inbox + Cross-Task Conversations ─────────────────────

export type ThreadStatus = 'active' | 'waiting' | 'done' | 'failed';
export type MessageRole  = 'user' | 'assistant' | 'system';

export interface DispatchMessage {
  id:          string;
  threadId:    string;
  createdAt:   number;
  role:        MessageRole;
  text:        string;
  taskId?:     string;     // message linked to a task result/start
  artifactId?: string;     // message is an artifact notification
  bundleId?:   string;     // message is a bundle summary notification
}

export interface DispatchThread {
  id:          string;
  createdAt:   number;
  updatedAt:   number;
  title:       string;
  status:      ThreadStatus;
  taskIds:     string[];
  artifactIds: string[];
  bundleIds:   string[];
  messages:    DispatchMessage[];
  ctx:         DispatchTaskContext;   // carry-forward context for follow-ups
  deviceLabel: string | null;
  // Phase 26 — collaboration
  owner?:         string;              // deviceId of thread creator
  visibility?:    ThreadVisibility;    // defaults 'private'
  collaborators?: ThreadCollaborator[];
  invites?:       ThreadInvite[];
  comments?:      ThreadComment[];
  attributions?:  ApprovalAttribution[];
}

// ── Phase 27 — Organizations / Workspaces / Admin Controls ───────────────────

export type WorkspaceRole = 'owner' | 'admin' | 'operator' | 'reviewer' | 'viewer';

/** Role rank for comparison — higher = more privileged */
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 5, admin: 4, operator: 3, reviewer: 2, viewer: 1,
};

export interface WorkspaceMember {
  deviceId:    string;
  deviceLabel: string | null;
  role:        WorkspaceRole;
  joinedAt:    number;
  addedBy:     string;   // deviceId of inviter (or 'admin' for desktop)
}

export interface WorkspaceInvite {
  code:       string;    // 8-char uppercase alphanumeric
  createdAt:  number;
  expiresAt:  number;    // createdAt + 48h
  createdBy:  string;
  claimedBy?: string;
  claimedAt?: number;
  role:       WorkspaceRole;
  revoked:    boolean;
}

export interface WorkspacePolicy {
  minApproveRole:            WorkspaceRole;  // minimum role to approve in Action Center
  minRecipeRole:             WorkspaceRole;  // minimum role to create/run recipes
  minDispatchAdminRole:      WorkspaceRole;  // minimum role to manage dispatch settings
  minIntegrationRole:        WorkspaceRole;  // minimum role to edit integrations
  minMemoryRole:             WorkspaceRole;  // minimum role to edit shared memory
  requireDesktopConfirmForWrite: boolean;   // write tasks still need desktop confirm regardless
}

export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicy = {
  minApproveRole:            'operator',
  minRecipeRole:             'admin',
  minDispatchAdminRole:      'admin',
  minIntegrationRole:        'admin',
  minMemoryRole:             'operator',
  requireDesktopConfirmForWrite: true,
};

export interface Workspace {
  id:        string;
  name:      string;
  createdAt: number;
  updatedAt: number;
  ownerId:   string;   // deviceId of owner (desktop device)
  members:   WorkspaceMember[];
  invites:   WorkspaceInvite[];
  policy:    WorkspacePolicy;
}

// ── Phase 26 — Shared Threads + Team Collaboration ───────────────────────────

export type CollaboratorRole  = 'viewer' | 'reviewer' | 'operator';
export type ThreadVisibility  = 'private' | 'shared_read' | 'shared_approve';

export interface ThreadCollaborator {
  deviceId:    string;
  deviceLabel: string | null;
  role:        CollaboratorRole;
  joinedAt:    number;
}

export interface ThreadInvite {
  code:       string;    // 8-char uppercase alphanumeric
  createdAt:  number;
  expiresAt:  number;    // createdAt + 48h
  createdBy:  string;    // deviceId of issuer
  claimedBy?: string;    // deviceId that claimed it
  claimedAt?: number;
  role:       CollaboratorRole;
  revoked:    boolean;
}

export interface ThreadComment {
  id:          string;
  threadId:    string;
  createdAt:   number;
  authorId:    string;
  authorLabel: string | null;
  text:        string;
  targetType:  'task' | 'artifact' | 'bundle' | 'message' | 'thread';
  targetId:    string;
}

export interface ApprovalAttribution {
  id:          string;
  threadId:    string;
  timestamp:   number;
  actorId:     string;
  actorLabel:  string | null;
  action:      'approve' | 'dismiss' | 'send' | 'comment';
  targetId:    string;
  targetType:  string;
  clientIp:    string;
  outcome:     'ok' | 'denied' | 'error';
  note?:       string;
}

// ── Phase 24 — Multi-Artifact Bundles ────────────────────────────────────────

export type BundleStatus = 'pending' | 'partial' | 'sent' | 'cancelled';

export interface BundleDestination {
  system: 'slack' | 'jira' | 'linear' | 'github';
  label:  string;   // "#general", "PROJ-123", "org/repo#42"
}

export interface DispatchArtifactBundle {
  id:                  string;
  taskId:              string;
  createdAt:           number;
  title:               string;
  artifactIds:         string[];
  destinations:        BundleDestination[];
  status:              BundleStatus;
  needsApproval:       boolean;   // any artifact is a sendable draft
  needsDesktopConfirm: boolean;   // policy requires desktop confirm for any
  policySummary:       string;    // e.g. "2 safe · 1 requires approval"
  sentCount:           number;
  totalCount:          number;
  threadId?:           string;    // Phase 25
}

// Phase 22 — live step tracking
export interface DispatchTaskStep {
  ts:    number;
  label: string;
  done?: boolean;   // undefined = in-progress; true = success; false = error
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'done'
  | 'error';

export interface DispatchTaskContext {
  repo?:    string;
  project?: string;
  channel?: string;
  target?:  string;
}

export interface DispatchTaskParams {
  goal:          string;
  category:      TaskCategory;
  ctx?:          DispatchTaskContext;
  preferLocal?:  boolean;
}

export interface DispatchTask {
  id:            string;
  createdAt:     number;
  updatedAt:     number;
  goal:          string;
  category:      TaskCategory;
  status:        TaskStatus;
  result?:       string;
  error?:        string;
  confirmId?:    string;         // set when status === 'waiting_approval'
  ctx:           DispatchTaskContext;
  deviceLabel:   string | null;
  // Phase 22 — live tracking
  timeline?:     DispatchTaskStep[];
  currentStep?:  string;
  partialOutput?: string;
  lastActivity?: number;
  // Phase 23 — artifacts
  artifactIds?:  string[];
  // Phase 24 — bundles
  bundleIds?:    string[];
  // Phase 25 — thread
  threadId?:     string;
}

// Phase 22 — SSE event model (extended Phase 25/26)
export interface DispatchTaskEvent {
  type:       'task:step' | 'task:done' | 'task:error' | 'thread:message' | 'thread:update' | 'workspace:update' | 'ping';
  taskId?:    string;
  step?:      string;
  partial?:   string;
  status?:    string;
  timeline?:  DispatchTaskStep[];
  timestamp:  number;
  // Phase 25
  threadId?:  string;
  message?:   DispatchMessage;
  // Phase 26
  collaborators?: ThreadCollaborator[];
  comments?:      ThreadComment[];
  attributions?:  ApprovalAttribution[];
}

export interface DispatchHandlers {
  // Auth data
  getMasterToken():       Promise<string>;
  getPairedDevices():     PairedDevice[];
  setPairedDevices(v: PairedDevice[]): void;
  getPairingCode():       PairingCode | null;
  setPairingCode(v: PairingCode | null): void;
  getNetworkMode():       NetworkMode;
  getApprovePolicy():     RemoteApprovePolicy;
  getSessionTtlMinutes(): number;

  // Action data
  getActions():           Promise<DispatchActionItem[]>;
  approveAction(itemId: string, context: RemoteActionContext): Promise<ActionResult>;
  dismissAction(itemId: string, context: RemoteActionContext): Promise<ActionResult>;
  retryAction(itemId: string, context: RemoteActionContext):   Promise<ActionResult>;

  // Ops / recipe / mission
  getOpsOverview():       Promise<DispatchOpsOverview>;
  getRecipes():           Promise<DispatchRecipeItem[]>;
  runRecipe(id: string, context: RemoteActionContext): Promise<ActionResult>;
  getMissions():          Promise<DispatchMissionItem[]>;
  runMission(id: string, context: RemoteActionContext): Promise<ActionResult>;

  // Desktop confirmation
  queueConfirmation(conf: PendingConfirmation): void;
  resolveConfirmation(id: string): PendingConfirmation | undefined;

  // Audit
  auditLog(action: string, detail: string, context: RemoteActionContext): void;

  // History — recent remote dispatch activity (from audit ledger)
  getHistory(): Promise<DispatchHistoryEntry[]>;

  // Phase 21 — remote task workbench
  createTask(params: DispatchTaskParams, context: RemoteActionContext): Promise<DispatchTask>;
  getTask(id: string): Promise<DispatchTask | null>;
  listTasks(): Promise<DispatchTask[]>;

  // Phase 23 — artifacts
  listTaskArtifacts(taskId: string): Promise<DispatchArtifact[]>;
  getArtifact(id: string): Promise<DispatchArtifact | null>;
  approveArtifactSend(id: string, context: RemoteActionContext): Promise<ActionResult>;

  // Phase 24 — bundles
  listTaskBundles(taskId: string): Promise<DispatchArtifactBundle[]>;
  getBundle(id: string): Promise<DispatchArtifactBundle | null>;
  sendBundle(id: string, mode: 'all' | 'safe' | 'selected', selectedIds: string[], context: RemoteActionContext): Promise<ActionResult & { sent: string[]; held: string[] }>;

  // Phase 25 — threads / inbox
  listThreads(): Promise<DispatchThread[]>;
  getThread(id: string): Promise<DispatchThread | null>;
  postThreadMessage(threadId: string, text: string, category: TaskCategory, context: RemoteActionContext): Promise<{ message: DispatchMessage; task: DispatchTask }>;

  // Phase 27 — workspace management
  getWorkspace(): Promise<Workspace | null>;
  createWorkspaceInvite(role: WorkspaceRole, context: RemoteActionContext): Promise<{ invite: WorkspaceInvite }>;
  claimWorkspaceInvite(code: string, context: RemoteActionContext): Promise<{ workspace: Workspace }>;
  removeWorkspaceMember(targetDeviceId: string, context: RemoteActionContext): Promise<ActionResult>;
  setWorkspaceMemberRole(targetDeviceId: string, role: WorkspaceRole, context: RemoteActionContext): Promise<ActionResult>;
  updateWorkspacePolicy(policy: Partial<WorkspacePolicy>, context: RemoteActionContext): Promise<ActionResult>;

  // Phase 26 — thread sharing + collaboration
  createThreadInvite(threadId: string, role: CollaboratorRole, context: RemoteActionContext): Promise<{ invite: ThreadInvite }>;
  claimThreadInvite(code: string, context: RemoteActionContext): Promise<{ thread: DispatchThread }>;
  revokeCollaborator(threadId: string, targetDeviceId: string, context: RemoteActionContext): Promise<ActionResult>;
  listThreadComments(threadId: string, context: RemoteActionContext): Promise<ThreadComment[]>;
  addThreadComment(threadId: string, text: string, targetType: ThreadComment['targetType'], targetId: string, context: RemoteActionContext): Promise<ThreadComment>;
  deleteThreadComment(threadId: string, commentId: string, context: RemoteActionContext): Promise<ActionResult>;
  getThreadAttributions(threadId: string, context: RemoteActionContext): Promise<ApprovalAttribution[]>;
  recordThreadAttribution(threadId: string, partial: Omit<ApprovalAttribution, 'id' | 'threadId'>): void;

  // Phase 31 — runbooks
  listRunbooks():     Promise<DispatchRunbookItem[]>;
  runRunbook(id: string, context: RemoteActionContext, vars?: Record<string, string>): Promise<ActionResult & { executionId?: string }>;
  getRunbookExecution(executionId: string): Promise<DispatchRunbookExecution | null>;
  getIncidentMode(): { active: boolean; activatedAt?: number; reason?: string };

  // Phase 32 — handoff queue
  listHandoffItems(): Promise<DispatchHandoffItem[]>;
  resolveHandoffItem(id: string, resolution: string, context: RemoteActionContext): Promise<{ ok: boolean; error?: string }>;

  // Events → renderer
  emitToRenderer(channel: string, payload: unknown): void;
}

export interface RemoteActionContext {
  isAdmin:    boolean;
  deviceId:   string | null;
  deviceLabel: string | null;
  clientIp:   string;
  sessionId?: string;
}

export type ActionResult = { ok: boolean; pending?: boolean; confirmId?: string; error?: string };

// ── Pairing page HTML ───────────────────────────────────────────────────────────

const PAIR_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>TriForge — Pair Device</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  h1 { font-size: 22px; font-weight: 700; color: #818cf8; margin-bottom: 6px; }
  p { color: #94a3b8; font-size: 13px; text-align: center; margin-bottom: 24px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; width: 100%; max-width: 360px; }
  input { background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0;
    padding: 12px 14px; width: 100%; font-size: 20px; letter-spacing: 0.2em; text-align: center;
    outline: none; transition: border-color 0.15s; margin-bottom: 12px; }
  input:focus { border-color: #6366f1; }
  input[name=label] { font-size: 15px; letter-spacing: normal; }
  button { background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 13px;
    width: 100%; font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .err { color: #f87171; font-size: 13px; text-align: center; margin-top: 10px; min-height: 20px; }
  .ok { color: #34d399; font-size: 14px; text-align: center; margin-top: 12px; font-weight: 600; }
  label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px; }
</style>
</head>
<body>
<h1>TriForge Dispatch</h1>
<p>Enter the 6-digit pairing code shown on your desktop,<br>then give this device a name.</p>
<div class="card">
  <label>Pairing code</label>
  <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]*"
    maxlength="6" placeholder="000000" autocomplete="off">
  <label>Device name</label>
  <input id="label" name="label" type="text" placeholder="My iPhone" maxlength="60">
  <button id="btn" onclick="doPair()">Pair Device</button>
  <div id="err" class="err"></div>
  <div id="ok" class="ok" style="display:none;">Paired! Redirecting…</div>
</div>
<script>
async function doPair() {
  const code  = document.getElementById('code').value.trim();
  const label = document.getElementById('label').value.trim() || 'Unknown device';
  const errEl = document.getElementById('err');
  const okEl  = document.getElementById('ok');
  const btn   = document.getElementById('btn');
  errEl.textContent = '';
  if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit code'; return; }
  btn.disabled = true;
  try {
    const r = await fetch('/dispatch/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label }),
    });
    const data = await r.json();
    if (r.ok && data.sessionToken) {
      localStorage.setItem('dispatch_session', data.sessionToken);
      localStorage.setItem('dispatch_device_id', data.deviceId);
      okEl.style.display = 'block';
      setTimeout(() => { location.href = '/'; }, 1200);
    } else {
      errEl.textContent = data.error || 'Pairing failed';
      btn.disabled = false;
    }
  } catch(e) {
    errEl.textContent = 'Connection error';
    btn.disabled = false;
  }
}
document.getElementById('code').addEventListener('keydown', e => { if (e.key === 'Enter') doPair(); });
document.getElementById('label').addEventListener('keydown', e => { if (e.key === 'Enter') doPair(); });
</script>
</body>
</html>`;

// ── Invite page HTML (Phase 26) ──────────────────────────────────────────────

const INVITE_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>TriForge — Join Thread</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  h1 { font-size: 22px; font-weight: 700; color: #818cf8; margin-bottom: 6px; }
  p { color: #94a3b8; font-size: 13px; text-align: center; margin-bottom: 24px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; width: 100%; max-width: 360px; }
  .label { font-size: 12px; color: #64748b; margin-bottom: 6px; letter-spacing: 0.04em; text-transform: uppercase; }
  input { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0;
    font-size: 22px; font-weight: 700; letter-spacing: 0.15em; text-align: center; padding: 12px 8px;
    font-family: monospace; text-transform: uppercase; outline: none; margin-bottom: 16px; }
  input:focus { border-color: #818cf8; }
  button { width: 100%; background: #818cf8; color: #fff; border: none; border-radius: 8px; padding: 13px;
    font-size: 15px; font-weight: 700; cursor: pointer; margin-bottom: 10px; }
  button.ghost { background: transparent; border: 1px solid #334155; color: #94a3b8; }
  .msg { font-size: 13px; margin-top: 12px; min-height: 18px; text-align: center; }
  .msg.ok  { color: #34d399; }
  .msg.err { color: #f87171; }
</style>
</head>
<body>
<h1>TriForge Dispatch</h1>
<p>Enter your invite code to join a shared thread.</p>
<div class="card">
  <div class="label">Invite Code</div>
  <input id="code-input" maxlength="8" placeholder="XXXXXXXX" autocapitalize="characters"
    oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')claimCode()">
  <button onclick="claimCode()">Join Thread</button>
  <button class="ghost" onclick="location.href='/dispatch'">Back to Dispatch</button>
  <div id="msg" class="msg"></div>
</div>
<script>
const params = new URLSearchParams(location.search);
const preCode = params.get('code') || localStorage.getItem('pending_invite') || '';
if (preCode) document.getElementById('code-input').value = preCode.toUpperCase();

async function claimCode() {
  const code  = document.getElementById('code-input').value.trim().toUpperCase();
  const msgEl = document.getElementById('msg');
  if (code.length < 6) { msgEl.className='msg err'; msgEl.textContent='Enter your full invite code'; return; }
  const session = localStorage.getItem('dispatch_session');
  if (!session) {
    localStorage.setItem('pending_invite', code);
    location.href = '/dispatch/pair-page';
    return;
  }
  msgEl.className='msg'; msgEl.textContent='Joining…';
  const res = await fetch('/dispatch/invite/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.removeItem('pending_invite');
    msgEl.className='msg ok'; msgEl.textContent='Joined! Redirecting…';
    setTimeout(() => { location.href = '/dispatch#thread:' + data.thread.id; }, 800);
  } else {
    msgEl.className='msg err'; msgEl.textContent = data.error || 'Failed to join';
  }
}

// Auto-claim if we have a pending invite code and are already paired
window.addEventListener('DOMContentLoaded', () => {
  const pending = localStorage.getItem('pending_invite');
  if (pending) {
    const session = localStorage.getItem('dispatch_session');
    if (session) {
      document.getElementById('code-input').value = pending.toUpperCase();
      claimCode();
    }
  }
});
</script>
</body>
</html>`;

// ── Mobile UI HTML (Phase 20 — context-aware detail, history, destructive gate) ──

const DISPATCH_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0f172a">
<title>TriForge Dispatch</title>
<link rel="manifest" href="/dispatch/manifest.json">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f172a; --surface: #1e293b; --surface2: #273549; --border: #334155;
    --accent: #6366f1; --accent2: #818cf8;
    --text: #e2e8f0; --muted: #94a3b8;
    --danger: #ef4444; --warn: #f59e0b; --ok: #22c55e;
    --radius: 12px; --nav-h: 68px;
  }
  html, body { height: 100%; }
  body { background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 15px; display: flex; flex-direction: column; overflow: hidden; }
  /* ── Layout ── */
  #app { display: flex; flex-direction: column; height: 100%; }
  .top-bar { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 10px; border-bottom: 1px solid var(--border); background: var(--bg);
    position: sticky; top: 0; z-index: 10; }
  .top-title { font-weight: 700; font-size: 17px; color: var(--accent2); }
  .top-right { display: flex; gap: 8px; align-items: center; }
  #content { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 14px 14px calc(var(--nav-h) + 10px); max-width: 600px; margin: 0 auto; width: 100%; }
  /* ── Bottom nav ── */
  .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: var(--nav-h);
    background: var(--surface); border-top: 1px solid var(--border);
    display: flex; align-items: stretch; z-index: 20;
    padding-bottom: env(safe-area-inset-bottom); }
  .nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; background: transparent; border: none; color: var(--muted); font-size: 10px;
    font-weight: 500; cursor: pointer; padding: 8px 0; position: relative;
    -webkit-tap-highlight-color: transparent; transition: color 0.15s; }
  .nav-btn.active { color: var(--accent2); }
  .nav-btn svg { width: 22px; height: 22px; }
  .nav-badge { position: absolute; top: 6px; right: calc(50% - 18px);
    background: var(--danger); color: #fff; font-size: 10px; font-weight: 700;
    min-width: 16px; height: 16px; border-radius: 99px; display: flex;
    align-items: center; justify-content: center; padding: 0 4px; }
  /* ── Cards ── */
  .card { background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px; margin-bottom: 10px;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: border-color 0.15s; }
  .card:active { border-color: var(--accent); }
  .card.needs-confirm { border-left: 3px solid var(--warn); }
  .card-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .card-title { font-weight: 600; font-size: 14px; margin-bottom: 3px; }
  .card-sub { color: var(--muted); font-size: 12px; }
  .card-detail-preview { color: var(--muted); font-size: 12px; margin-top: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-chevron { margin-left: auto; color: var(--border); }
  /* ── Badges ── */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; }
  .badge.critical { background: #7f1d1d; color: #fca5a5; }
  .badge.high     { background: #7c2d12; color: #fdba74; }
  .badge.medium   { background: #78350f; color: #fcd34d; }
  .badge.low      { background: #1e3a5f; color: #93c5fd; }
  .badge.ok-pill  { background: #14532d; color: #86efac; }
  .badge.muted    { background: var(--surface2); color: var(--muted); }
  /* ── Stats ── */
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px; text-align: center; }
  .stat-val { font-size: 28px; font-weight: 700; color: var(--accent2); }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.05em; margin-top: 4px; }
  /* ── Buttons ── */
  button.btn { background: var(--accent); color: #fff; border: none; border-radius: var(--radius);
    padding: 14px 20px; font-size: 15px; font-weight: 600; cursor: pointer;
    width: 100%; transition: opacity 0.15s; -webkit-tap-highlight-color: transparent; }
  button.btn:active { opacity: 0.8; }
  button.btn.sm { padding: 8px 16px; font-size: 13px; border-radius: 8px; width: auto; }
  button.btn.danger  { background: var(--danger); }
  button.btn.warn    { background: var(--warn); color: #1a1a1a; }
  button.btn.ok      { background: var(--ok); color: #1a1a1a; }
  button.btn.ghost   { background: transparent; border: 1px solid var(--border); color: var(--muted); }
  button.btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-row { display: flex; gap: 10px; margin-top: 10px; }
  .btn-row .btn { flex: 1; }
  /* ── Hold-to-approve ring ── */
  .hold-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; }
  .hold-ring { position: absolute; top: -4px; left: -4px; right: -4px; bottom: -4px;
    pointer-events: none; }
  .hold-ring circle { fill: none; stroke: var(--ok); stroke-width: 3;
    stroke-dasharray: 100; stroke-dashoffset: 100; stroke-linecap: round;
    transition: none; transform-origin: 50% 50%; transform: rotate(-90deg); }
  .hold-ring circle.animating {
    transition: stroke-dashoffset 0.75s linear;
    stroke-dashoffset: 0;
  }
  /* ── Detail drawer ── */
  .drawer { position: fixed; inset: 0; z-index: 50; pointer-events: none; }
  .drawer.open { pointer-events: auto; }
  .drawer-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6);
    opacity: 0; transition: opacity 0.25s; }
  .drawer.open .drawer-backdrop { opacity: 1; }
  .drawer-panel { position: absolute; bottom: 0; left: 0; right: 0;
    background: var(--surface); border-radius: 18px 18px 0 0;
    border-top: 1px solid var(--border); padding: 0 0 env(safe-area-inset-bottom);
    transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1);
    max-height: 85vh; display: flex; flex-direction: column; }
  .drawer.open .drawer-panel { transform: translateY(0); }
  .drawer-handle { width: 36px; height: 4px; background: var(--border); border-radius: 2px;
    margin: 10px auto 0; flex-shrink: 0; }
  .drawer-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px; }
  .drawer-actions { flex-shrink: 0; padding: 12px 16px; border-top: 1px solid var(--border);
    background: var(--surface); display: flex; flex-direction: column; gap: 8px; }
  .drawer-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
  .drawer-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; align-items: center; }
  .drawer-section { margin-bottom: 14px; }
  .drawer-section-label { font-size: 11px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 5px; }
  .drawer-section-val { font-size: 14px; color: var(--text); word-break: break-word; }
  .view-only-note { color: var(--muted); font-size: 13px; text-align: center; padding: 4px 0; }
  /* ── Task drawer context rows ── */
  .section-head { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em;
    margin: 12px 0 5px; border-top: 1px solid var(--border); padding-top: 10px; }
  .ctx-row { display: flex; gap: 8px; font-size: 13px; margin-bottom: 4px; align-items: baseline; }
  .ctx-key { color: var(--muted); flex-shrink: 0; min-width: 64px; }
  /* ── Phase 22 — Task timeline ── */
  .timeline { display: flex; flex-direction: column; padding-left: 6px; }
  .tl-step { display: flex; gap: 12px; position: relative; padding-bottom: 12px; }
  .tl-step:last-child { padding-bottom: 0; }
  .tl-step::before { content: ''; position: absolute; left: 6px; top: 18px; width: 1px;
    height: calc(100% - 6px); background: var(--border); }
  .tl-step:last-child::before { display: none; }
  .tl-dot { width: 13px; height: 13px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; border: 2px solid; }
  .tl-ok  .tl-dot { background: var(--ok);     border-color: var(--ok);     }
  .tl-err .tl-dot { background: var(--danger); border-color: var(--danger); }
  .tl-run .tl-dot { background: var(--warn);   border-color: var(--warn);
    animation: tl-pulse 1.2s ease-in-out infinite; }
  @keyframes tl-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  .tl-body { flex: 1; min-width: 0; }
  .tl-label { font-size: 13px; font-weight: 500; }
  .tl-time  { font-size: 11px; color: var(--muted); margin-top: 2px; }
  /* partial output block */
  .partial-out { background: var(--surface2); border-radius: 8px; padding: 10px 12px;
    font-size: 12px; white-space: pre-wrap; word-break: break-word; color: var(--muted);
    max-height: 160px; overflow-y: auto; margin-top: 6px; }
  /* ── Phase 23 — Artifact cards in task drawer ── */
  .artifact-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px; margin-bottom: 8px; cursor: pointer; transition: border-color .15s; }
  .artifact-card:active { border-color: var(--accent); }
  .artifact-card-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .artifact-type { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .05em; padding: 2px 6px; border-radius: 4px; }
  .art-report     { background:#1e3a5f; color:#7dd3fc; }
  .art-draft_slack  { background:#1a2a1a; color:#4ade80; }
  .art-draft_jira   { background:#1a1a3a; color:#818cf8; }
  .art-draft_linear { background:#2a1a2a; color:#c084fc; }
  .art-draft_github { background:#2a1a1a; color:#f87171; }
  .art-result_summary  { background:#1a2a20; color:#34d399; }
  .art-launch_summary  { background:#2a220a; color:#fbbf24; }
  .artifact-preview { font-size: 12px; color: var(--muted); overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .artifact-chevron { margin-left: auto; color: var(--muted); font-size: 18px; }
  /* ── Artifact overlay viewer ── */
  .art-overlay { position: fixed; inset: 0; background: var(--bg); z-index: 80;
    display: flex; flex-direction: column; transform: translateY(100%);
    transition: transform .28s ease; }
  .art-overlay.open { transform: translateY(0); }
  .art-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .art-back { background: none; border: none; color: var(--accent2); font-size: 15px;
    font-weight: 600; cursor: pointer; padding: 4px 0; }
  .art-header-title { font-weight: 700; font-size: 16px; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .art-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 16px; max-width: 600px; margin: 0 auto; width: 100%; }
  .art-content-block { background: var(--surface2); border-radius: 10px; padding: 14px;
    font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    margin-top: 10px; }
  .art-footer { padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap;
    flex-shrink: 0; }
  .art-footer .btn { flex: 1; min-width: 100px; }
  /* ── Phase 24 — Bundle cards + overlay ── */
  .bundle-card { background: var(--surface); border: 1px solid var(--accent); border-radius: 12px;
    padding: 13px 14px; margin-bottom: 10px; cursor: pointer; transition: border-color .15s; }
  .bundle-card:active { border-color: var(--accent2); }
  .bundle-card-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bundle-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .bundle-dests { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .bundle-dest  { font-size: 11px; padding: 2px 7px; border-radius: 4px; font-weight: 600; }
  .dest-slack   { background:#1a2a1a; color:#4ade80; }
  .dest-jira    { background:#1a1a3a; color:#818cf8; }
  .dest-linear  { background:#2a1a2a; color:#c084fc; }
  .dest-github  { background:#2a1a1a; color:#f87171; }
  .bundle-progress { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .bundle-prog-bar { flex: 1; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .bundle-prog-fill { height: 100%; background: var(--ok); border-radius: 2px; transition: width .3s; }
  .bundle-prog-label { font-size: 11px; color: var(--muted); flex-shrink: 0; }
  /* Bundle overlay (full-screen, same pattern as art-overlay) */
  .bnd-overlay { position: fixed; inset: 0; background: var(--bg); z-index: 85;
    display: flex; flex-direction: column; transform: translateY(100%);
    transition: transform .28s ease; }
  .bnd-overlay.open { transform: translateY(0); }
  .bnd-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .bnd-back { background: none; border: none; color: var(--accent2); font-size: 15px;
    font-weight: 600; cursor: pointer; padding: 4px 0; }
  .bnd-header-title { font-weight: 700; font-size: 16px; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bnd-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 14px 16px; max-width: 600px; margin: 0 auto; width: 100%; }
  .bnd-art-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0;
    border-bottom: 1px solid var(--border); }
  .bnd-art-row:last-child { border-bottom: none; }
  .bnd-art-check { width: 20px; height: 20px; flex-shrink: 0; margin-top: 2px;
    accent-color: var(--accent); cursor: pointer; }
  .bnd-art-info { flex: 1; min-width: 0; }
  .bnd-art-title { font-size: 13px; font-weight: 500; }
  .bnd-art-sub   { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .bnd-policy-warn { background: #1a1a0a; border: 1px solid #713f12; border-radius: 10px;
    padding: 12px 14px; margin: 10px 0; }
  .bnd-policy-title { font-weight: 700; font-size: 13px; color: #fbbf24; margin-bottom: 5px; }
  .bnd-policy-body  { font-size: 13px; color: #fde68a; line-height: 1.5; }
  .bnd-footer { padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap;
    flex-shrink: 0; }
  .bnd-footer .btn { flex: 1; min-width: 100px; }
  /* ── Phase 25 — Inbox thread cards ── */
  .thread-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 13px 14px; margin-bottom: 8px; cursor: pointer; transition: border-color .15s; }
  .thread-card:active { border-color: var(--accent); }
  .thread-card-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .thread-title { font-weight: 600; font-size: 14px; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
  .thread-last-msg { font-size: 12px; color: var(--muted); margin-top: 3px;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .thread-meta { display: flex; gap: 8px; align-items: center; margin-top: 5px; flex-wrap: wrap; }
  .muted-pill { font-size: 11px; color: var(--muted); background: var(--surface2); border-radius: 20px; padding: 2px 7px; }
  /* Thread overlay — full screen like bundle overlay */
  .thr-overlay { position: fixed; inset: 0; background: var(--bg); z-index: 90;
    display: flex; flex-direction: column; transform: translateY(100%);
    transition: transform .28s ease; }
  .thr-overlay.open { transform: translateY(0); }
  .thr-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .thr-back { background: none; border: none; color: var(--accent2); font-size: 15px;
    font-weight: 600; cursor: pointer; padding: 4px 0; }
  .thr-header-title { font-weight: 700; font-size: 15px; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Message timeline */
  .thr-messages { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 14px 14px 0; display: flex; flex-direction: column; gap: 10px;
    max-width: 600px; margin: 0 auto; width: 100%; }
  .msg-row { display: flex; flex-direction: column; max-width: 90%; }
  .msg-row.user     { align-self: flex-end; align-items: flex-end; }
  .msg-row.assistant{ align-self: flex-start; align-items: flex-start; }
  .msg-row.system   { align-self: center; align-items: center; max-width: 100%; }
  .msg-bubble { padding: 10px 13px; border-radius: 14px; font-size: 14px;
    line-height: 1.5; word-break: break-word; white-space: pre-wrap; }
  .msg-row.user      .msg-bubble { background: var(--accent); color: #fff; border-radius: 14px 14px 3px 14px; }
  .msg-row.assistant .msg-bubble { background: var(--surface2); color: var(--text); border-radius: 14px 14px 14px 3px; }
  .msg-row.system    .msg-bubble { background: transparent; color: var(--muted); font-size: 12px;
    padding: 3px 8px; border: 1px solid var(--border); border-radius: 20px; }
  .msg-time { font-size: 10px; color: var(--muted); margin-top: 3px; padding: 0 3px; }
  /* Inline task/artifact/bundle cards inside thread */
  .msg-inline-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px;
    padding: 9px 12px; margin-top: 5px; cursor: pointer; font-size: 13px; }
  .msg-inline-card:active { border-color: var(--accent); }
  .msg-inline-title { font-weight: 500; }
  .msg-inline-sub   { font-size: 11px; color: var(--muted); margin-top: 2px; }
  /* Composer */
  .thr-composer { border-top: 1px solid var(--border); padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
    flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
    max-width: 600px; margin: 0 auto; width: 100%; }
  .thr-composer-row { display: flex; gap: 8px; align-items: flex-end; }
  .thr-composer textarea { flex: 1; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 10px; color: var(--text); font-size: 14px; padding: 10px 12px;
    resize: none; font-family: inherit; outline: none; line-height: 1.4; max-height: 120px; }
  .thr-composer textarea:focus { border-color: var(--accent); }
  .thr-send-btn { background: var(--accent); border: none; color: #fff; border-radius: 10px;
    padding: 10px 14px; font-size: 14px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
  .thr-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .thr-cat-row { display: flex; gap: 6px; align-items: center; }
  .thr-cat-label { font-size: 11px; color: var(--muted); }
  .thr-cat-select { background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 5px 8px; font-size: 12px; }
  /* ── Phase 26 — Collaboration ── */
  .collab-strip { display:flex; align-items:center; gap:6px; flex-wrap:wrap;
    padding:8px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
  .collab-pill { display:inline-flex; align-items:center; gap:4px; background:var(--surface2);
    border-radius:20px; padding:3px 9px; font-size:11px; font-weight:600; }
  .collab-role-owner    { color:#fbbf24; }
  .collab-role-operator { color:#818cf8; }
  .collab-role-reviewer { color:#34d399; }
  .collab-role-viewer   { color:var(--muted); }
  .invite-btn { background:none; border:1px dashed var(--border); border-radius:20px;
    color:var(--muted); font-size:11px; padding:3px 9px; cursor:pointer; }
  .invite-btn:hover { border-color:var(--accent); color:var(--accent); }
  /* Comments */
  .comments-section { padding:12px 14px; flex-shrink:0; max-width:600px; margin:0 auto; width:100%; }
  .comment-row { display:flex; flex-direction:column; gap:3px; margin-bottom:10px; }
  .comment-author { font-size:11px; color:var(--muted); font-weight:600; }
  .comment-text { font-size:13px; background:var(--surface2); border-radius:8px;
    padding:8px 10px; line-height:1.4; word-break:break-word; }
  .comment-del { background:none; border:none; color:var(--muted); font-size:10px;
    cursor:pointer; padding:2px 4px; align-self:flex-end; }
  .comment-del:hover { color:#f87171; }
  .comment-input-row { display:flex; gap:8px; margin-top:8px; }
  .comment-input { flex:1; background:var(--surface2); border:1px solid var(--border);
    border-radius:8px; color:var(--text); font-size:13px; padding:8px 10px;
    font-family:inherit; outline:none; }
  .comment-input:focus { border-color:var(--accent); }
  /* Attribution log */
  .attr-row { display:flex; align-items:flex-start; gap:8px; padding:8px 0;
    border-bottom:1px solid var(--border); font-size:12px; }
  .attr-row:last-child { border-bottom:none; }
  .attr-action { padding:2px 7px; border-radius:99px; font-size:10px; font-weight:700; flex-shrink:0; }
  .attr-approve { background:#14532d; color:#86efac; }
  .attr-dismiss { background:var(--surface2); color:var(--muted); }
  .attr-send    { background:#1e3a5f; color:#93c5fd; }
  .attr-comment { background:#2a1a2a; color:#c084fc; }
  /* Invite modal */
  .invite-modal { position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:95;
    display:flex; align-items:center; justify-content:center; padding:24px; }
  .invite-modal-box { background:var(--surface); border:1px solid var(--border);
    border-radius:16px; padding:22px; width:100%; max-width:360px; }
  .invite-code-display { font-size:26px; font-weight:700; letter-spacing:0.2em; text-align:center;
    color:var(--accent2); background:var(--surface2); border-radius:10px; padding:14px;
    margin:10px 0; cursor:pointer; }
  .invite-code-url { font-size:11px; color:var(--muted); word-break:break-all;
    margin-bottom:10px; text-align:center; }
  .role-select { background:var(--bg); border:1px solid var(--border); color:var(--text);
    border-radius:8px; padding:9px 10px; font-size:14px; width:100%; margin-bottom:10px; }
  /* Collaborator list inside thread */
  .collab-item { display:flex; align-items:center; gap:10px; padding:8px 0;
    border-bottom:1px solid var(--border); }
  .collab-item:last-child { border-bottom:none; }
  .collab-name { flex:1; font-size:13px; font-weight:500; }
  .collab-role-badge { font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
  .collab-revoke { background:none; border:none; color:var(--muted); font-size:12px;
    cursor:pointer; padding:3px 8px; }
  .collab-revoke:hover { color:#f87171; }
  /* ── Workspace tab ── */
  .input-field { background:#0f172a; border:1px solid var(--border); border-radius:8px;
    color:var(--text); font-size:14px; padding:10px 12px; width:100%; outline:none;
    font-family:inherit; box-sizing:border-box; }
  .input-field:focus { border-color:var(--accent); }
  /* ── Deny modal ── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    z-index: 60; display: flex; align-items: flex-end; }
  .modal-box { background: var(--surface); border-radius: 18px 18px 0 0;
    border-top: 1px solid var(--border); padding: 20px 16px calc(16px + env(safe-area-inset-bottom));
    width: 100%; }
  .modal-title { font-weight: 700; font-size: 16px; margin-bottom: 6px; }
  .modal-sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
  textarea { background: #0f172a; border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); font-size: 14px; padding: 12px; width: 100%; resize: vertical;
    min-height: 80px; outline: none; font-family: inherit; margin-bottom: 12px; }
  textarea:focus { border-color: var(--accent); }
  /* ── Misc ── */
  .empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 13px; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .toast { position: fixed; bottom: calc(var(--nav-h) + 10px); left: 50%;
    transform: translateX(-50%); background: #1e293b; border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 18px; font-size: 13px; z-index: 100;
    transition: opacity 0.3s; white-space: nowrap; pointer-events: none; }
  .warn-banner { background: #422006; border: 1px solid #92400e; border-radius: var(--radius);
    padding: 12px 14px; margin-bottom: 12px; }
  .warn-banner .wb-title { font-weight: 700; color: #fcd34d; font-size: 13px; margin-bottom: 3px; }
  .warn-banner .wb-sub { font-size: 12px; color: #fdba74; }
  .recipe-card { background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px; margin-bottom: 10px; }
  /* ── Destructive action warning ── */
  .destructive-warn { background: #3b0a0a; border: 1px solid #7f1d1d; border-radius: 10px;
    padding: 14px; margin-top: 12px; }
  .destructive-warn .dw-title { font-weight: 700; color: #fca5a5; font-size: 13px; margin-bottom: 6px; }
  .destructive-warn .dw-body { font-size: 13px; color: #fecaca; margin-bottom: 12px; line-height: 1.5; }
  .destructive-warn .dw-check { display: flex; align-items: flex-start; gap: 10px;
    font-size: 13px; color: #fca5a5; cursor: pointer; }
  .destructive-warn .dw-check input { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; accent-color: var(--danger); }
  /* ── Context chips ── */
  .chip-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  /* ── History ── */
  .history-card { background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
  .history-verb { display: inline-block; padding: 2px 8px; border-radius: 99px;
    font-size: 11px; font-weight: 700; }
  .history-verb.approve { background: #14532d; color: #86efac; }
  .history-verb.dismiss { background: var(--surface2); color: var(--muted); }
  .history-verb.retry   { background: #78350f; color: #fcd34d; }
  .history-verb.run     { background: #1e3a5f; color: #93c5fd; }
  .history-verb.blocked { background: #7f1d1d; color: #fca5a5; }
</style>
</head>
<body>
<div id="app">
  <div class="top-bar">
    <span class="top-title">Dispatch</span>
    <div class="top-right">
      <span id="hdr-spinner" style="display:none;" class="spinner"></span>
      <button class="btn sm ghost" onclick="doRefresh()">Refresh</button>
      <button class="btn sm ghost" onclick="doLogout()">Logout</button>
    </div>
  </div>

  <div id="content">
    <div id="tab-overview"></div>
    <div id="tab-actions" style="display:none;"></div>
    <div id="tab-recipes" style="display:none;"></div>
    <div id="tab-missions" style="display:none;"></div>
    <div id="tab-tasks" style="display:none;"></div>
    <div id="tab-inbox" style="display:none;"></div>
    <div id="tab-history" style="display:none;"></div>
    <div id="tab-workspace" style="display:none;"></div>
  </div>
</div>

<!-- Bottom navigation -->
<nav class="bottom-nav">
  <button class="nav-btn active" id="nav-overview" onclick="switchTab('overview')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
    Overview
  </button>
  <button class="nav-btn" id="nav-inbox" onclick="switchTab('inbox')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
    Inbox
    <span id="inbox-badge" class="nav-badge" style="display:none;"></span>
  </button>
  <button class="nav-btn" id="nav-actions" onclick="switchTab('actions')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
    Actions
    <span id="action-badge" class="nav-badge" style="display:none;"></span>
  </button>
  <button class="nav-btn" id="nav-recipes" onclick="switchTab('recipes')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
    Recipes
  </button>
  <button class="nav-btn" id="nav-missions" onclick="switchTab('missions')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
    </svg>
    Missions
  </button>
  <button class="nav-btn" id="nav-tasks" onclick="switchTab('tasks')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
    Tasks
  </button>
  <button class="nav-btn" id="nav-history" onclick="switchTab('history')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
    </svg>
    History
  </button>
  <button class="nav-btn" id="nav-workspace" onclick="switchTab('workspace')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
    Workspace
  </button>
</nav>

<!-- Action detail drawer -->
<div id="drawer" class="drawer" onclick="handleDrawerBackdrop(event)">
  <div class="drawer-backdrop"></div>
  <div class="drawer-panel" id="drawer-panel">
    <div class="drawer-handle"></div>
    <div class="drawer-scroll" id="drawer-scroll"></div>
    <div class="drawer-actions" id="drawer-actions"></div>
  </div>
</div>

<!-- Deny comment modal -->
<div id="deny-modal" class="modal-overlay" style="display:none;">
  <div class="modal-box">
    <div class="modal-title">Dismiss action</div>
    <div class="modal-sub">Add an optional note (visible in audit log)</div>
    <textarea id="deny-comment" placeholder="Reason for dismissal…"></textarea>
    <div class="btn-row">
      <button class="btn ghost" onclick="closeDenyModal()">Cancel</button>
      <button class="btn danger" onclick="confirmDeny()">Dismiss</button>
    </div>
  </div>
</div>

<!-- Phase 24 — Bundle batch-send overlay -->
<div id="bundle-overlay" class="bnd-overlay">
  <div class="bnd-header">
    <button class="bnd-back" onclick="closeBundle()">← Back</button>
    <div class="bnd-header-title" id="bnd-title"></div>
    <span id="bnd-status-badge"></span>
  </div>
  <div class="bnd-scroll" id="bnd-scroll"></div>
  <div class="bnd-footer" id="bnd-footer"></div>
</div>

<!-- Phase 23 — Artifact full viewer overlay -->
<div id="artifact-overlay" class="art-overlay">
  <div class="art-header">
    <button class="art-back" onclick="closeArtifact()">← Back</button>
    <div class="art-header-title" id="art-title"></div>
    <span id="art-status-badge"></span>
  </div>
  <div class="art-scroll" id="art-scroll"></div>
  <div class="art-footer" id="art-footer"></div>
</div>

<div id="thread-overlay" class="thr-overlay">
  <div class="thr-header">
    <button class="art-back" onclick="closeThread()">← Inbox</button>
    <div style="flex:1;min-width:0;">
      <div id="thr-title" style="font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
    </div>
    <span id="thr-status" class="badge"></span>
    <button class="invite-btn" id="thr-invite-btn" onclick="openInviteModal()" style="display:none;">+ Invite</button>
  </div>
  <!-- Phase 26: collaborator strip -->
  <div id="thr-collab-strip" class="collab-strip" style="display:none;"></div>
  <div id="thr-messages" class="thr-messages"></div>
  <!-- Phase 26: comments section (between messages and composer) -->
  <div id="thr-comments-section" style="display:none;border-top:1px solid var(--border);max-width:600px;margin:0 auto;width:100%;"></div>
  <!-- Phase 26: attribution log (expandable panel) -->
  <div id="thr-attr-panel" style="display:none;padding:0 14px 8px;max-width:600px;margin:0 auto;width:100%;"></div>
  <div id="thr-composer" class="thr-composer" style="display:none;">
    <div id="thr-error" style="color:#f87171;font-size:12px;min-height:16px;padding:0 12px;"></div>
    <div style="display:flex;gap:8px;padding:10px 12px;">
      <input id="thr-input" class="form-input" placeholder="Follow-up message…" style="flex:1;" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendFollowUp(_openThreadId);}">
      <button class="btn-primary" style="padding:8px 14px;font-size:13px;" onclick="sendFollowUp(_openThreadId)">Send</button>
    </div>
  </div>
</div>

<!-- Phase 26: Invite modal -->
<div id="invite-modal" class="invite-modal" style="display:none;" onclick="if(event.target===this)closeInviteModal()">
  <div class="invite-modal-box">
    <div style="font-weight:700;font-size:16px;margin-bottom:4px;">Invite Collaborator</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Single-use code, valid 48 hours.</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.05em;">Role</div>
    <select id="invite-role" class="role-select">
      <option value="viewer">Viewer — read only</option>
      <option value="reviewer">Reviewer — comment + approve low-risk</option>
      <option value="operator">Operator — full approve + send</option>
    </select>
    <button class="btn" onclick="generateInvite()" style="width:100%;margin-bottom:8px;">Generate Code</button>
    <div id="invite-result" style="display:none;">
      <div class="invite-code-display" id="invite-code-val" onclick="copyInviteCode()"></div>
      <div class="invite-code-url" id="invite-code-url"></div>
      <div style="font-size:11px;color:var(--muted);text-align:center;margin-bottom:12px;">Tap code to copy · Expires in 48h</div>
    </div>
    <div id="invite-gen-error" style="color:#f87171;font-size:12px;min-height:14px;"></div>
    <button onclick="closeInviteModal()" style="width:100%;background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:10px;font-size:14px;cursor:pointer;margin-top:4px;">Close</button>
  </div>
</div>

<div id="toast" class="toast" style="display:none;"></div>

<script>
// ── State ─────────────────────────────────────────────────────────────────────
let _token = '';
let _currentTab = 'overview';
let _data = { overview: null, actions: [], recipes: [], missions: [], history: [], tasks: [], threads: [], workspace: null };
let _threadCache = {}; // threadId → full DispatchThread
let _openThreadId = null;
let _openThreadRole = null;   // Phase 26: 'owner'|'operator'|'reviewer'|'viewer'|null for open thread
let _inviteTargetThreadId = null;
let _pendingInviteCode = null; // Phase 26: invite code to claim after connect
let _myDeviceId = null;        // Phase 26: this device's id (from localStorage)
let _allowApprove = false;
let _policy = {};
let _drawerItem = null;
let _denyTargetId = null;
let _holdTimer = null;
let _holdTarget = null;

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  _myDeviceId = localStorage.getItem('dispatch_device_id');
  const params = new URLSearchParams(location.search);
  const qToken = params.get('token');
  // Phase 26: capture pending invite code from URL
  const qInvite = params.get('invite');
  if (qInvite) { _pendingInviteCode = qInvite.trim().toUpperCase(); localStorage.removeItem('pending_invite'); }
  else { const pi = localStorage.getItem('pending_invite'); if (pi) { _pendingInviteCode = pi; localStorage.removeItem('pending_invite'); } }
  if (qToken) {
    _token = qToken;
    localStorage.setItem('dispatch_session', qToken);
    history.replaceState(null, '', location.pathname);
    doConnect(); return;
  }
  const stored = localStorage.getItem('dispatch_session');
  if (stored) { _token = stored; doConnect(); return; }
  location.href = '/dispatch/pair-page';
});

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/dispatch/sw.js').catch(() => {});
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function doLogout() {
  _token = '';
  localStorage.removeItem('dispatch_session');
  localStorage.removeItem('dispatch_device_id');
  location.href = '/dispatch/pair-page';
}

async function doConnect() {
  setSpinner(true);
  const res = await api('GET', '/dispatch/health');
  setSpinner(false);
  if (res.ok) {
    _allowApprove = res.data.approvePolicy?.enabled ?? false;
    _policy = res.data.approvePolicy ?? {};
    loadAll();
    connectStream();
    _handleDeepLink();
    // Phase 26: claim pending invite after connect
    if (_pendingInviteCode) {
      const code = _pendingInviteCode; _pendingInviteCode = null;
      const r = await api('POST', '/dispatch/invite/claim', { code });
      if (r.ok) {
        toast('Joined: ' + r.data.thread.title);
        _threadCache[r.data.thread.id] = r.data.thread;
        loadThreads().then(() => { switchTab('inbox'); openThread(r.data.thread.id); });
      } else {
        toast('Invite: ' + (r.data?.error || 'Invalid or expired code'));
      }
    }
  } else if (res.status === 401) {
    const refreshed = await api('POST', '/dispatch/auth/refresh');
    if (refreshed.ok) {
      _token = refreshed.data.sessionToken;
      localStorage.setItem('dispatch_session', _token);
      doConnect();
    } else {
      localStorage.removeItem('dispatch_session');
      location.href = '/dispatch/pair-page';
    }
  } else {
    toast('Connection failed');
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  try {
    const opts = { method, headers: { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch(e) {
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

// ── Phase 22 — SSE stream ─────────────────────────────────────────────────────

let _stream = null;
let _streamRetry = 0;

function connectStream() {
  if (_stream || !_token) return;
  try {
    _stream = new EventSource('/dispatch/stream?token=' + encodeURIComponent(_token));
    _stream.onopen = () => { _streamRetry = 0; };
    _stream.onmessage = e => {
      try { _handleStreamEvent(JSON.parse(e.data)); } catch {}
    };
    _stream.onerror = () => {
      _stream.close(); _stream = null;
      const delay = Math.min(1000 * Math.pow(2, _streamRetry++), 30000);
      setTimeout(connectStream, delay);
    };
  } catch {}
}

function _handleStreamEvent(event) {
  if (!event || event.type === 'ping') return;

  // Thread message event
  if (event.type === 'thread:message' && event.threadId && event.message) {
    const threadId = event.threadId;
    // Update cache if we have it loaded
    if (_threadCache[threadId]) {
      const msgs = _threadCache[threadId].messages;
      const exists = msgs.some(m => m.id === event.message.id);
      if (!exists) {
        msgs.push(event.message);
        _threadCache[threadId].updatedAt = event.timestamp;
      }
      // Re-render if this thread is currently open
      if (_openThreadId === threadId) {
        _renderThread(_threadCache[threadId]);
      }
    } else {
      // Unknown thread — reload thread list
      loadThreads();
    }
    // Update summary row in thread list
    const idx = _data.threads.findIndex(t => t.id === threadId);
    if (idx >= 0) _data.threads[idx].updatedAt = event.timestamp;
    updateInboxBadge();
    if (_currentTab === 'inbox') renderInbox();
    return;
  }

  // Phase 27: workspace:update — membership or policy changed
  if (event.type === 'workspace:update') {
    loadWorkspaceData().then(() => { if (_currentTab === 'workspace') renderWorkspace(); });
    return;
  }

  // Phase 26: thread:update — collaborators/comments/attributions changed
  if (event.type === 'thread:update' && event.threadId) {
    const tid = event.threadId;
    if (_threadCache[tid]) {
      if (event.collaborators) _threadCache[tid].collaborators = event.collaborators;
      if (event.comments)      _threadCache[tid].comments      = event.comments;
      if (event.attributions)  _threadCache[tid].attributions  = event.attributions;
      if (_openThreadId === tid) {
        if (event.collaborators) _renderCollabStrip(_threadCache[tid]);
        if (event.comments)      _renderCommentsSection(_threadCache[tid]);
        if (event.attributions)  _renderAttrPanel(_threadCache[tid]);
      }
    } else {
      loadThreads();
    }
    return;
  }

  if (!event.taskId) return;
  // Find task in cache and patch it
  const idx = _data.tasks.findIndex(t => t.id === event.taskId);
  if (idx < 0) {
    // Unknown task — reload tasks list
    loadTasks().then(() => { if (_currentTab === 'tasks') renderTasks(); });
    return;
  }
  const task = _data.tasks[idx];
  if (event.step)     task.currentStep   = event.step;
  if (event.partial)  task.partialOutput = event.partial;
  if (event.status)   task.status        = event.status;
  if (event.timeline) task.timeline      = event.timeline;
  task.lastActivity = event.timestamp;
  if (event.type === 'task:done' || event.type === 'task:error') {
    // Full refresh so result/error fields are hydrated
    loadTasks().then(() => {
      if (_currentTab === 'tasks') renderTasks();
      if (_liveTaskId === event.taskId) openTaskDrawer(event.taskId);
    });
    return;
  }
  if (_currentTab === 'tasks') renderTasks();
  // Live-update drawer if open on this task
  if (_liveTaskId === event.taskId && document.getElementById('drawer').classList.contains('open')) {
    openTaskDrawer(event.taskId);
  }
}

// ── Deep-link: #task:TASKID ───────────────────────────────────────────────────

function _handleDeepLink() {
  const hash = location.hash;
  if (!hash.startsWith('#task:')) return;
  const id = decodeURIComponent(hash.slice(6));
  history.replaceState(null, '', location.pathname);
  switchTab('tasks');
  // Task data may not be loaded yet — poll briefly
  let attempts = 0;
  const check = () => {
    const task = _data.tasks.find(t => t.id === id);
    if (task) { openTaskDrawer(id); return; }
    if (++attempts < 10) setTimeout(check, 500);
  };
  check();
}

// ── Navigation ───────────────────────────────────────────────────────────────

function switchTab(tab) {
  _currentTab = tab;
  const tabs = ['overview','inbox','actions','recipes','missions','tasks','history','workspace'];
  tabs.forEach(t => {
    document.getElementById('tab-'+t).style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById('nav-'+t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  renderCurrent();
}

function setSpinner(on) { document.getElementById('hdr-spinner').style.display = on ? 'inline-block' : 'none'; }
function doRefresh() { loadAll(); }

// ── Load ─────────────────────────────────────────────────────────────────────

async function loadAll() {
  setSpinner(true);
  await Promise.all([loadOverview(), loadActions(), loadRecipes(), loadMissions(), loadHistory(), loadTasks(), loadThreads(), loadWorkspaceData()]);
  setSpinner(false);
  renderCurrent();
}

async function loadOverview() {
  const r = await api('GET', '/dispatch/ops/overview');
  if (r.ok) _data.overview = r.data;
}
async function loadActions() {
  const r = await api('GET', '/dispatch/actions');
  if (r.ok) _data.actions = r.data.items ?? [];
  updateActionBadge();
}
async function loadRecipes() {
  const r = await api('GET', '/dispatch/recipes');
  if (r.ok) _data.recipes = r.data.items ?? [];
}
async function loadMissions() {
  const r = await api('GET', '/dispatch/missions');
  if (r.ok) _data.missions = r.data.items ?? [];
}
async function loadHistory() {
  const r = await api('GET', '/dispatch/history');
  if (r.ok) _data.history = r.data.items ?? [];
}
async function loadTasks() {
  const r = await api('GET', '/dispatch/tasks');
  if (r.ok) _data.tasks = r.data.items ?? [];
}
async function loadThreads() {
  const r = await api('GET', '/dispatch/threads');
  if (r.ok) {
    _data.threads = r.data.items ?? [];
    updateInboxBadge();
  }
}
async function loadWorkspaceData() {
  const r = await api('GET', '/dispatch/workspace');
  if (r.ok) _data.workspace = r.data;
  else _data.workspace = null;
}

function updateActionBadge() {
  const badge = document.getElementById('action-badge');
  const count = _data.actions.length;
  badge.textContent = String(count);
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function updateInboxBadge() {
  const badge = document.getElementById('inbox-badge');
  const count = _data.threads.filter(t => t.status === 'active' || t.status === 'waiting').length;
  badge.textContent = String(count);
  badge.style.display = count > 0 ? 'flex' : 'none';
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderCurrent() {
  if (_currentTab === 'overview')   renderOverview();
  if (_currentTab === 'inbox')      renderInbox();
  if (_currentTab === 'actions')    renderActions();
  if (_currentTab === 'recipes')    renderRecipes();
  if (_currentTab === 'history')    renderHistory();
  if (_currentTab === 'missions')   renderMissions();
  if (_currentTab === 'tasks')      renderTasks();
  if (_currentTab === 'workspace')  renderWorkspace();
}

// ── Inbox / Thread UI ────────────────────────────────────────────────────────

function renderInbox() {
  const el = document.getElementById('tab-inbox');
  if (!_data.threads.length) {
    el.innerHTML = '<div class="empty">No threads yet. Create a remote task to start a conversation.</div>';
    return;
  }
  const sorted = [..._data.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  el.innerHTML = sorted.map(t => {
    const lastMsg = t.messages[t.messages.length - 1];
    const preview = lastMsg ? esc(lastMsg.text.slice(0, 90)) : '';
    const pending = t.taskIds ? t.taskIds.length : 0;
    const statusCls = t.status === 'active' ? 'running' : t.status === 'done' ? 'ok' : t.status === 'failed' ? 'error' : 'warn';
    const ago = _relTime(t.updatedAt);
    return \`
    <div class="thread-card card" onclick="openThread('\${esc(t.id)}')">
      <div class="card-row">
        <span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${esc(t.title)}</span>
        <span class="badge \${statusCls}" style="flex-shrink:0;">\${t.status.toUpperCase()}</span>
      </div>
      <div class="thread-meta">
        \${t.deviceLabel ? \`<span class="muted-pill">\${esc(t.deviceLabel)}</span>\` : ''}
        \${pending > 1 ? \`<span class="muted-pill">\${pending} tasks</span>\` : ''}
        <span class="muted-pill">\${ago}</span>
      </div>
      \${preview ? \`<div style="font-size:13px;color:var(--muted);margin-top:5px;">\${preview}</div>\` : ''}
    </div>\`;
  }).join('');
}

async function openThread(id) {
  _openThreadId = id;
  const overlay = document.getElementById('thread-overlay');
  overlay.classList.add('open');
  document.getElementById('thr-title').textContent = 'Loading…';
  document.getElementById('thr-messages').innerHTML = '<div class="empty">Loading…</div>';

  // Try cache first, then fetch
  let thread = _threadCache[id];
  if (!thread) {
    const r = await api('GET', '/dispatch/thread/' + encodeURIComponent(id));
    if (!r.ok) {
      document.getElementById('thr-messages').innerHTML = '<div class="empty">Failed to load thread.</div>';
      return;
    }
    thread = r.data;
    _threadCache[id] = thread;
  }
  _renderThread(thread);
}

function closeThread() {
  _openThreadId = null;
  document.getElementById('thread-overlay').classList.remove('open');
}

function _renderThread(thread) {
  document.getElementById('thr-title').textContent = thread.title || 'Thread';
  const statusCls = thread.status === 'active' ? 'running' : thread.status === 'done' ? 'ok' : thread.status === 'failed' ? 'error' : 'warn';
  document.getElementById('thr-status').className = 'badge ' + statusCls;
  document.getElementById('thr-status').textContent = thread.status.toUpperCase();
  document.getElementById('thr-messages').innerHTML = _renderThreadMessages(thread.messages);
  // Scroll to bottom
  const msgs = document.getElementById('thr-messages');
  msgs.scrollTop = msgs.scrollHeight;
  // Show/hide composer based on status
  const composer = document.getElementById('thr-composer');
  composer.style.display = thread.status === 'done' || thread.status === 'failed' ? 'none' : 'flex';
  // Phase 26: collaborator strip, comments, attributions
  _computeMyRole(thread);
  _renderCollabStrip(thread);
  _renderCommentsSection(thread);
  _renderAttrPanel(thread);
}

// ── Phase 26 — Collaboration UI ──────────────────────────────────────────────

function _computeMyRole(thread) {
  if (!thread) { _openThreadRole = null; return; }
  if (thread.owner && _myDeviceId && thread.owner === _myDeviceId) { _openThreadRole = 'owner'; return; }
  const collab = (thread.collaborators || []).find(c => c.deviceId === _myDeviceId);
  _openThreadRole = collab ? collab.role : null;
}

function _renderCollabStrip(thread) {
  const strip = document.getElementById('thr-collab-strip');
  const invBtn = document.getElementById('thr-invite-btn');
  const collabs = thread.collaborators || [];
  const hasCollabs = collabs.length > 0 || thread.owner;
  strip.style.display = hasCollabs ? 'flex' : 'none';
  // Show invite button if owner or operator
  const canInvite = _openThreadRole === 'owner' || _openThreadRole === 'operator';
  invBtn.style.display = canInvite ? 'inline-flex' : 'none';
  // Build pills
  let html = '';
  if (thread.owner) {
    const isMe = thread.owner === _myDeviceId;
    html += \`<span class="collab-pill collab-role-owner">\${esc(thread.deviceLabel || thread.owner.slice(0, 6))} (owner)\${isMe ? ' ·you' : ''}</span>\`;
  }
  collabs.forEach(c => {
    const isMe = c.deviceId === _myDeviceId;
    html += \`<span class="collab-pill collab-role-\${c.role}">\${esc(c.deviceLabel || c.deviceId.slice(0,6))} (\${c.role})\${isMe?' ·you':''}</span>\`;
  });
  strip.innerHTML = html;
}

function _renderCommentsSection(thread) {
  const el = document.getElementById('thr-comments-section');
  const comments = thread.comments || [];
  const canComment = _openThreadRole && _openThreadRole !== 'viewer';
  if (!comments.length && !canComment) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const rows = comments.map(c => {
    const canDel = c.authorId === _myDeviceId || _openThreadRole === 'owner';
    const ts = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return \`<div class="comment-row">
      <span class="comment-author">\${esc(c.authorLabel || c.authorId.slice(0,8))} · \${ts}</span>
      <div class="comment-text">\${esc(c.text)}</div>
      \${canDel ? \`<button class="comment-del" onclick="deleteComment('\${esc(thread.id)}','\${esc(c.id)}')">✕ delete</button>\` : ''}
    </div>\`;
  }).join('');
  const inputRow = canComment ? \`
    <div class="comment-input-row">
      <input id="comment-input-\${esc(thread.id)}" class="comment-input" placeholder="Add comment…"
        onkeydown="if(event.key==='Enter'){event.preventDefault();submitComment('\${esc(thread.id)}');}">
      <button class="btn-primary" style="padding:8px 12px;font-size:12px;" onclick="submitComment('\${esc(thread.id)}')">Post</button>
    </div>\` : '';
  el.innerHTML = \`
    <div class="comments-section">
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
        Comments (\${comments.length})
      </div>
      \${rows || '<div style="font-size:12px;color:var(--muted);">No comments yet.</div>'}
      \${inputRow}
      <div id="comment-err-\${esc(thread.id)}" style="color:#f87171;font-size:12px;min-height:14px;margin-top:4px;"></div>
    </div>\`;
}

async function submitComment(threadId) {
  const input = document.getElementById('comment-input-' + threadId);
  const errEl = document.getElementById('comment-err-' + threadId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  const r = await api('POST', '/dispatch/thread/' + encodeURIComponent(threadId) + '/comment', {
    text, targetType: 'thread', targetId: threadId,
  });
  input.disabled = false;
  if (r.ok) {
    input.value = '';
    if (_threadCache[threadId]) {
      if (!_threadCache[threadId].comments) _threadCache[threadId].comments = [];
      _threadCache[threadId].comments.push(r.data);
      _renderCommentsSection(_threadCache[threadId]);
    }
  } else {
    if (errEl) errEl.textContent = r.data?.error || 'Failed to post';
  }
}

async function deleteComment(threadId, commentId) {
  const r = await api('DELETE', '/dispatch/thread/' + encodeURIComponent(threadId) + '/comment/' + encodeURIComponent(commentId));
  if (r.ok && _threadCache[threadId]) {
    _threadCache[threadId].comments = (_threadCache[threadId].comments || []).filter(c => c.id !== commentId);
    _renderCommentsSection(_threadCache[threadId]);
  } else if (!r.ok) {
    toast(r.data?.error || 'Delete failed');
  }
}

function _renderAttrPanel(thread) {
  const el = document.getElementById('thr-attr-panel');
  const items = thread.attributions || [];
  if (!items.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const rows = items.slice(-20).reverse().map(a => {
    const ts = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cls = a.action === 'approve' ? 'attr-approve' : a.action === 'dismiss' ? 'attr-dismiss' : a.action === 'send' ? 'attr-send' : 'attr-comment';
    return \`<div class="attr-row">
      <span class="attr-action \${cls}">\${a.action.toUpperCase()}</span>
      <div style="flex:1;">
        <span style="font-weight:500;">\${esc(a.actorLabel || a.actorId.slice(0,8))}</span>
        <span style="color:var(--muted);"> · \${ts}</span>
        \${a.note ? \`<div style="color:var(--muted);margin-top:2px;">\${esc(a.note)}</div>\` : ''}
      </div>
      <span style="color:\${a.outcome==='ok'?'#34d399':a.outcome==='denied'?'#f87171':'var(--muted)'};">\${a.outcome}</span>
    </div>\`;
  }).join('');
  el.innerHTML = \`
    <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding-top:8px;">
      Approval History (\${items.length})
    </div>
    \${rows}\`;
}

// ── Phase 26 — Invite flow ────────────────────────────────────────────────────

function openInviteModal() {
  _inviteTargetThreadId = _openThreadId;
  document.getElementById('invite-result').style.display = 'none';
  document.getElementById('invite-gen-error').textContent = '';
  document.getElementById('invite-modal').style.display = 'flex';
}
function closeInviteModal() {
  document.getElementById('invite-modal').style.display = 'none';
  _inviteTargetThreadId = null;
}
async function generateInvite() {
  if (!_inviteTargetThreadId) return;
  const role    = document.getElementById('invite-role').value;
  const errEl   = document.getElementById('invite-gen-error');
  errEl.textContent = '';
  const r = await api('POST', '/dispatch/thread/' + encodeURIComponent(_inviteTargetThreadId) + '/invite', { role });
  if (r.ok) {
    const code = r.data.invite.code;
    document.getElementById('invite-code-val').textContent = code;
    const url = location.origin + '/dispatch/invite-page?code=' + encodeURIComponent(code);
    document.getElementById('invite-code-url').textContent = url;
    document.getElementById('invite-result').style.display = 'block';
  } else {
    errEl.textContent = r.data?.error || 'Failed to generate invite';
  }
}
function copyInviteCode() {
  const code = document.getElementById('invite-code-val').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => toast('Code copied'));
  } else {
    toast(code);
  }
}

function _renderThreadMessages(messages) {
  if (!messages || !messages.length) return '<div class="empty">No messages yet.</div>';
  return messages.map(m => {
    const ts = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const taskLink = m.taskId ? \`<div style="margin-top:4px;font-size:11px;color:var(--muted);">Task: <a href="#" onclick="event.preventDefault();closeThread();switchTab('tasks');openTaskDrawer('\${esc(m.taskId)}')" style="color:var(--accent);">view</a></div>\` : '';
    const artifactLink = m.artifactId ? \`<div style="margin-top:4px;font-size:11px;color:var(--muted);">Artifact attached</div>\` : '';
    return \`
    <div class="msg-row \${m.role}">
      <div class="msg-bubble">
        <div>\${esc(m.text)}</div>
        \${taskLink}\${artifactLink}
        <div style="font-size:10px;color:var(--muted);margin-top:4px;text-align:\${m.role==='user'?'right':'left'}">\${ts}</div>
      </div>
    </div>\`;
  }).join('');
}

async function sendFollowUp(threadId) {
  const input = document.getElementById('thr-input');
  const errEl = document.getElementById('thr-error');
  const text = input.value.trim();
  if (!text) return;
  errEl.textContent = '';
  input.disabled = true;

  const r = await api('POST', '/dispatch/thread/' + encodeURIComponent(threadId) + '/message', {
    text,
    category: 'informational',
  });
  input.disabled = false;
  if (r.ok) {
    input.value = '';
    // Update cache and re-render
    const updated = await api('GET', '/dispatch/thread/' + encodeURIComponent(threadId));
    if (updated.ok) {
      _threadCache[threadId] = updated.data;
      _renderThread(updated.data);
      // Also update summary list
      const idx = _data.threads.findIndex(t => t.id === threadId);
      if (idx >= 0) _data.threads[idx] = updated.data;
      else _data.threads.unshift(updated.data);
      updateInboxBadge();
    }
  } else {
    errEl.textContent = r.data?.error || 'Send failed';
  }
}

function _relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

// ── Overview ─────────────────────────────────────────────────────────────────

function renderOverview() {
  const el = document.getElementById('tab-overview');
  const o = _data.overview;
  if (!o) { el.innerHTML = '<div class="empty">Loading…</div>'; return; }
  el.innerHTML = \`
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-val">\${o.actionsTotal}</div><div class="stat-label">Pending</div></div>
      <div class="stat-card"><div class="stat-val">\${o.approvedToday}</div><div class="stat-label">Approved Today</div></div>
      <div class="stat-card"><div class="stat-val">\${o.blockedToday}</div><div class="stat-label">Blocked Today</div></div>
      <div class="stat-card"><div class="stat-val">\${o.failedRecipes}</div><div class="stat-label">Recipe Failures</div></div>
    </div>
    \${o.unhealthyServices > 0 ? \`<div class="warn-banner"><div class="wb-title">\${o.unhealthyServices} Unhealthy Service\${o.unhealthyServices>1?'s':''}</div><div class="wb-sub">Check service health in desktop app</div></div>\` : ''}
    <div class="card" onclick="switchTab('actions')">
      <div class="card-row">
        <span style="font-weight:600;">Action Queue</span>
        \${_data.actions.length > 0 ? \`<span class="badge \${_data.actions[0]?.severity||'low'}">\${_data.actions.length} pending</span>\` : '<span class="badge ok-pill">Clear</span>'}
        <span class="card-chevron">›</span>
      </div>
    </div>
    <div class="card" onclick="switchTab('recipes')">
      <div class="card-row"><span style="font-weight:600;">Recipes</span><span class="card-chevron">›</span></div>
    </div>
    <div class="card" onclick="switchTab('missions')">
      <div class="card-row"><span style="font-weight:600;">Missions</span><span class="card-chevron">›</span></div>
    </div>
    <div class="card" onclick="switchTab('tasks')">
      <div class="card-row">
        <span style="font-weight:600;">Remote Tasks</span>
        \${_data.tasks.filter(t=>t.status==='running'||t.status==='queued').length > 0 ? \`<span class="badge warn">\${_data.tasks.filter(t=>t.status==='running'||t.status==='queued').length} active</span>\` : '<span class="badge ok-pill">Idle</span>'}
        <span class="card-chevron">›</span>
      </div>
    </div>
  \`;
}

function renderActions() {
  const el = document.getElementById('tab-actions');
  if (!_data.actions.length) { el.innerHTML = '<div class="empty">No pending actions</div>'; return; }
  el.innerHTML = _data.actions.map(item => \`
    <div class="card\${item.needsDesktopConfirm ? ' needs-confirm' : ''}" onclick="openActionDrawer('\${esc(item.id)}')">
      <div class="card-row">
        <span class="badge \${item.severity}">\${item.severity.toUpperCase()}</span>
        \${item.needsDesktopConfirm ? '<span class="badge warn" style="font-size:10px;">DESKTOP CONFIRM</span>' : ''}
        <span class="card-chevron">›</span>
      </div>
      <div class="card-title">\${esc(item.label)}</div>
      <div class="card-sub">\${esc(item.source)} · \${fmtAge(item.age)}</div>
      \${item.detail ? \`<div class="card-detail-preview">\${esc(item.detail)}</div>\` : ''}
    </div>
  \`).join('');
}

function renderRecipes() {
  const el = document.getElementById('tab-recipes');
  if (!_data.recipes.length) { el.innerHTML = '<div class="empty">No recipes configured</div>'; return; }
  el.innerHTML = _data.recipes.map(r => \`
    <div class="recipe-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div class="card-title">\${esc(r.name)}</div>
          <div class="card-sub" style="margin-top:3px;">\${esc(r.trigger)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span class="badge \${r.enabled?'ok-pill':'muted'}">\${r.enabled?'Enabled':'Disabled'}</span>
            \${r.lastRunAt ? \`<span class="card-sub">Last: \${fmtTime(r.lastRunAt)}</span>\` : ''}
            \${r.lastRunStatus ? \`<span class="badge \${r.lastRunStatus==='success'?'ok-pill':'danger'}">\${r.lastRunStatus}</span>\` : ''}
          </div>
        </div>
        \${_allowApprove ? \`<button class="btn sm" onclick="runRecipe('\${esc(r.id)}')" \${!r.enabled?'disabled':''}>Run</button>\` : ''}
      </div>
    </div>
  \`).join('');
}

function renderMissions() {
  const el = document.getElementById('tab-missions');
  if (!_data.missions.length) { el.innerHTML = '<div class="empty">No missions configured</div>'; return; }
  el.innerHTML = _data.missions.map(m => \`
    <div class="recipe-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div class="card-title">\${esc(m.name)}</div>
          <div class="card-sub" style="margin-top:3px;">\${esc(m.category)}\${m.schedule?' · '+esc(m.schedule):''}</div>
          <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span class="badge \${m.enabled?'ok-pill':'muted'}">\${m.enabled?'Active':'Disabled'}</span>
            \${m.lastRunAt ? \`<span class="card-sub">Last: \${fmtTime(m.lastRunAt)}</span>\` : ''}
          </div>
        </div>
        \${_allowApprove ? \`<button class="btn sm" onclick="runMission('\${esc(m.id)}')" \${!m.enabled?'disabled':''}>Run</button>\` : ''}
      </div>
    </div>
  \`).join('');
}

function renderHistory() {
  const el = document.getElementById('tab-history');
  if (!_data.history.length) { el.innerHTML = '<div class="empty">No remote activity in the last 48 hours</div>'; return; }
  el.innerHTML = _data.history.map(h => \`
    <div class="history-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <span class="history-verb \${esc(h.verb)}">\${esc(h.verb.toUpperCase())}</span>
        <span class="card-sub">\${fmtTime(h.timestamp)}</span>
        \${h.deviceLabel ? \`<span class="card-sub">· \${esc(h.deviceLabel)}</span>\` : ''}
        \${h.isAdmin ? '<span class="badge muted" style="font-size:10px;">ADMIN</span>' : ''}
      </div>
      <div style="font-size:13px;font-weight:500;word-break:break-word;">\${esc(h.label)}</div>
      \${h.clientIp ? \`<div class="card-sub" style="margin-top:3px;">\${esc(h.clientIp)}</div>\` : ''}
    </div>
  \`).join('');
}

// ── Workspace tab ─────────────────────────────────────────────────────────────

const WS_ROLE_LABEL = { owner:'Owner', admin:'Admin', operator:'Operator', reviewer:'Reviewer', viewer:'Viewer' };
const WS_ROLE_CLS   = { owner:'collab-role-owner', admin:'collab-role-operator', operator:'collab-role-reviewer', reviewer:'collab-role-reviewer', viewer:'collab-role-viewer' };

let _wsJoinCode = '';
let _wsJoinErr  = '';

async function joinWorkspace() {
  const code = _wsJoinCode.trim().toUpperCase();
  if (!code) return;
  const r = await api('POST', '/dispatch/workspace/join', { code });
  if (r.ok) {
    _data.workspace = r.data.workspace;
    _wsJoinCode = '';
    _wsJoinErr  = '';
    renderWorkspace();
    toast('Joined workspace');
  } else {
    _wsJoinErr = r.data?.error || 'Invalid or expired code';
    renderWorkspace();
  }
}

function renderWorkspace() {
  const el = document.getElementById('tab-workspace');
  const ws = _data.workspace;

  if (!ws) {
    el.innerHTML = \`
      <div class="section-header">Workspace</div>
      <div class="empty" style="margin-bottom:16px;">You are not a member of any workspace yet.<br>Ask your team admin for an invite code.</div>
      <div class="card">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Join a workspace</div>
        <input id="ws-join-input" type="text" class="input-field" placeholder="8-character invite code"
          value="\${esc(_wsJoinCode)}"
          oninput="_wsJoinCode = this.value"
          style="text-transform:uppercase;letter-spacing:2px;font-family:monospace;font-size:16px;text-align:center;">
        \${_wsJoinErr ? \`<div style="color:var(--danger);font-size:12px;margin-top:6px;">\${esc(_wsJoinErr)}</div>\` : ''}
        <button class="btn primary" style="width:100%;margin-top:10px;" onclick="joinWorkspace()">Join Workspace</button>
      </div>
    \`;
    return;
  }

  const myRole = _computeMyWorkspaceRole(ws);
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const members = ws.members ?? [];
  const policy  = ws.policy ?? {};

  const memberRows = members.map(m => \`
    <div class="collab-item">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${esc(m.deviceLabel || m.deviceId)}</div>
        <div class="card-sub">\${m.deviceId === ws.ownerId ? 'Workspace owner' : 'Member'} · joined \${_relTime(m.joinedAt)}</div>
      </div>
      <span class="collab-pill \${WS_ROLE_CLS[m.role] || ''}">\${WS_ROLE_LABEL[m.role] || m.role}</span>
    </div>
  \`).join('');

  const policySection = isAdmin ? '' : \`
    <div class="section-header" style="margin-top:16px;">Policy</div>
    <div class="card">
      <div class="card-sub">Min approval role: <b>\${esc(policy.minApproveRole ?? '—')}</b></div>
      <div class="card-sub">Min recipe role: <b>\${esc(policy.minRecipeRole ?? '—')}</b></div>
      <div class="card-sub">Min admin role: <b>\${esc(policy.minDispatchAdminRole ?? '—')}</b></div>
      \${policy.requireDesktopConfirmForWrite ? '<div class="card-sub" style="color:var(--warn);">Desktop confirm required for writes</div>' : ''}
    </div>
  \`;

  el.innerHTML = \`
    <div class="section-header">Workspace</div>
    <div class="card" style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;">\${esc(ws.name)}</div>
      <div class="card-sub">
        \${myRole ? \`Your role: <span class="collab-pill \${WS_ROLE_CLS[myRole] || ''}" style="display:inline-flex;margin-left:4px;">\${WS_ROLE_LABEL[myRole] || myRole}</span>\` : 'No role assigned'}
      </div>
      <div class="card-sub" style="margin-top:3px;">\${members.length} member\${members.length !== 1 ? 's' : ''}</div>
    </div>

    <div class="section-header">Members</div>
    <div class="card" style="padding:0;">
      \${memberRows || '<div style="padding:12px 16px;" class="card-sub">No members yet.</div>'}
    </div>

    \${policySection}
  \`;
}

function _computeMyWorkspaceRole(ws) {
  if (!ws || !_myDeviceId) return null;
  if (ws.ownerId === _myDeviceId) return 'owner';
  const member = (ws.members ?? []).find(m => m.deviceId === _myDeviceId);
  return member ? member.role : null;
}

// ── Tasks tab ─────────────────────────────────────────────────────────────────

function taskStatusCls(status) {
  return { queued:'warn', running:'warn', waiting_approval:'warn', done:'ok-pill', error:'danger' }[status] || 'muted';
}
function taskStatusLabel(status) {
  return { queued:'QUEUED', running:'RUNNING', waiting_approval:'AWAITING OK', done:'DONE', error:'ERROR' }[status] || status.toUpperCase();
}

let _taskPollTimer = null;

function renderTasks() {
  const el = document.getElementById('tab-tasks');
  const activeTasks = _data.tasks.filter(t => t.status === 'queued' || t.status === 'running' || t.status === 'waiting_approval');
  if (_taskPollTimer) { clearInterval(_taskPollTimer); _taskPollTimer = null; }
  if (activeTasks.length > 0) {
    _taskPollTimer = setInterval(async () => { await loadTasks(); renderCurrent(); }, 4000);
  }
  el.innerHTML = \`
    <div class="card" style="margin-bottom:10px;">
      <div class="card-title" style="margin-bottom:8px;">New Remote Task</div>
      <textarea id="task-goal" placeholder="Describe the task…" rows="3"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;font-size:14px;resize:vertical;font-family:inherit;outline:none;"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
        <select id="task-cat" style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 10px;font-size:14px;">
          <option value="informational">Informational</option>
          <option value="recipe">Run Recipe</option>
          <option value="mission">Run Mission</option>
          <option value="write">Write action</option>
        </select>
        <input id="task-target" placeholder="Context target (optional)" type="text"
          style="flex:2;min-width:140px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 10px;font-size:14px;" />
      </div>
      <button class="btn" style="margin-top:8px;width:100%;" onclick="submitTask()">Launch Task</button>
      <div id="task-err" style="color:var(--danger);font-size:13px;margin-top:6px;min-height:18px;"></div>
    </div>
    \${!_data.tasks.length ? '<div class="empty">No tasks yet</div>' : _data.tasks.map(t => \`
      <div class="history-card" onclick="openTaskDrawer('\${esc(t.id)}')">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
          <span class="badge \${taskStatusCls(t.status)}">\${taskStatusLabel(t.status)}</span>
          <span class="card-sub">\${fmtTime(t.createdAt)}</span>
          \${t.deviceLabel ? \`<span class="card-sub">· \${esc(t.deviceLabel)}</span>\` : ''}
          <span class="badge muted" style="font-size:10px;">\${esc(t.category)}</span>
        </div>
        <div style="font-size:13px;font-weight:500;word-break:break-word;">\${esc(t.goal.length>100?t.goal.slice(0,100)+'…':t.goal)}</div>
        \${t.currentStep && (t.status==='running'||t.status==='queued') ? \`<div class="card-sub" style="color:var(--warn);margin-top:3px;">↳ \${esc(t.currentStep)}</div>\` : ''}
        \${t.error ? \`<div class="card-sub" style="color:var(--danger);margin-top:3px;">\${esc(t.error)}</div>\` : ''}
        \${t.result && t.status==='done' ? \`<div class="card-sub" style="margin-top:3px;">\${esc(t.result.slice(0,120))}\${t.result.length>120?'…':''}</div>\` : ''}
      </div>
    \`).join('')}
  \`;
}

async function submitTask() {
  const goal    = (document.getElementById('task-goal').value || '').trim();
  const category = document.getElementById('task-cat').value;
  const target   = (document.getElementById('task-target').value || '').trim();
  const errEl    = document.getElementById('task-err');
  errEl.textContent = '';
  if (!goal) { errEl.textContent = 'Please describe the task'; return; }
  const btn = document.querySelector('#tab-tasks .btn');
  btn.disabled = true;
  btn.textContent = 'Launching…';
  const payload = { goal, category };
  if (target) payload.target = target;
  const r = await api('POST', '/dispatch/task', payload);
  btn.disabled = false;
  btn.textContent = 'Launch Task';
  if (r.ok) {
    document.getElementById('task-goal').value = '';
    document.getElementById('task-target').value = '';
    await loadTasks();
    renderCurrent();
  } else {
    errEl.textContent = r.data?.error || 'Task creation failed';
  }
}

let _liveTaskId = null;   // ID of task currently open in drawer (for SSE updates)

function _renderTimeline(tl) {
  if (!tl || !tl.length) return '';
  return \`<div class="section-head">Timeline</div>
  <div class="timeline">
    \${tl.map(s => {
      const cls = s.done === true ? 'tl-ok' : s.done === false ? 'tl-err' : 'tl-run';
      return \`<div class="tl-step \${cls}">
        <div class="tl-dot"></div>
        <div class="tl-body">
          <div class="tl-label">\${esc(s.label)}</div>
          <div class="tl-time">\${fmtTime(s.ts)}</div>
        </div>
      </div>\`;
    }).join('')}
  </div>\`;
}

function openTaskDrawer(id) {
  const task = _data.tasks.find(t => t.id === id);
  if (!task) return;
  _liveTaskId = id;
  const scroll    = document.getElementById('drawer-scroll');
  const actionsEl = document.getElementById('drawer-actions');
  scroll.innerHTML = \`
    <div class="drawer-title">\${esc(task.goal)}</div>
    <div class="drawer-meta">
      <span class="badge \${taskStatusCls(task.status)}">\${taskStatusLabel(task.status)}</span>
      <span class="badge muted">\${esc(task.category)}</span>
      \${(task.status==='running'||task.status==='queued'||task.status==='waiting_approval') ? '<span class="card-sub" style="font-size:11px;">Live</span>' : ''}
    </div>
    \${task.result ? \`<div class="section-head">Result</div><div style="font-size:14px;white-space:pre-wrap;word-break:break-word;">\${esc(task.result)}</div>\` : ''}
    \${task.error  ? \`<div class="section-head">Error</div><div style="font-size:13px;color:var(--danger);">\${esc(task.error)}</div>\` : ''}
    \${task.partialOutput && !task.result ? \`<div class="section-head">Partial Output</div><div class="partial-out">\${esc(task.partialOutput)}</div>\` : ''}
    \${_renderTimeline(task.timeline)}
    \${(task.ctx?.repo || task.ctx?.project || task.ctx?.channel || task.ctx?.target) ? \`
      <div class="section-head">Context</div>
      \${task.ctx.repo    ? \`<div class="ctx-row"><span class="ctx-key">Repo</span>\${esc(task.ctx.repo)}</div>\` : ''}
      \${task.ctx.project ? \`<div class="ctx-row"><span class="ctx-key">Project</span>\${esc(task.ctx.project)}</div>\` : ''}
      \${task.ctx.channel ? \`<div class="ctx-row"><span class="ctx-key">Channel</span>\${esc(task.ctx.channel)}</div>\` : ''}
      \${task.ctx.target  ? \`<div class="ctx-row"><span class="ctx-key">Target</span>\${esc(task.ctx.target)}</div>\` : ''}
    \` : ''}
    <div class="section-head">Metadata</div>
    <div class="ctx-row"><span class="ctx-key">Created</span>\${fmtTime(task.createdAt)}</div>
    <div class="ctx-row"><span class="ctx-key">Updated</span>\${fmtTime(task.updatedAt)}</div>
    \${task.deviceLabel ? \`<div class="ctx-row"><span class="ctx-key">From</span>\${esc(task.deviceLabel)}</div>\` : ''}
  \`;
  actionsEl.innerHTML = '';
  document.getElementById('drawer').classList.add('open');

  // Phase 24 — asynchronously load and inject bundle + artifact cards
  const hasBundles   = !!(task.bundleIds?.length);
  const hasArtifacts = !!(task.artifactIds?.length);
  if (hasBundles || hasArtifacts) {
    Promise.all([
      hasBundles   ? loadTaskBundles(task.id)   : Promise.resolve([]),
      hasArtifacts ? loadTaskArtifacts(task.id) : Promise.resolve([]),
    ]).then(([bundles, arts]) => {
      const scrollEl = document.getElementById('drawer-scroll');
      if (!scrollEl) return;
      let extra = '';
      if (bundles.length) {
        extra += \`<div class="section-head">Bundle</div>\${bundles.map(_renderBundleCard).join('')}\`;
      }
      if (arts.length) {
        extra += _renderArtifactCards(task.id, arts);
      }
      if (extra) scrollEl.innerHTML += extra;
    });
  }
}

// ── Action detail drawer ──────────────────────────────────────────────────────

function mdToHtml(text) {
  // Render **bold** in rationale strings (content is already esc'd)
  return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function openActionDrawer(id) {
  const item = _data.actions.find(a => a.id === id);
  if (!item) return;
  _drawerItem = item;
  const scroll  = document.getElementById('drawer-scroll');
  const actionsEl = document.getElementById('drawer-actions');
  const isHighRisk   = item.severity === 'high' || item.severity === 'critical';
  const isDestructive = !!item.isDestructive;
  const needsAck = isDestructive && item.canApprove && _allowApprove;

  scroll.innerHTML = \`
    <div class="drawer-title">\${esc(item.label)}</div>
    <div class="drawer-meta">
      <span class="badge \${item.severity}">\${item.severity.toUpperCase()}</span>
      \${isDestructive ? '<span class="badge danger" style="font-size:10px;">DESTRUCTIVE</span>' : ''}
      \${item.needsDesktopConfirm ? '<span class="badge warn" style="font-size:10px;">DESKTOP CONFIRM</span>' : ''}
    </div>

    \${item.rationale ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Why action required</div>
      <div class="drawer-section-val">\${mdToHtml(esc(item.rationale))}</div>
    </div>\` : ''}

    \${item.willTouch?.length ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Systems affected if approved</div>
      <div class="chip-row">\${item.willTouch.map(s => \`<span class="badge muted">\${esc(s)}</span>\`).join('')}</div>
    </div>\` : ''}

    \${item.triggeredBy ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Triggered by</div>
      <div class="drawer-section-val">\${esc(item.triggeredBy)}</div>
    </div>\` : ''}

    \${item.policyRule ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Policy in force</div>
      <div class="drawer-section-val">\${esc(item.policyRule)}</div>
    </div>\` : ''}

    \${item.affectedTarget ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Affected target</div>
      <div class="drawer-section-val">\${esc(item.affectedTarget)}</div>
    </div>\` : ''}

    \${item.relatedProject ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Project</div>
      <div class="drawer-section-val">\${esc(item.relatedProject)}</div>
    </div>\` : ''}

    \${item.contextNotes ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Context notes</div>
      <div class="drawer-section-val" style="color:var(--muted);font-size:13px;">\${esc(item.contextNotes)}</div>
    </div>\` : ''}

    \${item.detail ? \`
    <div class="drawer-section">
      <div class="drawer-section-label">Raw detail</div>
      <div class="drawer-section-val" style="white-space:pre-wrap;">\${esc(item.detail)}</div>
    </div>\` : ''}

    <div class="drawer-section">
      <div class="drawer-section-label">Source · Age</div>
      <div class="drawer-section-val">\${esc(item.source)} · \${fmtAge(item.age)}</div>
    </div>

    \${needsAck ? \`
    <div class="destructive-warn">
      <div class="dw-title">Destructive action</div>
      <div class="dw-body">This action is difficult or impossible to reverse. Read every detail above before approving.</div>
      <label class="dw-check">
        <input type="checkbox" id="destr-ack-\${esc(id)}" onchange="updateApproveEnabled('\${esc(id)}')">
        <span>I have reviewed all details and understand the risk</span>
      </label>
    </div>\` : ''}
  \`;

  if (!_allowApprove) {
    actionsEl.innerHTML = '<div class="view-only-note">View-only — remote actions disabled</div>';
  } else {
    const approveBtn = item.canApprove ? buildApproveBtn(item, isHighRisk, needsAck) : '';
    const retryBtn   = item.canRetry   ? \`<button class="btn warn" onclick="actRetry('\${esc(item.id)}')">Retry</button>\` : '';
    const dismissBtn = item.canDismiss ? \`<button class="btn ghost" onclick="openDenyModal('\${esc(item.id)}')">Dismiss…</button>\` : '';
    actionsEl.innerHTML = \`<div class="btn-row">\${approveBtn}\${retryBtn}\${dismissBtn}</div>\`;
  }

  document.getElementById('drawer').classList.add('open');
}

function buildApproveBtn(item, isHighRisk, startsDisabled) {
  const dis = startsDisabled ? 'disabled' : '';
  if (isHighRisk) {
    return \`
      <div class="hold-wrap" id="hold-wrap-\${esc(item.id)}">
        <button class="btn ok" id="approve-btn-\${esc(item.id)}"
          onpointerdown="startHold('\${esc(item.id)}')"
          onpointerup="cancelHold('\${esc(item.id)}')"
          onpointercancel="cancelHold('\${esc(item.id)}')"
          onpointerleave="cancelHold('\${esc(item.id)}')"
          \${dis}>Hold to Approve</button>
        <svg class="hold-ring" id="hold-ring-\${esc(item.id)}" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46"/>
        </svg>
      </div>\`;
  }
  return \`<button class="btn ok" id="approve-btn-\${esc(item.id)}" onclick="actApprove('\${esc(item.id)}')" \${dis}>Approve</button>\`;
}

function updateApproveEnabled(id) {
  const cb  = document.getElementById(\`destr-ack-\${id}\`);
  const btn = document.getElementById(\`approve-btn-\${id}\`);
  if (btn && cb) btn.disabled = !cb.checked;
}

function startHold(id) {
  cancelHold(id);
  const ring = document.getElementById(\`hold-ring-\${id}\`);
  if (ring) {
    const circle = ring.querySelector('circle');
    // Force reflow to restart animation
    circle.classList.remove('animating');
    void circle.offsetWidth;
    circle.classList.add('animating');
  }
  _holdTimer = setTimeout(() => {
    _holdTimer = null;
    actApprove(id);
  }, 750);
  _holdTarget = id;
}

function cancelHold(id) {
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
  const ring = document.getElementById(\`hold-ring-\${id}\`);
  if (ring) { ring.querySelector('circle').classList.remove('animating'); }
  _holdTarget = null;
}

function handleDrawerBackdrop(e) {
  if (e.target === e.currentTarget || e.target.classList.contains('drawer-backdrop')) closeDrawer();
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  _drawerItem  = null;
  _liveTaskId  = null;
}

// ── Deny modal ───────────────────────────────────────────────────────────────

function openDenyModal(id) {
  _denyTargetId = id;
  document.getElementById('deny-comment').value = '';
  document.getElementById('deny-modal').style.display = 'flex';
}

function closeDenyModal() {
  document.getElementById('deny-modal').style.display = 'none';
  _denyTargetId = null;
}

async function confirmDeny() {
  if (!_denyTargetId) return;
  const comment = document.getElementById('deny-comment').value.trim();
  closeDenyModal();
  closeDrawer();
  await actDismiss(_denyTargetId, comment);
}

// ── Action API calls ──────────────────────────────────────────────────────────

async function actApprove(id) {
  closeDrawer();
  const r = await api('POST', \`/dispatch/action/\${encodeURIComponent(id)}/approve\`);
  if (r.data?.pending) { toast('Awaiting desktop confirmation…'); return; }
  toast(r.ok ? 'Approved' : (r.data?.error || 'Error'));
  if (r.ok) { _data.actions = _data.actions.filter(a => a.id !== id); renderActions(); updateActionBadge(); }
}

async function actDismiss(id, comment) {
  const body = comment ? { comment } : undefined;
  const r = await api('POST', \`/dispatch/action/\${encodeURIComponent(id)}/dismiss\`, body);
  toast(r.ok ? 'Dismissed' : (r.data?.error || 'Error'));
  if (r.ok) { _data.actions = _data.actions.filter(a => a.id !== id); renderActions(); updateActionBadge(); }
}

async function actRetry(id) {
  closeDrawer();
  const r = await api('POST', \`/dispatch/action/\${encodeURIComponent(id)}/retry\`);
  toast(r.ok ? 'Retry triggered' : (r.data?.error || 'Error'));
  if (r.ok) { await loadActions(); renderActions(); }
}

async function runRecipe(id) {
  const r = await api('POST', \`/dispatch/recipe/\${encodeURIComponent(id)}/run\`);
  toast(r.ok ? 'Recipe started' : (r.data?.error || 'Error'));
  if (r.ok) { await loadRecipes(); renderRecipes(); }
}

async function runMission(id) {
  const r = await api('POST', \`/dispatch/mission/\${encodeURIComponent(id)}/run\`);
  toast(r.ok ? 'Mission triggered' : (r.data?.error || 'Error'));
}

// ── Phase 24 — Bundle overlay ─────────────────────────────────────────────────

const DEST_CLS = { slack:'dest-slack', jira:'dest-jira', linear:'dest-linear', github:'dest-github' };
const DEST_LABELS = { slack:'Slack', jira:'Jira', linear:'Linear', github:'GitHub' };
const BUNDLE_STATUS_CLS = { pending:'warn', partial:'warn', sent:'ok-pill', cancelled:'muted' };
const BUNDLE_STATUS_LABEL = { pending:'PENDING', partial:'PARTIAL', sent:'SENT', cancelled:'CANCELLED' };

const _bundleCache = {};   // taskId → bundle[]
let _viewingBundle = null;

async function loadTaskBundles(taskId) {
  if (_bundleCache[taskId]) return _bundleCache[taskId];
  const r = await api('GET', \`/dispatch/task/\${encodeURIComponent(taskId)}/bundles\`);
  _bundleCache[taskId] = r.ok ? (r.data.items ?? []) : [];
  return _bundleCache[taskId];
}

function _renderBundleCard(bundle) {
  const pct = bundle.totalCount > 0 ? Math.round(bundle.sentCount / bundle.totalCount * 100) : 0;
  return \`<div class="bundle-card" onclick="openBundle(\${JSON.stringify(bundle.id)})">
    <div class="bundle-card-row">
      <span class="badge \${BUNDLE_STATUS_CLS[bundle.status]||'muted'}">\${BUNDLE_STATUS_LABEL[bundle.status]||bundle.status.toUpperCase()}</span>
      \${bundle.needsApproval ? '<span class="badge muted" style="font-size:10px;">DRAFTS</span>' : ''}
      \${bundle.needsDesktopConfirm ? '<span class="badge warn" style="font-size:10px;">DESKTOP CONFIRM</span>' : ''}
      <span class="card-chevron" style="margin-left:auto;">›</span>
    </div>
    <div class="bundle-title">\${esc(bundle.title)}</div>
    <div class="card-sub" style="margin-top:2px;">\${esc(bundle.policySummary)}</div>
    \${bundle.destinations.length ? \`<div class="bundle-dests">\${bundle.destinations.map(d => \`<span class="bundle-dest \${DEST_CLS[d.system]||''}">\${esc(DEST_LABELS[d.system]||d.system)} · \${esc(d.label)}</span>\`).join('')}</div>\` : ''}
    <div class="bundle-progress">
      <div class="bundle-prog-bar"><div class="bundle-prog-fill" style="width:\${pct}%"></div></div>
      <div class="bundle-prog-label">\${bundle.sentCount}/\${bundle.totalCount} sent</div>
    </div>
  </div>\`;
}

async function openBundle(id) {
  // Locate from cache first
  let bundle = null;
  for (const bs of Object.values(_bundleCache)) {
    bundle = bs.find(b => b.id === id);
    if (bundle) break;
  }
  if (!bundle) {
    const r = await api('GET', \`/dispatch/bundle/\${encodeURIComponent(id)}\`);
    if (!r.ok) { toast('Bundle not found'); return; }
    bundle = r.data;
  }
  _viewingBundle = bundle;

  document.getElementById('bnd-title').textContent = bundle.title;
  document.getElementById('bnd-status-badge').innerHTML =
    \`<span class="badge \${BUNDLE_STATUS_CLS[bundle.status]||'muted'}" style="font-size:11px;">\${BUNDLE_STATUS_LABEL[bundle.status]||bundle.status.toUpperCase()}</span>\`;

  // Load artifacts for this bundle
  const arts = await loadTaskArtifacts(bundle.taskId);
  const bundleArts = arts.filter(a => bundle.artifactIds.includes(a.id));
  const DRAFT_TYPES = ['draft_slack','draft_jira','draft_linear','draft_github'];
  const sendable = bundleArts.filter(a => DRAFT_TYPES.includes(a.type));

  const artRows = bundleArts.map(a => {
    const isSent = a.meta?.status === 'sent';
    const isDraft = DRAFT_TYPES.includes(a.type);
    return \`<div class="bnd-art-row">
      \${isDraft && !isSent ? \`<input type="checkbox" class="bnd-art-check" data-id="\${esc(a.id)}" \${isSent?'disabled':''}>\` : '<div style="width:20px;"></div>'}
      <div class="bnd-art-info" onclick="openArtifact(\${JSON.stringify(a.id)})">
        <div class="bnd-art-title">\${esc(a.title)}</div>
        <div class="bnd-art-sub">
          <span class="artifact-type \${artifactTypeCls(a.type)}" style="margin-right:5px;">\${esc(ARTIFACT_TYPE_LABELS[a.type]||a.type)}</span>
          \${isSent ? '<span class="badge ok-pill" style="font-size:10px;">SENT</span>' : isDraft ? '<span class="badge muted" style="font-size:10px;">DRAFT</span>' : ''}
        </div>
      </div>
    </div>\`;
  }).join('');

  const policyBlock = bundle.needsDesktopConfirm
    ? \`<div class="bnd-policy-warn">
        <div class="bnd-policy-title">Desktop confirmation required</div>
        <div class="bnd-policy-body">Your policy requires desktop approval before sending drafts remotely. Approve on your desktop to allow sending.</div>
      </div>\` : '';

  document.getElementById('bnd-scroll').innerHTML = \`
    \${policyBlock}
    \${bundle.destinations.length ? \`<div class="bundle-dests" style="margin-bottom:12px;">\${bundle.destinations.map(d => \`<span class="bundle-dest \${DEST_CLS[d.system]||''}">\${esc(DEST_LABELS[d.system]||d.system)} · \${esc(d.label)}</span>\`).join('')}</div>\` : ''}
    <div class="card-sub" style="margin-bottom:10px;">\${esc(bundle.policySummary)}</div>
    \${artRows}
  \`;

  // Footer buttons
  const footer = document.getElementById('bnd-footer');
  if (sendable.length > 0 && bundle.status !== 'sent' && !bundle.needsDesktopConfirm) {
    footer.innerHTML = \`
      <button class="btn ghost" onclick="sendBundleSelected('\${esc(bundle.id)}')">Send Selected</button>
      <button class="btn" onclick="sendBundleSafe('\${esc(bundle.id)}')">Send All Safe</button>
    \`;
  } else if (bundle.status === 'sent') {
    footer.innerHTML = '<div class="card-sub" style="text-align:center;width:100%;padding:4px;">All artifacts sent</div>';
  } else {
    footer.innerHTML = '<div class="card-sub" style="text-align:center;width:100%;padding:4px;">Sending disabled — check policy</div>';
  }

  document.getElementById('bundle-overlay').classList.add('open');
}

function closeBundle() {
  document.getElementById('bundle-overlay').classList.remove('open');
  _viewingBundle = null;
}

async function sendBundleSafe(id) {
  await _doSendBundle(id, 'safe', []);
}

async function sendBundleSelected(id) {
  const checks = document.querySelectorAll('.bnd-art-check:checked');
  const selectedIds = Array.from(checks).map(c => c.dataset.id);
  if (!selectedIds.length) { toast('Select at least one artifact'); return; }
  await _doSendBundle(id, 'selected', selectedIds);
}

async function _doSendBundle(id, mode, artifactIds) {
  const btns = document.querySelectorAll('#bnd-footer .btn');
  btns.forEach(b => { b.disabled = true; b.textContent = 'Sending…'; });
  const r = await api('POST', \`/dispatch/bundle/\${encodeURIComponent(id)}/send\`, { mode, artifactIds });
  btns.forEach(b => { b.disabled = false; });
  if (r.ok || r.status === 207) {
    const { sent, held } = r.data;
    toast(held?.length ? \`\${sent.length} sent · \${held.length} held\` : \`\${sent?.length ?? 0} artifact\${(sent?.length??0)>1?'s':''} sent\`);
    // Invalidate cache
    if (_viewingBundle) {
      delete _bundleCache[_viewingBundle.taskId];
      delete _artifactCache[_viewingBundle.taskId];
    }
    closeBundle();
    // Re-open to show updated state
    if (_liveTaskId) openTaskDrawer(_liveTaskId);
  } else {
    toast(r.data?.error || 'Send failed');
    btns.forEach(b => { b.textContent = 'Retry'; });
  }
}

// ── Phase 23 — Artifact viewer ────────────────────────────────────────────────

const ARTIFACT_TYPE_LABELS = {
  report:         'Report',
  draft_slack:    'Slack Draft',
  draft_jira:     'Jira Draft',
  draft_linear:   'Linear Draft',
  draft_github:   'GitHub Draft',
  result_summary: 'Result',
  launch_summary: 'Launch',
};

let _viewingArtifact = null;
const _artifactCache = {};   // taskId → artifact[]

async function loadTaskArtifacts(taskId) {
  if (_artifactCache[taskId]) return _artifactCache[taskId];
  const r = await api('GET', \`/dispatch/task/\${encodeURIComponent(taskId)}/artifacts\`);
  _artifactCache[taskId] = r.ok ? (r.data.items ?? []) : [];
  return _artifactCache[taskId];
}

function artifactTypeCls(type) {
  return 'art-' + (type || 'result_summary');
}

function _renderArtifactCards(taskId, arts) {
  if (!arts || !arts.length) return '';
  return \`<div class="section-head">Artifacts</div>
  \${arts.map(a => \`
    <div class="artifact-card" onclick="openArtifact(\${JSON.stringify(a.id)})">
      <div class="artifact-card-row">
        <span class="artifact-type \${artifactTypeCls(a.type)}">\${esc(ARTIFACT_TYPE_LABELS[a.type]||a.type)}</span>
        \${a.meta?.status === 'sent' ? '<span class="badge ok-pill" style="font-size:10px;">SENT</span>' : a.meta?.status === 'draft' ? '<span class="badge muted" style="font-size:10px;">DRAFT</span>' : ''}
        <span class="artifact-chevron">›</span>
      </div>
      <div style="font-size:13px;font-weight:500;margin-bottom:4px;">\${esc(a.title)}</div>
      <div class="artifact-preview">\${esc(a.preview)}</div>
    </div>
  \`).join('')}\`;
}

async function openArtifact(id) {
  // Find artifact in caches
  let art = null;
  for (const arts of Object.values(_artifactCache)) {
    art = arts.find(a => a.id === id);
    if (art) break;
  }
  if (!art) {
    const r = await api('GET', \`/dispatch/artifact/\${encodeURIComponent(id)}\`);
    if (!r.ok) { toast('Artifact not found'); return; }
    art = r.data;
  }
  _viewingArtifact = art;
  document.getElementById('art-title').textContent = art.title;
  document.getElementById('art-status-badge').innerHTML =
    art.meta?.status === 'sent' ? '<span class="badge ok-pill" style="font-size:11px;">SENT</span>'
    : art.meta?.status === 'draft' ? '<span class="badge muted" style="font-size:11px;">DRAFT</span>' : '';

  document.getElementById('art-scroll').innerHTML = \`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
      <span class="artifact-type \${artifactTypeCls(art.type)}">\${esc(ARTIFACT_TYPE_LABELS[art.type]||art.type)}</span>
      <span class="card-sub">\${fmtTime(art.createdAt)}</span>
    </div>
    <div class="art-content-block">\${esc(art.content)}</div>
  \`;

  const footerBtns = [\`<button class="btn" onclick="copyArtifact()">Copy</button>\`];
  if (art.type === 'draft_slack')   footerBtns.push(\`<button class="btn" onclick="sendArtifact('\${esc(art.id)}')">Send to Slack</button>\`);
  if (art.type === 'draft_jira')    footerBtns.push(\`<button class="btn" onclick="sendArtifact('\${esc(art.id)}')">Post to Jira</button>\`);
  if (art.type === 'draft_linear')  footerBtns.push(\`<button class="btn" onclick="sendArtifact('\${esc(art.id)}')">Post to Linear</button>\`);
  if (art.type === 'draft_github')  footerBtns.push(\`<button class="btn" onclick="sendArtifact('\${esc(art.id)}')">Post to GitHub</button>\`);
  document.getElementById('art-footer').innerHTML = footerBtns.join('');

  document.getElementById('artifact-overlay').classList.add('open');
}

function closeArtifact() {
  document.getElementById('artifact-overlay').classList.remove('open');
  _viewingArtifact = null;
}

function copyArtifact() {
  if (!_viewingArtifact) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(_viewingArtifact.content).then(() => toast('Copied to clipboard'));
  } else {
    // Fallback: select a temp textarea
    const ta = document.createElement('textarea');
    ta.value = _viewingArtifact.content;
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied');
  }
}

async function sendArtifact(id) {
  const btn = event?.currentTarget;
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const r = await api('POST', \`/dispatch/artifact/\${encodeURIComponent(id)}/approve-send\`);
  if (btn) { btn.disabled = false; }
  if (r.ok) {
    toast('Sent successfully');
    if (_viewingArtifact?.id === id) _viewingArtifact.meta = { ..._viewingArtifact.meta, status: 'sent' };
    // Invalidate cache so next open reflects sent status
    for (const taskId of Object.keys(_artifactCache)) {
      const idx = _artifactCache[taskId].findIndex(a => a.id === id);
      if (idx >= 0) _artifactCache[taskId][idx] = { ..._artifactCache[taskId][idx], meta: { ..._artifactCache[taskId][idx].meta, status: 'sent' } };
    }
    // Refresh status badge
    document.getElementById('art-status-badge').innerHTML = '<span class="badge ok-pill" style="font-size:11px;">SENT</span>';
  } else {
    toast(r.data?.error || 'Send failed');
    if (btn) btn.textContent = btn.textContent.replace('Sending…', 'Retry');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtAge(ms) {
  if (ms < 60000) return Math.round(ms/1000)+'s ago';
  if (ms < 3600000) return Math.round(ms/60000)+'m ago';
  return Math.round(ms/3600000)+'h ago';
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display = 'block'; el.style.opacity = '1';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, 2500);
}
</script>
</body>
</html>`;

// ── In-memory pending confirmations ────────────────────────────────────────────
// Lives on the server instance (cleared on restart, intentionally short-lived).
// Pruned automatically — resolved entries older than 1 hour are evicted to prevent unbounded growth.

const _pendingConfs = new Map<string, PendingConfirmation>();
const CONF_TTL_MS = 60 * 60 * 1000; // 1 hour

function _pruneConfs(): void {
  const cutoff = Date.now() - CONF_TTL_MS;
  for (const [id, conf] of _pendingConfs) {
    if (conf.status !== 'pending' && (conf.resolvedAt ?? 0) < cutoff) {
      _pendingConfs.delete(id);
    }
  }
}

// ── DispatchServer class ────────────────────────────────────────────────────────

export class DispatchServer {
  private _server:     http.Server | null = null;
  private _port:       number;
  private _handlers:   DispatchHandlers;
  private _startedAt:  number = 0;
  private _sseClients: Set<http.ServerResponse> = new Set();

  constructor(port: number, handlers: DispatchHandlers) {
    this._port     = port;
    this._handlers = handlers;
  }

  get port():      number  { return this._port; }
  get isRunning(): boolean { return this._server !== null; }
  get startedAt(): number  { return this._startedAt; }

  async start(): Promise<void> {
    if (this._server) return;
    this._server = http.createServer(this._handleRequest.bind(this));
    await new Promise<void>((resolve, reject) => {
      this._server!.listen(this._port, '0.0.0.0', () => resolve());
      this._server!.on('error', reject);
    });
    this._startedAt = Date.now();
    console.log(`[DispatchServer] Listening on port ${this._port}`);
  }

  async stop(): Promise<void> {
    if (!this._server) return;
    await new Promise<void>((resolve) => this._server!.close(() => resolve()));
    this._server = null;
    console.log('[DispatchServer] Stopped');
  }

  /** Phase 22 — broadcast a task event to all connected SSE clients. */
  broadcastTaskEvent(event: DispatchTaskEvent): void {
    if (this._sseClients.size === 0) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this._sseClients) {
      try { res.write(data); }
      catch { this._sseClients.delete(res); }
    }
  }

  /** Called by ipc.ts when desktop approves/denies a pending confirmation. */
  resolveConf(id: string, approved: boolean): boolean {
    const conf = _pendingConfs.get(id);
    if (!conf || conf.status !== 'pending') return false;
    conf.status = approved ? 'approved' : 'denied';
    conf.resolvedAt = Date.now();
    return true;
  }

  /** Get confirmation by ID (for long-poll endpoint). */
  getConf(id: string): PendingConfirmation | undefined {
    return _pendingConfs.get(id);
  }

  private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url    = req.url ?? '/';
    const method = req.method ?? 'GET';
    const path   = url.split('?')[0];
    const clientIp = req.socket.remoteAddress ?? '0.0.0.0';

    // ── Serve UI on root
    if (method === 'GET' && (path === '/' || path === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DISPATCH_UI_HTML);
      return;
    }

    // ── Serve pairing page (no auth required)
    if (method === 'GET' && path === '/dispatch/pair-page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAIR_PAGE_HTML);
      return;
    }

    // ── PWA manifest (no auth required)
    if (method === 'GET' && path === '/dispatch/manifest.json') {
      this._json(res, 200, {
        name: 'TriForge Dispatch',
        short_name: 'Dispatch',
        description: 'TriForge remote command surface',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [{
          src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%236366f1'/%3E%3Cpath d='M30 65 L50 35 L70 65' stroke='white' stroke-width='8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        }],
      });
      return;
    }

    // ── PWA service worker stub (no auth required)
    if (method === 'GET' && path === '/dispatch/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end('self.addEventListener("fetch", e => {});');
      return;
    }

    // ── Invite page (no auth required — device may not be paired yet)
    if (method === 'GET' && path === '/dispatch/invite-page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(INVITE_PAGE_HTML);
      return;
    }

    // ── SSE stream (auth via query param — EventSource cannot set headers)
    if (method === 'GET' && path === '/dispatch/stream') {
      const qs          = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
      const qToken      = new URLSearchParams(qs).get('token') ?? '';
      const masterToken = await this._handlers.getMasterToken();
      const devices     = this._handlers.getPairedDevices();
      const auth        = validateAuth(qToken, masterToken, devices, clientIp);
      if (!auth.ok) { this._json(res, 401, { error: 'Unauthorized' }); return; }
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
      this._sseClients.add(res);
      const hb = setInterval(() => {
        try { res.write(`:heartbeat\n\n`); }
        catch { clearInterval(hb); this._sseClients.delete(res); }
      }, 30000);
      req.on('close', () => { clearInterval(hb); this._sseClients.delete(res); });
      return; // keep connection open — do NOT end response
    }

    // ── Network mode check (before auth, for all /dispatch routes)
    const networkMode = this._handlers.getNetworkMode();
    if (path.startsWith('/dispatch') && !isNetworkAllowed(clientIp, networkMode)) {
      this._json(res, 403, {
        error: `Access restricted — server is in '${networkMode}' mode`,
        networkMode,
      });
      return;
    }

    // ── Pair endpoint (no prior auth needed, validated by pairing code)
    if (method === 'POST' && path === '/dispatch/pair') {
      await this._handlePair(req, res, clientIp);
      return;
    }

    // ── Auth for all other /dispatch routes
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const masterToken = await this._handlers.getMasterToken();
    const devices = this._handlers.getPairedDevices();
    const authResult = validateAuth(token, masterToken, devices, clientIp);

    if (!authResult.ok) {
      // Update device lastSeen even on fail isn't needed, but save any session touches
      // (validateAuth mutates device.lastSeenAt in-place on success)
      this._json(res, 401, {
        error: authResult.reason ?? 'Unauthorized',
        requiresPairing: !authResult.isAdmin,
      });
      return;
    }

    // Persist any lastSeen updates made by validateAuth
    if (authResult.device) {
      const updated = devices.map(d => d.id === authResult.device!.id ? authResult.device! : d);
      this._handlers.setPairedDevices(updated);
    }

    const ctx: RemoteActionContext = {
      isAdmin:     authResult.isAdmin,
      deviceId:    authResult.device?.id ?? null,
      deviceLabel: authResult.device?.label ?? (authResult.isAdmin ? 'Admin' : null),
      clientIp,
    };

    // ── Auth refresh
    if (method === 'POST' && path === '/dispatch/auth/refresh') {
      if (!authResult.device) { this._json(res, 400, { error: 'Refresh requires a session token, not admin token' }); return; }
      const ttl    = this._handlers.getSessionTtlMinutes();
      const rotated = rotateSessionToken(authResult.device, ttl);
      const updated = devices.map(d => d.id === rotated.id ? rotated : d);
      this._handlers.setPairedDevices(updated);
      this._json(res, 200, { ok: true, sessionToken: rotated.sessionToken, expiresAt: rotated.sessionExpiresAt });
      return;
    }

    // Read body for POST
    let body: Record<string, unknown> = {};
    if (method === 'POST') body = await this._readBody(req);

    try {
      await this._route(method, path, body, res, ctx);
    } catch (err) {
      console.error('[DispatchServer] Handler error:', err);
      this._json(res, 500, { error: 'Internal server error' });
    }
  }

  private async _handlePair(req: http.IncomingMessage, res: http.ServerResponse, clientIp: string): Promise<void> {
    const body  = await this._readBody(req);
    const code  = String(body.code ?? '').trim();
    const label = String(body.label ?? '').slice(0, 60) || 'Unknown device';

    const pc = this._handlers.getPairingCode();
    if (!isPairingCodeValid(pc, code)) {
      this._json(res, 400, { error: 'Invalid or expired pairing code' });
      return;
    }

    // Mark code used
    this._handlers.setPairingCode({ ...pc!, used: true });

    const ttl    = this._handlers.getSessionTtlMinutes();
    const device = createDevice(label, clientIp, ttl);
    const devices = [...this._handlers.getPairedDevices(), device];
    this._handlers.setPairedDevices(devices);

    // Tell renderer a new device paired
    this._handlers.emitToRenderer('dispatch:devicePaired', toDeviceView(device));

    this._json(res, 200, {
      ok:           true,
      sessionToken: device.sessionToken,
      deviceId:     device.id,
      expiresAt:    device.sessionExpiresAt,
    });
  }

  private async _route(
    method: string,
    path:   string,
    body:   Record<string, unknown>,
    res:    http.ServerResponse,
    ctx:    RemoteActionContext,
  ): Promise<void> {
    const policy = this._handlers.getApprovePolicy();

    // GET /dispatch/health
    if (method === 'GET' && path === '/dispatch/health') {
      this._json(res, 200, {
        ok:          true,
        startedAt:   this._startedAt,
        uptime:      Date.now() - this._startedAt,
        networkMode: this._handlers.getNetworkMode(),
        approvePolicy: {
          enabled:              policy.enabled,
          maxRisk:              policy.maxRisk,
          requireDesktopConfirm: policy.requireDesktopConfirm,
        },
      });
      return;
    }

    // GET /dispatch/actions
    if (method === 'GET' && path === '/dispatch/actions') {
      const items = await this._handlers.getActions();
      this._json(res, 200, { items });
      return;
    }

    // GET /dispatch/history — recent remote dispatch activity
    if (method === 'GET' && path === '/dispatch/history') {
      this._json(res, 200, { items: await this._handlers.getHistory() });
      return;
    }

    // GET /dispatch/action/:id — rich detail for drawer
    const actionDetailMatch = path.match(/^\/dispatch\/action\/([^/]+)$/);
    if (method === 'GET' && actionDetailMatch) {
      const id      = decodeURIComponent(actionDetailMatch[1]);
      const actions = await this._handlers.getActions();
      const action  = actions.find(a => a.id === id);
      if (!action) { this._json(res, 404, { error: 'Action not found' }); return; }
      this._json(res, 200, { ...action, policyMaxRisk: policy.maxRisk, requireDesktopConfirm: policy.requireDesktopConfirm });
      return;
    }

    // POST /dispatch/action/:id/(approve|dismiss|retry)
    const actionMatch = path.match(/^\/dispatch\/action\/(.+)\/(approve|dismiss|retry)$/);
    if (method === 'POST' && actionMatch) {
      const itemId = decodeURIComponent(actionMatch[1]);
      const verb   = actionMatch[2] as 'approve' | 'dismiss' | 'retry';
      return this._handleActionVerb(itemId, verb, res, ctx, policy);
    }

    // GET /dispatch/ops/overview
    if (method === 'GET' && path === '/dispatch/ops/overview') {
      this._json(res, 200, await this._handlers.getOpsOverview());
      return;
    }

    // GET /dispatch/recipes
    if (method === 'GET' && path === '/dispatch/recipes') {
      this._json(res, 200, { items: await this._handlers.getRecipes() });
      return;
    }

    // POST /dispatch/recipe/:id/run
    const recipeMatch = path.match(/^\/dispatch\/recipe\/(.+)\/run$/);
    if (method === 'POST' && recipeMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id     = decodeURIComponent(recipeMatch[1]);
      const result = await this._handlers.runRecipe(id, ctx);
      this._handlers.auditLog('recipe_run', id, ctx);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // GET /dispatch/missions
    if (method === 'GET' && path === '/dispatch/missions') {
      this._json(res, 200, { items: await this._handlers.getMissions() });
      return;
    }

    // POST /dispatch/mission/:id/run
    const missionMatch = path.match(/^\/dispatch\/mission\/(.+)\/run$/);
    if (method === 'POST' && missionMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id     = decodeURIComponent(missionMatch[1]);
      const result = await this._handlers.runMission(id, ctx);
      this._handlers.auditLog('mission_run', id, ctx);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // GET /dispatch/confirm/:id — poll for desktop confirmation status
    const confPollMatch = path.match(/^\/dispatch\/confirm\/(.+)$/);
    if (method === 'GET' && confPollMatch) {
      const confId = decodeURIComponent(confPollMatch[1]);
      const conf   = _pendingConfs.get(confId);
      if (!conf) { this._json(res, 404, { error: 'Not found' }); return; }
      this._json(res, 200, { status: conf.status, resolvedAt: conf.resolvedAt });
      return;
    }

    // GET /dispatch/threads — inbox listing (newest first)
    if (method === 'GET' && path === '/dispatch/threads') {
      this._json(res, 200, { items: await this._handlers.listThreads() });
      return;
    }

    // GET /dispatch/thread/:id — full thread with messages
    const threadGetMatch = path.match(/^\/dispatch\/thread\/([^/]+)$/);
    if (method === 'GET' && threadGetMatch) {
      const id     = decodeURIComponent(threadGetMatch[1]);
      const thread = await this._handlers.getThread(id);
      if (!thread) { this._json(res, 404, { error: 'Thread not found' }); return; }
      this._json(res, 200, thread);
      return;
    }

    // POST /dispatch/thread/:id/message — follow-up in existing thread
    const threadMsgMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/message$/);
    if (method === 'POST' && threadMsgMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id       = decodeURIComponent(threadMsgMatch[1]);
      const text     = typeof body.text     === 'string' ? body.text.trim()     : '';
      const category = typeof body.category === 'string' ? body.category        : 'informational';
      if (!text) { this._json(res, 400, { error: 'text is required' }); return; }
      try {
        const result = await this._handlers.postThreadMessage(id, text, category as TaskCategory, ctx);
        this._json(res, 201, result);
      } catch (e: unknown) {
        this._json(res, 404, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // GET /dispatch/task/:id/bundles — list bundles for a task
    const taskBundlesMatch = path.match(/^\/dispatch\/task\/([^/]+)\/bundles$/);
    if (method === 'GET' && taskBundlesMatch) {
      const taskId = decodeURIComponent(taskBundlesMatch[1]);
      this._json(res, 200, { items: await this._handlers.listTaskBundles(taskId) });
      return;
    }

    // GET /dispatch/bundle/:id — bundle detail
    const bundleGetMatch = path.match(/^\/dispatch\/bundle\/([^/]+)$/);
    if (method === 'GET' && bundleGetMatch) {
      const id     = decodeURIComponent(bundleGetMatch[1]);
      const bundle = await this._handlers.getBundle(id);
      if (!bundle) { this._json(res, 404, { error: 'Bundle not found' }); return; }
      this._json(res, 200, bundle);
      return;
    }

    // POST /dispatch/bundle/:id/send — batch send
    const bundleSendMatch = path.match(/^\/dispatch\/bundle\/([^/]+)\/send$/);
    if (method === 'POST' && bundleSendMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id          = decodeURIComponent(bundleSendMatch[1]);
      const mode        = typeof body.mode === 'string' ? body.mode as 'all' | 'safe' | 'selected' : 'safe';
      const selectedIds = Array.isArray(body.artifactIds) ? body.artifactIds as string[] : [];
      const result      = await this._handlers.sendBundle(id, mode, selectedIds, ctx);
      this._json(res, result.ok ? 200 : 207, result); // 207 Multi-Status if partial
      return;
    }

    // GET /dispatch/task/:id/artifacts — list artifacts for a task
    const taskArtifactsMatch = path.match(/^\/dispatch\/task\/([^/]+)\/artifacts$/);
    if (method === 'GET' && taskArtifactsMatch) {
      const taskId = decodeURIComponent(taskArtifactsMatch[1]);
      this._json(res, 200, { items: await this._handlers.listTaskArtifacts(taskId) });
      return;
    }

    // GET /dispatch/artifact/:id — full artifact detail
    const artifactGetMatch = path.match(/^\/dispatch\/artifact\/([^/]+)$/);
    if (method === 'GET' && artifactGetMatch) {
      const id  = decodeURIComponent(artifactGetMatch[1]);
      const art = await this._handlers.getArtifact(id);
      if (!art) { this._json(res, 404, { error: 'Artifact not found' }); return; }
      this._json(res, 200, art);
      return;
    }

    // POST /dispatch/artifact/:id/approve-send — send draft to target system
    const artifactSendMatch = path.match(/^\/dispatch\/artifact\/([^/]+)\/approve-send$/);
    if (method === 'POST' && artifactSendMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id     = decodeURIComponent(artifactSendMatch[1]);
      const result = await this._handlers.approveArtifactSend(id, ctx);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // GET /dispatch/tasks
    if (method === 'GET' && path === '/dispatch/tasks') {
      this._json(res, 200, { items: await this._handlers.listTasks() });
      return;
    }

    // GET /dispatch/task/:id
    const taskGetMatch = path.match(/^\/dispatch\/task\/([^/]+)$/);
    if (method === 'GET' && taskGetMatch) {
      const id   = decodeURIComponent(taskGetMatch[1]);
      const task = await this._handlers.getTask(id);
      if (!task) { this._json(res, 404, { error: 'Task not found' }); return; }
      this._json(res, 200, task);
      return;
    }

    // POST /dispatch/task — create a remote task
    if (method === 'POST' && path === '/dispatch/task') {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const goal     = typeof body.goal     === 'string' ? body.goal.trim()     : '';
      const category = typeof body.category === 'string' ? body.category        : 'informational';
      if (!goal) { this._json(res, 400, { error: 'goal is required' }); return; }
      const validCats: TaskCategory[] = ['informational', 'recipe', 'mission', 'write'];
      if (!validCats.includes(category as TaskCategory)) {
        this._json(res, 400, { error: `category must be one of: ${validCats.join(', ')}` });
        return;
      }
      // write-category actions require risk gate
      if (category === 'write') {
        const riskCheck = isRiskAllowed('high', policy);
        if (!riskCheck) { this._json(res, 403, { error: 'Write tasks require high-risk approval policy' }); return; }
      }
      const params: DispatchTaskParams = {
        goal,
        category: category as TaskCategory,
        ctx: {
          repo:    typeof body.repo    === 'string' ? body.repo    : undefined,
          project: typeof body.project === 'string' ? body.project : undefined,
          channel: typeof body.channel === 'string' ? body.channel : undefined,
          target:  typeof body.target  === 'string' ? body.target  : undefined,
        },
        preferLocal: !!body.preferLocal,
      };
      const task = await this._handlers.createTask(params, ctx);
      this._handlers.auditLog('task_create', `${category}:${goal.slice(0, 80)}`, ctx);
      this._json(res, 201, task);
      return;
    }

    // ── Phase 27 — Workspace routes ───────────────────────────────────────────

    // GET /dispatch/workspace — workspace overview (any authenticated device)
    if (method === 'GET' && path === '/dispatch/workspace') {
      const ws = await this._handlers.getWorkspace();
      if (!ws) { this._json(res, 404, { error: 'No workspace configured' }); return; }
      // Strip invite codes from the response for non-admins
      const safeWs = ctx.isAdmin ? ws : { ...ws, invites: undefined };
      this._json(res, 200, safeWs);
      return;
    }

    // POST /dispatch/workspace/join — claim a workspace invite code
    if (method === 'POST' && path === '/dispatch/workspace/join') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!code) { this._json(res, 400, { error: 'code is required' }); return; }
      try {
        const result = await this._handlers.claimWorkspaceInvite(code, ctx);
        this._json(res, 200, result);
      } catch (e: unknown) {
        this._json(res, 404, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // GET /dispatch/workspace/members — list workspace members
    if (method === 'GET' && path === '/dispatch/workspace/members') {
      const ws = await this._handlers.getWorkspace();
      if (!ws) { this._json(res, 404, { error: 'No workspace' }); return; }
      this._json(res, 200, { items: ws.members, total: ws.members.length });
      return;
    }

    // POST /dispatch/workspace/invite — create invite (admin+ only)
    if (method === 'POST' && path === '/dispatch/workspace/invite') {
      const role = (typeof body.role === 'string' ? body.role : 'viewer') as WorkspaceRole;
      const validRoles: WorkspaceRole[] = ['viewer', 'reviewer', 'operator', 'admin'];
      if (!validRoles.includes(role)) { this._json(res, 400, { error: 'Invalid role' }); return; }
      try {
        const result = await this._handlers.createWorkspaceInvite(role, ctx);
        this._json(res, 201, result);
      } catch (e: unknown) {
        this._json(res, 403, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // ── Phase 26 — Thread collaboration routes ────────────────────────────────

    // POST /dispatch/thread/:id/invite — generate invite code
    const thrInviteMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/invite$/);
    if (method === 'POST' && thrInviteMatch) {
      const id   = decodeURIComponent(thrInviteMatch[1]);
      const role = (typeof body.role === 'string' ? body.role : 'viewer') as CollaboratorRole;
      const validRoles: CollaboratorRole[] = ['viewer', 'reviewer', 'operator'];
      if (!validRoles.includes(role)) { this._json(res, 400, { error: 'role must be viewer, reviewer, or operator' }); return; }
      try {
        const result = await this._handlers.createThreadInvite(id, role, ctx);
        this._json(res, 201, result);
      } catch (e: unknown) {
        this._json(res, 403, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // POST /dispatch/invite/claim — claim an invite code and join the thread
    if (method === 'POST' && path === '/dispatch/invite/claim') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!code) { this._json(res, 400, { error: 'code is required' }); return; }
      try {
        const result = await this._handlers.claimThreadInvite(code, ctx);
        this._json(res, 200, result);
      } catch (e: unknown) {
        this._json(res, 404, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // DELETE /dispatch/thread/:id/collaborator/:deviceId — revoke collaborator
    const thrRevokeMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/collaborator\/([^/]+)$/);
    if (method === 'DELETE' && thrRevokeMatch) {
      const threadId     = decodeURIComponent(thrRevokeMatch[1]);
      const targetDevice = decodeURIComponent(thrRevokeMatch[2]);
      const result = await this._handlers.revokeCollaborator(threadId, targetDevice, ctx);
      this._json(res, result.ok ? 200 : 403, result);
      return;
    }

    // GET /dispatch/thread/:id/comments — list comments for a thread
    const thrCommentsGetMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/comments$/);
    if (method === 'GET' && thrCommentsGetMatch) {
      const id = decodeURIComponent(thrCommentsGetMatch[1]);
      try {
        const items = await this._handlers.listThreadComments(id, ctx);
        this._json(res, 200, { items });
      } catch (e: unknown) {
        this._json(res, 403, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // POST /dispatch/thread/:id/comment — add a comment
    const thrCommentPostMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/comment$/);
    if (method === 'POST' && thrCommentPostMatch) {
      const id         = decodeURIComponent(thrCommentPostMatch[1]);
      const text       = typeof body.text === 'string' ? body.text.trim() : '';
      const targetType = (typeof body.targetType === 'string' ? body.targetType : 'thread') as ThreadComment['targetType'];
      const targetId   = typeof body.targetId   === 'string' ? body.targetId   : id;
      if (!text) { this._json(res, 400, { error: 'text is required' }); return; }
      try {
        const comment = await this._handlers.addThreadComment(id, text, targetType, targetId, ctx);
        this._json(res, 201, comment);
      } catch (e: unknown) {
        this._json(res, 403, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // DELETE /dispatch/thread/:id/comment/:commentId — delete a comment
    const thrCommentDelMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/comment\/([^/]+)$/);
    if (method === 'DELETE' && thrCommentDelMatch) {
      const threadId  = decodeURIComponent(thrCommentDelMatch[1]);
      const commentId = decodeURIComponent(thrCommentDelMatch[2]);
      const result = await this._handlers.deleteThreadComment(threadId, commentId, ctx);
      this._json(res, result.ok ? 200 : 403, result);
      return;
    }

    // GET /dispatch/thread/:id/attributions — approval attribution log
    const thrAttrMatch = path.match(/^\/dispatch\/thread\/([^/]+)\/attributions$/);
    if (method === 'GET' && thrAttrMatch) {
      const id = decodeURIComponent(thrAttrMatch[1]);
      try {
        const items = await this._handlers.getThreadAttributions(id, ctx);
        this._json(res, 200, { items });
      } catch (e: unknown) {
        this._json(res, 403, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // ── Phase 31 — Runbook routes ──────────────────────────────────────────────

    // GET /dispatch/runbooks
    if (method === 'GET' && path === '/dispatch/runbooks') {
      this._json(res, 200, { items: await this._handlers.listRunbooks() });
      return;
    }

    // POST /dispatch/runbook/:id/run
    const runbookRunMatch = path.match(/^\/dispatch\/runbook\/(.+)\/run$/);
    if (method === 'POST' && runbookRunMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id     = decodeURIComponent(runbookRunMatch[1]);
      const vars   = (body.vars && typeof body.vars === 'object' && !Array.isArray(body.vars))
        ? Object.fromEntries(Object.entries(body.vars).map(([k, v]) => [k, String(v)]))
        : undefined;
      const result = await this._handlers.runRunbook(id, ctx, vars);
      this._handlers.auditLog('runbook_run', id, ctx);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // GET /dispatch/runbook/execution/:id
    const rbExecMatch = path.match(/^\/dispatch\/runbook\/execution\/(.+)$/);
    if (method === 'GET' && rbExecMatch) {
      const id   = decodeURIComponent(rbExecMatch[1]);
      const exec = await this._handlers.getRunbookExecution(id);
      if (!exec) { this._json(res, 404, { error: 'Execution not found' }); return; }
      this._json(res, 200, exec);
      return;
    }

    // GET /dispatch/incident
    if (method === 'GET' && path === '/dispatch/incident') {
      this._json(res, 200, this._handlers.getIncidentMode());
      return;
    }

    // ── Phase 32 — Handoff queue routes ───────────────────────────────────────

    // GET /dispatch/handoffs
    if (method === 'GET' && path === '/dispatch/handoffs') {
      this._json(res, 200, { items: await this._handlers.listHandoffItems() });
      return;
    }

    // POST /dispatch/handoff/:id/resolve  body: { resolution: 'approved'|'confirmed'|'rejected' }
    const handoffResolveMatch = path.match(/^\/dispatch\/handoff\/(.+)\/resolve$/);
    if (method === 'POST' && handoffResolveMatch) {
      if (!policy.enabled) { this._json(res, 403, { error: 'Remote actions disabled' }); return; }
      const id = decodeURIComponent(handoffResolveMatch[1]);
      const resolution = String(body['resolution'] ?? 'approved');
      const result = await this._handlers.resolveHandoffItem(id, resolution, ctx);
      this._handlers.auditLog('handoff_resolve', id, ctx);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    this._json(res, 404, { error: 'Not found' });
  }

  private async _handleActionVerb(
    itemId:  string,
    verb:    'approve' | 'dismiss' | 'retry',
    res:     http.ServerResponse,
    ctx:     RemoteActionContext,
    policy:  RemoteApprovePolicy,
  ): Promise<void> {
    if (!policy.enabled) {
      this._json(res, 403, { error: 'Remote actions disabled' });
      return;
    }

    // Risk check for approve (dismiss/retry don't need it)
    if (verb === 'approve') {
      // Get the action to check its severity
      const actions = await this._handlers.getActions();
      const action  = actions.find(a => a.id === itemId);
      if (action && !isRiskAllowed(action.severity, policy)) {
        this._json(res, 403, {
          error: `Risk level '${action.severity}' exceeds remote approve limit ('${policy.maxRisk}')`,
          blocked: true,
        });
        return;
      }

      // Desktop confirmation gate
      if (policy.requireDesktopConfirm) {
        const confId = generateConfirmationId();
        const conf: PendingConfirmation = {
          id:          confId,
          action:      action?.label ?? itemId,
          itemId,
          verb,
          deviceId:    ctx.deviceId ?? 'admin',
          deviceLabel: ctx.deviceLabel ?? 'Unknown',
          clientIp:    ctx.clientIp,
          createdAt:   Date.now(),
          status:      'pending',
        };
        _pendingConfs.set(confId, conf);
        _pruneConfs(); // amortized cleanup of old resolved entries
        this._handlers.queueConfirmation(conf);
        this._handlers.emitToRenderer('dispatch:confirmationRequired', {
          id:          confId,
          action:      conf.action,
          deviceLabel: conf.deviceLabel,
          itemId,
        });
        this._json(res, 202, { ok: false, pending: true, confirmId: confId });
        return;
      }
    }

    let result: ActionResult;
    if (verb === 'approve')      result = await this._handlers.approveAction(itemId, ctx);
    else if (verb === 'dismiss') result = await this._handlers.dismissAction(itemId, ctx);
    else                         result = await this._handlers.retryAction(itemId, ctx);
    this._handlers.auditLog(`action_${verb}`, itemId, ctx);
    this._json(res, result.ok ? 200 : 400, result);
  }

  private _json(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  }

  private _readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; if (raw.length > 65536) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }
}

// ── Token generator (kept for master token generation) ─────────────────────────

export function generateDispatchToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// ── QR code generator ───────────────────────────────────────────────────────────

export async function generateQrDataUrl(text: string): Promise<string> {
  return qrcode.toDataURL(text, { width: 200, margin: 2, color: { dark: '#e2e8f0', light: '#1e293b' } });
}
