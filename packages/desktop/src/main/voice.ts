import { Store } from './store';

export interface TranscribeResult {
  text: string;
  duration_ms: number;
}

export interface SpeakOptions {
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speed?: number;
}

/**
 * Transcribe audio buffer using OpenAI Whisper API.
 * Accepts a WebM/Opus buffer from the renderer's MediaRecorder.
 */
export async function transcribeAudio(
  audioBuffer: Buffer | Uint8Array,
  store: Store
): Promise<TranscribeResult> {
  const apiKey = await store.getSecret('triforge.openai.apiKey');
  if (!apiKey) throw new Error('OpenAI API key not configured. Add it in Settings → API Keys.');

  // Electron IPC structured-clone can turn a Buffer into a plain Uint8Array.
  // Normalise here so Buffer.concat() always receives real Buffers.
  const buf: Buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

  const start = Date.now();

  // Build multipart/form-data manually (no SDK dependency)
  const boundary = `----TriForge${Date.now()}`;
  const CRLF = '\r\n';

  const header = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="model"',
    '',
    'whisper-1',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="audio.webm"',
    'Content-Type: audio/webm',
    '',
  ].join(CRLF);

  const footer = `${CRLF}--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(header + CRLF),
    buf,
    Buffer.from(footer),
  ]);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { text: string };
  return { text: data.text.trim(), duration_ms: Date.now() - start };
}

/**
 * Convert text to speech using OpenAI TTS API.
 * Returns an MP3 buffer to be played in the renderer.
 */
export async function textToSpeech(
  text: string,
  store: Store,
  options: SpeakOptions = {}
): Promise<Buffer> {
  const apiKey = await store.getSecret('triforge.openai.apiKey');
  if (!apiKey) throw new Error('OpenAI API key not configured.');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: options.voice ?? 'onyx',  // Deep, confident voice
      speed: options.speed ?? 1.0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS API error ${res.status}: ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
