// ── WakePhraseDetector.ts — Fuzzy wake-phrase matching ───────────────────────
//
// Adapted from the mobile WakeWordListener implementation (proven, battle-tested).
// Provides Levenshtein-based fuzzy matching with phonetic variant fallback and
// sliding window phrase extraction.
//
// Design choices vs. mobile version:
//   • windowSize ≥ 1 (was ≥ 2) — single word "Council" must trigger
//   • FUZZY_THRESHOLD 0.82 (was 0.75) — tighter match for single-word accuracy
//   • Noise guard: transcripts < 3 chars return null immediately
//   • Phonetic variants handle common mis-recognitions of "council"

// ── Config ────────────────────────────────────────────────────────────────────

const FUZZY_THRESHOLD = 0.82;

// All phrases that should wake the council (lowercase).
// Must stay in sync with WAKE_PHRASES in VoskWakeEngine.ts.
const WAKE_PHRASES = [
  'council',
  'hey council',
  'okay council',
  'council listen',
  'council help',
  'council assemble',
  'council deliberate',
  'claude advise',
  'apply solution',
  'apply decision',
] as const;

// Phonetic variants: genuine mis-recognitions of "council" by SR engines.
// IMPORTANT: do NOT add common English words here (e.g. "cancel", "consult")
// — they cause false positives any time a user says those words in normal speech.
const PHONETIC_VARIANTS: Record<string, string[]> = {
  council: ['consul', 'counsel', 'councils', "council's"],
};

// ── Core functions ────────────────────────────────────────────────────────────

/** Compute Levenshtein edit distance between two strings. */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalized similarity score (0 = no match, 1 = exact). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/** Extract all sliding windows of `windowSize` words from `words`. */
function extractPhrases(words: string[], windowSize: number): string[] {
  const phrases: string[] = [];
  for (let i = 0; i <= words.length - windowSize; i++) {
    phrases.push(words.slice(i, i + windowSize).join(' '));
  }
  return phrases;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface WakeMatch {
  phrase:     string;   // the canonical wake phrase matched
  matched:    string;   // what was actually in the transcript
  score:      number;   // similarity score (0–1)
  isPhonetic: boolean;  // true if matched via phonetic variant
}

/**
 * Attempt to detect a wake phrase in the given transcript.
 *
 * Returns a WakeMatch if a wake phrase (or phonetic variant) was found
 * with sufficient confidence, otherwise returns null.
 *
 * Safe to call on every partial/full result — includes noise guard.
 */
export function detectWakePhrase(transcript: string): WakeMatch | null {
  if (!transcript || transcript.length < 3) return null;

  const words = transcript.toLowerCase().trim().split(/\s+/);

  for (const wakePhrase of WAKE_PHRASES) {
    const wakeWords   = wakePhrase.split(' ');
    const windowSize  = wakeWords.length;
    if (windowSize < 1) continue; // safety gate (single word allowed)

    const windows = extractPhrases(words, windowSize);

    for (const window of windows) {
      // ── Direct fuzzy match ─────────────────────────────────────────────────
      const score = similarity(window, wakePhrase);
      if (score >= FUZZY_THRESHOLD) {
        return { phrase: wakePhrase, matched: window, score, isPhonetic: false };
      }

      // ── Phonetic variant fallback ──────────────────────────────────────────
      // Check each word in the window against known mis-recognitions
      const windowWords = window.split(' ');
      for (const [canonical, variants] of Object.entries(PHONETIC_VARIANTS)) {
        if (!wakePhrase.includes(canonical)) continue;
        for (const variant of variants) {
          for (const ww of windowWords) {
            if (ww === variant || similarity(ww, variant) >= FUZZY_THRESHOLD) {
              return { phrase: wakePhrase, matched: window, score: 0.8, isPhonetic: true };
            }
          }
        }
      }
    }
  }

  return null;
}
