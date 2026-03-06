// ── VoiceAuthService.ts — Voice-driven identity verification ─────────────────
//
// Listens for the user's passphrase (Web Speech STT) before granting council
// access. The stored display name is used only for the welcome greeting.
//
// Credentials are stored in localStorage under:
//   triforge_auth_name  — display name only (not verified during auth)
//   triforge_auth_pass  — the passphrase that must be spoken
//
// First-run behaviour: if no credentials are configured, access is DENIED
// with reason 'not_configured' so the UI can prompt the user to set them up.
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
   * Listen for a single utterance. Returns normalized transcript.
   * Resolves with '' only after real timeout or hard error — early onend
   * triggers a single restart so brief recognition blips don't cause instant denial.
   */
  listen(timeoutMs = 10000): Promise<string> {
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
      if (!SR) { resolve(''); return; }

      const rec           = new SR();
      rec.lang            = 'en-US';
      rec.interimResults  = false;
      rec.maxAlternatives = 1;
      rec.continuous      = false;

      let finished   = false;
      let hasResult  = false;
      let didRestart = false;
      const startedAt = Date.now();

      const finish = (text: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { rec.stop(); } catch { /* ignore */ }
        resolve(this.normalizeSpoken(text));
      };

      // Hard upper bound — user has timeoutMs total
      const timer = setTimeout(() => finish(''), timeoutMs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: Event) => {
        type R = Event & { results: { [i: number]: { [j: number]: { transcript: string } } } };
        const transcript = (e as R).results[0]?.[0]?.transcript ?? '';
        hasResult = true;
        finish(transcript);
      };

      rec.onerror = () => {
        clearTimeout(timer);
        finish('');
      };

      rec.onend = () => {
        if (finished || hasResult) return;

        const elapsed = Date.now() - startedAt;

        // If recognition ended very early (< 1.5s) without a result, restart
        // once — browser SR can fire onend almost immediately on some platforms.
        if (!didRestart && elapsed < 1500) {
          didRestart = true;
          try { rec.start(); return; } catch { /* fall through to timeout */ }
        }

        // Otherwise let the timeout own the final failure — don't deny instantly.
      };

      try { rec.start(); } catch {
        clearTimeout(timer);
        finish('');
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

  /** Returns the stored name (display only) or null if not configured. */
  getConfiguredName(): string | null {
    return localStorage.getItem('triforge_auth_name') || null;
  }

  /** Save credentials (called from a Settings screen or first-run wizard). */
  setup(name: string, password: string): void {
    localStorage.setItem('triforge_auth_name', this.normalizeSpoken(name));
    localStorage.setItem('triforge_auth_pass', this.normalizeSpoken(password));
  }

  /** Remove credentials (resets to unconfigured / first-run mode). */
  clearCredentials(): void {
    localStorage.removeItem('triforge_auth_name');
    localStorage.removeItem('triforge_auth_pass');
  }
}

/** Singleton — used by CouncilWakeScreen. */
export const voiceAuth = new VoiceAuthService();
