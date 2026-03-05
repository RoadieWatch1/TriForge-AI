// ── CouncilVoiceProfiles.ts — Per-provider voice identity ────────────────────
//
// Each council member should sound distinct when speaking via browser TTS
// (SpeechSynthesis). These profiles are applied in Chat.tsx when a provider's
// response is spoken aloud.
//
// OpenAI  — confident, steady pace
// Claude  — calm, measured, slightly lower pitch
// Grok    — bold, faster, slightly higher pitch
//
// Usage:
//   const profile = councilVoices[provider] ?? councilVoices.default;
//   speakWithProfile(profile, text);

export interface VoiceProfile {
  pitch:  number;  // 0.5–2.0 (1.0 = default)
  rate:   number;  // 0.1–10  (1.0 = default)
  volume: number;  // 0–1
  /** Spoken label used when introducing the council member. */
  label:  string;
  /** Primary tone identifier (informational). */
  tone:   'confident' | 'calm' | 'bold' | 'neutral';
}

export const councilVoices: Record<string, VoiceProfile> = {
  openai: {
    pitch:  1.0,
    rate:   1.0,
    volume: 1.0,
    label:  'OpenAI',
    tone:   'confident',
  },
  claude: {
    pitch:  0.95,
    rate:   0.88,
    volume: 1.0,
    label:  'Claude',
    tone:   'calm',
  },
  grok: {
    pitch:  1.1,
    rate:   1.06,
    volume: 1.0,
    label:  'Grok',
    tone:   'bold',
  },
  default: {
    pitch:  1.0,
    rate:   1.0,
    volume: 1.0,
    label:  'Council',
    tone:   'neutral',
  },
};

/**
 * Speak text using a council member's voice profile via Web Speech TTS.
 * Returns a promise that resolves when the utterance ends.
 */
export function speakWithProfile(
  profile: VoiceProfile,
  text:    string,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      window.speechSynthesis?.cancel();
      const utt    = new SpeechSynthesisUtterance(text);
      utt.pitch    = profile.pitch;
      utt.rate     = profile.rate;
      utt.volume   = profile.volume;
      utt.onend    = () => resolve();
      utt.onerror  = () => resolve();
      window.speechSynthesis.speak(utt);
    } catch {
      resolve();
    }
  });
}
