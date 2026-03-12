import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { TaskCategory, SchedulerJob, ScheduleType } from './taskTypes';

// ── Scheduler ─────────────────────────────────────────────────────────────────
// In-process tick-based scheduler. Fires jobs when nextRunAt <= Date.now().
// MVP cron syntax:
//   'daily@HH:MM'  — fires at that wall-clock time each day
//   'every@Nh'     — fires every N hours
//   'every@Nm'     — fires every N minutes (for testing)

interface StoreData {
  jobs: Record<string, SchedulerJob>;
}

function parseNextRun(cronExpr: string, after: number = Date.now()): number | null {
  const dailyMatch = cronExpr.match(/^daily@(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const [, hStr, mStr] = dailyMatch;
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const now = new Date(after);
    const candidate = new Date(now);
    candidate.setHours(h, m, 0, 0);
    if (candidate.getTime() <= after) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const everyHMatch = cronExpr.match(/^every@(\d+)h$/);
  if (everyHMatch) {
    return after + parseInt(everyHMatch[1], 10) * 3600 * 1000;
  }

  const everyMMatch = cronExpr.match(/^every@(\d+)m$/);
  if (everyMMatch) {
    return after + parseInt(everyMMatch[1], 10) * 60 * 1000;
  }

  return null;
}

export class Scheduler {
  private _filePath: string;
  private _tmpPath: string;
  private _cache: Record<string, SchedulerJob> = {};
  private _initialized = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  onFire: (job: SchedulerJob) => void = () => {};

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-scheduler.json');
    this._tmpPath = path.join(dataDir, 'triforge-scheduler.json.tmp');
  }

  start(): void {
    this._ensureLoaded();
    this._tick();
    this._timer = setInterval(() => this._tick(), 60_000);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  scheduleOnce(taskGoal: string, category: TaskCategory, runAt: number): SchedulerJob {
    this._ensureLoaded();
    const job: SchedulerJob = {
      id: crypto.randomUUID(),
      taskGoal,
      category,
      type: 'once',
      runAt,
      nextRunAt: runAt,
      createdAt: Date.now(),
      active: true,
    };
    this._cache[job.id] = job;
    this._save();
    return job;
  }

  scheduleRecurring(
    taskGoal: string,
    category: TaskCategory,
    cronExpr: string,
    label?: string,
  ): SchedulerJob | null {
    this._ensureLoaded();
    const nextRunAt = parseNextRun(cronExpr);
    if (nextRunAt === null) return null;

    const job: SchedulerJob = {
      id: crypto.randomUUID(),
      taskGoal,
      category,
      type: 'recurring',
      cronExpr,
      label,
      nextRunAt,
      createdAt: Date.now(),
      active: true,
    };
    this._cache[job.id] = job;
    this._save();
    return job;
  }

  cancelJob(id: string): boolean {
    this._ensureLoaded();
    if (!this._cache[id]) return false;
    this._cache[id].active = false;
    this._save();
    return true;
  }

  listJobs(): SchedulerJob[] {
    this._ensureLoaded();
    return Object.values(this._cache).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _tick(): void {
    const now = Date.now();
    for (const job of Object.values(this._cache)) {
      if (!job.active) continue;
      if ((job.nextRunAt ?? Infinity) > now) continue;

      // Fire
      job.lastFiredAt = now;

      if (job.type === 'once') {
        job.active = false;
        job.nextRunAt = undefined;
      } else if (job.cronExpr) {
        const next = parseNextRun(job.cronExpr, now);
        job.nextRunAt = next ?? undefined;
        if (next === null) job.active = false;
      }

      this._save();

      try {
        this.onFire(job);
      } catch (err) {
        console.error('[Scheduler] onFire error:', err);
      }
    }
  }

  private _ensureLoaded(): void {
    if (this._initialized) return;
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const data: StoreData = JSON.parse(raw);
      this._cache = data.jobs ?? {};
    } catch {
      this._cache = {};
    }
    this._initialized = true;
  }

  private _save(): void {
    const data: StoreData = { jobs: { ...this._cache } };
    const json = JSON.stringify(data, null, 2);
    try {
      fs.writeFileSync(this._tmpPath, json, 'utf8');
      fs.renameSync(this._tmpPath, this._filePath);
    } catch (err) {
      console.error('[Scheduler] save error:', err);
    }
  }
}
