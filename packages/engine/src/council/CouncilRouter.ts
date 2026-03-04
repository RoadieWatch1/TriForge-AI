// ── CouncilRouter.ts ──────────────────────────────────────────────────────────
//
// Intent-based dynamic provider selection for the council.
//
// Uses lightweight keyword scoring (no API calls) to detect the type of request
// and selects the optimal provider order for each of the three council seats.
//
// Integration: call routeCouncil(message, pm) before CouncilConversationEngine
// in the chat:conversation handler. It sets the preferred provider order on the
// ProviderManager via setPreferredProviders(), which getActiveProviders() respects.
//
// The three-seat council UI is unchanged — only the order (and thus which
// provider gets which seat role) adapts to the detected intent.

import type { ProviderManager } from '../core/providerManager';
import type { ProviderName }     from '../protocol';

export type IntentType = 'coding' | 'strategy' | 'research' | 'creative' | 'default';

// ── Keyword banks ──────────────────────────────────────────────────────────────

const CODING_KW: string[] = [
  'code', 'function', 'bug', 'debug', 'implement', 'script', 'api',
  'database', 'typescript', 'javascript', 'python', 'class', 'component',
  'hook', 'query', 'refactor', 'test', 'endpoint', 'backend', 'frontend',
];

const STRATEGY_KW: string[] = [
  'strategy', 'plan', 'roadmap', 'business', 'launch', 'market', 'compete',
  'growth', 'pricing', 'revenue', 'startup', 'investor', 'acquisition',
  'monetize', 'scale', 'expansion', 'partnership',
];

const RESEARCH_KW: string[] = [
  'research', 'analyze', 'compare', 'study', 'explain', 'what is',
  'how does', 'why does', 'report', 'survey', 'overview', 'summarize',
  'difference between', 'pros and cons',
];

const CREATIVE_KW: string[] = [
  'write', 'create', 'design', 'brainstorm', 'idea', 'story', 'content',
  'copy', 'draft', 'blog', 'headline', 'tagline', 'pitch', 'narrative',
];

// ── Intent detection ──────────────────────────────────────────────────────────

/** Score a message against a keyword bank (count of matching keywords). */
function score(message: string, keywords: string[]): number {
  return keywords.filter(k => message.includes(k)).length;
}

/**
 * Detect the dominant intent type from a user message.
 * Returns 'default' when no keyword bank wins clearly.
 */
export function detectIntentType(message: string): IntentType {
  const lower = message.toLowerCase();

  const scores: [IntentType, number][] = [
    ['coding',   score(lower, CODING_KW)],
    ['strategy', score(lower, STRATEGY_KW)],
    ['research', score(lower, RESEARCH_KW)],
    ['creative', score(lower, CREATIVE_KW)],
  ];

  const winning = scores
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  return winning[0]?.[0] ?? 'default';
}

// ── Provider selection ────────────────────────────────────────────────────────

/**
 * Select the optimal council provider order for a given intent type.
 *
 * The UI still shows exactly three seats — the order determines which
 * provider anchors which seat role for this request.
 */
export function selectCouncil(intent: IntentType): ProviderName[] {
  switch (intent) {
    case 'coding':   return ['openai', 'claude', 'grok'];   // GPT-4o leads for code
    case 'strategy': return ['claude', 'grok', 'openai'];   // Claude leads for strategy
    case 'research': return ['claude', 'openai', 'grok'];   // Claude leads for research
    case 'creative': return ['claude', 'grok', 'openai'];   // Claude leads for creative
    default:         return ['claude', 'openai', 'grok'];   // Balanced default
  }
}

// ── One-call integration helper ───────────────────────────────────────────────

/**
 * Detect intent from the message and apply the resulting provider order to
 * the ProviderManager. Call once before CouncilConversationEngine.handleMessage().
 *
 * @returns The detected intent type (useful for logging / telemetry).
 */
export function routeCouncil(message: string, pm: ProviderManager): IntentType {
  const intent = detectIntentType(message);
  pm.setPreferredProviders(selectCouncil(intent));
  return intent;
}
