// ── main/trading/reliability/ReliabilityGovernor.ts ──────────────────────────
//
// Centralized risk + reliability gate.
//
// Wraps existing RiskModel.validateRisk() and adds 5 new checks:
//   1. Reliability band gate (band === 'blocked' → refuse)
//   2. Stale signal accumulation (last 3 approved intents all expired → block)
//   3. Feed instability (feed stale > 3 times in last 5 min → block)
//   4. Council disagreement (>= 50% of seats REJECT/WAIT → block)
//   5. Slippage cooldown (recent exit > 0.5% from expected → 120s cooldown)
//
// Returns structured GovernorBlock categories (risk, reliability, freshness,
// regime, feed, consensus) with explanations — never flat string lists.

import type { TradeIntent, SessionContext } from '@triforge/engine';
import { validateRisk, type AccountState, type RiskSettings } from '../decision/RiskModel';
import type { SignalReliabilityScore } from './ReliabilityScorer';
import type { ReviewedIntent } from '../shadow/TriForgeShadowSimulator';

// ── Types ──────────────────────────────────────────────────────────────────────

export type GovernorBlockCategory =
  | 'risk'
  | 'reliability'
  | 'freshness'
  | 'regime'
  | 'feed'
  | 'consensus';

export interface GovernorBlock {
  /** Category for UI grouping. */
  category: GovernorBlockCategory;
  /** Machine-readable block code. */
  code: string;
  /** Human-readable explanation. */
  explanation: string;
}

export interface GovernorResult {
  /** Whether the trade is allowed to proceed. */
  allowed: boolean;
  /** Structured blocks with category + explanation. */
  blocks: GovernorBlock[];
}

// ── Risk reason → explanation mapping ──────────────────────────────────────

const RISK_EXPLANATIONS: Record<string, string> = {
  insufficient_rr: 'Risk-reward ratio below minimum threshold',
  max_daily_loss_hit: 'Daily loss limit reached — no more trades today',
  max_trades_hit: 'Maximum trades per session reached',
  max_consecutive_losses_hit: 'Too many consecutive losses — cooling off',
  max_concurrent_positions_hit: 'Maximum concurrent positions already open',
  session_closed: 'Trading session is closed',
  news_buffer_active: 'News embargo is active — blocking new entries',
  feed_stale: 'Market data feed is stale',
  stop_too_wide: 'Stop distance is invalid or too wide',
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SLIPPAGE_COOLDOWN_MS = 120_000; // 2 minutes
const SLIPPAGE_THRESHOLD_PCT = 0.005; // 0.5%

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Validate a trade intent through both risk model and reliability gates.
 *
 * @param intent            - The trade intent to validate.
 * @param account           - Current account state.
 * @param reliability       - Signal reliability score (null = skip reliability checks).
 * @param recentReviewed    - Recent reviewed intents for stale accumulation check.
 * @param feedStaleCount5min - Number of feed stale events in last 5 minutes.
 * @param lastClosedTrade   - Last closed trade for slippage cooldown check (null = skip).
 * @param riskSettings      - Risk settings overrides (optional).
 * @param session           - Session context (optional).
 */
export function validateWithGovernor(
  intent: TradeIntent,
  account: AccountState,
  reliability: SignalReliabilityScore | null,
  recentReviewed: ReviewedIntent[],
  feedStaleCount5min: number,
  lastClosedTrade: {
    exitPrice: number;
    stopPrice: number;
    targetPrice: number;
    closedAt: number;
  } | null,
  riskSettings?: Partial<RiskSettings>,
  session?: SessionContext | null,
): GovernorResult {
  const blocks: GovernorBlock[] = [];

  // ── 1. Existing RiskModel checks → mapped to 'risk' category ──────────
  const riskResult = validateRisk(intent, account, riskSettings, session);
  if (!riskResult.allowed) {
    for (const reason of riskResult.blockReasons) {
      blocks.push({
        category: 'risk',
        code: reason,
        explanation: RISK_EXPLANATIONS[reason] ?? `Risk check failed: ${reason}`,
      });
    }
  }

  // ── 2. Reliability band gate ──────────────────────────────────────────
  if (reliability) {
    if (reliability.band === 'blocked') {
      blocks.push({
        category: 'reliability',
        code: 'reliability_blocked',
        explanation: reliability.explanation || 'Signal reliability is too low to trade',
      });
    }

    // ── 3. Expired / stale signal accumulation ──────────────────────────
    if (reliability.expired) {
      blocks.push({
        category: 'freshness',
        code: 'signal_expired',
        explanation: 'Signal has expired — waiting for fresh confirmation',
      });
    }
  }

  // Check if last 3 approved intents all expired (stale accumulation)
  const recentApproved = recentReviewed
    .filter(r => r.outcome === 'approved')
    .slice(0, 3);
  if (recentApproved.length >= 3) {
    const allStale = recentApproved.every(r => {
      const age = Date.now() - r.reviewedAt;
      return age > 300_000; // 5 min = considered stale
    });
    if (allStale) {
      blocks.push({
        category: 'freshness',
        code: 'stale_accumulation',
        explanation: 'Last 3 approved signals all expired — engine may be chasing',
      });
    }
  }

  // ── 4. Feed instability ───────────────────────────────────────────────
  if (feedStaleCount5min >= 3) {
    blocks.push({
      category: 'feed',
      code: 'feed_instability',
      explanation: `Feed went stale ${feedStaleCount5min} times in last 5 min — data unreliable`,
    });
  }

  // ── 5. Council disagreement ───────────────────────────────────────────
  // Check most recent review for high disagreement
  const lastReview = recentReviewed[0];
  if (lastReview?.councilResult?.votes && lastReview.councilResult.votes.length > 0) {
    const votes = lastReview.councilResult.votes;
    const nonTake = votes.filter(v => v.vote === 'REJECT' || v.vote === 'WAIT').length;
    if (nonTake / votes.length >= 0.5) {
      blocks.push({
        category: 'consensus',
        code: 'council_disagreement',
        explanation: `${nonTake}/${votes.length} council seats did not vote TAKE`,
      });
    }
  }

  // ── 6. Slippage cooldown ──────────────────────────────────────────────
  if (lastClosedTrade) {
    const timeSinceClose = Date.now() - lastClosedTrade.closedAt;
    if (timeSinceClose < SLIPPAGE_COOLDOWN_MS) {
      const exitPrice = lastClosedTrade.exitPrice;
      const expectedExit = exitPrice >= lastClosedTrade.targetPrice
        ? lastClosedTrade.targetPrice
        : lastClosedTrade.stopPrice;
      const slippage = Math.abs(exitPrice - expectedExit) / expectedExit;
      if (slippage > SLIPPAGE_THRESHOLD_PCT) {
        const remainingSec = Math.ceil((SLIPPAGE_COOLDOWN_MS - timeSinceClose) / 1000);
        blocks.push({
          category: 'risk',
          code: 'slippage_cooldown',
          explanation: `Recent trade slipped ${(slippage * 100).toFixed(2)}% — ${remainingSec}s cooldown remaining`,
        });
      }
    }
  }

  return {
    allowed: blocks.length === 0,
    blocks,
  };
}
