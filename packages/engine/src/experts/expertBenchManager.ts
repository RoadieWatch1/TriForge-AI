// ── expertBenchManager.ts — Safe underperformer management ──────────────────
//
// Moves underperforming active experts to watchlist, then bench.
// Protected experts cannot be benched — only watchlisted with alert.

import type { ExpertRegistry } from './expertRegistry';
import { isProtectedRole } from './expertRegistry';
import type { ExpertPerformanceTracker } from './expertPerformanceTracker';
import type { ExpertRosterLedger } from './expertRosterLedger';

const WATCHLIST_SURVIVAL_THRESHOLD = 0.25;
const WATCHLIST_CONTRIBUTION_THRESHOLD = 25;
const BENCH_MIN_WATCHLIST_CYCLES = 2;

export class ExpertBenchManager {
  private _watchlistCycles: Record<string, number> = {};

  constructor(
    private _registry: ExpertRegistry,
    private _tracker: ExpertPerformanceTracker,
    private _ledger: ExpertRosterLedger,
  ) {}

  // ── Watchlist evaluation ──────────────────────────────────────────────────

  evaluateForWatchlist(expertId: string): boolean {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'active') return false;
    if (expert.selectionCount < 5) return false; // too early to judge

    const perf = this._tracker.getPerformanceRecord(expertId);
    const contribution = this._tracker.computeContributionScore(expertId);

    // Declining contribution + low survival = watchlist candidate
    return (
      perf.outputSurvivedRate < WATCHLIST_SURVIVAL_THRESHOLD ||
      contribution < WATCHLIST_CONTRIBUTION_THRESHOLD
    );
  }

  moveToWatchlist(expertId: string): boolean {
    if (!this.evaluateForWatchlist(expertId)) return false;

    const expert = this._registry.getExpert(expertId);
    if (!expert) return false;

    this._registry.updateStatus(expertId, 'watchlist');
    this._watchlistCycles[expertId] = 0;

    this._ledger.record('watchlisted', expertId, {
      reason: 'Underperforming: low survival rate or contribution score',
      isProtected: isProtectedRole(expert.role),
    });

    return true;
  }

  // ── Bench evaluation ──────────────────────────────────────────────────────

  evaluateForBench(expertId: string): boolean {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'watchlist') return false;

    // Protected experts cannot be benched
    if (isProtectedRole(expert.role)) return false;

    const cycles = this._watchlistCycles[expertId] ?? 0;
    return cycles >= BENCH_MIN_WATCHLIST_CYCLES;
  }

  moveToBench(expertId: string): boolean {
    if (!this.evaluateForBench(expertId)) return false;

    this._registry.updateStatus(expertId, 'bench');
    delete this._watchlistCycles[expertId];

    this._ledger.record('benched', expertId, {
      reason: `On watchlist for ${BENCH_MIN_WATCHLIST_CYCLES}+ cycles, still underperforming`,
    });

    return true;
  }

  // ── Restoration ───────────────────────────────────────────────────────────

  restoreFromBench(expertId: string): boolean {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'bench') return false;

    this._registry.updateStatus(expertId, 'active');
    this._registry.updateExpert(expertId, {
      successContributionScore: 50, // reset to neutral on restore
    });

    this._ledger.record('restored', expertId, {
      from: 'bench',
      to: 'active',
    });

    return true;
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  incrementWatchlistCycles(): void {
    const watchlisted = this._registry.getExpertsByStatus('watchlist');
    for (const expert of watchlisted) {
      this._watchlistCycles[expert.id] = (this._watchlistCycles[expert.id] ?? 0) + 1;
    }
  }

  runMaintenanceCycle(): { watchlisted: string[]; benched: string[] } {
    const watchlisted: string[] = [];
    const benched: string[] = [];

    // Check active experts for watchlist
    const activeExperts = this._registry.getExpertsByStatus('active');
    for (const expert of activeExperts) {
      if (this.moveToWatchlist(expert.id)) {
        watchlisted.push(expert.id);
      }
    }

    // Increment cycles and check for bench
    this.incrementWatchlistCycles();
    const watchlistExperts = this._registry.getExpertsByStatus('watchlist');
    for (const expert of watchlistExperts) {
      if (this.moveToBench(expert.id)) {
        benched.push(expert.id);
      }
    }

    return { watchlisted, benched };
  }
}
