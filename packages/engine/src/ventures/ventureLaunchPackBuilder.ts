// ── ventureLaunchPackBuilder.ts — Assemble complete launch pack ──────────────
//
// Merges brand assets with AI-generated strategy to produce a fully populated
// LaunchPack: website plan, lead capture, audience growth, first week actions,
// SEO seed topics, traffic channels, and first offer.

import type {
  VentureOption, BrandAssets, LaunchPack,
  WebsitePlan, LeadCapturePlan, FollowerGrowthPlan,
} from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

interface LaunchPackProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

/**
 * Build a complete LaunchPack by merging brand assets with AI-generated strategy.
 * Uses existing launchPack on the option as a base, enriches with AI.
 */
export async function buildLaunchPack(
  option: VentureOption,
  brand: BrandAssets,
  provider: LaunchPackProvider,
): Promise<LaunchPack> {
  const cat = getCategoryConfig(option.candidate.category);

  const prompt = `You are a launch strategist building a complete launch plan for a new venture.

Brand: ${brand.brandName}
Tagline: ${brand.tagline}
Category: ${cat?.label ?? option.candidate.category}
Concept: ${option.candidate.concept}
Target audience: ${option.launchPack.targetAudience}
Monetization: ${option.launchPack.monetizationPath}
Venture mode: ${option.ventureMode.replace(/_/g, ' ')}
Site type: ${cat?.recommendedSiteType ?? 'landing_page'}
Capture method: ${cat?.recommendedCaptureMethod ?? 'email_signup'}
Traffic channels: ${(cat?.trafficChannels ?? []).join(', ')}

Create a detailed launch plan. Return a JSON object:
{
  "oneLinePitch": "one compelling sentence",
  "positioning": "market positioning statement",
  "launchAngle": "how to enter the market — what makes the first impression",
  "contentAngle": "what type of content to create and what topics to cover",
  "firstWeekPlan": ["day 1-2 action", "day 3-4 action", "day 5-7 action", "ongoing action"],
  "seoSeedTopics": ["topic 1", "topic 2", "topic 3", "topic 4", "topic 5"],
  "firstTrafficChannels": ["channel 1", "channel 2", "channel 3"],
  "firstOffer": "what the first monetization offer is",
  "websitePlan": {
    "requiredPages": ["page1", "page2", "page3"],
    "primaryCTA": "main call to action text",
    "secondaryCTA": "secondary call to action text",
    "structure": "brief description of site layout"
  },
  "leadCapture": {
    "leadMagnetType": "what free thing to offer",
    "signupCTA": "CTA copy for the signup form",
    "estimatedConversionRate": 0.05
  },
  "audienceGrowth": {
    "primaryGoal": "what the audience goal is",
    "first30DayTarget": 250,
    "channels": ["channel 1", "channel 2"]
  }
}

Requirements:
- First week plan must be actionable — no vague steps
- SEO topics must be specific long-tail keywords
- First offer must be concrete — not "something valuable"
- CTA copy must create urgency

Return ONLY valid JSON.`;

  try {
    const response = await provider.chat([
      { role: 'system', content: 'You are a launch strategist. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return assembleLaunchPack(option, brand, cat, parsed);
  } catch {
    return assembleLaunchPack(option, brand, cat, {});
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function assembleLaunchPack(
  option: VentureOption,
  brand: BrandAssets,
  cat: ReturnType<typeof getCategoryConfig>,
  ai: Record<string, unknown>,
): LaunchPack {
  const wp = (ai.websitePlan ?? {}) as Record<string, unknown>;
  const lc = (ai.leadCapture ?? {}) as Record<string, unknown>;
  const ag = (ai.audienceGrowth ?? {}) as Record<string, unknown>;

  const websitePlan: WebsitePlan = {
    siteType: cat?.recommendedSiteType ?? 'landing_page',
    requiredPages: asStringArray(wp.requiredPages) ?? option.launchPack.websitePlan.requiredPages,
    primaryCTA: String(wp.primaryCTA ?? option.launchPack.websitePlan.primaryCTA),
    secondaryCTA: String(wp.secondaryCTA ?? option.launchPack.websitePlan.secondaryCTA),
    structure: String(wp.structure ?? option.launchPack.websitePlan.structure),
  };

  const leadCapturePlan: LeadCapturePlan = {
    captureType: cat?.recommendedCaptureMethod ?? 'email_signup',
    leadMagnetType: String(lc.leadMagnetType ?? option.launchPack.leadCapturePlan.leadMagnetType),
    signupCTA: String(lc.signupCTA ?? option.launchPack.leadCapturePlan.signupCTA),
    estimatedConversionRate: typeof lc.estimatedConversionRate === 'number'
      ? lc.estimatedConversionRate
      : option.launchPack.leadCapturePlan.estimatedConversionRate,
  };

  const followerGrowthPlan: FollowerGrowthPlan = {
    primaryGoal: String(ag.primaryGoal ?? option.launchPack.followerGrowthPlan.primaryGoal),
    captureMethod: cat?.recommendedCaptureMethod ?? 'email_signup',
    first30DayTarget: typeof ag.first30DayTarget === 'number'
      ? ag.first30DayTarget
      : option.launchPack.followerGrowthPlan.first30DayTarget,
    channels: asStringArray(ag.channels) ?? option.launchPack.followerGrowthPlan.channels,
  };

  return {
    brandName: brand.brandName,
    logoConceptDescription: brand.logoConceptDescription,
    tagline: brand.tagline,
    oneLinePitch: String(ai.oneLinePitch ?? option.launchPack.oneLinePitch),
    targetAudience: option.launchPack.targetAudience,
    positioning: String(ai.positioning ?? brand.positioning),
    monetizationPath: option.launchPack.monetizationPath,
    launchAngle: String(ai.launchAngle ?? option.launchPack.launchAngle),
    contentAngle: String(ai.contentAngle ?? option.launchPack.contentAngle),
    firstWeekPlan: asStringArray(ai.firstWeekPlan) ?? option.launchPack.firstWeekPlan,
    brandVoice: brand.brandVoice,
    colorDirection: brand.colorDirection,
    homepageHeroCopy: brand.homepageHeroCopy,
    websitePlan,
    leadCapturePlan,
    followerGrowthPlan,
    seoSeedTopics: asStringArray(ai.seoSeedTopics) ?? option.launchPack.seoSeedTopics,
    firstTrafficChannels: asStringArray(ai.firstTrafficChannels) ?? option.launchPack.firstTrafficChannels,
    firstOffer: String(ai.firstOffer ?? option.launchPack.firstOffer),
  };
}

function asStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  const filtered = val.filter((v): v is string => typeof v === 'string');
  return filtered.length > 0 ? filtered : null;
}
