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

  constructor(apiKey: string, voice: string, onEvent: (e: VoiceAgentEvent) => void) {
    this.apiKey  = apiKey;
    this.voice   = voice;
    this.onEvent = onEvent;
  }

  connect(): void {
    if (this.ws) return;

    const ws = new WebSocket('wss://api.x.ai/v1/realtime', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      // Configure the session: model, voice personality, audio format
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          model:          'grok-3',
          voice:          this.voice,
          input_audio_format:  'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: { type: 'server_vad', silence_duration_ms: 600 },
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
      this.onEvent({ type: 'error', message: err.message });
    });

    ws.on('close', () => {
      this.ws = null;
      this.onEvent({ type: 'disconnected' });
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
    this.ws?.close();
    this.ws = null;
  }
}
