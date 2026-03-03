// ForgeContextStore.ts — pure TypeScript, no React, no IPC
// Shared intelligence store between TriForge (Chat) and Command (ForgeCommand)

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LastMissionSummary {
  objective: string;
  executiveSummary: string;
  strategicPillars: string[];
  riskLevel: string;
  confidenceScore: number;
  semanticScore?: number;
  providerInfluenceMap?: Record<string, number>;
  divergenceIndex?: number;
  timestamp: number;
}

export interface CouncilDrift {
  aggressionPresses: number;
  stabilityPresses: number;
  costPresses: number;
  overrideCount: number;
  totalMissions: number;
}

export interface BaselineBias {
  aggression: number;     // 0–1, default 0.5
  riskTolerance: number;  // 0–1, default 0.5
  speedVsDepth: number;   // 0–1, default 0.5
}

interface ContextStore {
  lastMission?: LastMissionSummary;
  drift?: CouncilDrift;
  trustWeights?: Record<string, number>;  // per-provider multiplier, 0.6–1.4
  baselineBias?: BaselineBias;
  conflictThemes?: string[];
}

// ── Storage Key ────────────────────────────────────────────────────────────────

const STORE_KEY = 'triforge-context-v1';

function readStore(): ContextStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as ContextStore;
  } catch { /* ignore */ }
  return {};
}

function writeStore(data: ContextStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function defaultDrift(): CouncilDrift {
  return {
    aggressionPresses: 0,
    stabilityPresses: 0,
    costPresses: 0,
    overrideCount: 0,
    totalMissions: 0,
  };
}

function defaultTrustWeights(): Record<string, number> {
  return { Claude: 1.0, OpenAI: 1.0, Grok: 1.0 };
}

function defaultBaselineBias(): BaselineBias {
  return { aggression: 0.5, riskTolerance: 0.5, speedVsDepth: 0.5 };
}

// ── Mission Functions ──────────────────────────────────────────────────────────

export function saveLastMission(summary: LastMissionSummary): void {
  const store = readStore();
  store.lastMission = summary;
  writeStore(store);
}

export function loadLastMission(): LastMissionSummary | null {
  return readStore().lastMission ?? null;
}

export function clearLastMission(): void {
  const store = readStore();
  delete store.lastMission;
  writeStore(store);
}

// ── Drift Functions ────────────────────────────────────────────────────────────

export function recordBiasPress(type: 'aggression' | 'stability' | 'cost'): void {
  const store = readStore();
  const drift = store.drift ?? defaultDrift();
  if (type === 'aggression') drift.aggressionPresses += 1;
  else if (type === 'stability') drift.stabilityPresses += 1;
  else if (type === 'cost') drift.costPresses += 1;
  store.drift = drift;

  // Nudge baselineBias in the same direction
  const bias = store.baselineBias ?? defaultBaselineBias();
  if (type === 'aggression') bias.aggression = Math.min(0.9, bias.aggression + 0.03);
  else if (type === 'stability') bias.aggression = Math.max(0.1, bias.aggression - 0.03);
  else if (type === 'cost') bias.speedVsDepth = Math.min(0.9, bias.speedVsDepth + 0.02);
  store.baselineBias = bias;

  writeStore(store);
}

export function recordMissionComplete(): void {
  const store = readStore();
  const drift = store.drift ?? defaultDrift();
  drift.totalMissions += 1;
  store.drift = drift;
  writeStore(store);
}

export function loadCouncilDrift(): CouncilDrift {
  return readStore().drift ?? defaultDrift();
}

// ── Trust Weight Functions ─────────────────────────────────────────────────────

export function loadTrustWeights(): Record<string, number> {
  return readStore().trustWeights ?? defaultTrustWeights();
}

export function updateTrustWeights(weights: Record<string, number>): void {
  const store = readStore();
  const existing = store.trustWeights ?? defaultTrustWeights();
  for (const [name, val] of Object.entries(weights)) {
    existing[name] = Math.min(1.4, Math.max(0.6, val));
  }
  store.trustWeights = existing;
  writeStore(store);
}

export function applyTrustEvolution(
  influenceMap: Record<string, number>,
  accepted: boolean
): void {
  if (Object.keys(influenceMap).length === 0) return;
  // Find top-influence provider
  const top = Object.entries(influenceMap).sort(([, a], [, b]) => b - a)[0][0];
  const store = readStore();
  const tw = store.trustWeights ?? defaultTrustWeights();
  const current = tw[top] ?? 1.0;
  tw[top] = accepted
    ? Math.min(1.4, current + 0.03)
    : Math.max(0.6, current - 0.02);
  store.trustWeights = tw;
  writeStore(store);
}

// ── Baseline Bias Functions ────────────────────────────────────────────────────

export function loadBaselineBias(): BaselineBias {
  return readStore().baselineBias ?? defaultBaselineBias();
}

export function updateBaselineBias(delta: Partial<BaselineBias>): void {
  const store = readStore();
  const bias = store.baselineBias ?? defaultBaselineBias();
  if (delta.aggression !== undefined)    bias.aggression    = Math.min(0.95, Math.max(0.05, bias.aggression    + delta.aggression));
  if (delta.riskTolerance !== undefined) bias.riskTolerance = Math.min(0.95, Math.max(0.05, bias.riskTolerance + delta.riskTolerance));
  if (delta.speedVsDepth !== undefined)  bias.speedVsDepth  = Math.min(0.95, Math.max(0.05, bias.speedVsDepth  + delta.speedVsDepth));
  store.baselineBias = bias;
  writeStore(store);
}

// ── Conflict Theme Functions ───────────────────────────────────────────────────

export function recordConflictThemes(themes: string[]): void {
  const store = readStore();
  const existing = store.conflictThemes ?? [];
  const normalized = themes.map(t => t.toLowerCase().trim()).filter(Boolean);
  const combined = [...existing];
  for (const t of normalized) {
    if (!combined.includes(t)) combined.push(t);
  }
  store.conflictThemes = combined.slice(-10); // keep last 10
  writeStore(store);
}

export function loadConflictThemes(): string[] {
  return readStore().conflictThemes ?? [];
}

export function getConflictHint(objective: string): string | null {
  const themes = loadConflictThemes();
  if (themes.length === 0) return null;
  const words = objective.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  for (const theme of themes) {
    const themeWords = theme.split(/\W+/).filter(w => w.length > 3);
    if (themeWords.some(tw => words.includes(tw))) {
      return `Previous missions showed strategic tension around: "${theme}"`;
    }
  }
  return null;
}

// ── Persona Adjustments (derived from accumulated drift) ────────────────────────

export function getPersonaAdjustments(): Array<{
  name: string;
  trustDelta: number;
  aggressionDelta: number;
}> {
  const drift = loadCouncilDrift();

  const results: Record<string, { trustDelta: number; aggressionDelta: number }> = {
    Claude: { trustDelta: 0, aggressionDelta: 0 },
    OpenAI: { trustDelta: 0, aggressionDelta: 0 },
    Grok:   { trustDelta: 0, aggressionDelta: 0 },
  };

  // Aggression drift: user keeps pushing aggression → Grok gets stronger
  if (drift.aggressionPresses >= 3) {
    results.Grok.aggressionDelta   += Math.min(2, Math.floor(drift.aggressionPresses / 3));
    results.Claude.aggressionDelta -= 0.5;
  }

  // Stability drift: user keeps pushing stability → Claude gets stronger
  if (drift.stabilityPresses >= 3) {
    results.Claude.trustDelta      += Math.min(6, Math.floor(drift.stabilityPresses / 3) * 2);
    results.Grok.aggressionDelta   -= Math.min(2, Math.floor(drift.stabilityPresses / 3));
  }

  // Cost drift: user is budget-conscious → all slightly less aggressive
  if (drift.costPresses >= 3) {
    results.Claude.aggressionDelta -= 0.5;
    results.OpenAI.aggressionDelta -= 0.5;
    results.Grok.aggressionDelta   -= 0.5;
  }

  return Object.entries(results).map(([name, adj]) => ({ name, ...adj }));
}
