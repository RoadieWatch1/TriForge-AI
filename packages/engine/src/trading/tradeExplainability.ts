/**
 * Phase 7: Trade Explainability — pure deterministic functions.
 *
 * All functions are pure (no I/O, no AI-generated text).
 * They produce structured explanations from structured data.
 */

import type {
  CouncilVote, SetupGrade, CouncilAgreementLabel, ConfidenceLabel,
  TradeDecisionExplanation, BlockedTradeExplanation,
  CouncilSummary, RuleSummary,
  GradeBucketSummary, CouncilValueAdded,
  ShadowDecisionEvent, ShadowDecisionStage,
  SessionLabel, VwapRelation, BarTrend, VolatilityRegime,
} from './types';

// ── Input types ────────────────────────────────────────────────────────────────

export interface SetupGradeInput {
  councilVotes: CouncilVote[];
  councilApproved: boolean;
  warningCount: number;
  violationCount: number;
  strengthCount: number;
  sessionLabel?: SessionLabel;
  vwapRelation?: VwapRelation;
  trend5m?: BarTrend;
  trend15m?: BarTrend;
  side: 'long' | 'short';
  volatilityRegime?: VolatilityRegime;
}

export interface ExplanationInput extends SetupGradeInput {
  strengths?: string[];
  warnings?: string[];
  violations?: string[];
  stopPrice?: number;
  invalidationRule?: string;
  trendAligned: boolean;
  supportiveVwap: boolean;
  avgCouncilConfidence: number;
  agreementLabel: CouncilAgreementLabel;
  setupGrade: SetupGrade;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FAVORABLE_SESSIONS: SessionLabel[] = ['opening', 'midmorning', 'afternoon'];

// ── Core functions ─────────────────────────────────────────────────────────────

/**
 * Compute setup grade (A/B/C/D) from structured trade context.
 * D = not approved OR violations > 0.
 * A = strong agreement, high confidence, favorable context.
 * B = approved, good agreement + confidence.
 * C = approved, marginal.
 * D = everything else.
 */
export function computeSetupGrade(input: SetupGradeInput): SetupGrade {
  const {
    councilVotes, councilApproved, warningCount, violationCount,
    strengthCount, sessionLabel, vwapRelation, trend5m, trend15m,
    side, volatilityRegime: _vol,
  } = input;

  // D: not approved or violations
  if (!councilApproved || violationCount > 0) return 'D';

  const takeCount = councilVotes.filter(v => v.vote === 'TAKE').length;
  const avgConf = councilVotes.length > 0
    ? councilVotes.reduce((s, v) => s + v.confidence, 0) / councilVotes.length
    : 0;

  const favorable = sessionLabel ? FAVORABLE_SESSIONS.includes(sessionLabel) : false;
  const supportiveVwap = side === 'long'
    ? (vwapRelation === 'above' || vwapRelation === 'at')
    : (vwapRelation === 'below' || vwapRelation === 'at');
  const trendAligned = side === 'long'
    ? (trend5m === 'up' || trend15m === 'up')
    : (trend5m === 'down' || trend15m === 'down');

  // A: all TAKE, high confidence, low warnings, favorable context, trend aligned
  if (
    takeCount === councilVotes.length && councilVotes.length > 0 &&
    avgConf >= 70 && warningCount <= 1 &&
    (favorable || supportiveVwap) && trendAligned
  ) {
    return 'A';
  }

  // B: >= 2 TAKE, decent confidence, limited warnings
  if (takeCount >= 2 && avgConf >= 55 && warningCount <= 2) {
    return 'B';
  }

  // C: approved, marginal confidence or limited warnings
  if (avgConf >= 40 || warningCount <= 3) {
    return 'C';
  }

  return 'D';
}

/**
 * Discrete 3-seat agreement label.
 * 3 TAKE → strong, 2 TAKE → mixed, anything else → weak.
 */
export function computeAgreementLabel(votes: CouncilVote[]): CouncilAgreementLabel {
  const takeCount = votes.filter(v => v.vote === 'TAKE').length;
  if (takeCount >= 3) return 'strong';
  if (takeCount === 2) return 'mixed';
  return 'weak';
}

/**
 * Typed confidence label from numeric average.
 */
function toConfidenceLabel(avg: number): ConfidenceLabel {
  if (avg >= 70) return 'high';
  if (avg >= 50) return 'medium';
  return 'low';
}

/**
 * Build a complete trade decision explanation from structured input.
 * All text is deterministic — not AI-generated.
 */
export function buildTradeDecisionExplanation(input: ExplanationInput): TradeDecisionExplanation {
  const {
    councilVotes, councilApproved, strengthCount, warningCount,
    strengths, warnings, violations,
    side, stopPrice, invalidationRule,
    sessionLabel, vwapRelation, trend5m, trend15m, volatilityRegime,
    trendAligned, supportiveVwap, avgCouncilConfidence, agreementLabel,
    setupGrade,
  } = input;

  const confidenceLabel = toConfidenceLabel(avgCouncilConfidence);

  // whyNow — reasons this setup qualified now
  const whyNow: string[] = [];
  if (sessionLabel && FAVORABLE_SESSIONS.includes(sessionLabel)) {
    whyNow.push(`Favorable session: ${sessionLabel}`);
  }
  if (trendAligned) {
    const trendDir = side === 'long' ? 'up' : 'down';
    whyNow.push(`Trend aligned (${trendDir}) on ${trend5m === trendDir ? '5m' : '15m'} timeframe`);
  }
  if (supportiveVwap && vwapRelation) {
    whyNow.push(`Price ${vwapRelation} VWAP — supportive for ${side}`);
  }
  if (strengthCount > 0) {
    whyNow.push(`${strengthCount} rule-engine strength(s) met`);
  }
  if (avgCouncilConfidence >= 70) {
    whyNow.push(`Council confidence ${avgCouncilConfidence.toFixed(0)}% — high agreement`);
  } else if (avgCouncilConfidence >= 50) {
    whyNow.push(`Council confidence ${avgCouncilConfidence.toFixed(0)}%`);
  }
  if (whyNow.length === 0) {
    whyNow.push('Setup met minimum qualifying criteria');
  }

  // keyRisks — cautions
  const keyRisks: string[] = [];
  if (warningCount > 0) {
    keyRisks.push(`${warningCount} rule-engine warning(s)`);
  }
  if (volatilityRegime === 'high') {
    keyRisks.push(`Elevated volatility regime: ${volatilityRegime}`);
  }
  if (sessionLabel && !FAVORABLE_SESSIONS.includes(sessionLabel)) {
    keyRisks.push(`Session (${sessionLabel}) is not a historically favorable window`);
  }
  if (agreementLabel === 'mixed') {
    keyRisks.push('Council agreement is mixed — not all seats aligned');
  } else if (agreementLabel === 'weak') {
    keyRisks.push('Council agreement is weak — majority did not vote TAKE');
  }

  // invalidationTriggers
  const invalidationTriggers: string[] = [];
  if (stopPrice !== undefined) {
    invalidationTriggers.push(`Stop at ${stopPrice}`);
  }
  if (invalidationRule) {
    invalidationTriggers.push(invalidationRule);
  }
  const counterTrend = side === 'long' ? 'down' : 'up';
  invalidationTriggers.push(`Trend shift to ${counterTrend} on both 5m and 15m`);

  // councilSummary
  const councilSummary: CouncilSummary = {
    approved: councilApproved,
    avgConfidence: avgCouncilConfidence,
    agreementLabel,
    providerReasons: councilVotes.map(v => ({
      provider: v.provider,
      vote: v.vote,
      confidence: v.confidence,
      reason: v.reason,
    })),
  };

  // ruleSummary
  const ruleSummary: RuleSummary = {
    strengths: strengths ?? [],
    warnings: warnings ?? [],
    violations: violations ?? [],
  };

  // trustNote — deterministic from grade + agreement
  let trustNote: string;
  switch (setupGrade) {
    case 'A':
      trustNote = 'Meets all advisory criteria under current rules.';
      break;
    case 'B':
      trustNote = 'Approved with minor caveats.';
      break;
    case 'C':
      trustNote = 'Mixed signals — exercise additional discretion.';
      break;
    case 'D':
    default:
      trustNote = 'Marginal — advisory confidence is limited.';
      break;
  }

  return {
    setupGrade,
    confidenceLabel,
    whyNow,
    keyRisks,
    invalidationTriggers,
    councilSummary,
    ruleSummary,
    trustNote,
  };
}

/**
 * Build a blocked trade explanation from a ShadowDecisionEvent.
 * Reuses computeSetupGrade when structured context exists on the event.
 * Omits grade when context is incomplete (e.g. setup_detection events
 * that never reached rules/council).
 */
export function buildBlockedTradeExplanation(event: ShadowDecisionEvent): BlockedTradeExplanation {
  // Attempt to compute grade if we have enough context
  let setupGrade: SetupGrade | undefined;
  if (
    event.councilVotes && event.councilVotes.length > 0 &&
    event.side && event.warningCount !== undefined && event.violationCount !== undefined
  ) {
    setupGrade = computeSetupGrade({
      councilVotes: event.councilVotes,
      councilApproved: event.councilApproved ?? false,
      warningCount: event.warningCount,
      violationCount: event.violationCount,
      strengthCount: event.strengthCount ?? 0,
      sessionLabel: event.sessionLabel,
      vwapRelation: event.vwapRelation,
      trend5m: event.trend5m,
      trend15m: event.trend15m,
      side: event.side,
      volatilityRegime: event.volatilityRegime,
    });
  }

  // Trust note by stage
  const trustNote = buildBlockedTrustNote(event.stage);

  return {
    timestamp: event.timestamp,
    symbol: event.symbol,
    blockStage: event.stage,
    blockReason: event.blockReason ?? 'unknown',
    blockMessage: event.blockMessage ?? '',
    setupGrade,
    trustNote,
  };
}

function buildBlockedTrustNote(stage: ShadowDecisionStage): string {
  switch (stage) {
    case 'council_review':
      return 'Council did not approve. No trade is the correct action here.';
    case 'rule_engine':
      return 'Rule engine flagged conditions. Skipping preserves discipline.';
    case 'setup_detection':
      return 'No qualifying setup. Waiting is part of the process.';
    case 'limits_check':
    case 'feed_check':
      return 'Operational constraint. System functioning as designed.';
    default:
      return 'Trade not taken. Discipline preserved.';
  }
}

// ── Analytics functions ────────────────────────────────────────────────────────

/**
 * Bucket closed trades by setup grade (A/B/C/D).
 * Computes grade on the fly from event fields.
 */
export function computeGradeSummary(events: ShadowDecisionEvent[]): GradeBucketSummary[] {
  const closed = events.filter(e => e.stage === 'trade_closed');

  const buckets = new Map<SetupGrade, { trades: number; wins: number; totalPnlR: number; totalPnlDollars: number }>();
  const grades: SetupGrade[] = ['A', 'B', 'C', 'D'];
  for (const g of grades) {
    buckets.set(g, { trades: 0, wins: 0, totalPnlR: 0, totalPnlDollars: 0 });
  }

  for (const e of closed) {
    // Use stored grade if available, otherwise compute
    let grade: SetupGrade = e.setupGrade ?? 'D';
    if (!e.setupGrade && e.councilVotes && e.side) {
      grade = computeSetupGrade({
        councilVotes: e.councilVotes,
        councilApproved: e.councilApproved ?? true,
        warningCount: e.warningCount ?? 0,
        violationCount: e.violationCount ?? 0,
        strengthCount: e.strengthCount ?? 0,
        sessionLabel: e.sessionLabel,
        vwapRelation: e.vwapRelation,
        trend5m: e.trend5m,
        trend15m: e.trend15m,
        side: e.side,
        volatilityRegime: e.volatilityRegime,
      });
    }

    const bucket = buckets.get(grade)!;
    bucket.trades++;
    if ((e.pnlR ?? 0) > 0) bucket.wins++;
    bucket.totalPnlR += e.pnlR ?? 0;
    bucket.totalPnlDollars += e.pnl ?? 0;
  }

  return grades
    .map(g => {
      const b = buckets.get(g)!;
      return {
        grade: g,
        trades: b.trades,
        winRate: b.trades > 0 ? b.wins / b.trades : 0,
        avgPnlR: b.trades > 0 ? b.totalPnlR / b.trades : 0,
        totalPnlDollars: b.totalPnlDollars,
      };
    })
    .filter(b => b.trades > 0);
}

/**
 * Compute council value-added statistics.
 * blockedExpectancyR is always null — outcome of blocked trades is unknowable.
 */
export function computeCouncilValueAdded(events: ShadowDecisionEvent[]): CouncilValueAdded {
  // Rules-qualified: events that reached council_review or became trades
  const rulesQualified = events.filter(e =>
    e.stage === 'council_review' || e.stage === 'trade_opened' || e.stage === 'trade_closed'
  );

  // Council blocked: council_review events where council rejected
  const councilBlocked = events.filter(e =>
    e.stage === 'council_review' && e.councilApproved === false
  );

  // Closed trades for expectancy
  const closed = events.filter(e => e.stage === 'trade_closed');
  const approvedExpectancyR = closed.length > 0
    ? closed.reduce((sum, e) => sum + (e.pnlR ?? 0), 0) / closed.length
    : 0;

  const rulesQualifiedCount = rulesQualified.length;
  const councilBlockedCount = councilBlocked.length;
  const councilApprovedCount = rulesQualifiedCount - councilBlockedCount;
  const councilBlockRate = rulesQualifiedCount > 0
    ? councilBlockedCount / rulesQualifiedCount
    : 0;

  // Advisory text
  let advisory: string;
  if (rulesQualifiedCount < 5) {
    advisory = 'Insufficient data — need more rule-qualified evaluations.';
  } else if (councilBlockRate >= 0.5) {
    advisory = 'Council is blocking a significant portion of rule-qualified setups. Review strategy alignment.';
  } else if (councilBlockRate >= 0.3) {
    advisory = 'Council provides moderate filtering. Blocked trade outcomes are unknown — they were not taken.';
  } else if (councilBlockRate >= 0.1) {
    advisory = 'Council serves as a selective filter. Most rule-qualified setups are approved.';
  } else {
    advisory = 'Council rarely blocks. Consider whether additional filtering criteria are needed.';
  }

  return {
    rulesQualifiedCount,
    councilApprovedCount,
    councilBlockedCount,
    approvedExpectancyR,
    blockedExpectancyR: null,
    councilBlockRate,
    advisory,
  };
}
