// ── interruptController.ts ───────────────────────────────────────────────────
//
// Tracks all active AbortControllers for in-flight council streams.
// Call interrupt() to cancel every running provider stream at once.
//
// EventBus integration: subscribes to COUNCIL_CONV_INTERRUPT so any part of
// the system can trigger an interrupt without direct module coupling.

import { eventBus } from '../core/eventBus';

const _active: AbortController[] = [];

/** Register a controller that belongs to an in-flight stream. */
export function registerAbortController(ac: AbortController): void {
  _active.push(ac);
}

/** Abort all registered in-flight streams and clear the list. */
export function interrupt(): void {
  for (const ac of _active) {
    try { ac.abort(); } catch { /* already aborted */ }
  }
  _active.length = 0;
}

/** Remove all registrations without aborting (call after streams complete). */
export function clearAbortControllers(): void {
  _active.length = 0;
}

// Wire EventBus listener once (singleton pattern)
eventBus.on<{ type: 'COUNCIL_CONV_INTERRUPT' }>('COUNCIL_CONV_INTERRUPT', () => {
  interrupt();
});
