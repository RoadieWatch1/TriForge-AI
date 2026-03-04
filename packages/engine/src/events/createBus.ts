// ── createBus.ts ─────────────────────────────────────────────────────────────
//
// Lightweight typed event bus factory backed by Node's EventEmitter.
// Each subsystem gets its own isolated bus — prevents unrelated listeners from
// firing on every event and makes debugging per-subsystem straightforward.

import { EventEmitter } from 'events';

export interface SubBus {
  emit(event: string, ...args: unknown[]): boolean;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
  listenerCount(event: string): number;
}

/** Create an isolated event bus for a specific subsystem. */
export function createBus(): SubBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50); // prevent Node's default 10-listener warning
  return emitter;
}
