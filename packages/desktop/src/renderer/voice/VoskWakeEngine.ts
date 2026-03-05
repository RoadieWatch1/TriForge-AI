// ── VoskWakeEngine.ts — Renderer-side offline wake engine (vosk-browser WASM) ──
//
// Alternative to VoiceCommandBridge for offline/air-gapped deployments.
// Key difference: bypasses the main-process trust boundary — calls dispatchCommand()
// directly in the renderer without an IPC round-trip.
//
// Guard: only active when AUTONOMY_FLAGS.enableOfflineWake = true (default: false).
// Boot point: renderer/index.tsx (after React createRoot).
//
// Model: downloaded via window.triforge.voice.getWakeModelData() (same as VoiceCommandBridge).
// Grammar: same WAKE_PHRASES allowlist — prevents free-form speech activation.

import { createModel } from 'vosk-browser';
import { AUTONOMY_FLAGS } from '../../core/config/autonomyFlags';
import { dispatchCommand } from '../../core/commands/CommandDispatcher';

const WAKE_PHRASES = [
  'council', 'hey council', 'okay council', 'council listen', 'council help',
  'council assemble', 'council deliberate', 'claude advise', 'grok challenge',
  'apply solution', 'apply decision', 'triforge build', 'triforge fix',
  'triforge audit', 'triforge refactor',
] as const;

const GRAMMAR = JSON.stringify(['[unk]', ...WAKE_PHRASES]);

export class VoskWakeEngine {
  private model:      Awaited<ReturnType<typeof createModel>> | null = null;
  private recognizer: ReturnType<Awaited<ReturnType<typeof createModel>>['KaldiRecognizer']['prototype']['constructor']> | null = null;
  private audioCtx:   AudioContext | null = null;
  private processor:  ScriptProcessorNode | null = null;
  private stream:     MediaStream | null = null;
  private paused    = false;
  private lastText  = '';
  private lastTs    = 0;

  /** Start offline wake detection. Downloads model on first run (~40 MB, cached). */
  async start(): Promise<void> {
    if (!AUTONOMY_FLAGS.enableOfflineWake) {
      console.info('[VoskWakeEngine] offline wake disabled (enableOfflineWake=false) — skipping');
      return;
    }

    try {
      const buf: ArrayBuffer = await window.triforge.voice.getWakeModelData();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
      this.model = await createModel(blobUrl, -1);
      URL.revokeObjectURL(blobUrl);

      this.recognizer = new this.model.KaldiRecognizer(16000, GRAMMAR);
      this.recognizer.setWords(false);

      this.recognizer.on('result', (message) => {
        if (this.paused) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text: string = ((message as any).result?.text ?? '').trim();
        if (!text) return;

        // Throttle: ignore duplicate text within 1200 ms (avoids partial-result spam)
        const now = Date.now();
        if (text === this.lastText && now - this.lastTs < 1200) return;
        this.lastText = text;
        this.lastTs   = now;

        // Directly dispatch — no main-process round-trip (offline mode)
        dispatchCommand(text, 'voice');
      });

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } as MediaTrackConstraints,
      });
      this.audioCtx = new AudioContext({ sampleRate: 16000 });
      const source  = this.audioCtx.createMediaStreamSource(this.stream);
      this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (this.paused || !this.recognizer) return;
        this.recognizer.acceptWaveformFloat(e.inputBuffer.getChannelData(0), 16000);
      };

      source.connect(this.processor);
      this.processor.connect(this.audioCtx.destination);

      console.info('[VoskWakeEngine] vosk-browser offline wake active', { mode: 'vosk-wasm', ok: true });
    } catch (err) {
      console.warn('[VoskWakeEngine] start failed — offline wake inactive', { mode: 'vosk-wasm', ok: false, err: String(err) });
      // WakeWordListener (Web Speech API) and VoiceCommandBridge remain active as fallbacks
    }
  }

  pause(): void  { this.paused = true; }
  resume(): void { this.paused = false; }

  stop(): void {
    this.paused = true;
    this.processor?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.recognizer?.remove(); }  catch { /* ignore */ }
    try { this.model?.terminate(); }    catch { /* ignore */ }
    this.recognizer = null; this.model = null;
    this.audioCtx = null; this.processor = null; this.stream = null;
  }
}
