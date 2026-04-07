// ── workerRuntime/workerRunQueue.ts — Worker Run Runtime Facade ───────────────
//
// Thin facade over WorkerRunStore + WorkerRunHydrator.
// This is the primary API used by IPC handlers and (in future phases)
// by WorkflowPackService, OperatorService, and the AgentLoop to register
// and update their execution state in the durable run model.
//
// Design:
//   • init() must be called once at startup — loads from disk and hydrates
//   • All create/transition/artifact methods are synchronous-safe (write-queued)
//   • Exposes a stable surface for future integration without re-architecting
//
// Integration points (NOT YET wired — for future phases):
//   TODO Phase 2: WorkflowPackService.startRun() → workerRunQueue.createRun({ source: 'operate', packId })
//   TODO Phase 2: WorkflowPackService run phase completion → workerRunQueue.transitionStatus(runId, 'completed')
//   TODO Phase 2: OperatorSession → workerRunQueue.createRun({ source: 'operate', operatorSessionId })
//   TODO Phase 3: AgentLoop task → workerRunQueue.createRun({ source: 'chat' })

import crypto from 'crypto';
import { WorkerRunStore }    from './workerRunStore';
import { hydrateOnStartup }  from './workerRunHydrator';
import { getMachineId }      from './machineId';
import {
  isValidTransition,
  ACTIVE_RUN_STATUSES,
} from './types';
import type {
  WorkerRun,
  WorkerStep,
  WorkerArtifactRef,
  WorkerRunStatus,
  WorkerBlocker,
} from './types';

// ── Types for create inputs ───────────────────────────────────────────────────

export interface CreateRunOptions {
  source:             WorkerRun['source'];
  goal:               string;
  packId?:            string;
  workflowId?:        string;
  operatorSessionId?: string;
  contextSnapshot?:   Record<string, unknown>;
}

export interface CreateStepOptions {
  runId:  string;
  title:  string;
  type:   WorkerStep['type'];
  input?: Record<string, unknown>;
}

export interface AddArtifactOptions {
  runId:   string;
  stepId?: string;
  kind:    WorkerArtifactRef['kind'];
  path:    string;
  meta?:   Record<string, unknown>;
}

// ── WorkerRunQueue ────────────────────────────────────────────────────────────

export class WorkerRunQueue {
  private readonly _store: WorkerRunStore;
  private readonly _dataDir: string;
  private _resumeCandidates: WorkerRun[] = [];

  constructor(dataDir: string) {
    this._dataDir = dataDir;
    this._store   = new WorkerRunStore(dataDir);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialize the queue: load from disk and hydrate unfinished runs.
   * Must be called once before any other method.
   */
  init(): void {
    this._store.init();
    const { resumeCandidates } = hydrateOnStartup(this._store);
    this._resumeCandidates = resumeCandidates;
  }

  // ── Run creation ──────────────────────────────────────────────────────────

  /**
   * Create a new persisted WorkerRun.
   * The run starts in 'queued' status.
   */
  createRun(opts: CreateRunOptions): WorkerRun {
    const now = Date.now();
    const run: WorkerRun = {
      id:                crypto.randomUUID(),
      createdAt:         now,
      updatedAt:         now,
      machineId:         getMachineId(this._dataDir),
      source:            opts.source,
      goal:              opts.goal,
      packId:            opts.packId,
      workflowId:        opts.workflowId,
      operatorSessionId: opts.operatorSessionId,
      status:            'queued',
      currentStepIndex:  0,
      artifacts:         [],
      approvals:         [],
      contextSnapshot:   opts.contextSnapshot,
    };
    return this._store.createRun(run);
  }

  // ── Status transitions ────────────────────────────────────────────────────

  /**
   * Transition a run to a new status.
   * Validates the transition using isValidTransition() — returns null if illegal.
   */
  transitionStatus(
    runId:   string,
    to:      WorkerRunStatus,
    blocker?: WorkerBlocker,
  ): WorkerRun | null {
    const run = this._store.getRun(runId);
    if (!run) return null;
    if (!isValidTransition(run.status, to)) {
      console.warn(`[WorkerRunQueue] illegal transition ${run.status} → ${to} for run ${runId}`);
      return null;
    }
    return this._store.updateRun(runId, {
      status:  to,
      blocker: to === 'blocked' || to === 'waiting_approval' ? blocker : undefined,
    });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  /** Record a heartbeat on an active run. */
  heartbeat(runId: string): void {
    this._store.updateRun(runId, { lastHeartbeatAt: Date.now() });
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  /** Add a new step to an existing run. */
  addStep(opts: CreateStepOptions): WorkerStep {
    const existingSteps = this._store.getSteps(opts.runId);
    const step: WorkerStep = {
      id:     crypto.randomUUID(),
      runId:  opts.runId,
      index:  existingSteps.length,
      title:  opts.title,
      type:   opts.type,
      status: 'pending',
      input:  opts.input,
    };
    return this._store.addStep(step);
  }

  /** Start a step (pending → running). */
  startStep(runId: string, stepId: string): WorkerStep | null {
    return this._store.updateStep(runId, stepId, {
      status:    'running',
      startedAt: Date.now(),
    });
  }

  /** Complete a step with optional output. */
  completeStep(runId: string, stepId: string, output?: Record<string, unknown>): WorkerStep | null {
    const now = Date.now();
    return this._store.updateStep(runId, stepId, {
      status:  'completed',
      endedAt: now,
      output,
    });
  }

  /** Fail a step with an error message. */
  failStep(runId: string, stepId: string, error: string): WorkerStep | null {
    return this._store.updateStep(runId, stepId, {
      status:  'failed',
      endedAt: Date.now(),
      error,
    });
  }

  getSteps(runId: string): WorkerStep[] {
    return this._store.getSteps(runId);
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────

  /** Attach an artifact reference to a run (and optionally a step). */
  addArtifact(opts: AddArtifactOptions): WorkerArtifactRef {
    const artifact: WorkerArtifactRef = {
      id:        crypto.randomUUID(),
      runId:     opts.runId,
      stepId:    opts.stepId,
      kind:      opts.kind,
      path:      opts.path,
      createdAt: Date.now(),
      meta:      opts.meta,
    };
    // If stepId present, register on the step too
    if (opts.stepId) {
      const steps = this._store.getSteps(opts.runId);
      const step  = steps.find(s => s.id === opts.stepId);
      if (step) {
        this._store.updateStep(opts.runId, opts.stepId, {
          artifactIds: [...(step.artifactIds ?? []), artifact.id],
        });
      }
    }
    return this._store.addArtifact(artifact);
  }

  getArtifacts(runId: string): WorkerArtifactRef[] {
    return this._store.getArtifacts(runId);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  getRun(runId: string): WorkerRun | null {
    return this._store.getRun(runId);
  }

  listRuns(filter?: { status?: WorkerRunStatus }): WorkerRun[] {
    return this._store.listRuns(filter);
  }

  /**
   * Returns runs that were in a non-terminal state when the app started.
   * Populated by init() via hydrateOnStartup().
   * Re-reads from the store on each call to reflect corrections made after init.
   */
  getResumeCandidates(): WorkerRun[] {
    // Re-read from store so status corrections (e.g. cancel) are reflected
    return this._store.listRuns()
      .filter(r => ACTIVE_RUN_STATUSES.includes(r.status));
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  /**
   * Cancel a run if it is in a non-terminal state.
   * Returns the updated run, or null if already terminal.
   */
  cancel(runId: string): WorkerRun | null {
    return this.transitionStatus(runId, 'cancelled');
  }
}
