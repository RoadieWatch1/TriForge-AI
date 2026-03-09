// ── ventureFirst30Days.ts — First 30 days plan generation ────────────────────
//
// Generates a detailed first 30 days operational plan with weekly milestones,
// KPIs, traffic/subscriber targets, monetization milestone, and pivot conditions.

import type {
  VentureOption, LaunchPack, GrowthFunnel, First30DaysPlan,
} from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

interface PlanProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

/**
 * Generate a first 30 days operational plan.
 * AI-assisted with deterministic fallback.
 */
export async function generateFirst30Days(
  option: VentureOption,
  launchPack: LaunchPack,
  funnel: GrowthFunnel,
  provider?: PlanProvider,
): Promise<First30DaysPlan> {
  if (provider) {
    try {
      return await aiGenerate30Days(option, launchPack, funnel, provider);
    } catch {
      // Fall through to deterministic
    }
  }
  return deterministic30Days(option, launchPack, funnel);
}

// ── AI generation ────────────────────────────────────────────────────────────

async function aiGenerate30Days(
  option: VentureOption,
  pack: LaunchPack,
  funnel: GrowthFunnel,
  provider: PlanProvider,
): Promise<First30DaysPlan> {
  const prompt = `You are a venture operations planner. Create a first 30 days plan.

Brand: ${pack.brandName}
Category: ${option.candidate.category.replace(/_/g, ' ')}
Concept: ${option.candidate.concept}
Monetization: ${pack.monetizationPath}
Traffic channels: ${funnel.trafficSources.slice(0, 3).join('; ')}
Capture: ${funnel.capturePoints.slice(0, 2).join('; ')}

Return a JSON object:
{
  "first7DaysActions": ["action 1", "action 2", "action 3", "action 4", "action 5"],
  "first14DaysGoals": ["goal 1", "goal 2", "goal 3"],
  "first30DaysKPIs": ["KPI 1", "KPI 2", "KPI 3"],
  "trafficTargets": "specific number — e.g. 500 unique visitors",
  "subscriberTargets": "specific number — e.g. 250 email subscribers",
  "firstMonetizationMilestone": "specific milestone — e.g. first 3 paying customers",
  "pivotConditions": ["condition 1", "condition 2", "condition 3"]
}

Rules:
- Actions must be specific and actionable (not "create content" — say what content)
- KPIs must be measurable numbers
- Pivot conditions should be clear triggers for when to change approach
- Be realistic for a solo operator with a small budget

Return ONLY valid JSON.`;

  const response = await provider.chat([
    { role: 'system', content: 'You are a venture operations planner. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ]);

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  return {
    first7DaysActions: asStringArray(parsed.first7DaysActions) ?? deterministic30Days(option, pack, funnel).first7DaysActions,
    first14DaysGoals: asStringArray(parsed.first14DaysGoals) ?? deterministic30Days(option, pack, funnel).first14DaysGoals,
    first30DaysKPIs: asStringArray(parsed.first30DaysKPIs) ?? deterministic30Days(option, pack, funnel).first30DaysKPIs,
    trafficTargets: String(parsed.trafficTargets ?? '500 unique visitors'),
    subscriberTargets: String(parsed.subscriberTargets ?? '250 email subscribers'),
    firstMonetizationMilestone: String(parsed.firstMonetizationMilestone ?? 'First paid customer or sponsor'),
    pivotConditions: asStringArray(parsed.pivotConditions) ?? deterministic30Days(option, pack, funnel).pivotConditions,
  };
}

// ── Deterministic fallback ───────────────────────────────────────────────────

function deterministic30Days(
  option: VentureOption,
  pack: LaunchPack,
  funnel: GrowthFunnel,
): First30DaysPlan {
  const cat = getCategoryConfig(option.candidate.category);

  return {
    first7DaysActions: getFirst7Days(option, pack),
    first14DaysGoals: getFirst14DaysGoals(option, pack),
    first30DaysKPIs: getFirst30DaysKPIs(option, pack),
    trafficTargets: getTrafficTarget(option),
    subscriberTargets: getSubscriberTarget(option),
    firstMonetizationMilestone: getMonetizationMilestone(option, pack),
    pivotConditions: getPivotConditions(option),
  };
}

function getFirst7Days(option: VentureOption, pack: LaunchPack): string[] {
  const base = [
    `Day 1: Secure domain and set up ${pack.brandName} website with landing page + email capture`,
    `Day 2: Create lead magnet — ${pack.leadCapturePlan.leadMagnetType}`,
    `Day 3: Set up email platform (e.g. ConvertKit, Mailchimp) with welcome sequence`,
  ];

  switch (option.candidate.category) {
    case 'newsletter':
      return [...base,
        'Day 4: Write and send first newsletter issue',
        'Day 5-7: Post signup CTA on X/Twitter, LinkedIn, Reddit — aim for 50 subscribers',
      ];
    case 'content_brand':
    case 'faceless_media':
      return [...base,
        'Day 4-5: Create first 3 pieces of content (posts, videos, or articles)',
        'Day 6-7: Publish across primary channels, engage in comments and communities',
      ];
    case 'digital_product':
      return [...base,
        'Day 4-5: Create product sales page with clear offer and CTA',
        'Day 6-7: Drive traffic via social posts and Reddit — aim for 20 signups',
      ];
    case 'saas_micro':
      return [...base,
        'Day 4-5: Create demo video or product walkthrough',
        'Day 6-7: Launch waitlist on Product Hunt and Indie Hackers — aim for 100 signups',
      ];
    default:
      return [...base,
        `Day 4-5: Create first content batch for ${pack.firstTrafficChannels[0] ?? 'primary channel'}`,
        'Day 6-7: Start daily posting cadence, engage in target communities',
      ];
  }
}

function getFirst14DaysGoals(option: VentureOption, pack: LaunchPack): string[] {
  const subTarget = option.candidate.category === 'faceless_media' ? 500 : 100;

  return [
    `Reach ${subTarget}+ email subscribers or followers`,
    `Publish 10+ pieces of content across ${pack.firstTrafficChannels.slice(0, 2).join(' and ')}`,
    `Identify top-performing content type and double down on it`,
  ];
}

function getFirst30DaysKPIs(option: VentureOption, pack: LaunchPack): string[] {
  return [
    `Email list size: ${getSubscriberTarget(option)}`,
    `Website traffic: ${getTrafficTarget(option)}`,
    `Email open rate: >30%`,
    `Content published: 20+ pieces`,
    `Revenue: ${getMonetizationMilestone(option, pack)}`,
  ];
}

function getTrafficTarget(option: VentureOption): string {
  switch (option.candidate.category) {
    case 'newsletter':       return '1,000 unique visitors';
    case 'content_brand':    return '2,000 unique visitors';
    case 'faceless_media':   return '5,000 views across platforms';
    case 'saas_micro':       return '500 unique visitors';
    case 'local_lead_gen':   return '300 unique visitors';
    default:                 return '1,000 unique visitors';
  }
}

function getSubscriberTarget(option: VentureOption): string {
  switch (option.candidate.category) {
    case 'newsletter':       return '500 email subscribers';
    case 'content_brand':    return '300 followers + 200 email subscribers';
    case 'faceless_media':   return '1,000 followers + 200 email subscribers';
    case 'saas_micro':       return '200 waitlist signups';
    case 'community_membership': return '100 community members';
    case 'local_lead_gen':   return '50 qualified leads';
    default:                 return '250 email subscribers';
  }
}

function getMonetizationMilestone(option: VentureOption, pack: LaunchPack): string {
  switch (option.candidate.category) {
    case 'newsletter':
      return 'First sponsorship inquiry or 3 paid subscribers';
    case 'digital_product':
      return `First 5 sales of ${pack.firstOffer}`;
    case 'saas_micro':
      return 'First 3 paying subscribers';
    case 'service_agency':
      return 'First paying client';
    case 'ecommerce_dropship':
      return 'First 10 orders';
    case 'local_lead_gen':
      return 'First 5 leads sold to a local business';
    default:
      return 'First revenue event (sale, sponsor, or affiliate commission)';
  }
}

function getPivotConditions(option: VentureOption): string[] {
  return [
    'Less than 50 subscribers after 14 days despite consistent posting — switch primary channel',
    'Email open rate below 15% — rework subject lines and lead magnet positioning',
    'Zero revenue signals by day 30 — re-evaluate offer, pricing, or target audience',
    'One content type performing 3x better than others — shift all effort to that format',
    'Negative feedback on core concept — survey audience and pivot positioning',
  ];
}

function asStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  const filtered = val.filter((v): v is string => typeof v === 'string');
  return filtered.length > 0 ? filtered : null;
}
