/**
 * EventIntelligence.ts — Lightweight AI observability layer.
 *
 * Observes the EventBus and uses the AI council to generate insights about
 * system activity. Complementary to AIMind (which emits renderer-visible
 * MIND_SUGGESTION events); EventIntelligence focuses on console-level
 * logging and structured insight records for internal monitoring.
 *
 * Performance protection:
 *   - Whitelist of observable event types
 *   - 120s minimum cooldown per event type (less aggressive than AIMind)
 *   - Max 1 concurrent analysis
 *   - Skips its own INTELLIGENCE_* events to prevent loops
 */

import type { AIProvider }  from '../core/providers/provider';
import type { EngineEvent }  from '../core/taskTypes';
import { eventBus }          from '../core/eventBus';

// ── Observable events ─────────────────────────────────────────────────────────

const OBSERVABLE_EVENTS = new Set<string>([
  'TOOL_BUS_COMPLETE',
  'TOOL_BUS_ERROR',
  'IMAGE_GENERATED',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'MISSION_COMPLETED',
  'MISSION_FAILED',
  'COUNCIL_RESULT',
  'COUNCIL_CRITIQUE',
  'AGENT_BLOCKED',
]);

const COOLDOWN_MS = 120_000; // 2 minutes between analyses of same event type

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IntelligenceInsight {
  eventType:   string;
  analysis:    string;
  critique:    string;
  observedAt:  number;
}

// ── EventIntelligence ─────────────────────────────────────────────────────────

const ANALYZE_SYSTEM = `You are a system observability AI. Analyze the provided system event
and return a concise insight (2-3 sentences) about what happened and whether it indicates
healthy or unhealthy system behavior. Focus on patterns, anomalies, or performance issues.`;

const CRITIQUE_SYSTEM = `You are a critical systems reviewer. In 1-2 sentences, challenge the
provided analysis: is it accurate? Is there a different interpretation?`;

export class EventIntelligence {
  private _analyzeProvider:  AIProvider | null;
  private _critiqueProvider: AIProvider | null;
  private _lastObserved:     Map<string, number> = new Map();
  private _busy              = false;
  private _unsubscribe:      (() => void) | null = null;
  private _running           = false;
  private _insightLog:       IntelligenceInsight[] = [];
  private readonly _maxLog   = 100;

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
      console.log('[EventIntelligence] No provider — observability disabled');
      return;
    }

    this._running = true;
    this._unsubscribe = eventBus.onAny((ev: EngineEvent) => {
      void this._onEvent(ev);
    });

    console.log('[EventIntelligence] Started — AI observability active');
  }

  stop(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._running = false;
  }

  isRunning(): boolean { return this._running; }

  getRecentInsights(n: number = 20): IntelligenceInsight[] {
    return this._insightLog.slice(-n);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _onEvent(ev: EngineEvent): Promise<void> {
    if (
      ev.type.startsWith('INTELLIGENCE_') ||
      !OBSERVABLE_EVENTS.has(ev.type)
    ) return;

    const lastAt = this._lastObserved.get(ev.type) ?? 0;
    if (Date.now() - lastAt < COOLDOWN_MS) return;
    if (this._busy) return;

    this._busy = true;
    this._lastObserved.set(ev.type, Date.now());

    try {
      await this._observe(ev);
    } catch {
      // Silent failure
    } finally {
      this._busy = false;
    }
  }

  private async _observe(ev: EngineEvent): Promise<void> {
    if (!this._analyzeProvider) return;

    const analysis = await this._analyzeProvider.generateResponse(
      `System event:\n${JSON.stringify(ev, null, 2)}`,
      ANALYZE_SYSTEM,
    );

    let critique = '';
    if (this._critiqueProvider) {
      try {
        critique = await this._critiqueProvider.generateResponse(
          `Analysis: ${analysis}`,
          CRITIQUE_SYSTEM,
        );
        critique = critique.trim();
      } catch { /* optional */ }
    }

    const insight: IntelligenceInsight = {
      eventType:  ev.type,
      analysis:   analysis.trim(),
      critique,
      observedAt: Date.now(),
    };

    // Rolling log
    this._insightLog.push(insight);
    if (this._insightLog.length > this._maxLog) {
      this._insightLog.splice(0, this._insightLog.length - this._maxLog);
    }

    // Emit so HealthMonitor / Supervisor can observe
    eventBus.emit({
      type:      'INTELLIGENCE_INSIGHT',
      eventType: ev.type,
      analysis:  insight.analysis,
      critique:  insight.critique,
    });

    console.log(`[EventIntelligence] ${ev.type} insight: ${insight.analysis.substring(0, 100)}`);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: EventIntelligence | null = null;

export function getEventIntelligence(
  analyzeProvider:  AIProvider | null,
  critiqueProvider: AIProvider | null,
): EventIntelligence {
  if (!_instance) {
    _instance = new EventIntelligence(analyzeProvider, critiqueProvider);
  }
  return _instance;
}
