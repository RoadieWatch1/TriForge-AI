/**
 * roi.ts — Campaign metrics aggregation from real MetricsEvents (Phase 5)
 *
 * computeCampaignMetrics() is pure — takes events and returns CampaignMetrics.
 * ROI is only calculated when valueRecordedCents > 0 and spendCents > 0.
 * All values come from recorded events, never fabricated.
 */

import type { MetricsEvent, CampaignMetrics } from './valueTypes';

export function computeCampaignMetrics(
  campaignId: string,
  events: MetricsEvent[],
): CampaignMetrics {
  let emailsSent = 0;
  let emailsFailed = 0;
  let repliesReceived = 0;
  let postsPublished = 0;
  let positiveReplies = 0;
  let spendCents = 0;
  let valueRecordedCents = 0;
  let lastUpdatedAt = 0;

  for (const ev of events) {
    if (ev.timestamp > lastUpdatedAt) lastUpdatedAt = ev.timestamp;

    switch (ev.type) {
      case 'EMAIL_SENT':
        if (!ev.paperMode) emailsSent++;
        break;

      case 'EMAIL_FAILED':
        emailsFailed++;
        break;

      case 'REPLY_RECEIVED':
        repliesReceived++;
        if (ev.sentiment === 'positive') positiveReplies++;
        break;

      case 'POST_PUBLISHED':
        if (!ev.paperMode) postsPublished++;
        break;

      case 'SPEND_COMMITTED':
        spendCents += ev.amountCents;
        break;

      case 'VALUE_RECORDED':
        valueRecordedCents += ev.amountCents;
        break;
    }
  }

  // Leads = positive reply signals (best proxy without CRM integration)
  const leadsGenerated = positiveReplies;

  // Reply rate = replies / emails sent (null if no emails sent)
  const replyRate = emailsSent > 0
    ? repliesReceived / emailsSent
    : null;

  // Success rate = emails sent / (sent + failed) — null if none attempted
  const totalAttempted = emailsSent + emailsFailed;
  const successRate = totalAttempted > 0
    ? emailsSent / totalAttempted
    : null;

  // ROI = (value - spend) / spend — null if no spend
  const roi = spendCents > 0 && valueRecordedCents > 0
    ? (valueRecordedCents - spendCents) / spendCents
    : null;

  return {
    campaignId,
    emailsSent,
    emailsFailed,
    repliesReceived,
    postsPublished,
    leadsGenerated,
    spendCents,
    valueRecordedCents,
    roi,
    replyRate,
    successRate,
    lastUpdatedAt: lastUpdatedAt || Date.now(),
  };
}

/**
 * Aggregate metrics across multiple campaigns.
 * Returns a synthetic metrics object with campaignId='*'.
 */
export function aggregateMetrics(metricsList: CampaignMetrics[]): CampaignMetrics {
  const agg: CampaignMetrics = {
    campaignId: '*',
    emailsSent: 0,
    emailsFailed: 0,
    repliesReceived: 0,
    postsPublished: 0,
    leadsGenerated: 0,
    spendCents: 0,
    valueRecordedCents: 0,
    roi: null,
    replyRate: null,
    successRate: null,
    lastUpdatedAt: 0,
  };

  for (const m of metricsList) {
    agg.emailsSent += m.emailsSent;
    agg.emailsFailed += m.emailsFailed;
    agg.repliesReceived += m.repliesReceived;
    agg.postsPublished += m.postsPublished;
    agg.leadsGenerated += m.leadsGenerated;
    agg.spendCents += m.spendCents;
    agg.valueRecordedCents += m.valueRecordedCents;
    if (m.lastUpdatedAt > agg.lastUpdatedAt) agg.lastUpdatedAt = m.lastUpdatedAt;
  }

  // Recalculate derived fields from aggregated totals
  const totalAttempted = agg.emailsSent + agg.emailsFailed;
  agg.replyRate = agg.emailsSent > 0 ? agg.repliesReceived / agg.emailsSent : null;
  agg.successRate = totalAttempted > 0 ? agg.emailsSent / totalAttempted : null;
  agg.roi = agg.spendCents > 0 && agg.valueRecordedCents > 0
    ? (agg.valueRecordedCents - agg.spendCents) / agg.spendCents
    : null;

  return agg;
}
