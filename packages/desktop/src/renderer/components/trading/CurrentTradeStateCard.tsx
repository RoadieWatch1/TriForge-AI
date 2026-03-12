// ── CurrentTradeStateCard.tsx ────────────────────────────────────────────────
//
// Decision rail card: shows current trade state (no trade / open / blocked).

import React from 'react';

interface ShadowTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  status: 'open' | 'closed';
  openedAt: number;
  unrealizedPnl?: number;
}

interface CurrentTradeStateCardProps {
  trade: ShadowTrade | null;
  blockedReason: string | null;
}

export function CurrentTradeStateCard({ trade, blockedReason }: CurrentTradeStateCardProps) {
  if (!trade && !blockedReason) {
    return (
      <div style={s.card}>
        <div style={s.label}>TRADE STATE</div>
        <div style={s.noTrade}>No open position</div>
      </div>
    );
  }

  if (!trade && blockedReason) {
    return (
      <div style={s.card}>
        <div style={s.label}>TRADE STATE</div>
        <div style={s.blocked}>Blocked: {blockedReason}</div>
      </div>
    );
  }

  if (!trade) return null;

  const pnlColor = (trade.unrealizedPnl ?? 0) >= 0 ? '#34d399' : '#f87171';
  const sideColor = trade.side === 'long' ? '#34d399' : '#f87171';
  const ageMs = Date.now() - trade.openedAt;
  const ageMins = Math.round(ageMs / 60_000);
  const ageStr = ageMins < 60 ? `${ageMins}m` : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m`;

  return (
    <div style={{ ...s.card, borderColor: sideColor + '30' }}>
      <div style={s.label}>OPEN POSITION</div>
      <div style={s.row}>
        <span style={{ ...s.sideBadge, color: sideColor, borderColor: sideColor + '40' }}>
          {trade.side.toUpperCase()}
        </span>
        <span style={s.symbolText}>{trade.symbol}</span>
        <span style={{ ...s.pnl, color: pnlColor }}>
          {(trade.unrealizedPnl ?? 0) >= 0 ? '+' : ''}{(trade.unrealizedPnl ?? 0).toFixed(2)}
        </span>
      </div>
      <div style={s.metricsGrid}>
        <MetricPair label="Entry" value={trade.entryPrice.toFixed(2)} />
        <MetricPair label="Stop" value={trade.stopPrice.toFixed(2)} color="#f87171" />
        <MetricPair label="Target" value={trade.targetPrice.toFixed(2)} color="#34d399" />
        <MetricPair label="Qty" value={String(trade.qty)} />
        <MetricPair label="Age" value={ageStr} />
      </div>
    </div>
  );
}

function MetricPair({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={s.metric}>
      <span style={s.metricLabel}>{label}</span>
      <span style={{ ...s.metricValue, color: color ?? 'rgba(255,255,255,0.6)' }}>{value}</span>
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
  noTrade: {
    fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic',
  },
  blocked: {
    fontSize: 11, color: '#f87171', lineHeight: '1.4',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  sideBadge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    border: '1px solid', borderRadius: 3, padding: '1px 6px',
  },
  symbolText: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
  },
  pnl: {
    fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
    marginLeft: 'auto',
  },
  metricsGrid: {
    display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
  },
  metric: {
    display: 'flex', flexDirection: 'column', gap: 1,
  },
  metricLabel: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.15)',
  },
  metricValue: {
    fontSize: 10, fontFamily: 'var(--font-mono, monospace)',
  },
};
