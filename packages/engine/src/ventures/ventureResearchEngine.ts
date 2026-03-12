// ── ventureResearchEngine.ts — Market research + candidate extraction ────────
//
// Runs parallel web searches to gather market signals, then uses an AI provider
// to extract scored venture candidates from those signals + the catalog.

import type { MarketSignal, VentureCandidate, VentureMode, VentureCategory } from './ventureTypes';
import { searchWeb } from '../tools/webSearch';
import { VENTURE_CATALOG, getCategoriesForBudget } from './ventureCatalog';
import { classifyTrend, scoreCandidate } from './ventureScoringEngine';

// ── Research queries ─────────────────────────────────────────────────────────

function buildSearchQueries(budget: number): string[] {
  const year = new Date().getFullYear();
  return [
    `best online business ideas ${year} low startup cost`,
    `trending side hustles ${year} under $${budget}`,
    `most profitable digital businesses ${year}`,
    `faceless YouTube channel ideas ${year}`,
    `newsletter business opportunities ${year}`,
    `micro SaaS ideas trending ${year}`,
    `best content brand niches ${year}`,
    `passive income ideas remote ${year}`,
  ];
}

// ── Market research ──────────────────────────────────────────────────────────

/**
 * Run 5-8 parallel web searches and aggregate signals.
 * Returns deduplicated, relevance-scored market signals.
 */
export async function researchMarket(budget: number): Promise<MarketSignal[]> {
  const queries = buildSearchQueries(budget);

  // Run all searches in parallel
  const results = await Promise.allSettled(
    queries.map(q => searchWeb(q, 5))
  );

  const signals: MarketSignal[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;

    for (const hit of result.value) {
      if (seenUrls.has(hit.url)) continue;
      seenUrls.add(hit.url);

      signals.push({
        source: new URL(hit.url).hostname,
        title: hit.title,
        snippet: hit.snippet,
        url: hit.url,
        relevance: estimateRelevance(hit.title, hit.snippet, budget),
      });
    }
  }

  // Sort by relevance, keep top 30
  return signals
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 30);
}

// ── Candidate extraction ─────────────────────────────────────────────────────

/**
 * Use an AI provider to extract venture candidates from market signals + catalog.
 * Falls back to heuristic extraction if AI fails.
 */
export async function extractCandidates(
  signals: MarketSignal[],
  budget: number,
  provider?: { chat(messages: { role: string; content: string }[]): Promise<string> },
): Promise<VentureCandidate[]> {
  const eligibleCategories = getCategoriesForBudget(budget);

  if (provider) {
    try {
      return await aiExtractCandidates(signals, budget, eligibleCategories, provider);
    } catch {
      // Fall through to heuristic
    }
  }

  return heuristicExtractCandidates(signals, budget, eligibleCategories);
}

// ── AI-powered extraction ────────────────────────────────────────────────────

async function aiExtractCandidates(
  signals: MarketSignal[],
  budget: number,
  eligibleCategories: typeof VENTURE_CATALOG extends readonly (infer T)[] ? T[] : never,
  provider: { chat(messages: { role: string; content: string }[]): Promise<string> },
): Promise<VentureCandidate[]> {
  const categoryNames = eligibleCategories.map(c => c.category).join(', ');
  const signalSummary = signals.slice(0, 15).map(s => `- ${s.title}: ${s.snippet}`).join('\n');

  const prompt = `You are a venture analyst. Based on these market signals and a budget of $${budget}, identify 6-8 specific venture concepts.

Available categories: ${categoryNames}

Market signals:
${signalSummary}

For each venture, return a JSON array of objects with:
- concept: specific business idea (not generic category name)
- category: one of the available categories
- ventureMode: one of fast_cash, brand_build, authority_build, experimental, passive_engine

Return ONLY a valid JSON array, no markdown.`;

  const response = await provider.chat([
    { role: 'system', content: 'You are a venture analyst. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ]);

  // Parse JSON from response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response');

  const parsed: Array<{ concept: string; category: string; ventureMode: string }> = JSON.parse(jsonMatch[0]);

  return parsed
    .filter(p => eligibleCategories.some(c => c.category === p.category))
    .map((p, i) => {
      const trendClass = classifyTrend(signals.filter(s => s.relevance > 0.4));
      const candidate: VentureCandidate = {
        id: `vc-${Date.now()}-${i}`,
        category: p.category as VentureCategory,
        concept: p.concept,
        trendClass,
        ventureMode: (p.ventureMode || 'brand_build') as VentureMode,
        scores: { popularityNow: 0, longevity: 0, budgetFit: 0, timeToTraction: 0, remoteWorkFit: 0, dailyPromoFit: 0, executionComplexity: 0, revenuePotential: 0, risk: 0, composite: 0 },
        signals: signals.filter(s => s.relevance > 0.3).slice(0, 5),
      };
      candidate.scores = scoreCandidate(candidate, budget, candidate.signals);
      return candidate;
    });
}

// ── Heuristic fallback ───────────────────────────────────────────────────────

function heuristicExtractCandidates(
  signals: MarketSignal[],
  budget: number,
  eligibleCategories: typeof VENTURE_CATALOG extends readonly (infer T)[] ? T[] : never,
): VentureCandidate[] {
  // Generate one candidate per eligible category
  return eligibleCategories.slice(0, 8).map((cat, i) => {
    const trendClass = classifyTrend(signals);
    const ventureMode: VentureMode = cat.automationSuitability > 80 ? 'passive_engine'
      : cat.dailyPromoSuitability > 75 ? 'brand_build'
      : 'fast_cash';

    const candidate: VentureCandidate = {
      id: `vc-${Date.now()}-${i}`,
      category: cat.category,
      concept: `${cat.label} — ${cat.description.split('.')[0]}`,
      trendClass,
      ventureMode,
      scores: { popularityNow: 0, longevity: 0, budgetFit: 0, timeToTraction: 0, remoteWorkFit: 0, dailyPromoFit: 0, executionComplexity: 0, revenuePotential: 0, risk: 0, composite: 0 },
      signals: signals.slice(0, 3),
    };
    candidate.scores = scoreCandidate(candidate, budget, candidate.signals);
    return candidate;
  });
}

// ── Relevance estimation ─────────────────────────────────────────────────────

function estimateRelevance(title: string, snippet: string, budget: number): number {
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 0.3; // baseline

  // Business-related keywords boost
  const businessTerms = [
    'business', 'startup', 'income', 'profit', 'revenue', 'money',
    'side hustle', 'online', 'digital', 'passive', 'newsletter',
    'saas', 'ecommerce', 'affiliate', 'content', 'brand', 'niche',
  ];
  for (const term of businessTerms) {
    if (text.includes(term)) score += 0.05;
  }

  // Budget alignment
  const dollarMatch = text.match(/\$(\d+)/g);
  if (dollarMatch) {
    for (const m of dollarMatch) {
      const val = parseInt(m.replace('$', ''));
      if (val <= budget * 1.2) score += 0.1;
    }
  }

  // Current year mention
  const year = new Date().getFullYear();
  if (text.includes(String(year))) score += 0.1;

  // Trending / now terms
  if (/trending|latest|new|hot|best/.test(text)) score += 0.05;

  return Math.min(1, score);
}
