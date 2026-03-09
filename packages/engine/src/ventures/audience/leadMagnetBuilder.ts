// ── leadMagnetBuilder.ts — AI-powered lead magnet creation ───────────────────
//
// Generates a lead magnet asset (ebook, checklist, template, etc.) using AI.
// The lead magnet is the free value given in exchange for an email/signup.

import type { VentureOption, BrandAssets } from '../ventureTypes';
import type { LeadMagnetAsset } from './audienceTypes';
import { getCategoryConfig } from '../ventureCatalog';

interface MagnetProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

/**
 * Build a lead magnet asset for the venture.
 * AI generates the concept; deterministic fallback if AI fails.
 */
export async function buildLeadMagnet(
  option: VentureOption,
  brand: BrandAssets,
  provider: MagnetProvider,
): Promise<LeadMagnetAsset> {
  const cat = getCategoryConfig(option.candidate.category);

  try {
    const prompt = `You are a lead generation specialist creating a free lead magnet for a new brand.

Brand: ${brand.brandName}
Tagline: ${brand.tagline}
Category: ${cat?.label ?? option.candidate.category}
Target audience: ${option.launchPack.targetAudience}
Monetization: ${option.launchPack.monetizationPath}

Create a lead magnet that would make the target audience immediately give their email.

Return a JSON object:
{
  "type": "checklist|ebook|template|video|mini-course|toolkit|swipe-file|cheat-sheet",
  "title": "compelling title that promises a specific outcome",
  "description": "2-3 sentences explaining what they get and why it's valuable",
  "deliveryMethod": "email|download page|drip sequence",
  "estimatedCreationTime": "e.g. 2 hours, 1 day"
}

Rules:
- Title must promise a specific, measurable outcome
- Must be something that can be created quickly (not a full course)
- Must be genuinely useful — not just a teaser
- Match the brand voice

Return ONLY valid JSON.`;

    const response = await provider.chat([
      { role: 'system', content: 'You are a lead generation specialist. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      type: String(parsed.type ?? 'checklist'),
      title: String(parsed.title ?? `The ${brand.brandName} Starter Kit`),
      description: String(parsed.description ?? `A free resource to help you get started with ${option.candidate.concept}`),
      deliveryMethod: String(parsed.deliveryMethod ?? 'email'),
      estimatedCreationTime: String(parsed.estimatedCreationTime ?? '2 hours'),
      captureType: cat?.recommendedCaptureMethod ?? 'free_guide',
    };
  } catch {
    return fallbackMagnet(option, brand, cat);
  }
}

function fallbackMagnet(
  option: VentureOption,
  brand: BrandAssets,
  cat: ReturnType<typeof getCategoryConfig>,
): LeadMagnetAsset {
  const magnetMap: Record<string, { type: string; titleTemplate: string }> = {
    newsletter: { type: 'cheat-sheet', titleTemplate: 'The {topic} Cheat Sheet' },
    content_brand: { type: 'toolkit', titleTemplate: 'The {brand} Starter Toolkit' },
    faceless_media: { type: 'template', titleTemplate: '{topic} Content Templates Pack' },
    digital_product: { type: 'checklist', titleTemplate: 'The Complete {topic} Checklist' },
    saas_micro: { type: 'checklist', titleTemplate: '{topic} Setup Checklist' },
    service_agency: { type: 'template', titleTemplate: 'Free {topic} Audit Template' },
    affiliate_niche: { type: 'cheat-sheet', titleTemplate: 'Best {topic} Comparison Guide' },
    community_membership: { type: 'mini-course', titleTemplate: '5-Day {topic} Mini-Course' },
    ecommerce_dropship: { type: 'checklist', titleTemplate: '{topic} Buyer\'s Guide' },
    local_lead_gen: { type: 'checklist', titleTemplate: 'Free {topic} Checklist' },
  };

  const config = magnetMap[option.candidate.category] ?? { type: 'checklist', titleTemplate: '{brand} Starter Guide' };
  const topic = option.candidate.concept.split(' ').slice(0, 3).join(' ');
  const title = config.titleTemplate
    .replace('{topic}', topic)
    .replace('{brand}', brand.brandName);

  return {
    type: config.type,
    title,
    description: `A free ${config.type} to help ${option.launchPack.targetAudience} get started. Actionable, no fluff.`,
    deliveryMethod: 'email',
    estimatedCreationTime: '2-3 hours',
    captureType: cat?.recommendedCaptureMethod ?? 'free_guide',
  };
}
