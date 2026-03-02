import { EventEmitter } from 'events';
import type { EngineEvent } from './taskTypes';

// ── EventRecord — event with monotonic ID for backlog replay ──────────────────

export interface EventRecord {
  id: string;        // monotonic string: "1", "2", "3"...
  timestamp: number;
  event: EngineEvent;
}

// ── EngineEventBus — ring buffer + typed pub/sub ───────────────────────────────

const BUFFER_SIZE = 200;

class EngineEventBus {
  private _emitter = new EventEmitter();
  private _buffer: EventRecord[] = [];
  private _nextId = 1;

  constructor() {
    this._emitter.setMaxListeners(50);
  }

  // Emit event, store in ring buffer, return assigned event ID
  emit(ev: EngineEvent): string {
    const id = String(this._nextId++);
    const record: EventRecord = { id, timestamp: Date.now(), event: ev };

    this._buffer.push(record);
    if (this._buffer.length > BUFFER_SIZE) {
      this._buffer.shift(); // drop oldest
    }

    this._emitter.emit(ev.type, ev);
    this._emitter.emit('*', ev);
    return id;
  }

  // Return all buffered events after `sinceId` (exclusive).
  // If sinceId not found or omitted, returns full buffer.
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

  on<T extends EngineEvent>(type: T['type'], cb: (ev: T) => void): () => void {
    this._emitter.on(type, cb as (ev: EngineEvent) => void);
    return () => this._emitter.off(type, cb as (ev: EngineEvent) => void);
  }

  onAny(cb: (ev: EngineEvent) => void): () => void {
    this._emitter.on('*', cb);
    return () => this._emitter.off('*', cb);
  }

  dispose(): void {
    this._emitter.removeAllListeners();
  }
}

export const eventBus = new EngineEventBus();
