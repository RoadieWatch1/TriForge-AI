// ── main/trading/watch/LevelWatchState.ts ─────────────────────────────────────
//
// State model and transition helpers for the watch alert lifecycle.
//
// State Machine:
//
//   idle ──→ watching ──→ confirming ──→ confirmed
//     │         │             │
//     │         │             └──→ rejected
//     │         └──→ rejected (blew through)
//     └──→ rejected (level broken before approach)
//
// States:
//   idle       — Route exists, watch created, price not yet near the level.
//   watching   — Price is within approach range (ATR * 1.5) of the level.
//   confirming — Price touched/tested the level; confirmation window is open
//                and the ConfirmationEngine is evaluating bar signals.
//   confirmed  — Confirmation score >= threshold (65). The watch is actionable.
//   rejected   — Price blew through without confirmation, the confirmation
//                score was too weak, or the level was broken/invalidated.
//
// Terminal states: confirmed, rejected. Once terminal, a watch is never
// re-evaluated. The scheduler removes terminal watches after processing.
//
// Pure functions — no internal state.

import type { WatchState, WatchAlert } from '@triforge/engine';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default confirmation score threshold for confirmed state. */
export const CONFIRMATION_THRESHOLD = 65;

/** Maximum bars in the confirmation window before forced evaluation. */
export const CONFIRMATION_WINDOW_BARS = 5;

/** Maximum ms the confirmation window stays open (5m * 5 bars = 25 min). */
export const CONFIRMATION_WINDOW_MS = 25 * 60_000;

// ── State Queries ─────────────────────────────────────────────────────────────

/** Whether the watch is in a terminal state (confirmed or rejected). */
export function isTerminal(state: WatchState): boolean {
  return state === 'confirmed' || state === 'rejected';
}

/** Whether the watch is still active (not terminal). */
export function isActive(state: WatchState): boolean {
  return !isTerminal(state);
}

/** Whether the watch is in a state that accepts price updates. */
export function acceptsPriceUpdates(state: WatchState): boolean {
  return state === 'idle' || state === 'watching' || state === 'confirming';
}

// ── Transition Functions ──────────────────────────────────────────────────────
//
// Each function returns a partial WatchAlert update object. The scheduler
// applies these updates to the actual watch. This keeps the state logic
// pure and testable.

export interface WatchUpdate {
  state: WatchState;
  arrivedAt?: number;
  confirmedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
}

/**
 * Transition idle → watching.
 * Called when price enters the approach range of the watched level.
 */
export function transitionToWatching(nowMs: number): WatchUpdate {
  return { state: 'watching', arrivedAt: nowMs };
}

/**
 * Transition watching → confirming.
 * Called when price touches/tests the watched level (within touch range).
 */
export function transitionToConfirming(nowMs: number): WatchUpdate {
  // arrivedAt is already set from watching; we keep it.
  return { state: 'confirming' };
}

/**
 * Transition confirming → confirmed.
 * Called when confirmation score >= threshold.
 */
export function transitionToConfirmed(nowMs: number): WatchUpdate {
  return { state: 'confirmed', confirmedAt: nowMs };
}

/**
 * Transition any active state → rejected.
 * Called when the watch is invalidated for any reason.
 */
export function transitionToRejected(nowMs: number, reason: string): WatchUpdate {
  return { state: 'rejected', rejectedAt: nowMs, rejectionReason: reason };
}

// ── Decision Helpers ──────────────────────────────────────────────────────────

/**
 * Determine whether price is within approach range of the watched level.
 *
 * @param currentPrice - Current market price
 * @param levelPrice   - Watched level's price
 * @param approachRange - Distance threshold (typically ATR * 1.5)
 */
export function isInApproachRange(
  currentPrice: number,
  levelPrice: number,
  approachRange: number,
): boolean {
  return Math.abs(currentPrice - levelPrice) <= approachRange;
}

/**
 * Determine whether price is touching/testing the watched level.
 *
 * For zone levels (with priceHigh), touch means price is within the zone.
 * For line levels, touch means price is within touchRange.
 *
 * @param currentPrice - Current market price
 * @param levelPrice   - Watched level's price (midpoint for zones)
 * @param touchRange   - Distance threshold for line levels (typically ATR * 0.2)
 * @param zoneHigh     - Upper bound for zone levels (optional)
 */
export function isTouchingLevel(
  currentPrice: number,
  levelPrice: number,
  touchRange: number,
  zoneHigh?: number,
): boolean {
  if (zoneHigh != null) {
    // Zone level: price is within the zone bounds (with touchRange padding)
    const zoneLow = Math.min(levelPrice, zoneHigh);
    const zoneTop = Math.max(levelPrice, zoneHigh);
    return currentPrice >= zoneLow - touchRange && currentPrice <= zoneTop + touchRange;
  }
  // Line level: price is within touchRange of the level
  return Math.abs(currentPrice - levelPrice) <= touchRange;
}

/**
 * Determine whether price has blown through the level, indicating a break
 * rather than a reaction.
 *
 * A blow-through occurs when price passes the level in the "wrong" direction
 * by more than breakDistance.
 *
 * @param currentPrice  - Current market price
 * @param levelPrice    - Watched level's price
 * @param direction     - Expected trade direction at this level
 * @param breakDistance  - Distance beyond level that constitutes a break (ATR * 0.5)
 */
export function hasBlownThrough(
  currentPrice: number,
  levelPrice: number,
  direction: 'long' | 'short',
  breakDistance: number,
): boolean {
  if (direction === 'long') {
    // Expecting a bounce UP from a demand/support level.
    // Blow-through = price fell well below the level.
    return currentPrice < levelPrice - breakDistance;
  }
  // Expecting a rejection DOWN from a supply/resistance level.
  // Blow-through = price rose well above the level.
  return currentPrice > levelPrice + breakDistance;
}

/**
 * Determine whether the confirmation window has expired.
 *
 * @param arrivedAt - When the watch entered confirming state (ms epoch)
 * @param nowMs     - Current time
 * @param maxMs     - Maximum confirmation window duration
 */
export function isConfirmationWindowExpired(
  arrivedAt: number,
  nowMs: number,
  maxMs: number = CONFIRMATION_WINDOW_MS,
): boolean {
  return (nowMs - arrivedAt) >= maxMs;
}
