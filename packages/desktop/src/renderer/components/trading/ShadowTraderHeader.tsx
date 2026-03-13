// ── ShadowTraderHeader.tsx ───────────────────────────────────────────────────
//
// Sticky top bar for the Shadow Trader workspace.
// Shows: symbol, feed source, engine state, one-sentence status, action buttons.

import React from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type ShadowTraderUiState =
  | 'DISCONNECTED' | 'READY' | 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'OPEN_POSITION';

interface DerivedDisplayState {
  uiState: ShadowTraderUiState;
  sentence: string;
  sessionLabel: string | null;
  feedSource: 'Live Tradovate' | 'Live Tastytrade' | 'Simulated';
}

interface ShadowTraderHeaderProps {
  symbol: string;
  supportedSymbols: string[];
  symbolLabels: Record<string, string>;
  onSymbolChange: (sym: string) => void;
  displayState: DerivedDisplayState;
  onStartShadow: () => void;
  onPauseShadow: () => void;
  onResumeShadow: () => void;
  onFlattenStop: () => void;
  onConnectFeed: () => void;
  onBack: () => void;
  shadowEnabled: boolean;
  shadowPaused: boolean;
  hasOpenTrades: boolean;
  lastEvalAt: number | null;
  shadowToggling: boolean;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
}

// ── State badge colors ──────────────────────────────────────────────────────

const STATE_BADGE: Record<ShadowTraderUiState, { label: string; color: string; bg: string }> = {
  DISCONNECTED:   { label: 'DISCONNECTED', color: 'rgba(255,255,255,0.35)', bg: 'rgba(255,255,255,0.04)' },
  READY:          { label: 'READY',        color: '#60a5fa',                bg: 'rgba(96,165,250,0.1)' },
  RUNNING:        { label: 'RUNNING',      color: '#34d399',                bg: 'rgba(52,211,153,0.1)' },
  PAUSED:         { label: 'PAUSED',       color: '#fbbf24',                bg: 'rgba(251,191,36,0.1)' },
  BLOCKED:        { label: 'BLOCKED',      color: '#f87171',                bg: 'rgba(248,113,113,0.1)' },
  OPEN_POSITION:  { label: 'OPEN',         color: '#c084fc',                bg: 'rgba(192,132,252,0.1)' },
};

// ── Component ────────────────────────────────────────────────────────────────

export function ShadowTraderHeader({
  symbol,
  supportedSymbols,
  symbolLabels,
  onSymbolChange,
  displayState,
  onStartShadow,
  onPauseShadow,
  onResumeShadow,
  onFlattenStop,
  onConnectFeed,
  onBack,
  shadowEnabled,
  shadowPaused,
  hasOpenTrades,
  lastEvalAt,
  shadowToggling,
  timezone,
  onTimezoneChange,
}: ShadowTraderHeaderProps) {
  const badge = STATE_BADGE[displayState.uiState];
  const feedColor =
    displayState.feedSource === 'Live Tradovate' ? '#34d399' :
    displayState.feedSource === 'Live Tastytrade' ? '#34d399' : '#a78bfa';

  return (
    <div style={s.bar}>
      {/* Left cluster */}
      <div style={s.left}>
        <button style={s.backBtn} onClick={onBack}>←</button>
        <span style={s.titleText}>Shadow Trader</span>
        <select
          style={s.symbolSelect}
          value={symbol}
          onChange={e => onSymbolChange(e.target.value)}
        >
          {supportedSymbols.map(sym => (
            <option key={sym} value={sym}>{sym} — {symbolLabels[sym] ?? sym}</option>
          ))}
        </select>
        <span style={{ ...s.feedBadge, color: feedColor, borderColor: feedColor + '40' }}>
          {displayState.feedSource === 'Simulated' ? 'SIM' : 'LIVE'}
        </span>
        <span style={s.paperOnlyBadge}>PAPER ONLY</span>
        <span style={{ ...s.stateBadge, color: badge.color, background: badge.bg, borderColor: badge.color + '40' }}>
          {badge.label}
        </span>
        {displayState.sessionLabel && (
          <span style={s.sessionLabel}>{displayState.sessionLabel}</span>
        )}
      </div>

      {/* Center: state sentence + paper-only notice */}
      <div style={s.center}>
        <span style={s.sentence}>{displayState.sentence}</span>
        <span style={s.paperSafety}>
          Paper Only — TriForge does not place real trades. Copy manually in your broker if desired.
        </span>
      </div>

      {/* Right: timezone + action buttons */}
      <div style={s.right}>
        <select style={s.tzSelect} value={timezone} onChange={e => onTimezoneChange(e.target.value)}>
          <option value="America/New_York">ET</option>
          <option value="America/Chicago">CT</option>
          <option value="America/Denver">MT</option>
          <option value="America/Los_Angeles">PT</option>
          <option value="UTC">UTC</option>
        </select>
        {displayState.uiState === 'DISCONNECTED' && (
          <button style={{ ...s.actionBtn, ...s.actionPrimary }} onClick={onConnectFeed}>
            Connect Feed
          </button>
        )}
        {displayState.uiState === 'READY' && (
          <button style={{ ...s.actionBtn, ...s.actionPrimary }} onClick={onStartShadow} disabled={shadowToggling}>
            {shadowToggling ? 'Starting...' : 'Start Paper'}
          </button>
        )}
        {displayState.uiState === 'RUNNING' && (
          <button style={{ ...s.actionBtn, ...s.actionWarn }} onClick={onPauseShadow}>
            Pause New Trades
          </button>
        )}
        {displayState.uiState === 'PAUSED' && (
          <button style={{ ...s.actionBtn, ...s.actionPrimary }} onClick={onResumeShadow}>
            Resume
          </button>
        )}
        {displayState.uiState === 'BLOCKED' && (
          shadowPaused
            ? <button style={{ ...s.actionBtn, ...s.actionPrimary }} onClick={onResumeShadow}>Resume</button>
            : <button style={{ ...s.actionBtn, ...s.actionWarn }} onClick={onPauseShadow}>Pause New Trades</button>
        )}
        {displayState.uiState === 'OPEN_POSITION' && (
          <button style={{ ...s.actionBtn, ...s.actionDanger }} onClick={onFlattenStop}>
            Flatten Paper & Stop
          </button>
        )}
        {shadowEnabled && displayState.uiState !== 'DISCONNECTED' && displayState.uiState !== 'READY' && (
          <button style={{ ...s.actionBtn, ...s.actionGhost }} onClick={onStartShadow} disabled={shadowToggling}>
            {shadowToggling ? '...' : 'Stop Paper'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  bar: {
    position: 'sticky', top: 0, zIndex: 100,
    background: '#0d0d0f',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    padding: '8px 24px',
    display: 'flex', alignItems: 'center', gap: 12,
    minHeight: 44,
  },
  left: {
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  center: {
    flex: 1, minWidth: 0, textAlign: 'center',
  },
  right: {
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
  },
  backBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
    fontSize: 14, cursor: 'pointer', padding: '2px 6px',
  },
  titleText: {
    fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)',
    letterSpacing: '0.02em',
  },
  symbolSelect: {
    fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
    color: 'rgba(255,255,255,0.6)',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 3, padding: '2px 6px',
    cursor: 'pointer', outline: 'none',
    fontFamily: 'var(--font-mono, monospace)',
  },
  feedBadge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
    border: '1px solid',
    borderRadius: 3, padding: '1px 6px',
  },
  stateBadge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
    border: '1px solid',
    borderRadius: 3, padding: '1px 6px',
  },
  sessionLabel: {
    fontSize: 9, color: 'rgba(255,255,255,0.25)',
    letterSpacing: '0.04em',
  },
  sentence: {
    fontSize: 11, color: 'rgba(255,255,255,0.4)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    display: 'block',
  },
  paperSafety: {
    display: 'block',
    fontSize: 9, color: 'rgba(251,191,36,0.55)',
    letterSpacing: '0.02em',
    marginTop: 2,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  paperOnlyBadge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.1)',
    border: '1px solid rgba(251,191,36,0.35)',
    borderRadius: 3, padding: '1px 6px',
  },
  actionBtn: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
    border: '1px solid', transition: 'opacity 0.12s',
  },
  actionPrimary: {
    color: '#60a5fa', background: 'rgba(96,165,250,0.1)',
    borderColor: 'rgba(96,165,250,0.3)',
  },
  actionWarn: {
    color: '#fbbf24', background: 'rgba(251,191,36,0.1)',
    borderColor: 'rgba(251,191,36,0.3)',
  },
  actionDanger: {
    color: '#f87171', background: 'rgba(248,113,113,0.1)',
    borderColor: 'rgba(248,113,113,0.3)',
  },
  actionGhost: {
    color: 'rgba(255,255,255,0.3)', background: 'none',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tzSelect: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 3, padding: '2px 6px',
    cursor: 'pointer', outline: 'none',
    fontFamily: 'var(--font-mono, monospace)',
  },
};
