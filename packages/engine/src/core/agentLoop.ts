import * as crypto from 'crypto';
import type { AuditLedger } from './auditLedger';
import type { TaskStore } from './taskStore';
import type { TrustModeSnapshot, Task } from './taskTypes';
import type { WalletEngine } from './walletEngine';
import type { ThinkTankPlanner } from './thinkTankPlanner';
import type { TaskToolRegistry } from '../tools/taskRegistry';
import type { ApprovalStore } from './approvalStore';
import { eventBus } from './eventBus';
import { evaluateStepTrust, DEFAULT_TRUST_SNAPSHOT } from './trustEngine';

// ── AgentLoop ─────────────────────────────────────────────────────────────────
// All tool execution runs through runStep() — no other code path.

export class AgentLoop {
  private _approvalStore: ApprovalStore;
  private _runningTaskIds = new Set<string>();
  private _retryInterval?: ReturnType<typeof setInterval>;

  constructor(
    private _store: TaskStore,
    private _planner: ThinkTankPlanner,
    private _registry: TaskToolRegistry,
    private _wallet: WalletEngine,
    private _ledger: AuditLedger,
    approvalStore: ApprovalStore,
  ) {
    this._approvalStore = approvalStore;
  }

  // ── createTask ────────────────────────────────────────────────────────────────

  createTask(goal: string, category: Task['category']): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      goal,
      category,
      status: 'queued',
      currentStepIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this._store.create(task);
    eventBus.emit({ type: 'TASK_CREATED', taskId: task.id, goal, category });
    this._ledger.log('TASK_CREATED', { taskId: task.id, category, metadata: { goal } });
    return task;
  }

  // ── runStep — central execution pipeline ─────────────────────────────────────
  // The ONLY code path that runs a tool. Returns {ok} or {ok:false, error}.

  async runStep(taskId: string, stepId: string): Promise<{ ok: boolean; error?: string }> {
    const task = this._store.read(taskId);
    if (!task) return { ok: false, error: 'Task not found' };

    if (!['running', 'planning'].includes(task.status)) {
      return { ok: false, error: 'Not runnable' };
    }

    if (!task.plan) return { ok: false, error: 'No plan' };

    const steps = [...task.plan.steps];
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return { ok: false, error: 'Step not found' };

    let step = steps[idx];

    // Idempotency: runToken set → crash was mid-execution → reset to pending
    if (step.runToken) {
      step = { ...step, status: 'pending', runToken: undefined, blockedReason: 'Recovered after crash' };
      steps[idx] = step;
      this._store.update(taskId, { plan: { ...task.plan, steps } });
    }

    // Already done?
    if (['completed', 'failed', 'skipped'].includes(step.status)) {
      return { ok: true };
    }

    // Retry pending (nextRetryAt in the future)?
    if (step.nextRetryAt && step.nextRetryAt > Date.now()) {
      return { ok: true }; // retry loop will pick this up
    }

    const trust = task.trustSnapshot ?? DEFAULT_TRUST_SNAPSHOT;

    // ── Trust evaluation ──────────────────────────────────────────────────────
    const wallet = this._wallet.getSnapshot();
    const decision = evaluateStepTrust(task.category, trust, wallet, step);

    if (!decision.allowed) {
      steps[idx] = { ...step, status: 'skipped', blockedReason: decision.reason };
      this._store.update(taskId, { plan: { ...task.plan, steps } });
      eventBus.emit({ type: 'STEP_BLOCKED', taskId, stepId, reason: decision.reason });
      this._ledger.log('STEP_BLOCKED', { taskId, stepId, category: task.category, metadata: { reason: decision.reason } });
      return { ok: true };
    }

    if (decision.requiresApproval) {
      // Check wallet before reserving
      const budgetCents = trust[task.category].dailyBudgetCents;
      if (!this._wallet.canSpend(task.category, decision.reservedCents, budgetCents)) {
        const reason = `Daily budget exceeded for ${task.category}`;
        steps[idx] = { ...step, status: 'skipped', blockedReason: reason };
        this._store.update(taskId, { plan: { ...task.plan, steps } });
        eventBus.emit({ type: 'STEP_BLOCKED', taskId, stepId, reason });
        this._ledger.log('STEP_BLOCKED', { taskId, stepId, category: task.category, metadata: { reason } });
        return { ok: true };
      }

      // Reserve budget
      this._wallet.reserve(task.category, decision.reservedCents);
      this._ledger.log('BUDGET_RESERVED', { taskId, stepId, category: task.category, metadata: { cents: decision.reservedCents } });

      // Create approval token
      const approvalReq = this._approvalStore.create({
        taskId,
        stepId,
        tool: step.tool,
        args: step.args,
        riskLevel: step.riskLevel,
        estimatedCostCents: step.estimatedCostCents,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      steps[idx] = { ...step, status: 'awaiting_approval', requiresApproval: true };
      this._store.update(taskId, {
        status: 'awaiting_approval',
        currentStepIndex: idx,
        plan: { ...task.plan, steps },
      });

      eventBus.emit({ type: 'APPROVAL_REQUIRED', taskId, stepId, step: steps[idx], approvalId: approvalReq.id });
      eventBus.emit({ type: 'APPROVAL_CREATED', taskId, stepId, approvalId: approvalReq.id, expiresAt: approvalReq.expiresAt });
      this._ledger.log('STEP_APPROVAL_REQUESTED', { taskId, stepId, category: task.category });
      this._ledger.log('APPROVAL_CREATED', { taskId, stepId, metadata: { approvalId: approvalReq.id, expiresAt: approvalReq.expiresAt } });

      return { ok: false, error: 'awaiting_approval' };
    }

    // ── Execute step ──────────────────────────────────────────────────────────

    // Set runToken before execution (idempotency guard)
    const runToken = crypto.randomUUID();
    const attempts = (step.attempts ?? 0) + 1;
    steps[idx] = { ...step, status: 'running', startedAt: Date.now(), runToken, attempts };
    this._store.update(taskId, { currentStepIndex: idx, plan: { ...task.plan, steps } });

    eventBus.emit({ type: 'STEP_STARTED', taskId, stepId, title: step.title });
    eventBus.emit({ type: 'TOOL_CALLED', taskId, stepId, tool: step.tool, args: step.args });
    this._ledger.log('STEP_STARTED', { taskId, stepId, tool: step.tool, category: task.category });
    this._ledger.log('TOOL_CALLED', { taskId, stepId, tool: step.tool, metadata: { args: step.args } });

    try {
      const result = await this._registry.run(step.tool, step.args, {
        taskId,
        stepId,
        category: task.category,
      });

      // Success — commit budget
      if (decision.reservedCents > 0) {
        this._wallet.commit(task.category, decision.reservedCents);
        this._ledger.log('BUDGET_COMMITTED', { taskId, stepId, category: task.category, metadata: { cents: decision.reservedCents } });
        eventBus.emit({ type: 'WALLET_UPDATED', snapshot: this._wallet.getSnapshot() });
      }

      // Reload steps fresh to avoid stale reference
      const freshTask = this._store.read(taskId)!;
      const freshSteps = [...freshTask.plan!.steps];
      freshSteps[idx] = { ...freshSteps[idx], status: 'completed', result, completedAt: Date.now(), runToken: undefined };
      this._store.update(taskId, { plan: { ...freshTask.plan!, steps: freshSteps } });

      eventBus.emit({ type: 'TOOL_RESULT', taskId, stepId, result });
      eventBus.emit({ type: 'STEP_COMPLETED', taskId, stepId, result });
      this._ledger.log('STEP_COMPLETED', { taskId, stepId, category: task.category });

      return { ok: true };

    } catch (err) {
      const error = String(err);

      // Release reserved budget on failure
      if (decision.reservedCents > 0) {
        this._wallet.release(task.category, decision.reservedCents);
        this._ledger.log('BUDGET_RELEASED', { taskId, stepId, category: task.category, metadata: { cents: decision.reservedCents } });
      }

      // Reload fresh
      const freshTask2 = this._store.read(taskId)!;
      const freshSteps2 = [...freshTask2.plan!.steps];
      const currentStep = freshSteps2[idx];
      const maxAttempts = currentStep.maxAttempts ?? 3;

      if (attempts >= maxAttempts) {
        // Permanent failure
        freshSteps2[idx] = { ...currentStep, status: 'failed', error, completedAt: Date.now(), runToken: undefined };
        this._store.update(taskId, { plan: { ...freshTask2.plan!, steps: freshSteps2 } });
        eventBus.emit({ type: 'STEP_FAILED', taskId, stepId, error });
        this._ledger.log('STEP_FAILED', { taskId, stepId, metadata: { error } });
        return { ok: false, error };
      } else {
        // Schedule retry with backoff: 0s / 15s / 60s
        const backoffSchedule = [0, 15_000, 60_000];
        const backoff = backoffSchedule[attempts - 1] ?? 60_000;
        const nextRetryAt = Date.now() + backoff;
        freshSteps2[idx] = { ...currentStep, status: 'pending', nextRetryAt, error, runToken: undefined };
        this._store.update(taskId, { plan: { ...freshTask2.plan!, steps: freshSteps2 } });
        eventBus.emit({ type: 'STEP_RETRY_SCHEDULED', taskId, stepId, attempt: attempts, nextRetryAt });
        this._ledger.log('STEP_RETRY_SCHEDULED', { taskId, stepId, metadata: { attempt: attempts, nextRetryAt } });
        return { ok: true }; // not a permanent failure — retry loop will handle
      }
    }
  }

  // ── runTask ────────────────────────────────────────────────────────────────────

  async runTask(taskId: string, trustOverride?: TrustModeSnapshot): Promise<void> {
    // Concurrent guard — prevent double-run of same task
    if (this._runningTaskIds.has(taskId)) return;
    this._runningTaskIds.add(taskId);

    try {
      let task = this._store.read(taskId);
      if (!task) return;

      // Only run tasks in a startable state
      if (!['queued', 'pending', 'planning', 'running', 'paused'].includes(task.status)) return;

      // Store trust override
      if (trustOverride) {
        task = this._store.update(taskId, { trustSnapshot: trustOverride })!;
      }

      // Transition to planning
      if (task.status === 'queued' || task.status === 'pending') {
        task = this._store.update(taskId, { status: 'planning' })!;
      }

      // Generate plan if not done
      if (!task.plan) {
        try {
          const plan = await this._planner.makePlan(task.goal, task.category);
          task = this._store.update(taskId, { plan, status: 'running' })!;
          eventBus.emit({ type: 'TASK_PLAN_READY', taskId, plan });
          this._ledger.log('PLAN_CREATED', { taskId, category: task.category, metadata: { stepCount: plan.steps.length, agreementScore: plan.agreementScore } });
        } catch (err) {
          const error = String(err);
          this._store.update(taskId, { status: 'failed', error });
          eventBus.emit({ type: 'TASK_FAILED', taskId, error });
          this._ledger.log('TASK_FAILED', { taskId, metadata: { error } });
          return;
        }
      } else {
        // Resume: ensure running state
        if (['planning', 'paused'].includes(task.status)) {
          task = this._store.update(taskId, { status: 'running' })!;
        }
      }

      eventBus.emit({ type: 'TASK_STARTED', taskId });
      this._ledger.log('TASK_STARTED', { taskId, category: task.category });

      // Execute steps
      task = this._store.read(taskId)!;
      const stepCount = task.plan!.steps.length;

      for (let i = task.currentStepIndex ?? 0; i < stepCount; i++) {
        // Reload each iteration to pick up external changes (cancel, etc.)
        task = this._store.read(taskId)!;
        if (!task) break;

        if (task.status === 'cancelled') {
          eventBus.emit({ type: 'TASK_CANCELLED', taskId });
          this._ledger.log('TASK_CANCELLED', { taskId, category: task.category });
          return;
        }

        const step = task.plan!.steps[i];

        // Skip already-done steps
        if (['completed', 'skipped', 'failed'].includes(step.status)) continue;

        // Skip steps with a future retry scheduled
        if (step.status === 'pending' && step.nextRetryAt && step.nextRetryAt > Date.now()) continue;

        this._store.update(taskId, { currentStepIndex: i });

        const { ok, error } = await this.runStep(taskId, step.id);

        if (error === 'awaiting_approval') {
          return; // paused — caller approves then calls runTask again
        }

        if (!ok) {
          // Check if step permanently failed
          const updatedTask = this._store.read(taskId)!;
          const updatedStep = updatedTask.plan!.steps[i];
          if (updatedStep.status === 'failed') {
            const finalError = `Step "${step.title}" failed: ${updatedStep.error}`;
            this._store.update(taskId, { status: 'failed', error: finalError });
            eventBus.emit({ type: 'TASK_FAILED', taskId, error: finalError });
            this._ledger.log('TASK_FAILED', { taskId, metadata: { error: finalError } });
            return;
          }
        }
      }

      // After loop — check for pending retries
      task = this._store.read(taskId)!;
      const hasPendingRetries = task.plan?.steps.some(
        s => s.status === 'pending' && s.nextRetryAt && s.nextRetryAt > Date.now()
      );
      if (hasPendingRetries) {
        return; // retry loop will continue this task
      }

      // Finalize
      const anyFailed = task.plan!.steps.some(s => s.status === 'failed');
      const finalStatus = anyFailed ? 'failed' : 'completed';
      const finalError = anyFailed ? 'One or more steps failed' : undefined;

      this._store.update(taskId, { status: finalStatus, error: finalError });

      if (finalStatus === 'completed') {
        eventBus.emit({ type: 'TASK_COMPLETED', taskId });
        this._ledger.log('TASK_COMPLETED', { taskId, category: task.category });
      } else {
        eventBus.emit({ type: 'TASK_FAILED', taskId, error: finalError! });
        this._ledger.log('TASK_FAILED', { taskId, category: task.category, metadata: { error: finalError } });
      }

    } finally {
      this._runningTaskIds.delete(taskId);
    }
  }

  // ── Approval token methods ────────────────────────────────────────────────────

  async approveApprovalRequest(approvalId: string): Promise<void> {
    const req = this._approvalStore.get(approvalId);
    if (!req || req.status !== 'pending') throw new Error(`Approval ${approvalId} not found or not pending`);
    if (req.expiresAt < Date.now()) throw new Error(`Approval ${approvalId} has expired`);

    this._approvalStore.update(approvalId, { status: 'approved', respondedAt: Date.now() });

    const task = this._store.read(req.taskId);
    if (!task?.plan) return;

    const steps = [...task.plan.steps];
    const idx = steps.findIndex(s => s.id === req.stepId);
    if (idx === -1) return;

    steps[idx] = { ...steps[idx], status: 'pending', requiresApproval: false };
    this._store.update(req.taskId, {
      status: 'running',
      plan: { ...task.plan, steps },
    });

    eventBus.emit({ type: 'STEP_APPROVED', taskId: req.taskId, stepId: req.stepId });
    this._ledger.log('STEP_APPROVED', { taskId: req.taskId, stepId: req.stepId, category: task.category });
  }

  async denyApprovalRequest(approvalId: string, reason?: string): Promise<void> {
    const req = this._approvalStore.get(approvalId);
    if (!req || req.status !== 'pending') throw new Error(`Approval ${approvalId} not found or not pending`);

    this._approvalStore.update(approvalId, { status: 'denied', respondedAt: Date.now(), reason });

    const task = this._store.read(req.taskId);
    if (!task?.plan) return;

    // Release reserved budget
    if (req.estimatedCostCents > 0) {
      this._wallet.release(task.category, req.estimatedCostCents);
      this._ledger.log('BUDGET_RELEASED', { taskId: req.taskId, stepId: req.stepId, category: task.category, metadata: { cents: req.estimatedCostCents } });
    }

    // Skip step and resume
    const steps = [...task.plan.steps];
    const idx = steps.findIndex(s => s.id === req.stepId);
    if (idx !== -1) {
      steps[idx] = { ...steps[idx], status: 'skipped' };
      this._store.update(req.taskId, {
        status: 'running',
        plan: { ...task.plan, steps },
      });
    }

    eventBus.emit({ type: 'STEP_DENIED', taskId: req.taskId, stepId: req.stepId, reason });
    this._ledger.log('STEP_DENIED', { taskId: req.taskId, stepId: req.stepId, category: task.category, metadata: { reason } });
  }

  // ── Task control ──────────────────────────────────────────────────────────────

  async pauseTask(taskId: string): Promise<void> {
    const task = this._store.read(taskId);
    if (!task) return;
    if (['queued', 'running', 'planning'].includes(task.status)) {
      this._store.update(taskId, { status: 'paused' });
      eventBus.emit({ type: 'TASK_PAUSED', taskId });
      this._ledger.log('TASK_PAUSED', { taskId, category: task.category });
    }
  }

  async resumeTask(taskId: string): Promise<void> {
    const task = this._store.read(taskId);
    if (!task) return;
    if (task.status === 'paused') {
      this._store.update(taskId, { status: 'running' });
      eventBus.emit({ type: 'TASK_RESUMED', taskId });
      this._ledger.log('TASK_RESUMED', { taskId, category: task.category });
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this._store.read(taskId);
    if (!task) return;
    this._store.update(taskId, { status: 'cancelled' });
    eventBus.emit({ type: 'TASK_CANCELLED', taskId });
    this._ledger.log('TASK_CANCELLED', { taskId, category: task.category });
  }

  // ── Retry loop ────────────────────────────────────────────────────────────────

  startRetryLoop(): void {
    if (this._retryInterval) return;
    this._retryInterval = setInterval(() => {
      const tasks = this._store.list();
      for (const task of tasks) {
        if (!['running', 'planning', 'queued', 'pending'].includes(task.status)) continue;
        if (this._runningTaskIds.has(task.id)) continue;

        const hasReadyRetry = task.plan?.steps.some(
          s => s.status === 'pending' && s.nextRetryAt && s.nextRetryAt <= Date.now()
        );
        if (!hasReadyRetry) continue;

        this.runTask(task.id).catch(err => {
          console.error('[AgentLoop] retry loop error:', err);
        });
      }
    }, 30_000);
  }

  // ── Backward compat shims ─────────────────────────────────────────────────────

  async approveStep(taskId: string, stepId: string): Promise<void> {
    const req = this._approvalStore.getByStep(taskId, stepId);
    if (req) {
      await this.approveApprovalRequest(req.id);
      return;
    }

    // Fallback: directly reset step
    const task = this._store.read(taskId);
    if (!task?.plan) return;
    const steps = [...task.plan.steps];
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    steps[idx] = { ...steps[idx], status: 'pending', requiresApproval: false };
    this._store.update(taskId, { status: 'running', plan: { ...task.plan, steps } });
    eventBus.emit({ type: 'STEP_APPROVED', taskId, stepId });
    this._ledger.log('STEP_APPROVED', { taskId, stepId, category: task.category });
  }

  async denyStep(taskId: string, stepId: string, reason?: string): Promise<void> {
    const req = this._approvalStore.getByStep(taskId, stepId);
    if (req) {
      await this.denyApprovalRequest(req.id, reason);
      return;
    }

    // Fallback: directly skip step
    const task = this._store.read(taskId);
    if (!task?.plan) return;
    const steps = [...task.plan.steps];
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    const step = steps[idx];
    if (step.estimatedCostCents > 0) {
      this._wallet.release(task.category, step.estimatedCostCents);
      this._ledger.log('BUDGET_RELEASED', { taskId, stepId, category: task.category, metadata: { cents: step.estimatedCostCents } });
    }
    steps[idx] = { ...step, status: 'skipped' };
    this._store.update(taskId, { status: 'running', plan: { ...task.plan, steps } });
    eventBus.emit({ type: 'STEP_DENIED', taskId, stepId, reason });
    this._ledger.log('STEP_DENIED', { taskId, stepId, category: task.category, metadata: { reason } });
  }
}
