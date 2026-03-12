// ── MarketContextCard.tsx ────────────────────────────────────────────────────
//
// Decision rail card: regime, route, session, news block status.

import React from 'react';

interface MarketContextCardProps {
  regimeContext: { current?: { regime: string; confidence: number } } | null;
  pathPrediction: { primaryRoute?: { direction: string; fromLevel?: { type: string; price: number }; toLevel?: { type: string; price: number }; qualityScore?: number } } | null;
  sessionLabel: string | null;
  newsBlocked: boolean;
  newsReason: string | null;
}

const REGIME_CFG: Record<string, { label: string; color: string }> = {
  open_drive: { label: 'OPEN DRIVE', color: '#fb923c' },
  trend:      { label: 'TREND',      color: '#34d399' },
  range:      { label: 'RANGE',      color: '#60a5fa' },
  reversal:   { label: 'REVERSAL',   color: '#f87171' },
  expansion:  { label: 'EXPANSION',  color: '#c084fc' },
  drift:      { label: 'DRIFT',      color: 'rgba(255,255,255,0.4)' },
};

export function MarketContextCard({ regimeContext, pathPrediction, sessionLabel, newsBlocked, newsReason }: MarketContextCardProps) {
  const rc = regimeContext?.current;
  const cfg = rc ? (REGIME_CFG[rc.regime] ?? REGIME_CFG.drift) : null;
  const route = pathPrediction?.primaryRoute;

  return (
    <div style={s.card}>
      <div style={s.label}>MARKET CONTEXT</div>

      {/* Regime */}
      {cfg && rc && (
        <div style={s.row}>
          <span style={{ ...s.badge, color: cfg.color, borderColor: cfg.color + '40' }}>{cfg.label}</span>
          <span style={s.dimText}>{Math.round(rc.confidence)}% conf</span>
        </div>
      )}

      {/* Route */}
      {route && (
        <div style={s.row}>
          <span style={{ fontSize: 10, fontWeight: 800, color: route.direction === 'up' ? '#34d399' : '#f87171' }}>
            {route.direction === 'up' ? '\u2191' : '\u2193'}
          </span>
          <span style={s.dimText}>
            {route.fromLevel?.type?.replace(/_/g, ' ') ?? 'Current'} → {route.toLevel?.type?.replace(/_/g, ' ') ?? 'Target'}
          </span>
          <span style={{ ...s.dimText, marginLeft: 'auto', fontSize: 9 }}>
            Q:{Math.round(route.qualityScore ?? 0)}
          </span>
        </div>
      )}

      {/* Session */}
      {sessionLabel && (
        <div style={s.row}>
          <span style={s.dimText}>Session: {sessionLabel}</span>
        </div>
      )}

      {/* News block */}
      {newsBlocked && (
        <div style={{ ...s.row, gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: '#f87171' }}>NEWS BLOCK</span>
          <span style={{ fontSize: 10, color: '#f87171' }}>{newsReason}</span>
        </div>
      )}

      {!cfg && !route && !sessionLabel && !newsBlocked && (
        <div style={s.dimText}>No market context available yet.</div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6, padding: '10px 12px',
  },
  label: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.2)', marginBottom: 6,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3,
  },
  badge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    border: '1px solid', borderRadius: 3, padding: '1px 6px',
  },
  dimText: {
    fontSize: 10, color: 'rgba(255,255,255,0.35)',
  },
};
