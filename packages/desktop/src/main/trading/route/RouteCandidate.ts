// ── main/trading/route/RouteCandidate.ts ──────────────────────────────────────
//
// Typed data class representing a possible price move from one level to
// another. Used by PathPredictionEngine to model candidate routes and by
// TargetSelectionEngine to score and rank them.
//
// A RouteCandidate is an intermediate structure. Once scored and selected,
// it is serialized into the Route interface from shared types for storage
// in the LevelMap / PathPrediction.

import type {
  PriceLevel, RouteDirection, RouteQualityFactors, Route,
} from '@triforge/engine';

// ── Defaults ──────────────────────────────────────────────────────────────────

function _defaultFactors(): RouteQualityFactors {
  return {
    destinationClarity: 0,
    cleanTravelSpace: 0,
    congestionPenalty: 0,
    destinationLiquidity: 0,
    sessionAlignment: 0,
    htfAlignment: 0,
  };
}

let _idCounter = 0;
function _nextId(): string {
  return `route_${Date.now()}_${++_idCounter}`;
}

// ── RouteCandidate ────────────────────────────────────────────────────────────

export class RouteCandidate {
  readonly id: string;
  readonly fromLevel: PriceLevel;
  readonly toLevel: PriceLevel;
  readonly direction: RouteDirection;
  readonly distancePoints: number;
  readonly intermediateObstacles: PriceLevel[];
  qualityFactors: RouteQualityFactors;
  qualityScore: number;

  constructor(params: {
    fromLevel: PriceLevel;
    toLevel: PriceLevel;
    direction: RouteDirection;
    intermediateObstacles?: PriceLevel[];
  }) {
    this.id = _nextId();
    this.fromLevel = params.fromLevel;
    this.toLevel = params.toLevel;
    this.direction = params.direction;
    this.intermediateObstacles = params.intermediateObstacles ?? [];
    this.distancePoints = Math.abs(params.toLevel.price - params.fromLevel.price);
    this.qualityFactors = _defaultFactors();
    this.qualityScore = 0;
  }

  // ── Helper Methods ──────────────────────────────────────────────────────

  /**
   * Compute the risk-reward ratio for this route given a stop distance.
   *
   * RR = distance to target / stop distance.
   * Returns 0 if stopDistance is <= 0.
   */
  riskRewardRatio(stopDistance: number): number {
    if (stopDistance <= 0) return 0;
    return this.distancePoints / stopDistance;
  }

  /**
   * Whether the path from entry to target is relatively clean.
   *
   * A path is "clean" when the number of intermediate obstacles is low
   * relative to the travel distance. Heuristic:
   *   - 0 obstacles = clean
   *   - 1 obstacle = clean if distance > 2x the obstacle's distance from entry
   *   - 2+ obstacles = not clean (too crowded)
   *
   * This is a coarse filter. TargetSelectionEngine uses the full
   * congestionPenalty factor for precise scoring.
   */
  hasCleanPath(): boolean {
    const n = this.intermediateObstacles.length;
    if (n === 0) return true;
    if (n === 1) {
      // If the single obstacle is very close to the destination, it's
      // effectively the same level — consider path clean
      const obsDist = Math.abs(
        this.intermediateObstacles[0].price - this.toLevel.price,
      );
      return obsDist < this.distancePoints * 0.2;
    }
    return false; // 2+ obstacles in the path = crowded
  }

  /**
   * Whether this route candidate passes basic validity checks.
   *
   * Invalid conditions:
   *   - Distance is zero or negative
   *   - From and to levels are the same ID
   *   - Destination level is broken
   *   - Direction doesn't match price relationship
   */
  isValid(): boolean {
    if (this.distancePoints <= 0) return false;
    if (this.fromLevel.id === this.toLevel.id) return false;
    if (this.toLevel.broken) return false;

    // Direction must match price relationship
    if (this.direction === 'long' && this.toLevel.price <= this.fromLevel.price) return false;
    if (this.direction === 'short' && this.toLevel.price >= this.fromLevel.price) return false;

    return true;
  }

  // ── Serialization ───────────────────────────────────────────────────────

  /**
   * Convert this candidate into the shared Route interface.
   */
  toRoute(active = false): Route {
    return {
      id: this.id,
      fromLevel: this.fromLevel,
      toLevel: this.toLevel,
      direction: this.direction,
      distancePoints: this.distancePoints,
      intermediateObstacles: this.intermediateObstacles,
      qualityScore: this.qualityScore,
      qualityFactors: { ...this.qualityFactors },
      active,
      createdAt: Date.now(),
    };
  }
}
