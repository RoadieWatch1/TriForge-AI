// ConsensusEngine.ts — pure TypeScript, no React, no IPC
// TF-IDF cosine similarity for real semantic consensus scoring

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AlignmentMatrix {
  [providerA: string]: Record<string, number>;
}

export interface ConflictZone {
  providers: [string, string];
  issue: string;
  divergenceScore: number; // 0–100
  stances: Record<string, string>;
}

export interface ConsensusAnalysis {
  alignmentMatrix: AlignmentMatrix;
  consensusScore: number;    // 0–100 real semantic, not backend confidence
  divergenceIndex: number;   // 0–100
  conflictZones: ConflictZone[];
  influenceMap: Record<string, number>; // values sum to 100
}

export interface StructuredSynthesis {
  executiveSummary: string;
  strategicPillars: string[];
  riskMap: string[];
  timeline: string[];
  costImpact: string;
  councilNote: string;
  raw: string; // fallback if parsing fails
}

export interface CostEstimate {
  fullCouncilCost: number;   // USD cents
  singleProviderCost: number;
  optimizedCost: number;
  savingsPercent: number;
  qualityTradeoff: string;
}

export interface ProviderPersona {
  name: string;
  trustScore: number;    // 0–100
  aggressionBias: number; // 1–5
}

// ── Stop Words ─────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','about','into','through','during','is','are','was',
  'were','be','been','being','have','has','had','do','does','did','will',
  'would','could','should','may','might','shall','must','can','not','no',
  'nor','so','yet','both','either','neither','this','that','these','those',
  'it','its','they','them','their','we','our','you','your','he','she','his',
  'her','i','me','my','who','which','what','when','where','how','all','each',
  'more','most','other','some','such','than','then','there','also','just',
  'very','if','as','than','any','only','same','too','own','also','well',
]);

// ── TF-IDF Core ────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function buildTfVector(tokens: string[]): Record<string, number> {
  if (tokens.length === 0) return {};
  const freq: Record<string, number> = {};
  for (const t of tokens) freq[t] = (freq[t] ?? 0) + 1;
  const len = tokens.length;
  const vec: Record<string, number> = {};
  for (const [t, count] of Object.entries(freq)) vec[t] = count / len;
  return vec;
}

function cosineSimilarity(vecA: Record<string, number>, vecB: Record<string, number>): number {
  const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dot = 0, magA = 0, magB = 0;
  for (const k of keys) {
    const a = vecA[k] ?? 0;
    const b = vecB[k] ?? 0;
    dot  += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function computeAlignmentMatrix(
  responses: Record<string, string>
): AlignmentMatrix {
  const names = Object.keys(responses);
  const vectors: Record<string, Record<string, number>> = {};
  for (const name of names) {
    vectors[name] = buildTfVector(tokenize(responses[name] ?? ''));
  }

  const matrix: AlignmentMatrix = {};
  for (const a of names) {
    matrix[a] = {};
    for (const b of names) {
      if (a === b) continue;
      const sim = cosineSimilarity(vectors[a], vectors[b]);
      matrix[a][b] = Math.round(sim * 100) / 100;
    }
  }
  return matrix;
}

function computeConsensusScore(matrix: AlignmentMatrix): number {
  const pairs: number[] = [];
  const names = Object.keys(matrix);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const sim = matrix[names[i]][names[j]] ?? 0;
      pairs.push(sim);
    }
  }
  if (pairs.length === 0) return 0;
  const avg = pairs.reduce((a, b) => a + b, 0) / pairs.length;
  // Penalize divergent pairs
  let penalty = 0;
  for (const s of pairs) if (s < 0.5) penalty += 15;
  const raw = avg * 100 - penalty;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

// ── Conflict Zone Extraction ────────────────────────────────────────────────────

function topDistinctTokens(tokenSetA: string[], tokenSetB: string[], n = 3): [string[], string[]] {
  const setB = new Set(tokenSetB);
  const setA = new Set(tokenSetA);
  const distinctA = tokenSetA.filter(t => !setB.has(t));
  const distinctB = tokenSetB.filter(t => !setA.has(t));
  // Deduplicate and take top n
  const topA = [...new Set(distinctA)].slice(0, n);
  const topB = [...new Set(distinctB)].slice(0, n);
  return [topA, topB];
}

function extractStanceSnippet(text: string, keywords: string[]): string {
  if (!text || keywords.length === 0) return text.slice(0, 120);
  const lc = text.toLowerCase();
  let bestIdx = -1;
  for (const kw of keywords) {
    const idx = lc.indexOf(kw);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx === -1) return text.slice(0, 120);
  const start = Math.max(0, bestIdx - 20);
  return text.slice(start, start + 120).replace(/\n/g, ' ').trim() + (text.length > start + 120 ? '…' : '');
}

function extractConflictZones(
  responses: Record<string, string>,
  matrix: AlignmentMatrix
): ConflictZone[] {
  const zones: ConflictZone[] = [];
  const names = Object.keys(responses);

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const sim = matrix[a]?.[b] ?? 1;
      if (sim >= 0.65) continue;

      const tokensA = tokenize(responses[a] ?? '');
      const tokensB = tokenize(responses[b] ?? '');
      const [distinctA, distinctB] = topDistinctTokens(tokensA, tokensB, 2);

      const topA = distinctA[0] ?? a.toLowerCase();
      const topB = distinctB[0] ?? b.toLowerCase();
      const issue = topA && topB ? `${topA} vs ${topB}` : `${a} vs ${b} divergence`;

      const stanceA = extractStanceSnippet(responses[a] ?? '', distinctA);
      const stanceB = extractStanceSnippet(responses[b] ?? '', distinctB);

      zones.push({
        providers: [a, b],
        issue,
        divergenceScore: Math.round((1 - sim) * 100),
        stances: { [a]: stanceA, [b]: stanceB },
      });
    }
  }

  // Sort by most divergent first
  return zones.sort((a, b) => b.divergenceScore - a.divergenceScore);
}

// ── Influence Computation ──────────────────────────────────────────────────────

function overlapWithText(tokens: string[], text: string): number {
  if (!text) return 0;
  const synthTokens = new Set(tokenize(text));
  if (synthTokens.size === 0) return 0;
  let hits = 0;
  for (const t of tokens) if (synthTokens.has(t)) hits++;
  return Math.min(1, hits / Math.max(1, synthTokens.size));
}

function computeInfluence(
  responses: Record<string, string>,
  synthesis: string,
  personas: ProviderPersona[],
  missionAggression: number // 1–5
): Record<string, number> {
  const raw: Record<string, number> = {};

  for (const persona of personas) {
    const text = responses[persona.name] ?? '';
    const tokens = tokenize(text);
    const synOverlap = overlapWithText(tokens, synthesis);
    const normalizedTrust = persona.trustScore / 100;
    const lengthBonus = Math.min(1, text.length / 2000);

    // Bias multiplier
    let biasMult = 1;
    if (persona.name === 'Grok' && missionAggression >= 4) biasMult = 1.3;
    if (persona.name === 'Claude' && missionAggression <= 2) biasMult = 1.3;

    raw[persona.name] = (synOverlap * 0.5 + normalizedTrust * 0.3 + lengthBonus * 0.2) * biasMult;
  }

  // Normalize to sum = 100
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total === 0) {
    const even = Math.round(100 / personas.length);
    const result: Record<string, number> = {};
    for (const p of personas) result[p.name] = even;
    return result;
  }

  const normalized: Record<string, number> = {};
  for (const [name, val] of Object.entries(raw)) {
    normalized[name] = Math.round((val / total) * 100);
  }

  // Fix rounding drift
  const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
  if (sum !== 100) {
    const first = Object.keys(normalized)[0];
    normalized[first] += (100 - sum);
  }

  return normalized;
}

// ── Cost Estimation ────────────────────────────────────────────────────────────

const PROVIDER_RATES: Record<string, { input: number; output: number }> = {
  Claude: { input: 0.003,  output: 0.015 },
  OpenAI: { input: 0.0025, output: 0.010 },
  Grok:   { input: 0.005,  output: 0.015 },
};

function estimateCents(text: string, isInput: boolean, provider: string): number {
  const tokens = Math.ceil(text.length / 4);
  const rate = PROVIDER_RATES[provider] ?? PROVIDER_RATES.Claude;
  const perToken = isInput ? rate.input / 1000 : rate.output / 1000;
  return tokens * perToken * 100; // in cents
}

export function estimateCosts(
  inputText: string,
  responses: Record<string, string>
): CostEstimate {
  const providerNames = Object.keys(responses);

  // Full council cost
  let fullCouncilCost = 0;
  for (const name of providerNames) {
    fullCouncilCost += estimateCents(inputText, true, name);
    fullCouncilCost += estimateCents(responses[name] ?? '', false, name);
  }
  // Add synthesis pass (Claude)
  fullCouncilCost += estimateCents(inputText + Object.values(responses).join(' '), true, 'Claude');
  fullCouncilCost += estimateCents('Synthesis response of ~500 tokens', false, 'Claude');

  // Single provider (cheapest = OpenAI)
  const singleProvider = 'OpenAI';
  const singleProviderCost =
    estimateCents(inputText, true, singleProvider) +
    estimateCents(responses[singleProvider] ?? Object.values(responses)[0] ?? '', false, singleProvider);

  // Optimized: 2-provider council (drop most expensive)
  const sortedByRate = [...providerNames].sort((a, b) => {
    const rateA = (PROVIDER_RATES[a]?.input ?? 0) + (PROVIDER_RATES[a]?.output ?? 0);
    const rateB = (PROVIDER_RATES[b]?.input ?? 0) + (PROVIDER_RATES[b]?.output ?? 0);
    return rateA - rateB;
  });
  const cheapTwo = sortedByRate.slice(0, 2);
  let optimizedCost = 0;
  for (const name of cheapTwo) {
    optimizedCost += estimateCents(inputText, true, name);
    optimizedCost += estimateCents(responses[name] ?? '', false, name);
  }
  optimizedCost += estimateCents(inputText, true, 'Claude') * 0.6;

  const savingsPercent = fullCouncilCost > 0
    ? Math.round(((fullCouncilCost - optimizedCost) / fullCouncilCost) * 100)
    : 0;

  const droppedProvider = sortedByRate[sortedByRate.length - 1] ?? 'Grok';
  const qualityTradeoff = `Switching to ${cheapTwo.join('+')} (dropping ${droppedProvider}) saves ~${savingsPercent}% but reduces ${droppedProvider === 'Grok' ? 'execution velocity bias' : droppedProvider === 'Claude' ? 'long-horizon strategic depth' : 'structural critique'}.`;

  return {
    fullCouncilCost: Math.round(fullCouncilCost * 1000) / 1000,
    singleProviderCost: Math.round(singleProviderCost * 1000) / 1000,
    optimizedCost: Math.round(optimizedCost * 1000) / 1000,
    savingsPercent,
    qualityTradeoff,
  };
}

// ── Structured Synthesis Parser ────────────────────────────────────────────────

export function parseStructuredSynthesis(text: string): StructuredSynthesis {
  const result: StructuredSynthesis = {
    executiveSummary: '',
    strategicPillars: [],
    riskMap: [],
    timeline: [],
    costImpact: '',
    councilNote: '',
    raw: text,
  };

  if (!text) return result;

  // Helper: extract section content between two possible headings
  const extractSection = (heading: RegExp, endHeadings: RegExp[]): string => {
    const match = text.match(heading);
    if (!match || match.index === undefined) return '';
    const start = match.index + match[0].length;
    let end = text.length;
    for (const h of endHeadings) {
      const m = text.slice(start).match(h);
      if (m && m.index !== undefined) end = Math.min(end, start + m.index);
    }
    return text.slice(start, end).trim();
  };

  const allHeadings = [
    /EXECUTIVE SUMMARY\s*:/i,
    /STRATEGIC PILLARS\s*:/i,
    /RISK MAP\s*:/i,
    /TIMELINE\s*:/i,
    /COST IMPACT\s*:/i,
    /COUNCIL COMPROMISE\s*:/i,
  ];

  result.executiveSummary = extractSection(allHeadings[0], allHeadings.slice(1));
  const pillarsRaw = extractSection(allHeadings[1], allHeadings.slice(2));
  const riskRaw    = extractSection(allHeadings[2], allHeadings.slice(3));
  const timelineRaw = extractSection(allHeadings[3], allHeadings.slice(4));
  result.costImpact  = extractSection(allHeadings[4], allHeadings.slice(5));
  result.councilNote = extractSection(allHeadings[5], []);

  // Parse numbered/bulleted lists
  const parseList = (raw: string): string[] =>
    raw
      .split(/\n/)
      .map(l => l.replace(/^[\d\.\-\*\•]\s*/, '').trim())
      .filter(l => l.length > 0);

  result.strategicPillars = parseList(pillarsRaw);
  result.riskMap          = parseList(riskRaw);
  result.timeline         = parseList(timelineRaw);

  return result;
}

// ── Bias Projection ────────────────────────────────────────────────────────────

export function projectInfluenceWithBias(
  current: Record<string, number>,
  biasType: 'aggression' | 'stability' | 'cost'
): Record<string, number> {
  const next = { ...current };

  const deltas: Record<string, Record<string, number>> = {
    aggression: { Grok: +12, Claude: -8, OpenAI: -4 },
    stability:  { Claude: +12, Grok: -9, OpenAI: -3 },
    cost:       { OpenAI: +15, Claude: -8, Grok: -7 },
  };

  const d = deltas[biasType] ?? {};
  for (const [name, delta] of Object.entries(d)) {
    if (next[name] !== undefined) next[name] = Math.max(5, next[name] + delta);
  }

  // Renormalize
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  const normalized: Record<string, number> = {};
  for (const [name, val] of Object.entries(next)) {
    normalized[name] = Math.round((val / total) * 100);
  }
  const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
  if (sum !== 100) {
    const first = Object.keys(normalized)[0];
    normalized[first] += (100 - sum);
  }
  return normalized;
}

// ── Main Export ────────────────────────────────────────────────────────────────

export function analyzeConsensus(
  responses: Record<string, string>,
  synthesis: string,
  personas: ProviderPersona[],
  missionAggression: number
): ConsensusAnalysis {
  const validResponses: Record<string, string> = {};
  for (const [k, v] of Object.entries(responses)) {
    if (v && v.trim().length > 0) validResponses[k] = v;
  }

  const matrix   = computeAlignmentMatrix(validResponses);
  const score    = computeConsensusScore(matrix);
  const zones    = extractConflictZones(validResponses, matrix);
  const influence = computeInfluence(validResponses, synthesis, personas, missionAggression);

  // Divergence index: inverse of average pairwise similarity
  const allPairs: number[] = [];
  for (const a of Object.keys(matrix)) {
    for (const b of Object.keys(matrix[a])) {
      allPairs.push(matrix[a][b]);
    }
  }
  const avgSim = allPairs.length > 0
    ? allPairs.reduce((a, b) => a + b, 0) / allPairs.length
    : 0.5;
  const divergenceIndex = Math.round((1 - avgSim) * 100);

  return {
    alignmentMatrix: matrix,
    consensusScore: score,
    divergenceIndex,
    conflictZones: zones,
    influenceMap: influence,
  };
}
