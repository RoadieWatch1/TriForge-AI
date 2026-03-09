// ── ventureGrowthFunnel.ts — Growth funnel planning ──────────────────────────
//
// Maps the full growth funnel: Traffic → Capture → Nurture → Convert → Retain.
// Pure function — no AI calls.

import type { VentureOption, LaunchPack, GrowthFunnel } from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

/**
 * Plan the growth funnel for a venture option.
 * Maps traffic sources through capture, nurture, conversion, and retention.
 */
export function planGrowthFunnel(
  option: VentureOption,
  launchPack: LaunchPack,
): GrowthFunnel {
  const cat = getCategoryConfig(option.candidate.category);

  return {
    trafficSources: deriveTrafficSources(option, launchPack, cat),
    capturePoints: deriveCapturePoints(option, launchPack, cat),
    nurtureMethod: deriveNurtureMethod(option, launchPack),
    conversionEvent: deriveConversionEvent(option, launchPack),
    revenuePath: deriveRevenuePath(option, launchPack),
    retentionMechanism: deriveRetention(option, launchPack),
  };
}

// ── Traffic sources ──────────────────────────────────────────────────────────

function deriveTrafficSources(
  option: VentureOption,
  pack: LaunchPack,
  cat: ReturnType<typeof getCategoryConfig>,
): string[] {
  const sources: string[] = [];

  // Primary channels from launch pack
  const channels = pack.firstTrafficChannels.length > 0
    ? pack.firstTrafficChannels
    : cat?.trafficChannels ?? [];

  for (const ch of channels.slice(0, 3)) {
    sources.push(describeTrafficSource(ch, option));
  }

  // Always add organic/SEO if not already present
  if (!sources.some(s => s.toLowerCase().includes('seo'))) {
    sources.push(`SEO: target ${pack.seoSeedTopics.slice(0, 2).join(', ')} with long-form content`);
  }

  return sources;
}

function describeTrafficSource(channel: string, option: VentureOption): string {
  const lower = channel.toLowerCase();

  if (lower.includes('youtube'))
    return `YouTube: publish 3-5 shorts/week on ${option.candidate.concept} topics`;
  if (lower.includes('tiktok'))
    return `TikTok: daily short-form videos with hooks and CTAs`;
  if (lower.includes('twitter') || lower.includes('x/'))
    return `X/Twitter: daily threads + engagement in relevant communities`;
  if (lower.includes('linkedin'))
    return `LinkedIn: 3x/week posts + direct outreach to target audience`;
  if (lower.includes('reddit'))
    return `Reddit: value-first contributions in relevant subreddits`;
  if (lower.includes('pinterest'))
    return `Pinterest: pins linking to blog content and lead magnets`;
  if (lower.includes('instagram'))
    return `Instagram: reels + stories with link-in-bio to capture page`;
  if (lower.includes('facebook ads'))
    return `Facebook Ads: targeted campaigns to lookalike audiences`;
  if (lower.includes('google ads'))
    return `Google Ads: search campaigns on high-intent keywords`;
  if (lower.includes('seo') || lower.includes('blog'))
    return `SEO: weekly blog posts targeting long-tail keywords`;
  if (lower.includes('product hunt'))
    return `Product Hunt: launch day campaign with community support`;

  return `${channel}: consistent content + engagement`;
}

// ── Capture points ───────────────────────────────────────────────────────────

function deriveCapturePoints(
  option: VentureOption,
  pack: LaunchPack,
  cat: ReturnType<typeof getCategoryConfig>,
): string[] {
  const points: string[] = [];
  const captureMethod = cat?.recommendedCaptureMethod ?? 'email_signup';

  // Homepage hero
  points.push(`Homepage hero: ${captureMethod.replace(/_/g, ' ')} form with "${pack.websitePlan.primaryCTA}"`);

  // Lead magnet
  if (pack.leadCapturePlan.leadMagnetType) {
    points.push(`Lead magnet: ${pack.leadCapturePlan.leadMagnetType} in exchange for email`);
  }

  // Content upgrades
  if (['content_brand', 'affiliate_niche', 'newsletter', 'faceless_media'].includes(option.candidate.category)) {
    points.push('Content upgrades: inline signup forms within blog posts and articles');
  }

  // Social bio links
  points.push('Social bios: link-in-bio pointing to capture/landing page');

  // Exit intent (optional)
  points.push('Exit intent: popup with lead magnet offer when visitor is about to leave');

  return points;
}

// ── Nurture ──────────────────────────────────────────────────────────────────

function deriveNurtureMethod(option: VentureOption, pack: LaunchPack): string {
  switch (option.candidate.category) {
    case 'newsletter':
      return `Weekly email newsletter with curated ${option.candidate.concept} insights + personal commentary`;
    case 'content_brand':
    case 'faceless_media':
      return `5-email welcome sequence → weekly digest of new content → monthly value roundup`;
    case 'digital_product':
      return `5-email welcome sequence educating on the problem → soft pitch for product on day 7`;
    case 'saas_micro':
      return `Onboarding drip: 5 emails over 14 days showing key features and use cases`;
    case 'service_agency':
      return `Personal follow-up within 24 hours → case study email on day 3 → check-in on day 7`;
    case 'community_membership':
      return `Welcome sequence → weekly community highlights → member spotlights`;
    default:
      return `5-email welcome sequence delivering value → introduce paid offer on email 5`;
  }
}

// ── Conversion ───────────────────────────────────────────────────────────────

function deriveConversionEvent(option: VentureOption, pack: LaunchPack): string {
  switch (option.candidate.category) {
    case 'newsletter':
      return 'Subscriber upgrades to paid tier or clicks first affiliate/sponsor link';
    case 'digital_product':
      return `Purchases ${pack.firstOffer}`;
    case 'saas_micro':
      return 'Converts from free trial to paid subscription';
    case 'service_agency':
      return 'Books a paid consultation or signs a project contract';
    case 'ecommerce_dropship':
      return 'Completes first purchase';
    case 'community_membership':
      return 'Upgrades to paid membership tier';
    case 'local_lead_gen':
      return 'Submits a qualified lead form';
    default:
      return `First purchase or paid engagement with ${pack.brandName}`;
  }
}

// ── Revenue path ─────────────────────────────────────────────────────────────

function deriveRevenuePath(option: VentureOption, pack: LaunchPack): string {
  return `${pack.monetizationPath}. First offer: ${pack.firstOffer}. Upsell path: expand product line or increase pricing as audience grows.`;
}

// ── Retention ────────────────────────────────────────────────────────────────

function deriveRetention(option: VentureOption, pack: LaunchPack): string {
  switch (option.candidate.category) {
    case 'newsletter':
      return 'Consistent weekly delivery + reader surveys + exclusive content for long-term subscribers';
    case 'content_brand':
    case 'faceless_media':
      return 'Regular content schedule + community engagement + email exclusives';
    case 'saas_micro':
      return 'Feature updates + customer support + usage-based engagement emails';
    case 'community_membership':
      return 'Active moderation + weekly events + member recognition';
    default:
      return `Regular value delivery + email engagement + loyalty rewards for repeat ${pack.brandName} customers`;
  }
}
