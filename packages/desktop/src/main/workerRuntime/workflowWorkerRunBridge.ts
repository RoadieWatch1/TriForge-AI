// ── workerRuntime/workflowWorkerRunBridge.ts — Workflow ↔ WorkerRun Bridge ────
//
// Phase 1, Step 2: Wire workflow pack execution into durable WorkerRun records.
//
// This bridge is the ONLY integration point between WorkflowPackService and
// WorkerRunQueue. It keeps WorkflowPackService clean — the service calls
// onWorkflowRunStarted() and onWorkflowRunSettled() at lifecycle boundaries,
// and this module handles all durable state mapping without the service needing
// to know anything about WorkerRunQueue internals.
//
// Registration: call initWorkflowBridge(queue) once at app startup (in ipc.ts).
// WorkflowPackService calls: onWorkflowRunStarted(), onWorkflowRunSettled().
//
// What this does:
//   • Creates a durable WorkerRun when a workflow pack starts executing
//   • Maps WorkflowRun status transitions to WorkerRun status transitions
//   • Creates one WorkerStep (the workflow execution phase) per run
//   • Attaches screenshot artifacts when workflow phases capture them
//   • Maintains a workflowRunId → workerRunId map for status updates
//
// What this does NOT do:
//   • Automatically resume or replay execution after app restart
//   • Mirror every individual workflow phase as a WorkerStep (too granular)
//   • Synthesize or invent execution state — all state comes from WorkflowRun
//
// Integration points left for future phases:
//   TODO Phase 3: Add step-level granularity by mirroring phase results as
//   WorkerSteps if Sessions UI needs per-phase visibility.
//   TODO Phase 3: Attach readiness/plan artifacts from the readiness-check pack.

import type { WorkerRunQueue }   from './workerRunQueue';
import type { WorkflowRun }      from '@triforge/engine';
import type { WorkflowPack }     from '@triforge/engine';
import type { WorkerRunStatus, WorkerBlocker } from './types';

// ── State ─────────────────────────────────────────────────────────────────────

let _queue: WorkerRunQueue | null = null;

/** workflowRunId → workerRunId */
const _runMap = new Map<string, string>();

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register the WorkerRunQueue with this bridge.
 * Call once at app startup, after _getWorkerRunQueue() is initialized.
 */
export function initWorkflowBridge(queue: WorkerRunQueue): void {
  _queue = queue;
}

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

/**
 * Called by WorkflowPackService immediately after a WorkflowRun is created
 * and before _executePhasesFrom() begins.
 *
 * Creates the durable WorkerRun in 'running' state and one execution step.
 * No-ops if no queue is registered (engine-only / test contexts).
 */
export function onWorkflowRunStarted(wfRun: WorkflowRun, pack: WorkflowPack): void {
  if (!_queue) return;

  try {
    const goal = wfRun.targetApp
      ? `${pack.name} — ${wfRun.targetApp}`
      : pack.name;

    const workerRun = _queue.createRun({
      source:            'operate',
      goal,
      packId:            pack.id,
      workflowId:        wfRun.id,
      operatorSessionId: wfRun.sessionId,
      contextSnapshot: {
        packId:    pack.id,
        packName:  pack.name,
        targetApp: wfRun.targetApp ?? null,
        sessionId: wfRun.sessionId,
      },
    });

    // Immediately transition queued → running (readiness check already passed)
    _queue.transitionStatus(workerRun.id, 'running');

    // One execution step representing the overall workflow run
    const step = _queue.addStep({
      runId: workerRun.id,
      title: pack.name,
      type:  'workflow',
      input: { packId: pack.id, targetApp: wfRun.targetApp ?? null },
    });
    _queue.startStep(workerRun.id, step.id);

    // Record the mapping for subsequent updates
    _runMap.set(wfRun.id, workerRun.id);
  } catch (e) {
    // Bridge errors must never crash WorkflowPackService
    console.error('[WorkflowBridge] onWorkflowRunStarted error:', e);
  }
}

/**
 * Called by WorkflowPackService whenever a WorkflowRun reaches a terminal or
 * gate state: completed, failed, awaiting_approval, or stopped.
 *
 * Mirrors status and attaches screenshot artifacts.
 * No-ops gracefully on any error.
 */
export function onWorkflowRunSettled(wfRun: WorkflowRun): void {
  if (!_queue) return;

  const workerRunId = _runMap.get(wfRun.id);
  if (!workerRunId) return;

  try {
    // Attach screenshots from any phase that produced one
    _attachScreenshots(workerRunId, wfRun);

    // Map WorkflowRun status → WorkerRun status
    const step = _queue.getSteps(workerRunId)[0];

    switch (wfRun.status) {
      case 'completed': {
        if (step) _queue.completeStep(workerRunId, step.id, { phaseCount: wfRun.phaseResults.length });
        _queue.transitionStatus(workerRunId, 'completed');
        // Clean up mapping — run is terminal
        _runMap.delete(wfRun.id);
        break;
      }

      case 'failed': {
        const errorMsg = wfRun.error ?? 'Workflow execution failed';
        if (step) _queue.failStep(workerRunId, step.id, errorMsg);
        _queue.transitionStatus(workerRunId, 'failed');
        _runMap.delete(wfRun.id);
        break;
      }

      case 'awaiting_approval': {
        const blocker: WorkerBlocker = {
          kind:        'approval_required',
          message:     `Workflow "${wfRun.packId}" is waiting for user approval before continuing.`,
          recoverable: true,
        };
        _queue.transitionStatus(workerRunId, 'waiting_approval', blocker);
        // Keep in map — run will settle again when advanceRun() completes
        break;
      }

      case 'stopped': {
        if (step) _queue.failStep(workerRunId, step.id, 'Workflow stopped by user');
        _queue.transitionStatus(workerRunId, 'cancelled');
        _runMap.delete(wfRun.id);
        break;
      }

      // 'running' is an intermediate state — WorkflowPackService doesn't call
      // onWorkflowRunSettled for intermediate running transitions, only terminal ones.
      // If it somehow arrives here, it's a no-op.
      default:
        break;
    }
  } catch (e) {
    console.error('[WorkflowBridge] onWorkflowRunSettled error:', e);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _attachScreenshots(workerRunId: string, wfRun: WorkflowRun): void {
  if (!_queue) return;
  const step = _queue.getSteps(workerRunId)[0];

  for (const pr of wfRun.phaseResults) {
    const screenshotPath = pr.outputs?.screenshotPath;
    if (typeof screenshotPath === 'string' && screenshotPath.length > 0) {
      _queue.addArtifact({
        runId:  workerRunId,
        stepId: step?.id,
        kind:   'screenshot',
        path:   screenshotPath,
        meta: {
          phaseId:   pr.phaseId,
          phaseName: pr.phaseName,
          capturedAt: pr.completedAt ?? pr.startedAt,
        },
      });
    }
  }
}
