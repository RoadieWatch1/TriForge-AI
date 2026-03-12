// ── chipCapacityMonitor.ts — Lane/chip utilization monitoring ─────────────────
//
// Tracks utilization, queue depth, memory pressure, and response time per lane.
// Classifies lane status (idle/normal/busy/saturated/cooldown) and exposes
// queries for the placement engine to find available capacity.

import type { StorageAdapter } from '../platform';
import type { ExpertPool } from '../experts/expertTypes';
import type {
  LaneId,
  LaneProfile,
  LaneStatus,
  PlacementConfig,
} from './expertPlacementTypes';
import { DEFAULT_LANES, DEFAULT_PLACEMENT_CONFIG } from './expertPlacementTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'triforge.laneProfiles';
const EMA_ALPHA = 0.15;

// ── ChipCapacityMonitor ──────────────────────────────────────────────────────

export class ChipCapacityMonitor {
  private lanes = new Map<LaneId, LaneProfile>();
  private cooldowns = new Map<LaneId, number>(); // laneId → cooldown-end timestamp
  private config: PlacementConfig;
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter, config?: Partial<PlacementConfig>) {
    this.storage = storage;
    this.config = { ...DEFAULT_PLACEMENT_CONFIG, ...config };
    this._load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private _load(): void {
    const raw = this.storage.get<Record<string, LaneProfile>>(STORAGE_KEY, {});
    this.lanes.clear();

    if (Object.keys(raw).length === 0) {
      // First use — seed default lanes
      for (const lane of DEFAULT_LANES) {
        this.lanes.set(lane.id, { ...lane });
      }
      this._persist();
    } else {
      for (const [id, lane] of Object.entries(raw)) {
        this.lanes.set(id, lane);
      }
    }
  }

  private _persist(): void {
    const obj: Record<string, LaneProfile> = {};
    for (const [id, lane] of this.lanes) obj[id] = lane;
    void this.storage.update(STORAGE_KEY, obj);
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getLane(laneId: LaneId): LaneProfile | undefined {
    return this.lanes.get(laneId);
  }

  getAllLanes(): LaneProfile[] {
    return Array.from(this.lanes.values());
  }

  getLanesByPool(pool: ExpertPool): LaneProfile[] {
    return this.getAllLanes().filter(l => l.pool === pool);
  }

  /**
   * Lanes with available capacity. Optionally exclude saturated lanes.
   */
  getAvailableLanes(pool?: ExpertPool, excludeSaturated = true): LaneProfile[] {
    return this.getAllLanes().filter(l => {
      if (pool && l.pool !== pool) return false;
      if (excludeSaturated && l.utilization >= l.saturationThreshold) return false;
      if (this.isCoolingDown(l.id)) return false;
      return true;
    });
  }

  /**
   * Burst-only lanes (overflow capacity).
   */
  getBurstLanes(pool?: ExpertPool): LaneProfile[] {
    return this.getAllLanes().filter(l => {
      if (l.kind !== 'burst') return false;
      if (pool && l.pool !== pool) return false;
      return true;
    });
  }

  getSaturatedLanes(): LaneProfile[] {
    return this.getAllLanes().filter(
      l => l.utilization >= l.saturationThreshold,
    );
  }

  getIdleLanes(): LaneProfile[] {
    return this.getAllLanes().filter(l => l.utilization < 10);
  }

  // ── Lane status classification ───────────────────────────────────────────

  classifyLaneStatus(lane: LaneProfile): LaneStatus {
    if (this.isCoolingDown(lane.id)) return 'cooldown';
    if (lane.utilization >= lane.saturationThreshold) return 'saturated';
    if (lane.utilization >= 60) return 'busy';
    if (lane.utilization >= 10) return 'normal';
    return 'idle';
  }

  // ── Recording ────────────────────────────────────────────────────────────

  /**
   * Record activity on a lane from an expert invocation.
   */
  recordLaneActivity(laneId: LaneId, expertId: string, runtimeMs: number): void {
    const lane = this.lanes.get(laneId);
    if (!lane) return;

    // Update response time EMA
    lane.avgResponseTimeMs = lane.avgResponseTimeMs === 0
      ? runtimeMs
      : lane.avgResponseTimeMs * (1 - EMA_ALPHA) + runtimeMs * EMA_ALPHA;

    // Ensure expert is in the lane's expert list
    if (!lane.expertIds.includes(expertId)) {
      lane.expertIds.push(expertId);
      lane.activeExpertCount = lane.expertIds.length;
    }

    // Recalculate utilization estimate based on active expert count vs max
    lane.utilization = Math.min(
      100,
      (lane.activeExpertCount / lane.maxConcurrent) * 100,
    );

    // Update status
    lane.status = this.classifyLaneStatus(lane);

    this._persist();
  }

  /**
   * Add an expert to a lane (placement).
   */
  addExpertToLane(laneId: LaneId, expertId: string): void {
    const lane = this.lanes.get(laneId);
    if (!lane) return;

    if (!lane.expertIds.includes(expertId)) {
      lane.expertIds.push(expertId);
      lane.activeExpertCount = lane.expertIds.length;
      lane.utilization = Math.min(
        100,
        (lane.activeExpertCount / lane.maxConcurrent) * 100,
      );
      lane.status = this.classifyLaneStatus(lane);
      this._persist();
    }
  }

  /**
   * Remove an expert from a lane.
   */
  removeExpertFromLane(laneId: LaneId, expertId: string): void {
    const lane = this.lanes.get(laneId);
    if (!lane) return;

    lane.expertIds = lane.expertIds.filter(id => id !== expertId);
    lane.activeExpertCount = lane.expertIds.length;
    lane.utilization = Math.min(
      100,
      (lane.activeExpertCount / lane.maxConcurrent) * 100,
    );
    lane.status = this.classifyLaneStatus(lane);
    this._persist();
  }

  // ── Cooldown management ──────────────────────────────────────────────────

  /**
   * Mark a lane as cooling down for a duration.
   */
  setCooldown(laneId: LaneId, durationMs?: number): void {
    const d = durationMs ?? this.config.cooldownPeriodMs;
    this.cooldowns.set(laneId, Date.now() + d);

    const lane = this.lanes.get(laneId);
    if (lane) {
      lane.status = 'cooldown';
      this._persist();
    }
  }

  isCoolingDown(laneId: LaneId): boolean {
    const end = this.cooldowns.get(laneId);
    if (!end) return false;
    if (Date.now() >= end) {
      this.cooldowns.delete(laneId);
      return false;
    }
    return true;
  }

  // ── Reporting ────────────────────────────────────────────────────────────

  /**
   * Formatted lane utilization summary.
   */
  generateCapacityReport(): string {
    const lines: string[] = ['## Lane Capacity Report'];

    for (const lane of this.getAllLanes()) {
      const status = this.classifyLaneStatus(lane);
      lines.push(
        `- **${lane.id}** [${status.toUpperCase()}]: ` +
        `${lane.utilization.toFixed(0)}% util | ` +
        `${lane.activeExpertCount}/${lane.maxConcurrent} experts | ` +
        `${lane.avgResponseTimeMs.toFixed(0)}ms avg | ` +
        `queue: ${lane.queueDepth}`,
      );
    }

    const saturated = this.getSaturatedLanes();
    if (saturated.length > 0) {
      lines.push('');
      lines.push(`**Saturated lanes:** ${saturated.map(l => l.id).join(', ')}`);
    }

    return lines.join('\n');
  }
}
