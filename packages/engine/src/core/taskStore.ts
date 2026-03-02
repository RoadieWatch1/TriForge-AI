import * as fs from 'fs';
import * as path from 'path';
import type { Task, TaskCategory, TaskStatus } from './taskTypes';

// ── TaskStore ─────────────────────────────────────────────────────────────────
// Persistent JSON store for Task objects.
// File: <dataDir>/triforge-tasks.json  →  { tasks: Record<string, Task> }
// Uses atomic write (tmp + rename) same as store.ts pattern.

interface StoreData {
  tasks: Record<string, Task>;
}

export class TaskStore {
  private _filePath: string;
  private _tmpPath: string;
  private _cache: Record<string, Task> = {};
  private _initialized = false;
  private _saveQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-tasks.json');
    this._tmpPath = path.join(dataDir, 'triforge-tasks.json.tmp');
  }

  loadAll(): void {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const data: StoreData = JSON.parse(raw);
      this._cache = data.tasks ?? {};

      // Safety: any task that was mid-execution when we shut down is now 'paused'
      // (do NOT auto-resume — startup resume in ipc.ts handles that after 3s)
      for (const task of Object.values(this._cache)) {
        if (task.status === 'running' || task.status === 'planning') {
          task.status = 'paused';
          task.updatedAt = Date.now();
        }
        // Phase 3.5: recover steps that were stuck mid-execution (crash recovery)
        if (task.plan) {
          for (const step of task.plan.steps) {
            if (step.status === 'running') {
              step.status = 'pending';
              step.runToken = undefined;
              step.blockedReason = 'Recovered after crash';
            }
          }
        }
      }
    } catch {
      this._cache = {};
    }
    this._initialized = true;
  }

  create(task: Task): Task {
    this._ensureLoaded();
    this._cache[task.id] = task;
    this._save();
    return task;
  }

  read(id: string): Task | null {
    this._ensureLoaded();
    return this._cache[id] ?? null;
  }

  update(id: string, patch: Partial<Task>): Task | null {
    this._ensureLoaded();
    const existing = this._cache[id];
    if (!existing) return null;
    this._cache[id] = { ...existing, ...patch, updatedAt: Date.now() };
    this._save();
    return this._cache[id];
  }

  delete(id: string): boolean {
    this._ensureLoaded();
    if (!this._cache[id]) return false;
    delete this._cache[id];
    this._save();
    return true;
  }

  list(filter?: { category?: TaskCategory; status?: TaskStatus }): Task[] {
    this._ensureLoaded();
    let tasks = Object.values(this._cache);
    if (filter?.category) tasks = tasks.filter(t => t.category === filter.category);
    if (filter?.status) tasks = tasks.filter(t => t.status === filter.status);
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _ensureLoaded(): void {
    if (!this._initialized) this.loadAll();
  }

  private _save(): void {
    const data: StoreData = { tasks: { ...this._cache } };
    const json = JSON.stringify(data, null, 2);
    // Queue writes to avoid interleaved writes
    this._saveQueue = this._saveQueue.then(() => {
      try {
        fs.writeFileSync(this._tmpPath, json, 'utf8');
        fs.renameSync(this._tmpPath, this._filePath);
      } catch (err) {
        console.error('[TaskStore] save error:', err);
      }
    });
  }
}
