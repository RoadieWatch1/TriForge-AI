// ── ventureSiteContentBuilder.ts — AI-powered page content generation ────────
//
// Generates real copy for each page section — no brackets, no placeholders.
// Uses AI when available, falls back to deterministic copy templates.

import type { SitePage, SiteSection } from '../ventureTypes';
import type { SitePlan, PagePlan } from './ventureSiteTypes';

interface ContentProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

/**
 * Generate full content for a single page.
 * AI produces section-by-section copy; fallback generates template-based copy.
 */
export async function generatePageContent(
  pagePlan: PagePlan,
  sitePlan: SitePlan,
  provider: ContentProvider,
): Promise<SitePage> {
  try {
    return await aiGenerateContent(pagePlan, sitePlan, provider);
  } catch {
    return fallbackContent(pagePlan, sitePlan);
  }
}

// ── AI content generation ────────────────────────────────────────────────────

async function aiGenerateContent(
  pagePlan: PagePlan,
  sitePlan: SitePlan,
  provider: ContentProvider,
): Promise<SitePage> {
  const sectionList = pagePlan.sectionTypes.map(t => `- ${t}`).join('\n');

  const prompt = `You are a conversion copywriter creating website content.

Brand: ${sitePlan.brandName}
Tagline: ${sitePlan.tagline}
Brand voice: ${sitePlan.brandVoice}
Page: ${pagePlan.title} (${pagePlan.purpose})

Write content for these sections:
${sectionList}

Return a JSON array of sections:
[
  {
    "type": "hero",
    "heading": "compelling headline",
    "body": "supporting paragraph (2-3 sentences, NO HTML tags)",
    "cta": "call to action button text (only for hero, cta, capture sections)"
  }
]

Rules:
- Write REAL copy — no brackets, no [placeholder], no lorem ipsum
- Match the brand voice exactly
- Hero section: headline should grab attention in under 8 words
- CTA sections: button text should be action-oriented (max 5 words)
- Body text: concise, benefit-focused, no fluff
- Testimonials section: create 2-3 realistic (but clearly example) testimonials
- FAQ section: create 3-4 relevant Q&A pairs

Return ONLY a valid JSON array.`;

  const response = await provider.chat([
    { role: 'system', content: 'You are a conversion copywriter. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ]);

  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response');

  const parsed: Array<{ type: string; heading: string; body: string; cta?: string }> = JSON.parse(jsonMatch[0]);

  const sections: SiteSection[] = parsed.map(s => ({
    type: (s.type || 'content') as SiteSection['type'],
    heading: s.heading || '',
    body: s.body || '',
    cta: s.cta,
  }));

  return {
    slug: pagePlan.slug,
    title: pagePlan.title,
    sections,
    seoMeta: pagePlan.seoMeta,
  };
}

// ── Fallback content ─────────────────────────────────────────────────────────

function fallbackContent(pagePlan: PagePlan, sitePlan: SitePlan): SitePage {
  const sections: SiteSection[] = pagePlan.sectionTypes.map(type =>
    generateFallbackSection(type, sitePlan, pagePlan)
  );

  return {
    slug: pagePlan.slug,
    title: pagePlan.title,
    sections,
    seoMeta: pagePlan.seoMeta,
  };
}

function generateFallbackSection(
  type: SiteSection['type'],
  plan: SitePlan,
  page: PagePlan,
): SiteSection {
  switch (type) {
    case 'hero':
      return {
        type: 'hero',
        heading: plan.tagline || `Welcome to ${plan.brandName}`,
        body: `${plan.brandName} helps you achieve more. Start today and see the difference.`,
        cta: 'Get Started',
      };

    case 'features':
      return {
        type: 'features',
        heading: `Why ${plan.brandName}?`,
        body: `Built for results. ${plan.brandName} delivers value from day one with a clear path to your goals. No fluff, no filler — just what works.`,
      };

    case 'testimonials':
      return {
        type: 'testimonials',
        heading: 'What People Are Saying',
        body: `"${plan.brandName} changed how I approach this space. The insights are actionable and the results speak for themselves." — Early Member\n\n"Finally, something that actually delivers on its promise. Highly recommended." — Beta User`,
      };

    case 'cta':
      return {
        type: 'cta',
        heading: 'Ready to Start?',
        body: `Join ${plan.brandName} today and take the first step.`,
        cta: 'Get Started Now',
      };

    case 'content':
      return {
        type: 'content',
        heading: page.title,
        body: page.purpose,
      };

    case 'faq':
      return {
        type: 'faq',
        heading: 'Frequently Asked Questions',
        body: `Q: What is ${plan.brandName}?\nA: ${plan.brandName} is your resource for ${plan.tagline.toLowerCase()}.\n\nQ: How do I get started?\nA: Sign up using the form above — it takes less than 30 seconds.\n\nQ: Is this free?\nA: We offer a free tier to get you started with no commitment.`,
      };

    case 'pricing':
      return {
        type: 'pricing',
        heading: 'Simple, Transparent Pricing',
        body: 'Start free. Upgrade when you need more. No hidden fees, no surprises.',
      };

    case 'about':
      return {
        type: 'about',
        heading: `About ${plan.brandName}`,
        body: `${plan.brandName} was built to solve a real problem. We believe in delivering value first and earning trust through results.`,
      };

    case 'capture':
      return {
        type: 'capture',
        heading: 'Stay in the Loop',
        body: `Get the latest from ${plan.brandName} delivered to your inbox.`,
        cta: 'Subscribe',
      };

    default:
      return {
        type: 'content',
        heading: page.title,
        body: page.purpose,
      };
  }
}
