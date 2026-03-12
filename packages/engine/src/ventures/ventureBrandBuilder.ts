// ── ventureBrandBuilder.ts — AI-powered brand asset generation ───────────────
//
// Uses an AI provider to generate cohesive brand assets for an approved venture.
// Falls back to deterministic defaults if AI fails.

import type { VentureOption, BrandAssets } from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

interface BrandProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

/**
 * Generate brand assets for a venture option using AI.
 * Returns brandName, tagline, logoConceptDescription, colorDirection,
 * brandVoice, positioning, and homepageHeroCopy.
 */
export async function buildBrand(
  option: VentureOption,
  provider: BrandProvider,
): Promise<BrandAssets> {
  const cat = getCategoryConfig(option.candidate.category);

  const prompt = `You are a brand strategist creating a new brand for an online venture.

Venture: ${option.candidate.concept}
Category: ${cat?.label ?? option.candidate.category}
Target audience: ${option.launchPack.targetAudience}
Monetization: ${option.launchPack.monetizationPath}
Venture mode: ${option.ventureMode.replace(/_/g, ' ')}
Existing brand direction: ${option.launchPack.brandName} / "${option.launchPack.tagline}"

Create polished, market-ready brand assets. Return a JSON object:
{
  "brandName": "memorable, short, domain-friendly name (max 2 words)",
  "tagline": "punchy tagline under 8 words",
  "logoConceptDescription": "describe what the logo should look like (shape, style, imagery)",
  "colorDirection": "2-3 colors with hex codes and mood description",
  "brandVoice": "describe the tone — e.g. professional but warm, edgy and bold",
  "positioning": "one sentence positioning statement",
  "homepageHeroCopy": "compelling headline + subheadline for the homepage hero section (2-3 sentences max)"
}

Requirements:
- Brand name must be unique-sounding and available as a .com-style domain
- No generic names like "Digital Hub" or "Pro Solutions"
- Tagline should create urgency or curiosity
- Hero copy should make a visitor want to stay

Return ONLY valid JSON.`;

  try {
    const response = await provider.chat([
      { role: 'system', content: 'You are a senior brand strategist. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      brandName: String(parsed.brandName ?? option.launchPack.brandName),
      tagline: String(parsed.tagline ?? option.launchPack.tagline),
      logoConceptDescription: String(parsed.logoConceptDescription ?? `Clean modern logo for ${option.launchPack.brandName}`),
      colorDirection: String(parsed.colorDirection ?? 'Deep blue (#1a365d) + white (#ffffff) + accent gold (#d69e2e) — trustworthy and premium'),
      brandVoice: String(parsed.brandVoice ?? option.launchPack.brandVoice),
      positioning: String(parsed.positioning ?? option.launchPack.positioning),
      homepageHeroCopy: String(parsed.homepageHeroCopy ?? option.launchPack.homepageHeroCopy),
    };
  } catch {
    // Deterministic fallback
    return fallbackBrand(option);
  }
}

function fallbackBrand(option: VentureOption): BrandAssets {
  return {
    brandName: option.launchPack.brandName,
    tagline: option.launchPack.tagline || `Your ${option.candidate.category.replace(/_/g, ' ')} advantage`,
    logoConceptDescription: `Clean, modern wordmark with a subtle icon representing ${option.candidate.category.replace(/_/g, ' ')}. Sans-serif font, minimal design.`,
    colorDirection: 'Deep blue (#1a365d) + white (#ffffff) + accent teal (#0d9488) — trustworthy, clean, modern',
    brandVoice: option.launchPack.brandVoice || 'Professional, approachable, authoritative',
    positioning: option.launchPack.positioning || `The go-to resource for ${option.candidate.concept}`,
    homepageHeroCopy: option.launchPack.homepageHeroCopy || option.launchPack.oneLinePitch,
  };
}
