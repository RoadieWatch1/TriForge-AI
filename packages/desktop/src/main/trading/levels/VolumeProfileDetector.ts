// ── main/trading/levels/VolumeProfileDetector.ts ─────────────────────────────
//
// Builds a simplified volume profile from bar data and extracts:
//   - Point of Control (POC): price bucket with the highest volume
//   - Value Area High (VAH): upper bound of 70% volume concentration
//   - Value Area Low (VAL): lower bound of 70% volume concentration
//
// Algorithm:
//   1. Divide the price range into fixed-size buckets
//   2. Distribute each bar's volume proportionally across the price buckets
//      that the bar's range covers
//   3. POC = bucket with max volume
//   4. VAH/VAL = expanding outward from POC until 70% of total volume is captured
//
// This is a simplified single-session profile (no TPO or tick-level data).
//
// Pure function — no side effects, no state.

import type { NormalizedBar, PriceLevel, LevelQualityFactors } from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(prefix: string): string {
  return `vol_${prefix}_${Date.now()}_${++_idCounter}`;
}

function _defaultFactors(): LevelQualityFactors {
  return {
    displacementAway: 0,
    reactionStrength: 0,
    htfAlignment: 0,
    freshness: 100,
    imbalancePresent: 0,
    volumeSurge: 0,
    liquidityRelevance: 50,
    touchCountQuality: 50,
    recency: 50,
    structuralBreak: 0,
  };
}

// ── Core Profile ──────────────────────────────────────────────────────────────

export interface VolumeBucket {
  /** Lower bound of this price bucket. */
  priceLow: number;
  /** Upper bound of this price bucket. */
  priceHigh: number;
  /** Midpoint price of this bucket. */
  priceMid: number;
  /** Accumulated volume in this bucket. */
  volume: number;
}

export interface VolumeProfileResult {
  /** All buckets sorted by price ascending. */
  profile: VolumeBucket[];
  /** Point of Control — highest volume bucket midpoint. */
  poc: number;
  /** Value Area High — upper bound of 70% volume area. */
  vah: number;
  /** Value Area Low — lower bound of 70% volume area. */
  val: number;
  /** Total volume across all buckets. */
  totalVolume: number;
}

/**
 * Build a volume profile from bars.
 *
 * @param bars - Normalized bars to profile
 * @param bucketSize - Price width of each bucket. If not provided, uses
 *                     (priceRange / 50) clamped to a minimum of 0.25.
 */
export function buildVolumeProfile(
  bars: NormalizedBar[],
  bucketSize?: number,
): VolumeProfileResult | null {
  if (bars.length < 5) return null;

  // Find overall price range
  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  for (const bar of bars) {
    if (bar.high > rangeHigh) rangeHigh = bar.high;
    if (bar.low < rangeLow) rangeLow = bar.low;
  }
  const priceRange = rangeHigh - rangeLow;
  if (priceRange <= 0) return null;

  const bs = bucketSize ?? Math.max(0.25, priceRange / 50);
  const numBuckets = Math.ceil(priceRange / bs) + 1;

  // Initialize buckets
  const buckets: VolumeBucket[] = [];
  for (let i = 0; i < numBuckets; i++) {
    const low = rangeLow + i * bs;
    buckets.push({
      priceLow: low,
      priceHigh: low + bs,
      priceMid: low + bs / 2,
      volume: 0,
    });
  }

  // Distribute each bar's volume across the buckets its range covers
  for (const bar of bars) {
    const barVol = bar.volume > 0 ? bar.volume : 1; // fallback if no volume
    const barRange = bar.high - bar.low;

    // Find which buckets this bar overlaps
    const startBucket = Math.max(0, Math.floor((bar.low - rangeLow) / bs));
    const endBucket = Math.min(numBuckets - 1, Math.floor((bar.high - rangeLow) / bs));

    if (startBucket === endBucket) {
      buckets[startBucket].volume += barVol;
    } else {
      // Proportional distribution across overlapping buckets
      const coveredBuckets = endBucket - startBucket + 1;
      for (let b = startBucket; b <= endBucket; b++) {
        // Calculate overlap fraction
        const overlapLow = Math.max(bar.low, buckets[b].priceLow);
        const overlapHigh = Math.min(bar.high, buckets[b].priceHigh);
        const overlap = Math.max(0, overlapHigh - overlapLow);
        const fraction = barRange > 0 ? overlap / barRange : 1 / coveredBuckets;
        buckets[b].volume += barVol * fraction;
      }
    }
  }

  // Find POC (bucket with highest volume)
  let pocIdx = 0;
  let maxVol = 0;
  let totalVolume = 0;
  for (let i = 0; i < buckets.length; i++) {
    totalVolume += buckets[i].volume;
    if (buckets[i].volume > maxVol) {
      maxVol = buckets[i].volume;
      pocIdx = i;
    }
  }

  if (totalVolume <= 0) return null;

  // Compute Value Area: expand outward from POC until 70% of volume captured
  const vaThreshold = totalVolume * 0.70;
  let vaVolume = buckets[pocIdx].volume;
  let vaLow = pocIdx;
  let vaHigh = pocIdx;

  while (vaVolume < vaThreshold && (vaLow > 0 || vaHigh < buckets.length - 1)) {
    const belowVol = vaLow > 0 ? buckets[vaLow - 1].volume : -1;
    const aboveVol = vaHigh < buckets.length - 1 ? buckets[vaHigh + 1].volume : -1;

    if (belowVol >= aboveVol && belowVol >= 0) {
      vaLow--;
      vaVolume += buckets[vaLow].volume;
    } else if (aboveVol >= 0) {
      vaHigh++;
      vaVolume += buckets[vaHigh].volume;
    } else {
      break;
    }
  }

  return {
    profile: buckets,
    poc: buckets[pocIdx].priceMid,
    vah: buckets[vaHigh].priceHigh,
    val: buckets[vaLow].priceLow,
    totalVolume,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect volume profile levels (POC, VAH, VAL) from 5m bars.
 *
 * @param bars5m - 5-minute normalized bars (sorted ascending by timestamp)
 * @param bucketSize - Optional bucket size override
 * @returns Array of PriceLevel objects with types 'volume_poc', 'volume_vah', 'volume_val'.
 *          Returns empty if not enough data to build profile.
 */
export function detectVolumeProfileLevels(
  bars5m: NormalizedBar[],
  bucketSize?: number,
): PriceLevel[] {
  const result = buildVolumeProfile(bars5m, bucketSize);
  if (!result) return [];

  const levels: PriceLevel[] = [];

  // POC — highest volume level, acts as magnet/support/resistance
  levels.push({
    id: _nextId('poc'),
    type: 'volume_poc',
    price: result.poc,
    strength: 'strong',
    touchCount: 0,
    createdAt: Date.now(),
    broken: false,
    label: `Volume POC ${result.poc.toFixed(2)}`,
    qualityScore: 0,
    grade: 'informational',
    qualityFactors: {
      ..._defaultFactors(),
      volumeSurge: 80, // POC has highest volume by definition
    },
    sourceTimeframe: '5m',
    directionalBias: 'neutral', // POC acts as both support and resistance
  });

  // VAH — upper bound of value area, acts as resistance
  levels.push({
    id: _nextId('vah'),
    type: 'volume_vah',
    price: result.vah,
    strength: 'moderate',
    touchCount: 0,
    createdAt: Date.now(),
    broken: false,
    label: `Value Area High ${result.vah.toFixed(2)}`,
    qualityScore: 0,
    grade: 'informational',
    qualityFactors: _defaultFactors(),
    sourceTimeframe: '5m',
    directionalBias: 'short',
  });

  // VAL — lower bound of value area, acts as support
  levels.push({
    id: _nextId('val'),
    type: 'volume_val',
    price: result.val,
    strength: 'moderate',
    touchCount: 0,
    createdAt: Date.now(),
    broken: false,
    label: `Value Area Low ${result.val.toFixed(2)}`,
    qualityScore: 0,
    grade: 'informational',
    qualityFactors: _defaultFactors(),
    sourceTimeframe: '5m',
    directionalBias: 'long',
  });

  return levels;
}
