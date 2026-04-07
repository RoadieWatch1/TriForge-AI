// ── workerRuntime/workerRunHydrator.ts — Startup Run Hydration ────────────────
//
// Loads persisted runs at app startup, identifies unfinished work, and
// performs safe status corrections before the app accepts new requests.
//
// What this does:
//   1. Finds all non-terminal runs (queued, planning, ready, running,
//      waiting_approval, blocked)
//   2. Converts any run that was 'running' at shutdown to 'blocked' with an
//      honest restart blocker — because the execution engine was interrupted
//      and cannot automatically resume without user action
//   3. Returns the full list of resume candidates to the caller
//
// What this does NOT do:
//   • Automatically resume execution — the execution engine is not wired yet
//   • Replay workflow packs or operator sessions — future integration point
//   • Purge or delete any existing data
//
// Integration point for future phases:
//   TODO: When WorkflowPackService and OperatorService support session resume,
//   pass resumable runs to their respective execution engines here.

import type { WorkerRunStore } from './workerRunStore';
import type { WorkerRun }      from './types';
import { ACTIVE_RUN_STATUSES } from './types';

// ── Hydration result ─────────────────────────────────────────────────────────

export interface HydrationResult {
  /** Runs that were found in a non-terminal state at startup */
  resumeCandidates: WorkerRun[];
  /** Runs that were 'running' and were converted to 'blocked' (interrupted) */
  interruptedRuns:  WorkerRun[];
  /** How many total runs were loaded from disk */
  totalLoaded: number;
}

// ── Hydration ─────────────────────────────────────────────────────────────────

/**
 * Run at app startup to restore and sanitize persisted run state.
 *
 * Safe to call multiple times — each call reads fresh from the store,
 * but interrupted-run correction is idempotent (a 'blocked' run stays blocked).
 */
export function hydrateOnStartup(store: WorkerRunStore): HydrationResult {
  const allRuns = store.listRuns();

  const resumeCandidates: WorkerRun[] = [];
  const interruptedRuns:  WorkerRun[] = [];

  for (const run of allRuns) {
    if (!ACTIVE_RUN_STATUSES.includes(run.status)) continue;

    if (run.status === 'running') {
      // The app was shut down while this run was actively executing.
      // We cannot safely claim it is still running — mark it blocked.
      const corrected = store.updateRun(run.id, {
        status:  'blocked',
        blocker: {
          kind:        'tool_failed',
          message:     'Run was interrupted by application restart. Manual resume required.',
          recoverable: true,
        },
      });
      if (corrected) {
        interruptedRuns.push(corrected);
        resumeCandidates.push(corrected);
      }
    } else {
      // queued / planning / ready / waiting_approval / blocked
      // These statuses are already self-consistent after restart — surface as-is.
      resumeCandidates.push(run);
    }
  }

  if (interruptedRuns.length > 0) {
    console.log(
      `[WorkerRunHydrator] ${interruptedRuns.length} run(s) marked blocked after restart:`,
      interruptedRuns.map(r => r.id),
    );
  }

  if (resumeCandidates.length > 0) {
    console.log(
      `[WorkerRunHydrator] ${resumeCandidates.length} resume candidate(s):`,
      resumeCandidates.map(r => `${r.id} (${r.status})`),
    );
  }

  return {
    resumeCandidates,
    interruptedRuns,
    totalLoaded: allRuns.length,
  };
}
