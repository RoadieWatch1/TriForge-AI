// ── CouncilWakeScreen.tsx — Full-screen wake + identity verification overlay ──
//
// Shown when the "council" wake word is detected.
// Drives the GlobalVoiceController state machine through each auth step:
//   wakeDetected → verifyingName → verifyingPassword → authGranted | authDenied
//
// Props:
//   onGranted(name)  — called after successful auth; parent navigates to chat
//   onDismiss()      — called on auth failure or manual dismiss

import React, { useState, useEffect, useCallback } from 'react';
import { voiceAuth } from '../security/VoiceAuthService';
import { globalVoiceController } from '../voice/GlobalVoiceController';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'wake' | 'verifyingName' | 'verifyingPassword' | 'granted' | 'denied' | 'setup';

interface Props {
  onGranted: (name: string) => void;
  onDismiss: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const MAX_AUTH_RETRIES = 2;

// ── Component ─────────────────────────────────────────────────────────────────

export function CouncilWakeScreen({ onGranted, onDismiss }: Props) {
  const [phase,   setPhase]   = useState<Phase>('wake');
  const [message, setMessage] = useState('COUNCIL ACTIVATED');
  const [subtext, setSubtext] = useState('Standby…');

  const runAuth = useCallback(async () => {
    // Brief animation hold before starting auth
    await delay(900);

    // No credentials — show setup prompt and dismiss
    if (!voiceAuth.isSetup()) {
      globalVoiceController.transition('verifyingName');
      setPhase('setup');
      setMessage('SETUP REQUIRED');
      setSubtext('Set voice credentials in Settings to enable voice auth.');
      await voiceAuth.speak('Voice credentials not configured. Please set up in Settings.');
      await delay(2200);
      window.dispatchEvent(new CustomEvent('triforge:council-auth-denied'));
      onDismiss();
      return;
    }

    // SpeechRecognition unavailable
    const w  = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setPhase('denied');
      setMessage('ACCESS DENIED');
      setSubtext('Voice recognition unavailable on this device.');
      window.dispatchEvent(new CustomEvent('triforge:council-auth-denied'));
      await voiceAuth.speak('Access denied. Voice recognition unavailable.');
      await delay(1400);
      onDismiss();
      return;
    }

    // Multi-step verification with retry
    for (let attempt = 0; attempt < MAX_AUTH_RETRIES; attempt++) {
      const retry = attempt > 0;

      // Step 1: name
      globalVoiceController.transition('verifyingName', { force: retry });
      setPhase('verifyingName');
      setMessage('WHO GOES THERE?');
      setSubtext(retry ? 'Verification failed. Say your name.' : 'Say your name…');
      await voiceAuth.speak(retry
        ? 'Verification failed. Please state your name again.'
        : 'Identity verification required. Please state your name.'
      );
      const name = await voiceAuth.listen();
      if (!name) break; // silence → deny

      // Step 2: password
      globalVoiceController.transition('verifyingPassword');
      setPhase('verifyingPassword');
      setMessage('PASSPHRASE');
      setSubtext('Say your password…');
      await voiceAuth.speak('Please state your password.');
      const password = await voiceAuth.listen();

      if (voiceAuth.verify(name, password)) {
        const displayName = name.charAt(0).toUpperCase() + name.slice(1);
        globalVoiceController.transition('authGranted');
        setPhase('granted');
        setMessage('ACCESS GRANTED');
        setSubtext(`Welcome back, ${displayName}. Council is ready.`);
        await voiceAuth.speak(`Welcome back, ${displayName}. Council is ready.`);
        onGranted(displayName);
        return;
      }
    }

    // All attempts exhausted or no input
    globalVoiceController.transition('authDenied', { force: true });
    setPhase('denied');
    setMessage('ACCESS DENIED');
    setSubtext('Identity verification failed.');
    window.dispatchEvent(new CustomEvent('triforge:council-auth-denied'));
    await voiceAuth.speak('Access denied.');
    await delay(1400);
    onDismiss();
  }, [onGranted, onDismiss]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await runAuth();
    })().catch(() => {
      if (!cancelled) onDismiss();
    });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Triangle SVG ────────────────────────────────────────────────────────────

  const isListening = phase === 'verifyingName' || phase === 'verifyingPassword';

  const glowColor =
    phase === 'granted'  ? '#10b981' :
    phase === 'denied'   ? '#ef4444' :
    isListening          ? '#818cf8' :
    '#6366f1';

  const animClass =
    isListening        ? 'cws-tri cws-tri--listening' :
    phase === 'granted' ? 'cws-tri cws-tri--granted'   :
    phase === 'denied'  ? 'cws-tri cws-tri--denied'     :
    'cws-tri';

  return (
    <div style={s.overlay}>

      {/* Triangle */}
      <div style={s.triangleWrap}>
        <svg
          viewBox="0 0 200 174"
          style={{ ...s.triangle, filter: `drop-shadow(0 0 28px ${glowColor}) drop-shadow(0 0 60px ${glowColor}55)` }}
          className={animClass}
        >
          {/* Outer stroke */}
          <polygon
            points="100,8 194,166 6,166"
            fill="none"
            stroke={glowColor}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {/* Inner fill */}
          <polygon
            points="100,22 182,162 18,162"
            fill={`${glowColor}18`}
          />
          {/* Inner triangle */}
          <polygon
            points="100,50 158,150 42,150"
            fill="none"
            stroke={glowColor}
            strokeWidth="1.5"
            strokeLinejoin="round"
            opacity="0.45"
          />
          {/* Center dot */}
          <circle cx="100" cy="110" r="5" fill={glowColor} opacity="0.9" />
          {/* Beam lines (visible while listening/granted) */}
          {(isListening || phase === 'granted') && (
            <>
              <line x1="100" y1="50"  x2="100" y2="20"  stroke={glowColor} strokeWidth="1" opacity="0.4" strokeLinecap="round" className="cws-beam" />
              <line x1="158" y1="150" x2="178" y2="168" stroke={glowColor} strokeWidth="1" opacity="0.4" strokeLinecap="round" className="cws-beam" />
              <line x1="42"  y1="150" x2="22"  y2="168" stroke={glowColor} strokeWidth="1" opacity="0.4" strokeLinecap="round" className="cws-beam" />
            </>
          )}
        </svg>

        {/* Pulse rings */}
        <div style={{ ...s.ring, borderColor: `${glowColor}40`, animationDelay: '0s' }}   className="cws-ring" />
        <div style={{ ...s.ring, borderColor: `${glowColor}28`, animationDelay: '0.6s' }} className="cws-ring" />
      </div>

      {/* Text */}
      <div style={s.textBlock}>
        <div style={{ ...s.title, color: glowColor }}>{message}</div>
        <div style={s.sub}>{subtext}</div>
      </div>

      {/* Dismiss button */}
      <button style={s.dismiss} onClick={onDismiss} title="Dismiss">
        Dismiss
      </button>

      {/* Keyframes */}
      <style>{`
        @keyframes cwsPulse {
          0%   { transform: scale(1);   opacity: 0.7; }
          50%  { transform: scale(1.04);opacity: 1;   }
          100% { transform: scale(1);   opacity: 0.7; }
        }
        @keyframes cwsRing {
          0%   { transform: scale(0.9); opacity: 0.6; }
          100% { transform: scale(1.8); opacity: 0;   }
        }
        @keyframes cwsBeam {
          0%,100% { opacity: 0.1; }
          50%     { opacity: 0.5; }
        }
        @keyframes cwsListenPulse {
          0%,100% { transform: scale(1);    opacity: 0.85; }
          50%     { transform: scale(1.08); opacity: 1;    }
        }
        @keyframes cwsGranted {
          0%   { transform: scale(1);    }
          30%  { transform: scale(1.12); }
          100% { transform: scale(1);    }
        }
        .cws-tri            { animation: cwsPulse 2.6s ease-in-out infinite; }
        .cws-tri--listening { animation: cwsListenPulse 1.4s ease-in-out infinite; }
        .cws-tri--granted   { animation: cwsGranted 0.6s ease-out forwards; }
        .cws-tri--denied    { animation: none; opacity: 0.6; }
        .cws-ring           { animation: cwsRing 2.8s ease-out infinite; }
        .cws-beam           { animation: cwsBeam 1.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position:       'fixed',
    inset:          0,
    background:     'radial-gradient(ellipse at center, #0a0a14 0%, #050508 100%)',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            36,
    zIndex:         9999,
  },
  triangleWrap: {
    position:   'relative',
    display:    'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width:      240,
    height:     240,
  },
  triangle: {
    width:    200,
    height:   174,
    position: 'relative',
    zIndex:   2,
  },
  ring: {
    position:     'absolute',
    inset:        0,
    borderRadius: '50%',
    border:       '1.5px solid transparent',
    pointerEvents: 'none',
    zIndex:       1,
  },
  textBlock: {
    textAlign: 'center',
    display:   'flex',
    flexDirection: 'column',
    gap:       10,
  },
  title: {
    fontSize:      22,
    fontWeight:    700,
    letterSpacing: '0.2em',
    fontFamily:    'monospace',
  },
  sub: {
    fontSize:  13,
    color:     'rgba(255,255,255,0.45)',
    letterSpacing: '0.05em',
    fontFamily: 'monospace',
  },
  dismiss: {
    position:   'absolute',
    bottom:     28,
    right:      28,
    background: 'rgba(255,255,255,0.05)',
    border:     '1px solid rgba(255,255,255,0.12)',
    color:      'rgba(255,255,255,0.3)',
    fontSize:   11,
    padding:    '5px 12px',
    borderRadius: 4,
    cursor:     'pointer',
    fontFamily: 'monospace',
    letterSpacing: '0.05em',
  },
};
