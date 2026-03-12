// ── vibeToSystemTranslator.ts — Map vibe axes to concrete system decisions ───
//
// Deterministic rule engine.  Each dimension value triggers matching rules
// that produce VibeSystemDecision objects — the raw material the Council
// reasons about and the build planner turns into implementation tasks.
//
// Guardrail: any decision with riskScore > config.guardrailThreshold is
// flagged and excluded from the safe set.

import type { VibeProfile, VibeSystemDecision, VibeDimension, VibeConfig } from './vibeTypes';
import { DEFAULT_VIBE_CONFIG } from './vibeTypes';

// ── Translation rules ───────────────────────────────────────────────────────

interface TranslationRule {
  dimension: VibeDimension;
  min?: number;             // axis value must be >= min (inclusive)
  max?: number;             // axis value must be <= max (inclusive)
  target: string;
  proposed: (value: number) => string;
  rationale: string;
  impactWeight: number;     // 0-1, scaled to 0-100 in output
  riskWeight: number;       // 0-1, scaled to 0-100 in output
}

const RULES: TranslationRule[] = [
  // ── Layout ──────────────────────────────────────────────────────────────
  { dimension: 'layout', min: 70, target: 'page structure',
    proposed: v => `Use structured grid layout with clear visual hierarchy (${v}% structure)`,
    rationale: 'Higher layout structure increases scannability and perceived professionalism',
    impactWeight: 0.7, riskWeight: 0.2 },
  { dimension: 'layout', max: 30, target: 'page structure',
    proposed: v => `Use fluid, organic layout with overlapping sections (${v}% structure)`,
    rationale: 'Loose layout creates creative, approachable feel — use carefully to avoid chaos',
    impactWeight: 0.6, riskWeight: 0.5 },

  // ── Typography ──────────────────────────────────────────────────────────
  { dimension: 'typography', min: 70, target: 'type hierarchy',
    proposed: v => `Bold type hierarchy: large headlines (${Math.round(v * 0.6 + 24)}px), restrained body, strong weight contrast`,
    rationale: 'Strong type hierarchy signals authority and premium quality',
    impactWeight: 0.8, riskWeight: 0.15 },
  { dimension: 'typography', max: 30, target: 'type hierarchy',
    proposed: () => 'Flat, uniform typography — minimal size contrast, consistent weight',
    rationale: 'Flat type signals simplicity and approachability',
    impactWeight: 0.5, riskWeight: 0.2 },

  // ── Spacing ─────────────────────────────────────────────────────────────
  { dimension: 'spacing', min: 70, target: 'whitespace',
    proposed: v => `Generous whitespace: section padding ${Math.round(v * 0.8 + 40)}px, card gaps ${Math.round(v * 0.3 + 16)}px`,
    rationale: 'More breathing room signals premium quality and reduces cognitive load',
    impactWeight: 0.75, riskWeight: 0.1 },
  { dimension: 'spacing', max: 30, target: 'whitespace',
    proposed: () => 'Dense layout: tight padding, compact cards, minimal margins',
    rationale: 'Dense spacing maximizes information per screen — good for data-heavy products',
    impactWeight: 0.5, riskWeight: 0.3 },

  // ── Motion ──────────────────────────────────────────────────────────────
  { dimension: 'motion', min: 70, target: 'transitions and animations',
    proposed: v => `Rich motion: entrance animations, hover transitions (${Math.round(v * 3 + 100)}ms), scroll-triggered reveals`,
    rationale: 'Motion adds energy and cinematic quality — use to guide attention',
    impactWeight: 0.6, riskWeight: 0.35 },
  { dimension: 'motion', max: 30, target: 'transitions and animations',
    proposed: () => 'Minimal motion: instant state changes, no decorative animations',
    rationale: 'Reducing motion increases perceived speed and trustworthiness',
    impactWeight: 0.4, riskWeight: 0.1 },

  // ── Color ───────────────────────────────────────────────────────────────
  { dimension: 'color', min: 70, target: 'color palette',
    proposed: v => `High-contrast palette: saturated accent colors, dramatic dark/light split (${v}% intensity)`,
    rationale: 'Bold color creates visual impact and brand memorability',
    impactWeight: 0.7, riskWeight: 0.3 },
  { dimension: 'color', max: 30, target: 'color palette',
    proposed: () => 'Muted palette: desaturated tones, monochromatic base, subtle accent',
    rationale: 'Muted color signals sophistication and reduces visual noise',
    impactWeight: 0.5, riskWeight: 0.15 },

  // ── Copy Tone ───────────────────────────────────────────────────────────
  { dimension: 'copy_tone', min: 70, target: 'content voice',
    proposed: v => `Authoritative tone: formal language, precise terms, confidence signals (${v}% formality)`,
    rationale: 'Formal copy builds trust and positions product as premium/enterprise',
    impactWeight: 0.8, riskWeight: 0.2 },
  { dimension: 'copy_tone', max: 30, target: 'content voice',
    proposed: () => 'Conversational tone: casual language, contractions, personal pronouns',
    rationale: 'Casual copy reduces barriers and feels approachable',
    impactWeight: 0.6, riskWeight: 0.25 },

  // ── CTA Style ───────────────────────────────────────────────────────────
  { dimension: 'cta_style', min: 70, target: 'call-to-action elements',
    proposed: v => `Prominent CTAs: large buttons, high-contrast colors, action-oriented text (${v}% prominence)`,
    rationale: 'Strong CTAs increase conversion — but can feel pushy if overdone',
    impactWeight: 0.85, riskWeight: 0.4 },
  { dimension: 'cta_style', max: 30, target: 'call-to-action elements',
    proposed: () => 'Understated CTAs: text links, ghost buttons, subtle positioning',
    rationale: 'Subtle CTAs reduce pressure and feel premium — may lower conversion',
    impactWeight: 0.5, riskWeight: 0.35 },

  // ── Trust Indicators ────────────────────────────────────────────────────
  { dimension: 'trust_indicators', min: 70, target: 'trust elements',
    proposed: v => `Strong trust surface: badges, testimonials, security indicators, guarantees (${v}% coverage)`,
    rationale: 'Visible trust markers reduce purchase anxiety and increase conversion',
    impactWeight: 0.9, riskWeight: 0.1 },
  { dimension: 'trust_indicators', max: 30, target: 'trust elements',
    proposed: () => 'Minimal trust surface: rely on brand reputation and product quality alone',
    rationale: 'Fewer trust badges feels cleaner but may increase friction for new users',
    impactWeight: 0.3, riskWeight: 0.45 },

  // ── Imagery ─────────────────────────────────────────────────────────────
  { dimension: 'imagery', min: 70, target: 'visual content',
    proposed: v => `Rich imagery: hero visuals, product screenshots, lifestyle photos (${v}% visual density)`,
    rationale: 'Strong imagery creates emotional connection and demonstrates product value',
    impactWeight: 0.7, riskWeight: 0.25 },
  { dimension: 'imagery', max: 30, target: 'visual content',
    proposed: () => 'Text-driven: minimal imagery, icon-based, data visualizations over photos',
    rationale: 'Text-driven approach feels analytical and serious',
    impactWeight: 0.4, riskWeight: 0.15 },

  // ── Density ─────────────────────────────────────────────────────────────
  { dimension: 'density', min: 70, target: 'information density',
    proposed: v => `High-density layout: multi-column, data tables, dashboard panels (${v}% fill)`,
    rationale: 'High density serves power users and data-heavy products',
    impactWeight: 0.6, riskWeight: 0.4 },
  { dimension: 'density', max: 30, target: 'information density',
    proposed: () => 'Low-density layout: single focus per section, progressive disclosure, one action per screen',
    rationale: 'Low density reduces cognitive load and guides users through a clear flow',
    impactWeight: 0.65, riskWeight: 0.15 },

  // ── Cross-dimension compound rules ──────────────────────────────────────
  { dimension: 'spacing', min: 65, target: 'hero section',
    proposed: v => `Hero section padding: ${Math.round(v * 1.2 + 48)}px vertical, centered content with max-width constraint`,
    rationale: 'Generous hero spacing creates a premium first impression',
    impactWeight: 0.8, riskWeight: 0.1 },
  { dimension: 'typography', min: 65, target: 'headline hierarchy',
    proposed: v => `Headline: ${Math.round(v * 0.5 + 28)}px / subheadline: ${Math.round(v * 0.3 + 14)}px — bold weight contrast`,
    rationale: 'Clear headline hierarchy directs user attention to key messages',
    impactWeight: 0.7, riskWeight: 0.1 },
  { dimension: 'trust_indicators', min: 60, target: 'social proof section',
    proposed: () => 'Add or strengthen social proof: customer logos, testimonial cards, review scores',
    rationale: 'Social proof is one of the highest-impact trust builders',
    impactWeight: 0.85, riskWeight: 0.05 },
  { dimension: 'cta_style', min: 60, target: 'primary action button',
    proposed: () => 'Primary CTA: full-width on mobile, high-contrast fill, clear action verb',
    rationale: 'Primary CTA clarity directly impacts conversion rate',
    impactWeight: 0.8, riskWeight: 0.15 },
  { dimension: 'color', min: 60, target: 'accent system',
    proposed: () => 'Define a 3-color accent system: primary action, secondary info, tertiary subtle',
    rationale: 'Systematic color use creates visual consistency and guides user behavior',
    impactWeight: 0.65, riskWeight: 0.1 },
  { dimension: 'motion', min: 60, target: 'page transitions',
    proposed: () => 'Add page-level transitions: crossfade between views, slide for navigation depth',
    rationale: 'Page transitions create spatial awareness and polish',
    impactWeight: 0.5, riskWeight: 0.3 },
  { dimension: 'density', max: 40, target: 'above-the-fold',
    proposed: () => 'Limit above-the-fold to one message, one visual, one CTA',
    rationale: 'Single-focus above-fold maximizes comprehension and action rate',
    impactWeight: 0.75, riskWeight: 0.1 },
  { dimension: 'copy_tone', min: 60, target: 'error and empty states',
    proposed: () => 'Use empathetic, solution-oriented copy for error and empty states',
    rationale: 'Tone-appropriate error states maintain trust during friction points',
    impactWeight: 0.4, riskWeight: 0.05 },
];

// ── Translator ──────────────────────────────────────────────────────────────

/**
 * Translate a vibe profile into concrete system decisions.
 * Fires all rules whose threshold matches the profile's axis values.
 */
export function translateVibeToDecisions(profile: VibeProfile): VibeSystemDecision[] {
  const decisions: VibeSystemDecision[] = [];

  for (const rule of RULES) {
    const value = profile.axes[rule.dimension] ?? 50;

    const aboveMin = rule.min === undefined || value >= rule.min;
    const belowMax = rule.max === undefined || value <= rule.max;

    if (aboveMin && belowMax) {
      decisions.push({
        dimension: rule.dimension,
        target: rule.target,
        proposed: rule.proposed(value),
        rationale: rule.rationale,
        impactScore: Math.round(rule.impactWeight * 100),
        riskScore: Math.round(rule.riskWeight * 100),
      });
    }
  }

  // Sort by impact descending, risk ascending
  decisions.sort((a, b) => {
    const impactDiff = b.impactScore - a.impactScore;
    if (impactDiff !== 0) return impactDiff;
    return a.riskScore - b.riskScore;
  });

  return decisions;
}

/**
 * Context-aware translation — includes a description of the current state
 * so the `current` field is populated on each decision.
 */
export function translateWithContext(
  profile: VibeProfile,
  existingState?: string,
): VibeSystemDecision[] {
  const decisions = translateVibeToDecisions(profile);

  if (existingState) {
    for (const d of decisions) {
      d.current = `Current: ${existingState} (${d.target})`;
    }
  }

  return decisions;
}

/**
 * Guardrail enforcement.
 *
 * Splits decisions into a safe set (riskScore <= threshold) and a list
 * of violations.  The vibe must serve the product.
 */
export function applyGuardrails(
  decisions: VibeSystemDecision[],
  config: VibeConfig = DEFAULT_VIBE_CONFIG,
): { safe: VibeSystemDecision[]; violations: string[] } {
  const safe: VibeSystemDecision[] = [];
  const violations: string[] = [];

  for (const d of decisions) {
    if (d.riskScore > config.guardrailThreshold) {
      violations.push(
        `[${d.dimension}] "${d.proposed}" — risk ${d.riskScore}/100 exceeds threshold ${config.guardrailThreshold}. ${d.rationale}`,
      );
    } else {
      safe.push(d);
    }
  }

  return { safe, violations };
}
