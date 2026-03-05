// ── VoiceWakeEngine.ts — Main-process wake word engine (stub) ─────────────────
//
// Native `vosk` cannot be installed on Node.js v25+ due to ffi-napi native
// module compilation failure. This stub is guarded by `enableOfflineWake: false`.
//
// When `enableOfflineWake` is enabled in a future environment with compatible
// Node.js / native module support, this class would:
//   1. Load the vosk model from userData/vosk-models/
//   2. Accept 16kHz Int16 PCM audio from renderer via voice:wake:audio IPC
//   3. Run grammar-limited recognition
//   4. Emit only sanitized command names back to renderer
//
// For now: vosk-browser WASM in the renderer serves as the fallback and
// handles all wake-word detection.

import { AUTONOMY_FLAGS } from '../../core/config/autonomyFlags';

export class VoiceWakeEngine {
  /** Initialize — logs status and returns immediately (no-op on current platforms). */
  async init(): Promise<void> {
    if (!AUTONOMY_FLAGS.enableOfflineWake) {
      console.info('[VoiceWakeEngine] offline wake disabled (enableOfflineWake=false) — vosk-browser fallback active');
      return;
    }
    // Would attempt native vosk here — not available on Node.js v25+
    console.warn('[VoiceWakeEngine] native vosk unavailable on this platform — wake word disabled');
  }

  /** Process raw 16kHz Int16 PCM buffer. Returns command name or null. */
  processAudio(_pcm: Buffer): string | null {
    // Stub — always returns null (vosk-browser handles detection in renderer)
    return null;
  }
}
