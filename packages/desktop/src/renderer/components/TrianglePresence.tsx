// ── TrianglePresence.tsx — Persistent council state indicator ─────────────────
//
// Small always-visible triangle in the sidebar that reflects the current
// council state via animation. Subscribes to `triforge:council-state` events.
//
// States → animations:
//   idle       — slow 6s breathing glow (barely visible)
//   wake       — quick bright flash
//   listening  — soft blue pulse 1.2s
//   thinking   — rotating beam lines 3s
//   speaking   — bright pulse synced to ~0.8s
//   consensus  — golden flash 0.4s burst

import React, { useState, useEffect } from 'react';
import type { CouncilState } from '../state/CouncilPresence';

// ── Color map ─────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<CouncilState, string> = {
  idle:      '#2d2d4e',
  wake:      '#818cf8',
  listening: '#38bdf8',
  thinking:  '#a78bfa',
  speaking:  '#34d399',
  consensus: '#fbbf24',
};

const STATE_GLOW: Record<CouncilState, string> = {
  idle:      'none',
  wake:      '0 0 14px #818cf880, 0 0 32px #818cf840',
  listening: '0 0 10px #38bdf870, 0 0 22px #38bdf840',
  thinking:  '0 0 12px #a78bfa80',
  speaking:  '0 0 14px #34d39990, 0 0 28px #34d39950',
  consensus: '0 0 20px #fbbf2499, 0 0 40px #fbbf2455',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function TrianglePresence() {
  const [state, setState] = useState<CouncilState>('idle');

  useEffect(() => {
    const handler = (e: Event) => {
      setState((e as CustomEvent<CouncilState>).detail);
    };
    window.addEventListener('triforge:council-state', handler);
    return () => window.removeEventListener('triforge:council-state', handler);
  }, []);

  const color = STATE_COLOR[state];
  const glow  = STATE_GLOW[state];
  const label = state.toUpperCase();

  // Beam lines visible only during thinking
  const showBeams = state === 'thinking';
  // Center dot pulses during speaking
  const dotPulse  = state === 'speaking' || state === 'listening';

  const animClass = `tp-tri tp-tri--${state}`;

  return (
    <div style={s.wrap} title={`Council: ${label}`}>
      <svg
        viewBox="0 0 60 52"
        style={{ ...s.svg, filter: glow !== 'none' ? `drop-shadow(${glow.split(',')[0].trim()})` : 'none' }}
        className={animClass}
      >
        {/* Outer triangle */}
        <polygon
          points="30,3 57,50 3,50"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Inner fill */}
        <polygon
          points="30,9 52,48 8,48"
          fill={`${color}18`}
        />
        {/* Thinking beam lines */}
        {showBeams && (
          <>
            <line x1="30" y1="9"  x2="30" y2="2"  stroke={color} strokeWidth="1" opacity="0.5" className="tp-beam" strokeLinecap="round"/>
            <line x1="52" y1="48" x2="57" y2="52" stroke={color} strokeWidth="1" opacity="0.5" className="tp-beam" strokeLinecap="round"/>
            <line x1="8"  y1="48" x2="3"  y2="52" stroke={color} strokeWidth="1" opacity="0.5" className="tp-beam" strokeLinecap="round"/>
          </>
        )}
        {/* Center dot */}
        <circle
          cx="30" cy="35" r="2.5"
          fill={color}
          opacity={state === 'idle' ? 0.3 : 0.9}
          className={dotPulse ? 'tp-dot-pulse' : ''}
        />
      </svg>

      {/* State label */}
      <span style={{ ...s.label, color }}>{label}</span>

      <style>{`
        @keyframes tpBreathe {
          0%,100% { opacity: 0.25; transform: scale(0.97); }
          50%     { opacity: 0.55; transform: scale(1.02); }
        }
        @keyframes tpWake {
          0%   { opacity: 0.4; transform: scale(0.95); }
          20%  { opacity: 1;   transform: scale(1.1);  }
          100% { opacity: 0.8; transform: scale(1);    }
        }
        @keyframes tpListen {
          0%,100% { opacity: 0.7; transform: scale(1);    }
          50%     { opacity: 1;   transform: scale(1.05); }
        }
        @keyframes tpThink {
          0%   { transform: rotate(0deg);   }
          100% { transform: rotate(360deg); }
        }
        @keyframes tpSpeak {
          0%,100% { opacity: 0.8; transform: scale(1);    }
          50%     { opacity: 1;   transform: scale(1.07); }
        }
        @keyframes tpConsensus {
          0%   { opacity: 0.5; transform: scale(0.9); }
          30%  { opacity: 1;   transform: scale(1.2); }
          100% { opacity: 0.9; transform: scale(1);   }
        }
        @keyframes tpBeam {
          0%,100% { opacity: 0.1; }
          50%     { opacity: 0.6; }
        }
        @keyframes tpDotPulse {
          0%,100% { r: 2.5; opacity: 0.8; }
          50%     { r: 3.5; opacity: 1;   }
        }

        .tp-tri--idle      { animation: tpBreathe 6s ease-in-out infinite; }
        .tp-tri--wake      { animation: tpWake 0.5s ease-out forwards; }
        .tp-tri--listening { animation: tpListen 1.2s ease-in-out infinite; }
        .tp-tri--thinking  { animation: tpThink 3s linear infinite; transform-origin: 30px 35px; }
        .tp-tri--speaking  { animation: tpSpeak 0.8s ease-in-out infinite; }
        .tp-tri--consensus { animation: tpConsensus 0.4s ease-out forwards; }
        .tp-beam           { animation: tpBeam 1.6s ease-in-out infinite; }
        .tp-dot-pulse      { animation: tpDotPulse 0.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    gap:            3,
    padding:        '8px 0 4px',
    cursor:         'default',
    userSelect:     'none',
  },
  svg: {
    width:  36,
    height: 31,
  },
  label: {
    fontSize:      7,
    fontWeight:    700,
    letterSpacing: '0.06em',
    fontFamily:    'monospace',
    opacity:       0.7,
  },
};
