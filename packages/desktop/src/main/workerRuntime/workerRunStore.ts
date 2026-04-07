// ── workerRuntime/workerRunStore.ts — Worker Run Persistent Storage ───────────
//
// Stores WorkerRun, WorkerStep, and WorkerArtifactRef records to disk.
//
// Storage file: triforge-worker-runs.json in app.getPath('userData')
//
// Design mirrors MissionStore:
//   • Load-once into memory on init()
//   • Mutate in-memory Map/Record
//   • Write-queue: atomic temp-file + rename to prevent corruption
//   • Single JSON file containing all three collections
//
// Caller is responsible for calling init() before any reads or writes.

import fs   from 'fs';
import path from 'path';
import type {
  WorkerRun,
  WorkerStep,
  WorkerArtifactRef,
  WorkerRunStoreData,
  WorkerRunStatus,
} from './types';

const FILENAME  = 'triforge-worker-runs.json';
const FILE_VER  = 1 as const;

// ── Store ─────────────────────────────────────────────────────────────────────

export class WorkerRunStore {
  private readonly _filePath: string;
  private _runs:      Record<string, WorkerRun>          = {};
  private _steps:     Record<string, WorkerStep[]>       = {};
  private _artifacts: Record<string, WorkerArtifactRef[]> = {};
  private _writeQueue: Promise<void>                      = Promise.resolve();

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, FILENAME);
  }

  // ── Init (load from disk) ────────────────────────────────────────────────────

  /**
   * Load persisted data from disk into memory.
   * Call once at startup before any reads or writes.
   * Gracefully degrades to an empty store on file corruption.
   */
  init(): void {
    try {
      if (!fs.existsSync(this._filePath)) return;
      const raw    = fs.readFileSync(this._filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WorkerRunStoreData>;
      if (parsed.version !== FILE_VER) {
        console.warn('[WorkerRunStore] unexpected version, starting fresh');
        return;
      }
      this._runs      = parsed.runs      ?? {};
      this._steps     = parsed.steps     ?? {};
      this._artifacts = parsed.artifacts ?? {};
    } catch (e) {
      console.error('[WorkerRunStore] init failed, starting empty:', e);
      this._runs      = {};
      this._steps     = {};
      this._artifacts = {};
    }
  }

  // ── Runs ─────────────────────────────────────────────────────────────────────

  createRun(run: WorkerRun): WorkerRun {
    this._runs[run.id]  = run;
    this._steps[run.id]     = [];
    this._artifacts[run.id] = [];
    this._persist();
    return run;
  }

  updateRun(id: string, patch: Partial<Omit<WorkerRun, 'id' | 'createdAt' | 'machineId'>>): WorkerRun | null {
    const existing = this._runs[id];
    if (!existing) return null;
    const updated: WorkerRun = { ...existing, ...patch, updatedAt: Date.now() };
    this._runs[id] = updated;
    this._persist();
    return updated;
  }

  getRun(id: string): WorkerRun | null {
    return this._runs[id] ?? null;
  }

  listRuns(filter?: { status?: WorkerRunStatus; machineId?: string }): WorkerRun[] {
    let runs = Object.values(this._runs);
    if (filter?.status)    runs = runs.filter(r => r.status === filter.status);
    if (filter?.machineId) runs = runs.filter(r => r.machineId === filter.machineId);
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Steps ─────────────────────────────────────────────────────────────────────

  addStep(step: WorkerStep): WorkerStep {
    if (!this._steps[step.runId]) this._steps[step.runId] = [];
    this._steps[step.runId].push(step);
    this._persist();
    return step;
  }

  updateStep(runId: string, stepId: string, patch: Partial<Omit<WorkerStep, 'id' | 'runId' | 'index'>>): WorkerStep | null {
    const steps = this._steps[runId];
    if (!steps) return null;
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return null;
    const updated: WorkerStep = { ...steps[idx], ...patch };
    steps[idx] = updated;
    this._persist();
    return updated;
  }

  getSteps(runId: string): WorkerStep[] {
    return this._steps[runId] ?? [];
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────────

  addArtifact(artifact: WorkerArtifactRef): WorkerArtifactRef {
    if (!this._artifacts[artifact.runId]) this._artifacts[artifact.runId] = [];
    this._artifacts[artifact.runId].push(artifact);
    // Also register the artifact ID on the run record
    const run = this._runs[artifact.runId];
    if (run && !run.artifacts.includes(artifact.id)) {
      this._runs[artifact.runId] = { ...run, artifacts: [...run.artifacts, artifact.id], updatedAt: Date.now() };
    }
    this._persist();
    return artifact;
  }

  getArtifacts(runId: string): WorkerArtifactRef[] {
    return this._artifacts[runId] ?? [];
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private _persist(): void {
    const data: WorkerRunStoreData = {
      version:   FILE_VER,
      runs:      this._runs,
      steps:     this._steps,
      artifacts: this._artifacts,
    };

    this._writeQueue = this._writeQueue.then(() => {
      try {
        const dir = path.dirname(this._filePath);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = this._filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this._filePath);
      } catch (e) {
        console.error('[WorkerRunStore] persist failed:', e);
      }
    });
  }
}
