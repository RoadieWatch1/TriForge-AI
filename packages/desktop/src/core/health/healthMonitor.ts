/**
 * healthMonitor.ts — Lightweight system health monitor.
 *
 * Continuously checks the status of core TriForge subsystems and reports
 * problems. Integrates with ServiceSupervisor for self-healing restarts.
 *
 * Usage:
 *   healthMonitor.register({ name: 'MySystem', check: () => mySystem.isOk() });
 *   healthMonitor.start(15_000); // check every 15s
 */

import { eventBus } from '@triforge/engine';

// ── Public interfaces ──────────────────────────────────────────────────────────

export interface HealthCheck {
  name:  string;
  /** Return true = healthy. Throw or return false = unhealthy. */
  check: () => Promise<boolean> | boolean;
}

export interface HealthReport {
  name:      string;
  healthy:   boolean;
  error?:    string;
  checkedAt: number;
}

// ── HealthMonitor ──────────────────────────────────────────────────────────────

export class HealthMonitor {
  private _checks:      HealthCheck[] = [];
  private _lastResults: Map<string, HealthReport> = new Map();
  private _failCounts:  Map<string, number>        = new Map();
  private _timer:       ReturnType<typeof setInterval> | null = null;

  /** Optional hook — called when a component fails consecutively. */
  onUnhealthy?: (name: string, failCount: number) => void;

  register(check: HealthCheck): void {
    const existing = this._checks.findIndex(c => c.name === check.name);
    if (existing !== -1) {
      this._checks[existing] = check; // replace existing
    } else {
      this._checks.push(check);
    }
  }

  start(intervalMs = 15_000): void {
    if (this._timer) return;
    this._timer = setInterval(() => this.runChecks(), intervalMs);
    console.log(`[HealthMonitor] Started — checking ${this._checks.length} component(s) every ${intervalMs}ms`);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async runChecks(): Promise<HealthReport[]> {
    const reports: HealthReport[] = [];

    for (const check of this._checks) {
      let healthy = false;
      let error: string | undefined;

      try {
        healthy = await check.check();
      } catch (err) {
        healthy = false;
        error   = err instanceof Error ? err.message : String(err);
      }

      const report: HealthReport = { name: check.name, healthy, error, checkedAt: Date.now() };
      this._lastResults.set(check.name, report);
      reports.push(report);

      if (healthy) {
        this._failCounts.set(check.name, 0);
        console.log(`[Health] ${check.name} OK`);
      } else {
        const failCount = (this._failCounts.get(check.name) ?? 0) + 1;
        this._failCounts.set(check.name, failCount);
        console.warn(`[Health] ${check.name} unhealthy (${failCount}x)${error ? ': ' + error : ''}`);

        // Emit warning event so UI / logs can respond
        eventBus.emit({
          type:             'AUTONOMY_HEALTH',
          activeWorkflows:  0,
          sensorsRunning:   0,
          pendingApprovals: 0,
        } as import('@triforge/engine').EngineEvent & { type: 'AUTONOMY_HEALTH' });

        // Trigger self-healing hook after 2 consecutive failures
        if (failCount >= 2 && this.onUnhealthy) {
          this.onUnhealthy(check.name, failCount);
        }
      }
    }

    return reports;
  }

  getStatus(): HealthReport[] {
    return [...this._lastResults.values()];
  }

  isComponentHealthy(name: string): boolean {
    return this._lastResults.get(name)?.healthy ?? true; // optimistic before first check
  }
}

/** Singleton — shared across main process */
export const healthMonitor = new HealthMonitor();
