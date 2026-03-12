// ── main/trading/levels/LevelRegistry.ts ──────────────────────────────────────
//
// Maintains the active set of PriceLevels for a symbol.
//
// Responsibilities:
//   - Deduplicates levels within a configurable tolerance (default ATR * 0.2)
//   - When duplicates collide, keeps the higher-quality level
//   - Sorts levels by distance from current price
//   - Marks levels as "broken" when price cleanly passes through
//   - Increments touchCount when price revisits a level/zone
//   - Exposes query helpers: getActiveLevels, getNearestAbove/Below
//
// The registry is reset and rebuilt each evaluation pass by LevelMapEngine.
// It does not persist across passes — it is a per-tick computation structure.
// Future phases may add incremental merge logic.

import type { PriceLevel } from '@triforge/engine';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface RegistryConfig {
  /** Deduplication tolerance in price points. Levels within this distance
   *  of each other (same direction) are considered duplicates.
   *  Typically ATR * 0.2. */
  deduplicationTolerance: number;

  /** How far price must exceed a level to mark it broken, in price points.
   *  Typically ATR * 0.3 — a clean break, not just a wick. */
  breakTolerance: number;

  /** How close price must come to a level to count as a "touch", in price
   *  points. Typically ATR * 0.15 for line levels, or within the zone
   *  bounds for zone levels (supply/demand). */
  touchProximity: number;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class LevelRegistry {
  private _levels: PriceLevel[] = [];
  private _config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this._config = config;
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a batch of newly detected and scored levels.
   * Deduplicates against existing levels and against each other.
   * Higher-quality levels survive collisions.
   */
  registerLevels(newLevels: PriceLevel[]): void {
    for (const level of newLevels) {
      this._addOrMerge(level);
    }
  }

  /**
   * Add a single level, deduplicating against existing registry.
   */
  private _addOrMerge(incoming: PriceLevel): void {
    const tol = this._config.deduplicationTolerance;

    // Find existing level that is "close enough" and same general side
    const existingIdx = this._levels.findIndex(existing => {
      if (existing.broken) return false; // don't merge into broken levels
      const priceDist = Math.abs(existing.price - incoming.price);
      if (priceDist > tol) return false;
      // Only deduplicate same-side levels (both above or both below, or same type family)
      return _areSameFamily(existing, incoming);
    });

    if (existingIdx === -1) {
      // No duplicate — add directly
      this._levels.push(incoming);
    } else {
      // Duplicate found — keep the higher-quality one
      const existing = this._levels[existingIdx];
      if (incoming.qualityScore > existing.qualityScore) {
        this._levels[existingIdx] = incoming;
      }
      // If existing wins, we just discard the incoming level
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Get all active (non-broken) levels, sorted by distance from the
   * given reference price (ascending).
   */
  getActiveLevels(referencePrice?: number): PriceLevel[] {
    const active = this._levels.filter(l => !l.broken);
    if (referencePrice != null) {
      active.sort((a, b) =>
        Math.abs(a.price - referencePrice) - Math.abs(b.price - referencePrice),
      );
    }
    return active;
  }

  /**
   * Get all levels including broken ones, sorted by price ascending.
   */
  getAllLevels(): PriceLevel[] {
    return [...this._levels].sort((a, b) => a.price - b.price);
  }

  /**
   * Get the nearest active level above the given price.
   */
  getNearestAbove(price: number): PriceLevel | null {
    let best: PriceLevel | null = null;
    let bestDist = Infinity;

    for (const level of this._levels) {
      if (level.broken) continue;
      if (level.price <= price) continue;
      const dist = level.price - price;
      if (dist < bestDist) {
        bestDist = dist;
        best = level;
      }
    }

    return best;
  }

  /**
   * Get the nearest active level below the given price.
   */
  getNearestBelow(price: number): PriceLevel | null {
    let best: PriceLevel | null = null;
    let bestDist = Infinity;

    for (const level of this._levels) {
      if (level.broken) continue;
      if (level.price >= price) continue;
      const dist = price - level.price;
      if (dist < bestDist) {
        bestDist = dist;
        best = level;
      }
    }

    return best;
  }

  /**
   * Count of active (non-broken) levels.
   */
  get activeCount(): number {
    return this._levels.filter(l => !l.broken).length;
  }

  /**
   * Count of levels by type.
   */
  getLevelCounts(): Partial<Record<PriceLevel['type'], number>> {
    const counts: Partial<Record<PriceLevel['type'], number>> = {};
    for (const level of this._levels) {
      if (level.broken) continue;
      counts[level.type] = (counts[level.type] ?? 0) + 1;
    }
    return counts;
  }

  // ── State Updates ─────────────────────────────────────────────────────────

  /**
   * Update touch counts and broken state based on the current price.
   *
   * - A level is "touched" when price comes within touchProximity (or enters
   *   a zone's priceHigh boundary).
   * - A level is "broken" when price has passed cleanly through by
   *   breakTolerance points.
   *
   * @param currentPrice - The latest market price
   * @param nowMs - Current timestamp for lastTestedAt bookkeeping
   */
  updateTouchesAndBrokenState(currentPrice: number, nowMs: number): void {
    const { touchProximity, breakTolerance } = this._config;

    for (const level of this._levels) {
      if (level.broken) continue;

      const dist = Math.abs(currentPrice - level.price);

      // Check for touch: price is within proximity of the level
      const zoneWidth = level.priceHigh != null
        ? Math.abs(level.priceHigh - level.price)
        : 0;
      const effectiveProximity = Math.max(touchProximity, zoneWidth);

      if (dist <= effectiveProximity) {
        // Only count a new touch if enough time has passed since last test
        // (prevents counting the same bar visit as multiple touches)
        const minTouchInterval = 5 * 60_000; // 5 minutes
        if (!level.lastTestedAt || nowMs - level.lastTestedAt > minTouchInterval) {
          level.touchCount++;
          level.lastTestedAt = nowMs;
        }
      }

      // Check for break: price has passed cleanly through
      // For levels with directional bias, "break" means price moved through
      // in the direction that invalidates the level's thesis.
      if (_isPriceBreaking(level, currentPrice, breakTolerance)) {
        level.broken = true;
      }
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Clear all levels. Called before a fresh rebuild pass.
   */
  clear(): void {
    this._levels = [];
  }

  /**
   * Update registry configuration (e.g. when ATR changes).
   */
  updateConfig(config: Partial<RegistryConfig>): void {
    Object.assign(this._config, config);
  }
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Determine whether two levels belong to the same "family" for deduplication.
 * Same-family = same directional bias, or both neutral, or same type category.
 */
function _areSameFamily(a: PriceLevel, b: PriceLevel): boolean {
  // Same type → always same family
  if (a.type === b.type) return true;

  // Same directional bias → same family (both are "support" or both "resistance")
  if (a.directionalBias && b.directionalBias && a.directionalBias !== 'neutral' && b.directionalBias !== 'neutral') {
    return a.directionalBias === b.directionalBias;
  }

  // Group by structural role:
  const resistanceTypes = new Set([
    'supply', 'swing_high', 'session_high', 'prev_day_high',
    'overnight_high', 'opening_range_high', 'volume_vah',
  ]);
  const supportTypes = new Set([
    'demand', 'swing_low', 'session_low', 'prev_day_low',
    'overnight_low', 'opening_range_low', 'volume_val',
  ]);

  if (resistanceTypes.has(a.type) && resistanceTypes.has(b.type)) return true;
  if (supportTypes.has(a.type) && supportTypes.has(b.type)) return true;

  return false;
}

/**
 * Determine whether the current price has "broken" a level.
 *
 * A demand level (long bias) is broken when price falls below it by breakTolerance.
 * A supply level (short bias) is broken when price rises above it by breakTolerance.
 * A neutral level is broken when price exceeds it in either direction by breakTolerance.
 */
function _isPriceBreaking(
  level: PriceLevel,
  currentPrice: number,
  breakTolerance: number,
): boolean {
  const effectivePrice = level.priceHigh != null
    ? (level.price + level.priceHigh) / 2 // zone midpoint
    : level.price;

  switch (level.directionalBias) {
    case 'long':
      // Demand / support → broken if price drops well below
      return currentPrice < effectivePrice - breakTolerance;
    case 'short':
      // Supply / resistance → broken if price rises well above
      return currentPrice > effectivePrice + breakTolerance;
    case 'neutral':
    default:
      // Neutral (POC, etc.) → broken if price moves away significantly in either direction
      return Math.abs(currentPrice - effectivePrice) > breakTolerance * 2;
  }
}
