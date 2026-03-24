/**
 * runbookExecutor.ts — Phase 34
 *
 * Branch-aware runbook executor with deadline support.
 *
 * Branching contract:
 *   Every step may declare onSuccess/onFailure/onRejection/onTimeout step IDs.
 *   After a step completes the executor resolves the next step by ID rather than
 *   advancing to the next array index. Steps not reached are marked 'skipped'.
 *   Branch decisions are recorded in exec.branchDecisions for audit + UI.
 *
 * Pause/resume contract (Phase 32, preserved):
 *   wait_approval / wait_confirm / deadline_wait pause the execution, create a
 *   HandoffQueueItem, and return immediately.  resumeExecution() re-enters from
 *   the step after the paused one, honouring any onRejection/onTimeout branch.
 *
 * Deadline contract (Phase 33):
 *   Steps with timeoutSecs store exec.deadlineAt.  The RunbookScheduler (external)
 *   calls resolveTimeout() when the clock expires, which resumes via the onTimeout
 *   branch or fails the execution.  escalateAfterSecs triggers a soft escalation
 *   (Slack + push) without resuming.
 *
 * Condition step:
 *   params.condition — a ConditionExpr string evaluated against live exec state.
 *   params.on_true / params.on_false — step IDs to jump to.
 *
 * Goto step:
 *   params.target_step_id — unconditional jump.
 *
 * Escalate step:
 *   Sends Slack + push, records escalation, continues.
 *
 * Retry step:
 *   params.target_step_id — re-executes that step inline once more.
 */

import type { Store } from './store';
import {
  type RunbookDef,
  type RunbookExecution,
  type RunbookStepExecution,
  type RunbookStep,
  type RunbookStepStatus,
  type HandoffQueueItem,
  type BranchDecision,
  makeExecutionId,
  makePauseTokenId,
} from './runbooks';
import {
  buildTemplateContext,
  buildRuntimeVars,
  resolveParams,
  resolveTemplate,
  evalParameterisedCondition,
  type TemplateContext,
} from './runbookTemplate';

// ── Step handler interface (injected by ipc.ts) ───────────────────────────────

export interface RunbookStepHandlers {
  runRecipe(id: string, via: string): Promise<{ ok: boolean; result?: string; error?: string }>;
  runMission(id: string): Promise<{ ok: boolean; error?: string }>;
  sendSlack(channel: string, text: string): Promise<{ ok: boolean; error?: string }>;
  createJira(projectKey: string, issueType: string, summary: string, body: string): Promise<{ ok: boolean; error?: string }>;
  createLinear(teamId: string, title: string, description: string): Promise<{ ok: boolean; error?: string }>;
  notifyPush(title: string, body: string): Promise<{ ok: boolean; error?: string }>;
  addHandoffItem(item: HandoffQueueItem): void;
  resolveHandoffItem(id: string, resolution: string, resolvedBy?: string): boolean;
  auditLog(type: string, meta: Record<string, unknown>): void;
}

type StepResult = {
  ok:        boolean;
  result?:   string;              // human-readable summary
  error?:    string;
  captured?: Record<string, string>; // Phase 34: structured outputs to store in exec.vars
};

// ── Executor ──────────────────────────────────────────────────────────────────

export class RunbookExecutor {
  constructor(
    private store: Store,
    private handlers: RunbookStepHandlers,
  ) {}

  // ── Start a fresh execution ────────────────────────────────────────────────

  async run(
    def:        RunbookDef,
    actorId:    string | null,
    actorLabel: string | null,
    isRemote:   boolean,
    launchVars: Record<string, string> = {},
  ): Promise<RunbookExecution> {
    const incidentState = this.store.getIncidentMode();
    const isIncident    = def.incidentMode || incidentState.active;
    const executionId   = makeExecutionId();
    const via           = actorId ? `device:${actorId}` : 'desktop';

    // Phase 34 — build runtime vars from declared defaults + launch inputs
    const { vars, missing } = buildRuntimeVars(def.variables ?? [], launchVars);
    if (missing.length > 0) {
      const stub: RunbookExecution = {
        id: executionId, runbookId: def.id, runbookTitle: def.title,
        status: 'failed', startedAt: Date.now(), completedAt: Date.now(),
        isIncident, currentStepIdx: 0, steps: [],
        error: `Missing required variables: ${missing.join(', ')}`,
        vars, stepOutputs: {},
      };
      this.store.saveRunbookExecution(stub);
      return stub;
    }

    const exec: RunbookExecution = {
      id:              executionId,
      runbookId:       def.id,
      runbookTitle:    def.title,
      status:          'running',
      startedAt:       Date.now(),
      actorId:         actorId ?? undefined,
      actorLabel:      actorLabel ?? undefined,
      isIncident,
      currentStepIdx:  0,
      currentStepId:   def.steps[0]?.id,
      steps:           def.steps.map(s => ({
        stepId:  s.id,
        type:    s.type,
        label:   s.label,
        status:  'pending' as RunbookStepStatus,
      })),
      branchDecisions: [],
      escalationCount: 0,
      vars,
      stepOutputs:     {},
      // Phase 35 — stamp pack provenance at run time
      packId:          def.packId,
      packVersion:     def.packVersion,
    };

    this.store.saveRunbookExecution(exec);
    this.handlers.auditLog('RUNBOOK_STARTED', {
      runbookId:   def.id,
      executionId: exec.id,
      actorId,
      isIncident,
      isRemote,
      vars:        Object.keys(vars),   // log var names (not values)
      workspaceId: this.store.getWorkspace()?.id,
    });

    // Find first step — startStepId defaults to first in array
    const startIdx = 0;
    return this._runFromStepIdx(def, exec, startIdx, via);
  }

  // ── Resume a paused execution ──────────────────────────────────────────────

  async resumeExecution(
    executionId: string,
    actorId:     string | null,
    actorLabel:  string | null,
    resolution:  string,
  ): Promise<RunbookExecution | null> {
    const exec = this._loadExecution(executionId);
    if (!exec) return null;

    const isPaused =
      exec.status === 'paused_approval' ||
      exec.status === 'paused_confirm'  ||
      exec.status === 'paused_manual';
    if (!isPaused) return exec;

    const def = this.store.getRunbook(exec.runbookId);
    if (!def) {
      exec.status      = 'failed';
      exec.error       = 'Runbook definition not found on resume';
      exec.completedAt = Date.now();
      this.store.saveRunbookExecution(exec);
      return exec;
    }

    const pausedIdx  = exec.pausedAtStepIdx ?? exec.currentStepIdx;
    const pausedStep = def.steps[pausedIdx];
    const stepExec   = exec.steps[pausedIdx];

    // Resolve open handoff item
    if (exec.pauseTokenId) {
      this.handlers.resolveHandoffItem(exec.pauseTokenId, resolution, actorId ?? undefined);
    }

    const via = actorId ? `device:${actorId}` : 'desktop';

    // Determine next step based on resolution + branch routing
    let nextStepId: string | undefined;
    let branchType: BranchDecision['branchType'] = 'success';
    let branchReason = `Resolved by ${actorLabel ?? actorId ?? 'operator'} with '${resolution}'`;

    if (resolution === 'rejected' || resolution === 'timeout') {
      branchType = resolution === 'rejected' ? 'rejection' : 'timeout';
      const routingKey = resolution === 'rejected' ? pausedStep?.onRejection : pausedStep?.onTimeout;
      if (routingKey) {
        nextStepId = routingKey;
      } else {
        // No fallback branch — fail the execution
        if (stepExec) {
          stepExec.status      = 'failed';
          stepExec.error       = `${resolution === 'rejected' ? 'Rejected' : 'Timed out'} — no fallback branch configured`;
          stepExec.completedAt = Date.now();
        }
        exec.status      = 'failed';
        exec.error       = `Step '${pausedStep?.label ?? '?'}' ${resolution === 'rejected' ? 'rejected' : 'timed out'} with no fallback`;
        exec.completedAt = Date.now();
        this._clearPauseState(exec);
        this._skipRemaining(exec, pausedIdx + 1);
        this.store.saveRunbookExecution(exec);
        this.handlers.auditLog('RUNBOOK_FAILED', {
          runbookId: def.id, executionId: exec.id, error: exec.error, actorId,
          workspaceId: this.store.getWorkspace()?.id,
        });
        return exec;
      }
    } else {
      // Approved / confirmed / manual — mark step as attention
      if (stepExec) {
        stepExec.status      = 'attention';
        stepExec.result      = `Resolved by ${actorLabel ?? actorId ?? 'operator'}: ${resolution}`;
        stepExec.completedAt = Date.now();
      }
      // Follow onSuccess if set, else next sequential
      nextStepId = pausedStep?.onSuccess;
    }

    // Record branch decision if we're jumping away from sequential order
    if (nextStepId && pausedStep) {
      const nextIdx = def.steps.findIndex(s => s.id === nextStepId);
      if (nextIdx !== -1 && nextIdx !== pausedIdx + 1) {
        const decision: BranchDecision = {
          fromStepId: pausedStep.id,
          toStepId:   nextStepId,
          branchType,
          reason:     branchReason,
          decidedAt:  Date.now(),
        };
        exec.branchDecisions = [...(exec.branchDecisions ?? []), decision];
        if (stepExec) {
          stepExec.branchedTo = nextStepId;
        }
        this.handlers.auditLog('RUNBOOK_BRANCH_TAKEN', {
          runbookId: def.id, executionId: exec.id, fromStepId: pausedStep.id,
          toStepId: nextStepId, branchType, actorId,
        });
      }
    }

    this._clearPauseState(exec);
    exec.status = 'running';
    this.store.saveRunbookExecution(exec);

    this.handlers.auditLog('RUNBOOK_RESUMED', {
      runbookId: def.id, executionId: exec.id, resumedBy: actorId,
      resolution, pausedStepId: pausedStep?.id, nextStepId,
      workspaceId: this.store.getWorkspace()?.id,
    });

    // Find the next step index
    let nextIdx = pausedIdx + 1;
    if (nextStepId) {
      const found = def.steps.findIndex(s => s.id === nextStepId);
      if (found !== -1) nextIdx = found;
    }
    return this._runFromStepIdx(def, exec, nextIdx, via);
  }

  // ── Timeout resolution (called by RunbookScheduler) ───────────────────────

  async resolveTimeout(executionId: string): Promise<RunbookExecution | null> {
    const exec = this._loadExecution(executionId);
    if (!exec) return null;
    if (exec.status !== 'paused_approval' && exec.status !== 'paused_confirm' && exec.status !== 'paused_manual') {
      return exec;
    }
    return this.resumeExecution(executionId, null, 'scheduler', 'timeout');
  }

  // ── Fire soft escalation (called by RunbookScheduler) ────────────────────

  async fireEscalation(executionId: string): Promise<void> {
    const exec = this._loadExecution(executionId);
    if (!exec) return;
    if (exec.status !== 'paused_approval' && exec.status !== 'paused_confirm' && exec.status !== 'paused_manual') return;

    const def = this.store.getRunbook(exec.runbookId);
    const pausedStep = def?.steps[exec.pausedAtStepIdx ?? exec.currentStepIdx];

    const escalationText = `[SLA Escalation] Runbook: **${exec.runbookTitle}** — step: ${pausedStep?.label ?? '?'} is overdue. Execution ID: ${executionId}`;
    if (def?.escalationChannel) {
      await this.handlers.sendSlack(def.escalationChannel, escalationText).catch(() => {});
    }
    await this.handlers.notifyPush(`Overdue: ${exec.runbookTitle}`, `Step '${pausedStep?.label ?? '?'}' requires attention`).catch(() => {});

    exec.escalatedAt     = Date.now();
    exec.escalationCount = (exec.escalationCount ?? 0) + 1;
    this.store.saveRunbookExecution(exec);

    // Update the handoff item in-place
    if (exec.pauseTokenId) {
      this.store.patchHandoffItem(exec.pauseTokenId, {
        escalatedAt:     exec.escalatedAt,
        escalationCount: exec.escalationCount,
      });
    }

    this.handlers.auditLog('RUNBOOK_DEADLINE_ESCALATED', {
      runbookId: exec.runbookId, executionId, escalationCount: exec.escalationCount,
      pausedStepId: pausedStep?.id, escalationChannel: def?.escalationChannel,
    });
  }

  // ── Abort an execution ────────────────────────────────────────────────────

  async abortExecution(
    executionId: string,
    actorId:     string | null,
  ): Promise<RunbookExecution | null> {
    const exec = this._loadExecution(executionId);
    if (!exec) return null;
    if (exec.status === 'completed' || exec.status === 'cancelled' || exec.status === 'failed') {
      return exec;
    }
    if (exec.pauseTokenId) {
      this.handlers.resolveHandoffItem(exec.pauseTokenId, 'aborted', actorId ?? undefined);
    }
    const fromIdx = exec.pausedAtStepIdx ?? exec.currentStepIdx;
    this._skipRemaining(exec, fromIdx);
    exec.status      = 'cancelled';
    exec.completedAt = Date.now();
    this._clearPauseState(exec);
    this.store.saveRunbookExecution(exec);
    this.handlers.auditLog('RUNBOOK_ABORTED', {
      runbookId: exec.runbookId, executionId: exec.id, abortedBy: actorId,
      workspaceId: this.store.getWorkspace()?.id,
    });
    return exec;
  }

  // ── Internal: run steps from a given array index ──────────────────────────

  /** Build a fresh TemplateContext from current exec state. */
  private _makeCtx(def: RunbookDef, exec: RunbookExecution): TemplateContext {
    const incident = this.store.getIncidentMode();
    const ws       = this.store.getWorkspace();
    return buildTemplateContext(
      exec, def,
      incident.active,
      incident.reason ?? '',
      ws?.name ?? '',
    );
  }

  private async _runFromStepIdx(
    def:      RunbookDef,
    exec:     RunbookExecution,
    fromIdx:  number,
    via:      string,
  ): Promise<RunbookExecution> {
    // Build step-ID → index map for O(1) branch resolution
    const stepIdxMap = new Map<string, number>(def.steps.map((s, i) => [s.id, i]));

    let idx = fromIdx;

    while (idx < def.steps.length) {
      const step     = def.steps[idx];
      const stepExec = exec.steps[idx];

      // Already resolved by a prior branch — skip
      if (stepExec.status !== 'pending') {
        idx++;
        continue;
      }

      exec.currentStepIdx = idx;
      exec.currentStepId  = step.id;
      stepExec.status     = 'running';
      stepExec.startedAt  = Date.now();
      this.store.saveRunbookExecution(exec);

      this.handlers.auditLog('RUNBOOK_STEP_STARTED', {
        runbookId: def.id, executionId: exec.id, stepId: step.id,
        stepType: step.type, stepLabel: step.label, stepIdx: idx,
      });

      // ── Pausing steps ────────────────────────────────────────────────────
      if (step.type === 'wait_approval' || step.type === 'wait_confirm' || step.type === 'deadline_wait') {
        return this._pauseAtStep(def, exec, step, idx, via);
      }

      // ── goto_step ───────────────────────────────────────────────────────
      if (step.type === 'goto_step') {
        const targetId = step.params['target_step_id'] ?? '';
        const targetIdx = targetId ? stepIdxMap.get(targetId) : undefined;
        stepExec.status      = 'completed';
        stepExec.result      = `Jumped to step: ${targetId}`;
        stepExec.completedAt = Date.now();
        if (targetIdx !== undefined && targetIdx !== idx + 1) {
          this._recordBranch(exec, step.id, targetId, 'goto', 'goto_step instruction', stepExec);
          this.handlers.auditLog('RUNBOOK_BRANCH_TAKEN', {
            runbookId: def.id, executionId: exec.id,
            fromStepId: step.id, toStepId: targetId, branchType: 'goto',
          });
          // Skip steps between current and target
          this._markSkippedRange(exec, idx + 1, targetIdx);
          idx = targetIdx;
        } else {
          idx++;
        }
        this.store.saveRunbookExecution(exec);
        continue;
      }

      // ── condition ────────────────────────────────────────────────────────
      if (step.type === 'condition') {
        const condExpr  = (step.params['condition'] ?? 'always_false') as ConditionExpr;
        const onTrue    = step.params['on_true']  ?? step.onSuccess;
        const onFalse   = step.params['on_false'] ?? step.onFailure;
        const result    = this._evalCondition(condExpr, exec, idx);
        const branchId  = result ? onTrue : onFalse;
        const bType     = result ? 'condition_true' : 'condition_false';
        stepExec.status      = 'completed';
        stepExec.result      = `Condition '${condExpr}' → ${result ? 'TRUE' : 'FALSE'}${branchId ? `, branching to ${branchId}` : ''}`;
        stepExec.completedAt = Date.now();
        this.handlers.auditLog('RUNBOOK_CONDITION_EVALUATED', {
          runbookId: def.id, executionId: exec.id,
          stepId: step.id, condition: condExpr, result, branchId,
        });
        if (branchId) {
          const branchIdx = stepIdxMap.get(branchId);
          if (branchIdx !== undefined && branchIdx !== idx + 1) {
            this._recordBranch(exec, step.id, branchId, bType as BranchDecision['branchType'], `condition '${condExpr}' = ${result}`, stepExec);
            this.handlers.auditLog('RUNBOOK_BRANCH_TAKEN', {
              runbookId: def.id, executionId: exec.id,
              fromStepId: step.id, toStepId: branchId, branchType: bType,
            });
            this._markSkippedRange(exec, idx + 1, branchIdx);
            idx = branchIdx;
          } else {
            idx++;
          }
        } else {
          idx++;
        }
        this.store.saveRunbookExecution(exec);
        continue;
      }

      // ── escalate ─────────────────────────────────────────────────────────
      if (step.type === 'escalate') {
        const channel = step.params['channel'] ?? def.escalationChannel ?? '';
        const msg     = step.params['message'] ?? `[Escalation] Runbook: **${def.title}** — ${step.label}`;
        const pushTitle = step.params['push_title'] ?? `Escalation: ${def.title}`;
        const pushBody  = step.params['push_body']  ?? step.label;
        if (channel) await this.handlers.sendSlack(channel, msg).catch(() => {});
        await this.handlers.notifyPush(pushTitle, pushBody).catch(() => {});
        exec.escalationCount = (exec.escalationCount ?? 0) + 1;
        stepExec.status      = 'completed';
        stepExec.result      = `Escalation fired${channel ? ` to ${channel}` : ''} (count: ${exec.escalationCount})`;
        stepExec.completedAt = Date.now();
        this.handlers.auditLog('RUNBOOK_ESCALATED', {
          runbookId: def.id, executionId: exec.id, stepId: step.id,
          escalationChannel: channel, escalationCount: exec.escalationCount,
        });
        idx = this._nextIdx(def, exec, step, idx, true, stepExec, stepIdxMap);
        this.store.saveRunbookExecution(exec);
        continue;
      }

      // ── retry_step ───────────────────────────────────────────────────────
      if (step.type === 'retry_step') {
        const targetId  = step.params['target_step_id'] ?? '';
        const targetIdx = targetId ? stepIdxMap.get(targetId) : undefined;
        if (targetIdx === undefined || targetIdx >= idx) {
          stepExec.status = 'failed';
          stepExec.error  = `retry_step: target step '${targetId}' not found or is ahead`;
          stepExec.completedAt = Date.now();
          this.handlers.auditLog('RUNBOOK_STEP_FAILED', {
            runbookId: def.id, executionId: exec.id, stepId: step.id, error: stepExec.error,
          });
          if (!step.optional) {
            return this._failExecution(def, exec, `Step '${step.label}' failed: ${stepExec.error}`, idx);
          }
          idx++;
          this.store.saveRunbookExecution(exec);
          continue;
        }
        // Reset the target step and re-run it inline
        const targetStepExec = exec.steps[targetIdx];
        const targetStep     = def.steps[targetIdx];
        targetStepExec.status  = 'pending';
        targetStepExec.error   = undefined;
        targetStepExec.result  = undefined;
        this.handlers.auditLog('RUNBOOK_STEP_RETRIED', {
          runbookId: def.id, executionId: exec.id, retryStepId: targetId,
          triggeredByStep: step.id,
        });
        stepExec.status = 'completed';
        stepExec.result = `Retrying step: ${targetId}`;
        stepExec.completedAt = Date.now();
        // Jump back to the target for re-execution — continue loop
        this._markSkippedRange(exec, idx + 1, targetIdx);
        idx = targetIdx;
        this.store.saveRunbookExecution(exec);
        continue;
      }

      // ── Regular steps ────────────────────────────────────────────────────
      try {
        // Phase 34: resolve params through template engine before execution
        const ctx            = this._makeCtx(def, exec);
        const resolvedStep   = { ...step, params: resolveParams(step.params, ctx) };
        const result = await this._executeStep(resolvedStep, via, def, exec);
        if (result.ok) {
          stepExec.status      = 'completed';
          stepExec.result      = result.result ?? 'OK';
          stepExec.completedAt = Date.now();
          // Phase 34: capture step output to exec.stepOutputs and optional exec.vars[outputKey]
          if (result.result) {
            exec.stepOutputs = exec.stepOutputs ?? {};
            exec.stepOutputs[step.id] = result.result;
          }
          if (result.captured) {
            exec.vars = exec.vars ?? {};
            for (const [k, v] of Object.entries(result.captured)) {
              exec.vars[k] = v;
            }
          }
          if (step.outputKey && result.result) {
            exec.vars = exec.vars ?? {};
            exec.vars[step.outputKey] = result.result;
          }
          this.handlers.auditLog('RUNBOOK_STEP_COMPLETED', {
            runbookId: def.id, executionId: exec.id, stepId: step.id,
            stepType: step.type, result: stepExec.result,
            capturedKey: step.outputKey,
          });
          idx = this._nextIdx(def, exec, step, idx, true, stepExec, stepIdxMap);
        } else {
          throw new Error(result.error ?? 'Step failed');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        stepExec.status      = 'failed';
        stepExec.error       = msg;
        stepExec.completedAt = Date.now();
        this.handlers.auditLog('RUNBOOK_STEP_FAILED', {
          runbookId: def.id, executionId: exec.id, stepId: step.id,
          stepType: step.type, error: msg,
        });

        if (step.optional) {
          // Optional — try failure branch or continue
          idx = this._nextIdx(def, exec, step, idx, false, stepExec, stepIdxMap);
        } else if (step.onFailure) {
          // Non-optional but has a failure branch — take it
          const failIdx = stepIdxMap.get(step.onFailure);
          if (failIdx !== undefined) {
            this._recordBranch(exec, step.id, step.onFailure, 'failure', msg, stepExec);
            this.handlers.auditLog('RUNBOOK_BRANCH_TAKEN', {
              runbookId: def.id, executionId: exec.id,
              fromStepId: step.id, toStepId: step.onFailure, branchType: 'failure',
            });
            this._markSkippedRange(exec, idx + 1, failIdx);
            idx = failIdx;
          } else {
            return this._failExecution(def, exec, `Step '${step.label}' failed: ${msg}`, idx);
          }
        } else {
          return this._failExecution(def, exec, `Step '${step.label}' failed: ${msg}`, idx);
        }
      } finally {
        this.store.saveRunbookExecution(exec);
      }
    }

    exec.status      = 'completed';
    exec.completedAt = Date.now();
    this.store.saveRunbookExecution(exec);
    this.handlers.auditLog('RUNBOOK_COMPLETED', {
      runbookId: def.id, executionId: exec.id, stepsTotal: def.steps.length,
      branchDecisions: exec.branchDecisions?.length ?? 0,
      workspaceId: this.store.getWorkspace()?.id,
    });
    return exec;
  }

  // ── Pause at a wait/deadline step ─────────────────────────────────────────

  private async _pauseAtStep(
    def:    RunbookDef,
    exec:   RunbookExecution,
    step:   RunbookStep,
    idx:    number,
    _via:   string,
  ): Promise<RunbookExecution> {
    const handoffType =
      step.type === 'wait_approval' ? 'approval' :
      step.type === 'wait_confirm'  ? 'confirm'  :
      'manual';
    const pauseStatus =
      step.type === 'wait_approval' ? 'paused_approval' :
      step.type === 'wait_confirm'  ? 'paused_confirm'  :
      'paused_manual';
    const pauseTokenId = makePauseTokenId();

    // Fire initial escalation signals
    const escalationText =
      step.type === 'wait_approval'  ? `[Approval Needed] Runbook: **${def.title}** — step: ${step.label}` :
      step.type === 'wait_confirm'   ? `[Desktop Confirm Needed] Runbook: **${def.title}** — step: ${step.label}` :
      `[Manual Action Required] Runbook: **${def.title}** — step: ${step.label}`;
    if (def.escalationChannel) {
      await this.handlers.sendSlack(def.escalationChannel, escalationText).catch(() => {});
    }
    const pushTitle =
      step.type === 'wait_approval' ? `Approval Needed: ${def.title}` :
      step.type === 'wait_confirm'  ? `Confirm Required: ${def.title}` :
      `Action Required: ${def.title}`;
    await this.handlers.notifyPush(pushTitle, step.label).catch(() => {});

    // Compute deadlines
    const now           = Date.now();
    const timeoutSecs   = step.timeoutSecs   ?? (step.params['timeout_secs']    ? parseInt(step.params['timeout_secs'], 10)    : undefined);
    const escalateSecs  = step.escalateAfterSecs ?? (step.params['escalate_after_secs'] ? parseInt(step.params['escalate_after_secs'], 10) : undefined);
    const expiresAt     = timeoutSecs  ? now + timeoutSecs  * 1000 : undefined;
    const escalateAt    = escalateSecs ? now + escalateSecs * 1000 : undefined;

    // Create handoff queue item
    const handoffItem: HandoffQueueItem = {
      id:            pauseTokenId,
      executionId:   exec.id,
      runbookId:     def.id,
      runbookTitle:  def.title,
      stepId:        step.id,
      stepLabel:     step.label,
      type:          handoffType,
      status:        'pending',
      blockedReason: step.params['reason'] ?? step.label,
      actorNeeded:   step.params['actor_needed'],
      isIncident:    exec.isIncident,
      createdAt:     now,
      expiresAt,
      escalateAt,
      onRejection:   step.onRejection,
      onTimeout:     step.onTimeout,
    };
    this.handlers.addHandoffItem(handoffItem);

    // Mark step as attention, save pause state
    const stepExec           = exec.steps[idx];
    stepExec.status          = 'attention';
    stepExec.result          = `Paused — awaiting ${handoffType}`;
    stepExec.completedAt     = Date.now();

    exec.status          = pauseStatus;
    exec.pausedAtStepIdx = idx;
    exec.pauseTokenId    = pauseTokenId;
    exec.pausedAt        = now;
    exec.pausedReason    = step.label;
    exec.deadlineAt      = expiresAt;
    exec.escalatedAt     = undefined;
    this.store.saveRunbookExecution(exec);

    this.handlers.auditLog('RUNBOOK_PAUSED', {
      runbookId: def.id, executionId: exec.id, stepId: step.id,
      pauseType: handoffType, pauseTokenId,
      isIncident: exec.isIncident, expiresAt, escalateAt,
      workspaceId: this.store.getWorkspace()?.id,
    });
    this.handlers.auditLog('HANDOFF_CREATED', {
      handoffId: pauseTokenId, executionId: exec.id, runbookId: def.id,
      stepId: step.id, type: handoffType, isIncident: exec.isIncident,
      expiresAt, escalateAt,
    });
    this.handlers.auditLog('RUNBOOK_ESCALATED', {
      runbookId: def.id, executionId: exec.id, stepId: step.id, type: handoffType,
      escalationChannel: def.escalationChannel,
    });

    return exec;
  }

  // ── Condition evaluator ───────────────────────────────────────────────────

  private _evalCondition(expr: string, exec: RunbookExecution, currentIdx: number): boolean {
    // Phase 34 — try parameterised forms first
    const def        = this.store.getRunbook(exec.runbookId);
    const incident   = this.store.getIncidentMode();
    const ws         = this.store.getWorkspace();
    const ctx        = buildTemplateContext(
      exec, def ?? { id: '', title: '', description: '', scope: 'workspace', trigger: 'manual',
        steps: [], allowedRunnerRoles: [], allowedRunnerDeviceIds: [], linkedIntegrations: [],
        incidentMode: false, enabled: true, createdAt: 0, updatedAt: 0 },
      incident.active, incident.reason ?? '', ws?.name ?? '',
    );
    const paramResult = evalParameterisedCondition(expr, ctx);
    if (paramResult !== null) return paramResult;

    // Built-in expressions
    switch (expr) {
      case 'incident_mode':         return this.store.getIncidentMode().active;
      case 'prev_step_failed':      return currentIdx > 0 && exec.steps[currentIdx - 1]?.status === 'failed';
      case 'prev_step_completed':   return currentIdx > 0 && exec.steps[currentIdx - 1]?.status === 'completed';
      case 'prev_step_attention':   return currentIdx > 0 && exec.steps[currentIdx - 1]?.status === 'attention';
      case 'any_step_failed':       return exec.steps.slice(0, currentIdx).some(s => s.status === 'failed');
      case 'always_true':           return true;
      case 'always_false':          return false;
      default:                      return false;
    }
  }

  // ── Next-step resolver ────────────────────────────────────────────────────

  /**
   * Returns the next step index to execute after the current one.
   * Applies onSuccess/onFailure branch routing and marks skipped steps.
   */
  private _nextIdx(
    def:         RunbookDef,
    exec:        RunbookExecution,
    step:        RunbookStep,
    currentIdx:  number,
    succeeded:   boolean,
    stepExec:    RunbookStepExecution,
    idxMap:      Map<string, number>,
  ): number {
    const branchId = succeeded ? step.onSuccess : step.onFailure;
    if (!branchId) return currentIdx + 1;

    const branchIdx = idxMap.get(branchId);
    if (branchIdx === undefined || branchIdx === currentIdx + 1) return currentIdx + 1;

    const bType: BranchDecision['branchType'] = succeeded ? 'success' : 'failure';
    this._recordBranch(exec, step.id, branchId, bType, succeeded ? 'step succeeded' : 'step failed (optional)', stepExec);
    this.handlers.auditLog('RUNBOOK_BRANCH_TAKEN', {
      runbookId: def.id, executionId: exec.id,
      fromStepId: step.id, toStepId: branchId, branchType: bType,
    });
    this._markSkippedRange(exec, currentIdx + 1, branchIdx);
    return branchIdx;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _loadExecution(executionId: string): RunbookExecution | null {
    return this.store.getRunbookExecutions(200).find(e => e.id === executionId) ?? null;
  }

  private _clearPauseState(exec: RunbookExecution): void {
    exec.pausedAt        = undefined;
    exec.pausedReason    = undefined;
    exec.pauseTokenId    = undefined;
    exec.pausedAtStepIdx = undefined;
    exec.deadlineAt      = undefined;
  }

  private _skipRemaining(exec: RunbookExecution, fromIdx: number): void {
    for (let j = fromIdx; j < exec.steps.length; j++) {
      if (exec.steps[j].status === 'pending' || exec.steps[j].status === 'running') {
        exec.steps[j].status = 'skipped';
      }
    }
  }

  /** Mark steps in [fromIdx, toIdx) as skipped (bypassed by branch). */
  private _markSkippedRange(exec: RunbookExecution, fromIdx: number, toIdx: number): void {
    for (let j = fromIdx; j < toIdx && j < exec.steps.length; j++) {
      if (exec.steps[j].status === 'pending') {
        exec.steps[j].status = 'skipped';
        this.handlers.auditLog('RUNBOOK_STEP_SKIPPED', {
          executionId: exec.id, stepId: exec.steps[j].stepId, byBranch: true,
        });
      }
    }
  }

  private _recordBranch(
    exec:       RunbookExecution,
    fromStepId: string,
    toStepId:   string,
    branchType: BranchDecision['branchType'],
    reason:     string,
    stepExec:   RunbookStepExecution,
  ): void {
    const decision: BranchDecision = { fromStepId, toStepId, branchType, reason, decidedAt: Date.now() };
    exec.branchDecisions = [...(exec.branchDecisions ?? []), decision];
    stepExec.branchedTo  = toStepId;
  }

  private _failExecution(
    def:      RunbookDef,
    exec:     RunbookExecution,
    errorMsg: string,
    fromIdx:  number,
  ): RunbookExecution {
    exec.status      = 'failed';
    exec.completedAt = Date.now();
    exec.error       = errorMsg;
    this._skipRemaining(exec, fromIdx + 1);
    this.store.saveRunbookExecution(exec);
    this.handlers.auditLog('RUNBOOK_FAILED', {
      runbookId: def.id, executionId: exec.id, error: exec.error,
      workspaceId: this.store.getWorkspace()?.id,
    });
    return exec;
  }

  // ── Step adapters ──────────────────────────────────────────────────────────

  private async _executeStep(
    step: RunbookStep,
    via:  string,
    def:  RunbookDef,
    exec: RunbookExecution,
  ): Promise<StepResult> {
    const p = step.params;

    switch (step.type) {
      case 'run_recipe': {
        const id = p['recipe_id'] ?? '';
        if (!id) return { ok: false, error: 'recipe_id not set' };
        return this.handlers.runRecipe(id, `runbook:${def.id}:${via}`);
      }
      case 'run_mission': {
        const id = p['mission_id'] ?? '';
        if (!id) return { ok: false, error: 'mission_id not set' };
        return this.handlers.runMission(id);
      }
      case 'send_slack': {
        const channel = p['channel'] ?? def.escalationChannel ?? '#general';
        const text    = p['text'] ?? `Runbook: ${def.title} — step: ${step.label}`;
        const r = await this.handlers.sendSlack(channel, text);
        return { ...r, result: r.ok ? `Sent to ${channel}` : undefined };
      }
      case 'create_jira': {
        const project   = p['project_key'] ?? '';
        const issueType = p['issue_type']  ?? '10001';
        const summary   = p['summary']     ?? `[Runbook] ${def.title}: ${step.label}`;
        const body      = p['body']        ?? `Runbook: ${def.title}\nExecution: ${exec.id}`;
        if (!project) return { ok: false, error: 'project_key not set' };
        const r = await this.handlers.createJira(project, issueType, summary, body);
        return { ...r, result: r.ok ? `Created Jira issue in ${project}` : undefined };
      }
      case 'create_linear': {
        const teamId = p['team_id']     ?? '';
        const title  = p['title']       ?? `[Runbook] ${def.title}: ${step.label}`;
        const desc   = p['description'] ?? `Runbook: ${def.title}\nExecution: ${exec.id}`;
        if (!teamId) return { ok: false, error: 'team_id not set' };
        const r = await this.handlers.createLinear(teamId, title, desc);
        return { ...r, result: r.ok ? `Created Linear issue` : undefined };
      }
      case 'notify_push': {
        const title = p['title'] ?? `[${def.incidentMode ? 'INCIDENT' : 'Runbook'}] ${def.title}`;
        const body  = p['body']  ?? step.label;
        const r = await this.handlers.notifyPush(title, body);
        return { ...r, result: r.ok ? 'Push sent' : undefined };
      }
      case 'create_task': {
        const goal     = p['goal']     ?? step.label;
        const category = p['category'] ?? 'general';
        this.handlers.auditLog('RUNBOOK_STEP_COMPLETED', {
          runbookId: def.id, executionId: exec.id, stepId: step.id,
          note: 'create_task logged — engine dispatch not wired in executor',
        });
        return { ok: true, result: `Task intent recorded: "${goal}" (${category})` };
      }
      // Control flow types handled above, not here
      default:
        return { ok: false, error: `Unknown step type: ${(step as any).type}` };
    }
  }
}
