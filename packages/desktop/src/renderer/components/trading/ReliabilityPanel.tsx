// ── ReliabilityPanel.tsx ──────────────────────────────────────────────────────
//
// Compact panel showing live signal reliability score + component breakdown.
// Designed for the hero thesis column — max ~100px height, no scroll.

import React from 'react';

// ── Types ───────────────────────────────────────────────────────────────────

interface ReliabilityPanelProps {
  reliability: {
    composite: number;
    band: string;
    components: Record<string, number>;
    primaryDegradation: string | null;
    expired: boolean;
    explanation: string;
  } | null;
}

// ── Colors ──────────────────────────────────────────────────────────────────

const BAND_COLORS: Record<string, { color: string; bg: string }> = {
  elite:     { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  qualified: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  watchlist: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  blocked:   { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

const COMPONENT_LABELS: Record<string, string> = {
  setupQuality:      'Setup',
  signalFreshness:   'Fresh',
  confirmationDepth: 'Confirm',
  routeClarity:      'Route',
  regimeAlignment:   'Regime',
  councilConsensus:  'Council',
  feedStability:     'Feed',
  historicalEdge:    'History',
};

function barColor(val: number): string {
  if (val >= 80) return '#34d399';
  if (val >= 60) return '#60a5fa';
  if (val >= 40) return '#fbbf24';
  return '#f87171';
}

// ── Styles ──────────────────────────────────────────────────────────────────

const st = {
  panel: {
    display: 'flex', flexDirection: 'column' as const, gap: 6,
    padding: '8px 14px',
  },
  title: {
    fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)',
  },
  headerRow: {
    display: 'flex', alignItems: 'center' as const, gap: 8,
  },
  score: {
    fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums' as const,
  },
  bandChip: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
    borderRadius: 3, padding: '2px 6px',
  },
  expiredBadge: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
    borderRadius: 3, padding: '2px 6px',
    color: '#a78bfa', background: 'rgba(167,139,250,0.12)',
  },
  barsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
  },
  barItem: {
    display: 'flex', flexDirection: 'column' as const, gap: 1,
  },
  barLabel: {
    fontSize: 7, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', color: 'rgba(255,255,255,0.2)',
  },
  barTrack: {
    height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)',
    position: 'relative' as const, overflow: 'hidden' as const,
  },
  barFill: {
    position: 'absolute' as const, top: 0, left: 0, height: '100%',
    borderRadius: 2, transition: 'width 0.3s',
  },
  degradation: {
    fontSize: 9, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' as const,
  },
};

// ── Component ───────────────────────────────────────────────────────────────

export function ReliabilityPanel({ reliability }: ReliabilityPanelProps) {
  if (!reliability) return null;

  const bandCfg = BAND_COLORS[reliability.band] ?? BAND_COLORS.blocked;
  const components = reliability.components ?? {};

  return (
    <div style={st.panel}>
      <div style={st.title}>Signal Reliability</div>

      {/* Score + band + expired */}
      <div style={st.headerRow}>
        <span style={{ ...st.score, color: bandCfg.color }}>
          {Math.round(reliability.composite)}
        </span>
        <span style={{ ...st.bandChip, color: bandCfg.color, background: bandCfg.bg }}>
          {reliability.band.toUpperCase()}
        </span>
        {reliability.expired && (
          <span style={st.expiredBadge}>EXPIRED</span>
        )}
      </div>

      {/* 8 component mini-bars in 4x2 grid */}
      <div style={st.barsGrid}>
        {Object.entries(COMPONENT_LABELS).map(([key, label]) => {
          const val = Math.max(0, Math.min(100, components[key] ?? 50));
          return (
            <div key={key} style={st.barItem}>
              <span style={st.barLabel}>{label}</span>
              <div style={st.barTrack}>
                <div style={{
                  ...st.barFill,
                  width: `${val}%`,
                  background: barColor(val),
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Primary degradation callout — only when score < 60 */}
      {reliability.composite < 60 && reliability.primaryDegradation && (
        <div style={st.degradation}>{reliability.primaryDegradation}</div>
      )}
    </div>
  );
}
