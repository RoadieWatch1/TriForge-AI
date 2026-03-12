/**
 * AIMind.ts — Persistent background reasoning agent.
 *
 * Observes the EventBus and uses the AI council to analyze meaningful events,
 * then suggests follow-up actions via MIND_SUGGESTION events.
 *
 * Performance protection:
 *   - Whitelist of meaningful event types (skips internal/noisy events)
 *   - Per-event-type cooldown (minimum 60s between analyses of same type)
 *   - Maximum 1 concurrent analysis
 *   - Self-protection: skips COUNCIL_* and MIND_* events to prevent loops
 *   - Silent failure: analysis errors never crash the main process
 */

import type { AIProvider }  from '../core/providers/provider';
import type { EngineEvent }  from '../core/taskTypes';
import { eventBus }          from '../core/eventBus';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Minimum ms between analyses of the same event type. */
const COOLDOWN_MS = 60_000;

/** Events worth analyzing — ordered by significance. */
const ANALYSABLE_EVENTS = new Set<string>([
  'IMAGE_GENERATED',
  'IMAGE_CRITIQUE',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'MISSION_COMPLETED',
  'MISSION_FAILED',
  'WORKFLOW_FIRED',
  'WORKFLOW_FAILED',
  'TOOL_EXECUTE_COMPLETED',
  'SENSOR_DISK_LOW',
  'SENSOR_NETWORK_DOWN',
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MindSuggestion {
  eventType:   string;
  analysis:    string;   // Claude's analysis
  critique:    string;   // Grok's challenge / improvement
  suggestion:  string;   // Actionable follow-up suggestion
  triggeredAt: number;
}

// ── AIMind ────────────────────────────────────────────────────────────────────

const ANALYZE_SYSTEM = `You are a proactive AI assistant observing system events.
When a significant event occurs, provide:
1. A brief analysis of what happened (1-2 sentences)
2. A specific, actionable follow-up suggestion the user might want to take

Be concise. Format your response as:
ANALYSIS: <analysis>
SUGGESTION: <suggestion>`;

const CRITIQUE_SYSTEM = `You are a critical advisor reviewing an AI analysis of a system event.
Challenge the analysis: is the suggestion actually useful? Is there a better approach?
Be concise — 1-2 sentences only.`;

export class AIMind {
  private _analyzeProvider:  AIProvider | null;
  private _critiqueProvider: AIProvider | null;
  private _lastAnalyzed:     Map<string, number> = new Map();
  private _busy              = false;
  private _unsubscribe:      (() => void) | null = null;
  private _running           = false;

  constructor(
    analyzeProvider:  AIProvider | null,
    critiqueProvider: AIProvider | null,
  ) {
    this._analyzeProvider  = analyzeProvider;
    this._critiqueProvider = critiqueProvider;
  }

  start(): void {
    if (this._running) return;
    if (!this._analyzeProvider) {
      console.log('[AIMind] No analysis provider — background reasoning disabled');
      return;
    }

    this._running = true;

    // Subscribe to ALL events, filter internally
    this._unsubscribe = eventBus.onAny((ev: EngineEvent) => {
      void this._onEvent(ev);
    });

    console.log('[AIMind] Started — background reasoning active');
  }

  stop(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._running = false;
    console.log('[AIMind] Stopped');
  }

  isRunning(): boolean {
    return this._running;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _onEvent(ev: EngineEvent): Promise<void> {
    // Self-protection: skip internal council/mind events to prevent loops
    if (
      ev.type.startsWith('COUNCIL_') ||
      ev.type.startsWith('MIND_') ||
      ev.type.startsWith('SENSOR_CLIPBOARD') ||  // too frequent
      !ANALYSABLE_EVENTS.has(ev.type)
    ) return;

    // Cooldown check
    const lastAt = this._lastAnalyzed.get(ev.type) ?? 0;
    if (Date.now() - lastAt < COOLDOWN_MS) return;

    // Concurrency guard
    if (this._busy) return;

    this._busy = true;
    this._lastAnalyzed.set(ev.type, Date.now());

    try {
      await this._analyze(ev);
    } catch {
      // Silent failure — never crash the main process
    } finally {
      this._busy = false;
    }
  }

  private async _analyze(ev: EngineEvent): Promise<void> {
    if (!this._analyzeProvider) return;

    const eventSummary = JSON.stringify(ev, null, 2);
    const rawAnalysis = await this._analyzeProvider.generateResponse(
      `System event occurred:\n${eventSummary}`,
      ANALYZE_SYSTEM,
    );

    // Parse the structured response
    const analysisMatch   = rawAnalysis.match(/ANALYSIS:\s*(.+?)(?=SUGGESTION:|$)/s);
    const suggestionMatch = rawAnalysis.match(/SUGGESTION:\s*(.+?)$/s);

    const analysis   = analysisMatch?.[1]?.trim()   ?? rawAnalysis.trim();
    const suggestion = suggestionMatch?.[1]?.trim()  ?? '';

    // Grok critiques the analysis
    let critique = '';
    if (this._critiqueProvider && suggestion) {
      try {
        critique = await this._critiqueProvider.generateResponse(
          `Analysis: ${analysis}\nSuggestion: ${suggestion}`,
          CRITIQUE_SYSTEM,
        );
        critique = critique.trim();
      } catch {
        // Critique optional — skip on failure
      }
    }

    const mindEvent: MindSuggestion = {
      eventType:   ev.type,
      analysis,
      critique,
      suggestion,
      triggeredAt: Date.now(),
    };

    // Emit as a typed event that the renderer can listen to
    eventBus.emit({
      type:       'MIND_SUGGESTION',
      eventType:  ev.type,
      analysis,
      critique,
      suggestion,
    });

    console.log(`[AIMind] Analyzed ${ev.type}: ${analysis.substring(0, 80)}...`);

    return void mindEvent;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AIMind | null = null;

export function getAIMind(
  analyzeProvider:  AIProvider | null,
  critiqueProvider: AIProvider | null,
): AIMind {
  if (!_instance) {
    _instance = new AIMind(analyzeProvider, critiqueProvider);
  }
  return _instance;
}
