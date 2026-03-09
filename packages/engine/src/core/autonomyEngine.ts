// autonomyEngine.ts — event-driven workflow executor
// Subscribes to EventBus, matches sensor events to user-defined workflows,
// then executes action chains (ai_task, notify, write_file, or external handlers).
// Risk enforcement: high-risk actions are gated — queued for approval instead of
// executing inline. Approved actions re-check policy before execution (TASK 6).

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { eventBus } from './eventBus';
import type { EngineEvent, TaskCategory } from './taskTypes';
import type { AgentLoop } from './agentLoop';
import type { AuditLedger } from './auditLedger';
import type { TaskToolRegistry } from '../tools/taskRegistry';

export interface TriggerCondition {
  eventType: string;
  filter?: Record<string, unknown>;
}

export interface WorkflowAction {
  type: 'ai_task' | 'notify' | 'queue_approval' | 'run_tool'
       | 'post_social' | 'send_email' | 'write_file';
  params: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: TriggerCondition[];
  actions: WorkflowAction[];
  cooldownMs?: number;
  lastFiredAt?: number;
  createdAt: number;
}

export type ExternalActionHandler = (
  params: Record<string, unknown>,
  triggerPayload: EngineEvent,
) => Promise<void>;

// ── Risk Policy ────────────────────────────────────────────────────────────────

export interface RiskPolicy {
  allowAutoRunSafeFixes: boolean;
  allowScriptRunner: boolean;
  allowKillProcess: boolean;
  allowRestartService: boolean;
  allowWriteFile: boolean;
  allowBrowserFillForm: boolean;
  allowSocialPost: boolean;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  allowAutoRunSafeFixes: false,
  allowScriptRunner: false,
  allowKillProcess: false,
  allowRestartService: false,
  allowWriteFile: false,
  allowBrowserFillForm: false,
  allowSocialPost: false,
};

interface PendingAction {
  action: WorkflowAction;
  trigger: EngineEvent;
  workflowId: string;
  workflowName: string;
  queuedAt: number;
}

export interface AutonomyStatus {
  running: boolean;
  workflowCount: number;
  enabledWorkflowCount: number;
  lastFiredWorkflowName: string | null;
  lastFiredAt: number | null;
  pendingActionCount: number;
}

// ── AutonomyEngine ─────────────────────────────────────────────────────────────

export class AutonomyEngine {
  private workflows: WorkflowDefinition[] = [];
  private unsub: (() => void) | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly storePath: string;
  private readonly dataDir: string;
  private externalHandlers = new Map<string, ExternalActionHandler>();
  private riskPolicy: RiskPolicy = { ...DEFAULT_RISK_POLICY };
  private pendingActions = new Map<string, PendingAction>();
  private lastFiredWorkflowName: string | null = null;
  private lastFiredAt: number | null = null;

  constructor(
    private agentLoop: AgentLoop,
    private _registry: TaskToolRegistry,
    private _ledger: AuditLedger,
    private notifier: (title: string, body: string) => void,
    dataDir: string,
  ) {
    this.dataDir = dataDir;
    this.storePath = path.join(dataDir, 'triforge-workflows.json');
    this.load();
  }

  registerActionHandler(type: string, handler: ExternalActionHandler): void {
    this.externalHandlers.set(type, handler);
  }

  setRiskPolicy(policy: Partial<RiskPolicy>): void {
    this.riskPolicy = { ...DEFAULT_RISK_POLICY, ...policy };
  }

  getRiskPolicy(): RiskPolicy {
    return { ...this.riskPolicy };
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = eventBus.onAny(ev => this.handleEvent(ev));
    // Emit AUTONOMY_HEALTH every 60s so the UI and subscribers can track engine state
    this.healthTimer = setInterval(() => this.emitHealth(), 60_000);
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
  }

  private emitHealth(): void {
    try {
      eventBus.emit({
        type: 'AUTONOMY_HEALTH',
        activeWorkflows:  this.workflows.filter(w => w.enabled).length,
        sensorsRunning:   0,   // populated by SensorManager at the IPC layer
        pendingApprovals: this.pendingActions.size,
      });
    } catch { /* ignore */ }
  }

  isRunning(): boolean { return this.unsub !== null; }

  getStatus(): AutonomyStatus {
    return {
      running: this.isRunning(),
      workflowCount: this.workflows.length,
      enabledWorkflowCount: this.workflows.filter(w => w.enabled).length,
      lastFiredWorkflowName: this.lastFiredWorkflowName,
      lastFiredAt: this.lastFiredAt,
      pendingActionCount: this.pendingActions.size,
    };
  }

  // ── Workflow CRUD ────────────────────────────────────────────────────────────

  registerWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    const existing = this.workflows.findIndex(w => w.id === wf.id);
    if (existing >= 0) {
      this.workflows[existing] = wf;
    } else {
      this.workflows.push(wf);
    }
    this.save();
    return wf;
  }

  updateWorkflow(id: string, patch: Partial<WorkflowDefinition>): WorkflowDefinition | null {
    const idx = this.workflows.findIndex(w => w.id === id);
    if (idx < 0) return null;
    this.workflows[idx] = { ...this.workflows[idx], ...patch };
    this.save();
    return this.workflows[idx];
  }

  deleteWorkflow(id: string): boolean {
    const idx = this.workflows.findIndex(w => w.id === id);
    if (idx < 0) return false;
    this.workflows.splice(idx, 1);
    this.save();
    return true;
  }

  listWorkflows(): WorkflowDefinition[] {
    return this.workflows;
  }

  // ── Pending Action Approval (TASK 6) ──────────────────────────────────────────

  listPendingActions(): Array<{ id: string; actionType: string; workflowId: string; workflowName: string; queuedAt: number; params: Record<string, unknown> }> {
    return Array.from(this.pendingActions.entries()).map(([id, p]) => ({
      id,
      actionType: p.action.type,
      workflowId: p.workflowId,
      workflowName: p.workflowName,
      queuedAt: p.queuedAt,
      params: p.action.params,
    }));
  }

  discardPendingAction(actionId: string): boolean {
    return this.pendingActions.delete(actionId);
  }

  // Execute a previously gated action after user approval.
  // Re-checks policy before executing — phone/remote approval cannot bypass the guard.
  async executeApprovedAction(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const pending = this.pendingActions.get(actionId);
    if (!pending) return { ok: false, error: 'Pending action not found or already executed.' };

    if (Date.now() - pending.queuedAt > 86_400_000) {
      this.pendingActions.delete(actionId);
      return { ok: false, error: 'Pending action has expired (>24h).' };
    }

    // Re-validate through enforcePolicy — hard-blocked actions cannot proceed even with approval.
    // Approval-gated actions (requiresApproval: true) are allowed to proceed since the user
    // explicitly approved them — that's the entire purpose of the approval queue.
    const recheck = this.enforcePolicy(pending.action);
    if (!recheck.allowed) {
      const isApprovalGated = 'requiresApproval' in recheck && (recheck as { requiresApproval?: boolean }).requiresApproval;
      if (!isApprovalGated) {
        // Hard block — policy forbids this even with approval
        const reason = 'reason' in recheck ? (recheck as { reason: string }).reason : 'policy_changed';
        this._ledger.log('ACTION_BLOCKED', {
          metadata: { workflowId: pending.workflowId, workflowName: pending.workflowName, actionType: pending.action.type, actionId, reason: `recheck:${reason}` },
        }).catch(() => {});
        return { ok: false, error: `Action blocked by current policy: ${reason}` };
      }
      // Approval-gated — user approved it, proceed
    }

    this.pendingActions.delete(actionId);
    try {
      await this.executeActionDirect(pending.action, pending.trigger);
      this._ledger.log('ACTION_EXECUTED', {
        metadata: { workflowId: pending.workflowId, workflowName: pending.workflowName, actionType: pending.action.type, actionId, approved: true },
      }).catch(() => {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Internal: Event Handling ─────────────────────────────────────────────────

  private handleEvent(ev: EngineEvent): void {
    for (const wf of this.workflows) {
      if (!wf.enabled) continue;
      if (!this.matchesTrigger(wf.triggers, ev)) continue;
      const cooldown = wf.cooldownMs ?? 60_000;
      if (wf.lastFiredAt && Date.now() - wf.lastFiredAt < cooldown) continue;
      wf.lastFiredAt = Date.now();
      this.save();
      this.executeWorkflow(wf, ev).catch(() => { /* errors handled inside executeWorkflow */ });
    }
  }

  private matchesTrigger(triggers: TriggerCondition[], ev: EngineEvent): boolean {
    return triggers.some(t => {
      if (t.eventType !== ev.type) return false;
      if (!t.filter) return true;
      const payload = ev as unknown as Record<string, unknown>;
      return Object.entries(t.filter).every(([k, v]) => payload[k] === v);
    });
  }

  private async executeWorkflow(wf: WorkflowDefinition, trigger: EngineEvent): Promise<void> {
    try {
      for (const action of wf.actions) {
        await this.executeAction(action, trigger, wf);
      }
      this.lastFiredWorkflowName = wf.name;
      this.lastFiredAt = Date.now();
      this._ledger.log('WORKFLOW_FIRED', { metadata: { workflowId: wf.id, workflowName: wf.name } }).catch(() => {});
      eventBus.emit({ type: 'WORKFLOW_FIRED', workflowId: wf.id, workflowName: wf.name });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._ledger.log('WORKFLOW_FAILED', { metadata: { workflowId: wf.id, workflowName: wf.name, error: errorMsg } }).catch(() => {});
      eventBus.emit({ type: 'WORKFLOW_FAILED', workflowId: wf.id, error: errorMsg });
      try { this.notifier('TriForge — Workflow Failed', `"${wf.name}" encountered an error.`); } catch { /* ignore */ }
      throw err;
    }
  }

  private async executeAction(action: WorkflowAction, trigger: EngineEvent, wf: WorkflowDefinition): Promise<void> {
    // Primary governance gate — runs before any execution
    const verdict = this.enforcePolicy(action);
    if (!verdict.allowed) {
      if ('requiresApproval' in verdict && verdict.requiresApproval) {
        await this.queueForApproval(action, trigger, wf);
      } else {
        // Hard blocked — no approval path
        this._ledger.log('ACTION_BLOCKED', {
          metadata: { workflowId: wf.id, workflowName: wf.name, actionType: action.type, reason: verdict.reason },
        }).catch(() => {});
        try { this.notifier('TriForge — Action Blocked', `"${action.type}" in "${wf.name}" was blocked by policy.`); } catch { /* ignore */ }
      }
      return;
    }
    // Legacy approval flag (preserved — belt-and-suspenders)
    if (action.requiresApproval || this.isActionBlockedByPolicy(action)) {
      await this.queueForApproval(action, trigger, wf);
      return;
    }
    await this.executeActionDirect(action, trigger);
    this._ledger.log('ACTION_EXECUTED', {
      metadata: { workflowId: wf.id, workflowName: wf.name, actionType: action.type },
    }).catch(() => {});
  }

  private isActionBlockedByPolicy(action: WorkflowAction): boolean {
    const policy = this.riskPolicy;
    switch (action.type) {
      case 'write_file':  return !policy.allowWriteFile;
      case 'post_social': return !policy.allowSocialPost;
      case 'run_tool': {
        const tool = String(action.params['tool'] ?? '');
        if (tool === 'it_script_runner') return !policy.allowScriptRunner;
        if (tool === 'it_processes')     return !policy.allowKillProcess;
        if (tool === 'it_services')      return !policy.allowRestartService;
        return false;
      }
      default: return false;
    }
  }

  // ── Mutation Classifier ───────────────────────────────────────────────────────

  private classifyMutation(action: WorkflowAction): null | {
    type: 'scriptRunner' | 'killProcess' | 'writeFile' | 'externalPost' | 'externalEmail' | 'browserForm';
    detail?: Record<string, unknown>;
  } {
    if (action.type === 'run_tool') {
      const tool = String(action.params['tool'] ?? '');
      const args = action.params['args'] as Record<string, unknown> | undefined;

      if (tool === 'it/scriptRunner' || tool === 'it_script_runner')
        return { type: 'scriptRunner', detail: { tool, args } };
      if ((tool === 'it/processes' || tool === 'it_processes') && args?.['op'] === 'kill')
        return { type: 'killProcess', detail: { tool, args } };
      if ((tool === 'it/services' || tool === 'it_services') &&
          ['restart', 'stop', 'start'].includes(String(args?.['op'] ?? '')))
        return { type: 'scriptRunner', detail: { tool, args } };
      if (tool.startsWith('browser/') &&
          ['fillForm', 'submit', 'click'].includes(String(args?.['op'] ?? '')))
        return { type: 'browserForm', detail: { tool, args } };
    }

    if (action.type === 'write_file')
      return { type: 'writeFile', detail: { path: String(action.params['path'] ?? '') } };
    if (action.type === 'post_social') return { type: 'externalPost' };
    if (action.type === 'send_email')  return { type: 'externalEmail' };

    return null;
  }

  // ── Policy Enforcement Gate (runs before every action execution) ───────────────

  private enforcePolicy(
    action: WorkflowAction,
  ): { allowed: true } | { allowed: false; requiresApproval?: true; reason: string } {
    const mutation = this.classifyMutation(action);
    if (!mutation) return { allowed: true };

    const policy = this.riskPolicy;

    // External side effects always require approval unless policy explicitly allows
    if (mutation.type === 'externalPost') {
      if (!policy.allowSocialPost) return { allowed: false, requiresApproval: true, reason: 'externalPost' };
      return { allowed: true };
    }
    if (mutation.type === 'externalEmail') {
      return { allowed: false, requiresApproval: true, reason: 'externalEmail' };
    }
    if (mutation.type === 'browserForm') {
      if (!policy.allowBrowserFillForm) return { allowed: false, requiresApproval: true, reason: 'browserForm' };
      return { allowed: true };
    }

    // File writes: safe path check first, then policy
    if (mutation.type === 'writeFile') {
      const p = String(action.params['path'] ?? '');
      if (!p || !this.isSafePath(p)) return { allowed: false, requiresApproval: true, reason: 'UNSAFE_PATH' };
      if (!policy.allowWriteFile) return { allowed: false, requiresApproval: true, reason: 'writeFile' };
      return { allowed: true };
    }

    // Script-like actions — default strict (false = needs approval)
    if (mutation.type === 'scriptRunner') {
      if (!policy.allowScriptRunner) return { allowed: false, requiresApproval: true, reason: 'SCRIPT_APPROVAL' };
      return { allowed: true };
    }
    if (mutation.type === 'killProcess') {
      if (!policy.allowKillProcess) return { allowed: false, requiresApproval: true, reason: 'KILL_APPROVAL' };
      return { allowed: true };
    }

    return { allowed: true };
  }

  async queueForApproval(action: WorkflowAction, trigger: EngineEvent, wf: WorkflowDefinition): Promise<string> {
    const actionId = crypto.randomUUID();
    this.pendingActions.set(actionId, {
      action, trigger,
      workflowId: wf.id,
      workflowName: wf.name,
      queuedAt: Date.now(),
    });
    this._ledger.log('ACTION_APPROVAL_REQUIRED', {
      metadata: {
        workflowId: wf.id,
        workflowName: wf.name,
        actionType: action.type,
        actionId,
        tool: action.params['tool'] as string | undefined,
      },
    }).catch(() => {});
    this.notifier(
      'TriForge — Approval Required',
      'Workflow "' + wf.name + '" wants to execute "' + action.type + '". Open TriForge to approve.',
    );
    eventBus.emit({
      type: 'WORKFLOW_APPROVAL_PENDING',
      actionId,
      workflowId: wf.id,
      workflowName: wf.name,
      actionType: action.type,
    });
    return actionId;
  }

  private async executeActionDirect(action: WorkflowAction, trigger: EngineEvent): Promise<void> {
    switch (action.type) {
      case 'ai_task': {
        const goal = String(action.params['goal'] ?? 'Analyze the triggered event and respond appropriately.');
        const category = (action.params['category'] as TaskCategory | undefined) ?? 'general';
        const task = this.agentLoop.createTask(goal, category);
        this.agentLoop.runTask(task.id).catch(() => {});
        break;
      }
      case 'notify': {
        this.notifier(String(action.params['title'] ?? 'TriForge Alert'), String(action.params['body'] ?? ''));
        break;
      }
      case 'queue_approval': {
        this.notifier('TriForge — Approval Required', String(action.params['description'] ?? 'A workflow action needs your approval.'));
        break;
      }
      case 'write_file': {
        const filePath = String(action.params['path'] ?? '');
        const content  = String(action.params['content'] ?? '');
        if (filePath) {
          if (!this.isSafePath(filePath)) {
            throw new Error(`write_file blocked: path "${filePath}" is outside allowed directories.`);
          }
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, 'utf8');
        }
        break;
      }
      default: {
        const handler = this.externalHandlers.get(action.type);
        if (handler) await handler(action.params, trigger);
        break;
      }
    }
  }

  // isSafePath: write_file is only permitted inside dataDir or the user's home directory
  private isSafePath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const allowed = [
      path.resolve(this.dataDir),
      path.resolve(os.homedir()),
    ];
    return allowed.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir);
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private load(): void {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      this.workflows = JSON.parse(raw) as WorkflowDefinition[];
    } catch { this.workflows = []; }
  }

  private save(): void {
    try {
      const tmp = this.storePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.workflows, null, 2), 'utf8');
      fs.renameSync(tmp, this.storePath);
    } catch { /* ignore write errors */ }
  }
}
