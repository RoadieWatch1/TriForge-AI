import { EventEmitter } from 'events';
import type { EngineEvent } from './taskTypes';

// ── EventRecord — event with monotonic ID for backlog replay ──────────────────

export interface EventRecord {
  id: string;        // monotonic string: "1", "2", "3"...
  timestamp: number;
  event: EngineEvent;
}

// ── Event tracing (debug mode) ────────────────────────────────────────────────

let TRACE_EVENTS = false;

export function enableEventTracing(): void {
  TRACE_EVENTS = true;
  console.log('[EventBus] Event tracing enabled');
}

export function disableEventTracing(): void {
  TRACE_EVENTS = false;
}

// ── Queue size constants ──────────────────────────────────────────────────────

const BUFFER_SIZE       = 200;
const QUEUE_WARN_LEVEL  = 500;   // warn when pending queue exceeds this
const MAX_LISTENERS     = 100;   // raised from 50 — missions + sensors add many listeners

// ── EngineEventBus — ring buffer + typed pub/sub + queue stability ─────────────

class EngineEventBus {
  private _emitter = new EventEmitter();
  private _buffer: EventRecord[]       = [];
  private _queue:  EngineEvent[]       = [];
  private _nextId = 1;
  private _processing = false;

  constructor() {
    this._emitter.setMaxListeners(MAX_LISTENERS);
    // Drain the dispatch queue every 10ms in controlled batches
    setInterval(() => this._drainQueue(), 10);
  }

  // ── Emit — synchronous ring-buffer store + queued dispatch ─────────────────
  emit(ev: EngineEvent): string {
    const id = String(this._nextId++);
    const record: EventRecord = { id, timestamp: Date.now(), event: ev };

    // Always store in ring buffer immediately (for since() replay)
    this._buffer.push(record);
    if (this._buffer.length > BUFFER_SIZE) {
      this._buffer.shift(); // drop oldest
    }

    // Queue size warning — protects against event storms
    this._queue.push(ev);
    if (this._queue.length > QUEUE_WARN_LEVEL) {
      console.warn(`[EventBus] Event queue growing large: ${this._queue.length} events pending`);
    }

    if (TRACE_EVENTS) {
      console.log(`[EventBus] +${ev.type}`, ev);
    }

    return id;
  }

  // ── Queue processor — dispatches up to 25 events per 10ms tick ────────────
  private _drainQueue(): void {
    if (this._processing || this._queue.length === 0) return;
    this._processing = true;

    const MAX_PER_TICK = 25;
    const batch = this._queue.splice(0, MAX_PER_TICK);

    for (const ev of batch) {
      try {
        this._emitter.emit(ev.type, ev);
        this._emitter.emit('*', ev);
      } catch (err) {
        console.error(`[EventBus] Handler threw for ${ev.type}`, err);
      }
    }

    this._processing = false;
  }

  // ── Ring buffer replay ─────────────────────────────────────────────────────

  since(sinceId?: string): EventRecord[] {
    if (!sinceId) return [...this._buffer];
    const idx = this._buffer.findIndex(r => r.id === sinceId);
    if (idx === -1) return [...this._buffer]; // ID evicted or unknown → return all
    return this._buffer.slice(idx + 1);
  }

  getLastId(): string | null {
    if (this._buffer.length === 0) return null;
    return this._buffer[this._buffer.length - 1].id;
  }

  // ── Typed subscriptions ────────────────────────────────────────────────────

  on<T extends EngineEvent>(type: T['type'], cb: (ev: T) => void): () => void {
    const handler = cb as (ev: EngineEvent) => void;

    // Duplicate listener guard
    const existing = this._emitter.listeners(type) as Array<(ev: EngineEvent) => void>;
    if (existing.includes(handler)) {
      console.warn(`[EventBus] Duplicate listener ignored for "${type}"`);
      return () => this._emitter.off(type, handler);
    }

    this._emitter.on(type, handler);
    return () => this._emitter.off(type, handler);
  }

  onAny(cb: (ev: EngineEvent) => void): () => void {
    // Duplicate listener guard for wildcard
    const existing = this._emitter.listeners('*') as Array<(ev: EngineEvent) => void>;
    if (existing.includes(cb)) {
      console.warn('[EventBus] Duplicate onAny listener ignored');
      return () => this._emitter.off('*', cb);
    }

    this._emitter.on('*', cb);
    return () => this._emitter.off('*', cb);
  }

  /** Total registered listener count across all event types. */
  listenerCount(): number {
    return this._emitter.eventNames().reduce((n, name) => n + this._emitter.listenerCount(name), 0);
  }

  /** Number of events waiting to be dispatched (useful for health checks). */
  pendingQueueSize(): number {
    return this._queue.length;
  }

  dispose(): void {
    this._emitter.removeAllListeners();
    this._queue.length = 0;
  }
}

export const eventBus = new EngineEventBus();
