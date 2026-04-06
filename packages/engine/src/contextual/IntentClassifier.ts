// ── contextual/IntentClassifier.ts — Section 5 Phase 2: Intent Classification ─
//
// Deterministic, rule-based classification of raw user requests into
// WorkIntentCategory values defined in Phase 1.
//
// No LLM calls. No external services. No machine context inspection.
// No plan generation. No execution triggers.

import type { WorkIntentCategory } from './types';

// ── Result contract (local to this phase) ────────────────────────────────────

export interface IntentClassificationResult {
  category: WorkIntentCategory;
  confidence: number;
  matchedSignals: string[];
  reasoning: string;
  secondaryCategories?: WorkIntentCategory[];
}

// ── Rule tables ───────────────────────────────────────────────────────────────

/**
 * Strong phrases are matched first and carry the highest weight.
 * Each entry is [normalizedPhrase, category, weight].
 */
const STRONG_PHRASES: [string, WorkIntentCategory, number][] = [
  // app_submission
  ['submit my app to apple',          'app_submission', 1.0],
  ['submit app to the app store',     'app_submission', 1.0],
  ['submit to app store',             'app_submission', 0.95],
  ['submit to apple',                 'app_submission', 0.90],
  ['publish my app',                  'app_submission', 0.90],
  ['release to app store',            'app_submission', 0.90],
  ['send to apple review',            'app_submission', 0.90],
  ['push to testflight',              'app_submission', 0.85],
  ['upload to app store connect',     'app_submission', 0.85],

  // creative_editing
  ['edit my movie in premiere',       'creative_editing', 1.0],
  ['edit my video in final cut',      'creative_editing', 1.0],
  ['edit my movie',                   'creative_editing', 0.90],
  ['edit this video',                 'creative_editing', 0.90],
  ['export this media project',       'creative_editing', 0.90],
  ['render this video',               'creative_editing', 0.85],
  ['cut this footage',                'creative_editing', 0.85],
  ['export from premiere',            'creative_editing', 0.85],
  ['export from final cut',           'creative_editing', 0.85],

  // coding_build_debug
  ['fix this build',                  'coding_build_debug', 1.0],
  ['fix the build',                   'coding_build_debug', 1.0],
  ['build is failing',                'coding_build_debug', 1.0],
  ['build failed',                    'coding_build_debug', 0.95],
  ['fix this compile error',          'coding_build_debug', 0.95],
  ['debug this error',                'coding_build_debug', 0.90],
  ['fix my failing tests',            'coding_build_debug', 0.90],
  ['tests are failing',               'coding_build_debug', 0.90],
  ['fix this stack trace',            'coding_build_debug', 0.90],

  // file_project_organization
  ['organize this project folder',    'file_project_organization', 1.0],
  ['organize my project folder',      'file_project_organization', 1.0],
  ['clean up my files',               'file_project_organization', 0.90],
  ['clean up these files',            'file_project_organization', 0.90],
  ['sort these files',                'file_project_organization', 0.85],
  ['rename these files',              'file_project_organization', 0.85],
  ['organize my desktop',             'file_project_organization', 0.85],
  ['tidy up this folder',             'file_project_organization', 0.85],

  // browser_admin_workflow
  ['log into the admin panel',        'browser_admin_workflow', 1.0],
  ['upload on the website',           'browser_admin_workflow', 0.90],
  ['fill out this form',              'browser_admin_workflow', 0.85],
  ['publish this post',               'browser_admin_workflow', 0.85],
  ['update website settings',         'browser_admin_workflow', 0.85],
  ['log into the dashboard',          'browser_admin_workflow', 0.85],

  // desktop_assistance
  ['help me with this on my computer','desktop_assistance', 1.0],
  ['help me do this on my computer',  'desktop_assistance', 1.0],
  ['do this for me on my machine',    'desktop_assistance', 0.90],
  ['assist me with this here',        'desktop_assistance', 0.85],

  // research_planning
  ['research the best way to',        'research_planning', 0.95],
  ['make a plan for',                 'research_planning', 0.90],
  ['compare options for',             'research_planning', 0.90],
  ['outline an approach to',          'research_planning', 0.90],
  ['help me plan',                    'research_planning', 0.85],
  ['investigate options for',         'research_planning', 0.85],
  ['recommend an approach',           'research_planning', 0.85],
  ['analyze options for',             'research_planning', 0.85],
];

/**
 * Keyword groups scored per-hit. Each entry is [keyword, category, weight].
 * Multiple hits accumulate score for a category.
 */
const KEYWORDS: [string, WorkIntentCategory, number][] = [
  // app_submission
  ['app store',          'app_submission', 0.55],
  ['testflight',         'app_submission', 0.55],
  ['app connect',        'app_submission', 0.50],
  ['apple review',       'app_submission', 0.50],
  ['app submission',     'app_submission', 0.55],
  ['release build',      'app_submission', 0.40],
  ['publish app',        'app_submission', 0.50],
  ['submit app',         'app_submission', 0.55],
  ['app store connect',  'app_submission', 0.55],
  ['distribution',       'app_submission', 0.25],
  ['provisioning',       'app_submission', 0.30],

  // creative_editing
  ['premiere',           'creative_editing', 0.60],
  ['final cut',          'creative_editing', 0.60],
  ['davinci resolve',    'creative_editing', 0.60],
  ['after effects',      'creative_editing', 0.55],
  ['timeline',           'creative_editing', 0.40],
  ['footage',            'creative_editing', 0.50],
  ['sequence',           'creative_editing', 0.40],
  ['render',             'creative_editing', 0.35],
  ['edit video',         'creative_editing', 0.55],
  ['export media',       'creative_editing', 0.50],
  ['color grade',        'creative_editing', 0.55],
  ['audio mix',          'creative_editing', 0.45],
  ['video project',      'creative_editing', 0.45],
  ['media project',      'creative_editing', 0.50],

  // coding_build_debug
  ['build error',        'coding_build_debug', 0.65],
  ['compile',            'coding_build_debug', 0.55],
  ['compiler',           'coding_build_debug', 0.55],
  ['debug',              'coding_build_debug', 0.50],
  ['typescript',         'coding_build_debug', 0.50],
  ['npm',                'coding_build_debug', 0.45],
  ['xcode build',        'coding_build_debug', 0.60],
  ['android build',      'coding_build_debug', 0.60],
  ['ios build',          'coding_build_debug', 0.60],
  ['stack trace',        'coding_build_debug', 0.65],
  ['failing tests',      'coding_build_debug', 0.65],
  ['lint error',         'coding_build_debug', 0.55],
  ['syntax error',       'coding_build_debug', 0.55],
  ['runtime error',      'coding_build_debug', 0.55],
  ['exception',          'coding_build_debug', 0.40],
  ['dependency',         'coding_build_debug', 0.30],
  ['webpack',            'coding_build_debug', 0.50],
  ['gradle',             'coding_build_debug', 0.50],
  ['makefile',           'coding_build_debug', 0.50],

  // file_project_organization
  ['organize folder',    'file_project_organization', 0.60],
  ['clean up files',     'file_project_organization', 0.60],
  ['sort files',         'file_project_organization', 0.55],
  ['rename files',       'file_project_organization', 0.55],
  ['move files',         'file_project_organization', 0.50],
  ['project folder',     'file_project_organization', 0.45],
  ['desktop cleanup',    'file_project_organization', 0.60],
  ['arrange project',    'file_project_organization', 0.50],
  ['folder structure',   'file_project_organization', 0.45],
  ['file structure',     'file_project_organization', 0.45],
  ['declutter',          'file_project_organization', 0.50],

  // browser_admin_workflow
  ['browser',            'browser_admin_workflow', 0.35],
  ['login',              'browser_admin_workflow', 0.40],
  ['log in',             'browser_admin_workflow', 0.40],
  ['admin panel',        'browser_admin_workflow', 0.60],
  ['dashboard',          'browser_admin_workflow', 0.40],
  ['upload on website',  'browser_admin_workflow', 0.60],
  ['fill form',          'browser_admin_workflow', 0.55],
  ['website settings',   'browser_admin_workflow', 0.55],
  ['cms',                'browser_admin_workflow', 0.55],
  ['publish post',       'browser_admin_workflow', 0.55],
  ['web portal',         'browser_admin_workflow', 0.55],
  ['wordpress',          'browser_admin_workflow', 0.50],
  ['shopify',            'browser_admin_workflow', 0.50],
  ['webflow',            'browser_admin_workflow', 0.50],

  // desktop_assistance
  ['help me',            'desktop_assistance', 0.20],
  ['help with this',     'desktop_assistance', 0.30],
  ['on my computer',     'desktop_assistance', 0.45],
  ['on this machine',    'desktop_assistance', 0.45],
  ['assist me',          'desktop_assistance', 0.35],
  ['do this for me',     'desktop_assistance', 0.40],
  ['my desktop',         'desktop_assistance', 0.35],

  // research_planning
  ['research',           'research_planning', 0.50],
  ['compare options',    'research_planning', 0.55],
  ['make a plan',        'research_planning', 0.55],
  ['outline',            'research_planning', 0.40],
  ['investigate',        'research_planning', 0.50],
  ['analyze options',    'research_planning', 0.55],
  ['recommend',          'research_planning', 0.45],
  ['best approach',      'research_planning', 0.50],
  ['should i',           'research_planning', 0.25],
  ['pros and cons',      'research_planning', 0.55],
  ['evaluation',         'research_planning', 0.45],
  ['strategy',           'research_planning', 0.40],
];

// ── Normalization ─────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // strip punctuation
    .replace(/\s+/g, ' ')      // collapse whitespace
    .trim();
}

// ── Scoring ───────────────────────────────────────────────────────────────────

type CategoryScores = Record<WorkIntentCategory, number>;
type MatchedSignalMap = Record<WorkIntentCategory, string[]>;

function emptyScores(): CategoryScores {
  return {
    app_submission:           0,
    creative_editing:         0,
    coding_build_debug:       0,
    file_project_organization: 0,
    browser_admin_workflow:   0,
    desktop_assistance:       0,
    research_planning:        0,
    unknown:                  0,
  };
}

function scoreRequest(normalized: string): {
  scores: CategoryScores;
  signals: MatchedSignalMap;
  topPhrase: { category: WorkIntentCategory; weight: number; phrase: string } | null;
} {
  const scores = emptyScores();
  const signals: MatchedSignalMap = {
    app_submission: [],
    creative_editing: [],
    coding_build_debug: [],
    file_project_organization: [],
    browser_admin_workflow: [],
    desktop_assistance: [],
    research_planning: [],
    unknown: [],
  };

  // 1. Strong phrase pass — highest weight, short-circuit friendly
  let topPhrase: { category: WorkIntentCategory; weight: number; phrase: string } | null = null;

  for (const [phrase, category, weight] of STRONG_PHRASES) {
    if (normalized.includes(phrase)) {
      scores[category] = Math.max(scores[category], weight);
      signals[category].push(`matched phrase: "${phrase}"`);
      if (topPhrase === null || weight > topPhrase.weight) {
        topPhrase = { category, weight, phrase };
      }
    }
  }

  // 2. Keyword accumulation pass
  for (const [keyword, category, weight] of KEYWORDS) {
    if (normalized.includes(keyword)) {
      scores[category] += weight;
      signals[category].push(`matched keyword: "${keyword}"`);
    }
  }

  return { scores, signals, topPhrase };
}

// ── Category selection ────────────────────────────────────────────────────────

const ORDERED_CATEGORIES: WorkIntentCategory[] = [
  'app_submission',
  'creative_editing',
  'coding_build_debug',
  'file_project_organization',
  'browser_admin_workflow',
  'research_planning',
  'desktop_assistance',
];

/**
 * Select the winning category from scores using tie-break rules:
 * 1. Strong phrase match with weight >= 0.85 wins outright if no other phrase is close.
 * 2. Otherwise choose the highest-scoring category.
 * 3. If a tie persists, prefer the more specific category over desktop_assistance.
 * 4. If still tied, return unknown.
 */
function selectCategory(
  scores: CategoryScores,
  topPhrase: { category: WorkIntentCategory; weight: number } | null,
): { winner: WorkIntentCategory; runnerUp: WorkIntentCategory | null } {
  // If a single phrase match dominates with high confidence, trust it
  if (topPhrase && topPhrase.weight >= 0.85) {
    const othersAboveThreshold = ORDERED_CATEGORIES.filter(
      (c) => c !== topPhrase.category && scores[c] >= topPhrase.weight * 0.85,
    );
    if (othersAboveThreshold.length === 0) {
      const ranked = rankByScore(scores);
      const runnerUp = ranked.find((c) => c !== topPhrase.category) ?? null;
      return { winner: topPhrase.category, runnerUp };
    }
  }

  const ranked = rankByScore(scores);
  if (ranked.length === 0) {
    return { winner: 'unknown', runnerUp: null };
  }

  const best = ranked[0];
  const bestScore = scores[best];

  if (bestScore < 0.15) {
    return { winner: 'unknown', runnerUp: null };
  }

  const runnerUp = ranked.length > 1 ? ranked[1] : null;
  const runnerUpScore = runnerUp ? scores[runnerUp] : 0;

  // Tie: two categories within 10% of each other
  const tieThreshold = bestScore * 0.90;
  if (runnerUp && runnerUpScore >= tieThreshold) {
    // Prefer specific over desktop_assistance
    if (best === 'desktop_assistance' && runnerUp !== 'unknown') {
      return { winner: runnerUp, runnerUp: best };
    }
    // Otherwise prefer the category that appears earlier in ORDERED_CATEGORIES
    const bestIdx = ORDERED_CATEGORIES.indexOf(best);
    const runnerIdx = ORDERED_CATEGORIES.indexOf(runnerUp);
    if (bestIdx > runnerIdx) {
      return { winner: runnerUp, runnerUp: best };
    }
  }

  return { winner: best, runnerUp };
}

function rankByScore(scores: CategoryScores): WorkIntentCategory[] {
  return (Object.keys(scores) as WorkIntentCategory[])
    .filter((c) => c !== 'unknown')
    .sort((a, b) => scores[b] - scores[a]);
}

// ── Confidence calculation ────────────────────────────────────────────────────

/**
 * Derive a 0–1 confidence value from the winning score.
 * Applies a cap so no purely keyword-based result ever claims 1.0.
 */
function deriveConfidence(
  winnerScore: number,
  topPhrase: { category: WorkIntentCategory; weight: number } | null,
  winner: WorkIntentCategory,
): number {
  if (winner === 'unknown') return 0.10;

  // If we matched a direct strong phrase for the winner, use its weight as the floor
  const phraseFloor = topPhrase?.category === winner ? topPhrase.weight : 0;

  // Keyword accumulation can push past 1.0 — normalize against a ceiling
  const keywordConfidence = Math.min(winnerScore / 1.2, 0.90);

  const raw = Math.max(phraseFloor, keywordConfidence);
  return parseFloat(Math.min(raw, 0.97).toFixed(2));
}

// ── Reasoning builder ─────────────────────────────────────────────────────────

function buildReasoning(
  winner: WorkIntentCategory,
  signals: MatchedSignalMap,
  confidence: number,
): string {
  const hits = signals[winner];

  if (winner === 'unknown') {
    return 'No strong category signals detected. Request is ambiguous or too vague to classify with confidence.';
  }

  const phraseHits = hits.filter((s) => s.startsWith('matched phrase'));
  const keywordHits = hits.filter((s) => s.startsWith('matched keyword'));

  const parts: string[] = [];

  if (phraseHits.length > 0) {
    parts.push(`Direct phrase match: ${phraseHits[0].replace('matched phrase: ', '')}.`);
  }
  if (keywordHits.length > 0) {
    const sample = keywordHits.slice(0, 3).map((s) => s.replace('matched keyword: ', '')).join(', ');
    parts.push(`Supporting keywords: ${sample}.`);
  }

  const label = CATEGORY_LABELS[winner] ?? winner;
  const confidenceLabel = confidence >= 0.80 ? 'high' : confidence >= 0.50 ? 'moderate' : 'low';

  parts.push(`Classified as ${label} with ${confidenceLabel} confidence (${confidence}).`);

  return parts.join(' ');
}

const CATEGORY_LABELS: Record<WorkIntentCategory, string> = {
  app_submission:             'App Submission',
  creative_editing:           'Creative Editing',
  coding_build_debug:         'Coding / Build / Debug',
  file_project_organization:  'File & Project Organization',
  browser_admin_workflow:     'Browser & Admin Workflow',
  desktop_assistance:         'Desktop Assistance',
  research_planning:          'Research & Planning',
  unknown:                    'Unknown',
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a raw user request into a WorkIntentCategory.
 *
 * Fully deterministic. No LLM calls. No external services. No side effects.
 *
 * @param request - The raw user input string.
 * @returns IntentClassificationResult with category, confidence, signals, and reasoning.
 */
export function classifyWorkIntent(request: string): IntentClassificationResult {
  const normalized = normalize(request);

  if (normalized.length === 0) {
    return {
      category: 'unknown',
      confidence: 0.0,
      matchedSignals: [],
      reasoning: 'Empty request provided. Cannot classify.',
    };
  }

  const { scores, signals, topPhrase } = scoreRequest(normalized);
  const { winner, runnerUp } = selectCategory(scores, topPhrase);
  const confidence = deriveConfidence(scores[winner], topPhrase, winner);
  const reasoning = buildReasoning(winner, signals, confidence);

  const matchedSignals = signals[winner].slice();

  const secondaryCategories: WorkIntentCategory[] = [];
  if (runnerUp && runnerUp !== 'unknown' && scores[runnerUp] >= 0.15) {
    secondaryCategories.push(runnerUp);
  }

  return {
    category: winner,
    confidence,
    matchedSignals,
    reasoning,
    ...(secondaryCategories.length > 0 ? { secondaryCategories } : {}),
  };
}
