// ── AutonomyController.ts — Coordinates workspace observation + analysis ──────
//
// Workflow (observation-only, never applies changes directly):
//   file change detected → debounce → analyzeWorkspace → detectIssues
//   → create ApprovalStore requests per proposal → emit 'autonomy:proposals_ready'
//
// Safety: AutonomyController NEVER writes files, NEVER runs patches.
// It only observes and proposes. User approval required for all actions.
//
// Guarded by AUTONOMY_FLAGS.enableAutonomyLoop (default: false).

import { EventEmitter } from 'events';
import type { ApprovalStore } from '@triforge/engine';
import { WorkspaceObserver } from './WorkspaceObserver';
import { analyzeWorkspace } from './AnalysisEngine';
import { Scheduler } from './Scheduler';
import { AUTONOMY_FLAGS } from '../config/autonomyFlags';
import { createLogger } from '../logging/log';

const log = createLogger('AutonomyController');

const DEBOUNCE_MS      = 30_000;       // 30s min between scans after file change
const PERIODIC_SCAN_MS = 5 * 60 * 1000; // 5 minutes

export interface AutonomyDeps {
  approvalStore: ApprovalStore;
}

export class AutonomyController extends EventEmitter {
  private observer  = new WorkspaceObserver();
  private scheduler = new Scheduler();
  private cancelScan: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScanAt = 0;
  private running = false;
  private _deps: AutonomyDeps | null = null;

  /** Inject engine singletons — call from ipc.ts before start(). */
  init(deps: AutonomyDeps): void {
    this._deps = deps;
  }

  start(root: string): void {
    if (!AUTONOMY_FLAGS.enableAutonomyLoop) {
      log.info('autonomy loop disabled (enableAutonomyLoop=false)');
      return;
    }
    if (this.running) return;
    this.running = true;

    this.observer.start(root);
    this.observer.on('file_changed', () => this._scheduleScan(root));
    this.observer.on('file_added',   () => this._scheduleScan(root));

    // Periodic scan with jitter
    this.cancelScan = this.scheduler.schedule(() => this._scan(root), PERIODIC_SCAN_MS);
    log.info('started, watching', root);
  }

  stop(): void {
    this.running = false;
    this.observer.stop();
    this.cancelScan?.();
    this.cancelScan = null;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
  }

  isRunning(): boolean { return this.running; }

  private _scheduleScan(root: string): void {
    const now = Date.now();
    if (now - this.lastScanAt < DEBOUNCE_MS) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this._scan(root), 2000);
  }

  private async _scan(root: string): Promise<void> {
    this.lastScanAt = Date.now();
    try {
      const ctx = await analyzeWorkspace(root);
      if (ctx.issues.length === 0) return;

      // Create ApprovalStore requests for each proposal (if deps available)
      if (this._deps && AUTONOMY_FLAGS.enableAutoProposals) {
        for (const proposal of ctx.issues) {
          try {
            this._deps.approvalStore.create({
              taskId:             'autonomy',
              stepId:             proposal.id,
              tool:               'read_file',  // lowest-risk tool for type compliance
              args:               { proposal },
              riskLevel:          proposal.recommended ? 'medium' : 'low',
              estimatedCostCents: 0,
              expiresAt:          Date.now() + 24 * 60 * 60 * 1000, // 24h
            });
          } catch { /* individual proposal failures are non-fatal */ }
        }
      }

      // Emit event — IPC layer forwards to renderer
      this.emit('autonomy:proposals_ready', ctx.issues);
    } catch { /* non-fatal — never crash the app */ }
  }
}

/** Singleton. */
export const autonomyController = new AutonomyController();
