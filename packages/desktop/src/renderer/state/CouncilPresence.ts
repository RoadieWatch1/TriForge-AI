// ── CouncilPresence.ts — Central council state machine ───────────────────────
//
// Single source of truth for the council's current activity state.
// Any component that needs to animate or respond to council activity
// listens to the `triforge:council-state` window event.
//
// States:
//   idle       — background, slow breathing (default)
//   wake       — wake word just detected, triangle flashes
//   listening  — user speaking, soft blue pulse
//   thinking   — AI processing, rotating beam
//   speaking   — AI responding, bright pulse synced to voice
//   consensus  — all AIs agreed, golden flash
//
// Usage:
//   councilPresence.setState('thinking');
//   // Any component: window.addEventListener('triforge:council-state', e => e.detail)

export type CouncilState =
  | 'idle'
  | 'wake'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'consensus';

class CouncilPresenceController {
  private _state: CouncilState = 'idle';
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Return to idle automatically after this many ms with no state change. */
  private static IDLE_AFTER_MS = 8000;

  setState(state: CouncilState): void {
    if (this._state === state) return;
    this._state = state;

    window.dispatchEvent(
      new CustomEvent<CouncilState>('triforge:council-state', { detail: state }),
    );

    // Auto-return to idle after transient states
    if (this._idleTimer) clearTimeout(this._idleTimer);
    if (state === 'wake' || state === 'consensus') {
      this._idleTimer = setTimeout(() => this.setState('idle'), CouncilPresenceController.IDLE_AFTER_MS);
    }
  }

  getState(): CouncilState {
    return this._state;
  }
}

/** Singleton — import and call setState() from anywhere in the renderer. */
export const councilPresence = new CouncilPresenceController();
