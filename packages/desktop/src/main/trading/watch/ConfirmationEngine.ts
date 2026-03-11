// ── main/trading/watch/ConfirmationEngine.ts ──────────────────────────────────
//
// Detects confirmation signals at a watched level from recent bar data.
//
// When a watch enters the "confirming" state, this engine analyzes the
// most recent bars near the level to determine whether price is reacting
// (confirming the level holds) or blowing through (invalidating the level).
//
// 8 signal families:
//
//   1. rejection_wick — Long wick through the level with close back on the
//      expected side. Shows buying/selling pressure at the level.
//
//   2. displacement_candle — A strong-bodied candle moving away from the
//      level in the expected direction. Body > 1.5x ATR = strong displacement.
//
//   3. micro_structure_break — Short-term high/low sequence shifts near the
//      level. E.g. at a demand zone, a sequence of lower lows reverses to a
//      higher low → micro BOS confirming demand.
//
//   4. reclaim_failure — Price briefly breaks through the level but immediately
//      reclaims back to the expected side within 1-2 bars. This is a failed
//      breakout / trap pattern.
//
//   5. volume_expansion — Bar volume during the reaction is > 1.5x the
//      recent average volume, suggesting institutional participation.
//
//   6. retest_hold — After an initial reaction, price retests the level and
//      holds (doesn't break through on the second attempt).
//
//   7. response_speed — How quickly did confirmation arrive after price
//      touched the level? Within 1-2 bars = fast (high score).
//
//   8. inability_to_continue — Stalling candles on the opposing side: small
//      bodies, long wicks against the direction, lack of follow-through.
//      This is folded into rejection_wick and micro_structure_break scoring
//      as a boosting signal rather than a standalone detector, because it is
//      best detected as a complement to other signals. Documented below.
//
// All detectors are pure functions operating on NormalizedBar arrays.

import type {
  PriceLevel, NormalizedBar, ConfirmationSignal, ConfirmationType,
  RouteDirection,
} from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function _clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

function _bodySize(bar: NormalizedBar): number {
  return Math.abs(bar.close - bar.open);
}

function _isBullish(bar: NormalizedBar): boolean {
  return bar.close > bar.open;
}

function _upperWick(bar: NormalizedBar): number {
  return bar.high - Math.max(bar.open, bar.close);
}

function _lowerWick(bar: NormalizedBar): number {
  return Math.min(bar.open, bar.close) - bar.low;
}

function _barRange(bar: NormalizedBar): number {
  return bar.high - bar.low;
}

function _avgVolume(bars: NormalizedBar[], count = 20): number {
  const start = Math.max(0, bars.length - count);
  let sum = 0;
  let n = 0;
  for (let i = start; i < bars.length; i++) {
    if (bars[i].volume > 0) {
      sum += bars[i].volume;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function _signal(
  type: ConfirmationType,
  strength: number,
  bar: NormalizedBar,
  description: string,
): ConfirmationSignal {
  return {
    type,
    strength: _clamp(strength),
    detectedAt: bar.timestamp,
    price: bar.close,
    description,
  };
}

// ── Signal Detectors ──────────────────────────────────────────────────────────

/**
 * 1. Rejection Wick
 * Long wick through the level with close back on the expected side.
 *
 * For a demand (long direction): look for a lower wick that dips below/into
 * the level but closes above it. Wick length / bar range = rejection quality.
 *
 * For a supply (short direction): look for an upper wick that pokes above/into
 * the level but closes below it.
 *
 * "Inability to continue" is captured here as a boost: if the opposing wick
 * is also small (no follow-through beyond the level), strength increases.
 */
function _detectRejectionWick(
  bars: NormalizedBar[],
  levelPrice: number,
  direction: RouteDirection,
  atr: number,
): ConfirmationSignal | null {
  if (bars.length === 0) return null;

  for (let i = bars.length - 1; i >= Math.max(0, bars.length - 5); i--) {
    const bar = bars[i];
    const range = _barRange(bar);
    if (range < atr * 0.1) continue; // skip doji-like bars with no range

    if (direction === 'long') {
      // Demand level: look for lower wick rejection
      const lw = _lowerWick(bar);
      const wickRatio = lw / range;
      // Wick dips to or below level, and bar closes above level
      if (bar.low <= levelPrice + atr * 0.1 && bar.close > levelPrice && wickRatio > 0.4) {
        // Boost if upper wick is small (inability to continue down)
        const uwRatio = _upperWick(bar) / range;
        const inabilityBoost = uwRatio < 0.15 ? 10 : 0;
        const strength = Math.min(100, wickRatio * 120 + inabilityBoost);
        return _signal('rejection_wick', strength, bar,
          `Lower wick rejection at ${levelPrice.toFixed(2)}: wick ${(wickRatio * 100).toFixed(0)}% of range`);
      }
    } else {
      // Supply level: look for upper wick rejection
      const uw = _upperWick(bar);
      const wickRatio = uw / range;
      if (bar.high >= levelPrice - atr * 0.1 && bar.close < levelPrice && wickRatio > 0.4) {
        const lwRatio = _lowerWick(bar) / range;
        const inabilityBoost = lwRatio < 0.15 ? 10 : 0;
        const strength = Math.min(100, wickRatio * 120 + inabilityBoost);
        return _signal('rejection_wick', strength, bar,
          `Upper wick rejection at ${levelPrice.toFixed(2)}: wick ${(wickRatio * 100).toFixed(0)}% of range`);
      }
    }
  }

  return null;
}

/**
 * 2. Displacement Candle
 * Strong-bodied candle moving away from the level in the expected direction.
 */
function _detectDisplacementCandle(
  bars: NormalizedBar[],
  levelPrice: number,
  direction: RouteDirection,
  atr: number,
): ConfirmationSignal | null {
  if (bars.length === 0) return null;

  for (let i = bars.length - 1; i >= Math.max(0, bars.length - 3); i--) {
    const bar = bars[i];
    const body = _bodySize(bar);
    const bullish = _isBullish(bar);

    // Must be in the expected direction
    if (direction === 'long' && !bullish) continue;
    if (direction === 'short' && bullish) continue;

    // Body must be significant (> 1.0x ATR = moderate, > 1.5x ATR = strong)
    if (body < atr * 0.8) continue;

    // Bar must be near the level (originated from the level zone)
    const barMid = (bar.open + bar.close) / 2;
    if (direction === 'long' && bar.low > levelPrice + atr * 0.5) continue;
    if (direction === 'short' && bar.high < levelPrice - atr * 0.5) continue;

    const bodyAtrRatio = body / atr;
    const strength = _clamp(bodyAtrRatio * 55); // 1.0 ATR = 55, 1.5 ATR = 82, 2.0 ATR = 100+
    return _signal('displacement_candle', strength, bar,
      `${bullish ? 'Bullish' : 'Bearish'} displacement: body ${bodyAtrRatio.toFixed(1)}x ATR`);
  }

  return null;
}

/**
 * 3. Micro Break of Structure
 * Short-term high/low sequence reversal near the level.
 *
 * At a demand (long): price was making lower lows, then makes a higher low
 * near the level = micro BOS bullish.
 * At a supply (short): price was making higher highs, then makes a lower
 * high near the level = micro BOS bearish.
 */
function _detectMicroStructureBreak(
  bars: NormalizedBar[],
  levelPrice: number,
  direction: RouteDirection,
  atr: number,
): ConfirmationSignal | null {
  if (bars.length < 4) return null;

  // Examine the last 5 bars for a sequence shift
  const recent = bars.slice(Math.max(0, bars.length - 5));
  if (recent.length < 3) return null;

  if (direction === 'long') {
    // Look for: lower low → higher low sequence
    // Find the lowest low, then check if a subsequent bar made a higher low
    let lowestIdx = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].low < recent[lowestIdx].low) lowestIdx = i;
    }
    // Need at least one bar after the lowest low
    if (lowestIdx >= recent.length - 1) return null;
    // The lowest low should be near the level
    if (Math.abs(recent[lowestIdx].low - levelPrice) > atr * 0.5) return null;

    // Check if any bar after the lowest low has a higher low
    for (let j = lowestIdx + 1; j < recent.length; j++) {
      if (recent[j].low > recent[lowestIdx].low) {
        const lift = recent[j].low - recent[lowestIdx].low;
        const strength = _clamp((lift / atr) * 80);
        return _signal('micro_structure_break', strength, recent[j],
          `Micro BOS bullish: higher low after ${recent[lowestIdx].low.toFixed(2)}`);
      }
    }
  } else {
    // Look for: higher high → lower high sequence
    let highestIdx = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].high > recent[highestIdx].high) highestIdx = i;
    }
    if (highestIdx >= recent.length - 1) return null;
    if (Math.abs(recent[highestIdx].high - levelPrice) > atr * 0.5) return null;

    for (let j = highestIdx + 1; j < recent.length; j++) {
      if (recent[j].high < recent[highestIdx].high) {
        const drop = recent[highestIdx].high - recent[j].high;
        const strength = _clamp((drop / atr) * 80);
        return _signal('micro_structure_break', strength, recent[j],
          `Micro BOS bearish: lower high after ${recent[highestIdx].high.toFixed(2)}`);
      }
    }
  }

  return null;
}

/**
 * 4. Reclaim/Failure Pattern
 * Price briefly breaks through the level but immediately reclaims within
 * 1-2 bars. This is a failed breakout / trap pattern.
 */
function _detectReclaimFailure(
  bars: NormalizedBar[],
  levelPrice: number,
  direction: RouteDirection,
  atr: number,
): ConfirmationSignal | null {
  if (bars.length < 2) return null;

  const recent = bars.slice(Math.max(0, bars.length - 4));

  for (let i = 0; i < recent.length - 1; i++) {
    const breakBar = recent[i];
    const reclaimBar = recent[i + 1];

    if (direction === 'long') {
      // Break below level, then close back above
      const brokeBelow = breakBar.close < levelPrice - atr * 0.05;
      const reclaimedAbove = reclaimBar.close > levelPrice;
      if (brokeBelow && reclaimedAbove) {
        const breakDepth = levelPrice - breakBar.close;
        const strength = _clamp(60 + (breakDepth / atr) * 30);
        return _signal('reclaim_failure', strength, reclaimBar,
          `Failed breakdown: broke to ${breakBar.close.toFixed(2)}, reclaimed above ${levelPrice.toFixed(2)}`);
      }
    } else {
      // Break above level, then close back below
      const brokeAbove = breakBar.close > levelPrice + atr * 0.05;
      const reclaimedBelow = reclaimBar.close < levelPrice;
      if (brokeAbove && reclaimedBelow) {
        const breakDepth = breakBar.close - levelPrice;
        const strength = _clamp(60 + (breakDepth / atr) * 30);
        return _signal('reclaim_failure', strength, reclaimBar,
          `Failed breakout: broke to ${breakBar.close.toFixed(2)}, reclaimed below ${levelPrice.toFixed(2)}`);
      }
    }
  }

  return null;
}

/**
 * 5. Volume Expansion
 * Bar volume during the reaction is > 1.5x recent average volume.
 */
function _detectVolumeExpansion(
  bars: NormalizedBar[],
  allBars: NormalizedBar[],
): ConfirmationSignal | null {
  if (bars.length === 0) return null;

  const avgVol = _avgVolume(allBars);
  if (avgVol <= 0) return null;

  // Check the most recent bars for volume expansion
  for (let i = bars.length - 1; i >= Math.max(0, bars.length - 3); i--) {
    const bar = bars[i];
    if (bar.volume <= 0) continue;
    const ratio = bar.volume / avgVol;
    if (ratio >= 1.5) {
      const strength = _clamp((ratio - 1.0) * 60); // 1.5x=30, 2.0x=60, 2.5x=90
      return _signal('volume_expansion', strength, bar,
        `Volume expansion: ${ratio.toFixed(1)}x average`);
    }
  }

  return null;
}

/**
 * 6. Retest Hold
 * After initial reaction, price retests the level and holds.
 * Requires at least 3 bars: initial reaction, pullback toward level, hold.
 */
function _detectRetestHold(
  bars: NormalizedBar[],
  levelPrice: number,
  direction: RouteDirection,
  atr: number,
): ConfirmationSignal | null {
  if (bars.length < 3) return null;

  const recent = bars.slice(Math.max(0, bars.length - 5));
  if (recent.length < 3) return null;

  // Look for: bar moves away from level, next bar comes back, next bar holds
  for (let i = 0; i < recent.length - 2; i++) {
    const reaction = recent[i];
    const retest = recent[i + 1];
    const hold = recent[i + 2];

    if (direction === 'long') {
      // Reaction bounced up, retest pulls back toward level, hold stays above
      const reactionAway = reaction.close > levelPrice + atr * 0.1;
      const retestBack = retest.low <= levelPrice + atr * 0.3;
      const holdAbove = hold.close > levelPrice && hold.low > levelPrice - atr * 0.15;
      if (reactionAway && retestBack && holdAbove) {
        const holdMargin = hold.close - levelPrice;
        const strength = _clamp(50 + (holdMargin / atr) * 40);
        return _signal('retest_hold', strength, hold,
          `Retest hold: pulled back to ${retest.low.toFixed(2)}, held above ${levelPrice.toFixed(2)}`);
      }
    } else {
      const reactionAway = reaction.close < levelPrice - atr * 0.1;
      const retestBack = retest.high >= levelPrice - atr * 0.3;
      const holdBelow = hold.close < levelPrice && hold.high < levelPrice + atr * 0.15;
      if (reactionAway && retestBack && holdBelow) {
        const holdMargin = levelPrice - hold.close;
        const strength = _clamp(50 + (holdMargin / atr) * 40);
        return _signal('retest_hold', strength, hold,
          `Retest hold: pulled back to ${retest.high.toFixed(2)}, held below ${levelPrice.toFixed(2)}`);
      }
    }
  }

  return null;
}

/**
 * 7. Response Speed
 * How quickly did confirmation signals appear after price touched the level?
 * Within 1 bar = fast (high score), 2 bars = moderate, 3+ = slow.
 *
 * @param touchTimestamp - When the watch entered confirming state
 * @param signals        - Other signals already detected this pass
 */
function _detectResponseSpeed(
  bars: NormalizedBar[],
  touchTimestamp: number,
  signals: ConfirmationSignal[],
): ConfirmationSignal | null {
  if (signals.length === 0 || bars.length === 0) return null;

  // Find the earliest signal after the touch
  const postTouchSignals = signals.filter(s => s.detectedAt >= touchTimestamp);
  if (postTouchSignals.length === 0) return null;

  const earliest = postTouchSignals.reduce((a, b) =>
    a.detectedAt < b.detectedAt ? a : b,
  );

  // Count how many bars elapsed between touch and first signal
  let barsElapsed = 0;
  for (const bar of bars) {
    if (bar.timestamp > touchTimestamp && bar.timestamp <= earliest.detectedAt) {
      barsElapsed++;
    }
  }

  let strength: number;
  let label: string;
  if (barsElapsed <= 1) {
    strength = 90;
    label = 'Fast response (within 1 bar)';
  } else if (barsElapsed <= 2) {
    strength = 65;
    label = 'Moderate response (2 bars)';
  } else if (barsElapsed <= 3) {
    strength = 40;
    label = 'Slow response (3 bars)';
  } else {
    strength = 20;
    label = `Late response (${barsElapsed} bars)`;
  }

  const lastBar = bars[bars.length - 1];
  return _signal('response_speed', strength, lastBar, label);
}

/**
 * 8. Inability to Continue
 * Stalling candles on the opposing side of the level. This is detected as:
 * - Small-bodied bars (body < 0.3x ATR) near the level
 * - Long wicks against the expected direction
 * - Lack of follow-through after a push toward the level
 *
 * Rather than a fully standalone detector, this acts as supplementary
 * evidence. It only fires if there are at least 2 stalling bars in the
 * recent window, keeping false positives low.
 */
function _detectInabilityToContinue(
  bars: NormalizedBar[],
  levelPrice: number,
  direction: RouteDirection,
  atr: number,
): ConfirmationSignal | null {
  if (bars.length < 2) return null;

  const recent = bars.slice(Math.max(0, bars.length - 4));
  let stallCount = 0;

  for (const bar of recent) {
    const body = _bodySize(bar);
    const range = _barRange(bar);
    if (range < atr * 0.05) continue; // skip zero-range bars

    const isSmallBody = body < atr * 0.3;
    if (!isSmallBody) continue;

    // Check for wick against the opposing direction
    if (direction === 'long') {
      // At a demand zone: opposing = bears pushing down
      // Stalling = small body + upper wick suggesting bears can't push through
      const uwRatio = _upperWick(bar) / range;
      if (uwRatio < 0.3 && bar.close >= levelPrice - atr * 0.2) {
        stallCount++;
      }
    } else {
      // At a supply zone: opposing = bulls pushing up
      const lwRatio = _lowerWick(bar) / range;
      if (lwRatio < 0.3 && bar.close <= levelPrice + atr * 0.2) {
        stallCount++;
      }
    }
  }

  if (stallCount >= 2) {
    const lastBar = recent[recent.length - 1];
    const strength = _clamp(40 + stallCount * 15); // 2 bars = 70, 3 = 85, 4 = 100
    return _signal('inability_to_continue', strength, lastBar,
      `${stallCount} stalling bars near ${levelPrice.toFixed(2)}: opposing side unable to follow through`);
  }

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Context for confirmation evaluation.
 */
export interface ConfirmationContext {
  /** The watched level being tested. */
  level: PriceLevel;
  /** Expected trade direction at this level. */
  direction: RouteDirection;
  /** ATR from 5m bars. */
  atr: number;
  /** Recent bars near the level (last 5–10 bars, 5m timeframe). */
  recentBars: NormalizedBar[];
  /** All available bars for volume baseline computation. */
  allBars: NormalizedBar[];
  /** When price first touched the level (ms epoch). */
  touchTimestamp: number;
}

/**
 * Evaluate all confirmation signals at a watched level.
 *
 * @returns Array of detected ConfirmationSignal objects. May be empty if
 *          no signals are detected (which typically leads to rejection).
 */
export function evaluateConfirmation(ctx: ConfirmationContext): ConfirmationSignal[] {
  const { level, direction, atr, recentBars, allBars, touchTimestamp } = ctx;
  const levelPrice = level.price;
  const signals: ConfirmationSignal[] = [];

  if (recentBars.length === 0 || atr <= 0) return signals;

  // Run all detectors (order doesn't matter — they are independent)
  const rejection = _detectRejectionWick(recentBars, levelPrice, direction, atr);
  if (rejection) signals.push(rejection);

  const displacement = _detectDisplacementCandle(recentBars, levelPrice, direction, atr);
  if (displacement) signals.push(displacement);

  const microBos = _detectMicroStructureBreak(recentBars, levelPrice, direction, atr);
  if (microBos) signals.push(microBos);

  const reclaim = _detectReclaimFailure(recentBars, levelPrice, direction, atr);
  if (reclaim) signals.push(reclaim);

  const volume = _detectVolumeExpansion(recentBars, allBars);
  if (volume) signals.push(volume);

  const retest = _detectRetestHold(recentBars, levelPrice, direction, atr);
  if (retest) signals.push(retest);

  const inability = _detectInabilityToContinue(recentBars, levelPrice, direction, atr);
  if (inability) signals.push(inability);

  // Response speed depends on other signals being detected first
  const speed = _detectResponseSpeed(recentBars, touchTimestamp, signals);
  if (speed) signals.push(speed);

  return signals;
}
