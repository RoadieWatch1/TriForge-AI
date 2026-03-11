// ── MarketDataStrip.tsx ──────────────────────────────────────────────────────
//
// Compact horizontal strip showing live market metrics below the chart.
// Replaces the old full-height "Live Market" card in chart-first layout.

import React from 'react';

interface MarketDataStripProps {
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  highOfDay?: number;
  lowOfDay?: number;
  trend?: 'up' | 'down' | 'range' | 'unknown';
  feedFreshnessMs?: number;
  source?: 'tradovate' | 'simulated';
}

const s = {
  row: {
    display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline', padding: '6px 0 0',
  } as React.CSSProperties,
  price: {
    fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
    color: 'rgba(255,255,255,0.92)',
  } as React.CSSProperties,
  detail: {
    fontSize: 10, color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  right: {
    fontSize: 9, marginLeft: 'auto',
  } as React.CSSProperties,
};

export function MarketDataStrip({
  lastPrice,
  bidPrice,
  askPrice,
  highOfDay,
  lowOfDay,
  trend,
  feedFreshnessMs,
  source,
}: MarketDataStripProps) {
  const trendColor = trend === 'up' ? '#34d399' : trend === 'down' ? '#f87171' : 'rgba(255,255,255,0.3)';
  const freshColor = feedFreshnessMs === undefined ? 'rgba(255,255,255,0.2)'
    : feedFreshnessMs > 8000 ? '#f87171'
    : feedFreshnessMs > 4000 ? '#fbbf24'
    : 'rgba(255,255,255,0.2)';
  const freshLabel = feedFreshnessMs === undefined ? ''
    : feedFreshnessMs < 1000 ? '<1s'
    : `${Math.round(feedFreshnessMs / 1000)}s`;

  return (
    <div style={s.row}>
      <span style={s.price}>
        {lastPrice !== undefined ? lastPrice.toFixed(2) : '---'}
      </span>
      <span style={s.detail}>
        Bid {bidPrice?.toFixed(2) ?? '--'} / Ask {askPrice?.toFixed(2) ?? '--'}
      </span>
      <span style={s.detail}>
        H {highOfDay?.toFixed(2) ?? '--'} / L {lowOfDay?.toFixed(2) ?? '--'}
      </span>
      {trend && (
        <span style={{ fontSize: 10, fontWeight: 700, color: trendColor }}>
          {trend.toUpperCase()}
        </span>
      )}
      <span style={{ ...s.right, color: freshColor }}>
        {freshLabel}{freshLabel ? ' ago' : ''}{source ? ` \u00b7 ${source === 'tradovate' ? 'LIVE' : 'SIMULATED'}` : ''}
      </span>
    </div>
  );
}
