// ── ContradictionDetector.ts — Strategic contradiction detection ───────────────
//
// On any SIGNAL_PLAN_UPDATE or new mission for a Founder/Consultant profile,
// retrieves recent Decision Ledger entries via AuditLedger.readRecent(), passes
// them with the new proposal to the council, and asks explicitly:
//   "Does this conflict with any prior decision?"
//
// InsightEngine already returns 'warning' type insights — this module prepares
// the context and retrieval step before the generate call.
//
// Usage:
//   const result = await detectContradiction(newProposal, auditLedger, providerManager);
//   if (result.hasContradiction) emit insight or surface to user

import type { ProviderManager } from '@triforge/engine';
import { withTimeout } from '../utils/withTimeout';
import { createLogger } from '../logging/log';

const log = createLogger('ContradictionDetector');

const ANALYSIS_TIMEOUT_MS = 12_000;
const MAX_HISTORY_ENTRIES  = 10;
const MAX_ENTRY_CHARS      = 300;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DecisionEntry {
  id?: string;
  timestamp?: number;
  request: string;
  synthesis: string;
  workflow?: string;
}

export interface ContradictionResult {
  hasContradiction: boolean;
  conflictingDecision?: string;
  explanation:          string;
  confidence:           number;   // 0–1
  recommendation:       string;
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPrompt(newProposal: string, recentDecisions: DecisionEntry[]): string {
  const historyBlock = recentDecisions
    .slice(0, MAX_HISTORY_ENTRIES)
    .map((d, i) => {
      const date = d.timestamp ? new Date(d.timestamp).toLocaleDateString() : 'unknown date';
      const summary = d.synthesis.slice(0, MAX_ENTRY_CHARS);
      return `Decision ${i + 1} (${date}): ${d.request.slice(0, 100)}\nOutcome: ${summary}`;
    })
    .join('\n\n');

  return `You are a strategic advisor analyzing whether a new proposal conflicts with prior decisions.

PRIOR DECISIONS (last ${recentDecisions.length}):
${historyBlock || 'No prior decisions recorded.'}

NEW PROPOSAL:
${newProposal}

Analyze for strategic contradictions. Return ONLY a JSON object:
{
  "hasContradiction": boolean,
  "conflictingDecision": "brief description of the conflicting prior decision, or null",
  "explanation": "1-2 sentence explanation of the conflict or why there is none",
  "confidence": number between 0 and 1,
  "recommendation": "brief recommendation: proceed / revisit prior decision / modify proposal"
}

No markdown. Valid JSON only.`;
}

// ── Response parser ────────────────────────────────────────────────────────────

function parseResult(raw: string): ContradictionResult | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    if (typeof parsed.hasContradiction !== 'boolean') return null;
    if (typeof parsed.explanation !== 'string') return null;

    return {
      hasContradiction:    parsed.hasContradiction,
      conflictingDecision: typeof parsed.conflictingDecision === 'string' ? parsed.conflictingDecision : undefined,
      explanation:         parsed.explanation,
      confidence:          typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      recommendation:      typeof parsed.recommendation === 'string' ? parsed.recommendation : 'proceed',
    };
  } catch {
    return null;
  }
}

// ── Scorer ─────────────────────────────────────────────────────────────────────
// Pick the best response from parallel provider results.

function score(result: ContradictionResult): number {
  return result.confidence
    + (result.conflictingDecision ? 0.2 : 0)
    + (result.recommendation !== 'proceed' ? 0.1 : 0);
}

// ── Main API ───────────────────────────────────────────────────────────────────

/**
 * Detects strategic contradictions between a new proposal and recent decisions.
 *
 * @param newProposal     The new goal, plan, or decision being proposed
 * @param recentDecisions Recent Decision Ledger entries (from AuditLedger.readRecent)
 * @param providerManager Active ProviderManager instance
 * @returns ContradictionResult or null if analysis failed or timed out
 */
export async function detectContradiction(
  newProposal:      string,
  recentDecisions:  DecisionEntry[],
  providerManager:  ProviderManager,
): Promise<ContradictionResult | null> {
  if (recentDecisions.length === 0) {
    return { hasContradiction: false, explanation: 'No prior decisions to compare against.', confidence: 1, recommendation: 'proceed' };
  }

  let providers: import('@triforge/engine').AIProvider[];
  try {
    providers = await providerManager.getActiveProviders();
    if (providers.length === 0) return null;
  } catch (err) {
    log.warn('Could not get providers:', err);
    return null;
  }

  const prompt = buildPrompt(newProposal, recentDecisions);

  try {
    const results = await withTimeout(
      Promise.allSettled(providers.map(p => p.generateResponse(prompt))),
      ANALYSIS_TIMEOUT_MS,
      'ContradictionDetector',
    );

    const parsed: ContradictionResult[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const result = parseResult(r.value);
        if (result) parsed.push(result);
      }
    }

    if (parsed.length === 0) return null;

    // Return the highest-scoring result
    return parsed.sort((a, b) => score(b) - score(a))[0];
  } catch (err) {
    log.warn('Contradiction detection failed:', err);
    return null;
  }
}

/**
 * Safe wrapper — never throws. Returns null on any failure.
 * Use this in event handlers and background workers.
 */
export async function detectContradictionSafe(
  newProposal:      string,
  recentDecisions:  DecisionEntry[],
  providerManager:  ProviderManager,
): Promise<ContradictionResult | null> {
  try {
    return await detectContradiction(newProposal, recentDecisions, providerManager);
  } catch {
    return null;
  }
}
