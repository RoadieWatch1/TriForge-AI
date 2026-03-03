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
  timestamp: number;
}

export interface CouncilDrift {
  aggressionPresses: number;
  stabilityPresses: number;
  costPresses: number;
  overrideCount: number;
  totalMissions: number;
}

interface ContextStore {
  lastMission?: LastMissionSummary;
  drift?: CouncilDrift;
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
