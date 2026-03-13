// ── ChartTruthStrip.tsx ──────────────────────────────────────────────────────
//
// One-line truth strip above the chart: symbol | timeframe | source | freshness | trade state.

import React from 'react';

interface ChartTruthStripProps {
  symbol: string;
  timeframe: string;
  source: 'live' | 'sim';
  feedFreshnessMs: number | undefined;
  tradeOverlay: { entryPrice: number; side: 'long' | 'short' } | null;
  uiState: string;
}

export function ChartTruthStrip({ symbol, timeframe, source, feedFreshnessMs, tradeOverlay, uiState }: ChartTruthStripProps) {
  const freshLabel = feedFreshnessMs === undefined ? '—'
    : feedFreshnessMs < 1000 ? '<1s ago'
    : `${(feedFreshnessMs / 1000).toFixed(1)}s ago`;
  const freshColor = feedFreshnessMs === undefined ? 'rgba(255,255,255,0.15)'
    : feedFreshnessMs > 8000 ? '#f87171'
    : feedFreshnessMs > 4000 ? '#fbbf24'
    : 'rgba(255,255,255,0.25)';

  const tradeStr = tradeOverlay
    ? `PAPER ${tradeOverlay.side.toUpperCase()} @ ${tradeOverlay.entryPrice.toFixed(2)}`
    : uiState === 'RUNNING' ? 'Scanning...'
    : uiState === 'PAUSED' ? 'Paused'
    : '';

  const tradeColor = tradeOverlay
    ? (tradeOverlay.side === 'long' ? '#34d399' : '#f87171')
    : 'rgba(255,255,255,0.2)';

  return (
    <div style={s.strip}>
      <span style={s.sym}>{symbol}</span>
      <span style={s.sep}>|</span>
      <span style={s.tf}>{timeframe.toUpperCase()}</span>
      <span style={s.sep}>|</span>
      <span style={{ ...s.src, color: source === 'live' ? '#34d399' : '#a78bfa' }}>
        {source === 'live' ? 'LIVE DATA' : 'SIM DATA'}
      </span>
      <span style={s.sep}>|</span>
      <span style={s.paperOnly}>PAPER ONLY</span>
      <span style={s.sep}>|</span>
      <span style={{ ...s.fresh, color: freshColor }}>{freshLabel}</span>
      {tradeStr && (
        <>
          <span style={s.sep}>|</span>
          <span style={{ ...s.trade, color: tradeColor }}>{tradeStr}</span>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  strip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.02)',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontFamily: 'var(--font-mono, monospace)',
  },
  sym: { fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' },
  sep: { fontSize: 10, color: 'rgba(255,255,255,0.08)' },
  tf: { fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)' },
  src: { fontSize: 9, fontWeight: 800, letterSpacing: '0.06em' },
  paperOnly: { fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: '#fbbf24' },
  fresh: { fontSize: 9 },
  trade: { fontSize: 9, fontWeight: 800, letterSpacing: '0.04em' },
};
