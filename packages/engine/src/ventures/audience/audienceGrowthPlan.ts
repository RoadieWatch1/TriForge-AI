// ── audienceGrowthPlan.ts — Plan audience growth strategy ────────────────────
//
// Creates a FollowerGrowthPlan with channel-specific tactics, content calendar,
// segment targeting, and nurture sequence. Pure function — no AI calls.

import type { VentureOption, FollowerGrowthPlan, LaunchPack } from '../ventureTypes';
import type { ContentCalendarEntry, AudienceSegmentTarget, NurtureSequence, NurtureStep } from './audienceTypes';
import { getCategoryConfig } from '../ventureCatalog';

// ── Extended growth plan (includes calendar + segments + nurture) ─────────────

export interface ExtendedGrowthPlan {
  base: FollowerGrowthPlan;
  contentCalendar: ContentCalendarEntry[];
  segments: AudienceSegmentTarget[];
  nurtureSequence: NurtureSequence;
}

/**
 * Plan a complete audience growth strategy for a venture option.
 */
export function planAudienceGrowth(
  option: VentureOption,
  launchPack: LaunchPack,
): ExtendedGrowthPlan {
  const cat = getCategoryConfig(option.candidate.category);
  const channels = launchPack.followerGrowthPlan.channels.length > 0
    ? launchPack.followerGrowthPlan.channels
    : cat?.trafficChannels ?? ['X/Twitter', 'SEO'];

  const base: FollowerGrowthPlan = {
    primaryGoal: deriveGoal(option, launchPack),
    captureMethod: cat?.recommendedCaptureMethod ?? 'email_signup',
    first30DayTarget: deriveTarget(option),
    channels: channels.slice(0, 4),
  };

  const contentCalendar = buildContentCalendar(option, launchPack, channels);
  const segments = buildSegments(option, launchPack);
  const nurtureSequence = buildNurtureSequence(option, launchPack);

  return { base, contentCalendar, segments, nurtureSequence };
}

// ── Goal derivation ──────────────────────────────────────────────────────────

function deriveGoal(option: VentureOption, pack: LaunchPack): string {
  switch (option.candidate.category) {
    case 'newsletter':
      return `Build a ${pack.brandName} subscriber list to ${deriveTarget(option)}+ emails in 30 days`;
    case 'content_brand':
    case 'faceless_media':
      return `Grow ${pack.brandName} audience across social + email to ${deriveTarget(option)}+ followers/subscribers`;
    case 'saas_micro':
      return `Build a waitlist of ${deriveTarget(option)}+ interested users for ${pack.brandName}`;
    case 'community_membership':
      return `Recruit ${deriveTarget(option)}+ founding members for the ${pack.brandName} community`;
    default:
      return `Capture ${deriveTarget(option)}+ leads/subscribers for ${pack.brandName} in 30 days`;
  }
}

function deriveTarget(option: VentureOption): number {
  switch (option.candidate.category) {
    case 'newsletter':       return 500;
    case 'content_brand':    return 300;
    case 'faceless_media':   return 1000;
    case 'saas_micro':       return 200;
    case 'community_membership': return 100;
    case 'local_lead_gen':   return 50;
    default:                 return 250;
  }
}

// ── Content calendar ─────────────────────────────────────────────────────────

function buildContentCalendar(
  option: VentureOption,
  pack: LaunchPack,
  channels: string[],
): ContentCalendarEntry[] {
  const entries: ContentCalendarEntry[] = [];
  const topics = pack.seoSeedTopics.length > 0
    ? pack.seoSeedTopics
    : [option.candidate.concept];

  for (let day = 1; day <= 30; day++) {
    // Rotate channels
    const channel = channels[(day - 1) % channels.length];
    const topic = topics[(day - 1) % topics.length];

    const contentType = getContentTypeForChannel(channel);
    const goal = day <= 7 ? 'launch awareness'
      : day <= 14 ? 'drive signups'
      : day <= 21 ? 'build authority'
      : 'convert and retain';

    entries.push({
      day,
      channel,
      contentType,
      topic: `${topic} — ${getHookForDay(day)}`,
      goal,
    });
  }

  return entries;
}

function getContentTypeForChannel(channel: string): string {
  const lower = channel.toLowerCase();
  if (lower.includes('youtube')) return 'short video (60s)';
  if (lower.includes('tiktok')) return 'short video (30-60s)';
  if (lower.includes('instagram')) return 'reel or carousel';
  if (lower.includes('twitter') || lower.includes('x/')) return 'thread or post';
  if (lower.includes('linkedin')) return 'article or post';
  if (lower.includes('reddit')) return 'value post or AMA';
  if (lower.includes('pinterest')) return 'pin or infographic';
  if (lower.includes('seo') || lower.includes('blog')) return 'blog post (1000+ words)';
  return 'post';
}

function getHookForDay(day: number): string {
  const hooks = [
    'problem statement', 'surprising stat', 'quick win tip',
    'myth busting', 'case study', 'how-to breakdown',
    'before/after', 'common mistake', 'tool recommendation',
    'industry trend', 'personal story', 'listicle',
    'controversial take', 'beginner guide', 'expert interview',
  ];
  return hooks[(day - 1) % hooks.length];
}

// ── Segment targeting ────────────────────────────────────────────────────────

function buildSegments(
  option: VentureOption,
  pack: LaunchPack,
): AudienceSegmentTarget[] {
  return [
    {
      label: 'Primary',
      description: pack.targetAudience,
      channels: pack.followerGrowthPlan.channels.slice(0, 2),
      messagingAngle: `Direct value: solve their immediate problem with ${pack.brandName}`,
      estimatedSize: 'large',
    },
    {
      label: 'Adjacent',
      description: `People interested in ${option.candidate.concept} but not yet actively seeking a solution`,
      channels: pack.followerGrowthPlan.channels.slice(0, 3),
      messagingAngle: 'Educational: teach them why this matters before pitching',
      estimatedSize: 'medium',
    },
    {
      label: 'Aspirational',
      description: `People who want the outcome ${pack.brandName} enables but think it\'s out of reach`,
      channels: ['X/Twitter', 'YouTube'],
      messagingAngle: 'Inspirational: show what\'s possible with real examples',
      estimatedSize: 'small',
    },
  ];
}

// ── Nurture sequence ─────────────────────────────────────────────────────────

function buildNurtureSequence(
  option: VentureOption,
  pack: LaunchPack,
): NurtureSequence {
  const steps: NurtureStep[] = [
    {
      dayOffset: 0,
      type: 'email',
      subject: `Welcome to ${pack.brandName}`,
      purpose: 'welcome — deliver lead magnet, set expectations',
    },
    {
      dayOffset: 1,
      type: 'email',
      subject: `The #1 mistake in ${option.candidate.concept.split(' ').slice(0, 4).join(' ')}`,
      purpose: 'value delivery — establish expertise',
    },
    {
      dayOffset: 3,
      type: 'email',
      subject: `How ${pack.brandName} helps you ${pack.tagline.toLowerCase()}`,
      purpose: 'brand story — build connection',
    },
    {
      dayOffset: 5,
      type: 'email',
      subject: `Quick win: try this today`,
      purpose: 'value delivery — actionable tip',
    },
    {
      dayOffset: 7,
      type: 'email',
      subject: `Ready for the next step?`,
      purpose: 'soft pitch — introduce paid offer or deeper engagement',
    },
  ];

  return {
    name: `${pack.brandName} Welcome Sequence`,
    steps,
    conversionGoal: pack.monetizationPath,
  };
}
