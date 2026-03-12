// ── ventureProposalFormatter.ts — Format proposals for phone + desktop ───────
//
// Phone: compact text for push notification / SMS-style display.
// Desktop: structured view object for the VentureDiscovery UI.

import type { VentureProposal, VentureProposalView, VentureOption } from './ventureTypes';

// ── Phone format ─────────────────────────────────────────────────────────────

/**
 * Format a proposal as a compact text block for phone notifications.
 * Includes winner details, alternatives, budget, filing recommendation,
 * and reply options.
 */
export function formatForPhone(proposal: VentureProposal): string {
  const w = proposal.winner;
  const s = proposal.safer;
  const a = proposal.aggressive;
  const t = proposal.treasuryAllocation;

  const lines: string[] = [
    'COUNCIL VENTURE PROPOSAL',
    '',
    `WINNER: ${w.launchPack.brandName}`,
    `Category: ${w.candidate.category.replace(/_/g, ' ')}`,
    `Concept: ${w.candidate.concept}`,
    `Budget: $${t.launchSetup + t.tools + t.adPromoRunway} of $${t.totalBudget}`,
    `Why now: ${truncate(w.whyNow, 120)}`,
    `Website: ${w.websiteStrategy.siteType.replace(/_/g, ' ')} + ${w.audienceStrategy.captureMethod.replace(/_/g, ' ')}`,
    `CTA: ${w.websiteStrategy.primaryCTA}`,
    `Audience goal: first ${w.launchPack.followerGrowthPlan.first30DayTarget} subscribers`,
    `Traffic: ${w.trafficPlan.channels.slice(0, 3).join(', ')}`,
    `Filing: ${w.filingRecommendation === 'file_now' ? 'FILE NOW' : w.filingRecommendation === 'wait' ? 'WAIT' : 'NOT NEEDED YET'}`,
    `Why filing ${w.canOperateBeforeFiling ? 'can wait' : 'is needed'}: ${truncate(w.filingReason, 100)}`,
    `Confidence: ${w.confidenceScore}% | Risk: ${w.startupRisk}`,
    '',
    `SAFER: ${s.launchPack.brandName} (${s.candidate.category.replace(/_/g, ' ')})`,
    `AGGRESSIVE: ${a.launchPack.brandName} (${a.candidate.category.replace(/_/g, ' ')})`,
    '',
    'Reply:',
    'APPROVE | ALTERNATIVE | HOLD | PLAN ONLY',
    'FILING: YES FILE NOW | NO WAIT | ASK AGAIN LATER',
  ];

  return lines.join('\n');
}

// ── Desktop format ───────────────────────────────────────────────────────────

/**
 * Format a proposal for the desktop UI as a structured view object.
 * Includes summaries, budget breakdown, and filing text.
 */
export function formatForDesktop(proposal: VentureProposal): VentureProposalView {
  const t = proposal.treasuryAllocation;
  const totalAllocated = t.launchSetup + t.tools + t.adPromoRunway + t.reserve;

  return {
    proposal,
    winnerSummary: buildOptionSummary(proposal.winner, 'Winner'),
    saferSummary: buildOptionSummary(proposal.safer, 'Safer Alternative'),
    aggressiveSummary: buildOptionSummary(proposal.aggressive, 'Aggressive Alternative'),
    budgetBreakdown: [
      { label: 'Launch Setup', amount: t.launchSetup, percent: pct(t.launchSetup, totalAllocated) },
      { label: 'Tools', amount: t.tools, percent: pct(t.tools, totalAllocated) },
      { label: 'Ad/Promo Runway', amount: t.adPromoRunway, percent: pct(t.adPromoRunway, totalAllocated) },
      { label: 'Reserve', amount: t.reserve, percent: pct(t.reserve, totalAllocated) },
    ],
    filingSummaryText: buildFilingSummaryText(proposal),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildOptionSummary(option: VentureOption, label: string): string {
  const lines = [
    `**${label}: ${option.launchPack.brandName}**`,
    `*"${option.launchPack.tagline}"*`,
    '',
    `**Category:** ${option.candidate.category.replace(/_/g, ' ')}`,
    `**Concept:** ${option.candidate.concept}`,
    `**Mode:** ${option.ventureMode.replace(/_/g, ' ')}`,
    `**Confidence:** ${option.confidenceScore}% | **Risk:** ${option.startupRisk}`,
    `**Time to revenue:** ${option.timeToFirstRevenue}`,
    '',
    `**Why now:** ${option.whyNow}`,
    '',
    `**Monetization:** ${option.launchPack.monetizationPath}`,
    `**Target audience:** ${option.launchPack.targetAudience}`,
    `**Primary CTA:** ${option.websiteStrategy.primaryCTA}`,
    `**Traffic channels:** ${option.trafficPlan.channels.join(', ')}`,
    '',
    `**Filing:** ${option.canOperateBeforeFiling ? 'Can operate before filing' : 'Filing recommended before launch'}`,
  ];
  return lines.join('\n');
}

function buildFilingSummaryText(proposal: VentureProposal): string {
  const fs = proposal.filingSummary;
  const w = proposal.winner;

  switch (fs.recommendation) {
    case 'file_now':
      return `Filing is recommended before launch. ${fs.reason} Urgency: ${fs.urgency}.`;
    case 'wait':
      if (w.canOperateBeforeFiling) {
        return `This venture can operate before formal filing. ${fs.reason} You can file later when traction confirms the venture is worth formalizing.`;
      }
      return `Filing can wait. ${fs.reason}`;
    case 'not_needed_yet':
      return `Filing is not needed yet. ${fs.reason} The Council will re-prompt when filing becomes relevant.`;
    default:
      return fs.reason;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function pct(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}
