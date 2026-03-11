// ── main/trading/levels/LiquidityPoolDetector.ts ─────────────────────────────
//
// Detects liquidity pools from clustered swing highs/lows.
//
// Liquidity pools form where stop orders accumulate: when multiple swing
// highs (or lows) cluster at nearly the same price, it signals a large
// pool of stop-loss orders just beyond those levels. Institutional traders
// target these pools to generate liquidity for their entries.
//
// Algorithm:
//   1. Collect all swing-type PriceLevels (swing_high, swing_low)
//   2. Group levels within `tolerance` (ATR * 0.3) of each other
//   3. Clusters with 3+ points = strong liquidity pool
//   4. Clusters with 2 points = weak liquidity pool
//
// Pure function — no side effects, no state.

import type { PriceLevel, LevelQualityFactors } from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(): string {
  return `liq_${Date.now()}_${++_idCounter}`;
}

function _defaultFactors(): LevelQualityFactors {
  return {
    displacementAway: 0,
    reactionStrength: 0,
    htfAlignment: 0,
    freshness: 100,
    imbalancePresent: 0,
    volumeSurge: 0,
    liquidityRelevance: 100, // liquidity pool is itself a liquidity feature
    touchCountQuality: 50,
    recency: 50,
    structuralBreak: 0,
  };
}

// ── Core Detection ────────────────────────────────────────────────────────────

interface SwingPoint {
  price: number;
  type: 'high' | 'low';
  timestamp: number;
}

/**
 * Cluster swing points that are within `tolerance` of each other.
 * Uses a greedy approach: sort by price, then sweep and group consecutive
 * points within tolerance.
 */
function _clusterSwings(
  points: SwingPoint[],
  tolerance: number,
): SwingPoint[][] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: SwingPoint[][] = [];
  let current: SwingPoint[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    // Compare to the cluster's anchor (first point)
    if (sorted[i].price - current[0].price <= tolerance) {
      current.push(sorted[i]);
    } else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);

  return clusters;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect liquidity pools from existing swing-type PriceLevels.
 *
 * @param swingLevels - PriceLevels of type 'swing_high' or 'swing_low'
 *                      (output of SwingLevelDetector)
 * @param tolerance - Price distance within which swings are considered
 *                    clustered. Typically ATR * 0.3.
 * @returns Array of PriceLevel objects with type 'liquidity_pool'.
 *          Only clusters with 2+ points produce a level.
 */
export function detectLiquidityPools(
  swingLevels: PriceLevel[],
  tolerance: number,
): PriceLevel[] {
  if (swingLevels.length < 2 || tolerance <= 0) return [];

  // Separate highs and lows — liquidity pools are same-side clusters
  const swingHighs: SwingPoint[] = swingLevels
    .filter(l => l.type === 'swing_high')
    .map(l => ({ price: l.price, type: 'high' as const, timestamp: l.createdAt }));

  const swingLows: SwingPoint[] = swingLevels
    .filter(l => l.type === 'swing_low')
    .map(l => ({ price: l.price, type: 'low' as const, timestamp: l.createdAt }));

  const levels: PriceLevel[] = [];

  // Process high clusters (buy-side liquidity = stops above equal highs)
  const highClusters = _clusterSwings(swingHighs, tolerance);
  for (const cluster of highClusters) {
    if (cluster.length < 2) continue;

    const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
    const maxPrice = Math.max(...cluster.map(p => p.price));
    const latestTs = Math.max(...cluster.map(p => p.timestamp));
    const isStrong = cluster.length >= 3;

    levels.push({
      id: _nextId(),
      type: 'liquidity_pool',
      price: avgPrice,
      priceHigh: maxPrice,
      strength: isStrong ? 'strong' : 'moderate',
      touchCount: cluster.length,
      createdAt: latestTs,
      broken: false,
      label: `Buy-Side Liquidity (${cluster.length} equal highs) ${avgPrice.toFixed(2)}`,
      qualityScore: 0,
      grade: 'informational',
      qualityFactors: {
        ..._defaultFactors(),
        touchCountQuality: isStrong ? 30 : 60, // more touches = more targeted = slightly degraded
      },
      sourceTimeframe: undefined,
      directionalBias: 'short', // price tends to sweep above then reverse down
    });
  }

  // Process low clusters (sell-side liquidity = stops below equal lows)
  const lowClusters = _clusterSwings(swingLows, tolerance);
  for (const cluster of lowClusters) {
    if (cluster.length < 2) continue;

    const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
    const minPrice = Math.min(...cluster.map(p => p.price));
    const latestTs = Math.max(...cluster.map(p => p.timestamp));
    const isStrong = cluster.length >= 3;

    levels.push({
      id: _nextId(),
      type: 'liquidity_pool',
      price: avgPrice,
      priceHigh: undefined,
      strength: isStrong ? 'strong' : 'moderate',
      touchCount: cluster.length,
      createdAt: latestTs,
      broken: false,
      label: `Sell-Side Liquidity (${cluster.length} equal lows) ${avgPrice.toFixed(2)}`,
      qualityScore: 0,
      grade: 'informational',
      qualityFactors: {
        ..._defaultFactors(),
        touchCountQuality: isStrong ? 30 : 60,
      },
      sourceTimeframe: undefined,
      directionalBias: 'long', // price tends to sweep below then reverse up
    });
  }

  return levels;
}
