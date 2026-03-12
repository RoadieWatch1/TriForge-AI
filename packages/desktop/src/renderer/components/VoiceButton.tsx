import React, { useState, useRef, useCallback } from 'react';

interface Props {
  onTranscript: (text: string) => void;
  onError?: (err: string) => void;
  disabled?: boolean;
  hasOpenAI?: boolean;
}

type State = 'idle' | 'recording' | 'processing';

// Extend window for webkit prefix
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export function VoiceButton({ onTranscript, onError, disabled, hasOpenAI }: Props) {
  const [state, setState] = useState<State>('idle');
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // ── Web Speech Recognition (free, no OpenAI key) ──────────────────────────
  const startWebSpeech = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      onError?.('Voice input requires an OpenAI API key or a Chromium-based browser with speech recognition.');
      return;
    }
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? '';
      if (text) onTranscript(text);
      setState('idle');
    };
    recognition.onerror = (e) => {
      onError?.(e.error === 'not-allowed' ? 'Microphone access denied. Enable it in system settings.' : e.error);
      setState('idle');
    };
    recognition.onend = () => setState('idle');

    recognition.start();
    setState('recording');
  }, [onTranscript, onError]);

  const stopWebSpeech = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  // ── OpenAI Whisper (high accuracy, requires key) ───────────────────────────
  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorder.current = mr;

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setState('processing');
        try {
          const blob = new Blob(chunks.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);
          const result = await window.triforge.voice.transcribe(buffer as unknown as Buffer);
          if (result.error) {
            onError?.(result.error);
          } else if (result.text) {
            onTranscript(result.text);
          }
        } catch (e) {
          onError?.(e instanceof Error ? e.message : String(e));
        } finally {
          setState('idle');
        }
      };

      mr.start();
      setState('recording');
    } catch {
      onError?.('Microphone access denied. Enable it in system settings.');
      setState('idle');
    }
  }, [onTranscript, onError]);

  const stopWhisper = useCallback(() => {
    mediaRecorder.current?.stop();
  }, []);

  // ── Unified click-toggle handler (both Whisper and Web Speech) ───────────────

  const handleClick = () => {
    if (disabled) return;
    if (hasOpenAI) {
      if (state === 'idle') startWhisper();
      else if (state === 'recording') stopWhisper();
    } else {
      if (state === 'idle') startWebSpeech();
      else if (state === 'recording') stopWebSpeech();
    }
  };

  const label =
    state === 'idle'      ? 'Click to speak' :
    state === 'recording' ? 'Click to stop' :
    'Transcribing…';

  const isActive = state === 'recording';
  const isLoading = state === 'processing';

  return (
    <div style={styles.wrapper}>
      <button
        style={{
          ...styles.btn,
          ...(isActive ? styles.btnActive : {}),
          ...(isLoading ? styles.btnLoading : {}),
          ...(disabled ? styles.btnDisabled : {}),
        }}
        onClick={handleClick}
        title={label}
        disabled={disabled || isLoading}
      >
        {isLoading ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )}
        {isActive && <div style={styles.pulse} />}
      </button>
      <span style={styles.label}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  btn: {
    position: 'relative',
    width: 44, height: 44,
    borderRadius: '50%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0,
  },
  btnActive: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    border: '1px solid transparent',
    color: '#fff',
    boxShadow: '0 0 0 4px var(--accent-glow)',
  },
  btnLoading: {
    opacity: 0.6,
    cursor: 'wait',
    animation: 'spin 1s linear infinite',
  },
  btnDisabled: { opacity: 0.3, cursor: 'not-allowed' },
  pulse: {
    position: 'absolute',
    inset: -6,
    borderRadius: '50%',
    border: '2px solid var(--accent)',
    animation: 'pulse 1.4s ease-out infinite',
    pointerEvents: 'none',
  },
  label: { fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' },
};
