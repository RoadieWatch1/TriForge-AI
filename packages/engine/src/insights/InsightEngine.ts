// ── InsightEngine.ts ──────────────────────────────────────────────────────────
//
// Ambient Council Mode — passively evaluates activity signals and occasionally
// surfaces high-confidence insights without requiring a user prompt.
//
// Design principles:
//   • Rare: default cooldown of 30 minutes between insights.
//   • High-confidence only: insights below 0.85 confidence are silenced.
//   • Non-blocking: all evaluation is async and fire-and-forget.
//   • Platform-agnostic: uses a passed-in provider for evaluation (no direct
//     ProviderManager dependency).
//
// Signal types:
//   SIGNAL_MISSION_UPDATE  — user updated their mission context
//   SIGNAL_CODE_CHANGE     — active project contains code-related keywords
//   SIGNAL_DOC_EDIT        — user is editing documentation
//   SIGNAL_PLAN_UPDATE     — council plan was updated
//
// Integration (ipc.ts):
//   const insightEngine = new InsightEngine(providerForInsights);
//   // When a signal arrives:
//   insightEngine.analyze({ type: 'SIGNAL_MISSION_UPDATE', payload: missionSummary })
//     .then(insight => {
//       if (insight) event.sender.send('council:insight', insight);
//     });

import { councilBus } from '../events/buses';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'SIGNAL_MISSION_UPDATE'
  | 'SIGNAL_CODE_CHANGE'
  | 'SIGNAL_DOC_EDIT'
  | 'SIGNAL_PLAN_UPDATE';

export interface InsightSignal {
  type:    SignalType;
  payload: string;  // free-text context about the change
}

export interface CouncilInsight {
  type:       'strategy' | 'warning' | 'opportunity' | 'observation';
  message:    string;
  confidence: number;  // 0–1
}

/** Minimum confidence threshold — below this, insights are discarded. */
const MIN_CONFIDENCE = 0.85;

/** Minimum ms between insight emissions (default 30 minutes). */
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

// System prompt for insight generation
const INSIGHT_SYSTEM = `You are a strategic advisor assistant. Analyze the provided context and return ONLY a JSON object with this exact schema:
{
  "type": "strategy" | "warning" | "opportunity" | "observation",
  "message": "concise, actionable insight (max 120 chars)",
  "confidence": 0.0–1.0
}
Return null (the literal string "null") if no high-value insight exists.
Only return insights with confidence > 0.85. Do not explain. No markdown. Only valid JSON or the string "null".`;

// ── Provider interface (subset needed for insights) ───────────────────────────

interface InsightProvider {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>;
}

// ── InsightEngine ─────────────────────────────────────────────────────────────

export class InsightEngine {
  private _lastEmitAt   = 0;
  private _cooldownMs:  number;

  constructor(
    private _provider: InsightProvider,
    options?: { cooldownMs?: number },
  ) {
    this._cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /**
   * Analyze an activity signal and return an insight if confidence is high
   * enough and the cooldown has expired.
   *
   * Returns null when no high-value insight exists or cooldown is active.
   */
  async analyze(signal: InsightSignal): Promise<CouncilInsight | null> {
    // Respect cooldown — don't spam the user
    if (Date.now() - this._lastEmitAt < this._cooldownMs) return null;

    try {
      const userMsg = this._buildPrompt(signal);
      const raw = await this._provider.chat([
        { role: 'system', content: INSIGHT_SYSTEM },
        { role: 'user',   content: userMsg },
      ]);

      const insight = this._parse(raw.trim());
      if (!insight || insight.confidence < MIN_CONFIDENCE) return null;

      // Record emission time and broadcast on bus
      this._lastEmitAt = Date.now();
      councilBus.emit('COUNCIL_INSIGHT', insight);
      return insight;
    } catch {
      return null; // insight failures are silent — never interrupt the user
    }
  }

  /**
   * Reset the cooldown (e.g. for testing or after the user explicitly dismisses
   * an insight and requests another).
   */
  resetCooldown(): void {
    this._lastEmitAt = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _buildPrompt(signal: InsightSignal): string {
    const signalLabels: Record<SignalType, string> = {
      SIGNAL_MISSION_UPDATE: 'The user updated their active mission',
      SIGNAL_CODE_CHANGE:    'The user is working on code changes',
      SIGNAL_DOC_EDIT:       'The user is editing documentation',
      SIGNAL_PLAN_UPDATE:    'A council plan was updated',
    };

    return [
      `Signal: ${signalLabels[signal.type] ?? signal.type}`,
      `Context: ${signal.payload.slice(0, 500)}`,
    ].join('\n');
  }

  private _parse(raw: string): CouncilInsight | null {
    if (raw === 'null' || raw === '') return null;
    try {
      // Strip potential markdown code fences
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const obj = JSON.parse(clean) as Partial<CouncilInsight>;
      if (
        typeof obj.message    === 'string' &&
        typeof obj.confidence === 'number' &&
        typeof obj.type       === 'string'
      ) {
        return obj as CouncilInsight;
      }
    } catch { /* malformed JSON — discard */ }
    return null;
  }
}
