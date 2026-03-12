// ── safeQuarantineManager.ts — Protected quarantine with auto-restore ───────
//
// Quarantines dormant/redundant components with mandatory safety rails.
// Protected categories NEVER quarantined. Auto-restore after configurable
// timeout unless explicitly confirmed.

import type { ComponentUseTracker } from './componentUseTracker';
import type { EvolutionAuditLedger } from './evolutionAuditLedger';
import type { QuarantineAction, EvolutionConfig } from './evolutionTypes';
import { DEFAULT_EVOLUTION_CONFIG, PROTECTED_CATEGORIES } from './evolutionTypes';

export class SafeQuarantineManager {
  private _tracker: ComponentUseTracker;
  private _ledger: EvolutionAuditLedger;
  private _config: EvolutionConfig;
  private _quarantined: Map<string, QuarantineAction> = new Map();

  constructor(
    tracker: ComponentUseTracker,
    ledger: EvolutionAuditLedger,
    config?: Partial<EvolutionConfig>,
  ) {
    this._tracker = tracker;
    this._ledger = ledger;
    this._config = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
  }

  // ── Quarantine ──────────────────────────────────────────────────────────────

  quarantine(componentId: string, reason: string): QuarantineAction | null {
    // Safety check: never quarantine protected components
    if (this.isProtected(componentId)) return null;

    const record = this._tracker.getRecord(componentId);
    if (!record) return null;

    // Already quarantined
    if (this._quarantined.has(componentId)) return null;

    const action: QuarantineAction = {
      componentId,
      reason,
      timestamp: Date.now(),
      reversible: true,
      autoRestoreAfterMs: this._config.autoRestoreMs,
    };

    this._quarantined.set(componentId, action);

    // Update component record
    record.healthStatus = 'quarantined';
    record.quarantinedAt = action.timestamp;
    this._tracker.registerComponent(record.id, record.name, record.category, {
      linkedExpertId: record.linkedExpertId,
      isProtected: record.isProtected,
    });

    this._ledger.record('quarantined', componentId, {
      reason,
      autoRestoreAfterMs: action.autoRestoreAfterMs,
    });

    return action;
  }

  // ── Restore ─────────────────────────────────────────────────────────────────

  restore(componentId: string): boolean {
    if (!this._quarantined.has(componentId)) return false;

    this._quarantined.delete(componentId);

    const record = this._tracker.getRecord(componentId);
    if (record) {
      record.healthStatus = 'restored';
      record.restoredAt = Date.now();
    }

    this._ledger.record('restored', componentId, {
      restoredAt: Date.now(),
    });

    return true;
  }

  // ── Auto-restore expired quarantines ────────────────────────────────────────

  autoRestoreExpired(): string[] {
    const now = Date.now();
    const restored: string[] = [];

    for (const [componentId, action] of this._quarantined) {
      const elapsed = now - action.timestamp;
      if (elapsed >= action.autoRestoreAfterMs) {
        this._quarantined.delete(componentId);

        const record = this._tracker.getRecord(componentId);
        if (record) {
          record.healthStatus = 'restored';
          record.restoredAt = now;
        }

        this._ledger.record('auto_restored', componentId, {
          quarantinedFor: elapsed,
          autoRestoreAfterMs: action.autoRestoreAfterMs,
        });

        restored.push(componentId);
      }
    }

    return restored;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  isQuarantined(componentId: string): boolean {
    return this._quarantined.has(componentId);
  }

  isProtected(componentId: string): boolean {
    const record = this._tracker.getRecord(componentId);
    if (!record) return false;

    if (record.isProtected) return true;
    if (PROTECTED_CATEGORIES.includes(record.category)) return true;

    return false;
  }

  getQuarantinedComponents(): QuarantineAction[] {
    return [...this._quarantined.values()];
  }

  getQuarantineAction(componentId: string): QuarantineAction | undefined {
    return this._quarantined.get(componentId);
  }
}
