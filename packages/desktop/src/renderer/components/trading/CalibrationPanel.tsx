// ── renderer/components/trading/CalibrationPanel.tsx ────────────────────────────
//
// Advisory-only display of weight adjustment suggestions from the
// setup weight calibrator. Explicitly labeled as advisory — no
// apply/accept buttons.
//
// Props-driven — no direct IPC calls.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface WeightSuggestionView {
  factor: string;
  evidence: string;
  confidence: 'low' | 'medium' | 'high';
}

interface CalibrationPanelProps {
  suggestions: WeightSuggestionView[];
}

// ── Component ───────────────────────────────────────────────────────────────

export function CalibrationPanel({ suggestions }: CalibrationPanelProps) {
  return (
    <div style={p.card}>
      <div style={p.cardTitle}>CALIBRATION SUGGESTIONS</div>

      {/* Advisory banner */}
      <div style={p.advisory}>
        These suggestions are advisory only. They are generated from your journal data
        and highlight areas where setup performance deviates from the overall average.
        No weights are changed automatically.
      </div>

      {/* Empty state */}
      {suggestions.length === 0 && (
        <div style={p.empty}>
          No calibration suggestions available. The calibrator needs at least 20 completed
          trades and 5 trades per bucket before generating recommendations.
        </div>
      )}

      {/* Suggestion cards */}
      {suggestions.map((s, i) => (
        <div key={i} style={p.suggCard}>
          <div style={p.suggHeader}>
            <span style={p.suggFactor}>{s.factor.replace(/_/g, ' ').replace(/:/g, ' / ')}</span>
            <span style={confidenceBadgeStyle(s.confidence)}>
              {s.confidence.toUpperCase()}
            </span>
          </div>
          <div style={p.suggEvidence}>{s.evidence}</div>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function confidenceBadgeStyle(confidence: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    high:   { bg: 'rgba(52,211,153,0.1)',  fg: '#34d399', border: 'rgba(52,211,153,0.3)' },
    medium: { bg: 'rgba(251,191,36,0.1)',  fg: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
    low:    { bg: 'rgba(255,255,255,0.05)', fg: 'rgba(255,255,255,0.4)', border: 'rgba(255,255,255,0.15)' },
  };
  const c = colors[confidence] ?? colors.low;
  return {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
    borderRadius: 3, padding: '1px 6px', flexShrink: 0,
  };
}

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  advisory:    { fontSize: 11, color: 'rgba(251,191,36,0.7)', background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 },
  empty:       { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },
  suggCard:    { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 },
  suggHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  suggFactor:  { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  suggEvidence:{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 },
};
