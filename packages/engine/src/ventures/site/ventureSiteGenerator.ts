// ── ventureSiteGenerator.ts — AI-powered full HTML site generation ───────────
//
// Takes a SitePlan and generates complete, previewable HTML pages.
// Uses an AI provider for content generation, with deterministic fallback.
// Same pattern as appbuilder:generate in ipc.ts.

import type { SiteBuild, SitePage, SiteSection, CaptureComponent } from '../ventureTypes';
import type { SitePlan, GeneratedPage } from './ventureSiteTypes';
import { generatePageContent } from './ventureSiteContentBuilder';
import { buildCaptureComponent } from './ventureLeadCaptureBuilder';

interface SiteProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

type OnPageProgress = (pageSlug: string, status: 'generating' | 'done') => void;

/**
 * Generate a complete site build from a site plan.
 * AI generates page-by-page content; capture components are assembled deterministically.
 */
export async function generateSite(
  sitePlan: SitePlan,
  provider: SiteProvider,
  onProgress?: OnPageProgress,
): Promise<SiteBuild> {
  // Generate pages sequentially to avoid rate limits
  const pages: SitePage[] = [];
  for (const pagePlan of sitePlan.pages) {
    onProgress?.(pagePlan.slug, 'generating');

    const page = await generatePageContent(pagePlan, sitePlan, provider);
    pages.push(page);

    onProgress?.(pagePlan.slug, 'done');
  }

  // Build capture components from capture points
  const captureComponents: CaptureComponent[] = sitePlan.capturePoints.map(cp =>
    buildCaptureComponent(cp.captureType, sitePlan.brandName, cp.ctaCopy)
  );

  return {
    siteType: sitePlan.siteType,
    pages,
    globalSeo: sitePlan.globalSeo,
    captureComponents,
  };
}

/**
 * Generate a single standalone HTML file for a page with inline CSS.
 * Used for preview in the desktop UI (iframe).
 */
export function renderPageToHTML(
  page: SitePage,
  sitePlan: SitePlan,
  captureComponents: CaptureComponent[],
): string {
  const sections = page.sections.map(s => renderSection(s, sitePlan)).join('\n');
  const captureHTML = captureComponents.length > 0
    ? captureComponents.map(c => renderCaptureComponent(c)).join('\n')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(page.seoMeta.title)}</title>
  <meta name="description" content="${escapeHtml(page.seoMeta.description)}">
  <meta name="keywords" content="${escapeHtml(page.seoMeta.keywords.join(', '))}">
  <style>
    ${getBaseCSS(sitePlan.colorDirection)}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a href="/" class="logo">${escapeHtml(sitePlan.brandName)}</a>
      <p class="tagline">${escapeHtml(sitePlan.tagline)}</p>
    </div>
  </header>
  <main>
    ${sections}
    ${captureHTML}
  </main>
  <footer class="site-footer">
    <div class="container">
      <p>&copy; ${new Date().getFullYear()} ${escapeHtml(sitePlan.brandName)}. All rights reserved.</p>
    </div>
  </footer>
</body>
</html>`;
}

// ── Section rendering ────────────────────────────────────────────────────────

function renderSection(section: SiteSection, plan: SitePlan): string {
  const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
  const body = section.body ? `<div class="section-body">${section.body}</div>` : '';
  const cta = section.cta
    ? `<a href="#capture" class="btn btn-primary">${escapeHtml(section.cta)}</a>`
    : '';

  return `<section class="section section-${section.type}">
  <div class="container">
    ${heading}
    ${body}
    ${cta}
  </div>
</section>`;
}

function renderCaptureComponent(capture: CaptureComponent): string {
  const fields = capture.formFields.map(f =>
    `<input type="${f === 'email' ? 'email' : 'text'}" name="${escapeHtml(f)}" placeholder="${escapeHtml(f.charAt(0).toUpperCase() + f.slice(1))}" required>`
  ).join('\n      ');

  return `<section id="capture" class="section section-capture">
  <div class="container">
    <form class="capture-form" onsubmit="event.preventDefault(); this.innerHTML='<p class=\\'success\\'>${escapeHtml(capture.confirmationMessage)}</p>';">
      ${fields}
      <button type="submit" class="btn btn-primary">${escapeHtml(capture.ctaCopy)}</button>
    </form>
  </div>
</section>`;
}

// ── CSS generation ───────────────────────────────────────────────────────────

function getBaseCSS(colorDirection: string): string {
  // Extract hex colors from color direction string
  const hexMatches = colorDirection.match(/#[0-9a-fA-F]{6}/g) ?? [];
  const primary = hexMatches[0] ?? '#1a365d';
  const secondary = hexMatches[1] ?? '#ffffff';
  const accent = hexMatches[2] ?? '#0d9488';

  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; line-height: 1.6; background: ${secondary}; }
    .container { max-width: 960px; margin: 0 auto; padding: 0 24px; }
    .site-header { background: ${primary}; color: ${secondary}; padding: 24px 0; }
    .site-header .logo { color: ${secondary}; text-decoration: none; font-size: 1.5rem; font-weight: 700; }
    .site-header .tagline { opacity: 0.85; font-size: 0.95rem; margin-top: 4px; }
    .section { padding: 64px 0; }
    .section h2 { font-size: 1.75rem; margin-bottom: 16px; color: ${primary}; }
    .section-body { font-size: 1.05rem; }
    .section-hero { background: linear-gradient(135deg, ${primary}, ${accent}); color: ${secondary}; text-align: center; padding: 80px 0; }
    .section-hero h2 { color: ${secondary}; font-size: 2.25rem; }
    .section-capture { background: #f7f7f8; text-align: center; padding: 48px 0; }
    .capture-form { display: flex; flex-direction: column; gap: 12px; max-width: 400px; margin: 0 auto; }
    .capture-form input { padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; }
    .btn { display: inline-block; padding: 12px 28px; border-radius: 6px; font-size: 1rem; font-weight: 600; text-decoration: none; border: none; cursor: pointer; }
    .btn-primary { background: ${accent}; color: ${secondary}; }
    .btn-primary:hover { opacity: 0.9; }
    .success { color: ${accent}; font-weight: 600; padding: 16px; }
    .site-footer { background: #1a1a2e; color: #a0a0b0; padding: 32px 0; text-align: center; font-size: 0.9rem; }
    .section-testimonials { background: #f0f4f8; }
    .section-pricing { background: ${secondary}; }
    .section-faq { background: #f7f7f8; }
    @media (max-width: 640px) {
      .section { padding: 40px 0; }
      .section-hero { padding: 48px 0; }
      .section-hero h2 { font-size: 1.5rem; }
    }
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
