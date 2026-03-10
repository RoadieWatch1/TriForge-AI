// ── expertWorkforceEngine.ts — Top-level expert management orchestrator ──────
//
// Manages the full expert roster: evaluation, lifecycle transitions,
// hiring requests, replacement requests, roster health.
// Delegates routing to ExpertRouter.

import type { StorageAdapter } from '../platform';
import type { ExpertRegistry } from './expertRegistry';
import { isProtectedRole } from './expertRegistry';
import type { ExpertRouter } from './expertRouter';
import type { ExpertPerformanceTracker } from './expertPerformanceTracker';
import type {
  ExpertProfile,
  ExpertSelectionDecision, ExpertRoutingContext,
  ExpertHiringNeed, ExpertReplacementDecision,
  WorkforceHealthReport, WorkforceRecommendation,
  RosterHealthSummary,
} from './expertTypes';

const WATCHLIST_SURVIVAL_THRESHOLD = 0.25;
const BENCH_CYCLES_ON_WATCHLIST = 2;

export class ExpertWorkforceEngine {
  private _watchlistCycles: Record<string, number> = {};

  constructor(
    private _registry: ExpertRegistry,
    private _router: ExpertRouter,
    private _tracker: ExpertPerformanceTracker,
    private _storage: StorageAdapter,
  ) {}

  initialize(): void {
    this._registry.initialize();
  }

  // ── Public expert queries (delegates to registry) ───────────────────────

  getAllExperts(): ExpertProfile[] {
    return this._registry.getAllExperts();
  }

  getExpert(id: string): ExpertProfile | undefined {
    return this._registry.getExpert(id);
  }

  // ── Task routing (delegates to router) ────────────────────────────────────

  getExpertForTask(
    taskType: string,
    context?: ExpertRoutingContext,
  ): ExpertSelectionDecision {
    return this._router.selectExperts(taskType, context);
  }

  // ── Lifecycle management ──────────────────────────────────────────────────

  moveToWatchlist(expertId: string, reason: string): void {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'active') return;

    this._registry.updateStatus(expertId, 'watchlist');
    this._watchlistCycles[expertId] = 0;
  }

  moveToBench(expertId: string, reason: string): void {
    const expert = this._registry.getExpert(expertId);
    if (!expert) return;

    // Protected experts cannot be benched
    if (isProtectedRole(expert.role)) return;

    this._registry.updateStatus(expertId, 'bench');
    delete this._watchlistCycles[expertId];
  }

  retire(expertId: string, reason: string): void {
    const expert = this._registry.getExpert(expertId);
    if (!expert) return;

    // Protected experts cannot be retired
    if (isProtectedRole(expert.role)) return;

    this._registry.updateStatus(expertId, 'retired');
    delete this._watchlistCycles[expertId];
  }

  promote(expertId: string): void {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'trial') return;

    this._registry.updateStatus(expertId, 'active');
  }

  restoreFromBench(expertId: string): void {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'bench') return;

    this._registry.updateStatus(expertId, 'active');
  }

  // ── Hiring / replacement requests ─────────────────────────────────────────

  requestHiring(need: ExpertHiringNeed): void {
    // Stored for processing by ExpertHiringEngine
    const data = this._storage.get<{ hiringQueue: ExpertHiringNeed[] }>(
      'triforge.expertHiringQueue', { hiringQueue: [] }
    );
    data.hiringQueue.push(need);
    this._storage.update('triforge.expertHiringQueue', data);
  }

  requestReplacement(decision: ExpertReplacementDecision): void {
    // Stored for processing by ExpertReplacementEngine
    const data = this._storage.get<{ replacementQueue: ExpertReplacementDecision[] }>(
      'triforge.expertReplacementQueue', { replacementQueue: [] }
    );
    data.replacementQueue.push(decision);
    this._storage.update('triforge.expertReplacementQueue', data);
  }

  // ── Workforce evaluation ──────────────────────────────────────────────────

  evaluateWorkforce(): WorkforceHealthReport {
    const summary = this._registry.getRosterSummary();
    const recommendations: WorkforceRecommendation[] = [];
    const experts = this._registry.getAllExperts();

    for (const expert of experts) {
      if (expert.status === 'active') {
        const contribution = this._tracker.computeContributionScore(expert.id);
        const redundancy = this._tracker.computeRedundancyScore(expert.id);

        // Watchlist: low contribution + high redundancy
        if (contribution < 30 && redundancy > 60 && expert.selectionCount >= 5) {
          recommendations.push({
            expertId: expert.id,
            action: 'watchlist',
            reason: `Low contribution (${contribution}) + high redundancy (${redundancy})`,
            confidence: 70,
          });
        }
      }

      if (expert.status === 'watchlist') {
        this._watchlistCycles[expert.id] = (this._watchlistCycles[expert.id] ?? 0) + 1;

        if (this._watchlistCycles[expert.id] >= BENCH_CYCLES_ON_WATCHLIST) {
          if (!isProtectedRole(expert.role)) {
            recommendations.push({
              expertId: expert.id,
              action: 'bench',
              reason: `On watchlist for ${this._watchlistCycles[expert.id]} cycles`,
              confidence: 80,
            });
          }
        }
      }

      if (expert.status === 'trial') {
        const perf = this._tracker.getPerformanceRecord(expert.id);
        if (perf.selectionCount >= 5 && perf.outputSurvivedRate > 0.4) {
          recommendations.push({
            expertId: expert.id,
            action: 'promote',
            reason: `Trial passed: ${perf.selectionCount} tasks, ${Math.round(perf.outputSurvivedRate * 100)}% survival`,
            confidence: 85,
          });
        }
      }
    }

    return {
      timestamp: Date.now(),
      summary,
      recommendations,
    };
  }

  // ── Roster health ─────────────────────────────────────────────────────────

  getRosterHealth(): RosterHealthSummary {
    const summary = this._registry.getRosterSummary();
    const topPerformers = this._tracker.getTopExperts(5);
    const underperformers = this._tracker.getUnderperformers(WATCHLIST_SURVIVAL_THRESHOLD);
    const dormant = this._tracker.getDormantExperts(30);
    const hiringQueue = this._storage.get<{ hiringQueue: ExpertHiringNeed[] }>(
      'triforge.expertHiringQueue', { hiringQueue: [] }
    );

    return {
      summary,
      topPerformers,
      underperformers,
      dormant,
      hiringNeeds: hiringQueue.hiringQueue,
    };
  }

  // ── Maintenance cycle ─────────────────────────────────────────────────────

  runMaintenanceCycle(): WorkforceHealthReport {
    const report = this.evaluateWorkforce();

    // Auto-apply safe recommendations
    for (const rec of report.recommendations) {
      if (rec.confidence < 75) continue; // skip low-confidence

      switch (rec.action) {
        case 'watchlist':
          this.moveToWatchlist(rec.expertId, rec.reason);
          break;
        case 'bench':
          this.moveToBench(rec.expertId, rec.reason);
          break;
        case 'promote':
          this.promote(rec.expertId);
          break;
        // hire, retire, replace require higher-level orchestration
      }
    }

    return report;
  }
}
