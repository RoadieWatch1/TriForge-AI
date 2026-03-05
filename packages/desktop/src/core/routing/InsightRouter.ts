// ── InsightRouter.ts — Centralized insight routing for the council bus ──────────
//
// Routes COUNCIL_INSIGHT bus events to:
//   1. All renderer windows — `council:insight` push (always)
//   2. TTS pipeline         — when confidence ≥ 0.85 AND active blueprint.voiceAlerts
//   3. `insight:stream`     — field-level stream push for progressive UI rendering
//   4. Ledger               — optional persistence hook (registered externally)
//
// Additionally subscribes to:
//   • eventBus (wildcard) — classifies engine events → warning/info insights
//   • missionController   — mission:complete / mission:failed events
//   • autonomy workflows  — WORKFLOW_TRIGGERED / WORKFLOW_ERROR events
//
// Usage (in ipc.ts):
//   const router = new InsightRouter({ getWindows, textToSpeech, store });
//   await router.start();                         // wires councilBus
//   router.subscribeToEventBus(eventBus);         // wires engine eventBus
//   router.subscribeToMissionController(mc);      // wires mission events
//
// Design constraints:
//   • Zero throws — all dispatch paths are try/catch wrapped
//   • Idempotent start() — safe to call multiple times
//   • Blueprint-aware — re-reads active blueprint on every event (live config)

import { EventEmitter }       from 'events';
import type { BrowserWindow } from 'electron';
import type { CouncilInsight } from '@triforge/engine';

// ── Minimal interface for event bus compatibility ─────────────────────────────

interface AnyEventBus {
  onAny: (cb: (ev: { type: string; [k: string]: unknown }) => void) => (() => void);
}

interface MissionEventEmitter {
  on(event: string, cb: (data: Record<string, unknown>) => void): this;
  off(event: string, cb: (data: Record<string, unknown>) => void): this;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InsightRouterOptions {
  /** Returns all currently open, non-destroyed windows. */
  getWindows: () => BrowserWindow[];

  /** TTS stream function — matches voice.ts textToSpeechStream signature. */
  textToSpeech?: (
    text:    string,
    onChunk: (chunk: Buffer) => void,
    opts?:   { signal?: AbortSignal },
  ) => Promise<void>;

  /** Returns the active blueprint (or null) — used for voiceAlerts check. */
  getActiveBlueprint?: () => { voiceAlerts?: boolean } | null;

  /** Optional Ledger persistence hook — called for every routed insight. */
  onPersist?: (insight: CouncilInsight) => void;
}

export interface InsightStreamEvent {
  /** Insight fields sent progressively — matches `council:insight` shape. */
  type:       CouncilInsight['type'];
  message:    string;
  confidence: number;
  /** Monotonically increasing sequence ID for de-dup in the renderer. */
  seq:        number;
}

// ── InsightRouter ─────────────────────────────────────────────────────────────

export class InsightRouter extends EventEmitter {
  private _opts:           InsightRouterOptions;
  private _seq:            number  = 0;
  private _started:        boolean = false;
  private _handler:        ((data: unknown) => void) | null = null;
  private _unsubEventBus:  (() => void) | null = null;
  private _missionEmitter: MissionEventEmitter | null = null;
  private _missionHandler: ((data: Record<string, unknown>) => void) | null = null;

  constructor(opts: InsightRouterOptions) {
    super();
    this._opts = opts;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Wire this router to the councilBus COUNCIL_INSIGHT event.
   * Idempotent — calling start() twice is safe.
   */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    try {
      const { councilBus } = await import('@triforge/engine');
      this._handler = (data: unknown) => this._dispatch(data as CouncilInsight);
      councilBus.on('COUNCIL_INSIGHT', this._handler);
    } catch (e) {
      this._started = false; // allow retry
      console.warn('[InsightRouter] failed to attach to councilBus:', e);
    }
  }

  /** Detach from all subscribed event sources. */
  async stop(): Promise<void> {
    if (this._handler) {
      try {
        const { councilBus } = await import('@triforge/engine');
        councilBus.off('COUNCIL_INSIGHT', this._handler);
      } catch { /* ignore */ }
      this._handler = null;
    }

    if (this._unsubEventBus) {
      try { this._unsubEventBus(); } catch { /* ignore */ }
      this._unsubEventBus = null;
    }

    if (this._missionEmitter && this._missionHandler) {
      try {
        this._missionEmitter.off('mission:complete', this._missionHandler);
        this._missionEmitter.off('mission:failed',   this._missionHandler);
      } catch { /* ignore */ }
      this._missionEmitter = null;
      this._missionHandler = null;
    }

    this._started = false;
  }

  /**
   * Subscribe to all engine eventBus events.
   * Classifies error/warning events and routes them as insights.
   * Call after start() — safe to call multiple times (previous unsub is cleaned up).
   */
  subscribeToEventBus(bus: AnyEventBus): void {
    if (this._unsubEventBus) {
      try { this._unsubEventBus(); } catch { /* ignore */ }
    }

    this._unsubEventBus = bus.onAny((ev) => {
      try {
        const insight = this._classifyEngineEvent(ev);
        if (insight) this._dispatch(insight);
      } catch { /* non-fatal */ }
    });
  }

  /**
   * Subscribe to MissionController events.
   * Routes mission:complete and mission:failed as insights.
   */
  subscribeToMissionController(mc: MissionEventEmitter): void {
    if (this._missionEmitter && this._missionHandler) {
      try {
        this._missionEmitter.off('mission:complete', this._missionHandler);
        this._missionEmitter.off('mission:failed',   this._missionHandler);
      } catch { /* ignore */ }
    }

    this._missionHandler = (data) => {
      try {
        const isFail = String(data['status'] ?? '') === 'failed';
        const goal   = String(data['goal'] ?? data['missionId'] ?? 'mission');
        this._dispatch({
          type:       isFail ? 'warning' : 'observation',
          message:    isFail
            ? `Mission failed: ${goal.slice(0, 100)}`
            : `Mission complete: ${goal.slice(0, 100)}`,
          confidence: 0.9,
        });
      } catch { /* non-fatal */ }
    };

    this._missionEmitter = mc;
    mc.on('mission:complete', this._missionHandler);
    mc.on('mission:failed',   this._missionHandler);
  }

  // ── Event classification ───────────────────────────────────────────────────

  /**
   * Classify a raw engine event into a CouncilInsight.
   * Returns null for events that should not be routed (most routine events).
   */
  private _classifyEngineEvent(ev: { type: string; [k: string]: unknown }): CouncilInsight | null {
    const t = ev.type ?? '';

    if (t.includes('ERROR') || t.includes('FAILED') || t.includes('ANOMALY')) {
      return {
        type:       'warning',
        message:    `System event: ${t.replace(/_/g, ' ').toLowerCase()}`,
        confidence: 0.75,
      };
    }

    if (t.includes('WORKFLOW_TRIGGERED') || t.includes('WORKFLOW_COMPLETE')) {
      return {
        type:       'observation',
        message:    `Workflow: ${t.replace(/_/g, ' ').toLowerCase()}`,
        confidence: 0.6,
      };
    }

    // All other events are routine — do not route
    return null;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  private _dispatch(insight: CouncilInsight): void {
    const seq = ++this._seq;

    // 1. Broadcast to all renderer windows via council:insight
    this._broadcastToWindows(insight);

    // 2. Stream push — insight:stream for progressive field rendering
    this._pushStream(insight, seq);

    // 3. TTS — high-confidence insights when blueprint voiceAlerts is active
    this._routeToTts(insight);

    // 4. Ledger persistence hook
    if (this._opts.onPersist) {
      try { this._opts.onPersist(insight); } catch { /* non-fatal */ }
    }

    // 5. Emit locally for any in-process subscribers
    this.emit('insight', insight);
  }

  private _broadcastToWindows(insight: CouncilInsight): void {
    try {
      for (const win of this._opts.getWindows()) {
        try {
          if (!win.isDestroyed()) win.webContents.send('council:insight', insight);
        } catch { /* individual window may be closing */ }
      }
    } catch { /* getWindows() failed */ }
  }

  private _pushStream(insight: CouncilInsight, seq: number): void {
    const event: InsightStreamEvent = {
      type:       insight.type,
      message:    insight.message,
      confidence: insight.confidence,
      seq,
    };
    try {
      for (const win of this._opts.getWindows()) {
        try {
          if (!win.isDestroyed()) win.webContents.send('insight:stream', event);
        } catch { /* ignore */ }
      }
    } catch { /* getWindows() failed */ }
  }

  private _routeToTts(insight: CouncilInsight): void {
    if (!this._opts.textToSpeech) return;
    if (insight.confidence < 0.85) return;

    try {
      const blueprint = this._opts.getActiveBlueprint?.();
      if (!blueprint?.voiceAlerts) return;
    } catch { return; }

    const wins   = this._opts.getWindows().filter(w => !w.isDestroyed());
    const target = wins[0];
    if (!target) return;

    const tts = this._opts.textToSpeech;
    tts(insight.message, (chunk) => {
      try {
        if (!target.isDestroyed())
          target.webContents.send('voice:speak:chunk', chunk.toString('base64'));
      } catch { /* window closed mid-stream */ }
    }).then(() => {
      try {
        if (!target.isDestroyed()) target.webContents.send('voice:speak:done');
      } catch { /* ignore */ }
    }).catch(() => { /* TTS failure is non-fatal */ });
  }

  // ── Manual injection (for testing / replay) ───────────────────────────────

  /** Manually route an insight through the full dispatch pipeline. */
  inject(insight: CouncilInsight): void {
    this._dispatch(insight);
  }
}
