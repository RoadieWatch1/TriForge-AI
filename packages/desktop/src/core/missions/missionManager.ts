/**
 * missionManager.ts — Persistent AI Mission System.
 *
 * Manages long-running autonomous tasks ("missions") that persist across
 * app restarts, crashes, and OS reboots.
 *
 * Missions survive because:
 *  1. Definitions are persisted in MissionStore (JSON file).
 *  2. On boot, restoreFromStore() re-registers all enabled missions.
 *  3. Schedules use an internal tick loop (independent of AgentLoop).
 */

import type { AgentLoop, TaskCategory } from '@triforge/engine';
import { eventBus } from '@triforge/engine';
import { MissionStore, type MissionDefinition } from './missionStore';

// ── Runtime Mission (includes the task function) ───────────────────────────────

export interface Mission extends MissionDefinition {
  task: () => Promise<void>;
}

// ── MissionManager ─────────────────────────────────────────────────────────────

export class MissionManager {
  private _missions    = new Map<string, Mission>();
  private _tickTimer:  ReturnType<typeof setInterval> | null = null;
  private _lastTickAt: number | null = null;

  constructor(
    private _store:     MissionStore,
    private _agentLoop: AgentLoop,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  register(mission: Mission): void {
    this._missions.set(mission.id, mission);

    this._store.save({
      id:          mission.id,
      name:        mission.name,
      description: mission.description,
      goal:        mission.goal,
      category:    mission.category,
      schedule:    mission.schedule,
      enabled:     mission.enabled,
      createdAt:   this._store.get(mission.id)?.createdAt ?? Date.now(),
    });

    eventBus.emit({
      type:     'MISSION_REGISTERED',
      missionId: mission.id,
      name:     mission.name,
      schedule: mission.schedule,
    });

    console.log(`[MissionManager] Registered "${mission.name}"${mission.schedule ? ` (${mission.schedule})` : ''}`);
    this._ensureTickerRunning();
  }

  async runMission(id: string): Promise<void> {
    const mission = this._missions.get(id);
    if (!mission) {
      console.warn(`[MissionManager] runMission: unknown id "${id}"`);
      return;
    }

    console.log(`[Mission] Running "${mission.name}"`);
    eventBus.emit({ type: 'MISSION_FIRED', missionId: id, name: mission.name });
    this._store.update(id, { lastRunAt: Date.now() });

    try {
      await mission.task();
      eventBus.emit({ type: 'MISSION_COMPLETED', missionId: id, name: mission.name });
      console.log(`[Mission] Completed "${mission.name}"`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[Mission] Failed "${mission.name}"`, err);
      eventBus.emit({ type: 'MISSION_FAILED', missionId: id, name: mission.name, error });
    }
  }

  list(): MissionDefinition[] {
    return this._store.load();
  }

  delete(id: string): boolean {
    this._missions.delete(id);
    return this._store.delete(id);
  }

  /** Re-register all persisted missions on app boot (called from index.ts). */
  restoreFromStore(): void {
    const defs = this._store.load();
    for (const def of defs) {
      if (!def.enabled || this._missions.has(def.id)) continue;

      const captured = def; // capture for closure
      const mission: Mission = {
        ...captured,
        task: async () => {
          const task = this._agentLoop.createTask(captured.goal, captured.category);
          await this._agentLoop.runTask(task.id);
        },
      };

      this._missions.set(mission.id, mission);
      console.log(`[MissionManager] Restored "${mission.name}"`);
    }

    if (this._missions.size > 0) this._ensureTickerRunning();
  }

  /** Public start — idempotent wrapper around _ensureTickerRunning. */
  start(): void {
    this._ensureTickerRunning();
  }

  stop(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  isRunning(): boolean {
    return this._tickTimer !== null;
  }

  getLastTickAt(): number | null {
    return this._lastTickAt;
  }

  // ── Internal scheduler ─────────────────────────────────────────────────────

  private _ensureTickerRunning(): void {
    if (this._tickTimer) return;
    // Check every 60 seconds for due missions
    this._tickTimer = setInterval(() => this._tick(), 60_000);
  }

  private _tick(): void {
    const now = Date.now();
    this._lastTickAt = now;
    for (const [id, mission] of this._missions) {
      if (!mission.schedule || !mission.enabled) continue;
      const def = this._store.get(id);
      if (!def) continue;
      if (this._isDue(mission.schedule, def.createdAt, def.lastRunAt, now)) {
        this.runMission(id).catch(console.error);
      }
    }
  }

  /**
   * Determines if a mission is due to run.
   *
   * Supported schedule formats (same as Scheduler):
   *   'every@Nm'    — every N minutes
   *   'every@Nh'    — every N hours
   *   'daily@HH:MM' — once per day at wall-clock time
   */
  private _isDue(
    schedule:  string,
    createdAt: number,
    lastRunAt: number | undefined,
    now:       number,
  ): boolean {
    // 'every@Nm'
    const everyM = schedule.match(/^every@(\d+)m$/);
    if (everyM) {
      const intervalMs = parseInt(everyM[1]) * 60 * 1_000;
      const reference  = lastRunAt ?? createdAt;
      return (now - reference) >= intervalMs;
    }

    // 'every@Nh'
    const everyH = schedule.match(/^every@(\d+)h$/);
    if (everyH) {
      const intervalMs = parseInt(everyH[1]) * 60 * 60 * 1_000;
      const reference  = lastRunAt ?? createdAt;
      return (now - reference) >= intervalMs;
    }

    // 'daily@HH:MM'
    const daily = schedule.match(/^daily@(\d{2}):(\d{2})$/);
    if (daily) {
      const targetHour   = parseInt(daily[1]);
      const targetMinute = parseInt(daily[2]);
      const d            = new Date(now);

      if (d.getHours() !== targetHour || d.getMinutes() !== targetMinute) return false;
      if (!lastRunAt) return true;

      // Only once per calendar day
      return new Date(lastRunAt).toDateString() !== d.toDateString();
    }

    return false;
  }
}

// ── Factory helper — builds a mission whose task runs an AI goal ───────────────

export function createAiMission(
  id:          string,
  name:        string,
  goal:        string,
  category:    TaskCategory,
  schedule?:   string,
  description?: string,
): Omit<Mission, 'task'> & { task: null } {
  return { id, name, goal, category, schedule, description, enabled: true, createdAt: Date.now(), task: null as never };
}
