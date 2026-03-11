// ── main/trading/levels/LevelMapEngine.ts ─────────────────────────────────────
//
// Orchestrates the full level map assembly pipeline:
//
//   1. Run all 6 Batch 2 detectors on normalized market data
//   2. Score every detected level through LevelScorer
//   3. Register and deduplicate through LevelRegistry
//   4. Update touch counts and broken state from current price
//   5. Produce a complete LevelMap
//
// This engine is a stateless assembler: given NormalizedMarketData, it
// produces a LevelMap. The registry is rebuilt from scratch each call.
// Future phases may add incremental merge logic by retaining the registry
// across ticks and only re-running detectors when new bars complete.
//
// The engine is NOT active in the runtime path yet. It will be called by
// TriForgeShadowSimulator.evalTick() when useLevelEngine=true in a later phase.

import type { NormalizedMarketData, LevelMap, PriceLevel, LevelType } from '@triforge/engine';

// Batch 2 detectors
import { detectSwingLevels, detectBreaksOfStructure, type BreakOfStructure } from './SwingLevelDetector';
import { detectSupplyDemandZones } from './SupplyDemandDetector';
import { detectFairValueGaps } from './ImbalanceDetector';
import { detectSessionLevels } from './SessionLevelDetector';
import { detectLiquidityPools } from './LiquidityPoolDetector';
import { detectVolumeProfileLevels } from './VolumeProfileDetector';

// Phase 3 modules
import { scoreLevelQuality, type ScoringContext } from './LevelScorer';
import { LevelRegistry, type RegistryConfig } from './LevelRegistry';

// ── ATR Helper ────────────────────────────────────────────────────────────────

/**
 * Compute a simple ATR from 5m bars. Falls back to bars15m, then to a
 * default of 10 points if no bars are available.
 */
function _computeAtr(data: NormalizedMarketData): number {
  if (data.atr5m != null && data.atr5m > 0) return data.atr5m;

  const bars = data.bars5m.length > 0 ? data.bars5m : data.bars15m;
  if (bars.length < 2) return 10; // fallback

  const period = Math.min(14, bars.length);
  const start = bars.length - period;
  let sum = 0;
  for (let i = start; i < bars.length; i++) {
    sum += bars[i].high - bars[i].low;
  }
  return sum / period;
}

// ── BOS Context Pre-Fill ──────────────────────────────────────────────────────

/**
 * Pre-fill the structuralBreak quality factor for levels that are near a
 * genuine break of structure (BOS) origin. This is additive: it only raises
 * the pre-existing factor, never lowers it.
 *
 * Scoring is conservative:
 *   - Aligned BOS (bullish BOS + long-bias level, or bearish BOS + short-bias
 *     level) → 85
 *   - Unaligned BOS (structure broke but level bias doesn't match) → 65
 *
 * These values are capped to avoid BOS dominating the overall level score.
 * The structuralBreak factor has weight 5 in the 10-factor model, so even
 * a perfect 100 only contributes 5 points to the final 0-100 score.
 */
function _applyBosContext(
  levels: PriceLevel[],
  bosEvents: BreakOfStructure[],
  atr: number,
): void {
  if (bosEvents.length === 0) return;

  const proximity = atr * 0.5;

  for (const level of levels) {
    for (const bos of bosEvents) {
      if (Math.abs(level.price - bos.breakPrice) > proximity) continue;

      const isAligned = (
        (bos.direction === 'bullish' && level.directionalBias === 'long') ||
        (bos.direction === 'bearish' && level.directionalBias === 'short')
      );
      const bosScore = isAligned ? 85 : 65;

      // Only raise, never lower
      level.qualityFactors.structuralBreak = Math.max(
        level.qualityFactors.structuralBreak,
        bosScore,
      );
    }
  }
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class LevelMapEngine {
  /**
   * Build a complete LevelMap from normalized market data.
   *
   * This is the main entry point. It runs all detectors, scores levels,
   * deduplicates, and assembles the map.
   *
   * @param data - Normalized market data snapshot from TradovateMarketDataAdapter
   * @returns A complete LevelMap, or null if insufficient data.
   */
  buildLevelMap(data: NormalizedMarketData): LevelMap | null {
    if (!data.indicatorReady && data.bars5m.length < 10) {
      return null; // not enough data to build a meaningful map
    }

    const atr = _computeAtr(data);
    const now = Date.now();

    // ── Step 1: Run all detectors ──────────────────────────────────────────

    const swingLevels = detectSwingLevels(data.bars5m, data.bars15m);
    const supplyDemandLevels = detectSupplyDemandZones(data.bars5m, atr);
    const fvgLevels = detectFairValueGaps(data.bars5m);
    const sessionLevels = detectSessionLevels(data);
    const liquidityLevels = detectLiquidityPools(swingLevels, atr * 0.3);
    const volumeLevels = detectVolumeProfileLevels(data.bars5m);

    // ── Step 1b: Detect breaks of structure ─────────────────────────────────
    // BOS events are used to pre-fill the structuralBreak quality factor on
    // levels near a genuine structure break, before scoring runs. This is
    // additive — it only raises the factor, never lowers it.

    const bosEvents = detectBreaksOfStructure(data.bars5m, data.bars15m);

    // ── Step 2: Build scoring context ──────────────────────────────────────

    const scoringCtx: ScoringContext = {
      currentPrice: data.currentPrice,
      atr,
      trend15m: data.trend15m,
      nowMs: now,
      fvgLevels,
      liquidityLevels,
    };

    // ── Step 3: Score all levels ───────────────────────────────────────────

    const allDetected: PriceLevel[] = [
      ...swingLevels,
      ...supplyDemandLevels,
      ...fvgLevels,
      ...sessionLevels,
      ...liquidityLevels,
      ...volumeLevels,
    ];

    // Pre-fill structuralBreak factor for levels near BOS origins
    _applyBosContext(allDetected, bosEvents, atr);

    const scored: PriceLevel[] = allDetected.map(level => {
      const result = scoreLevelQuality(level, scoringCtx);
      return {
        ...level,
        qualityScore: result.score,
        grade: result.grade,
        qualityFactors: result.factors,
      };
    });

    // ── Step 4: Register and deduplicate ───────────────────────────────────

    const registryConfig: RegistryConfig = {
      deduplicationTolerance: atr * 0.2,
      breakTolerance: atr * 0.3,
      touchProximity: atr * 0.15,
    };

    const registry = new LevelRegistry(registryConfig);
    registry.registerLevels(scored);

    // ── Step 5: Update touch/broken state from current price ───────────────

    registry.updateTouchesAndBrokenState(data.currentPrice, now);

    // ── Step 6: Assemble LevelMap ──────────────────────────────────────────

    const activeLevels = registry.getActiveLevels(data.currentPrice);
    const nearestAbove = registry.getNearestAbove(data.currentPrice);
    const nearestBelow = registry.getNearestBelow(data.currentPrice);
    const levelCounts = registry.getLevelCounts();

    return {
      symbol: data.symbol,
      buildTime: now,
      levels: activeLevels,
      currentPrice: data.currentPrice,
      nearestAbove,
      nearestBelow,
      activeRoute: null, // set by PathPredictionEngine in Phase 4
      levelCounts,
    };
  }
}
