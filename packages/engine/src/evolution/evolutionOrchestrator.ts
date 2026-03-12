// ── evolutionOrchestrator.ts — Top-level Performance Hunter coordinator ──────
//
// Creates and wires all evolution subsystems: component tracker, health scanner,
// quarantine manager, shadow test runner, audit ledger.
// Provides unified scan, health report, restore, and auto-maintenance.

import type { StorageAdapter } from '../platform';
import { ComponentUseTracker } from './componentUseTracker';
import { HealthScanner } from './healthScanner';
import { SafeQuarantineManager } from './safeQuarantineManager';
import { ShadowTestRunner } from './shadowTestRunner';
import { EvolutionAuditLedger } from './evolutionAuditLedger';
import type { EvolutionReport, EvolutionRecommendation, EvolutionConfig } from './evolutionTypes';
import { DEFAULT_EVOLUTION_CONFIG } from './evolutionTypes';

export class EvolutionOrchestrator {
  private _tracker: ComponentUseTracker;
  private _scanner: HealthScanner;
  private _quarantine: SafeQuarantineManager;
  private _shadowRunner: ShadowTestRunner;
  private _ledger: EvolutionAuditLedger;
  private _config: EvolutionConfig;
  private _initialized = false;

  constructor(storage: StorageAdapter, dataDir: string, config?: Partial<EvolutionConfig>) {
    this._config = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
    this._ledger = new EvolutionAuditLedger(dataDir);
    this._tracker = new ComponentUseTracker(storage);
    this._scanner = new HealthScanner(this._tracker, this._config);
    this._quarantine = new SafeQuarantineManager(this._tracker, this._ledger, this._config);
    this._shadowRunner = new ShadowTestRunner(this._tracker, this._ledger);
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initialized) return;
    await this._tracker.initialize();
    this._initialized = true;
  }

  // ── Full scan ───────────────────────────────────────────────────────────────

  async runFullScan(): Promise<EvolutionReport> {
    // Step 1: Scan all components for health classification
    const records = this._scanner.scan();

    // Step 2: Get dormant candidates for shadow testing
    const dormantCandidates = this._scanner.getDormantCandidates();
    const recommendations: EvolutionRecommendation[] = [];

    // Step 3: Shadow test each dormant candidate
    for (const candidate of dormantCandidates) {
      const testResult = await this._shadowRunner.runShadowTest(candidate.id);

      if (testResult.recommendation === 'quarantine') {
        recommendations.push({
          componentId: candidate.id,
          action: 'quarantine',
          reason: `Dormant component — shadow test impact: ${testResult.impact}`,
        });
      } else if (testResult.recommendation === 'investigate') {
        recommendations.push({
          componentId: candidate.id,
          action: 'investigate',
          reason: `Dormant but significant impact detected — needs review`,
        });
      } else {
        recommendations.push({
          componentId: candidate.id,
          action: 'keep',
          reason: `Critical impact detected — must keep active`,
        });
      }
    }

    // Step 4: Check degraded components
    const degraded = this._scanner.getDegradedComponents();
    for (const comp of degraded) {
      recommendations.push({
        componentId: comp.id,
        action: 'investigate',
        reason: `Degraded: high error rate or excessive latency`,
      });
    }

    // Step 5: Build report
    const healthy = records.filter(r => r.healthStatus === 'healthy').length;
    const degradedCount = records.filter(r => r.healthStatus === 'degraded').length;
    const dormant = records.filter(r => r.healthStatus === 'dormant').length;
    const quarantined = records.filter(r => r.healthStatus === 'quarantined').length;

    this._ledger.record('health_scan', 'system', {
      total: records.length,
      healthy,
      degraded: degradedCount,
      dormant,
      quarantined,
      recommendations: recommendations.length,
    });

    return {
      timestamp: Date.now(),
      totalComponents: records.length,
      healthy,
      degraded: degradedCount,
      dormant,
      quarantined,
      recommendations,
    };
  }

  // ── Apply safe recommendations ──────────────────────────────────────────────

  applyRecommendations(recommendations: EvolutionRecommendation[]): {
    quarantined: string[];
    skipped: string[];
  } {
    const quarantined: string[] = [];
    const skipped: string[] = [];

    for (const rec of recommendations) {
      if (rec.action === 'quarantine') {
        const result = this._quarantine.quarantine(rec.componentId, rec.reason);
        if (result) {
          quarantined.push(rec.componentId);
        } else {
          skipped.push(rec.componentId);
        }
      }
      // 'investigate' and 'keep' are informational — no auto-action
    }

    return { quarantined, skipped };
  }

  // ── Health report ───────────────────────────────────────────────────────────

  getHealthReport(): string {
    return this._scanner.generateHealthReport();
  }

  // ── Component management ────────────────────────────────────────────────────

  restoreComponent(componentId: string): boolean {
    return this._quarantine.restore(componentId);
  }

  isQuarantined(componentId: string): boolean {
    return this._quarantine.isQuarantined(componentId);
  }

  getQuarantinedComponents(): string[] {
    return this._quarantine.getQuarantinedComponents().map(a => a.componentId);
  }

  // ── Auto-maintenance ────────────────────────────────────────────────────────

  autoMaintenance(): { autoRestored: string[] } {
    const autoRestored = this._quarantine.autoRestoreExpired();
    return { autoRestored };
  }

  // ── Audit log access ───────────────────────────────────────────────────────

  async getAuditLog(since?: number) {
    return this._ledger.getEntries(since);
  }

  // ── Component registration (for expert-linked components) ───────────────────

  registerComponent(
    id: string,
    name: string,
    category: string,
    opts?: { linkedExpertId?: string; isProtected?: boolean },
  ) {
    return this._tracker.registerComponent(id, name, category, opts);
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get tracker(): ComponentUseTracker { return this._tracker; }
  get scanner(): HealthScanner { return this._scanner; }
  get quarantine(): SafeQuarantineManager { return this._quarantine; }
  get shadowRunner(): ShadowTestRunner { return this._shadowRunner; }

  dispose(): void {
    this._tracker.dispose();
  }
}
