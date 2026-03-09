// ── ventureScoringEngine.ts — Weighted scoring + trend classification ────────
//
// Scores venture candidates across 9 dimensions using weighted averages.
// Classifies market signals into trend types (flash / wave / evergreen).
// Ranks candidates by composite score for council evaluation.

import type { VentureCandidate, VentureScores, MarketSignal, TrendClass } from './ventureTypes';
import type { VentureCategoryConfig } from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

// ── Scoring weights (must sum to 1.0) ────────────────────────────────────────

const WEIGHTS = {
  popularityNow:       0.15,
  longevity:           0.10,
  budgetFit:           0.15,
  timeToTraction:      0.12,
  remoteWorkFit:       0.08,
  dailyPromoFit:       0.10,
  executionComplexity: 0.08,
  revenuePotential:    0.12,
  risk:                0.10,
} as const;

// ── Trend classification ─────────────────────────────────────────────────────

/** Classify a set of market signals into a trend class. */
export function classifyTrend(signals: MarketSignal[]): TrendClass {
  if (signals.length === 0) return 'evergreen';

  const avgRelevance = signals.reduce((s, sig) => s + sig.relevance, 0) / signals.length;

  // Flash: very high relevance + few signals (viral but thin)
  if (avgRelevance > 0.8 && signals.length <= 3) return 'flash';

  // Wave: strong relevance + decent signal depth
  if (avgRelevance > 0.55 && signals.length >= 3) return 'wave';

  // Evergreen: moderate or low relevance — stable, not trending
  return 'evergreen';
}

// ── Score a single candidate ─────────────────────────────────────────────────

/**
 * Apply learning biases to scoring weights.
 * Multiplies each weight by the corresponding bias value.
 * Missing biases default to 1.0 (no change).
 */
export function applyLearningBiases(
  weights: Record<string, number>,
  biases: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  let total = 0;
  for (const [key, w] of Object.entries(weights)) {
    const biased = w * (biases[key] ?? 1.0);
    result[key] = biased;
    total += biased;
  }
  // Re-normalize so weights still sum to ~1.0
  if (total > 0) {
    for (const key of Object.keys(result)) {
      result[key] = result[key] / total;
    }
  }
  return result;
}

/**
 * Score a venture candidate against budget and signals.
 * Returns individual dimension scores (0-100) plus a weighted composite.
 * Optional learningBiases multiplies weights — backward compatible (no biases = no change).
 */
export function scoreCandidate(
  candidate: VentureCandidate,
  budget: number,
  signals: MarketSignal[],
  learningBiases?: Record<string, number>,
): VentureScores {
  const cat = getCategoryConfig(candidate.category);

  const popularityNow = scorePopularity(signals, candidate);
  const longevity = scoreLongevity(candidate.trendClass);
  const budgetFit = scoreBudgetFit(budget, cat);
  const timeToTraction = scoreTimeTo(cat);
  const remoteWorkFit = 85; // all venture types are remote-friendly by design
  const dailyPromoFit = cat?.dailyPromoSuitability ?? 60;
  const executionComplexity = scoreComplexity(cat);
  const revenuePotential = scoreRevenuePotential(candidate, cat);
  const risk = scoreRisk(cat, budget);

  // Apply learning biases if provided
  const w = learningBiases
    ? applyLearningBiases({ ...WEIGHTS } as Record<string, number>, learningBiases)
    : WEIGHTS;

  const composite = Math.round(
    popularityNow       * (w.popularityNow ?? WEIGHTS.popularityNow) +
    longevity           * (w.longevity ?? WEIGHTS.longevity) +
    budgetFit           * (w.budgetFit ?? WEIGHTS.budgetFit) +
    timeToTraction      * (w.timeToTraction ?? WEIGHTS.timeToTraction) +
    remoteWorkFit       * (w.remoteWorkFit ?? WEIGHTS.remoteWorkFit) +
    dailyPromoFit       * (w.dailyPromoFit ?? WEIGHTS.dailyPromoFit) +
    (100 - executionComplexity) * (w.executionComplexity ?? WEIGHTS.executionComplexity) +
    revenuePotential    * (w.revenuePotential ?? WEIGHTS.revenuePotential) +
    (100 - risk)        * (w.risk ?? WEIGHTS.risk)
  );

  return {
    popularityNow,
    longevity,
    budgetFit,
    timeToTraction,
    remoteWorkFit,
    dailyPromoFit,
    executionComplexity,
    revenuePotential,
    risk,
    composite,
  };
}

// ── Rank candidates ──────────────────────────────────────────────────────────

/** Sort candidates by composite score, highest first. */
export function rankCandidates(candidates: VentureCandidate[]): VentureCandidate[] {
  return [...candidates].sort((a, b) => b.scores.composite - a.scores.composite);
}

// ── Individual scoring functions ─────────────────────────────────────────────

function scorePopularity(signals: MarketSignal[], candidate: VentureCandidate): number {
  if (signals.length === 0) return 40;

  // Relevance of signals associated with this candidate
  const relevant = signals.filter(s => s.relevance > 0.3);
  const avgRelevance = relevant.length > 0
    ? relevant.reduce((sum, s) => sum + s.relevance, 0) / relevant.length
    : 0.3;

  // Trend class boost
  const trendBoost = candidate.trendClass === 'flash' ? 20
    : candidate.trendClass === 'wave' ? 10 : 0;

  return Math.min(100, Math.round(avgRelevance * 80 + trendBoost));
}

function scoreLongevity(trendClass: TrendClass): number {
  switch (trendClass) {
    case 'evergreen': return 90;
    case 'wave':      return 65;
    case 'flash':     return 30;
  }
}

function scoreBudgetFit(budget: number, cat?: VentureCategoryConfig): number {
  if (!cat) return 50;
  const [min, max] = cat.startupCostRange;

  // Budget covers entire range with room to spare — great fit
  if (budget >= max * 1.5) return 95;
  if (budget >= max) return 85;
  if (budget >= (min + max) / 2) return 70;
  if (budget >= min) return 55;

  // Budget below minimum — poor fit
  return Math.max(10, Math.round((budget / min) * 40));
}

function scoreTimeTo(cat?: VentureCategoryConfig): number {
  if (!cat) return 50;
  // Parse timeToFirstRevenue: "1-3 weeks" → average weeks
  const match = cat.timeToFirstRevenue.match(/(\d+)-(\d+)/);
  if (!match) return 50;
  const avgWeeks = (parseInt(match[1]) + parseInt(match[2])) / 2;

  if (avgWeeks <= 2) return 95;
  if (avgWeeks <= 4) return 80;
  if (avgWeeks <= 8) return 60;
  return 40;
}

function scoreComplexity(cat?: VentureCategoryConfig): number {
  if (!cat) return 50;
  // Inverse of automation suitability: higher automation = lower complexity
  return 100 - cat.automationSuitability;
}

function scoreRevenuePotential(candidate: VentureCandidate, cat?: VentureCategoryConfig): number {
  if (!cat) return 50;

  const modePotential: Record<string, number> = {
    fast_cash: 55,
    brand_build: 75,
    authority_build: 85,
    experimental: 60,
    passive_engine: 70,
  };

  const base = modePotential[candidate.ventureMode] ?? 60;

  // Boost for categories with more monetization paths
  const pathBoost = Math.min(20, (cat.monetizationPaths.length - 2) * 5);

  return Math.min(100, base + pathBoost);
}

function scoreRisk(cat?: VentureCategoryConfig, budget?: number): number {
  if (!cat) return 50;

  const riskMap: Record<string, number> = {
    low: 20,
    medium: 50,
    high: 75,
  };

  let base = riskMap[cat.riskLevel] ?? 50;

  // Higher startup cost relative to budget = more risk
  if (budget && budget > 0) {
    const costRatio = cat.startupCostRange[1] / budget;
    if (costRatio > 0.8) base += 15;
    else if (costRatio > 0.5) base += 5;
  }

  return Math.min(100, base);
}
