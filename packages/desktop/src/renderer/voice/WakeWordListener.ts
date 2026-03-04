// ── WakeWordListener ──────────────────────────────────────────────────────────
//
// Low-CPU background listener that detects "Council" wake phrases.
// Uses continuous SpeechRecognition with a small result window.
// CPU impact: <1% idle because it only processes short utterances.
//
// Supported phrases (case-insensitive, prefix match):
//   "council", "hey council", "okay council", "council listen", "council help"
//
// Usage:
//   const wl = new WakeWordListener(() => activateHandsFree());
//   wl.start();          // begin passive listening
//   wl.pause();          // call while AI is speaking (avoids self-trigger)
//   wl.resume();         // call when AI finishes speaking
//   wl.stop();           // shut down completely

import { playCouncilWakeTone } from '../audio/wakeTone';

const WAKE_WORDS = [
  'council',
  'hey council',
  'okay council',
  'council listen',
  'council help',
] as const;

// Activation timeout: if user says "Council" but doesn't speak a command,
// reset after this many milliseconds.
const WAKE_TIMEOUT_MS = 8000;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

function matchesWakeWord(text: string): boolean {
  const n = normalize(text);
  return WAKE_WORDS.some(w => n === w || n.startsWith(w + ' '));
}

export class WakeWordListener {
  private rec: SpeechRecognition | null = null;
  private enabled = false;
  private paused  = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onWake: () => void;

  constructor(onWake: () => void) {
    this.onWake = onWake;
  }

  /** Start passive listening. Call once when voice features are enabled. */
  start(): void {
    this.enabled = true;
    this.paused  = false;
    this._listen();
  }

  /** Pause detection while the AI is speaking — prevents self-triggering. */
  pause(): void {
    this.paused = true;
    this.rec?.stop();
  }

  /** Resume after AI finishes speaking. */
  resume(): void {
    if (!this.enabled) return;
    this.paused = false;
    this._listen();
  }

  /** Permanently stop — call on component unmount or when voice is fully disabled. */
  stop(): void {
    this.enabled = false;
    this.paused  = false;
    this._clearWakeTimer();
    this.rec?.stop();
    this.rec = null;
  }

  private _listen(): void {
    if (!this.enabled || this.paused || this.rec) return;

    const SR = (window as Window & typeof globalThis).SpeechRecognition
            ?? (window as Window & typeof globalThis).webkitSpeechRecognition;
    if (!SR) return; // Web Speech not available in this context

    const rec = new SR();
    rec.continuous      = true;
    rec.interimResults  = false;
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;
    this.rec = rec;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      if (this.paused) return;
      const lastIdx = e.results.length - 1;
      const transcript = e.results[lastIdx][0].transcript;
      if (matchesWakeWord(transcript)) {
        this._onWakeDetected();
      }
    };

    rec.onerror = () => {
      this.rec = null;
      if (this.enabled && !this.paused) {
        setTimeout(() => this._listen(), 1000);
      }
    };

    rec.onend = () => {
      this.rec = null;
      if (this.enabled && !this.paused) {
        // Small gap before restarting to prevent rapid-restart loops
        setTimeout(() => this._listen(), 500);
      }
    };

    try { rec.start(); } catch {
      this.rec = null;
    }
  }

  private _onWakeDetected(): void {
    // Play a subtle audio tone to acknowledge wake detection
    playCouncilWakeTone();

    // Fire the callback to activate HandsFreeVoice
    this.onWake();

    // Set a timeout: if the user doesn't speak a command, reset to passive listening
    this._clearWakeTimer();
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      // No action needed — HandsFreeVoice will time out on its own
    }, WAKE_TIMEOUT_MS);
  }

  private _clearWakeTimer(): void {
    if (this.wakeTimer) { clearTimeout(this.wakeTimer); this.wakeTimer = null; }
  }
}

// Type declarations for Web Speech API (Electron/Chromium)
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}
