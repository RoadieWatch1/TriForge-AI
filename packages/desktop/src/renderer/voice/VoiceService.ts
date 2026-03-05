// ── VoiceService.ts — Global wake engine controller ───────────────────────────
//
// Singleton that owns the VoiceCommandBridge lifecycle and fires the
// `triforge:council-wake` custom event when the council wake word is detected.
//
// Started from index.tsx on app boot so wake listening is always active,
// independent of which React component is mounted.
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

class VoiceService {
  private bridge:   VoiceCommandBridge | null = null;
  private unsubCmd: (() => void) | null = null;
  private _enabled = true;

  /** Start the wake engine. Idempotent — safe to call multiple times. */
  start(): void {
    if (!this._enabled || this.bridge) return;

    this.bridge = new VoiceCommandBridge();
    this.bridge.start(); // async: downloads vosk model on first run (~40 MB), then listens

    this.unsubCmd = onCouncilCommand((matched) => {
      if (matched.command === 'council_assemble') {
        console.log('[TriForge] Wake word detected: Council');
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
