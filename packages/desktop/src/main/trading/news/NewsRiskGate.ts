// ── main/trading/news/NewsRiskGate.ts ───────────────────────────────────────────
//
// Evaluates whether a trade should be blocked or downgraded due to
// proximity to scheduled economic events.
//
// Behavior by tier:
//   top    — BLOCK new entries within pre-buffer. After the event, require
//            post-event stabilization (configurable bar count) before
//            allowing fresh entries.
//   medium — FLAG / downgrade score. Do not hard-block but add risk context.
//   low    — Informational only. No blocking or downgrade.
//
// SIMULATION ONLY. No real brokerage orders.

import type { NewsEvent, NewsTier } from '@triforge/engine';
import type { NewsCalendarProvider } from './NewsCalendarProvider';

// ── Result Types ────────────────────────────────────────────────────────────

export interface NewsBlockResult {
  /** Whether new entries should be hard-blocked. */
  blocked: boolean;
  /** Human-readable reason (for UI and council context). */
  reason: string;
  /** The event causing the block (if any). */
  event?: NewsEvent;
  /** Whether we are in a post-event stabilization period. */
  postEventWait: boolean;
}

export interface NewsRiskContext {
  /** True if any event is active in the risk window. */
  hasActiveRisk: boolean;
  /** Hard block active. */
  blocked: boolean;
  /** Reason string (empty if no risk). */
  reason: string;
  /** Events in the current window, sorted by proximity. */
  nearbyEvents: NewsEvent[];
  /** Score adjustment to apply (negative = downgrade). */
  scoreAdjustment: number;
  /** Risk flags to inject into council/decision context. */
  riskFlags: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Number of completed bars (5m) required after a top-tier event
 * before fresh entries are allowed. 2 bars = 10 minutes of structure.
 */
const POST_NEWS_STABILIZATION_BARS = 2;

/**
 * Duration for post-news stabilization (derived from bar count).
 * 2 bars * 5 minutes = 10 minutes.
 */
const POST_NEWS_STABILIZATION_MS = POST_NEWS_STABILIZATION_BARS * 5 * 60_000;

/** Score penalty for being near a medium-tier event. */
const MEDIUM_TIER_SCORE_PENALTY = -8;

/** Score penalty for being in the post-stabilization window of a top-tier event. */
const TOP_TIER_POST_SCORE_PENALTY = -12;

// ── Gate Logic ──────────────────────────────────────────────────────────────

/**
 * Determine whether new entries should be blocked due to news proximity.
 *
 * @param provider - The news calendar provider.
 * @param now      - Current time (ms epoch). Defaults to Date.now().
 * @returns Block result with reason and event details.
 */
export function shouldBlockForNews(
  provider: NewsCalendarProvider,
  now = Date.now(),
): NewsBlockResult {
  // Look 30 min back (for post-event stabilization) and 10 min ahead
  const events = provider.getUpcomingEvents(30, 10, now);

  for (const event of events) {
    // Pre-event buffer: block if we are within bufferMinutesBefore of the event
    const preBufferStart = event.time - event.bufferMinutesBefore * 60_000;
    if (event.tier === 'top' && now >= preBufferStart && now < event.time) {
      return {
        blocked: true,
        reason: `Top-tier event "${event.title}" in ${Math.ceil((event.time - now) / 60_000)}m — blocking new entries.`,
        event,
        postEventWait: false,
      };
    }

    // Post-event buffer: block during the official post-buffer + stabilization period
    if (event.tier === 'top' && now >= event.time) {
      const officialPostEnd = event.time + event.bufferMinutesAfter * 60_000;
      const stabilizationEnd = event.time + POST_NEWS_STABILIZATION_MS;
      const effectiveEnd = Math.max(officialPostEnd, stabilizationEnd);

      if (now < effectiveEnd) {
        const remainingMs = effectiveEnd - now;
        return {
          blocked: true,
          reason: `Post-event stabilization for "${event.title}" — ${Math.ceil(remainingMs / 60_000)}m remaining. Waiting for ${POST_NEWS_STABILIZATION_BARS} completed bars.`,
          event,
          postEventWait: true,
        };
      }
    }
  }

  return { blocked: false, reason: '', postEventWait: false };
}

/**
 * Build a comprehensive news risk context for use in decisions and
 * council prompts.
 *
 * @param provider - The news calendar provider.
 * @param now      - Current time (ms epoch). Defaults to Date.now().
 * @returns Full risk context with flags, score adjustment, and nearby events.
 */
export function getNewsRiskContext(
  provider: NewsCalendarProvider,
  now = Date.now(),
): NewsRiskContext {
  // Wider window for context: 30 min back, 60 min ahead
  const nearbyEvents = provider.getUpcomingEvents(30, 60, now);
  const blockResult = shouldBlockForNews(provider, now);

  const riskFlags: string[] = [];
  let scoreAdjustment = 0;

  if (blockResult.blocked) {
    riskFlags.push(blockResult.reason);
  }

  for (const event of nearbyEvents) {
    const minutesUntil = (event.time - now) / 60_000;

    if (event.tier === 'top') {
      if (minutesUntil > 0 && minutesUntil <= 30) {
        riskFlags.push(`Top-tier event "${event.title}" in ${Math.round(minutesUntil)}m`);
      }
      // Post-event score penalty (even if not blocking)
      if (minutesUntil < 0 && minutesUntil > -30) {
        scoreAdjustment = Math.min(scoreAdjustment, TOP_TIER_POST_SCORE_PENALTY);
        if (!blockResult.blocked) {
          riskFlags.push(`Recently released: "${event.title}" (${Math.abs(Math.round(minutesUntil))}m ago) — elevated volatility`);
        }
      }
    }

    if (event.tier === 'medium') {
      const preStart = event.time - event.bufferMinutesBefore * 60_000;
      const postEnd = event.time + event.bufferMinutesAfter * 60_000;
      if (now >= preStart && now <= postEnd) {
        scoreAdjustment = Math.min(scoreAdjustment, MEDIUM_TIER_SCORE_PENALTY);
        if (minutesUntil > 0) {
          riskFlags.push(`Medium-tier event "${event.title}" in ${Math.round(minutesUntil)}m — score downgraded`);
        } else {
          riskFlags.push(`Medium-tier event "${event.title}" just released — score downgraded`);
        }
      }
    }
  }

  return {
    hasActiveRisk: riskFlags.length > 0,
    blocked: blockResult.blocked,
    reason: blockResult.reason,
    nearbyEvents,
    scoreAdjustment,
    riskFlags,
  };
}
