// ── VoiceAuthService.ts — Voice-driven identity verification ─────────────────
//
// Presents spoken prompts (Web Speech TTS) and listens for the user's name
// and password (Web Speech STT) before granting council access.
//
// Credentials are stored in localStorage under:
//   triforge_auth_name
//   triforge_auth_pass
//
// First-run behaviour: if no credentials are configured, access is DENIED
// with reason 'not_configured' so the UI can prompt the user to set them up.
//
// Usage:
//   const result = await voiceAuth.requestIdentity();
//   if (result.granted) startCouncil(result.name);
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

  // ── Speech recognition ─────────────────────────────────────────────────────

  /**
   * Listen for a single utterance. Returns transcript (lowercase, trimmed).
   * Resolves with '' on timeout or if speech API is unavailable.
   */
  listen(timeoutMs = 9000): Promise<string> {
    type SRCtor = new() => {
      lang: string; interimResults: boolean; maxAlternatives: number;
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

      let done = false;
      const timer = setTimeout(() => finish(''), timeoutMs);

      const finish = (text: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { rec.stop(); } catch { /* ignore */ }
        resolve(text.toLowerCase().trim());
      };

      rec.onresult = (e: Event) => finish(((e as Event & { results: { [i: number]: { [j: number]: { transcript: string } } } }).results[0]?.[0]?.transcript) ?? '');
      rec.onerror  = ()  => finish('');
      rec.onend    = ()  => finish('');
      rec.start();
    });
  }

  // ── Full auth flow ─────────────────────────────────────────────────────────

  /**
   * Run the full two-step voice identity verification.
   * Returns { granted, name } after the user speaks their name and password.
   * Grants access automatically if no credentials have been configured.
   */
  async requestIdentity(maxRetries = 2): Promise<AuthResult> {
    // No credentials configured — cannot verify; caller should prompt setup
    if (!this.isSetup()) {
      return { granted: false, name: '', reason: 'not_configured' };
    }

    // Speech recognition unavailable — cannot verify voice; deny access
    const SR = (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
            ?? (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SR) {
      console.warn('[VoiceAuth] SpeechRecognition unavailable — denying council access');
      return { granted: false, name: '', reason: 'sr_unavailable' };
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const retry = attempt > 0;

      // Step 1: name
      await this.speak(retry
        ? 'Verification failed. Please state your name again.'
        : 'Identity verification required. Please state your name.'
      );
      const name = await this.listen();
      if (!name) return { granted: false, name: '', reason: 'no_input' };

      // Step 2: password
      await this.speak('Please state your password.');
      const password = await this.listen();

      if (this.verify(name, password)) {
        return { granted: true, name };
      }
    }

    return { granted: false, name: '', reason: 'max_retries' };
  }

  // ── Verification ───────────────────────────────────────────────────────────

  /** Compare spoken credentials against localStorage (case-insensitive). */
  verify(name: string, password: string): boolean {
    const storedName = (localStorage.getItem('triforge_auth_name') ?? '').toLowerCase().trim();
    const storedPass = (localStorage.getItem('triforge_auth_pass') ?? '').toLowerCase().trim();
    return name === storedName && password === storedPass;
  }

  /** Returns true if credentials have been configured. */
  isSetup(): boolean {
    return !!localStorage.getItem('triforge_auth_name');
  }

  /** Save credentials (called from a Settings screen or first-run wizard). */
  setup(name: string, password: string): void {
    localStorage.setItem('triforge_auth_name', name.toLowerCase().trim());
    localStorage.setItem('triforge_auth_pass', password.toLowerCase().trim());
  }

  /** Remove credentials (resets to unconfigured / first-run mode). */
  clearCredentials(): void {
    localStorage.removeItem('triforge_auth_name');
    localStorage.removeItem('triforge_auth_pass');
  }
}

/** Singleton — used by CouncilWakeScreen. */
export const voiceAuth = new VoiceAuthService();
