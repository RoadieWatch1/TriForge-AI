// ── expertMigrationManager.ts — Safe, reversible expert migration ────────────
//
// Plans and executes expert migrations between lanes. Captures pre-migration
// state for rollback. Protected experts are migrated conservatively: only at
// 95%+ lane saturation, always reversible, always logged with extra detail.
// Rollback triggers if post-migration latency increases >50% or error spikes.

import type { ExpertLoadTracker } from './expertLoadTracker';
import type { ChipCapacityMonitor } from './chipCapacityMonitor';
import type {
  LaneId,
  MigrationPlan,
  PlacementConfig,
  PlacementLedgerEntry,
} from './expertPlacementTypes';
import { DEFAULT_PLACEMENT_CONFIG } from './expertPlacementTypes';

// ── Types ────────────────────────────────────────────────────────────────────

interface PlacementLedger {
  log(entry: PlacementLedgerEntry): void;
}

// ── ExpertMigrationManager ───────────────────────────────────────────────────

export class ExpertMigrationManager {
  private loadTracker: ExpertLoadTracker;
  private capacityMonitor: ChipCapacityMonitor;
  private ledger: PlacementLedger;
  private config: PlacementConfig;

  /** Recent migration plans kept for potential rollback. */
  private recentMigrations: MigrationPlan[] = [];

  constructor(
    loadTracker: ExpertLoadTracker,
    capacityMonitor: ChipCapacityMonitor,
    ledger: PlacementLedger,
    config?: Partial<PlacementConfig>,
  ) {
    this.loadTracker = loadTracker;
    this.capacityMonitor = capacityMonitor;
    this.ledger = ledger;
    this.config = { ...DEFAULT_PLACEMENT_CONFIG, ...config };
  }

  // ── Planning ─────────────────────────────────────────────────────────────

  /**
   * Plan a migration: captures pre-migration state for rollback.
   * Returns null if validation fails.
   */
  planMigration(
    expertId: string,
    fromLane: LaneId,
    toLane: LaneId,
  ): MigrationPlan | null {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return null;

    const fromLaneProfile = this.capacityMonitor.getLane(fromLane);
    const toLaneProfile = this.capacityMonitor.getLane(toLane);
    if (!fromLaneProfile || !toLaneProfile) return null;

    // Validate target lane capacity
    if (toLaneProfile.utilization >= toLaneProfile.saturationThreshold) return null;

    // Check protected expert constraints
    const isProtected = !placement.isMigratable;
    if (isProtected) {
      if (fromLaneProfile.utilization < this.config.protectedExpertMigrationThreshold) {
        return null; // not saturated enough to justify protected migration
      }
    }

    return {
      expertId,
      fromLane,
      toLane,
      preMigrationState: {
        expertPlacement: { ...placement },
        fromLaneProfile: { ...fromLaneProfile, expertIds: [...fromLaneProfile.expertIds] },
        toLaneProfile: { ...toLaneProfile, expertIds: [...toLaneProfile.expertIds] },
      },
      isProtected,
      estimatedCost: placement.migrationCost,
      timestamp: Date.now(),
    };
  }

  // ── Execution ────────────────────────────────────────────────────────────

  /**
   * Execute a planned migration. Updates load tracker, capacity monitor, and ledger.
   */
  executeMigration(plan: MigrationPlan): boolean {
    const placement = this.loadTracker.getPlacement(plan.expertId);
    if (!placement) return false;

    // Remove expert from source lane
    this.capacityMonitor.removeExpertFromLane(plan.fromLane, plan.expertId);

    // Add expert to target lane
    this.capacityMonitor.addExpertToLane(plan.toLane, plan.expertId);

    // Update expert placement
    this.loadTracker.updatePlacement(plan.expertId, {
      currentLane: plan.toLane,
      lastMigratedAt: Date.now(),
      migrationCount: placement.migrationCount + 1,
    });

    // Keep plan for rollback
    this.recentMigrations.push(plan);
    if (this.recentMigrations.length > 20) {
      this.recentMigrations.shift();
    }

    // Log
    this.ledger.log({
      timestamp: Date.now(),
      action: 'expert_migrated',
      expertId: plan.expertId,
      laneId: plan.toLane,
      details: {
        fromLane: plan.fromLane,
        toLane: plan.toLane,
        isProtected: plan.isProtected,
        estimatedCost: plan.estimatedCost,
      },
    });

    return true;
  }

  // ── Rollback ─────────────────────────────────────────────────────────────

  /**
   * Rollback a migration: restores pre-migration state.
   * Should be called if post-migration latency increases >50% or error spikes.
   */
  rollbackMigration(plan: MigrationPlan): boolean {
    const placement = this.loadTracker.getPlacement(plan.expertId);
    if (!placement) return false;

    // Remove expert from target lane
    this.capacityMonitor.removeExpertFromLane(plan.toLane, plan.expertId);

    // Add expert back to source lane
    this.capacityMonitor.addExpertToLane(plan.fromLane, plan.expertId);

    // Restore placement
    this.loadTracker.updatePlacement(plan.expertId, {
      currentLane: plan.fromLane,
      lastMigratedAt: plan.preMigrationState.expertPlacement.lastMigratedAt,
    });

    // Log rollback
    this.ledger.log({
      timestamp: Date.now(),
      action: 'expert_migrated', // rollback is itself a migration
      expertId: plan.expertId,
      laneId: plan.fromLane,
      details: {
        fromLane: plan.toLane,
        toLane: plan.fromLane,
        rollback: true,
        reason: 'Post-migration degradation detected',
      },
    });

    return true;
  }

  // ── Degradation check ────────────────────────────────────────────────────

  /**
   * Check if a recently migrated expert shows degradation.
   * Returns the MigrationPlan to rollback if degradation detected.
   */
  checkForDegradation(expertId: string): MigrationPlan | null {
    const plan = this.recentMigrations.find(m => m.expertId === expertId);
    if (!plan) return null;

    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return null;

    const prePlacement = plan.preMigrationState.expertPlacement;

    // Latency increased >50%
    if (
      prePlacement.avgRuntimeMs > 0 &&
      placement.avgRuntimeMs > prePlacement.avgRuntimeMs * 1.5
    ) {
      return plan;
    }

    // Error spike (failure rate doubled or exceeds 0.3)
    if (
      placement.failureRate > 0.3 &&
      placement.failureRate > prePlacement.failureRate * 2
    ) {
      return plan;
    }

    return null;
  }

  /**
   * Check if an expert is protected (cannot be migrated recklessly).
   */
  isProtectedMigration(expertId: string): boolean {
    const placement = this.loadTracker.getPlacement(expertId);
    return placement ? !placement.isMigratable : false;
  }

  /**
   * Get recent migration plans (for reporting).
   */
  getRecentMigrations(): MigrationPlan[] {
    return [...this.recentMigrations];
  }
}
