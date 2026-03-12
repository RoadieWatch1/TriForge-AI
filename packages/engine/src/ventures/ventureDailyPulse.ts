// ── ventureDailyPulse.ts — Daily operational summary for active ventures ──────
//
// Generates a daily pulse snapshot showing what was posted, market changes,
// performance metrics, council recommendations, and next actions.

import type { VentureProposal, VentureOption, DailyPulse } from './ventureTypes';

interface PulseProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

interface PulseMetrics {
  subscriberCount?: number;
  trafficSources?: Array<{ channel: string; visits: number }>;
  postsPublished?: number;
  engagementRate?: number;
  revenue?: number;
  leadsCollected?: number;
}

/**
 * Generate a daily pulse for an active venture.
 * AI-assisted with deterministic fallback.
 */
export async function generateDailyPulse(
  proposal: VentureProposal,
  metrics: PulseMetrics,
  provider?: PulseProvider,
): Promise<DailyPulse> {
  const option = proposal.winner;
  if (provider) {
    try {
      return await aiPulse(option, metrics, provider);
    } catch {
      // Fall through to deterministic
    }
  }
  return deterministicPulse(option, metrics);
}

/**
 * Format a daily pulse for phone notification.
 */
export function formatPulseForPhone(pulse: DailyPulse, conceptName: string): string {
  const lines: string[] = [
    `DAILY PULSE — ${conceptName}`,
    '',
    `Posted: ${pulse.whatWasPosted || 'Nothing today'}`,
    `Market: ${pulse.marketChanges || 'No notable changes'}`,
    `Performance: ${pulse.performance || 'No data yet'}`,
    '',
    `Council says: ${pulse.councilRecommendation}`,
    '',
    'Next actions:',
    ...pulse.nextActions.map((a, i) => `${i + 1}. ${a}`),
  ];
  return lines.join('\n');
}

// ── AI-assisted pulse ────────────────────────────────────────────────────────

async function aiPulse(
  option: VentureOption,
  metrics: PulseMetrics,
  provider: PulseProvider,
): Promise<DailyPulse> {
  const prompt = `You are a venture operations analyst. Generate a daily pulse summary.

Venture: ${option.candidate.concept}
Category: ${option.candidate.category}
Subscribers: ${metrics.subscriberCount ?? 0}
Posts published: ${metrics.postsPublished ?? 0}
Engagement rate: ${metrics.engagementRate ?? 0}%
Revenue: $${metrics.revenue ?? 0}
Leads: ${metrics.leadsCollected ?? 0}

Return a JSON object:
{
  "whatWasPosted": "summary of content published",
  "marketChanges": "notable market/competitor changes",
  "performance": "performance summary",
  "councilRecommendation": "strategic recommendation",
  "nextActions": ["action 1", "action 2", "action 3"]
}

Return ONLY valid JSON.`;

  const response = await provider.chat([
    { role: 'system', content: 'You are a venture operations analyst. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ]);

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  return {
    whatWasPosted: String(parsed.whatWasPosted ?? ''),
    marketChanges: String(parsed.marketChanges ?? 'No notable changes'),
    performance: String(parsed.performance ?? 'No data yet'),
    councilRecommendation: String(parsed.councilRecommendation ?? 'Continue current strategy'),
    nextActions: asStringArray(parsed.nextActions) ?? deterministicNextActions(option),
  };
}

// ── Deterministic pulse ──────────────────────────────────────────────────────

function deterministicPulse(
  option: VentureOption,
  metrics: PulseMetrics,
): DailyPulse {
  const subs = metrics.subscriberCount ?? 0;
  const posts = metrics.postsPublished ?? 0;

  return {
    whatWasPosted: posts > 0 ? `${posts} piece(s) of content published today.` : 'No content published today.',
    marketChanges: 'No notable market changes detected.',
    performance: subs > 0
      ? `${subs} subscribers, ${metrics.leadsCollected ?? 0} leads, $${metrics.revenue ?? 0} revenue.`
      : 'No metrics available yet — venture is in early stage.',
    councilRecommendation: subs < 50
      ? 'Focus on consistent daily content and audience capture. Growth compounds after the first 50 subscribers.'
      : subs < 250
        ? 'Good traction. Introduce lead magnet and optimize conversion rate.'
        : 'Strong audience base. Consider monetization experiments and paid amplification.',
    nextActions: deterministicNextActions(option),
  };
}

function deterministicNextActions(option: VentureOption): string[] {
  const actions: string[] = [];

  const category = option.candidate.category;

  if (['content_brand', 'newsletter', 'faceless_media'].includes(category)) {
    actions.push('Publish daily content piece on primary channel');
    actions.push('Engage with 10 relevant accounts in target niche');
    actions.push('Review signup page conversion rate');
  } else if (['saas_micro', 'digital_product'].includes(category)) {
    actions.push('Share product update or use-case post');
    actions.push('Respond to user feedback and support requests');
    actions.push('Test one new traffic source');
  } else if (category === 'ecommerce_dropship') {
    actions.push('Check inventory levels and supplier status');
    actions.push('Publish product-focused content');
    actions.push('Review ad performance and adjust bids');
  } else {
    actions.push('Create and publish one piece of content');
    actions.push('Engage with target audience on primary channel');
    actions.push('Review analytics and adjust strategy as needed');
  }

  return actions;
}

function asStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  const filtered = val.filter((v): v is string => typeof v === 'string');
  return filtered.length > 0 ? filtered : null;
}
