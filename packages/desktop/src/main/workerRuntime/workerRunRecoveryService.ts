// ── workerRuntime/workerRunRecoveryService.ts — Worker Run Recovery ────────────
//
// Phase 1, Step 4: Resume / Recovery Action Flow
//
// Determines whether a persisted WorkerRun can be recovered, and performs
// recovery by restarting the original workflow pack with saved context.
//
// HONEST BEHAVIOR MODEL:
//   "Recovery" means restarting the workflow from saved pack metadata.
//   It does NOT mean resuming from the exact internal execution point.
//
// Supported recovery cases by status:
//
//   blocked (restart-interrupted, kind: tool_failed)
//     → restart from contextSnapshot.packId + targetApp
//     → cancel old run after new execution starts
//
//   blocked (other blockers — permission, target not found, etc.)
//     → restart from contextSnapshot if available
//     → same blocker may occur again if underlying issue is unresolved
//
//   waiting_approval + live WorkflowRun still in memory
//     → NOT a restart path — the run is live and waiting for approval
//     → returns approval_live_use_panel to direct user to approval panel
//
//   waiting_approval + dead WorkflowRun (app was restarted)
//     → restart from contextSnapshot if available
//
//   failed + pack metadata available
//     → restart from contextSnapshot (retry semantics)
//
// WHAT THIS DOES NOT DO:
//   - Resume from the exact internal phase where execution stopped
//   - Replay operator keystrokes or clicks
//   - Automatically continue background execution without user action
//   - Recover runs that have no saved pack metadata

import type { WorkerRunQueue } from './workerRunQueue';
import { WorkflowPackService }  from '../services/workflowPackService';
import type { WorkerRun }       from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * How recovery was performed.
 * Used by UI to choose the right language and feedback.
 */
export type ResumeKind =
  | 'restarted_from_metadata';  // Workflow pack restarted using saved packId + targetApp

/**
 * Structured reason code when recovery is not possible.
 * Distinct from ResumeKind so callers can branch cleanly.
 */
export type ResumeFailReason =
  | 'run_not_found'          // WorkerRun not in store
  | 'terminal_status'        // Run already completed/failed/cancelled
  | 'not_resumable_status'   // Status not eligible (queued, running, planning, ready)
  | 'missing_pack_metadata'  // contextSnapshot.packId not saved — cannot restart
  | 'pack_not_found'         // Pack no longer in registry
  | 'readiness_check_failed' // WorkflowPackService.startRun() rejected due to readiness
  | 'start_failed'           // startRun() returned ok: false for another reason
  | 'approval_live_use_panel'; // Run is live waiting_approval — not a restart candidate

export interface ResumeResult {
  ok: boolean;
  kind?: ResumeKind;
  failReason?: ResumeFailReason;
  /** Human-readable message for display in the Sessions UI. */
  message: string;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: WorkerRun['status'][] = ['completed', 'failed', 'cancelled'];

/** Statuses that can be recovered by restarting from saved metadata. */
const RESTART_ELIGIBLE: WorkerRun['status'][] = ['blocked', 'waiting_approval', 'failed'];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to resume or recover a WorkerRun by ID.
 *
 * This is the single entry point for the `workerRun:resume` IPC action.
 * It validates the run, chooses the correct recovery path, and either:
 *   - Restarts the workflow pack (creating a new WorkerRun via the bridge), or
 *   - Returns a structured failure explaining why recovery is not possible.
 *
 * On successful restart:
 *   - The old interrupted run is marked cancelled (leaves "Needs Attention").
 *   - A new WorkerRun is created by the bridge when startRun() runs.
 *   - The new run will appear in the running/recent panels after the UI refreshes.
 */
export async function resumeRun(
  runId: string,
  queue: WorkerRunQueue,
): Promise<ResumeResult> {
  // ── 1. Validate run exists ─────────────────────────────────────────────────

  const run = queue.getRun(runId);
  if (!run) {
    return {
      ok: false,
      failReason: 'run_not_found',
      message: `Run "${runId}" not found.`,
    };
  }

  // ── 2. Reject terminal runs ────────────────────────────────────────────────

  if (TERMINAL_STATUSES.includes(run.status)) {
    return {
      ok: false,
      failReason: 'terminal_status',
      message: `This run is ${run.status} and cannot be recovered.`,
    };
  }

  // ── 3. Handle waiting_approval with a live WorkflowRun ────────────────────
  //
  // If the WorkflowRun is still in memory and genuinely awaiting approval,
  // the user should use the approval panel — not the resume action.
  // This is NOT a failure; we return failReason: 'approval_live_use_panel'
  // so the UI can show a clear redirect message.

  if (run.status === 'waiting_approval' && run.workflowId) {
    const liveRun = WorkflowPackService.getRun(run.workflowId);
    if (liveRun && liveRun.status === 'awaiting_approval') {
      return {
        ok: false,
        failReason: 'approval_live_use_panel',
        message: 'This workflow is currently waiting for an approval decision. Use the Needs Approval panel to approve or deny the pending action.',
      };
    }
  }

  // ── 4. Reject statuses that are not restart-eligible ──────────────────────

  if (!RESTART_ELIGIBLE.includes(run.status)) {
    return {
      ok: false,
      failReason: 'not_resumable_status',
      message: `Run status "${run.status}" is not eligible for recovery. Only blocked, interrupted, or failed runs can be restarted.`,
    };
  }

  // ── 5. Require saved pack context ─────────────────────────────────────────

  const packId    = run.contextSnapshot?.packId as string | undefined;
  const targetApp = run.contextSnapshot?.targetApp as string | null | undefined;

  if (!packId) {
    return {
      ok: false,
      failReason: 'missing_pack_metadata',
      message: 'No workflow pack context was saved with this run. Cannot restart without pack information.',
    };
  }

  // ── 6. Verify pack still exists ───────────────────────────────────────────

  const pack = WorkflowPackService.getPack(packId);
  if (!pack) {
    return {
      ok: false,
      failReason: 'pack_not_found',
      message: `Workflow pack "${packId}" is no longer registered and cannot be restarted.`,
    };
  }

  // ── 7. Launch recovery execution ──────────────────────────────────────────
  //
  // startRun() runs synchronously through all phases, calling the bridge
  // hooks which create and update a new WorkerRun record. By the time it
  // returns, the new WorkerRun is persisted in its terminal or gate state.
  //
  // NOTE: This is a restart, not a resume. Execution begins from phase 0.
  // If the original run was interrupted mid-pack, the completed phases will
  // run again. This is the honest behavior given the current architecture.

  const result = await WorkflowPackService.startRun(packId, {
    targetApp: targetApp ?? undefined,
  });

  if (!result.ok) {
    if (result.readinessBlockers && result.readinessBlockers.length > 0) {
      const blockerSummary = result.readinessBlockers
        .map(b => b.message)
        .join('; ');
      return {
        ok: false,
        failReason: 'readiness_check_failed',
        message: `Recovery failed — workflow pack is not ready to run: ${blockerSummary}`,
      };
    }
    return {
      ok: false,
      failReason: 'start_failed',
      message: `Recovery failed: ${result.error ?? 'Workflow could not start.'}`,
    };
  }

  // ── 8. Close the old interrupted run ──────────────────────────────────────
  //
  // The new execution is running (or completed). Cancel the old run so it
  // leaves the "Needs Attention" panel. The run record remains in history.

  queue.cancel(runId);

  return {
    ok: true,
    kind: 'restarted_from_metadata',
    message: `"${pack.name}" restarted from saved workflow context. The interrupted run has been closed.`,
  };
}
