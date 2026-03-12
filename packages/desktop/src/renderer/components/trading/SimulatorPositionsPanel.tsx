// ── SimulatorPositionsPanel.tsx ────────────────────────────────────────────────
//
// Simulator open/closed positions and pending orders display.
// Read-only. No engine imports — local type mirrors only.

import React, { useState } from 'react';

// ── Local type mirrors ───────────────────────────────────────────────────────

interface SimPositionView {
  id: string; symbol: string; side: 'long' | 'short';
  entryPrice: number; stopPrice: number; targetPrice: number;
  openedAt: number; qty: number;
  unrealizedPnL?: number; unrealizedR?: number;
  mfe?: number; mae?: number;
  closedAt?: number; exitPrice?: number; exitReason?: string;
  realizedPnL?: number; realizedR?: number;
}

interface SimOrderView {
  id: string; side: 'long' | 'short'; symbol: string;
  type: string; price: number; status: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return price >= 1000
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
}

function formatPnL(value: number | undefined): { text: string; color: string } {
  if (value === undefined || value === null) return { text: '—', color: 'rgba(255,255,255,0.3)' };
  const sign = value >= 0 ? '+' : '';
  return {
    text: `${sign}${value.toFixed(2)}`,
    color: value > 0 ? '#34d399' : value < 0 ? '#f87171' : 'rgba(255,255,255,0.5)',
  };
}

function timeElapsed(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

// ── Component ────────────────────────────────────────────────────────────────

export function SimulatorPositionsPanel({
  open, closed, orders,
}: {
  open: SimPositionView[];
  closed: SimPositionView[];
  orders: SimOrderView[];
}) {
  const [showClosed, setShowClosed] = useState(false);

  const totalOpenPnL = open.reduce((sum, p) => sum + (p.unrealizedPnL ?? 0), 0);
  const totalClosedPnL = closed.reduce((sum, p) => sum + (p.realizedPnL ?? 0), 0);
  const hasContent = open.length > 0 || closed.length > 0 || orders.length > 0;

  if (!hasContent) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>Simulator Positions</div>
        <div style={s.empty}>No simulator positions</div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Simulator Positions</div>

      {/* Summary row */}
      <div style={s.summaryRow}>
        <SummaryStat label="Open" value={String(open.length)} />
        <SummaryStat label="Open P&L" value={formatPnL(totalOpenPnL).text} color={formatPnL(totalOpenPnL).color} />
        <SummaryStat label="Closed" value={String(closed.length)} />
        <SummaryStat label="Realized" value={formatPnL(totalClosedPnL).text} color={formatPnL(totalClosedPnL).color} />
      </div>

      {/* Pending orders */}
      {orders.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Pending Orders</div>
          {orders.map(order => (
            <div key={order.id} style={s.orderRow}>
              <span style={{ ...s.sideBadge, color: order.side === 'long' ? '#34d399' : '#f87171' }}>
                {order.side === 'long' ? '\u25B2' : '\u25BC'}
              </span>
              <span style={s.orderSymbol}>{order.symbol}</span>
              <span style={s.orderDetail}>{order.type} @ {formatPrice(order.price)}</span>
              <span style={s.orderStatus}>{order.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Open positions */}
      {open.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Open Positions</div>
          {open.map(pos => {
            const pnl = formatPnL(pos.unrealizedPnL);
            const rPnl = pos.unrealizedR !== undefined ? `${pos.unrealizedR >= 0 ? '+' : ''}${pos.unrealizedR.toFixed(2)}R` : '';
            return (
              <div key={pos.id} style={s.positionCard}>
                <div style={s.posHeader}>
                  <span style={{ ...s.sideBadge, color: pos.side === 'long' ? '#34d399' : '#f87171' }}>
                    {pos.side === 'long' ? '\u25B2' : '\u25BC'} {pos.side.toUpperCase()}
                  </span>
                  <span style={s.posSymbol}>{pos.symbol}</span>
                  <span style={s.posQty}>\u00D7{pos.qty}</span>
                  <span style={{ ...s.posPnl, color: pnl.color }}>{pnl.text} pts</span>
                  {rPnl && <span style={{ ...s.posR, color: pnl.color }}>{rPnl}</span>}
                </div>
                <div style={s.posLevels}>
                  <span>Entry: {formatPrice(pos.entryPrice)}</span>
                  <span style={{ color: '#f87171' }}>Stop: {formatPrice(pos.stopPrice)}</span>
                  <span style={{ color: '#34d399' }}>Target: {formatPrice(pos.targetPrice)}</span>
                  <span style={s.posTime}>{timeElapsed(pos.openedAt)} open</span>
                </div>
                {(pos.mfe !== undefined || pos.mae !== undefined) && (
                  <div style={s.excursions}>
                    {pos.mfe !== undefined && <span>MFE: {pos.mfe.toFixed(2)}</span>}
                    {pos.mae !== undefined && <span>MAE: {pos.mae.toFixed(2)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Closed positions */}
      {closed.length > 0 && (
        <div style={s.section}>
          <div style={{ ...s.sectionTitle, justifyContent: 'space-between', display: 'flex' }}>
            <span>Closed Positions</span>
            <button style={s.toggleBtn} onClick={() => setShowClosed(v => !v)}>
              {showClosed ? 'Hide' : `Show ${closed.length}`}
            </button>
          </div>
          {showClosed && closed.slice(0, 10).map(pos => {
            const pnl = formatPnL(pos.realizedPnL);
            const rPnl = pos.realizedR !== undefined ? `${pos.realizedR >= 0 ? '+' : ''}${pos.realizedR.toFixed(2)}R` : '';
            return (
              <div key={pos.id} style={s.closedRow}>
                <span style={{ ...s.sideBadge, color: pos.side === 'long' ? '#34d399' : '#f87171', opacity: 0.6 }}>
                  {pos.side === 'long' ? '\u25B2' : '\u25BC'}
                </span>
                <span style={s.closedSymbol}>{pos.symbol}</span>
                <span style={s.closedDetail}>
                  {formatPrice(pos.entryPrice)} \u2192 {pos.exitPrice ? formatPrice(pos.exitPrice) : '—'}
                </span>
                <span style={{ ...s.closedPnl, color: pnl.color }}>{pnl.text}</span>
                {rPnl && <span style={{ ...s.closedR, color: pnl.color }}>{rPnl}</span>}
                <span style={s.closedReason}>{pos.exitReason ?? ''}</span>
                <span style={s.closedTime}>{pos.closedAt ? formatTime(pos.closedAt) : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={s.summaryStat}>
      <span style={s.summaryLabel}>{label}</span>
      <span style={{ ...s.summaryValue, color: color ?? 'rgba(255,255,255,0.7)' }}>{value}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:     { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  empty:         { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', padding: '8px 0' },

  summaryRow:    { display: 'flex', gap: 20, flexWrap: 'wrap' },
  summaryStat:   { display: 'flex', flexDirection: 'column', gap: 2 },
  summaryLabel:  { fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  summaryValue:  { fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },

  section:       { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionTitle:  { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.2)', paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.04)' },

  orderRow:      { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0' },
  orderSymbol:   { fontWeight: 700, color: 'rgba(255,255,255,0.7)' },
  orderDetail:   { color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' },
  orderStatus:   { color: 'rgba(255,255,255,0.3)', marginLeft: 'auto', fontSize: 9 },

  positionCard:  { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 },
  posHeader:     { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 },
  sideBadge:     { fontWeight: 700, fontSize: 10 },
  posSymbol:     { fontWeight: 700, color: 'rgba(255,255,255,0.7)' },
  posQty:        { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  posPnl:        { fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' },
  posR:          { fontWeight: 600, fontSize: 10, fontVariantNumeric: 'tabular-nums' },
  posLevels:     { display: 'flex', gap: 10, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap' },
  posTime:       { color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' },
  excursions:    { display: 'flex', gap: 12, fontSize: 9, color: 'rgba(255,255,255,0.25)' },

  closedRow:     { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' },
  closedSymbol:  { fontWeight: 600, color: 'rgba(255,255,255,0.5)' },
  closedDetail:  { color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums' },
  closedPnl:     { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  closedR:       { fontSize: 9, fontVariantNumeric: 'tabular-nums' },
  closedReason:  { fontSize: 9, color: 'rgba(255,255,255,0.2)', flex: 1, textAlign: 'right' },
  closedTime:    { fontSize: 9, color: 'rgba(255,255,255,0.15)' },

  toggleBtn:     { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: 10, cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
};
