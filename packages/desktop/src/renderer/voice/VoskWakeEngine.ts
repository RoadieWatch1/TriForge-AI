// ── VoskWakeEngine.ts — Mic capture + Vosk phrase recognition ─────────────────
//
// Responsibilities:
//   1. Download/cache Vosk model via main-process IPC (userData/vosk-models/)
//   2. Capture mic at 16 kHz mono via ScriptProcessorNode
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

// ── VoskWakeEngine ────────────────────────────────────────────────────────────

export class VoskWakeEngine {
  private model:      Awaited<ReturnType<typeof createModel>> | null = null;
  private recognizer: ReturnType<Awaited<ReturnType<typeof createModel>>['KaldiRecognizer']['prototype']['constructor']> | null = null;
  private audioCtx:   AudioContext | null = null;
  private processor:  ScriptProcessorNode | null = null;
  private stream:     MediaStream | null = null;
  private paused     = false;
  private _listening = false;
  private lastTs     = 0;          // timestamp of last emitted phrase
  private readonly DEDUP_MS = 1200; // suppress duplicate emits within 1.2 s

  constructor(private readonly onPhrase: (text: string) => void) {}

  isListening(): boolean { return this._listening; }

  /** Download model, open mic, start recognition. Throws on any failure. */
  async start(): Promise<void> {
    try {
      console.log('[WakeEngine] Starting — fetching Vosk model...');
      const buf: ArrayBuffer = await window.triforge.voice.getWakeModelData();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));

      console.log('[WakeEngine] Model received — initializing recognizer...');
      this.model = await createModel(blobUrl, -1);
      URL.revokeObjectURL(blobUrl);

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
      console.log('[WakeEngine] Requesting mic access...');
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
