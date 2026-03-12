// ── ventureConversionPlanner.ts — Conversion funnel planning ─────────────────
//
// Plans the conversion strategy for a venture: primary/secondary CTAs,
// lead magnet type, copy angle, page hierarchy, and above-fold offer.
// Every site gets a clear action, proof, and capture mechanism.

import type { VentureOption, LaunchPack, ConversionPlan } from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

/**
 * Plan the conversion strategy for a venture.
 * Pure function — no AI calls. Uses category config + launch pack to derive strategy.
 */
export function planConversion(
  option: VentureOption,
  launchPack: LaunchPack,
): ConversionPlan {
  const cat = getCategoryConfig(option.candidate.category);

  return {
    primaryCTA: derivePrimaryCTA(option, launchPack),
    secondaryCTA: deriveSecondaryCTA(option, launchPack),
    leadMagnetType: deriveLeadMagnet(option, launchPack),
    conversionCopyAngle: deriveCopyAngle(option, launchPack),
    pageHierarchy: derivePageHierarchy(option, launchPack, cat),
    aboveFoldOffer: deriveAboveFoldOffer(option, launchPack),
  };
}

// ── CTA derivation ───────────────────────────────────────────────────────────

function derivePrimaryCTA(option: VentureOption, pack: LaunchPack): string {
  // Use launch pack CTA if it's specific enough
  if (pack.websitePlan.primaryCTA && pack.websitePlan.primaryCTA !== 'Get Started') {
    return pack.websitePlan.primaryCTA;
  }

  // Derive from category + monetization
  switch (option.candidate.category) {
    case 'newsletter':
    case 'content_brand':
      return `Get ${pack.brandName} in your inbox — free`;
    case 'digital_product':
      return `Get instant access to ${pack.firstOffer}`;
    case 'faceless_media':
      return 'Subscribe for daily insights';
    case 'saas_micro':
      return 'Start your free trial';
    case 'service_agency':
      return 'Book a free consultation';
    case 'ecommerce_dropship':
      return 'Shop now — free shipping';
    case 'affiliate_niche':
      return 'See our top picks';
    case 'community_membership':
      return 'Join the community — free';
    case 'local_lead_gen':
      return 'Get your free quote';
    default:
      return 'Get started free';
  }
}

function deriveSecondaryCTA(option: VentureOption, pack: LaunchPack): string {
  if (pack.websitePlan.secondaryCTA && pack.websitePlan.secondaryCTA !== 'Learn More') {
    return pack.websitePlan.secondaryCTA;
  }

  switch (option.candidate.category) {
    case 'newsletter':
      return 'Read the latest issue';
    case 'digital_product':
    case 'saas_micro':
      return 'See what\'s included';
    case 'service_agency':
      return 'View our work';
    case 'community_membership':
      return 'See what members say';
    default:
      return 'Learn more';
  }
}

// ── Lead magnet ──────────────────────────────────────────────────────────────

function deriveLeadMagnet(option: VentureOption, pack: LaunchPack): string {
  if (pack.leadCapturePlan.leadMagnetType &&
      pack.leadCapturePlan.leadMagnetType !== 'Free guide or checklist') {
    return pack.leadCapturePlan.leadMagnetType;
  }

  switch (option.candidate.category) {
    case 'newsletter':
      return 'Free weekly curated digest';
    case 'content_brand':
      return 'Free starter guide or resource pack';
    case 'digital_product':
      return 'Free sample or preview chapter';
    case 'faceless_media':
      return 'Free content toolkit or template pack';
    case 'saas_micro':
      return '14-day free trial — no credit card';
    case 'service_agency':
      return 'Free audit or strategy session';
    case 'affiliate_niche':
      return 'Free comparison guide or buying checklist';
    case 'community_membership':
      return 'Free 7-day community access';
    case 'ecommerce_dropship':
      return 'First-time buyer discount code';
    case 'local_lead_gen':
      return 'Free instant quote';
    default:
      return 'Free guide';
  }
}

// ── Copy angle ───────────────────────────────────────────────────────────────

function deriveCopyAngle(option: VentureOption, pack: LaunchPack): string {
  const mode = option.ventureMode;
  const audience = pack.targetAudience;

  switch (mode) {
    case 'fast_cash':
      return `Speed + results: show ${audience} how to get quick wins without the usual friction`;
    case 'brand_build':
      return `Authority + trust: position ${pack.brandName} as the go-to resource ${audience} recommends to peers`;
    case 'authority_build':
      return `Expertise + depth: demonstrate deep knowledge that makes ${audience} rely on ${pack.brandName} for decisions`;
    case 'experimental':
      return `Curiosity + novelty: attract ${audience} with a fresh approach they haven't seen before`;
    case 'passive_engine':
      return `Ease + automation: show ${audience} how ${pack.brandName} delivers value on autopilot`;
    default:
      return `Value-first: lead with actionable insights that make ${audience} come back`;
  }
}

// ── Page hierarchy ───────────────────────────────────────────────────────────

function derivePageHierarchy(
  option: VentureOption,
  pack: LaunchPack,
  cat: ReturnType<typeof getCategoryConfig>,
): string[] {
  const base = ['Homepage (hero + CTA + proof)'];

  switch (option.candidate.category) {
    case 'newsletter':
      return [...base, 'Archive / Past Issues', 'About', 'Subscribe'];

    case 'content_brand':
    case 'faceless_media':
      return [...base, 'Blog / Content', 'About', 'Resources', 'Subscribe'];

    case 'digital_product':
      return [...base, 'Product / Offer', 'Testimonials', 'About', 'FAQ'];

    case 'saas_micro':
      return [...base, 'Features', 'Pricing', 'About', 'FAQ', 'Contact'];

    case 'service_agency':
      return [...base, 'Services', 'Portfolio / Case Studies', 'About', 'Contact'];

    case 'ecommerce_dropship':
      return [...base, 'Shop / Products', 'Best Sellers', 'About', 'FAQ', 'Contact'];

    case 'affiliate_niche':
      return [...base, 'Reviews / Guides', 'Best Of', 'About', 'Subscribe'];

    case 'community_membership':
      return [...base, 'What You Get', 'Member Stories', 'Pricing', 'Join'];

    case 'local_lead_gen':
      return [...base, 'Services', 'Service Areas', 'Reviews', 'Get a Quote'];

    default:
      return [...base, 'About', 'Offer', 'Contact'];
  }
}

// ── Above-fold offer ─────────────────────────────────────────────────────────

function deriveAboveFoldOffer(option: VentureOption, pack: LaunchPack): string {
  const magnet = pack.leadCapturePlan.leadMagnetType;
  const brandName = pack.brandName;

  if (option.candidate.category === 'newsletter') {
    return `Join ${brandName} — ${magnet}. Delivered weekly.`;
  }

  if (option.candidate.category === 'saas_micro') {
    return `Try ${brandName} free for 14 days. No credit card required.`;
  }

  if (option.candidate.category === 'service_agency') {
    return `${brandName}: ${pack.oneLinePitch}. Book your free consultation.`;
  }

  return `${pack.homepageHeroCopy} — ${magnet}.`;
}
