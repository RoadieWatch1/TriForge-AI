// ── CouncilSpeechService.ts — Singleton TTS engine for the Council ────────────
//
// Owns OpenAI streaming TTS (MediaSource + SourceBuffer) with Web Speech fallback.
// Fires 'triforge:council-speaking' (detail: msgId | null) so any component
// can observe speaking state without prop-drilling.
//
// Usage:
//   councilSpeech.speak(msgId, text, keyStatus, tier)
//   councilSpeech.interrupt()
//   councilSpeech.currentId  — null when silent

import { councilPresence } from '../state/CouncilPresence';

// ── Service ───────────────────────────────────────────────────────────────────

class CouncilSpeechService {
  private audio:        HTMLAudioElement | null = null;
  private mediaSource:  MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private chunkQueue:   Uint8Array[] = [];
  private appending   = false;
  private _currentId: string | null = null;

  get currentId(): string | null { return this._currentId; }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private setId(id: string | null) {
    this._currentId = id;
    councilPresence.setState(id ? 'speaking' : 'idle');
    window.dispatchEvent(new CustomEvent('triforge:council-speaking', { detail: id }));
  }

  private teardown() {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; }
    window.speechSynthesis?.cancel();
    if (this.mediaSource?.readyState === 'open') {
      try { this.mediaSource.endOfStream(); } catch { /* ignore */ }
    }
    this.mediaSource  = null;
    this.sourceBuffer = null;
    this.chunkQueue   = [];
    this.appending    = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Stop and reset all active speech immediately. */
  interrupt(): void {
    this.teardown();
    window.triforge.voice.interrupt();
    this.setId(null);
  }

  /**
   * Speak `text` associated with `msgId`.
   * Uses OpenAI streaming TTS (Pro/Business + OpenAI key) or Web Speech fallback.
   */
  async speak(msgId: string, text: string, keyStatus: { openai: boolean }, tier: string): Promise<void> {
    this.teardown();

    if (!this.audio) this.audio = new Audio();
    this.setId(msgId);
    const truncated = text.slice(0, 4096);

    // ── Priority 1: OpenAI TTS streaming ─────────────────────────────────────
    if (keyStatus.openai && (tier === 'pro' || tier === 'business')) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ms = new MediaSource();
          this.mediaSource = ms;

          const appendNext = () => {
            if (!this.sourceBuffer || this.sourceBuffer.updating) return;
            if (this.chunkQueue.length > 0) {
              this.appending = true;
              const chunk = this.chunkQueue.shift()!;
              try { this.sourceBuffer.appendBuffer(chunk as Uint8Array<ArrayBuffer>); } catch { /* ignore abort */ }
            } else {
              this.appending = false;
            }
          };

          ms.onsourceopen = () => {
            const sb = ms.addSourceBuffer('audio/mpeg');
            this.sourceBuffer = sb;
            sb.onupdateend = appendNext;
          };

          const unsubChunk = window.triforge.voice.onSpeakChunk((b64: string) => {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            this.chunkQueue.push(bytes);
            appendNext();
          });

          const unsubDone = window.triforge.voice.onSpeakDone(() => {
            unsubChunk();
            unsubDone();
            const finish = () => {
              if (this.chunkQueue.length > 0 || this.sourceBuffer?.updating) {
                setTimeout(finish, 50);
                return;
              }
              if (ms.readyState === 'open') {
                try { ms.endOfStream(); } catch { /* ignore */ }
              }
            };
            finish();
          });

          const blobUrl = URL.createObjectURL(ms);
          this.audio!.src = blobUrl;
          this.audio!.play().catch(reject);
          this.audio!.onended = () => { URL.revokeObjectURL(blobUrl); this.setId(null); resolve(); };
          this.audio!.onerror = () => { URL.revokeObjectURL(blobUrl); this.setId(null); resolve(); };

          window.triforge.voice.speak(truncated).catch(reject);
        });
        return;
      } catch { /* fall through to Web Speech */ }
    }

    // ── Fallback: Web Speech API ──────────────────────────────────────────────
    if ('speechSynthesis' in window) {
      const utt   = new SpeechSynthesisUtterance(truncated);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => /Microsoft (Aria|Jenny|Guy|Davis|Tony) Online.*Natural/i.test(v.name)) ||
        voices.find(v => /(Ava|Allison|Samantha).*Enhanced/i.test(v.name))                      ||
        voices.find(v => v.name === 'Samantha')                                                  ||
        voices.find(v => /^Microsoft Aria$/i.test(v.name))                                       ||
        voices.find(v => /Google US English/i.test(v.name))                                      ||
        voices.find(v => v.lang === 'en-US' && v.localService);
      if (preferred) utt.voice = preferred;
      utt.rate  = 0.92;
      utt.pitch = 1.0;
      utt.onend   = () => { this.setId(null); };
      utt.onerror = () => { this.setId(null); };
      window.speechSynthesis.speak(utt);
      return;
    }

    this.setId(null);
  }

  /**
   * Speak an auth/wake prompt via Web Speech only (no keyStatus/tier needed).
   * Returns when speech ends (or immediately if synthesis unavailable).
   */
  speakAuth(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utt    = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => /Microsoft (Aria|Jenny|Guy|Davis|Tony) Online.*Natural/i.test(v.name)) ||
        voices.find(v => /(Ava|Allison|Samantha).*Enhanced/i.test(v.name))                      ||
        voices.find(v => v.name === 'Samantha')                                                  ||
        voices.find(v => /^Microsoft Aria$/i.test(v.name))                                       ||
        voices.find(v => /Google US English/i.test(v.name))                                      ||
        voices.find(v => v.lang === 'en-US' && v.localService);
      if (preferred) utt.voice = preferred;
      utt.rate  = 0.92;
      utt.pitch = 1.0;
      utt.onend   = () => resolve();
      utt.onerror = () => resolve();
      window.speechSynthesis.speak(utt);
    });
  }
}

/** Singleton — used by Chat.tsx, CouncilWakeScreen, and future session components. */
export const councilSpeech = new CouncilSpeechService();
