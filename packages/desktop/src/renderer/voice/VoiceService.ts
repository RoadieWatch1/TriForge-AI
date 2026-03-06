// ── VoiceService.ts — Global wake engine controller ───────────────────────────
//
// Singleton that owns the VoiceCommandBridge lifecycle and fires the
// `triforge:council-wake` custom event when the council wake word is detected.
//
// Started from Chat.tsx on mount so the mic permission dialog appears after
// the UI is visible, not on raw app boot.
//
// Usage:
//   voiceService.start()    — boot (called once from index.tsx)
//   voiceService.pause()    — mute while TTS is speaking
//   voiceService.resume()   — restore after TTS finishes
//   voiceService.disable()  — fully stop (e.g. while Live Voice Chat owns the mic)
//   voiceService.enable()   — re-enable and restart

import { VoiceCommandBridge } from './VoiceCommandBridge';
import { onCouncilCommand } from '../command/CommandDispatcher';
import { councilPresence } from '../state/CouncilPresence';
import { playWakeTone } from '../audio/councilSounds';

export type WakeStatus = 'idle' | 'loading' | 'ready' | 'error';

const WAKE_COOLDOWN_MS = 3000; // prevent repeated triggers within 3 s

class VoiceService {
  private bridge:     VoiceCommandBridge | null = null;
  private unsubCmd:   (() => void) | null = null;
  private _enabled  = true;
  private _status:  WakeStatus = 'idle';
  private _lastWake = 0;

  get status(): WakeStatus { return this._status; }

  private _setStatus(s: WakeStatus) {
    this._status = s;
    window.dispatchEvent(new CustomEvent('triforge:wake-status', { detail: s }));
  }

  /** Start the wake engine. Idempotent — safe to call multiple times. */
  start(): void {
    if (!this._enabled || this.bridge) return;

    this._setStatus('loading');
    this.bridge = new VoiceCommandBridge();
    this.bridge.start().then(() => {
      this._setStatus('ready');
    }).catch(() => {
      this._setStatus('error');
    });

    this.unsubCmd = onCouncilCommand((matched) => {
      if (matched.command === 'council_assemble') {
        const now = Date.now();
        if (now - this._lastWake < WAKE_COOLDOWN_MS) {
          console.log('[VoiceService] Wake cooldown active — ignoring duplicate trigger');
          return;
        }
        this._lastWake = now;
        console.log('[VoiceService] Wake word confirmed — triggering council');
        councilPresence.setState('wake');
        playWakeTone();
        window.dispatchEvent(new CustomEvent('triforge:council-wake'));
      }
    });
  }

  stop(): void {
    this.unsubCmd?.();
    this.unsubCmd = null;
    this.bridge?.stop();
    this.bridge = null;
  }

  pause():  void { this.bridge?.pause(); }
  resume(): void { this.bridge?.resume(); }

  enable(): void {
    this._enabled = true;
    if (!this.bridge) this.start();
  }

  disable(): void {
    this._enabled = false;
    this.stop();
  }
}

/** Singleton — started from index.tsx, controlled from Chat.tsx. */
export const voiceService = new VoiceService();
