import React, { useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ForgeUpdateEvent {
  phase: 'querying' | 'provider:responding' | 'provider:complete' | 'synthesis:start' | 'complete' | 'escalating';
  provider?: string;
  completedCount?: number;
  total?: number;
  from?: string;
  to?: string;
  reason?: string;
}

type ProviderStatus = 'waiting' | 'responding' | 'complete';
type ForgePhase = 'querying' | 'synthesizing' | 'complete' | 'escalating';

interface ForgeState {
  phase: ForgePhase;
  providers: Record<string, ProviderStatus>;
  completedCount: number;
  total: number;
  escalating: boolean;
  escalationReason: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai:  '#10a37f',
  claude:  '#a855f7',
  grok:    '#6366f1',
};

const PROVIDER_LABELS: Record<string, string> = {
  openai:  'GPT-4',
  claude:  'Claude',
  grok:    'Grok',
};

// SVG geometry — triangle arrangement
const CORES = {
  claude:  { cx: 150, cy: 46 },
  openai:  { cx: 55,  cy: 188 },
  grok:    { cx: 245, cy: 188 },
};
const CENTER = { x: 150, y: 128 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

function defaultForgeState(): ForgeState {
  return {
    phase: 'querying',
    providers: { openai: 'waiting', claude: 'waiting', grok: 'waiting' },
    completedCount: 0,
    total: 3,
    escalating: false,
    escalationReason: '',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
}

export function ForgeChamber({ visible }: Props) {
  const [state, setState] = useState<ForgeState>(defaultForgeState);
  const [opacity, setOpacity] = useState(0);
  const mountedRef = useRef(true);

  // Fade in over 200ms
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!visible) { setOpacity(0); return; }
    setState(defaultForgeState());
    const t = setTimeout(() => { if (mountedRef.current) setOpacity(1); }, 30);
    return () => clearTimeout(t);
  }, [visible]);

  // Subscribe to real engine events
  useEffect(() => {
    if (!visible) return;
    const unsub = window.triforge.forge.onUpdate((data: ForgeUpdateEvent) => {
      if (!mountedRef.current) return;
      setState(prev => {
        const next: ForgeState = { ...prev, providers: { ...prev.providers } };

        if (data.phase === 'querying') {
          next.phase = 'querying';
          next.total = data.total ?? 3;

        } else if (data.phase === 'provider:responding' && data.provider) {
          const key = data.provider.toLowerCase();
          if (key in next.providers) next.providers[key] = 'responding';

        } else if (data.phase === 'provider:complete' && data.provider) {
          const key = data.provider.toLowerCase();
          if (key in next.providers) next.providers[key] = 'complete';
          next.completedCount = data.completedCount ?? next.completedCount + 1;

        } else if (data.phase === 'escalating') {
          next.escalating = true;
          next.escalationReason = data.reason ?? 'Risk signals detected';
          // Auto-clear escalation flash after 2.5s
          setTimeout(() => {
            if (mountedRef.current) setState(s => ({ ...s, escalating: false }));
          }, 2500);

        } else if (data.phase === 'synthesis:start') {
          next.phase = 'synthesizing';
          // Ensure all cores show complete when synthesis begins
          for (const k of Object.keys(next.providers)) next.providers[k] = 'complete';

        } else if (data.phase === 'complete') {
          next.phase = 'complete';
        }

        return next;
      });
    });
    return unsub;
  }, [visible]);

  if (!visible) return null;

  const consensusPct = Math.min(100, Math.round((state.completedCount / Math.max(state.total, 1)) * 100));
  const divergencePct = 100 - consensusPct;
  const centerIntensity = state.phase === 'synthesizing' ? 1 : consensusPct / 100;

  const statusText =
    state.escalating               ? `Auto-escalating — ${state.escalationReason}` :
    state.phase === 'synthesizing' ? 'Synthesizing intelligence…' :
    state.phase === 'complete'     ? 'Consensus reached' :
    state.completedCount === state.total && state.total > 0
      ? 'All models responded'
      : `${state.completedCount} of ${state.total} models responded`;

  return (
    <div style={{
      opacity,
      transition: 'opacity 200ms ease',
      background: 'linear-gradient(160deg, #111118 0%, #16161e 100%)',
      border: `1px solid ${state.escalating ? 'rgba(239,68,68,0.55)' : 'rgba(249,115,22,0.18)'}`,
      borderRadius: 12,
      padding: '18px 20px 16px',
      marginBottom: 12,
      position: 'relative',
      overflow: 'hidden',
      boxShadow: state.escalating ? '0 0 20px rgba(239,68,68,0.18)' : 'none',
      transition: 'border 300ms ease, box-shadow 300ms ease, opacity 200ms ease',
    }}>
      {/* Ambient radial glow behind center */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 60% 80% at 50% 55%, rgba(249,115,22,${(centerIntensity * 0.07).toFixed(3)}) 0%, transparent 70%)`,
        pointerEvents: 'none',
        transition: 'background 600ms ease',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, position: 'relative' }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#f97316',
          boxShadow: '0 0 6px #f97316',
          animation: state.phase === 'complete' ? 'none' : 'forge-dot-pulse 1.4s ease-in-out infinite',
        }} />
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: '#f97316',
          textTransform: 'uppercase',
        }}>
          The Forge Chamber
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: 'rgba(255,255,255,0.25)',
          letterSpacing: '0.06em',
        }}>
          {state.phase === 'synthesizing' ? 'CONVERGING' : state.phase === 'complete' ? 'COMPLETE' : 'ACTIVE'}
        </span>
      </div>

      {/* SVG visualization */}
      <svg
        viewBox="0 0 300 230"
        style={{ width: '100%', maxWidth: 300, display: 'block', margin: '0 auto' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Per-provider beam gradients */}
          {(Object.entries(CORES) as [string, { cx: number; cy: number }][]).map(([key, pos]) => (
            <linearGradient
              key={`grad-${key}`}
              id={`beam-grad-${key}`}
              x1={pos.cx} y1={pos.cy}
              x2={CENTER.x} y2={CENTER.y}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%"   stopColor={PROVIDER_COLORS[key] ?? '#666'} stopOpacity="0.85" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.5" />
            </linearGradient>
          ))}
          {/* Center glow filter */}
          <filter id="fc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Beams — from each core to center forge point */}
        {(Object.entries(CORES) as [string, { cx: number; cy: number }][]).map(([key, pos]) => {
          const status: ProviderStatus = (state.providers[key] as ProviderStatus) ?? 'waiting';
          const beamOpacity =
            state.phase === 'synthesizing' ? 0.9 :
            status === 'complete'           ? 0.75 :
            status === 'responding'         ? 0.45 : 0.08;
          const animated = status === 'responding';
          return (
            <line
              key={`beam-${key}`}
              x1={pos.cx} y1={pos.cy}
              x2={CENTER.x} y2={CENTER.y}
              stroke={`url(#beam-grad-${key})`}
              strokeWidth={beamOpacity > 0.5 ? 1.5 : 1}
              opacity={beamOpacity}
              strokeDasharray={animated ? '5 5' : undefined}
              style={{
                transition: 'opacity 400ms ease, stroke-width 300ms ease',
                animation: animated ? 'forge-beam-march 0.6s linear infinite' : 'none',
              }}
            />
          );
        })}

        {/* Center forge platform — outer diamond */}
        <polygon
          points={`${CENTER.x},${CENTER.y - 20} ${CENTER.x + 16},${CENTER.y + 5} ${CENTER.x},${CENTER.y + 18} ${CENTER.x - 16},${CENTER.y + 5}`}
          fill={`rgba(249,115,22,${(0.06 + centerIntensity * 0.1).toFixed(3)})`}
          stroke="#f97316"
          strokeWidth={state.phase === 'synthesizing' ? 1.5 : 0.8}
          opacity={0.25 + centerIntensity * 0.65}
          filter={state.phase === 'synthesizing' ? 'url(#fc-glow)' : undefined}
          style={{ transition: 'all 500ms ease' }}
        />
        {/* Center forge platform — inner shard */}
        <polygon
          points={`${CENTER.x},${CENTER.y - 10} ${CENTER.x + 8},${CENTER.y + 2} ${CENTER.x},${CENTER.y + 9} ${CENTER.x - 8},${CENTER.y + 2}`}
          fill="#f97316"
          opacity={0.15 + centerIntensity * 0.65}
          style={{ transition: 'opacity 500ms ease' }}
        />

        {/* Provider cores */}
        {(Object.entries(CORES) as [string, { cx: number; cy: number }][]).map(([key, pos]) => {
          const status: ProviderStatus = (state.providers[key] as ProviderStatus) ?? 'waiting';
          const color = PROVIDER_COLORS[key] ?? '#666';
          const rgb = hexToRgb(color);
          const isActive = status !== 'waiting';

          const outerOpacity   = status === 'waiting' ? 0.2  : status === 'responding' ? 0.55 : 0.7;
          const fillOpacity    = status === 'waiting' ? 0.04 : status === 'responding' ? 0.18 : 0.28;
          const labelOpacity   = status === 'waiting' ? 0.3  : 0.9;
          const dotFill        = status === 'complete' ? color : status === 'responding' ? color : 'transparent';
          const dotOpacity     = status === 'waiting' ? 0.25 : 0.95;
          const coreGlow       = status === 'complete'
            ? `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 14px ${color}66)`
            : status === 'responding'
              ? `drop-shadow(0 0 5px ${color})`
              : 'none';

          return (
            <g key={`core-${key}`} style={{ filter: coreGlow, transition: 'filter 400ms ease' }}>
              {/* Outer ring */}
              <circle
                cx={pos.cx} cy={pos.cy} r={23}
                fill="none"
                stroke={color}
                strokeWidth={status === 'complete' ? 1.5 : 0.8}
                opacity={outerOpacity}
                style={{ transition: 'all 400ms ease' }}
              />
              {/* Core fill */}
              <circle
                cx={pos.cx} cy={pos.cy} r={15}
                fill={`rgba(${rgb},${fillOpacity})`}
                stroke={color}
                strokeWidth={1.2}
                opacity={isActive ? 1 : 0.4}
                style={{
                  transition: 'all 400ms ease',
                  animation: status === 'responding' ? 'forge-core-pulse 1s ease-in-out infinite' : 'none',
                }}
              />
              {/* Provider label */}
              <text
                x={pos.cx} y={pos.cy + 4}
                textAnchor="middle"
                fontSize={8}
                fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
                fontWeight={700}
                fill={color}
                opacity={labelOpacity}
                style={{ transition: 'opacity 400ms ease', letterSpacing: '0.08em' }}
              >
                {(PROVIDER_LABELS[key] ?? key).toUpperCase()}
              </text>
              {/* Status dot — top-right of core */}
              <circle
                cx={pos.cx + 17} cy={pos.cy - 17} r={4}
                fill={dotFill}
                stroke={color}
                strokeWidth={1}
                opacity={dotOpacity}
                style={{ transition: 'all 300ms ease' }}
              />
            </g>
          );
        })}
      </svg>

      {/* Bottom: stability bar + status */}
      <div style={{ marginTop: 10, position: 'relative' }}>
        {/* Label row */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.1em',
          color: 'rgba(255,255,255,0.3)',
          marginBottom: 5,
          textTransform: 'uppercase',
        }}>
          <span>Divergence {divergencePct}%</span>
          <span>Consensus {consensusPct}%</span>
        </div>
        {/* Bar track */}
        <div style={{
          height: 2,
          background: 'rgba(255,255,255,0.07)',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 8,
        }}>
          <div style={{
            height: '100%',
            width: `${consensusPct}%`,
            background: 'linear-gradient(90deg, #f97316 0%, #a855f7 100%)',
            borderRadius: 2,
            transition: 'width 600ms ease',
            boxShadow: consensusPct > 50 ? '0 0 6px rgba(168,85,247,0.4)' : 'none',
          }} />
        </div>
        {/* Status text */}
        <div style={{
          fontSize: 10,
          color: state.escalating ? '#ef4444' : 'rgba(255,255,255,0.38)',
          textAlign: 'center',
          letterSpacing: '0.06em',
          fontWeight: state.escalating ? 700 : 400,
          transition: 'color 300ms ease',
          animation: state.escalating ? 'forge-escalate-flash 0.6s ease-in-out infinite' : 'none',
        }}>
          {statusText}
        </div>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes forge-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.75); }
        }
        @keyframes forge-beam-march {
          to { stroke-dashoffset: -10; }
        }
        @keyframes forge-core-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.55; }
        }
        @keyframes forge-escalate-flash {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
