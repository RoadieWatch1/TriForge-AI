// ── incomeAutopilot.ts ─────────────────────────────────────────────────────────
//
// Autonomous Income Operator loop — polls experiments, regenerates recommendations,
// detects changes, and creates approval requests for critical/high signals.
//
// Safety contract:
//   - No risky action is executed directly.
//   - Autopilot only: creates approval requests, logs events, notifies the renderer.
//   - Business logic stays in incomeDecisionEngine.ts.
//   - Snapshot is in-memory only; a fresh evaluation runs on each app start.
//

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { Store } from './store';
import type { ExperimentManager } from './experimentManager';
import { ApprovalStore } from '@triforge/engine';
import { generateRecommendations } from './incomeDecisionEngine';
import type { IncomeRecommendation, DecisionInput } from './incomeDecisionEngine';
import type { TaskToolName } from '@triforge/engine';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS      = 15 * 60 * 1000; // 15 minutes
const ENABLED_KEY              = 'incomeAutopilotEnabled';
const MAX_APPROVALS_PER_CYCLE  = 3;              // cap per run to prevent burst
const MAX_PENDING_INCOME       = 10;             // global ceiling on pending income approvals
const COOLDOWN_MS              = 10 * 60 * 1000; // 10 min between approvals per experiment
const INCOME_TOOL_SET = new Set([
  'launch_experiment', 'spend_budget', 'publish_content',
  'kill_experiment', 'scale_experiment', 'connect_platform', 'install_tool',
] as const);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutopilotStatus {
  enabled:         boolean;
  running:         boolean;
  lastRunAt:       number | null;
  intervalMs:      number;
  newRecoCount:    number;
  lastCycleResult: string | null;
}

export interface AutopilotConfig {
  intervalMs?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Stable fingerprint for change detection.
 * Two recommendations are "the same" if they share experimentId, action, priority,
 * and blocker set — any change to these warrants re-surfacing.
 */
function recoFingerprint(r: IncomeRecommendation): string {
  return `${r.experimentId}:${r.recommendedAction}:${r.priority}:${r.blockedBy.sort().join(',')}`;
}

// ── IncomeAutopilot ───────────────────────────────────────────────────────────

export class IncomeAutopilot {
  private _timer:           ReturnType<typeof setInterval> | null = null;
  private _running          = false;
  private _lastRunAt:       number | null = null;
  private _newRecoCount     = 0;
  private _lastCycleResult: string | null = null;
  private _ledgerPath:      string;

  // In-memory snapshot — intentionally not persisted.
  // On each app start the first cycle establishes a fresh baseline.
  private _lastRecoFingerprints: Set<string> = new Set();

  // Per-experiment cooldown: experimentId → timestamp of last autopilot-created approval
  private _lastApprovalCreatedAt: Map<string, number> = new Map();

  constructor(
    private _store:         Store,
    private _expMgr:        ExperimentManager,
    private _approvalStore: ApprovalStore,
    dataDir:                string,
    private _intervalMs:    number = DEFAULT_INTERVAL_MS,
    /**
     * Entitlement gate — injected from IPC layer so the autopilot doesn't
     * reach back into subscription/tier logic directly.
     * Returns true if the current user is allowed to create income approvals.
     */
    private _canCreateApproval: () => boolean = () => true,
  ) {
    this._ledgerPath = path.join(dataDir, 'income-ledger.jsonl');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  isEnabled(): boolean {
    return this._store.get<string>(ENABLED_KEY, 'false') === 'true';
  }

  enable(): void {
    this._store.update(ENABLED_KEY, 'true');
    this._startLoop();
  }

  disable(): void {
    this._store.update(ENABLED_KEY, 'false');
    this._stopLoop();
  }

  /**
   * Called from the main IPC setup function after singletons are ready.
   * Resumes the loop if it was enabled in a previous session.
   */
  resume(): void {
    if (this.isEnabled()) this._startLoop();
  }

  // ── Loop control ───────────────────────────────────────────────────────────

  private _startLoop(): void {
    if (this._timer) return; // Already scheduled
    void this._runCycle();   // Run immediately
    this._timer = setInterval(() => { void this._runCycle(); }, this._intervalMs);
  }

  private _stopLoop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Manual trigger — exposed via IPC as autopilot:runNow */
  async runNow(): Promise<void> {
    await this._runCycle();
  }

  // ── Core cycle ─────────────────────────────────────────────────────────────

  private async _runCycle(): Promise<void> {
    if (this._running) return; // Prevent concurrent cycles
    this._running = true;

    try {
      // 1. Load active experiments
      const experiments = this._expMgr.getActiveExperiments();
      if (experiments.length === 0) {
        this._lastRunAt       = Date.now();
        this._newRecoCount    = 0;
        this._lastCycleResult = 'No active experiments.';
        this._emit('income:autopilot:status');
        return;
      }

      // 2. Load pending income approvals — used for idempotency in the decision engine
      const pendingApprovals = this._approvalStore.listPending().filter(
        a => INCOME_TOOL_SET.has(a.tool as 'launch_experiment'),
      );
      const pendingKeys = new Set(pendingApprovals.map(a => `${a.taskId}:${a.tool}`));

      // 3. Evaluate auto-kill for all active experiments
      const evaluations: DecisionInput['evaluations'] = {};
      for (const exp of experiments) {
        evaluations[exp.id] = this._expMgr.evaluateAutoKill(exp.id);
      }

      // 4. Generate fresh recommendations
      const budget = this._expMgr.getBudget();
      const recs   = generateRecommendations({
        experiments,
        evaluations,
        budget,
        pendingApprovalKeys: pendingKeys,
      });

      // 5. Diff against in-memory snapshot
      const currentFingerprints = new Set(recs.map(recoFingerprint));
      const newRecs             = recs.filter(r => !this._lastRecoFingerprints.has(recoFingerprint(r)));
      const newRecoCount        = newRecs.length;

      // 6. Auto-create approval requests for new critical/high signals
      //    Safeguards:
      //      a) Entitlement check — skip if user doesn't have income capability
      //      b) Global pending ceiling — skip entire pass if too many pending
      //      c) Per-cycle cap — stop after MAX_APPROVALS_PER_CYCLE this run
      //      d) Per-experiment cooldown — skip if created one recently
      //    (generateRecommendations already filtered existing pending approvals
      //     via pendingKeys — the cooldown is an additional in-memory guard.)
      let approvalsCreated = 0;
      const canCreate = this._canCreateApproval();
      const pendingCount = pendingApprovals.length;

      if (canCreate && pendingCount < MAX_PENDING_INCOME) {
        const now = Date.now();
        for (const rec of newRecs) {
          if (approvalsCreated >= MAX_APPROVALS_PER_CYCLE) break;
          if (
            rec.approvalRequired &&
            rec.blockedBy.length === 0 &&
            (rec.priority === 'critical' || rec.priority === 'high')
          ) {
            // Per-experiment cooldown check
            const lastCreated = this._lastApprovalCreatedAt.get(rec.experimentId) ?? 0;
            if (now - lastCreated < COOLDOWN_MS) continue;
            try {
              this._approvalStore.create({
                taskId:             rec.experimentId,
                stepId:             rec.recommendedAction,
                tool:               rec.recommendedAction as TaskToolName,
                args:               {},
                riskLevel:          rec.riskLevel,
                estimatedCostCents: 0,
                expiresAt:          Date.now() + 24 * 60 * 60 * 1000,
              });
              this._lastApprovalCreatedAt.set(rec.experimentId, now);
              approvalsCreated++;
              this._appendLedgerEvent(
                'AUTOPILOT_APPROVAL_CREATED',
                `Autopilot created approval: ${rec.recommendedAction}`,
                `"${rec.experimentName}" — ${rec.reason}`,
              );
            } catch {
              // Non-fatal — next cycle will retry if signal persists
            }
          }
        }
      }

      // 7. Update in-memory snapshot
      this._lastRecoFingerprints = currentFingerprints;
      this._newRecoCount         = newRecoCount;

      // 8. Log cycle outcome to income event stream
      const cycleMsg = newRecoCount > 0
        ? `${newRecoCount} new recommendation${newRecoCount > 1 ? 's' : ''}${
            approvalsCreated > 0
              ? `, ${approvalsCreated} approval request${approvalsCreated > 1 ? 's' : ''} created`
              : ''
          }.`
        : `${recs.length} active recommendation${recs.length !== 1 ? 's' : ''}, no changes.`;

      this._appendLedgerEvent(
        'AUTOPILOT_RUN_COMPLETED',
        'Autopilot cycle complete',
        cycleMsg,
      );

      if (newRecoCount > 0) {
        this._appendLedgerEvent(
          'AUTOPILOT_RECOMMENDATION_CHANGED',
          'Recommendations updated',
          cycleMsg,
        );
      }

      this._lastRunAt       = Date.now();
      this._lastCycleResult = cycleMsg;

      // 9. Notify renderer
      this._emit('income:autopilot:status');
      if (newRecoCount > 0) {
        // Signal the renderer to refresh recommendations
        this._emit('income:autopilot:changed');
      }

    } catch (err) {
      this._lastRunAt       = Date.now();
      this._lastCycleResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
      this._emit('income:autopilot:status');
    } finally {
      this._running = false;
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(): AutopilotStatus {
    return {
      enabled:         this.isEnabled(),
      running:         this._running,
      lastRunAt:       this._lastRunAt,
      intervalMs:      this._intervalMs,
      newRecoCount:    this._newRecoCount,
      lastCycleResult: this._lastCycleResult,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Broadcast an IPC channel to all open renderer windows. */
  private _emit(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        if (payload !== undefined) {
          win.webContents.send(channel, payload);
        } else {
          win.webContents.send(channel);
        }
      }
    }
  }

  /**
   * Write a compact autopilot event to income-ledger.jsonl.
   * Uses a custom type string so the activity feed can display it
   * without conflating it with spend/revenue/decision events.
   */
  private _appendLedgerEvent(type: string, label: string, detail: string): void {
    try {
      const entry = JSON.stringify({ ts: Date.now(), type, label, detail });
      fs.appendFileSync(this._ledgerPath, entry + '\n', 'utf8');
    } catch {
      // Non-fatal — autopilot logging never blocks the loop
    }
  }
}
