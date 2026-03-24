/**
 * runbookScheduler.ts — Phase 33
 *
 * Monitors paused runbook executions for deadline violations.
 *
 * Tick behaviour (every tickIntervalMs, default 60 s):
 *   For each paused execution:
 *     1. If escalateAt reached and soft escalation not yet fired → fireEscalation()
 *     2. If expiresAt (hard deadline) reached → resolveTimeout()
 *        The executor will branch to onTimeout step or fail the execution.
 *
 * The scheduler is started once by ipc.ts after the store is ready.
 * It is intentionally stateless — it reads from the store on every tick.
 *
 * Handoff item updates:
 *   The scheduler also updates HandoffQueueItem.escalatedAt and marks overdue
 *   items as 'expired' in the store so the UI can show overdue badges without
 *   requiring a separate IPC round-trip.
 */

import type { Store } from './store';
import type { RunbookExecutor } from './runbookExecutor';

const PAUSED_STATUSES = new Set(['paused_approval', 'paused_confirm', 'paused_manual']);

export class RunbookScheduler {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  constructor(
    private store:              Store,
    private executorFactory:    () => RunbookExecutor,
    private tickIntervalMs:     number = 60_000,
  ) {}

  start(): void {
    if (this._timer) return;
    // Run immediately on start, then on interval
    this._tick().catch(e => console.error('[RunbookScheduler] tick error:', e));
    this._timer = setInterval(() => {
      this._tick().catch(e => console.error('[RunbookScheduler] tick error:', e));
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _tick(): Promise<void> {
    if (this._running) return;   // prevent concurrent ticks
    this._running = true;
    try {
      const now        = Date.now();
      const executions = this.store.getRunbookExecutions(200);
      const queue      = this.store.getHandoffQueue();
      const executor   = this.executorFactory();

      for (const exec of executions) {
        if (!PAUSED_STATUSES.has(exec.status)) continue;
        if (!exec.pauseTokenId) continue;

        const handoff = queue.find(h => h.id === exec.pauseTokenId && h.status === 'pending');
        if (!handoff) continue;

        // ── Hard deadline: timeout ─────────────────────────────────────────
        if (handoff.expiresAt && now >= handoff.expiresAt) {
          console.info(`[RunbookScheduler] Timeout for execution ${exec.id} (step: ${handoff.stepLabel})`);
          // Mark handoff expired in store
          this.store.resolveHandoffItem(handoff.id, 'timeout');
          // Resume via timeout branch (or fail)
          await executor.resolveTimeout(exec.id).catch(e =>
            console.error(`[RunbookScheduler] resolveTimeout error for ${exec.id}:`, e),
          );
          continue;
        }

        // ── Soft escalation ────────────────────────────────────────────────
        if (
          handoff.escalateAt &&
          now >= handoff.escalateAt &&
          !exec.escalatedAt
        ) {
          console.info(`[RunbookScheduler] Soft escalation for execution ${exec.id}`);
          await executor.fireEscalation(exec.id).catch(e =>
            console.error(`[RunbookScheduler] fireEscalation error for ${exec.id}:`, e),
          );
        }
      }
    } finally {
      this._running = false;
    }
  }
}
