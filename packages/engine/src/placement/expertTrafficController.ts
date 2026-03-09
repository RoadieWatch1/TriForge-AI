// ── expertTrafficController.ts — Top-level placement orchestrator ────────────
//
// Executes rebalance cycles: scans for hot experts and saturated lanes,
// evaluates placements, executes up to maxMigrationsPerCycle decisions,
// logs all actions, and manages cooldowns.

import type { ExpertPlacementEngine } from './expertPlacementEngine';
import type { ExpertLoadTracker } from './expertLoadTracker';
import type { ChipCapacityMonitor } from './chipCapacityMonitor';
import type { ExpertMigrationManager } from './expertMigrationManager';
import type {
  LaneId,
  PlacementConfig,
  PlacementDecision,
  PlacementLedgerEntry,
  PlacementReport,
} from './expertPlacementTypes';
import { DEFAULT_PLACEMENT_CONFIG } from './expertPlacementTypes';

// ── Types ────────────────────────────────────────────────────────────────────

interface PlacementLedger {
  log(entry: PlacementLedgerEntry): void;
}

// ── ExpertTrafficController ──────────────────────────────────────────────────

export class ExpertTrafficController {
  private placementEngine: ExpertPlacementEngine;
  private loadTracker: ExpertLoadTracker;
  private capacityMonitor: ChipCapacityMonitor;
  private migrationManager: ExpertMigrationManager;
  private ledger: PlacementLedger;
  private config: PlacementConfig;
  private rebalanceTimer: ReturnType<typeof setInterval> | null = null;

  /** Migrations executed in the current cycle. */
  private cycleMigrationCount = 0;

  constructor(
    placementEngine: ExpertPlacementEngine,
    loadTracker: ExpertLoadTracker,
    capacityMonitor: ChipCapacityMonitor,
    migrationManager: ExpertMigrationManager,
    ledger: PlacementLedger,
    config?: Partial<PlacementConfig>,
  ) {
    this.placementEngine = placementEngine;
    this.loadTracker = loadTracker;
    this.capacityMonitor = capacityMonitor;
    this.migrationManager = migrationManager;
    this.ledger = ledger;
    this.config = { ...DEFAULT_PLACEMENT_CONFIG, ...config };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the periodic rebalance cycle.
   */
  initialize(): void {
    if (this.rebalanceTimer) return;

    this.rebalanceTimer = setInterval(() => {
      this.runRebalanceCycle();
    }, this.config.rebalanceIntervalMs);
  }

  /**
   * Stop the periodic rebalance cycle.
   */
  dispose(): void {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = null;
    }
  }

  // ── Rebalance cycle ──────────────────────────────────────────────────────

  /**
   * Run a single rebalance cycle:
   * 1. Scan for hot experts
   * 2. Scan for saturated lanes
   * 3. Evaluate placements for hot experts on saturated lanes
   * 4. Execute up to maxMigrationsPerCycle decisions
   * 5. Log all actions to ledger
   * 6. Set cooldowns on affected lanes
   * 7. Check recent migrations for degradation and rollback if needed
   */
  runRebalanceCycle(): PlacementDecision[] {
    this.cycleMigrationCount = 0;

    // Log rebalance start
    this.ledger.log({
      timestamp: Date.now(),
      action: 'rebalance_triggered',
      details: {},
    });

    // 1-3: Get all placement decisions
    const decisions = this.placementEngine.evaluateAllPlacements();
    const executed: PlacementDecision[] = [];

    // 4: Execute up to max
    for (const decision of decisions) {
      if (this.cycleMigrationCount >= this.config.maxMigrationsPerCycle) break;

      // Final gate check
      if (!this.placementEngine.shouldMigrate(decision.expertId, decision)) continue;

      let success = false;

      switch (decision.action) {
        case 'migrate':
          success = this._executeMigration(decision);
          break;
        case 'clone':
          success = this.cloneToLane(decision.expertId, decision.toLane);
          break;
        case 'recall':
          success = this.recallExpert(decision.expertId);
          break;
        default:
          continue;
      }

      if (success) {
        executed.push(decision);
        this.cycleMigrationCount++;
      }
    }

    // 7: Check recent migrations for degradation
    this._checkForDegradation();

    return executed;
  }

  // ── Migration ────────────────────────────────────────────────────────────

  /**
   * Migrate an expert from one lane to another.
   */
  migrateExpert(expertId: string, fromLane: LaneId, toLane: LaneId): boolean {
    const plan = this.migrationManager.planMigration(expertId, fromLane, toLane);
    if (!plan) return false;

    const success = this.migrationManager.executeMigration(plan);
    if (success) {
      this.capacityMonitor.setCooldown(fromLane);
    }
    return success;
  }

  // ── Clone ────────────────────────────────────────────────────────────────

  /**
   * Clone an expert to a burst lane. Expert stays on current lane AND gets
   * placed on the burst lane. Future invocations split between both.
   */
  cloneToLane(expertId: string, targetLane: LaneId): boolean {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return false;

    const lane = this.capacityMonitor.getLane(targetLane);
    if (!lane) return false;
    if (lane.utilization >= lane.saturationThreshold) return false;
    if (lane.activeExpertCount >= this.config.burstLaneMaxExperts) return false;

    // Add expert to burst lane (expert stays on current lane too)
    this.capacityMonitor.addExpertToLane(targetLane, expertId);

    // Update burst lanes list
    const burstLanes = [...placement.burstLanes];
    if (!burstLanes.includes(targetLane)) {
      burstLanes.push(targetLane);
    }
    this.loadTracker.updatePlacement(expertId, { burstLanes });

    // Log
    this.ledger.log({
      timestamp: Date.now(),
      action: 'expert_cloned',
      expertId,
      laneId: targetLane,
      details: {
        currentLane: placement.currentLane,
        burstLane: targetLane,
      },
    });

    return true;
  }

  // ── Recall ───────────────────────────────────────────────────────────────

  /**
   * Recall an expert from a burst lane back to its home lane.
   * Only if home lane is not saturated.
   */
  recallExpert(expertId: string): boolean {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return false;
    if (placement.currentLane === placement.homeLane) return false;

    const homeLane = this.capacityMonitor.getLane(placement.homeLane);
    if (!homeLane) return false;
    if (homeLane.utilization >= homeLane.saturationThreshold) return false;

    // Remove from current lane
    this.capacityMonitor.removeExpertFromLane(placement.currentLane, expertId);

    // Add to home lane
    this.capacityMonitor.addExpertToLane(placement.homeLane, expertId);

    // Update placement
    this.loadTracker.updatePlacement(expertId, {
      currentLane: placement.homeLane,
      lastMigratedAt: Date.now(),
    });

    // Log
    this.ledger.log({
      timestamp: Date.now(),
      action: 'expert_recalled',
      expertId,
      laneId: placement.homeLane,
      details: {
        fromLane: placement.currentLane,
        homeLane: placement.homeLane,
      },
    });

    return true;
  }

  // ── Reporting ────────────────────────────────────────────────────────────

  /**
   * Formatted report of all expert placements + lane statuses.
   */
  getPlacementReport(): string {
    const lines: string[] = ['## Placement Report'];

    // Lanes
    lines.push('');
    lines.push(this.capacityMonitor.generateCapacityReport());

    // Hot experts
    const hotExperts = this.loadTracker.getHotExperts();
    if (hotExperts.length > 0) {
      lines.push('');
      lines.push('### Hot Experts');
      for (const p of hotExperts) {
        const rate = this.loadTracker.getInvocationRate(p.expertId);
        lines.push(
          `- **${p.expertId}** on ${p.currentLane}: ${rate}/min | ` +
          `${p.avgRuntimeMs.toFixed(0)}ms avg | priority: ${p.priorityClass}`,
        );
      }
    }

    // Recent migrations
    const migrations = this.migrationManager.getRecentMigrations();
    if (migrations.length > 0) {
      lines.push('');
      lines.push(`### Recent Migrations: ${migrations.length}`);
      for (const m of migrations.slice(-5)) {
        lines.push(
          `- ${m.expertId}: ${m.fromLane} → ${m.toLane}` +
          `${m.isProtected ? ' [PROTECTED]' : ''} (cost: ${m.estimatedCost})`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Get current hotspots.
   */
  getHotspots(): { expertId: string; lane: LaneId; invocationRate: number }[] {
    return this.loadTracker.getHotExperts().map(p => ({
      expertId: p.expertId,
      lane: p.currentLane,
      invocationRate: this.loadTracker.getInvocationRate(p.expertId),
    }));
  }

  /**
   * Get structured placement report for IPC.
   */
  getPlacementStatus(): PlacementReport {
    const allPlacements = this.loadTracker.getAllPlacements();
    const allLanes = this.capacityMonitor.getAllLanes();

    return {
      timestamp: Date.now(),
      totalExperts: allPlacements.length,
      hotExperts: allPlacements.filter(p => p.isHot).length,
      totalLanes: allLanes.length,
      saturatedLanes: this.capacityMonitor.getSaturatedLanes().length,
      idleLanes: this.capacityMonitor.getIdleLanes().length,
      recentMigrations: this.migrationManager.getRecentMigrations().length,
      lanes: allLanes,
      hotspots: this.getHotspots(),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _executeMigration(decision: PlacementDecision): boolean {
    return this.migrateExpert(decision.expertId, decision.fromLane, decision.toLane);
  }

  /**
   * Check recent migrations for degradation and auto-rollback.
   */
  private _checkForDegradation(): void {
    for (const placement of this.loadTracker.getAllPlacements()) {
      const degradedPlan = this.migrationManager.checkForDegradation(placement.expertId);
      if (degradedPlan) {
        this.migrationManager.rollbackMigration(degradedPlan);
      }
    }
  }
}
