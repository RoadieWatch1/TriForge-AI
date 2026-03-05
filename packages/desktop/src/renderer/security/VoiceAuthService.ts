// ── VoiceAuthService.ts — Voice-driven identity verification ─────────────────
//
// Presents spoken prompts (Web Speech TTS) and listens for the user's name
// and password (Web Speech STT) before granting council access.
//
// Credentials are stored in localStorage under:
//   triforge_auth_name
//   triforge_auth_pass
//
// First-run behaviour: if no credentials are stored, access is granted
// automatically so the user can set up credentials in Settings.
//
// Usage:
//   const result = await voiceAuth.requestIdentity();
//   if (result.granted) startCouncil(result.name);
//
// No IPC dependencies — runs entirely in the renderer via browser APIs.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthResult {
  granted: boolean;
  name:    string;
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
    return new Promise((resolve) => {
      const SR = (window as Window & { SpeechRecognition?: new() => SpeechRecognition; webkitSpeechRecognition?: new() => SpeechRecognition }).SpeechRecognition
              ?? (window as Window & { webkitSpeechRecognition?: new() => SpeechRecognition }).webkitSpeechRecognition;

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

      rec.onresult = (e) => finish(e.results[0]?.[0]?.transcript ?? '');
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
  async requestIdentity(): Promise<AuthResult> {
    // First-run / no credentials configured — auto-grant
    if (!this.isSetup()) {
      return { granted: true, name: 'Commander' };
    }

    // Step 1: name
    await this.speak('Identity verification required. Please state your name.');
    const name = await this.listen();
    if (!name) return { granted: false, name: '' };

    // Step 2: password
    await this.speak('Please state your password.');
    const password = await this.listen();

    const granted = this.verify(name, password);
    return { granted, name };
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

  /** Remove credentials (resets to auto-grant / first-run mode). */
  clearCredentials(): void {
    localStorage.removeItem('triforge_auth_name');
    localStorage.removeItem('triforge_auth_pass');
  }
}

/** Singleton — used by CouncilWakeScreen. */
export const voiceAuth = new VoiceAuthService();
