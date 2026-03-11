// ── renderer/components/trading/SessionRegimePanel.tsx ────────────────────────
//
// Current session regime display with confidence, description, and
// transition history. Data comes from simulator state — no direct
// IPC calls.
//
// Props-driven. Local type mirrors only.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

type SessionRegimeLabel = 'open_drive' | 'trend' | 'range' | 'reversal' | 'expansion' | 'drift';

interface RegimeSnapshotView {
  regime: SessionRegimeLabel;
  confidence: number;
  detectedAt: number;
  description: string;
}

interface RegimeContextView {
  current: RegimeSnapshotView | null;
  previous: RegimeSnapshotView | null;
  history: RegimeSnapshotView[];
}

interface SessionRegimePanelProps {
  regimeContext: RegimeContextView | null;
}

// ── Regime Display Config ───────────────────────────────────────────────────

const REGIME_CONFIG: Record<SessionRegimeLabel, { label: string; color: string; bg: string; border: string }> = {
  open_drive: { label: 'OPEN DRIVE',  color: '#fb923c', bg: 'rgba(251,146,60,0.1)',   border: 'rgba(251,146,60,0.3)' },
  trend:      { label: 'TREND',       color: '#34d399', bg: 'rgba(52,211,153,0.1)',    border: 'rgba(52,211,153,0.3)' },
  range:      { label: 'RANGE',       color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',    border: 'rgba(96,165,250,0.3)' },
  reversal:   { label: 'REVERSAL',    color: '#f87171', bg: 'rgba(248,113,113,0.1)',   border: 'rgba(248,113,113,0.3)' },
  expansion:  { label: 'EXPANSION',   color: '#c084fc', bg: 'rgba(192,132,252,0.1)',   border: 'rgba(192,132,252,0.3)' },
  drift:      { label: 'DRIFT',       color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)' },
};

// ── Component ───────────────────────────────────────────────────────────────

export function SessionRegimePanel({ regimeContext }: SessionRegimePanelProps) {
  if (!regimeContext || !regimeContext.current) {
    return (
      <div style={p.card}>
        <div style={p.cardTitle}>SESSION REGIME</div>
        <div style={p.empty}>No regime data available. The detector needs at least 30 minutes of bar data.</div>
      </div>
    );
  }

  const current = regimeContext.current;
  const cfg = REGIME_CONFIG[current.regime] ?? REGIME_CONFIG.drift;
  const history = regimeContext.history;

  return (
    <div style={p.card}>
      <div style={p.cardTitle}>SESSION REGIME</div>

      {/* ── Current Regime ── */}
      <div style={p.currentRow}>
        <span style={{ ...p.regimeBadge, color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
          {cfg.label}
        </span>
        <span style={p.confidenceLabel}>
          {Math.round(current.confidence)}% confidence
        </span>
      </div>

      {/* ── Description ── */}
      <div style={p.description}>{current.description}</div>

      {/* ── Transition History ── */}
      {history.length > 1 && (
        <div style={p.historySection}>
          <div style={p.historyTitle}>TRANSITIONS</div>
          <div style={p.historyList}>
            {history.map((snap, i) => {
              const hCfg = REGIME_CONFIG[snap.regime] ?? REGIME_CONFIG.drift;
              const ago = timeSince(snap.detectedAt);
              return (
                <div key={i} style={{ ...p.historyItem, ...(i === 0 ? { fontWeight: 700 } : {}) }}>
                  <span style={{ ...p.historyBadge, color: hCfg.color, background: hCfg.bg, borderColor: hCfg.border }}>
                    {hCfg.label}
                  </span>
                  <span style={p.historyAgo}>{ago}</span>
                  <span style={p.historyConf}>{Math.round(snap.confidence)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeSince(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:           { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:      { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  empty:          { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },

  // Current regime
  currentRow:     { display: 'flex', alignItems: 'center', gap: 10 },
  regimeBadge:    { fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', border: '1px solid', borderRadius: 4, padding: '3px 10px', flexShrink: 0 },
  confidenceLabel:{ fontSize: 11, color: 'rgba(255,255,255,0.4)' },

  // Description
  description:    { fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 },

  // History
  historySection: { display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 },
  historyTitle:   { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.25)' },
  historyList:    { display: 'flex', flexDirection: 'column', gap: 4 },
  historyItem:    { display: 'flex', alignItems: 'center', gap: 8 },
  historyBadge:   { fontSize: 8, fontWeight: 800, letterSpacing: '0.06em', border: '1px solid', borderRadius: 3, padding: '1px 5px', flexShrink: 0 },
  historyAgo:     { fontSize: 10, color: 'rgba(255,255,255,0.3)', minWidth: 60 },
  historyConf:    { fontSize: 10, color: 'rgba(255,255,255,0.2)', fontVariantNumeric: 'tabular-nums' },
};
