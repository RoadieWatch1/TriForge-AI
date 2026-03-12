/**
 * AgentSafetyGuard.ts — Loop-prevention safety layer for autonomous agents.
 *
 * Tracks execution counts per task ID and blocks tasks that execute too
 * frequently, preventing runaway AI feedback loops.
 *
 * Usage:
 *   const guard = new AgentSafetyGuard();
 *   if (!guard.allow(taskId)) return; // blocked — emit AGENT_BLOCKED event
 *
 * Existing systems (AgentLoop, Scheduler, etc.) are NOT modified.
 * New autonomous flows should call guard.allow() before executing.
 */

import { eventBus } from '../core/eventBus';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_EXECUTIONS = 5;    // max runs per task before blocking
const RESET_INTERVAL_MS      = 5 * 60 * 1000; // auto-reset every 5 minutes

// ── AgentSafetyGuard ──────────────────────────────────────────────────────────

export class AgentSafetyGuard {
  private _counts:    Map<string, number>  = new Map();
  private _blocked:   Set<string>          = new Set();
  private _timer:     ReturnType<typeof setInterval> | null = null;

  constructor(private _maxExecutions: number = DEFAULT_MAX_EXECUTIONS) {}

  /**
   * Returns true if the task is allowed to execute.
   * Returns false if the task has exceeded the execution limit.
   * Emits AGENT_BLOCKED when denying.
   */
  allow(taskId: string): boolean {
    const count = (_counts => {
      const c = _counts.get(taskId) ?? 0;
      _counts.set(taskId, c + 1);
      return c + 1;
    })(this._counts);

    if (count > this._maxExecutions) {
      if (!this._blocked.has(taskId)) {
        this._blocked.add(taskId);
        eventBus.emit({
          type:   'AGENT_BLOCKED',
          taskId,
          reason: `Loop protection: task executed ${count} times (max ${this._maxExecutions})`,
          count,
        });
        console.warn(`[AgentSafetyGuard] Blocked task ${taskId} after ${count} executions`);
      }
      return false;
    }

    return true;
  }

  /**
   * Reset execution count for a specific task (or all tasks if omitted).
   */
  reset(taskId?: string): void {
    if (taskId) {
      this._counts.delete(taskId);
      this._blocked.delete(taskId);
    } else {
      this._counts.clear();
      this._blocked.clear();
    }
  }

  /**
   * Returns the current execution count for a task.
   */
  getCount(taskId: string): number {
    return this._counts.get(taskId) ?? 0;
  }

  /**
   * Returns true if the task is currently blocked.
   */
  isBlocked(taskId: string): boolean {
    return this._blocked.has(taskId);
  }

  /**
   * Start the auto-reset timer (clears all counts periodically).
   * Call once at startup; safe to call multiple times.
   */
  startAutoReset(intervalMs: number = RESET_INTERVAL_MS): void {
    if (this._timer) return;
    this._timer = setInterval(() => {
      const blockedCount = this._blocked.size;
      this.reset();
      if (blockedCount > 0) {
        console.log(`[AgentSafetyGuard] Auto-reset: cleared ${blockedCount} blocked task(s)`);
      }
    }, intervalMs);
  }

  stopAutoReset(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AgentSafetyGuard | null = null;

export function getAgentSafetyGuard(maxExecutions?: number): AgentSafetyGuard {
  if (!_instance) {
    _instance = new AgentSafetyGuard(maxExecutions);
    _instance.startAutoReset();
  }
  return _instance;
}
