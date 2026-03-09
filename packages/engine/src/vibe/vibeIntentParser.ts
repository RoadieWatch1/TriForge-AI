// ── vibeIntentParser.ts — Parse aesthetic language into structured signals ────
//
// Turns loose human language ("make this feel premium", "give it a boardroom
// vibe") into typed VibeSignal[] that downstream systems can reason about.

import type { VibeDimension, VibeMode, VibeSignal } from './vibeTypes';

// ── Phrase mapping ──────────────────────────────────────────────────────────

interface PhraseMapping {
  phrases: string[];
  dimension: VibeDimension;
  direction: 'increase' | 'decrease' | 'set';
  intensity: number;      // 0-100
}

// ── Archetype phrase tables ─────────────────────────────────────────────────

const PREMIUM_SIGNALS: PhraseMapping[] = [
  { phrases: ['premium', 'luxury', 'high-end', 'upscale', 'refined', 'expensive'],
    dimension: 'spacing',          direction: 'increase', intensity: 75 },
  { phrases: ['premium', 'luxury', 'high-end', 'upscale', 'refined'],
    dimension: 'typography',       direction: 'increase', intensity: 70 },
  { phrases: ['premium', 'luxury', 'high-end'],
    dimension: 'density',          direction: 'decrease', intensity: 65 },
  { phrases: ['premium', 'luxury', 'expensive'],
    dimension: 'cta_style',        direction: 'decrease', intensity: 55 },
  { phrases: ['premium', 'luxury', 'high-end', 'refined'],
    dimension: 'trust_indicators', direction: 'increase', intensity: 60 },
];

const BOARDROOM_SIGNALS: PhraseMapping[] = [
  { phrases: ['boardroom', 'corporate', 'enterprise', 'professional', 'executive'],
    dimension: 'copy_tone',        direction: 'increase', intensity: 80 },
  { phrases: ['boardroom', 'corporate', 'executive'],
    dimension: 'layout',           direction: 'increase', intensity: 70 },
  { phrases: ['boardroom', 'enterprise', 'professional'],
    dimension: 'trust_indicators', direction: 'increase', intensity: 75 },
  { phrases: ['boardroom', 'corporate', 'executive'],
    dimension: 'motion',           direction: 'decrease', intensity: 60 },
  { phrases: ['boardroom', 'enterprise'],
    dimension: 'density',          direction: 'increase', intensity: 65 },
];

const CINEMATIC_SIGNALS: PhraseMapping[] = [
  { phrases: ['cinematic', 'dramatic', 'epic', 'theatrical', 'atmospheric'],
    dimension: 'motion',           direction: 'increase', intensity: 80 },
  { phrases: ['cinematic', 'dramatic', 'epic'],
    dimension: 'color',            direction: 'increase', intensity: 75 },
  { phrases: ['cinematic', 'dramatic', 'atmospheric'],
    dimension: 'typography',       direction: 'increase', intensity: 70 },
  { phrases: ['cinematic', 'dramatic'],
    dimension: 'spacing',          direction: 'increase', intensity: 65 },
  { phrases: ['cinematic', 'atmospheric'],
    dimension: 'imagery',          direction: 'increase', intensity: 80 },
];

const PLAYFUL_SIGNALS: PhraseMapping[] = [
  { phrases: ['playful', 'fun', 'friendly', 'casual', 'whimsical', 'lighthearted'],
    dimension: 'motion',           direction: 'increase', intensity: 70 },
  { phrases: ['playful', 'fun', 'friendly', 'casual'],
    dimension: 'copy_tone',        direction: 'decrease', intensity: 65 },
  { phrases: ['playful', 'fun', 'whimsical'],
    dimension: 'color',            direction: 'increase', intensity: 70 },
  { phrases: ['playful', 'fun', 'casual'],
    dimension: 'cta_style',        direction: 'increase', intensity: 60 },
  { phrases: ['playful', 'whimsical'],
    dimension: 'imagery',          direction: 'increase', intensity: 65 },
];

const MINIMAL_SIGNALS: PhraseMapping[] = [
  { phrases: ['minimal', 'minimalist', 'clean', 'simple', 'stripped', 'sparse'],
    dimension: 'density',          direction: 'decrease', intensity: 80 },
  { phrases: ['minimal', 'clean', 'simple'],
    dimension: 'spacing',          direction: 'increase', intensity: 75 },
  { phrases: ['minimal', 'minimalist', 'clean'],
    dimension: 'motion',           direction: 'decrease', intensity: 60 },
  { phrases: ['minimal', 'clean', 'simple'],
    dimension: 'color',            direction: 'decrease', intensity: 55 },
  { phrases: ['minimal', 'clean'],
    dimension: 'imagery',          direction: 'decrease', intensity: 50 },
];

const URGENT_SIGNALS: PhraseMapping[] = [
  { phrases: ['urgent', 'aggressive', 'high-energy', 'bold', 'punchy', 'impactful'],
    dimension: 'cta_style',        direction: 'increase', intensity: 85 },
  { phrases: ['urgent', 'aggressive', 'high-energy'],
    dimension: 'color',            direction: 'increase', intensity: 70 },
  { phrases: ['urgent', 'aggressive', 'bold', 'punchy'],
    dimension: 'typography',       direction: 'increase', intensity: 75 },
  { phrases: ['urgent', 'high-energy'],
    dimension: 'motion',           direction: 'increase', intensity: 65 },
  { phrases: ['urgent', 'aggressive'],
    dimension: 'density',          direction: 'increase', intensity: 60 },
];

const TRUSTWORTHY_SIGNALS: PhraseMapping[] = [
  { phrases: ['trustworthy', 'reliable', 'safe', 'secure', 'credible', 'dependable'],
    dimension: 'trust_indicators', direction: 'increase', intensity: 90 },
  { phrases: ['trustworthy', 'reliable', 'safe'],
    dimension: 'layout',           direction: 'increase', intensity: 65 },
  { phrases: ['trustworthy', 'credible', 'dependable'],
    dimension: 'copy_tone',        direction: 'increase', intensity: 70 },
  { phrases: ['trustworthy', 'safe', 'secure'],
    dimension: 'motion',           direction: 'decrease', intensity: 50 },
  { phrases: ['trustworthy', 'reliable'],
    dimension: 'color',            direction: 'decrease', intensity: 40 },
];

const STEALTH_SIGNALS: PhraseMapping[] = [
  { phrases: ['stealth', 'stealthy', 'discreet', 'understated', 'subtle', 'quiet'],
    dimension: 'motion',           direction: 'decrease', intensity: 75 },
  { phrases: ['stealth', 'stealthy', 'discreet'],
    dimension: 'cta_style',        direction: 'decrease', intensity: 70 },
  { phrases: ['stealth', 'understated', 'subtle'],
    dimension: 'color',            direction: 'decrease', intensity: 60 },
  { phrases: ['stealth', 'discreet', 'quiet'],
    dimension: 'density',          direction: 'decrease', intensity: 55 },
  { phrases: ['stealth', 'stealthy'],
    dimension: 'copy_tone',        direction: 'increase', intensity: 60 },
];

const BOLD_SIGNALS: PhraseMapping[] = [
  { phrases: ['bold', 'daring', 'fearless', 'edgy', 'provocative', 'striking'],
    dimension: 'typography',       direction: 'increase', intensity: 80 },
  { phrases: ['bold', 'daring', 'edgy', 'provocative'],
    dimension: 'color',            direction: 'increase', intensity: 75 },
  { phrases: ['bold', 'striking', 'edgy'],
    dimension: 'cta_style',        direction: 'increase', intensity: 70 },
  { phrases: ['bold', 'daring', 'fearless'],
    dimension: 'spacing',          direction: 'increase', intensity: 55 },
  { phrases: ['bold', 'provocative'],
    dimension: 'imagery',          direction: 'increase', intensity: 65 },
];

const FINTECH_SIGNALS: PhraseMapping[] = [
  { phrases: ['fintech', 'financial', 'banking', 'trading', 'investment'],
    dimension: 'trust_indicators', direction: 'increase', intensity: 85 },
  { phrases: ['fintech', 'financial', 'trading'],
    dimension: 'density',          direction: 'increase', intensity: 70 },
  { phrases: ['fintech', 'banking', 'investment'],
    dimension: 'copy_tone',        direction: 'increase', intensity: 75 },
  { phrases: ['fintech', 'financial'],
    dimension: 'motion',           direction: 'decrease', intensity: 55 },
  { phrases: ['fintech', 'trading'],
    dimension: 'layout',           direction: 'increase', intensity: 65 },
];

const CALM_SIGNALS: PhraseMapping[] = [
  { phrases: ['calm', 'serene', 'peaceful', 'zen', 'relaxed', 'tranquil', 'soothing'],
    dimension: 'motion',           direction: 'decrease', intensity: 70 },
  { phrases: ['calm', 'serene', 'peaceful'],
    dimension: 'spacing',          direction: 'increase', intensity: 70 },
  { phrases: ['calm', 'zen', 'relaxed'],
    dimension: 'color',            direction: 'decrease', intensity: 55 },
  { phrases: ['calm', 'serene', 'tranquil'],
    dimension: 'density',          direction: 'decrease', intensity: 65 },
  { phrases: ['calm', 'soothing'],
    dimension: 'cta_style',        direction: 'decrease', intensity: 50 },
];

// All phrase mapping tables combined
const ALL_SIGNALS: PhraseMapping[] = [
  ...PREMIUM_SIGNALS,
  ...BOARDROOM_SIGNALS,
  ...CINEMATIC_SIGNALS,
  ...PLAYFUL_SIGNALS,
  ...MINIMAL_SIGNALS,
  ...URGENT_SIGNALS,
  ...TRUSTWORTHY_SIGNALS,
  ...STEALTH_SIGNALS,
  ...BOLD_SIGNALS,
  ...FINTECH_SIGNALS,
  ...CALM_SIGNALS,
];

// ── Mode detection keywords ─────────────────────────────────────────────────

const EXPLORE_KW = [
  'explore', 'explore directions', 'give me options', 'what vibe should',
  'suggest a vibe', 'try different vibes', 'brainstorm', 'what could this look like',
];

const REFINE_KW = [
  'refine', 'polish', 'clean up', 'make this cleaner', 'tighten up',
  'make this better', 'improve the look', 'elevate', 'upgrade the feel',
];

const BUILD_KW = [
  'build', 'implement', 'make it look like', 'update this to feel',
  'apply this vibe', 'redesign', 'restyle', 'transform',
];

const AUDIT_KW = [
  'audit', 'check the vibe', 'vibe check', 'does this feel',
  'why does this feel off', 'is this consistent', 'audit the design',
  'review the feel', 'assess the vibe',
];

const RESCUE_KW = [
  'rescue', 'fix the vibe', 'this looks broken', 'this feels cheap',
  'this feels messy', 'this feels all over the place', 'fix the design',
  'this looks bundled', 'recover', 'salvage',
];

// ── Vibe request detection keywords ─────────────────────────────────────────

const VIBE_REQUEST_KW = [
  'vibe', 'feel', 'aesthetic', 'look and feel', 'visual identity',
  'brand feel', 'tone of voice', 'make this feel', 'give it a',
  'make it feel', 'make it look', 'premium feel', 'boardroom',
  'vibe check', 'rescue this design', 'audit the vibe',
  'refine the look', 'explore directions', 'design direction',
  'product personality', 'business mood', 'experience goal',
  'more polished', 'more premium', 'more trustworthy',
  'cleaner', 'calmer', 'more powerful', 'more cinematic',
  'more professional', 'more corporate', 'more playful',
  'more minimal', 'more bold', 'more confident', 'more stealthy',
];

// ── Core parser ─────────────────────────────────────────────────────────────

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some(kw => text.includes(kw));
}

/**
 * Parse loose aesthetic language into structured vibe signals.
 *
 * Scans the input for known archetype phrases and produces a set of
 * (dimension, direction, intensity) tuples.  Signals are deduplicated
 * per dimension — the highest-confidence match wins.
 */
export function parseVibeIntent(input: string): VibeSignal[] {
  const lower = input.toLowerCase();
  const matches: VibeSignal[] = [];

  for (const mapping of ALL_SIGNALS) {
    for (const phrase of mapping.phrases) {
      if (lower.includes(phrase)) {
        matches.push({
          raw: phrase,
          dimension: mapping.dimension,
          direction: mapping.direction,
          intensity: mapping.intensity,
          confidence: phrase.length > 6 ? 85 : 70,
        });
        break; // one match per mapping is enough
      }
    }
  }

  // Deduplicate: keep highest confidence per dimension
  const best = new Map<VibeDimension, VibeSignal>();
  for (const signal of matches) {
    const existing = best.get(signal.dimension);
    if (!existing || signal.confidence > existing.confidence ||
        (signal.confidence === existing.confidence && signal.intensity > existing.intensity)) {
      best.set(signal.dimension, signal);
    }
  }

  return Array.from(best.values());
}

/**
 * Detect which vibe mode the user is requesting.
 * Returns null if no mode is detected (default to 'build').
 */
export function detectVibeMode(input: string): VibeMode | null {
  const lower = input.toLowerCase();

  if (matchesAny(lower, RESCUE_KW))  return 'rescue';
  if (matchesAny(lower, AUDIT_KW))   return 'audit';
  if (matchesAny(lower, EXPLORE_KW)) return 'explore';
  if (matchesAny(lower, REFINE_KW))  return 'refine';
  if (matchesAny(lower, BUILD_KW))   return 'build';

  return null;
}

/**
 * Gate function: returns true if the message looks like a vibe request.
 * Used by CouncilRouter to route through the vibe system.
 */
export function isVibeRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return matchesAny(lower, VIBE_REQUEST_KW);
}
