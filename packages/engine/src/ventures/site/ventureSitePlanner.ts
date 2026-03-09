// ── ventureSitePlanner.ts — Plan site structure from venture option ──────────
//
// Takes a venture option, launch pack, and conversion plan and produces a
// SitePlan: which pages to generate, what sections each page needs, where
// capture components go, and global SEO metadata.
//
// Every site MUST include at least one owned-audience capture mechanism.

import type { VentureOption, LaunchPack, ConversionPlan, BrandAssets } from '../ventureTypes';
import type { SitePlan, PagePlan, CapturePointPlan } from './ventureSiteTypes';
import type { SiteSection } from '../ventureTypes';
import { getCategoryConfig } from '../ventureCatalog';

/**
 * Plan the full site structure for a venture.
 * Returns a SitePlan ready for the site generator.
 */
export function planSite(
  option: VentureOption,
  launchPack: LaunchPack,
  conversionPlan: ConversionPlan,
  brand: BrandAssets,
): SitePlan {
  const cat = getCategoryConfig(option.candidate.category);
  const pages = planPages(option, launchPack, conversionPlan);
  const capturePoints = planCapturePoints(option, launchPack, conversionPlan, pages);

  return {
    siteType: cat?.recommendedSiteType ?? 'landing_page',
    brandName: brand.brandName,
    tagline: brand.tagline,
    colorDirection: brand.colorDirection,
    brandVoice: brand.brandVoice,
    pages,
    capturePoints,
    globalSeo: {
      title: `${brand.brandName} — ${brand.tagline}`,
      description: launchPack.oneLinePitch,
      keywords: launchPack.seoSeedTopics.slice(0, 5),
    },
  };
}

// ── Page planning ────────────────────────────────────────────────────────────

function planPages(
  option: VentureOption,
  pack: LaunchPack,
  conv: ConversionPlan,
): PagePlan[] {
  const pages: PagePlan[] = [];

  // Homepage — always present
  pages.push({
    slug: 'index',
    title: pack.brandName,
    purpose: 'Hero + value proposition + primary CTA + social proof',
    sectionTypes: ['hero', 'features', 'testimonials', 'cta', 'capture'],
    hasCaptureComponent: true,
    seoMeta: {
      title: `${pack.brandName} — ${pack.tagline}`,
      description: pack.oneLinePitch,
      keywords: pack.seoSeedTopics.slice(0, 3),
    },
  });

  // About page
  pages.push({
    slug: 'about',
    title: `About ${pack.brandName}`,
    purpose: 'Brand story, mission, credibility',
    sectionTypes: ['about', 'content', 'cta'],
    hasCaptureComponent: false,
    seoMeta: {
      title: `About ${pack.brandName}`,
      description: pack.positioning,
      keywords: [pack.brandName, pack.targetAudience],
    },
  });

  // Category-specific pages
  const categoryPages = getCategoryPages(option, pack, conv);
  pages.push(...categoryPages);

  // Privacy / Terms — always present
  pages.push({
    slug: 'privacy',
    title: 'Privacy Policy',
    purpose: 'Legal compliance',
    sectionTypes: ['content'],
    hasCaptureComponent: false,
    seoMeta: {
      title: `Privacy Policy — ${pack.brandName}`,
      description: `Privacy policy for ${pack.brandName}`,
      keywords: [],
    },
  });

  return pages;
}

function getCategoryPages(
  option: VentureOption,
  pack: LaunchPack,
  conv: ConversionPlan,
): PagePlan[] {
  const pages: PagePlan[] = [];

  switch (option.candidate.category) {
    case 'newsletter':
      pages.push({
        slug: 'subscribe',
        title: 'Subscribe',
        purpose: 'Dedicated signup page with lead magnet offer',
        sectionTypes: ['hero', 'features', 'capture'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `Subscribe to ${pack.brandName}`,
          description: conv.aboveFoldOffer,
          keywords: pack.seoSeedTopics.slice(0, 2),
        },
      });
      pages.push({
        slug: 'archive',
        title: 'Past Issues',
        purpose: 'Show past content to prove value',
        sectionTypes: ['content', 'cta'],
        hasCaptureComponent: false,
        seoMeta: {
          title: `${pack.brandName} Archive`,
          description: `Browse past issues of ${pack.brandName}`,
          keywords: pack.seoSeedTopics,
        },
      });
      break;

    case 'content_brand':
    case 'faceless_media':
    case 'affiliate_niche':
      pages.push({
        slug: 'blog',
        title: 'Blog',
        purpose: 'Content hub for SEO and audience building',
        sectionTypes: ['content', 'capture'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `${pack.brandName} Blog`,
          description: `Latest insights from ${pack.brandName}`,
          keywords: pack.seoSeedTopics,
        },
      });
      pages.push({
        slug: 'resources',
        title: 'Resources',
        purpose: 'Curated tools, guides, and recommendations',
        sectionTypes: ['content', 'cta'],
        hasCaptureComponent: false,
        seoMeta: {
          title: `Resources — ${pack.brandName}`,
          description: `Curated resources from ${pack.brandName}`,
          keywords: pack.seoSeedTopics.slice(0, 3),
        },
      });
      break;

    case 'digital_product':
      pages.push({
        slug: 'product',
        title: pack.firstOffer,
        purpose: 'Product sales page with offer details',
        sectionTypes: ['hero', 'features', 'testimonials', 'pricing', 'faq', 'cta'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `${pack.firstOffer} — ${pack.brandName}`,
          description: pack.oneLinePitch,
          keywords: pack.seoSeedTopics,
        },
      });
      break;

    case 'saas_micro':
      pages.push({
        slug: 'features',
        title: 'Features',
        purpose: 'Feature showcase with screenshots/demos',
        sectionTypes: ['hero', 'features', 'content', 'cta'],
        hasCaptureComponent: false,
        seoMeta: {
          title: `Features — ${pack.brandName}`,
          description: `See what ${pack.brandName} can do`,
          keywords: pack.seoSeedTopics,
        },
      });
      pages.push({
        slug: 'pricing',
        title: 'Pricing',
        purpose: 'Pricing tiers and signup',
        sectionTypes: ['pricing', 'faq', 'cta', 'capture'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `Pricing — ${pack.brandName}`,
          description: `${pack.brandName} pricing plans`,
          keywords: [pack.brandName, 'pricing'],
        },
      });
      break;

    case 'service_agency':
      pages.push({
        slug: 'services',
        title: 'Services',
        purpose: 'Service offerings and process',
        sectionTypes: ['hero', 'features', 'content', 'cta'],
        hasCaptureComponent: false,
        seoMeta: {
          title: `Services — ${pack.brandName}`,
          description: `Professional services from ${pack.brandName}`,
          keywords: pack.seoSeedTopics,
        },
      });
      pages.push({
        slug: 'contact',
        title: 'Contact',
        purpose: 'Contact form for inquiries',
        sectionTypes: ['content', 'capture'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `Contact — ${pack.brandName}`,
          description: `Get in touch with ${pack.brandName}`,
          keywords: [pack.brandName, 'contact'],
        },
      });
      break;

    case 'community_membership':
      pages.push({
        slug: 'join',
        title: 'Join',
        purpose: 'Membership signup with benefits',
        sectionTypes: ['hero', 'features', 'testimonials', 'pricing', 'capture'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `Join ${pack.brandName}`,
          description: `Become a member of ${pack.brandName}`,
          keywords: pack.seoSeedTopics,
        },
      });
      break;

    case 'ecommerce_dropship':
      pages.push({
        slug: 'shop',
        title: 'Shop',
        purpose: 'Product listing page',
        sectionTypes: ['content', 'cta'],
        hasCaptureComponent: false,
        seoMeta: {
          title: `Shop — ${pack.brandName}`,
          description: `Browse products from ${pack.brandName}`,
          keywords: pack.seoSeedTopics,
        },
      });
      break;

    case 'local_lead_gen':
      pages.push({
        slug: 'quote',
        title: 'Get a Quote',
        purpose: 'Lead capture form for local service inquiries',
        sectionTypes: ['hero', 'capture', 'testimonials', 'faq'],
        hasCaptureComponent: true,
        seoMeta: {
          title: `Free Quote — ${pack.brandName}`,
          description: `Get a free quote from ${pack.brandName}`,
          keywords: pack.seoSeedTopics,
        },
      });
      break;
  }

  return pages;
}

// ── Capture point planning ───────────────────────────────────────────────────

function planCapturePoints(
  option: VentureOption,
  pack: LaunchPack,
  conv: ConversionPlan,
  pages: PagePlan[],
): CapturePointPlan[] {
  const points: CapturePointPlan[] = [];
  const cat = getCategoryConfig(option.candidate.category);
  const captureType = cat?.recommendedCaptureMethod ?? 'email_signup';

  // Homepage hero — always
  points.push({
    pageSlug: 'index',
    captureType,
    placement: 'hero',
    ctaCopy: conv.primaryCTA,
  });

  // Homepage footer — always
  points.push({
    pageSlug: 'index',
    captureType,
    placement: 'footer',
    ctaCopy: conv.secondaryCTA || 'Stay updated',
  });

  // Any page with hasCaptureComponent gets a mid-page capture
  for (const page of pages) {
    if (page.hasCaptureComponent && page.slug !== 'index') {
      points.push({
        pageSlug: page.slug,
        captureType,
        placement: 'mid-page',
        ctaCopy: conv.primaryCTA,
      });
    }
  }

  return points;
}
