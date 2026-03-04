import WebSocket from 'ws';

// ── Event types emitted to the renderer ───────────────────────────────────────

export type VoiceAgentEvent =
  | { type: 'connected' }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string }
  | { type: 'audio_chunk'; data: string }   // base64 PCM16 audio
  | { type: 'audio_done' }
  | { type: 'error'; message: string }
  | { type: 'disconnected' };

// ── GrokVoiceAgent ────────────────────────────────────────────────────────────

export class GrokVoiceAgent {
  private ws: WebSocket | null = null;
  private readonly apiKey: string;
  private readonly voice: string;
  private readonly onEvent: (e: VoiceAgentEvent) => void;

  // Reconnect state
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(apiKey: string, voice: string, onEvent: (e: VoiceAgentEvent) => void) {
    this.apiKey  = apiKey;
    this.voice   = voice;
    this.onEvent = onEvent;
  }

  connect(): void {
    this.shouldReconnect = true;
    this._open();
  }

  private _open(): void {
    if (this.ws) return;

    const ws = new WebSocket('wss://api.x.ai/v1/realtime', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0; // successful connection resets backoff
      // Configure the session: model, voice personality, audio format
      // VAD silence raised to 1400ms to prevent cutting off mid-sentence
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          model:          'grok-3',
          voice:          this.voice,
          input_audio_format:  'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: { type: 'server_vad', silence_duration_ms: 1400 },
          input_audio_transcription: { model: 'whisper-1' },
        },
      }));
      this.onEvent({ type: 'connected' });
    });

    ws.on('message', (raw: Buffer | string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg['type']) {
        case 'response.audio.delta': {
          const delta = msg['delta'] as string | undefined;
          if (delta) this.onEvent({ type: 'audio_chunk', data: delta });
          break;
        }
        case 'response.audio.done':
          this.onEvent({ type: 'audio_done' });
          break;
        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = msg['transcript'] as string | undefined;
          if (transcript?.trim()) this.onEvent({ type: 'transcript', role: 'user', text: transcript.trim() });
          break;
        }
        case 'response.audio_transcript.done': {
          const transcript = msg['transcript'] as string | undefined;
          if (transcript?.trim()) this.onEvent({ type: 'transcript', role: 'assistant', text: transcript.trim() });
          break;
        }
        case 'error': {
          const err = msg['error'] as { message?: string } | undefined;
          this.onEvent({ type: 'error', message: err?.message ?? 'Unknown voice agent error' });
          break;
        }
      }
    });

    ws.on('error', (err) => {
      // Emit error but do NOT null out ws here — let the close event handle reconnect
      this.onEvent({ type: 'error', message: err.message });
    });

    ws.on('close', () => {
      this.ws = null;
      this.onEvent({ type: 'disconnected' });

      if (this.shouldReconnect) {
        // Exponential backoff: 1s, 2s, 4s, 8s … capped at 30s
        const delay = Math.min(Math.pow(2, this.reconnectAttempt) * 1000, 30000);
        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.shouldReconnect) this._open();
        }, delay);
      }
    });
  }

  /** Send a PCM16 audio chunk (already in correct format from renderer). */
  sendAudio(pcm16: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type:  'input_audio_buffer.append',
        audio: pcm16.toString('base64'),
      }));
    }
  }

  /** Signal end of user audio turn — Grok responds automatically via VAD,
   *  but this can be called explicitly to force a turn boundary. */
  commitAudio(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      this.ws.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
