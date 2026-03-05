// ── VoskWakeEngine.ts — Mic capture + vosk-browser phrase recognition ─────────
//
// Responsibilities:
//   1. Download/cache vosk model via main-process IPC (userData/vosk-models/)
//   2. Capture mic at 16 kHz mono
//   3. Feed PCM to grammar-limited KaldiRecognizer
//   4. Call onPhrase(text) when a phrase is recognized
//
// This class has NO knowledge of commands, IPC trust boundaries, or dispatch logic.
// VoiceCommandBridge wraps this and decides what to do with the detected phrase.

import { createModel } from 'vosk-browser';

export const WAKE_PHRASES = [
  'council', 'hey council', 'okay council', 'council listen', 'council help',
  'council assemble', 'council deliberate', 'claude advise', 'grok challenge',
  'apply solution', 'apply decision', 'triforge build', 'triforge fix',
  'triforge audit', 'triforge refactor',
] as const;

export const WAKE_GRAMMAR = JSON.stringify(['[unk]', ...WAKE_PHRASES]);

export class VoskWakeEngine {
  private model:      Awaited<ReturnType<typeof createModel>> | null = null;
  private recognizer: ReturnType<Awaited<ReturnType<typeof createModel>>['KaldiRecognizer']['prototype']['constructor']> | null = null;
  private audioCtx:   AudioContext | null = null;
  private processor:  ScriptProcessorNode | null = null;
  private stream:     MediaStream | null = null;
  private paused    = false;
  private lastText  = '';
  private lastTs    = 0;

  constructor(private readonly onPhrase: (text: string) => void) {}

  /** Download model (first run ~40 MB, cached), start mic capture and recognition. */
  async start(): Promise<void> {
    try {
      const buf: ArrayBuffer = await window.triforge.voice.getWakeModelData();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
      this.model = await createModel(blobUrl, -1);
      URL.revokeObjectURL(blobUrl);

      this.recognizer = new this.model.KaldiRecognizer(16000, WAKE_GRAMMAR);
      this.recognizer.setWords(false);

      this.recognizer.on('result', (message) => {
        if (this.paused) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text: string = ((message as any).result?.text ?? '').trim();
        if (!text) return;
        // Throttle: ignore duplicate within 1200 ms (avoids partial-result spam)
        const now = Date.now();
        if (text === this.lastText && now - this.lastTs < 1200) return;
        this.lastText = text;
        this.lastTs   = now;
        this.onPhrase(text);
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

      console.info('[VoskWakeEngine] active');
    } catch (err) {
      console.warn('[VoskWakeEngine] start failed:', err);
    }
  }

  pause():  void { this.paused = true; }
  resume(): void { this.paused = false; }

  stop(): void {
    this.paused = true;
    this.processor?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.recognizer?.remove(); } catch { /* ignore */ }
    try { this.model?.terminate(); }   catch { /* ignore */ }
    this.recognizer = null; this.model    = null;
    this.audioCtx   = null; this.processor = null; this.stream = null;
  }
}
