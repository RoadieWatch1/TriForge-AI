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

// ── Web Speech API type declarations (Electron/Chromium) ─────────────────────
// Declared here because lib.dom.d.ts coverage of SpeechRecognition varies
// across TypeScript versions.

interface ISpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface ISpeechRecognitionResult {
  readonly length: number;
  item(index: number): ISpeechRecognitionAlternative;
  readonly isFinal: boolean;
  [index: number]: ISpeechRecognitionAlternative;
}
interface ISpeechRecognitionResultList {
  readonly length: number;
  item(index: number): ISpeechRecognitionResult;
  [index: number]: ISpeechRecognitionResult;
}
interface ISpeechRecognitionEvent extends Event {
  readonly results: ISpeechRecognitionResultList;
  readonly resultIndex: number;
}
interface ISpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onerror: ((e: ISpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface ISpeechRecognitionCtor {
  new (): ISpeechRecognition;
}

function getSpeechRecognition(): ISpeechRecognitionCtor | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as ISpeechRecognitionCtor | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

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
  private rec: ISpeechRecognition | null = null;
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

    const SR = getSpeechRecognition();
    if (!SR) return; // Web Speech not available in this context

    const rec = new SR();
    rec.continuous      = true;
    rec.interimResults  = false;
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;
    this.rec = rec;

    rec.onresult = (e: ISpeechRecognitionEvent) => {
      if (this.paused) return;
      const lastIdx = e.results.length - 1;
      const transcript = e.results[lastIdx][0].transcript;
      if (matchesWakeWord(transcript)) {
        this._onWakeDetected();
      }
    };

    rec.onerror = (e: ISpeechRecognitionErrorEvent) => {
      // 'not-allowed' = microphone denied; 'no-speech' = silence timeout (normal)
      if (e.error !== 'no-speech') {
        console.warn('[WakeWordListener] SpeechRecognition error:', e.error);
      }
      this.rec = null;
      // Don't retry on permission errors — it won't recover without user action
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') return;
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
