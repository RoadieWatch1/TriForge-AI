// ── main/trading/levels/SessionLevelDetector.ts ──────────────────────────────
//
// Produces session-derived levels: HOD, LOD, previous-day high/low/close,
// overnight high/low, and opening range high/low.
//
// These levels are not detected from pattern analysis — they are directly
// derived from known session reference prices. They serve as key
// institutional decision levels.
//
// Opening range = first 5 minutes of RTH session (8:30–8:35 CT for futures).
//
// Pure function — no side effects, no state.

import type { NormalizedBar, NormalizedMarketData, PriceLevel, LevelQualityFactors } from '@triforge/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextId(prefix: string): string {
  return `session_${prefix}_${Date.now()}_${++_idCounter}`;
}

function _defaultFactors(): LevelQualityFactors {
  return {
    displacementAway: 0,
    reactionStrength: 0,
    htfAlignment: 0,
    freshness: 100,
    imbalancePresent: 0,
    volumeSurge: 0,
    liquidityRelevance: 0,
    touchCountQuality: 100,
    recency: 50,
    structuralBreak: 0,
  };
}

function _makeLevel(
  type: PriceLevel['type'],
  price: number,
  label: string,
  strength: PriceLevel['strength'] = 'strong',
  bias: PriceLevel['directionalBias'] = 'neutral',
): PriceLevel {
  return {
    id: _nextId(type),
    type,
    price,
    strength,
    touchCount: 0,
    createdAt: Date.now(),
    broken: false,
    label,
    qualityScore: 0,
    grade: 'informational',
    qualityFactors: _defaultFactors(),
    sourceTimeframe: undefined,
    directionalBias: bias,
  };
}

// ── Opening Range Detection ──────────────────────────────────────────────────

/**
 * Compute the opening range from 1m bars.
 * Opening range = high and low of the first `durationMinutes` of RTH.
 *
 * @param bars1m - 1-minute bars sorted ascending
 * @param rthStartMs - RTH start time as ms epoch (e.g. 8:30 CT today)
 * @param durationMinutes - Opening range duration in minutes (default 5)
 */
function _computeOpeningRange(
  bars1m: NormalizedBar[],
  rthStartMs: number,
  durationMinutes = 5,
): { high: number; low: number } | null {
  const endMs = rthStartMs + durationMinutes * 60_000;
  let high = -Infinity;
  let low = Infinity;
  let found = false;

  for (const bar of bars1m) {
    if (bar.timestamp >= rthStartMs && bar.timestamp < endMs) {
      if (bar.high > high) high = bar.high;
      if (bar.low < low) low = bar.low;
      found = true;
    }
    if (bar.timestamp >= endMs) break;
  }

  return found ? { high, low } : null;
}

/**
 * Estimate today's RTH start time in ms epoch.
 * RTH for CME futures = 8:30 CT = 13:30 or 14:30 UTC depending on DST.
 * We use Intl to find the exact CT time for today.
 */
function _estimateRthStartMs(): number {
  const now = new Date();
  // Get today's date in CT
  const ctDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  // Parse back to a Date at 08:30 CT
  const [year, month, day] = ctDate.split('-').map(Number);
  // Create a date string with explicit CT timezone offset
  // Using Intl to figure out the UTC offset for CT today
  const testDate = new Date(`${ctDate}T08:30:00`);
  const ctParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const nowHourCT = Number(ctParts.find(p => p.type === 'hour')?.value ?? 0);
  const nowMinCT = Number(ctParts.find(p => p.type === 'minute')?.value ?? 0);

  // Compute ms since start of day CT and offset to 8:30
  const nowMs = now.getTime();
  const minutesSinceMidnightCT = nowHourCT * 60 + nowMinCT;
  const targetMinutes = 8 * 60 + 30; // 8:30 CT
  const diffMinutes = minutesSinceMidnightCT - targetMinutes;
  return nowMs - diffMinutes * 60_000;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect session-derived levels from market data.
 *
 * @param data - Normalized market data snapshot
 * @returns Array of PriceLevel objects for session reference levels.
 */
export function detectSessionLevels(data: NormalizedMarketData): PriceLevel[] {
  const levels: PriceLevel[] = [];

  // HOD / LOD (always available from live snapshot)
  if (data.highOfDay > 0) {
    levels.push(_makeLevel('session_high', data.highOfDay,
      `Session High ${data.highOfDay.toFixed(2)}`, 'strong', 'short'));
  }
  if (data.lowOfDay > 0) {
    levels.push(_makeLevel('session_low', data.lowOfDay,
      `Session Low ${data.lowOfDay.toFixed(2)}`, 'strong', 'long'));
  }

  // Previous day levels (from MarketSnapshotStore history computation)
  if (data.prevDayHigh != null) {
    levels.push(_makeLevel('prev_day_high', data.prevDayHigh,
      `Prev Day High ${data.prevDayHigh.toFixed(2)}`, 'strong', 'short'));
  }
  if (data.prevDayLow != null) {
    levels.push(_makeLevel('prev_day_low', data.prevDayLow,
      `Prev Day Low ${data.prevDayLow.toFixed(2)}`, 'strong', 'long'));
  }

  // Overnight levels
  if (data.overnightHigh != null) {
    levels.push(_makeLevel('overnight_high', data.overnightHigh,
      `Overnight High ${data.overnightHigh.toFixed(2)}`, 'moderate', 'short'));
  }
  if (data.overnightLow != null) {
    levels.push(_makeLevel('overnight_low', data.overnightLow,
      `Overnight Low ${data.overnightLow.toFixed(2)}`, 'moderate', 'long'));
  }

  // Opening range (computed from 1m bars if available)
  if (data.bars1m.length > 0) {
    const rthStartMs = _estimateRthStartMs();
    const or = _computeOpeningRange(data.bars1m, rthStartMs, 5);
    if (or) {
      levels.push(_makeLevel('opening_range_high', or.high,
        `Opening Range High ${or.high.toFixed(2)}`, 'moderate', 'short'));
      levels.push(_makeLevel('opening_range_low', or.low,
        `Opening Range Low ${or.low.toFixed(2)}`, 'moderate', 'long'));
    }
  }

  return levels;
}
