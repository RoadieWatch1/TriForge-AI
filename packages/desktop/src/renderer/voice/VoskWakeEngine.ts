// ── VoskWakeEngine.ts — Mic capture + Vosk phrase recognition ─────────────────
//
// Responsibilities:
//   1. Download/cache Vosk model via main-process IPC (userData/vosk-models/)
//   2. Capture mic at 16 kHz mono via AudioWorkletNode
//   3. Feed PCM frames to grammar-limited KaldiRecognizer
//   4. Run WakePhraseDetector on every partial AND full result
//   5. Call onPhrase(text) when a wake phrase is detected
//
// Detection strategy (two-layer):
//   • Partial results → instant "council" detection before the utterance ends
//   • Full results    → catches anything the partial handler missed
//
// Error handling: start() throws on any failure — callers set error status.
// No silent swallowing. All failures are logged and propagated.

import { createModel }       from 'vosk-browser';
import { detectWakePhrase }  from './WakePhraseDetector';

// Note: only include words present in the small Vosk en-us vocabulary.
// 'grok', 'triforge', 'refactor' are not in the model — excluded to prevent warnings.
export const WAKE_PHRASES = [
  'council', 'hey council', 'okay council', 'council listen', 'council help',
  'council assemble', 'council deliberate', 'claude advise',
  'apply solution', 'apply decision',
] as const;

export const WAKE_GRAMMAR = JSON.stringify(['[unk]', ...WAKE_PHRASES]);

// ── Inline AudioWorklet source — avoids Electron file path issues ─────────────
const WAKE_WORKLET_CODE = `
class WakeProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch);
    return true;
  }
}
registerProcessor('wake-processor', WakeProcessor);
`;

// ── VoskWakeEngine ────────────────────────────────────────────────────────────

export class VoskWakeEngine {
  private model:      Awaited<ReturnType<typeof createModel>> | null = null;
  private recognizer: ReturnType<Awaited<ReturnType<typeof createModel>>['KaldiRecognizer']['prototype']['constructor']> | null = null;
  private audioCtx:   AudioContext | null = null;
  private processor:  AudioWorkletNode | null = null;
  private stream:     MediaStream | null = null;
  private paused     = false;
  private _listening = false;
  private _stopped   = false;      // abort flag — set by stop() before getUserMedia resolves
  private lastTs     = 0;          // timestamp of last emitted phrase
  private readonly DEDUP_MS = 1200; // suppress duplicate emits within 1.2 s

  constructor(private readonly onPhrase: (text: string) => void) {}

  isListening(): boolean { return this._listening; }

  /** Download model, open mic, start recognition. Throws on any failure. */
  async start(): Promise<void> {
    try {
      console.log('[WakeEngine] Starting — ensuring Vosk model is cached...');
      // ensureWakeModel downloads/validates the zip (first run only).
      // createModel then fetches directly via vosk-model:// custom protocol —
      // no 40 MB ArrayBuffer over IPC, no manual blob creation.
      await window.triforge.voice.ensureWakeModel();

      console.log('[WakeEngine] Model ready — initializing recognizer...');
      this.model = await createModel('vosk-model://model.zip', -1);

      this.recognizer = new this.model.KaldiRecognizer(16000, WAKE_GRAMMAR);
      this.recognizer.setWords(false);

      // ── Full result handler ────────────────────────────────────────────────
      // Fires after a pause in speech — catches anything the partial handler missed.
      this.recognizer.on('result', this._handleResult.bind(this));

      // ── Partial result handler — instant "council" detection ───────────────
      // Fires while the user is still speaking. WakePhraseDetector checks for
      // wake phrases before end-of-phrase silence, giving Siri-style response time.
      this.recognizer.on('partialresult', this._handlePartial.bind(this));

      // ── Mic capture ────────────────────────────────────────────────────────
      // Do NOT hard-constrain sampleRate in getUserMedia — on Windows the
      // device may not natively support 16 kHz and the call will hang.
      // We create the AudioContext at 16 kHz which forces the browser to
      // resample the mic track automatically.
      console.log('[WakeEngine] Requesting mic access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true } as MediaTrackConstraints,
      });

      // Abort if stop() was called while getUserMedia was awaiting
      if (this._stopped) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      this.stream = stream;
      console.log('[WakeEngine] Mic granted.');

      // AudioContext at 16 kHz — browser resamples mic track to match
      this.audioCtx = new AudioContext({ sampleRate: 16000 });
      const source  = this.audioCtx.createMediaStreamSource(this.stream);

      // AudioWorklet replaces the deprecated ScriptProcessorNode —
      // processing runs off the main thread, avoiding onaudioprocess blocking.
      const blob       = new Blob([WAKE_WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await this.audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      // Second abort check — addModule is also async
      if (this._stopped) {
        this.audioCtx.close().catch(() => {});
        this.stream.getTracks().forEach(t => t.stop());
        this.audioCtx = null; this.stream = null;
        return;
      }

      const workletNode = new AudioWorkletNode(this.audioCtx, 'wake-processor');
      this.processor = workletNode;

      workletNode.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        if (this.paused || !this.recognizer) return;
        this.recognizer.acceptWaveformFloat(ev.data, 16000);
      };

      source.connect(workletNode);
      workletNode.connect(this.audioCtx.destination);

      this._listening = true;
      console.log('[WakeEngine] Active — listening for "council"');

    } catch (err) {
      this._listening = false;
      console.error('[WakeEngine] Start failed:', err);
      throw err; // propagate — never swallow
    }
  }

  pause():  void { this.paused = true; }
  resume(): void { this.paused = false; }

  stop(): void {
    this._stopped   = true;   // abort any in-flight getUserMedia / addModule
    this._listening = false;
    this.paused     = true;
    this.processor?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.recognizer?.remove(); } catch { /* ignore */ }
    try { this.model?.terminate();   } catch { /* ignore */ }
    this.recognizer = null; this.model     = null;
    this.audioCtx   = null; this.processor = null; this.stream = null;
    console.log('[WakeEngine] Stopped.');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _handleResult(message: Record<string, unknown>): void {
    if (this.paused) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = ((message as any)?.result?.text ?? '').trim() as string;
    if (!text) return;
    console.log(`[WakeEngine] Full result: "${text}"`);
    this._tryEmit(text);
  }

  private _handlePartial(message: Record<string, unknown>): void {
    if (this.paused) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partial = ((message as any)?.result?.partial ?? '').trim() as string;
    if (!partial) return;
    console.log(`[WakeEngine] Partial: "${partial}"`);
    this._tryEmit(partial);
  }

  private _tryEmit(transcript: string): void {
    const match = detectWakePhrase(transcript);
    if (!match) return;

    const now = Date.now();
    if (now - this.lastTs < this.DEDUP_MS) return; // suppress rapid-fire duplicates
    this.lastTs = now;

    console.log(`[WakeEngine] Wake match: "${match.matched}" → ${match.phrase} (score=${match.score.toFixed(2)}${match.isPhonetic ? ', phonetic' : ''})`);
    this.onPhrase(match.phrase);
  }
}
