/**
 * optimization.ts — Heuristic optimization engine (Phase 5)
 *
 * Generates actionable suggestions from CampaignMetrics without ML.
 * All thresholds are explicit constants — no learned models.
 * Suggestions are directional, not prescriptive (humans decide).
 */

import type { CampaignMetrics, Campaign, OptimizationResult, OptimizationPriority } from './valueTypes';

// ── Thresholds ─────────────────────────────────────────────────────────────────

const REPLY_RATE_LOW    = 0.03;   // < 3% reply rate → rewrite subjects
const REPLY_RATE_GOOD   = 0.10;   // ≥ 10% reply rate → positive signal
const SUCCESS_RATE_LOW  = 0.85;   // < 85% delivery → check SMTP config
const SPEND_WARN_CENTS  = 5000;   // > $50 spend with no value → ROI risk
const MIN_SAMPLE_SIZE   = 5;      // need at least 5 emails for rate analysis

// ── Main function ──────────────────────────────────────────────────────────────

export function generateOptimization(
  campaign: Campaign,
  metrics: CampaignMetrics,
): OptimizationResult {
  const actions: string[] = [];
  const reasons: string[] = [];

  // Email delivery rate warning
  if (
    metrics.successRate != null &&
    metrics.successRate < SUCCESS_RATE_LOW &&
    metrics.emailsSent + metrics.emailsFailed >= MIN_SAMPLE_SIZE
  ) {
    const pct = Math.round(metrics.successRate * 100);
    actions.push(`Delivery rate is ${pct}% — review SMTP configuration and recipient list quality`);
    reasons.push('low delivery rate');
  }

  // Reply rate analysis (requires sufficient sample)
  if (metrics.replyRate != null && metrics.emailsSent >= MIN_SAMPLE_SIZE) {
    if (metrics.replyRate < REPLY_RATE_LOW) {
      const pct = (metrics.replyRate * 100).toFixed(1);
      actions.push(`Reply rate is ${pct}% — rewrite subject lines and opening sentences for clarity`);
      actions.push('Test shorter email bodies (3–5 sentences) against current version');
      reasons.push('reply rate below 3%');
    } else if (metrics.replyRate >= REPLY_RATE_GOOD) {
      actions.push('Reply rate is strong — consider scaling outreach volume or duplicating this approach for similar segments');
      reasons.push('high reply rate signal');
    }
  }

  // Spend without value recorded
  if (metrics.spendCents > SPEND_WARN_CENTS && metrics.valueRecordedCents === 0) {
    const spendStr = `$${(metrics.spendCents / 100).toFixed(0)}`;
    actions.push(`${spendStr} spent with no value recorded — record any conversions or revenue via "Record Value"`);
    reasons.push('spend without recorded value');
  }

  // Positive ROI — amplify signal
  if (metrics.roi != null && metrics.roi > 0.5) {
    const roiPct = Math.round(metrics.roi * 100);
    actions.push(`${roiPct}% ROI detected — document what worked and replicate across similar campaigns`);
    reasons.push('strong ROI');
  }

  // Negative ROI — reduce exposure
  if (metrics.roi != null && metrics.roi < -0.2) {
    actions.push('Negative ROI — pause new spend and review targeting, messaging, or audience fit before continuing');
    reasons.push('negative ROI');
  }

  // No activity after creation
  if (
    metrics.emailsSent === 0 &&
    metrics.postsPublished === 0 &&
    campaign.status === 'active'
  ) {
    actions.push('No real actions recorded yet — create and run tasks linked to this campaign to begin tracking outcomes');
    reasons.push('no activity');
  }

  // Goal progress — if goals set
  if (campaign.goalMetrics?.targetEmailsSent && metrics.emailsSent > 0) {
    const pct = Math.round((metrics.emailsSent / campaign.goalMetrics.targetEmailsSent) * 100);
    if (pct >= 100) {
      actions.push(`Email goal reached (${metrics.emailsSent}/${campaign.goalMetrics.targetEmailsSent}) — update goal or mark campaign complete`);
    } else if (pct >= 75) {
      actions.push(`${pct}% toward email goal — maintain current pace to hit target`);
    }
  }

  // Determine priority
  const priority = _computePriority(metrics, reasons);

  return {
    campaignId: campaign.id,
    suggestedActions: actions.length > 0
      ? actions
      : ['Campaign is progressing normally — continue current approach and review again after more data accumulates'],
    priority,
    reasoning: reasons.length > 0
      ? reasons.join(', ')
      : 'no critical signals detected',
    generatedAt: Date.now(),
  };
}

function _computePriority(metrics: CampaignMetrics, reasons: string[]): OptimizationPriority {
  const critical = reasons.some(r =>
    r.includes('negative ROI') ||
    r.includes('low delivery rate')
  );
  if (critical) return 'high';

  const medium = reasons.some(r =>
    r.includes('below 3%') ||
    r.includes('spend without')
  );
  if (medium) return 'medium';

  return 'low';
}
