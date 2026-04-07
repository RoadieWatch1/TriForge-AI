// ── workerRuntime/types.ts — Worker Runtime Durable Run Contracts ─────────────
//
// Phase 1, Step 1: Worker Runtime Foundation
//
// These types define the persisted execution model for TriForge worker runs.
// A WorkerRun is the durable record of a unit of work — from creation through
// completion or failure — that survives application restarts.
//
// Design:
//   • WorkerRun — top-level record, one per unit of work
//   • WorkerStep — ordered steps within a run
//   • WorkerArtifactRef — file/output references attached to a run or step
//   • WorkerBlocker — structured reason a run is halted
//
// NOT YET:
//   • Automatic workflow continuation on resume (execution engine not wired yet)
//   • Operator session automatic replay
//   • Real-time execution status from workflow packs
//   All of these are integration points for later phases.

// ── Run status ────────────────────────────────────────────────────────────────

export type WorkerRunStatus =
  | 'queued'            // Created, not yet started
  | 'planning'          // Council is generating a plan
  | 'ready'             // Plan ready, waiting to begin execution
  | 'running'           // Actively executing steps
  | 'waiting_approval'  // Paused at an approval gate
  | 'blocked'           // Halted by a blocker (needs human resolution)
  | 'completed'         // All steps finished successfully
  | 'failed'            // Unrecoverable error
  | 'cancelled';        // Explicitly cancelled by user or policy

// ── Step status ───────────────────────────────────────────────────────────────

export type WorkerStepStatus =
  | 'pending'           // Not yet started
  | 'running'           // Currently executing
  | 'waiting_approval'  // Waiting for approval before continuing
  | 'blocked'           // Cannot proceed — needs intervention
  | 'completed'         // Finished successfully
  | 'failed';           // Step failed

// ── Blocker ───────────────────────────────────────────────────────────────────

export interface WorkerBlocker {
  kind:
    | 'approval_required'    // Action requires explicit user approval
    | 'permission_missing'   // OS permission (Accessibility, Screen Recording, etc.)
    | 'capability_missing'   // Desktop capability not yet implemented
    | 'target_not_found'     // App/window/resource the step targeted is missing
    | 'tool_failed'          // A tool execution failed (includes crash/restart)
    | 'user_input_required'; // A step needs additional input from the user
  message: string;
  /** Whether this blocker can be resolved without abandoning the run */
  recoverable: boolean;
}

// ── Artifact reference ────────────────────────────────────────────────────────

export interface WorkerArtifactRef {
  id: string;
  runId: string;
  /** Optional: which step produced this artifact */
  stepId?: string;
  kind: 'screenshot' | 'log' | 'plan' | 'file' | 'diff' | 'build-output';
  /** Absolute path to the artifact on disk */
  path: string;
  createdAt: number;
  /** Arbitrary additional metadata (e.g. { width, height } for screenshots) */
  meta?: Record<string, unknown>;
}

// ── Worker Run ────────────────────────────────────────────────────────────────

export interface WorkerRun {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Stable machine identity — persisted UUID from workerRuntime/machineId.ts */
  machineId: string;
  /** What surface initiated this run */
  source: 'chat' | 'operate' | 'session_resume' | 'webhook';
  /** Human-readable goal or intent */
  goal: string;
  /** Workflow pack ID if this run was started from a workflow pack */
  packId?: string;
  /** Autonomy workflow ID if this run was started from an autonomy workflow */
  workflowId?: string;
  /** OperatorSession ID if this run is backed by a desktop operator session */
  operatorSessionId?: string;
  status: WorkerRunStatus;
  /** Index of the currently active (or last executed) step */
  currentStepIndex: number;
  /** Timestamp of the most recent heartbeat tick during active execution */
  lastHeartbeatAt?: number;
  /** Present when status is 'blocked' or 'waiting_approval' */
  blocker?: WorkerBlocker;
  /** IDs of WorkerArtifactRef records attached to this run */
  artifacts: string[];
  /** IDs of approval records that were created during this run */
  approvals: string[];
  /**
   * Lightweight snapshot of context at run creation time.
   * Stored for resume/diagnostic purposes — not actively used for execution yet.
   */
  contextSnapshot?: Record<string, unknown>;
}

// ── Worker Step ───────────────────────────────────────────────────────────────

export interface WorkerStep {
  id: string;
  runId: string;
  /** Zero-based order index within the run */
  index: number;
  /** Short human-readable label */
  title: string;
  type: 'council' | 'workflow' | 'operator' | 'approval' | 'validation';
  status: WorkerStepStatus;
  startedAt?: number;
  endedAt?: number;
  /** Serializable input passed to the step */
  input?: Record<string, unknown>;
  /** Serializable output from the step */
  output?: Record<string, unknown>;
  error?: string;
  /** Artifact IDs produced during this step */
  artifactIds?: string[];
}

// ── Persisted store shape ─────────────────────────────────────────────────────

/** Shape of the JSON file on disk: triforge-worker-runs.json */
export interface WorkerRunStoreData {
  version: 1;
  /** Map of run ID → WorkerRun */
  runs: Record<string, WorkerRun>;
  /** Map of run ID → ordered WorkerStep array */
  steps: Record<string, WorkerStep[]>;
  /** Map of run ID → WorkerArtifactRef array */
  artifacts: Record<string, WorkerArtifactRef[]>;
}

// ── Status transition helpers ─────────────────────────────────────────────────

/**
 * Statuses that indicate a run is still active (not terminal, not cancelled).
 * These runs are candidates for hydration and resume on startup.
 */
export const ACTIVE_RUN_STATUSES: WorkerRunStatus[] = [
  'queued',
  'planning',
  'ready',
  'running',
  'waiting_approval',
  'blocked',
];

/** Terminal statuses — a run in these states cannot transition further. */
export const TERMINAL_RUN_STATUSES: WorkerRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

/** Returns true if transitioning from `from` to `to` is a legal move. */
export function isValidTransition(from: WorkerRunStatus, to: WorkerRunStatus): boolean {
  if (TERMINAL_RUN_STATUSES.includes(from)) return false; // terminal → anything is illegal
  if (from === to) return false;                           // no-op transitions disallowed
  // cancelled is always allowed from any non-terminal state
  if (to === 'cancelled') return true;
  // failed is always allowed from any non-terminal state
  if (to === 'failed') return true;

  const allowed: Partial<Record<WorkerRunStatus, WorkerRunStatus[]>> = {
    queued:           ['planning', 'ready', 'running', 'blocked', 'cancelled'],
    planning:         ['ready', 'blocked', 'failed'],
    ready:            ['running', 'blocked'],
    running:          ['waiting_approval', 'blocked', 'completed', 'failed'],
    // waiting_approval can resolve to completed/failed when execution advances
    // after approval and finishes in the same _executePhasesFrom() call
    waiting_approval: ['running', 'blocked', 'completed', 'failed', 'cancelled'],
    blocked:          ['ready', 'running', 'cancelled'],
  };

  return allowed[from]?.includes(to) ?? false;
}
