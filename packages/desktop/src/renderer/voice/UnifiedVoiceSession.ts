// ── UnifiedVoiceSession.ts — Siri-style voice session controller ──────────────
//
// Owns the listen → send → speak loop for an active hands-free Council session.
// Replaces the scattered logic in HandsFreeVoice.tsx with a single service that
// integrates with GlobalVoiceController and CouncilSpeechService.
//
// Loop:
//   start()  → begin listening (sessionListening)
//   user speaks → onTranscript callback → sessionThinking
//   AI responds → councilSpeech fires sessionSpeaking via its event
//   speaking ends → restart listening (sessionListening)
//   silence 10 min OR exit phrase → end()
//
// Usage:
//   unifiedVoiceSession.start({ userName, onTranscript, onEnd })
//   unifiedVoiceSession.end()
//   unifiedVoiceSession.notifySpeakingStart() / notifySpeakingEnd()

import { globalVoiceController } from './GlobalVoiceController';
import { councilPresence }        from '../state/CouncilPresence';
import { playListeningTone, playErrorTone } from '../audio/councilSounds';
import { WAKE_PHRASES }           from './VoskWakeEngine';

// ── Config ────────────────────────────────────────────────────────────────────

const INACTIVITY_MS   = 10 * 60 * 1000;
const WAKE_PHRASE_SET = new Set<string>(WAKE_PHRASES as unknown as string[]);
const EXIT_PHRASES    = [
  'open up desktop', 'open desktop', 'exit council',
  'stop listening', 'stop council', 'goodbye council', 'council goodbye',
];

// ── Types ─────────────────────────────────────────────────────────────────────

type SRCtor = new() => {
  continuous:     boolean;
  interimResults: boolean;
  lang:           string;
  onresult:  ((e: Event) => void) | null;
  onerror:   ((e: Event) => void) | null;
  onend:     (() => void) | null;
  start(): void;
  stop():  void;
};
type SRResult = { isFinal: boolean; [j: number]: { transcript: string } };

export interface SessionOptions {
  userName:     string;
  onTranscript: (text: string) => void;
  onEnd:        (reason: 'inactivity' | 'exit_command' | 'error') => void;
}

// ── Session ───────────────────────────────────────────────────────────────────

class UnifiedVoiceSession {
  private opts:          SessionOptions | null = null;
  private rec:           { stop(): void } | null = null;
  private listening      = false;
  private speaking       = false;
  private restartTimer:  ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private _active        = false;

  get active(): boolean { return this._active; }

  // ── Public API ──────────────────────────────────────────────────────────────

  start(opts: SessionOptions): void {
    if (this._active) this._stop('error');
    this.opts     = opts;
    this._active  = true;
    this.speaking = false;
    this._resetInactivity();
    this._startListening();
  }

  end(): void {
    if (this._active) this._stop('exit_command');
  }

  /** Call when TTS begins so the mic loop pauses (avoids echo). */
  notifySpeakingStart(): void {
    if (!this._active) return;
    this.speaking = true;
    this._stopListening();
    globalVoiceController.transition('sessionSpeaking');
  }

  /** Call when TTS ends so the mic loop restarts. */
  notifySpeakingEnd(): void {
    if (!this._active) return;
    this.speaking = false;
    this.restartTimer = setTimeout(() => this._startListening(), 400);
    globalVoiceController.transition('sessionListening');
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _stop(reason: 'inactivity' | 'exit_command' | 'error'): void {
    this._active = false;
    this._clearInactivity();
    this._stopListening();
    globalVoiceController.transition('sessionEnded');
    globalVoiceController.transition('idle');
    councilPresence.setState('idle');
    const cb = this.opts?.onEnd;
    this.opts = null;
    cb?.(reason);
  }

  private _resetInactivity(): void {
    this._clearInactivity();
    this.inactivityTimer = setTimeout(() => {
      if (this._active) {
        console.log('[UnifiedVoiceSession] 10 min inactivity — ending session');
        playErrorTone();
        this._stop('inactivity');
      }
    }, INACTIVITY_MS);
  }

  private _clearInactivity(): void {
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
  }

  private _stopListening(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.rec?.stop();
    this.rec       = null;
    this.listening = false;
  }

  private _startListening(): void {
    if (!this._active || this.speaking || this.listening) return;

    const w  = window as Window & { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[UnifiedVoiceSession] SpeechRecognition unavailable — ending session');
      this._stop('error');
      return;
    }

    globalVoiceController.transition('sessionListening');
    councilPresence.setState('listening');

    const rec = new SR();
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = 'en-US';
    this.rec           = rec;
    this.listening     = true;

    rec.onresult = (e: Event) => {
      const results = (e as Event & { results: SRResult[] }).results;
      let finalText = '';
      for (let i = 0; i < results.length; i++) {
        if (results[i].isFinal) finalText += results[i][0].transcript;
      }
      const trimmed = finalText.trim();
      if (!trimmed) return;

      const lower = trimmed.toLowerCase();

      // Exit command — end the session
      if (EXIT_PHRASES.some(p => lower.includes(p))) {
        this._stopListening();
        this._stop('exit_command');
        return;
      }

      // Wake phrase re-trigger — already in session; acknowledge and keep listening
      if (WAKE_PHRASE_SET.has(lower)) {
        playListeningTone();
        this._stopListening();
        this.restartTimer = setTimeout(() => this._startListening(), 200);
        return;
      }

      // Real user input — hand off to AI
      this._resetInactivity();
      globalVoiceController.transition('sessionThinking');
      councilPresence.setState('thinking');
      this._stopListening();
      this.opts?.onTranscript(trimmed);
    };

    rec.onerror = () => {
      this.listening = false;
      this.rec       = null;
      if (this._active && !this.speaking) {
        this.restartTimer = setTimeout(() => this._startListening(), 800);
      }
    };

    rec.onend = () => {
      this.listening = false;
      this.rec       = null;
      if (this._active && !this.speaking) {
        this.restartTimer = setTimeout(() => this._startListening(), 300);
      }
    };

    try { rec.start(); } catch {
      this.listening = false;
      this.rec       = null;
    }
  }
}

/** Singleton — one session at a time. */
export const unifiedVoiceSession = new UnifiedVoiceSession();
