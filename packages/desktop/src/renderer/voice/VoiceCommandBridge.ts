// ── VoiceCommandBridge.ts — Thin adapter: phrase → IPC trust boundary ─────────
//
// Responsibilities:
//   1. Start VoskWakeEngine (mic + vosk — all audio logic lives there)
//   2. On phrase detected:
//      • Online mode (default): report raw phrase to main via IPC.
//        Main validates against allowlist → sends back sanitized command name.
//        activateCommand() is called only on the validated name.
//      • Offline mode (enableOfflineWake=true): dispatch directly, no IPC.
//   3. Expose pause/resume/stop to caller (Chat.tsx).
//
// This class contains NO audio or vosk code.

import { VoskWakeEngine } from './VoskWakeEngine';
import { AUTONOMY_FLAGS } from '../../core/config/autonomyFlags';
import { activateCommand, dispatchCommand } from '../../core/commands/CommandDispatcher';

export class VoiceCommandBridge {
  private engine:        VoskWakeEngine | null = null;
  private unsubscribeCmd: (() => void) | null  = null;

  /** Start the wake engine and wire up command routing. Returns Promise that resolves when mic is live. */
  start(): Promise<void> {
    this.engine = new VoskWakeEngine((text) => {
      if (AUTONOMY_FLAGS.enableOfflineWake) {
        // Offline: dispatch directly — no main-process round-trip
        dispatchCommand(text, 'voice');
      } else {
        // Online: report to main, main validates and sends back sanitized cmd
        window.triforge.voice.reportWakePhrase(text);
      }
    });

    const ready = this.engine.start();

    // Online mode only: listen for sanitized command names from main (trust boundary)
    if (!AUTONOMY_FLAGS.enableOfflineWake) {
      this.unsubscribeCmd = window.triforge.voice.onVoiceCommand((cmd: string) => {
        activateCommand(cmd, 'voice');
      });
    }

    return ready;
  }

  pause():  void { this.engine?.pause(); }
  resume(): void { this.engine?.resume(); }

  stop(): void {
    this.unsubscribeCmd?.();
    this.unsubscribeCmd = null;
    this.engine?.stop();
    this.engine = null;
  }
}
