// ── VoiceCommandBridge.ts ─────────────────────────────────────────────────────
//
// Offline wake-phrase detection using vosk-browser (WASM — no native deps).
// Architecture:
//   1. Captures mic via getUserMedia (16 kHz mono)
//   2. Feeds Float32 PCM to vosk-browser KaldiRecognizer (grammar-limited)
//   3. On phrase match → reports raw phrase to MAIN PROCESS via IPC
//   4. Main process validates / sanitizes → sends back 'voice-command' IPC event
//   5. Calls activateCommand(cmd, 'voice') on core CommandDispatcher
//
// Main process is the trust boundary: renderer never acts on its own detections.
//
// Usage:
//   const bridge = new VoiceCommandBridge();
//   await bridge.start();   // downloads model on first run (~40 MB, cached)
//   bridge.pause();         // while AI is speaking
//   bridge.resume();
//   bridge.stop();

import { createModel } from 'vosk-browser';
import { activateCommand } from '../../core/commands/CommandDispatcher';

const WAKE_PHRASES = [
  'council', 'hey council', 'okay council', 'council listen', 'council help',
  'council assemble', 'council deliberate', 'claude advise', 'grok challenge',
  'apply solution', 'apply decision', 'triforge build', 'triforge fix',
  'triforge audit', 'triforge refactor',
] as const;

const GRAMMAR = JSON.stringify(['[unk]', ...WAKE_PHRASES]);

export class VoiceCommandBridge {
  private model: Awaited<ReturnType<typeof createModel>> | null = null;
  private recognizer: ReturnType<Awaited<ReturnType<typeof createModel>>['KaldiRecognizer']['prototype']['constructor']> | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private unsubscribeCmd: (() => void) | null = null;
  private paused = false;

  /** Downloads model (first run), starts mic capture and recognition. */
  async start(): Promise<void> {
    try {
      // 1. Download/cache model via main process (userData/vosk-models/)
      const buf: ArrayBuffer = await window.triforge.voice.getWakeModelData();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
      this.model = await createModel(blobUrl, -1);
      URL.revokeObjectURL(blobUrl);

      // 2. Grammar-limited recognizer (faster + no false activations on random speech)
      this.recognizer = new this.model.KaldiRecognizer(16000, GRAMMAR);
      this.recognizer.setWords(false);

      // 3. Listen for the 'result' event
      this.recognizer.on('result', (message) => {
        if (this.paused) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text: string = (message as any).result?.text ?? '';
        if (text) {
          // Report detected phrase to main — main validates & sends back sanitized cmd name
          window.triforge.voice.reportWakePhrase(text);
        }
      });

      // 4. Capture mic at 16 kHz
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } as MediaTrackConstraints,
      });
      this.audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (this.paused || !this.recognizer) return;
        const f32 = e.inputBuffer.getChannelData(0);
        this.recognizer.acceptWaveformFloat(f32, 16000);
      };

      source.connect(this.processor);
      this.processor.connect(this.audioCtx.destination);

      // 5. Listen for sanitized snake_case command names from main (trust boundary)
      this.unsubscribeCmd = window.triforge.voice.onVoiceCommand((cmd: string) => {
        if (this.paused) return;
        // cmd is already validated by main (e.g. 'council_assemble', 'mission_fix')
        activateCommand(cmd, 'voice');
      });

      console.info('[VoiceCommandBridge] vosk-browser wake active');

    } catch (err) {
      console.warn('[VoiceCommandBridge] start failed:', err);
    }
  }

  /** Pause while AI is speaking or HandsFreeVoice is active. */
  pause(): void  { this.paused = true; }

  /** Resume after AI finishes. */
  resume(): void { this.paused = false; }

  /** Full teardown — call on component unmount. */
  stop(): void {
    this.paused = true;
    this.unsubscribeCmd?.();
    this.processor?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.recognizer?.remove(); }   catch { /* ignore */ }
    try { this.model?.terminate(); }     catch { /* ignore */ }
    this.recognizer = null; this.model = null;
    this.audioCtx = null; this.processor = null; this.stream = null;
  }
}
