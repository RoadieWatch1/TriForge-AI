// ── main/trading/shadow/ShadowSessionController.ts ────────────────────────────
//
// CT-aware session lifecycle controller. Determines the current session
// window and exposes helpers for trading decisions.
//
// Session windows (all times Central Time):
//   pre_map:  8:00 – 8:30   Build level map, mark overnight/prev-day levels
//   opening:  8:30 – 9:00   Higher volatility, require stronger confirmation
//   prime:    9:00 – 10:30  Main trading focus, full scoring
//   reduced: 10:30 – 12:00  Continuation only, downgrade weaker setups
//   closed:  12:00+         No new entries, flatten or manage by rule
//   outside: before 8:00    Outside session entirely
//
// The controller exposes decisions (shouldFlattenNow, shouldAllowNewTrades)
// but does not force side effects. The simulator decides what to do.
//
// All time computations use Intl.DateTimeFormat with America/Chicago
// timezone, which handles CDT/CST transitions automatically.

import type { SessionContext } from '@triforge/engine';

// ── CT Time Helpers ───────────────────────────────────────────────────────────

interface CTTime {
  hour: number;
  minute: number;
  totalMinutes: number;
}

function _getCTTime(now: Date = new Date()): CTTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

// ── Window Boundaries (minutes since midnight CT) ─────────────────────────────

const OUTSIDE_END   =  8 * 60;        //  8:00
const PRE_MAP_END   =  8 * 60 + 30;   //  8:30
const OPENING_END   =  9 * 60;        //  9:00
const PRIME_END     = 10 * 60 + 30;   // 10:30
const REDUCED_END   = 12 * 60;        // 12:00
// After 12:00 = closed

// ── Window Determination ──────────────────────────────────────────────────────

type WindowLabel = SessionContext['windowLabel'];

function _determineWindow(totalMinutes: number): WindowLabel {
  if (totalMinutes < OUTSIDE_END)   return 'outside';
  if (totalMinutes < PRE_MAP_END)   return 'pre_map';
  if (totalMinutes < OPENING_END)   return 'opening';
  if (totalMinutes < PRIME_END)     return 'prime';
  if (totalMinutes < REDUCED_END)   return 'reduced';
  return 'closed';
}

function _sessionScore(window: WindowLabel): number {
  switch (window) {
    case 'prime':   return 90;
    case 'opening': return 75;
    case 'reduced': return 50;
    case 'pre_map': return 20;
    case 'closed':  return 0;
    case 'outside': return 0;
    default:        return 50;
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

export class ShadowSessionController {
  /**
   * Get the current session context.
   *
   * @param now - Override the current time (for testing). Defaults to Date.now().
   * @returns A fully populated SessionContext.
   */
  getSessionContext(now?: Date): SessionContext {
    const ct = _getCTTime(now);
    const window = _determineWindow(ct.totalMinutes);
    const minutesUntilClose = REDUCED_END - ct.totalMinutes;

    return {
      isActive:   window === 'opening' || window === 'prime' || window === 'reduced',
      isPrime:    window === 'prime',
      isReduced:  window === 'reduced',
      isPreMap:   window === 'pre_map',
      minutesUntilClose,
      sessionScore: _sessionScore(window),
      newsBuffer: false, // News calendar not yet integrated (Phase 9)
      activeEvents: [],  // News calendar not yet integrated (Phase 9)
      windowLabel: window,
    };
  }

  /**
   * Whether new trades should be allowed in the current session window.
   *
   * Allowed during: opening, prime, reduced.
   * Blocked during: pre_map, closed, outside.
   */
  shouldAllowNewTrades(now?: Date): boolean {
    const ctx = this.getSessionContext(now);
    return ctx.isActive;
  }

  /**
   * Whether open positions should be flattened now.
   *
   * Returns true at 12:00 CT (session close). The simulator should call
   * this each tick and flatten if true.
   *
   * This is a decision signal, not a forced action.
   */
  shouldFlattenNow(now?: Date): boolean {
    const ct = _getCTTime(now);
    return ct.totalMinutes >= REDUCED_END;
  }

  /**
   * Minutes remaining until session close (12:00 CT).
   * Negative if past close.
   */
  minutesRemaining(now?: Date): number {
    const ct = _getCTTime(now);
    return REDUCED_END - ct.totalMinutes;
  }

  /**
   * Get the current window label.
   */
  currentWindow(now?: Date): WindowLabel {
    const ct = _getCTTime(now);
    return _determineWindow(ct.totalMinutes);
  }
}
