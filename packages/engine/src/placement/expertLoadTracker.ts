// ── expertLoadTracker.ts — Per-expert load and placement tracking ────────────
//
// Tracks invocation count, queue depth, runtime, token cost, memory cost,
// failure rate, and current lane for every active expert. Uses a sliding
// window (60 s) to detect hot experts whose invocation rate exceeds the
// configured threshold.

import type { StorageAdapter } from '../platform';
import type {
  ExpertPlacement,
  LaneId,
  PlacementConfig,
} from './expertPlacementTypes';
import { DEFAULT_PLACEMENT_CONFIG } from './expertPlacementTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'triforge.expertPlacements';
const SLIDING_WINDOW_MS = 60_000; // 60 s
const EMA_ALPHA = 0.1;            // exponential moving average smoothing

// ── ExpertLoadTracker ────────────────────────────────────────────────────────

export class ExpertLoadTracker {
  private placements = new Map<string, ExpertPlacement>();
  private invocationTimestamps = new Map<string, number[]>(); // sliding window
  private config: PlacementConfig;
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter, config?: Partial<PlacementConfig>) {
    this.storage = storage;
    this.config = { ...DEFAULT_PLACEMENT_CONFIG, ...config };
    this._load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private _load(): void {
    const raw = this.storage.get<Record<string, ExpertPlacement>>(STORAGE_KEY, {});
    this.placements.clear();
    for (const [id, p] of Object.entries(raw)) {
      this.placements.set(id, p);
    }
  }

  private _persist(): void {
    const obj: Record<string, ExpertPlacement> = {};
    for (const [id, p] of this.placements) obj[id] = p;
    void this.storage.update(STORAGE_KEY, obj);
  }

  // ── Initialization ───────────────────────────────────────────────────────

  /**
   * Initialize placement metadata for an expert.
   * Sets home lane based on pool, default affinity.
   */
  initializePlacement(
    expertId: string,
    pool: 'claude' | 'gpt' | 'grok' | 'shared',
    isProtected: boolean,
  ): void {
    if (this.placements.has(expertId)) return;

    const homeLane: LaneId = `${pool}:primary`;
    const placement: ExpertPlacement = {
      expertId,
      homeLane,
      currentLane: homeLane,
      burstLanes: ['shared:burst-1', 'shared:burst-2'],
      priorityClass: isProtected ? 'critical' : 'standard',
      affinityScore: 80,
      migrationCost: isProtected ? 90 : 40,
      lastMigratedAt: 0,
      migrationCount: 0,
      invocationCount: 0,
      queueDepth: 0,
      avgRuntimeMs: 0,
      avgTokenCost: 0,
      avgMemoryCost: 0,
      failureRate: 0,
      isHot: false,
      isMigratable: !isProtected,
    };

    this.placements.set(expertId, placement);
    this.invocationTimestamps.set(expertId, []);
    this._persist();
  }

  // ── Recording ────────────────────────────────────────────────────────────

  /**
   * Record an expert invocation and update running stats.
   */
  recordInvocation(
    expertId: string,
    laneId: LaneId,
    runtimeMs: number,
    tokenCount: number,
    memoryEstimate: number,
  ): void {
    const p = this.placements.get(expertId);
    if (!p) return;

    const now = Date.now();

    // Update sliding window
    let timestamps = this.invocationTimestamps.get(expertId);
    if (!timestamps) {
      timestamps = [];
      this.invocationTimestamps.set(expertId, timestamps);
    }
    timestamps.push(now);

    // Prune old timestamps outside window
    const cutoff = now - SLIDING_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    // Update placement stats (EMA)
    p.invocationCount++;
    p.currentLane = laneId;
    p.avgRuntimeMs = ema(p.avgRuntimeMs, runtimeMs);
    p.avgTokenCost = ema(p.avgTokenCost, tokenCount);
    p.avgMemoryCost = ema(p.avgMemoryCost, memoryEstimate);
    p.isHot = this._isHot(expertId);

    this._persist();
  }

  /**
   * Record an error for an expert. Increments failure rate.
   */
  recordError(expertId: string): void {
    const p = this.placements.get(expertId);
    if (!p) return;

    // EMA-based failure rate: treat error as 1.0 sample
    p.failureRate = ema(p.failureRate, 1.0);
    this._persist();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getPlacement(expertId: string): ExpertPlacement | undefined {
    return this.placements.get(expertId);
  }

  getAllPlacements(): ExpertPlacement[] {
    return Array.from(this.placements.values());
  }

  /**
   * Experts whose invocation rate exceeds the hot threshold.
   */
  getHotExperts(threshold?: number): ExpertPlacement[] {
    const t = threshold ?? this.config.hotThresholdInvocationsPerMinute;
    return this.getAllPlacements().filter(p => {
      const rate = this._invocationRate(p.expertId);
      return rate >= t;
    });
  }

  /**
   * Experts with queue depth > 3 OR failure rate spiking (> 0.3).
   */
  getOverloadedExperts(): ExpertPlacement[] {
    return this.getAllPlacements().filter(
      p => p.queueDepth > 3 || p.failureRate > 0.3,
    );
  }

  /**
   * Check if expert invocation rate exceeds hot threshold.
   */
  isHot(expertId: string): boolean {
    return this._isHot(expertId);
  }

  /**
   * Get invocation rate (invocations per minute) for an expert.
   */
  getInvocationRate(expertId: string): number {
    return this._invocationRate(expertId);
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Partial update of an expert's placement metadata.
   */
  updatePlacement(expertId: string, updates: Partial<ExpertPlacement>): void {
    const p = this.placements.get(expertId);
    if (!p) return;

    Object.assign(p, updates);
    this._persist();
  }

  /**
   * Daily affinity decay — loosens binding to home lane over time.
   */
  decayAffinity(): void {
    for (const p of this.placements.values()) {
      p.affinityScore = Math.max(10, p.affinityScore * this.config.affinityDecayRate);

      // Also decay failure rate toward 0
      p.failureRate = Math.max(0, p.failureRate * 0.9);
    }
    this._persist();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _isHot(expertId: string): boolean {
    return this._invocationRate(expertId) >= this.config.hotThresholdInvocationsPerMinute;
  }

  private _invocationRate(expertId: string): number {
    const timestamps = this.invocationTimestamps.get(expertId);
    if (!timestamps || timestamps.length === 0) return 0;

    const now = Date.now();
    const cutoff = now - SLIDING_WINDOW_MS;
    const recentCount = timestamps.filter(t => t >= cutoff).length;

    // Convert to per-minute rate
    return recentCount; // window is already 60s = 1 minute
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ema(current: number, sample: number): number {
  return current === 0
    ? sample
    : current * (1 - EMA_ALPHA) + sample * EMA_ALPHA;
}
