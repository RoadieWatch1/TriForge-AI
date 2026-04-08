import React, { useState, useRef, useEffect, useCallback } from 'react';
import { unifiedVoiceSession } from '../voice/UnifiedVoiceSession';
import type { VoiceState } from '../voice/GlobalVoiceController';

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

interface Props {
  /** Whether a Grok API key is configured (enables real-time voice agent) */
  hasGrok: boolean;
  /** Whether an OpenAI key is configured (enables Whisper fallback) */
  hasOpenAI: boolean;
  /** True while the chat is waiting for an AI text response */
  sending: boolean;
  /** Called with user's spoken text (fallback path: Web Speech → text → sendMessage) */
  onTranscript: (text: string) => void;
  /** Called with Grok's spoken response text (to show in chat log) */
  onAssistantTranscript: (text: string) => void;
  /** Called to cleanly stop everything when parent deactivates voice chat */
  onStop?: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_RATE   = 16000;
const CHUNK_INTERVAL_MS = 100; // send audio every 100ms

// ── AudioWorklet processor source (inline — avoids Electron file path issues) ──

const MIC_WORKLET_CODE = `
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0][0];
    if (input) {
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, input[i] * 32767));
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
`;

// ── Helper: Base64 PCM16 → AudioBuffer ────────────────────────────────────────

function pcm16Base64ToAudioBuffer(b64: string, ctx: AudioContext): AudioBuffer {
  const raw  = atob(b64);
  const len  = raw.length / 2;
  const buf  = ctx.createBuffer(1, len, 24000); // Grok outputs at 24kHz
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const lo = raw.charCodeAt(i * 2);
    const hi = raw.charCodeAt(i * 2 + 1);
    let val = lo | (hi << 8);
    if (val >= 0x8000) val -= 0x10000;
    data[i] = val / 32768;
  }
  return buf;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VoiceConversation({ hasGrok, hasOpenAI, sending, onTranscript, onAssistantTranscript }: Props) {
  const [active,  setActive]  = useState(false);
  const [status,  setStatus]  = useState<Status>('idle');
  const [errMsg,  setErrMsg]  = useState('');

  // Keep a ref in sync with `active` so callbacks with stale closures can read it
  const activeRef = useRef(false);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Audio refs
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const processorRef    = useRef<AudioWorkletNode | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const unsubAgentRef   = useRef<(() => void) | null>(null);
  const pendingAudioRef = useRef<Float32Array[]>([]);
  const playQueueRef    = useRef<AudioBuffer[]>([]);
  const isPlayingRef    = useRef(false);

  // Web Speech fallback refs
  const recognitionRef  = useRef<any | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const synthRef        = useRef<SpeechSynthesisUtterance | null>(null);

  // ── Audio playback queue (Grok path) ────────────────────────────────────────

  const playNextChunk = useCallback(() => {
    if (!audioCtxRef.current || playQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const buf  = playQueueRef.current.shift()!;
    const src  = audioCtxRef.current.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtxRef.current.destination);
    src.onended = playNextChunk;
    src.start();
  }, []);

  const enqueueAudio = useCallback((b64: string) => {
    if (!audioCtxRef.current) return;
    const audioBuf = pcm16Base64ToAudioBuffer(b64, audioCtxRef.current);
    playQueueRef.current.push(audioBuf);
    if (!isPlayingRef.current) playNextChunk();
  }, [playNextChunk]);

  // ── Stop everything ─────────────────────────────────────────────────────────

  const stopAll = useCallback(() => {
    // Stop mic
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // Stop Grok agent — commit signals end-of-audio before closing
    unsubAgentRef.current?.();
    unsubAgentRef.current = null;
    window.triforge.voice.agent.commit().catch(() => {});
    window.triforge.voice.agent.disconnect();

    // Stop Web Speech / UnifiedVoiceSession
    unifiedVoiceSession.end();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
    synthRef.current = null;

    // Drain audio
    playQueueRef.current = [];
    isPlayingRef.current = false;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    setStatus('idle');
    setActive(false);
  }, []);

  // ── Grok Voice Agent path ────────────────────────────────────────────────────

  const startGrokVoice = useCallback(async () => {
    setStatus('connecting');
    try {
      const res = await window.triforge.voice.agent.connect({ voice: 'Ara' });
      if (res.error) { setErrMsg(res.error); setStatus('error'); return; }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Connection failed');
      setStatus('error');
      return;
    }

    // Subscribe to voice agent events
    unsubAgentRef.current = window.triforge.voice.agent.onEvent((e) => {
      if (e.type === 'connected') {
        setStatus('listening');
        startMicCapture();
      } else if (e.type === 'audio_chunk' && e.data) {
        setStatus('speaking');
        enqueueAudio(e.data);
      } else if (e.type === 'audio_done') {
        // After Grok finishes speaking, resume listening
        setTimeout(() => { if (active) setStatus('listening'); }, 200);
      } else if (e.type === 'transcript') {
        if (e.role === 'assistant' && e.text) {
          onAssistantTranscript(e.text);
        }
      } else if (e.type === 'error') {
        setErrMsg(e.message ?? 'Voice agent error');
        setStatus('error');
      } else if (e.type === 'disconnected') {
        setStatus('idle');
      }
    });
  }, [active, enqueueAudio, onAssistantTranscript]);

  // ── Mic capture (Grok path) ──────────────────────────────────────────────────

  const startMicCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1 }, video: false });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;

      // Load the AudioWorklet from an inline Blob URL — avoids Electron file path issues
      // and moves audio processing off the main thread (unlike the deprecated ScriptProcessorNode)
      const blob = new Blob([MIC_WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source      = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, 'mic-processor');
      processorRef.current = workletNode;

      workletNode.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        const b64 = Buffer.from(ev.data).toString('base64');
        window.triforge.voice.agent.send(b64);
      };

      source.connect(workletNode);
      workletNode.connect(ctx.destination);
    } catch {
      setErrMsg('Microphone access denied.');
      setStatus('error');
    }
  }, []);

  // ── Web Speech fallback path ─────────────────────────────────────────────────

  const startWebSpeechLoop = useCallback(() => {
    type SRCtor = new() => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const w  = window as Window & { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setErrMsg('Web Speech not available. Add an API key to enable voice.');
      setStatus('error');
      return;
    }

    const listen = () => {
      // Use ref to avoid stale closure — check current active state
      if (!activeRef.current) return;
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      recognitionRef.current = rec;
      setStatus('listening');

      rec.onresult = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const text = e.results[0]?.[0]?.transcript ?? '';
        if (text.trim()) {
          setStatus('processing');
          onTranscript(text.trim());
        }
      };
      rec.onerror = () => setStatus('idle');
      rec.onend   = () => {
        // Restart quickly if still active (reduced from 800ms to 200ms)
        if (activeRef.current) setTimeout(listen, 200);
      };
      rec.start();
    };

    listen();
  }, [onTranscript]);

  // ── Toggle active ────────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    if (active) {
      stopAll();
    } else {
      setActive(true);
      setErrMsg('');
      if (hasGrok) {
        startGrokVoice();
      } else {
        unifiedVoiceSession.start({
          userName: 'Commander',
          onTranscript: (t) => { setStatus('processing'); onTranscript(t); },
          onEnd: () => { setActive(false); setStatus('idle'); },
        });
      }
    }
  }, [active, hasGrok, startGrokVoice, startWebSpeechLoop, stopAll]);

  // Sync status from GlobalVoiceController when using UnifiedVoiceSession (non-Grok path)
  useEffect(() => {
    if (hasGrok) return;
    const handler = (e: Event) => {
      const state = (e as CustomEvent<VoiceState>).detail;
      if (state === 'sessionListening') setStatus('listening');
      else if (state === 'sessionThinking') setStatus('processing');
      else if (state === 'sessionSpeaking') setStatus('speaking');
      else if (state === 'sessionEnded' || state === 'idle') setStatus('idle');
    };
    window.addEventListener('triforge:voice-state', handler);
    return () => window.removeEventListener('triforge:voice-state', handler);
  }, [hasGrok]);

  // Cleanup on unmount
  useEffect(() => () => { stopAll(); }, [stopAll]);

  // ── Status label ─────────────────────────────────────────────────────────────

  const statusLabel =
    status === 'idle'        ? 'Start voice chat' :
    status === 'connecting'  ? 'Connecting…' :
    status === 'listening'   ? 'Listening…' :
    status === 'processing'  ? 'Thinking…' :
    status === 'speaking'    ? 'TriForge is speaking…' :
    `Error: ${errMsg}`;

  const isListening = status === 'listening';
  const isSpeaking  = status === 'speaking';
  const isError     = status === 'error';

  return (
    <div style={s.wrapper}>
      <div style={s.row}>
        {/* Waveform dots when speaking */}
        {isSpeaking && (
          <div style={s.waveform}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ ...s.bar, animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}

        {/* Main mic button */}
        <button
          style={{
            ...s.btn,
            ...(isListening  ? s.btnListening  : {}),
            ...(isSpeaking   ? s.btnSpeaking   : {}),
            ...(isError      ? s.btnError      : {}),
          }}
          onClick={toggle}
          title={active ? 'Stop voice chat' : 'Start voice chat'}
          disabled={sending && !active}
        >
          {isListening && <div style={s.pulse} />}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Status label */}
        <span style={{ ...s.label, ...(isError ? s.labelError : {}) }}>
          {statusLabel}
        </span>

        {/* Stop button when active */}
        {active && (
          <button style={s.stopBtn} onClick={stopAll} title="End voice chat">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
          </button>
        )}
      </div>

      <style>{`
        @keyframes vcBar {
          0%,100% { transform: scaleY(0.4); }
          50%      { transform: scaleY(1); }
        }
        @keyframes vcPulse {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.9); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '10px 0 4px', gap: 6,
  },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  btn: {
    position: 'relative',
    width: 56, height: 56, borderRadius: '50%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.2s', flexShrink: 0,
  },
  btnListening: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    border: '1px solid transparent', color: '#fff',
    boxShadow: '0 0 0 6px var(--accent-glow)',
  },
  btnSpeaking: {
    background: 'linear-gradient(135deg, #10b981, #059669)',
    border: '1px solid transparent', color: '#fff',
    boxShadow: '0 0 0 6px rgba(16,185,129,0.2)',
  },
  btnError: {
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444',
  },
  pulse: {
    position: 'absolute', inset: -8, borderRadius: '50%',
    border: '2px solid var(--accent)',
    animation: 'vcPulse 1.4s ease-out infinite',
    pointerEvents: 'none',
  },
  label: { fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' },
  labelError: { color: '#ef4444' },
  stopBtn: {
    width: 28, height: 28, borderRadius: '50%',
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  waveform: {
    display: 'flex', alignItems: 'center', gap: 3, height: 24,
  },
  bar: {
    width: 3, height: 20, borderRadius: 2,
    background: 'linear-gradient(to top, var(--accent), var(--purple))',
    animation: 'vcBar 0.7s ease-in-out infinite',
    transformOrigin: 'center bottom',
  },
};

