// ── ventureSiteTypes.ts — Site generation types ─────────────────────────────
//
// Re-exports core types from ventureTypes.ts and adds site-planning-specific
// types used only within the site generation pipeline.

// Re-export site-related types from the central type file
export type {
  SiteType, SitePage, SiteSection, SiteBuild,
  CaptureType, CaptureComponent,
  WebsitePlan, ConversionPlan,
} from '../ventureTypes';

// ── Site planning types ──────────────────────────────────────────────────────

/** Full site plan passed to the generator. */
export interface SitePlan {
  siteType: import('../ventureTypes').SiteType;
  brandName: string;
  tagline: string;
  colorDirection: string;
  brandVoice: string;
  pages: PagePlan[];
  capturePoints: CapturePointPlan[];
  globalSeo: {
    title: string;
    description: string;
    keywords: string[];
  };
}

/** Plan for a single page before content generation. */
export interface PagePlan {
  slug: string;
  title: string;
  purpose: string;
  sectionTypes: import('../ventureTypes').SiteSection['type'][];
  hasCaptureComponent: boolean;
  seoMeta: {
    title: string;
    description: string;
    keywords: string[];
  };
}

/** Where and how to place a capture component. */
export interface CapturePointPlan {
  pageSlug: string;
  captureType: import('../ventureTypes').CaptureType;
  placement: 'hero' | 'mid-page' | 'footer' | 'popup';
  ctaCopy: string;
}

/** Result of generating HTML for a page. */
export interface GeneratedPage {
  slug: string;
  title: string;
  html: string;
  seoMeta: {
    title: string;
    description: string;
    keywords: string[];
  };
}
