// ── CurrentTradeStateCard.tsx ────────────────────────────────────────────────
//
// Decision rail card: shows current paper trade with copy-to-broker button.
// All fields a trader needs to manually enter the trade in their real broker.

import React, { useState, useCallback } from 'react';

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
  reason?: string;
  setupType?: string;
  pnl?: number;
  exitPrice?: number;
  exitReason?: string;
}

interface CurrentTradeStateCardProps {
  trade: ShadowTrade | null;
  blockedReason: string | null;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function _fmtET(tsMs: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    hour12: true,
  }).format(new Date(tsMs)) + ' ET';
}

function _fmtAge(msAgo: number): string {
  const m = Math.round(msAgo / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Copy text builder ─────────────────────────────────────────────────────────

function _buildCopyText(trade: ShadowTrade): string {
  const dir  = trade.side === 'long' ? 'BUY' : 'SELL';
  const stop = trade.stopPrice.toFixed(2);
  const tgt  = trade.targetPrice.toFixed(2);
  const rr   = Math.abs((trade.targetPrice - trade.entryPrice) / (trade.entryPrice - trade.stopPrice)).toFixed(1);
  const pnlStr = trade.unrealizedPnl !== undefined
    ? `  Paper P&L: ${trade.unrealizedPnl >= 0 ? '+' : ''}$${trade.unrealizedPnl.toFixed(2)}`
    : '';

  return [
    `── PAPER TRADE (manual copy) ──`,
    `${dir} ${trade.qty} ${trade.symbol}`,
    `  Entry:  ${trade.entryPrice.toFixed(2)}`,
    `  Stop:   ${stop}`,
    `  Target: ${tgt}  (${rr}R)`,
    `  Time:   ${_fmtET(trade.openedAt)}`,
    pnlStr,
    `  Setup:  ${trade.setupType ?? '—'}`,
    `────────────────────────────`,
  ].filter(Boolean).join('\n');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CurrentTradeStateCard({ trade, blockedReason }: CurrentTradeStateCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!trade) return;
    void navigator.clipboard.writeText(_buildCopyText(trade)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [trade]);

  if (!trade && !blockedReason) {
    return (
      <div style={s.card}>
        <div style={s.label}>PAPER TRADE STATE</div>
        <div style={s.noTrade}>No open paper position</div>
      </div>
    );
  }

  if (!trade && blockedReason) {
    return (
      <div style={s.card}>
        <div style={s.label}>PAPER TRADE STATE</div>
        <div style={s.blocked}>Blocked: {blockedReason}</div>
      </div>
    );
  }

  if (!trade) return null;

  const pnlVal   = trade.unrealizedPnl ?? 0;
  const pnlColor = pnlVal >= 0 ? '#34d399' : '#f87171';
  const sideColor = trade.side === 'long' ? '#34d399' : '#f87171';
  const rr = Math.abs(
    (trade.targetPrice - trade.entryPrice) / (trade.entryPrice - trade.stopPrice)
  ).toFixed(1);

  return (
    <div style={{ ...s.card, borderColor: sideColor + '40' }}>
      {/* Header row */}
      <div style={s.headerRow}>
        <div style={s.label}>PAPER POSITION</div>
        <button
          style={{ ...s.copyBtn, ...(copied ? s.copyBtnDone : {}) }}
          onClick={handleCopy}
          title="Copy trade details to clipboard"
        >
          {copied ? 'Copied!' : 'Copy to Broker'}
        </button>
      </div>

      {/* Side + symbol + P&L */}
      <div style={s.row}>
        <span style={{ ...s.sideBadge, color: sideColor, borderColor: sideColor + '40', background: sideColor + '15' }}>
          {trade.side === 'long' ? 'LONG' : 'SHORT'}
        </span>
        <span style={s.symbolText}>{trade.symbol}</span>
        <span style={{ ...s.pnl, color: pnlColor }}>
          {pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}
        </span>
      </div>

      {/* Key levels — copy-ready layout */}
      <div style={s.levelsGrid}>
        <LevelRow label="ENTRY" value={trade.entryPrice.toFixed(2)} />
        <LevelRow label="STOP"  value={trade.stopPrice.toFixed(2)}  color="#f87171" />
        <LevelRow label="TARGET" value={trade.targetPrice.toFixed(2)} color="#34d399" suffix={`${rr}R`} />
      </div>

      {/* Secondary info */}
      <div style={s.metaRow}>
        <span style={s.metaItem}>
          <span style={s.metaLabel}>QTY</span>
          <span style={s.metaValue}>{trade.qty}</span>
        </span>
        <span style={s.metaItem}>
          <span style={s.metaLabel}>OPENED</span>
          <span style={s.metaValue}>{_fmtET(trade.openedAt)}</span>
        </span>
        <span style={s.metaItem}>
          <span style={s.metaLabel}>AGE</span>
          <span style={s.metaValue}>{_fmtAge(Date.now() - trade.openedAt)}</span>
        </span>
      </div>

      {/* Setup type */}
      {trade.setupType && trade.setupType !== 'none' && (
        <div style={s.setupRow}>
          <span style={s.metaLabel}>SETUP</span>
          <span style={s.setupText}>{trade.setupType.replace(/_/g, ' ')}</span>
        </div>
      )}

      {/* Reason */}
      {trade.reason && (
        <div style={s.reasonText}>{trade.reason}</div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LevelRow({ label, value, color, suffix }: { label: string; value: string; color?: string; suffix?: string }) {
  return (
    <div style={s.levelRow}>
      <span style={s.levelLabel}>{label}</span>
      <span style={{ ...s.levelValue, color: color ?? 'rgba(255,255,255,0.75)' }}>{value}</span>
      {suffix && <span style={s.levelSuffix}>{suffix}</span>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6, padding: '10px 12px',
  },
  headerRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.2)',
  },
  copyBtn: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
    color: '#60a5fa', background: 'rgba(96,165,250,0.1)',
    border: '1px solid rgba(96,165,250,0.25)',
    borderRadius: 3, padding: '2px 8px', cursor: 'pointer',
    transition: 'all 0.15s',
  },
  copyBtnDone: {
    color: '#34d399', background: 'rgba(52,211,153,0.1)',
    borderColor: 'rgba(52,211,153,0.25)',
  },
  noTrade: {
    fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic',
  },
  blocked: {
    fontSize: 11, color: '#f87171', lineHeight: '1.4',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
  },
  sideBadge: {
    fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
    border: '1px solid', borderRadius: 3, padding: '2px 8px',
  },
  symbolText: {
    fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.75)',
    fontFamily: 'var(--font-mono, monospace)',
  },
  pnl: {
    fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
    marginLeft: 'auto',
  },
  levelsGrid: {
    display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 4, padding: '6px 8px',
  },
  levelRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  levelLabel: {
    fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.2)', width: 40, flexShrink: 0,
  },
  levelValue: {
    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
    flex: 1,
  },
  levelSuffix: {
    fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono, monospace)',
  },
  metaRow: {
    display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6,
  },
  metaItem: {
    display: 'flex', flexDirection: 'column' as const, gap: 1,
  },
  metaLabel: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.15)',
  },
  metaValue: {
    fontSize: 10, color: 'rgba(255,255,255,0.5)',
    fontFamily: 'var(--font-mono, monospace)',
  },
  setupRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
  },
  setupText: {
    fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'capitalize' as const,
  },
  reasonText: {
    fontSize: 10, color: 'rgba(255,255,255,0.25)', lineHeight: '1.4',
    fontStyle: 'italic',
  },
};
