// ── VoiceAuthService.ts — Voice-driven identity verification ─────────────────
//
// Listens for the user's passphrase (Web Speech STT) before granting council
// access. Only the passphrase is stored and verified — no name is required.
//
// Credential stored in localStorage:
//   triforge_auth_pass  — the passphrase that must be spoken
//
// Legacy key triforge_auth_name is cleared on credential removal for migration.
//
// First-run behaviour: if no passphrase is configured, access is DENIED
// with reason 'not_configured' so the UI can prompt the user to set one up.
//
// No IPC dependencies — runs entirely in the renderer via browser APIs.

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthDeniedReason =
  | 'not_configured'   // no credentials stored yet
  | 'sr_unavailable'   // SpeechRecognition API not present
  | 'no_input'         // user said nothing (timeout)
  | 'wrong_credentials'// name/password did not match
  | 'max_retries';     // exceeded retry limit

export interface AuthResult {
  granted: boolean;
  name:    string;
  reason?: AuthDeniedReason; // present when granted === false
}

/**
 * Structured result from listen().
 * Allows callers to distinguish between mic errors, silence, and successful capture.
 */
export type ListenFailReason =
  | 'sr_unavailable'     // browser SpeechRecognition API not present
  | 'no_speech'          // timeout expired with no input
  | 'recognition_error'; // mic error or SR internal failure

export interface ListenResult {
  transcript: string;       // non-empty if speech was captured
  failReason?: ListenFailReason; // set when transcript is empty
}

// ── VoiceAuthService ──────────────────────────────────────────────────────────

class VoiceAuthService {

  // ── Speech synthesis ───────────────────────────────────────────────────────

  /** Speak text via browser TTS. Resolves when utterance ends. */
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        window.speechSynthesis?.cancel();
        const utt    = new SpeechSynthesisUtterance(text);
        utt.rate     = 0.92;
        utt.pitch    = 1.0;
        utt.volume   = 1.0;
        utt.onend    = () => resolve();
        utt.onerror  = () => resolve(); // non-fatal
        window.speechSynthesis.speak(utt);
      } catch {
        resolve();
      }
    });
  }

  // ── Text normalization ─────────────────────────────────────────────────────

  /**
   * Normalize spoken text for comparison: lowercase, trim, collapse spaces,
   * remove punctuation, convert hyphens/underscores to spaces.
   */
  private normalizeSpoken(text: string): string {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Speech recognition ─────────────────────────────────────────────────────

  /**
   * Listen for a single utterance. Returns a structured ListenResult.
   *
   * Callers can inspect failReason to distinguish between:
   *   sr_unavailable    — browser has no SpeechRecognition API
   *   no_speech         — timeout expired, nothing heard
   *   recognition_error — mic or SR engine error
   *
   * Early onend (< 1.5 s without result) triggers a single restart so brief
   * recognition blips don't cause instant denial.
   */
  private _activeRec: { stop(): void } | null = null;

  /**
   * Cancel any in-progress listen() call immediately.
   * Call this from component cleanup to avoid a dangling SR instance
   * competing with whatever opens the mic next.
   */
  cancelListen(): void {
    try { this._activeRec?.stop(); } catch { /* ignore */ }
    this._activeRec = null;
  }

  listen(timeoutMs = 10000): Promise<ListenResult> {
    type SRCtor = new() => {
      lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
      onresult: ((e: Event) => void) | null;
      onerror:  ((e: Event) => void) | null;
      onend:    (() => void) | null;
      start(): void; stop(): void;
    };

    return new Promise((resolve) => {
      const w  = window as Window & { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
      const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!SR) { resolve({ transcript: '', failReason: 'sr_unavailable' }); return; }

      const rec           = new SR();
      rec.lang            = 'en-US';
      rec.interimResults  = false;
      rec.maxAlternatives = 1;
      rec.continuous      = false;

      this._activeRec = rec; // store so cancelListen() can reach it

      let finished    = false;
      let hasResult   = false;
      let didRestart  = false;
      let hadError    = false;
      const startedAt = Date.now();

      const finish = (text: string, failReason?: ListenFailReason) => {
        if (finished) return;
        finished = true;
        this._activeRec = null;
        clearTimeout(timer);
        try { rec.stop(); } catch { /* ignore */ }
        const transcript = this.normalizeSpoken(text);
        resolve(transcript ? { transcript } : { transcript: '', failReason });
      };

      // Hard upper bound — user has timeoutMs total
      const timer = setTimeout(() => finish('', 'no_speech'), timeoutMs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: Event) => {
        type R = Event & { results: { [i: number]: { [j: number]: { transcript: string } } } };
        const transcript = (e as R).results[0]?.[0]?.transcript ?? '';
        hasResult = true;
        finish(transcript);
      };

      rec.onerror = () => {
        hadError = true;
        clearTimeout(timer);
        finish('', 'recognition_error');
      };

      rec.onend = () => {
        if (finished || hasResult || hadError) return;

        const elapsed = Date.now() - startedAt;

        // If recognition ended very early (< 1.5s) without a result, restart
        // once — browser SR can fire onend almost immediately on some platforms.
        if (!didRestart && elapsed < 1500) {
          didRestart = true;
          try { this._activeRec = rec; rec.start(); return; } catch { /* fall through to timeout */ }
        }

        // Otherwise let the timeout own the final failure — don't deny instantly.
      };

      try { rec.start(); } catch {
        clearTimeout(timer);
        finish('', 'recognition_error');
      }
    });
  }

  // ── Verification ───────────────────────────────────────────────────────────

  /**
   * Returns true if every token in `stored` appears in `heard`.
   * Handles SR filler-word insertions and minor word-boundary differences.
   */
  private tokenSubsetMatch(stored: string, heard: string): boolean {
    const storedTokens = stored.split(' ').filter(t => t.length > 0);
    const heardSet     = new Set(heard.split(' ').filter(t => t.length > 0));
    return storedTokens.length > 0 && storedTokens.every(t => heardSet.has(t));
  }

  /** Compare spoken passphrase against stored value. Name is not verified — display only. */
  verify(password: string): boolean {
    const storedPass = this.normalizeSpoken(localStorage.getItem('triforge_auth_pass') ?? '');
    const heardPass  = this.normalizeSpoken(password);

    console.log('[VoiceAuth] verify', { heardPass, storedPass });

    // Exact match
    if (heardPass === storedPass) return true;

    // Token-subset fallback: stored tokens must all appear in heard tokens
    // (handles SR adding filler words or hearing extra tokens around the target)
    const passOk = this.tokenSubsetMatch(storedPass, heardPass);
    if (passOk) console.log('[VoiceAuth] granted via token-subset match');
    return passOk;
  }

  /** Returns true if a passphrase has been configured. */
  isSetup(): boolean {
    return !!localStorage.getItem('triforge_auth_pass');
  }

  /** Save voice passphrase. */
  setup(_name: string, password: string): void {
    localStorage.setItem('triforge_auth_pass', this.normalizeSpoken(password));
  }

  /** Remove passphrase (resets to unconfigured / first-run mode). Also clears legacy name key. */
  clearCredentials(): void {
    localStorage.removeItem('triforge_auth_pass');
    localStorage.removeItem('triforge_auth_name'); // migration: remove old name key if present
  }
}

/** Singleton — used by CouncilWakeScreen. */
export const voiceAuth = new VoiceAuthService();
