// ── main/trading/learning/SetupWeightCalibrator.ts ──────────────────────────────
//
// Analyzes journal data to produce advisory weight adjustment suggestions.
// Does NOT auto-apply any changes. All suggestions are read-only recommendations
// that require explicit user acceptance.
//
// Looks for patterns like:
//   - Level types with consistently different performance
//   - Confirmation families that underperform
//   - Session windows/regimes where setups underperform
//   - Score bands that don't correlate with outcomes
//
// Requires a minimum sample size before generating suggestions to avoid
// noise-driven recommendations.
//
// SIMULATION ONLY.

import type { WeightAdjustment } from '@triforge/engine';
import type { ExtendedJournalEntry } from './TradeJournalStore';
import { computeExpectancy, type BucketStats } from './PerformanceAnalytics';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Minimum number of total journal entries before calibration runs.
 * Below this threshold, there isn't enough data for meaningful suggestions.
 */
const MIN_TOTAL_ENTRIES = 20;

/**
 * Minimum number of trades in a bucket before it is eligible
 * for weight comparison. Avoids noise from small samples.
 */
const MIN_BUCKET_TRADES = 5;

/**
 * Minimum expectancy difference (in R) between buckets to trigger a suggestion.
 */
const MIN_EXPECTANCY_DIFF = 0.15;

/**
 * Minimum win rate difference between buckets to trigger a suggestion.
 */
const MIN_WIN_RATE_DIFF = 0.10;

// ── Calibrator ──────────────────────────────────────────────────────────────

/**
 * Analyze journal entries and produce advisory weight adjustment suggestions.
 *
 * @param entries - All journal entries to analyze.
 * @returns Array of weight adjustment suggestions (may be empty).
 */
export function calibrateWeights(
  entries: ExtendedJournalEntry[],
): WeightAdjustment[] {
  if (entries.length < MIN_TOTAL_ENTRIES) return [];

  const suggestions: WeightAdjustment[] = [];

  // Analyze level type performance
  suggestions.push(..._analyzeLevelTypes(entries));

  // Analyze confirmation type performance
  suggestions.push(..._analyzeConfirmationTypes(entries));

  // Analyze session regime performance
  suggestions.push(..._analyzeSessionRegimes(entries));

  // Analyze session window performance
  suggestions.push(..._analyzeSessionWindows(entries));

  // Analyze score band correlation
  suggestions.push(..._analyzeScoreBandCorrelation(entries));

  return suggestions;
}

// ── Level Type Analysis ─────────────────────────────────────────────────────

function _analyzeLevelTypes(entries: ExtendedJournalEntry[]): WeightAdjustment[] {
  const { overall, buckets } = computeExpectancy(entries, 'levelType');
  const eligible = buckets.filter(b => b.trades >= MIN_BUCKET_TRADES);
  if (eligible.length < 2) return [];

  const suggestions: WeightAdjustment[] = [];

  for (const bucket of eligible) {
    const diff = bucket.expectancy - overall.expectancy;

    if (Math.abs(diff) >= MIN_EXPECTANCY_DIFF) {
      const direction = diff > 0 ? 'outperforming' : 'underperforming';
      const adjustment = diff > 0 ? 'upweight' : 'downweight';

      suggestions.push({
        factor: `level_type:${bucket.bucket}`,
        currentWeight: 0, // Weights are not directly accessible here
        suggestedWeight: 0,
        evidence:
          `${bucket.bucket} levels are ${direction} overall: ` +
          `expectancy ${_fmtR(bucket.expectancy)} vs ${_fmtR(overall.expectancy)} overall ` +
          `(${bucket.trades} trades, ${_fmtPct(bucket.winRate)} win rate). ` +
          `Consider ${adjustment}ing ${bucket.bucket} level quality scores.`,
        confidence: _confidenceFromSample(bucket.trades, Math.abs(diff)),
      });
    }
  }

  return suggestions;
}

// ── Confirmation Type Analysis ──────────────────────────────────────────────

function _analyzeConfirmationTypes(entries: ExtendedJournalEntry[]): WeightAdjustment[] {
  const { overall, buckets } = computeExpectancy(entries, 'confirmationType');
  const eligible = buckets.filter(b => b.trades >= MIN_BUCKET_TRADES);
  if (eligible.length < 2) return [];

  const suggestions: WeightAdjustment[] = [];

  for (const bucket of eligible) {
    const diff = bucket.expectancy - overall.expectancy;

    if (Math.abs(diff) >= MIN_EXPECTANCY_DIFF) {
      const direction = diff > 0 ? 'outperforming' : 'underperforming';
      const adjustment = diff > 0 ? 'increase' : 'decrease';

      suggestions.push({
        factor: `confirmation:${bucket.bucket}`,
        currentWeight: 0,
        suggestedWeight: 0,
        evidence:
          `${bucket.bucket.replace(/_/g, ' ')} confirmation is ${direction}: ` +
          `expectancy ${_fmtR(bucket.expectancy)} vs ${_fmtR(overall.expectancy)} overall ` +
          `(${bucket.trades} trades, ${_fmtPct(bucket.winRate)} win rate). ` +
          `Consider ${adjustment} of confirmation weight for ${bucket.bucket.replace(/_/g, ' ')}.`,
        confidence: _confidenceFromSample(bucket.trades, Math.abs(diff)),
      });
    }
  }

  return suggestions;
}

// ── Session Regime Analysis ─────────────────────────────────────────────────

function _analyzeSessionRegimes(entries: ExtendedJournalEntry[]): WeightAdjustment[] {
  const { overall, buckets } = computeExpectancy(entries, 'sessionRegime');
  const eligible = buckets.filter(b => b.trades >= MIN_BUCKET_TRADES);
  if (eligible.length < 2) return [];

  const suggestions: WeightAdjustment[] = [];

  for (const bucket of eligible) {
    // Only flag underperformers — regime awareness is informational
    if (bucket.expectancy < overall.expectancy - MIN_EXPECTANCY_DIFF) {
      suggestions.push({
        factor: `regime:${bucket.bucket}`,
        currentWeight: 0,
        suggestedWeight: 0,
        evidence:
          `Trades during ${bucket.bucket.replace(/_/g, ' ')} sessions underperform: ` +
          `expectancy ${_fmtR(bucket.expectancy)} vs ${_fmtR(overall.expectancy)} overall ` +
          `(${bucket.trades} trades, ${_fmtPct(bucket.winRate)} win rate). ` +
          `Consider reducing aggression or raising score threshold during ${bucket.bucket.replace(/_/g, ' ')} regimes.`,
        confidence: _confidenceFromSample(bucket.trades, Math.abs(bucket.expectancy - overall.expectancy)),
      });
    }
  }

  return suggestions;
}

// ── Session Window Analysis ─────────────────────────────────────────────────

function _analyzeSessionWindows(entries: ExtendedJournalEntry[]): WeightAdjustment[] {
  const { overall, buckets } = computeExpectancy(entries, 'sessionWindow');
  const eligible = buckets.filter(b => b.trades >= MIN_BUCKET_TRADES);
  if (eligible.length < 2) return [];

  const suggestions: WeightAdjustment[] = [];

  for (const bucket of eligible) {
    if (bucket.expectancy < overall.expectancy - MIN_EXPECTANCY_DIFF) {
      suggestions.push({
        factor: `session:${bucket.bucket}`,
        currentWeight: 0,
        suggestedWeight: 0,
        evidence:
          `Trades during ${bucket.bucket} window underperform: ` +
          `expectancy ${_fmtR(bucket.expectancy)} vs ${_fmtR(overall.expectancy)} overall ` +
          `(${bucket.trades} trades, ${_fmtPct(bucket.winRate)} win rate). ` +
          `Consider downweighting session score for ${bucket.bucket} window or raising entry threshold.`,
        confidence: _confidenceFromSample(bucket.trades, Math.abs(bucket.expectancy - overall.expectancy)),
      });
    }
  }

  return suggestions;
}

// ── Score Band Correlation Check ────────────────────────────────────────────

function _analyzeScoreBandCorrelation(entries: ExtendedJournalEntry[]): WeightAdjustment[] {
  const { buckets } = computeExpectancy(entries, 'scoreBand');
  const eligible = buckets.filter(b => b.trades >= MIN_BUCKET_TRADES);
  if (eligible.length < 2) return [];

  // Expected: higher score bands should have higher expectancy
  // If a lower band outperforms a higher band, the scoring model has a problem
  const bandOrder: Record<string, number> = {
    'elite': 4, 'A': 3, 'B': 2, 'no_trade': 1,
  };

  const sorted = [...eligible].sort(
    (a, b) => (bandOrder[b.bucket] ?? 0) - (bandOrder[a.bucket] ?? 0),
  );

  const suggestions: WeightAdjustment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const higher = sorted[i];
    const lower = sorted[i + 1];

    // If the lower band has better expectancy, scoring model may be miscalibrated
    if (lower.expectancy > higher.expectancy + MIN_EXPECTANCY_DIFF) {
      suggestions.push({
        factor: `score_correlation:${higher.bucket}_vs_${lower.bucket}`,
        currentWeight: 0,
        suggestedWeight: 0,
        evidence:
          `Score band inversion: "${lower.bucket}" band (expectancy ${_fmtR(lower.expectancy)}, ${lower.trades} trades) ` +
          `outperforms "${higher.bucket}" band (expectancy ${_fmtR(higher.expectancy)}, ${higher.trades} trades). ` +
          `This suggests the scoring model may need recalibration — higher scores should predict better outcomes.`,
        confidence: _confidenceFromSample(
          Math.min(higher.trades, lower.trades),
          lower.expectancy - higher.expectancy,
        ),
      });
    }
  }

  return suggestions;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _confidenceFromSample(
  sampleSize: number,
  effectSize: number,
): 'low' | 'medium' | 'high' {
  // Higher sample + bigger effect = more confidence
  const score = sampleSize * effectSize;
  if (score >= 10) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function _fmtR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

function _fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}
