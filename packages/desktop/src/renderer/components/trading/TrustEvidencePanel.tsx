// ── TrustEvidencePanel.tsx ────────────────────────────────────────────────────
//
// Collapsible card showing historical proof-of-edge per setup family + regime.
// Collapsed by default — compact design, no overcrowding.

import React, { useState } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────

interface SetupReliabilityRecord {
  setupFamily: string;
  regime: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancy: number;
  avgR: number;
  maxDrawdownR: number;
  sampleTier: string;
  trustLevel: string;
}

interface TrustEvidencePanelProps {
  records: SetupReliabilityRecord[];
  /** Current active setup family (to highlight matching row). */
  activeSetupFamily?: string | null;
  /** Current active regime (to highlight matching row). */
  activeRegime?: string | null;
}

// ── Colors ──────────────────────────────────────────────────────────────────

const TRUST_COLORS: Record<string, { color: string; bg: string }> = {
  elite:     { color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
  trusted:   { color: '#34d399', bg: 'rgba(52,211,153,0.06)' },
  probation: { color: '#fbbf24', bg: 'rgba(251,191,36,0.06)' },
  blocked:   { color: '#f87171', bg: 'rgba(248,113,113,0.06)' },
};

const SAMPLE_INDICATOR: Record<string, string> = {
  insufficient: '\u25CB',  // empty circle
  minimal:      '\u25D2',  // half circle
  adequate:     '\u25D5',  // three-quarter circle
  robust:       '\u25CF',  // full circle
};

const c = {
  muted: 'rgba(255,255,255,0.3)',
  border: 'rgba(255,255,255,0.07)',
  dimBg: 'rgba(255,255,255,0.03)',
  highlight: 'rgba(96,165,250,0.08)',
};

// ── Styles ──────────────────────────────────────────────────────────────────

const st = {
  panel: {
    background: c.dimBg, border: `1px solid ${c.border}`, borderRadius: 6,
    overflow: 'hidden' as const,
  },
  header: {
    display: 'flex', alignItems: 'center' as const, justifyContent: 'space-between' as const,
    padding: '8px 14px', cursor: 'pointer',
  },
  title: {
    fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)',
  },
  chevron: {
    fontSize: 10, color: 'rgba(255,255,255,0.2)', transition: 'transform 0.2s',
  },
  table: {
    width: '100%', borderCollapse: 'collapse' as const,
  },
  th: {
    fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', color: 'rgba(255,255,255,0.2)',
    padding: '4px 8px', textAlign: 'left' as const,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  td: {
    fontSize: 10, padding: '4px 8px', color: 'rgba(255,255,255,0.6)',
    fontVariantNumeric: 'tabular-nums' as const,
  },
  trustBadge: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
    borderRadius: 3, padding: '1px 5px',
  },
  empty: {
    padding: '12px 14px', fontSize: 10, color: 'rgba(255,255,255,0.15)',
    fontStyle: 'italic' as const,
  },
};

// ── Component ───────────────────────────────────────────────────────────────

export function TrustEvidencePanel({ records, activeSetupFamily, activeRegime }: TrustEvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!records || records.length === 0) return null;

  // Sort: matching current setup+regime first, then by trades descending
  const sorted = [...records].sort((a, b) => {
    const aMatch = (a.setupFamily === activeSetupFamily && a.regime === activeRegime) ? 1 : 0;
    const bMatch = (b.setupFamily === activeSetupFamily && b.regime === activeRegime) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.trades - a.trades;
  });

  return (
    <div style={st.panel}>
      <div style={st.header} onClick={() => setExpanded(v => !v)}>
        <span style={st.title}>Edge Evidence ({records.length})</span>
        <span style={{
          ...st.chevron,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>{'\u25B8'}</span>
      </div>

      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Setup</th>
                <th style={st.th}>Regime</th>
                <th style={st.th}>N</th>
                <th style={st.th}>Win%</th>
                <th style={st.th}>E[R]</th>
                <th style={st.th}>Trust</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 20).map((r, i) => {
                const isActive = r.setupFamily === activeSetupFamily && r.regime === activeRegime;
                const trustCfg = TRUST_COLORS[r.trustLevel] ?? TRUST_COLORS.probation;
                return (
                  <tr key={i} style={{
                    background: isActive ? c.highlight : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}>
                    <td style={st.td}>{r.setupFamily.replace(/_/g, ' ')}</td>
                    <td style={st.td}>{r.regime.replace(/_/g, ' ')}</td>
                    <td style={st.td}>
                      <span title={r.sampleTier}>{SAMPLE_INDICATOR[r.sampleTier] ?? '\u25CB'}</span>
                      {' '}{r.trades}
                    </td>
                    <td style={{ ...st.td, color: r.winRate >= 0.5 ? '#34d399' : '#f87171' }}>
                      {(r.winRate * 100).toFixed(0)}%
                    </td>
                    <td style={{ ...st.td, color: r.expectancy >= 0 ? '#34d399' : '#f87171' }}>
                      {r.expectancy >= 0 ? '+' : ''}{r.expectancy.toFixed(2)}R
                    </td>
                    <td style={st.td}>
                      <span style={{
                        ...st.trustBadge,
                        color: trustCfg.color,
                        background: trustCfg.bg,
                      }}>
                        {r.trustLevel.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
