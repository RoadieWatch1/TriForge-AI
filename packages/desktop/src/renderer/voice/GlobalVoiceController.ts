// ── GlobalVoiceController.ts — Typed state machine for the ambient voice system ──
//
// Single source of truth for the voice session lifecycle.
// Fires 'triforge:voice-state' (detail: VoiceState) on every transition so any
// component can react without prop-drilling.
//
// States:
//   idle              — wake engine listening, no active session
//   wakeDetected      — wake word heard, auth screen about to show
//   verifyingPassword — CouncilWakeScreen: listening for passphrase
//   authGranted       — auth passed, transitioning into session
//   authDenied        — auth failed, returning to idle after brief pause
//   sessionListening  — Siri loop: mic open, waiting for user speech
//   sessionThinking   — AI request in flight
//   sessionSpeaking   — TTS playing AI response
//   sessionEnded      — session closed, returning to idle
//
// Usage (App.tsx):
//   import { globalVoiceController } from '../voice/GlobalVoiceController';
//   globalVoiceController.transition('wakeDetected');
//   globalVoiceController.state; // current state

export type VoiceState =
  | 'idle'
  | 'wakeDetected'
  | 'verifyingPassword'
  | 'authGranted'
  | 'authDenied'
  | 'sessionListening'
  | 'sessionThinking'
  | 'sessionSpeaking'
  | 'sessionEnded';

// ── Valid transitions ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  idle:               ['wakeDetected'],
  wakeDetected:       ['verifyingPassword', 'idle'],
  verifyingPassword:  ['authGranted', 'authDenied', 'idle'],
  authGranted:        ['sessionListening', 'idle'],
  authDenied:         ['idle'],
  sessionListening:   ['sessionThinking', 'sessionEnded', 'idle'],
  sessionThinking:    ['sessionSpeaking', 'sessionListening', 'sessionEnded', 'idle'],
  sessionSpeaking:    ['sessionListening', 'sessionEnded', 'idle'],
  sessionEnded:       ['idle'],
};

// ── Controller ────────────────────────────────────────────────────────────────

class GlobalVoiceController {
  private _state: VoiceState = 'idle';

  get state(): VoiceState { return this._state; }

  /**
   * Transition to a new state.
   * Validates the transition and fires 'triforge:voice-state' on success.
   * Passing `force: true` bypasses validation (use only for error recovery).
   */
  transition(next: VoiceState, opts: { force?: boolean } = {}): boolean {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!opts.force && !allowed.includes(next)) {
      console.warn(`[GlobalVoiceController] Invalid transition ${this._state} → ${next} (allowed: ${allowed.join(', ')})`);
      return false;
    }
    const prev = this._state;
    this._state = next;
    console.log(`[GlobalVoiceController] ${prev} → ${next}`);
    window.dispatchEvent(new CustomEvent<VoiceState>('triforge:voice-state', { detail: next }));
    return true;
  }

  /** Reset to idle unconditionally (use for error recovery or app shutdown). */
  reset(): void {
    this.transition('idle', { force: true });
  }
}

/** Singleton — mounted by App.tsx, consumed everywhere. */
export const globalVoiceController = new GlobalVoiceController();
