// ── councilRuntime.ts ─────────────────────────────────────────────────────────
//
// Hot Council Mode — keeps the AI council warm and ready so wake-word
// activation responds instantly instead of waiting for provider initialization.
//
// Responsibilities:
//  1. Eagerly calls getActiveProviders() at startup to pre-instantiate provider
//     HTTP clients (avoids cold-start delay on first message).
//  2. Emits voiceBus / councilBus signals so other subsystems know the council
//     is ready (voice listener, phone-link remote, UI wake animation).
//  3. Relays wake-word detection from the renderer into the bus system so
//     other main-process consumers (e.g. phone-link push) can react.
//
// Integration:
//   // In ipc.ts, after phoneLinkServer setup:
//   _councilRuntime = new CouncilRuntime(providerManager);
//   _councilRuntime.initialize().catch(() => {});
//
//   // In voice:wake-detected IPC handler:
//   _councilRuntime?.onWakeDetected();

import type { ProviderManager } from '../core/providerManager';
import { voiceBus, councilBus } from '../events/buses';

export class CouncilRuntime {
  private _initialized = false;

  constructor(private _pm: ProviderManager) {}

  /**
   * Initialize the council runtime.
   * Safe to call multiple times — only runs once.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    await this._warmProviders();

    voiceBus.emit('WAKE_LISTENER_READY');
    councilBus.emit('COUNCIL_READY');
  }

  /**
   * Call when the wake word is detected in the renderer.
   * Relays the event through the bus system for any main-process consumers.
   */
  onWakeDetected(): void {
    voiceBus.emit('WAKE_WORD_DETECTED');
    councilBus.emit('COUNCIL_WAKE');

    // After a brief animation window, signal that speech input should begin
    setTimeout(() => councilBus.emit('COUNCIL_LISTENING'), 350);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Eagerly instantiate all configured providers so their HTTP clients are
   * ready before the user sends the first message.
   */
  private async _warmProviders(): Promise<void> {
    try {
      await this._pm.getActiveProviders();
    } catch {
      // Providers warm on first use as a fallback — not a fatal error
    }
  }
}
