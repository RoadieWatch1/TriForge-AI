// ── expertPlacementEngine.ts — Core placement decision-making ────────────────
//
// Evaluates whether each expert should stay, migrate, clone to a burst lane,
// or be recalled from a burst lane. Finds best target lanes and computes
// migration cost. Protected experts are only migrated at 95%+ saturation.

import type { ExpertLoadTracker } from './expertLoadTracker';
import type { ChipCapacityMonitor } from './chipCapacityMonitor';
import type {
  LaneId,
  PlacementConfig,
  PlacementDecision,
} from './expertPlacementTypes';
import { DEFAULT_PLACEMENT_CONFIG } from './expertPlacementTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE = 60;

// ── ExpertPlacementEngine ────────────────────────────────────────────────────

export class ExpertPlacementEngine {
  private loadTracker: ExpertLoadTracker;
  private capacityMonitor: ChipCapacityMonitor;
  private config: PlacementConfig;

  constructor(
    loadTracker: ExpertLoadTracker,
    capacityMonitor: ChipCapacityMonitor,
    config?: Partial<PlacementConfig>,
  ) {
    this.loadTracker = loadTracker;
    this.capacityMonitor = capacityMonitor;
    this.config = { ...DEFAULT_PLACEMENT_CONFIG, ...config };
  }

  // ── Evaluate single expert ───────────────────────────────────────────────

  /**
   * Evaluate placement for a single expert.
   * Returns a PlacementDecision or null if no action needed.
   */
  evaluatePlacement(expertId: string): PlacementDecision | null {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return null;

    const currentLane = this.capacityMonitor.getLane(placement.currentLane);
    if (!currentLane) return null;

    const now = Date.now();

    // ── Case 1: Hot expert on a saturated lane → migrate or clone ────────
    if (placement.isHot && currentLane.utilization >= currentLane.saturationThreshold) {
      // Protected experts: only migrate at very high saturation
      if (!placement.isMigratable) {
        if (currentLane.utilization < this.config.protectedExpertMigrationThreshold) {
          return null; // not bad enough to move a protected expert
        }
      }

      const targetLane = this.findBestLane(expertId, [placement.currentLane]);
      if (targetLane) {
        const cost = this.calculateMigrationCost(
          expertId,
          placement.currentLane,
          targetLane,
        );
        const confidence = Math.max(0, 100 - cost);

        return {
          expertId,
          action: 'migrate',
          fromLane: placement.currentLane,
          toLane: targetLane,
          reason: `Hot expert on saturated lane ${placement.currentLane} (${currentLane.utilization.toFixed(0)}%)`,
          confidence,
          timestamp: now,
        };
      }

      // No lane available → clone to burst lane
      const burstLane = this._findBurstLane(expertId);
      if (burstLane) {
        return {
          expertId,
          action: 'clone',
          fromLane: placement.currentLane,
          toLane: burstLane,
          reason: `Hot expert, no migration target — cloning to burst lane ${burstLane}`,
          confidence: 70,
          timestamp: now,
        };
      }

      return null; // no capacity anywhere
    }

    // ── Case 2: Non-hot expert on a burst lane → recall to home ──────────
    if (!placement.isHot && placement.currentLane !== placement.homeLane) {
      const homeLane = this.capacityMonitor.getLane(placement.homeLane);
      if (homeLane && homeLane.utilization < homeLane.saturationThreshold) {
        return {
          expertId,
          action: 'recall',
          fromLane: placement.currentLane,
          toLane: placement.homeLane,
          reason: `Expert cooled down, recalling from ${placement.currentLane} to home lane`,
          confidence: 85,
          timestamp: now,
        };
      }
    }

    return null; // no action needed
  }

  // ── Evaluate all ─────────────────────────────────────────────────────────

  /**
   * Scan all active experts and return placement decisions.
   */
  evaluateAllPlacements(): PlacementDecision[] {
    const decisions: PlacementDecision[] = [];
    for (const p of this.loadTracker.getAllPlacements()) {
      const decision = this.evaluatePlacement(p.expertId);
      if (decision) decisions.push(decision);
    }
    return decisions;
  }

  // ── Lane selection ───────────────────────────────────────────────────────

  /**
   * Find the best lane for an expert, excluding specified lanes.
   * Prefers same-pool lanes, falls back to shared burst lanes.
   * Sorts by lowest utilization. Excludes saturated and cooling-down lanes.
   */
  findBestLane(expertId: string, exclude?: LaneId[]): LaneId | null {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return null;

    const excluded = new Set(exclude ?? []);
    const allLanes = this.capacityMonitor.getAllLanes();

    // Filter viable lanes
    const viable = allLanes.filter(lane => {
      if (excluded.has(lane.id)) return false;
      if (lane.utilization >= lane.saturationThreshold) return false;
      if (this.capacityMonitor.isCoolingDown(lane.id)) return false;
      // Burst lanes must not exceed max experts
      if (lane.kind === 'burst' && lane.activeExpertCount >= this.config.burstLaneMaxExperts) return false;
      return true;
    });

    if (viable.length === 0) return null;

    // Sort: same pool first, then by lowest utilization
    const homeLane = this.capacityMonitor.getLane(placement.homeLane);
    const homePool = homeLane?.pool;

    viable.sort((a, b) => {
      // Same pool preference
      const aPoolMatch = a.pool === homePool ? 0 : 1;
      const bPoolMatch = b.pool === homePool ? 0 : 1;
      if (aPoolMatch !== bPoolMatch) return aPoolMatch - bPoolMatch;

      // Primary before burst
      const aKind = a.kind === 'primary' ? 0 : 1;
      const bKind = b.kind === 'primary' ? 0 : 1;
      if (aKind !== bKind) return aKind - bKind;

      // Lowest utilization
      return a.utilization - b.utilization;
    });

    return viable[0].id;
  }

  // ── Migration cost ───────────────────────────────────────────────────────

  /**
   * Calculate migration cost for an expert (0-100).
   * Cross-pool = high cost, same-pool = low cost.
   * High affinity = high cost. Protected = always high cost.
   */
  calculateMigrationCost(
    expertId: string,
    fromLane: LaneId,
    toLane: LaneId,
  ): number {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return 100;

    const from = this.capacityMonitor.getLane(fromLane);
    const to = this.capacityMonitor.getLane(toLane);
    if (!from || !to) return 100;

    let cost = 0;

    // Cross-pool penalty
    if (from.pool !== to.pool) cost += 30;

    // Burst lane penalty (smaller — burst is expected overflow)
    if (to.kind === 'burst') cost += 10;

    // Affinity: higher affinity = higher cost to move
    cost += (placement.affinityScore / 100) * 25;

    // Protected expert penalty
    if (!placement.isMigratable) cost += 25;

    // Recent migration penalty (avoid thrashing)
    const timeSinceLastMigration = Date.now() - placement.lastMigratedAt;
    if (timeSinceLastMigration < this.config.cooldownPeriodMs * 2) cost += 15;

    return Math.min(100, Math.round(cost));
  }

  // ── Final gate ───────────────────────────────────────────────────────────

  /**
   * Final gate: should we actually execute this migration?
   */
  shouldMigrate(expertId: string, decision: PlacementDecision): boolean {
    if (decision.confidence < MIN_CONFIDENCE) return false;

    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return false;

    // Cooldown check
    if (this.capacityMonitor.isCoolingDown(decision.toLane)) return false;

    // Max migration count per cycle handled by traffic controller
    return true;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _findBurstLane(expertId: string): LaneId | null {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return null;

    for (const burstLaneId of placement.burstLanes) {
      const lane = this.capacityMonitor.getLane(burstLaneId);
      if (!lane) continue;
      if (lane.utilization >= lane.saturationThreshold) continue;
      if (this.capacityMonitor.isCoolingDown(burstLaneId)) continue;
      if (lane.activeExpertCount >= this.config.burstLaneMaxExperts) continue;
      return burstLaneId;
    }
    return null;
  }
}
