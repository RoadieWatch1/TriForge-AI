// ── main/trading/news/NewsEventClassifier.ts ───────────────────────────────────
//
// Keyword-based classification of economic events into impact tiers.
// Assigns default buffer windows (pre/post) per tier.
//
// Tier definitions:
//   top    — Market-moving releases. Block entries in buffer zone.
//   medium — Moderate-impact reports. Add risk flags / score downgrade.
//   low    — Minor data. Informational only.
//
// Classification uses case-insensitive keyword matching against event titles.
// Manual tier overrides in the calendar JSON take priority over this classifier.

import type { NewsTier } from '@triforge/engine';

// ── Keyword Lists ──────────────────────────────────────────────────────────

const TOP_TIER_KEYWORDS = [
  'fomc',
  'federal reserve',
  'fed chair',
  'fed decision',
  'rate decision',
  'nonfarm payroll', 'non-farm payroll', 'nfp',
  'cpi', 'consumer price index',
  'ppi', 'producer price index',
  'gdp', 'gross domestic product',
  'pce', 'personal consumption',
  'retail sales',
  'ism manufacturing', 'ism services', 'ism non-manufacturing',
  'employment situation',
  'adp employment',
];

const MEDIUM_TIER_KEYWORDS = [
  'initial claims', 'jobless claims', 'unemployment claims',
  'continuing claims',
  'durable goods',
  'housing starts',
  'existing home sales', 'new home sales',
  'pmi', 'purchasing managers',
  'consumer confidence',
  'michigan sentiment', 'consumer sentiment',
  'trade balance',
  'industrial production',
  'capacity utilization',
  'jolts', 'job openings',
  'building permits',
  'empire state', 'philly fed',
  'treasury auction',
  'beige book',
];

// ── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify an event by its title into a news tier.
 * Uses case-insensitive keyword matching.
 *
 * @param title - The event title string.
 * @returns The classified tier.
 */
export function classifyEvent(title: string): NewsTier {
  const lower = title.toLowerCase();

  for (const kw of TOP_TIER_KEYWORDS) {
    if (lower.includes(kw)) return 'top';
  }

  for (const kw of MEDIUM_TIER_KEYWORDS) {
    if (lower.includes(kw)) return 'medium';
  }

  return 'low';
}

// ── Buffer Windows ─────────────────────────────────────────────────────────

interface BufferWindow {
  /** Minutes to block/flag before the event. */
  before: number;
  /** Minutes to wait after the event before allowing fresh entries. */
  after: number;
}

/**
 * Assign default pre/post buffer windows based on tier.
 *
 * Top-tier:    5 min before, 3 min after (conservative — wait for reaction)
 * Medium-tier: 2 min before, 1 min after
 * Low-tier:    1 min before, 0 min after
 */
export function assignBuffers(tier: NewsTier): BufferWindow {
  switch (tier) {
    case 'top':    return { before: 5, after: 3 };
    case 'medium': return { before: 2, after: 1 };
    case 'low':    return { before: 1, after: 0 };
  }
}

// ── Exports for testing / introspection ────────────────────────────────────

export { TOP_TIER_KEYWORDS, MEDIUM_TIER_KEYWORDS };
