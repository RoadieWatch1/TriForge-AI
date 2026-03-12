// ── main/trading/decision/RiskModel.ts ────────────────────────────────────────
//
// Validates a trade intent against risk management constraints before it
// can proceed to council review and execution.
//
// ── Checks Performed ──────────────────────────────────────────────────────────
//
//   1. Minimum RR threshold (default 1.5)
//   2. Maximum daily loss (default 5% of account)
//   3. Maximum trades per session (default 6)
//   4. Maximum consecutive losses before pause (default 3)
//   5. Maximum concurrent open positions (default 2)
//   6. Session hard rules (closed / outside window)
//   7. Feed staleness (> 5 seconds = stale)
//   8. Stop distance validity (not zero, not excessively wide)
//   9. News buffer blocking
//
// ── Assumptions ───────────────────────────────────────────────────────────────
//
// - AccountState is a lightweight generic interface, not tied to any broker.
// - RiskSettings provides configurable limits with sensible defaults.
// - SessionContext is optional. When absent, session checks are skipped
//   (conservative: does not auto-block, but also does not auto-approve).
// - Feed freshness is checked from the intent's market data context when
//   provided. When absent, the check is skipped.
// - "Stop too wide" is defined as stop distance > 3x ATR. This is
//   conservative and can be tuned.

import type { TradeIntent, SessionContext } from '@triforge/engine';

// ── Account State ─────────────────────────────────────────────────────────────

export interface AccountState {
  /** Current day's realized P&L in account currency. */
  dailyPnL: number;
  /** Account starting balance for the day (for % calculations). */
  dayStartBalance: number;
  /** Number of trades opened today. */
  tradesToday: number;
  /** Current consecutive loss streak. */
  consecutiveLosses: number;
  /** Number of currently open positions. */
  openPositionCount: number;
  /** Feed freshness in ms since last tick. Undefined if unknown. */
  feedFreshnessMs?: number;
  /** ATR for stop-width validation. Undefined if unknown. */
  currentAtr?: number;
}

// ── Risk Settings ─────────────────────────────────────────────────────────────

export interface RiskSettings {
  /** Minimum acceptable risk-reward ratio. Default 1.5. */
  minRR: number;
  /** Maximum daily loss as a fraction of day-start balance. Default 0.05 (5%). */
  maxDailyLossPct: number;
  /** Maximum trades allowed per session. Default 6. */
  maxTradesPerSession: number;
  /** Maximum consecutive losses before pause. Default 3. */
  maxConsecutiveLosses: number;
  /** Maximum concurrent open positions. Default 2. */
  maxConcurrentPositions: number;
  /** Feed staleness threshold in ms. Default 5000. */
  feedStaleThresholdMs: number;
  /** Maximum stop distance as ATR multiplier. Default 3.0. */
  maxStopAtrMultiple: number;
}

/** Sensible conservative defaults. */
export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  minRR: 1.5,
  maxDailyLossPct: 0.05,
  maxTradesPerSession: 6,
  maxConsecutiveLosses: 3,
  maxConcurrentPositions: 2,
  feedStaleThresholdMs: 5000,
  maxStopAtrMultiple: 3.0,
};

// ── Validation Result ─────────────────────────────────────────────────────────

export interface RiskValidationResult {
  /** Whether the trade is allowed to proceed. */
  allowed: boolean;
  /** Block reason ids (from TradeBlockReason catalog). Empty if allowed. */
  blockReasons: string[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a trade intent against risk management constraints.
 *
 * @param intent   - The trade intent to validate
 * @param account  - Current account state
 * @param settings - Risk settings (defaults applied for missing fields)
 * @param session  - Session context, or null to skip session checks
 * @returns Validation result with allowed flag and any block reasons.
 */
export function validateRisk(
  intent: TradeIntent,
  account: AccountState,
  settings?: Partial<RiskSettings>,
  session?: SessionContext | null,
): RiskValidationResult {
  const cfg = { ...DEFAULT_RISK_SETTINGS, ...settings };
  const blocks: string[] = [];

  // 1. Minimum RR threshold
  if (intent.riskRewardRatio < cfg.minRR) {
    blocks.push('insufficient_rr');
  }

  // 2. Maximum daily loss
  if (account.dayStartBalance > 0) {
    const dailyLossPct = Math.abs(Math.min(0, account.dailyPnL)) / account.dayStartBalance;
    if (dailyLossPct >= cfg.maxDailyLossPct) {
      blocks.push('max_daily_loss_hit');
    }
  }

  // 3. Maximum trades per session
  if (account.tradesToday >= cfg.maxTradesPerSession) {
    blocks.push('max_trades_hit');
  }

  // 4. Maximum consecutive losses
  if (account.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    blocks.push('max_consecutive_losses_hit');
  }

  // 5. Maximum concurrent positions
  if (account.openPositionCount >= cfg.maxConcurrentPositions) {
    blocks.push('max_concurrent_positions_hit');
  }

  // 6. Session hard rules
  if (session) {
    if (session.windowLabel === 'closed' || session.windowLabel === 'outside') {
      blocks.push('session_closed');
    }
    if (session.newsBuffer) {
      blocks.push('news_buffer_active');
    }
  }

  // 7. Feed staleness
  if (account.feedFreshnessMs != null && account.feedFreshnessMs > cfg.feedStaleThresholdMs) {
    blocks.push('feed_stale');
  }

  // 8. Stop distance validity
  if (intent.stopPoints <= 0) {
    blocks.push('stop_too_wide'); // zero or negative stop = invalid
  } else if (account.currentAtr != null && account.currentAtr > 0) {
    const stopAtrMultiple = intent.stopPoints / account.currentAtr;
    if (stopAtrMultiple > cfg.maxStopAtrMultiple) {
      blocks.push('stop_too_wide');
    }
  }

  return {
    allowed: blocks.length === 0,
    blockReasons: blocks,
  };
}
