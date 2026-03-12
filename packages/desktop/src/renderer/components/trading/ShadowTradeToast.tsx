// ── ShadowTradeToast.tsx — Real-time copy-trade signal overlay ─────────────────
//
// Displays actionable trade alerts when TriForge opens or closes a shadow trade.
// Designed for users who mirror shadow trades in a real brokerage screen.
//
// Features:
//   - Full trade details: symbol, side, entry, stop, target, qty, grade, confidence
//   - Signal freshness: LIVE NOW → AGING → STALE
//   - Stable toast IDs, max 5 stack, auto-dismiss 10s
//   - IPC unsubscribe + timer cleanup on unmount
//   - Audio cue on each alert (compact, non-intrusive)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playTradeOpenTone, playTradeCloseTone } from '../../audio/councilSounds';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TradeSignalAlert {
  type: 'trade_opened' | 'trade_closed';
  source: 'controller' | 'simulator';
  tradeId: string;
  symbol: string;
  symbolLabel: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  timestamp: number;
  setupGrade?: 'A' | 'B' | 'C' | 'D';
  confidence?: string;
  qualityScore?: number;
  exitPrice?: number;
  exitReason?: string;
  pnl?: number;
  pnlR?: number;
}

interface ToastEntry {
  id: string;
  alert: TradeSignalAlert;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 10_000;
const MAX_TOASTS = 5;
const FRESHNESS_LIVE_MS = 15_000;
const FRESHNESS_AGING_MS = 60_000;

// ── Freshness ─────────────────────────────────────────────────────────────────

type Freshness = 'live' | 'aging' | 'stale';

function computeFreshnessState(timestamp: number, now: number): Freshness {
  const age = now - timestamp;
  if (age < FRESHNESS_LIVE_MS) return 'live';
  if (age < FRESHNESS_AGING_MS) return 'aging';
  return 'stale';
}

const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: 'LIVE NOW',
  aging: 'AGING',
  stale: 'STALE',
};

const FRESHNESS_COLOR: Record<Freshness, string> = {
  live: '#34d399',
  aging: '#fbbf24',
  stale: '#f87171',
};

// ── Container ─────────────────────────────────────────────────────────────────

export function ShadowTradeToastContainer() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seenIdsRef = useRef<Set<string>>(new Set());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const unsub = (window.triforge.trading as any).onShadowTradeAlert?.((alert: TradeSignalAlert) => {
      // Stable dedup: tradeId + type
      const id = `${alert.tradeId}-${alert.type}`;
      if (seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);

      // Audio cue
      if (alert.type === 'trade_opened') playTradeOpenTone();
      else playTradeCloseTone((alert.pnl ?? 0) >= 0);

      setToasts(prev => [{ id, alert }, ...prev].slice(0, MAX_TOASTS));

      // Auto-dismiss
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    });

    return () => {
      unsub?.();
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      seenIdsRef.current.clear();
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div style={S.container}>
      {toasts.map(t => (
        <ToastItem key={t.id} alert={t.alert} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

// ── Toast Item ────────────────────────────────────────────────────────────────

function ToastItem({ alert, onDismiss }: { alert: TradeSignalAlert; onDismiss: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [visible, setVisible] = useState(false);

  // Freshness tick (1s)
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Slide-in animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const isOpen = alert.type === 'trade_opened';
  const isProfit = (alert.pnl ?? 0) >= 0;
  const freshness = computeFreshnessState(alert.timestamp, now);
  const ageSec = Math.round((now - alert.timestamp) / 1000);

  const borderColor = isOpen
    ? 'rgba(167,139,250,0.6)'
    : isProfit
      ? 'rgba(52,211,153,0.6)'
      : 'rgba(248,113,113,0.6)';

  const sideColor = alert.side === 'long' ? '#34d399' : '#f87171';

  return (
    <div style={{
      ...S.toast,
      borderLeftColor: borderColor,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(20px)',
    }}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.typeLabel}>
          {isOpen ? 'OPENED' : 'CLOSED'}{' '}
          <span style={{ color: sideColor, fontWeight: 700 }}>{alert.side.toUpperCase()}</span>{' '}
          <span style={{ color: 'rgba(255,255,255,0.95)', fontSize: 12 }}>{alert.symbol}</span>
          <span style={S.symbolLabel}> {alert.symbolLabel}</span>
        </span>
        <button style={S.closeBtn} onClick={onDismiss} title="Dismiss">&times;</button>
      </div>

      {/* Trade details — copy-trade format */}
      {isOpen ? (
        <>
          <div style={S.detailRow}>
            <Detail label="Entry" value={alert.entryPrice.toFixed(2)} />
            <Detail label="Stop" value={alert.stopPrice.toFixed(2)} />
            <Detail label="Target" value={alert.targetPrice.toFixed(2)} />
            <Detail label="Qty" value={String(alert.qty)} />
          </div>
          <div style={S.detailRow}>
            {alert.setupGrade && <Detail label="Grade" value={alert.setupGrade} />}
            {alert.confidence && <Detail label="Confidence" value={alert.confidence.toUpperCase()} />}
            {alert.qualityScore != null && <Detail label="Score" value={String(alert.qualityScore)} />}
          </div>
        </>
      ) : (
        <div style={S.detailRow}>
          {alert.exitPrice != null && <Detail label="Exit" value={alert.exitPrice.toFixed(2)} />}
          {alert.exitReason && <Detail label="Reason" value={alert.exitReason.toUpperCase()} />}
          {alert.pnl != null && (
            <span style={{ ...S.detail, color: alert.pnl >= 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
              <span style={S.detailLabel}>P/L</span>
              {alert.pnl >= 0 ? '+' : ''}{alert.pnl.toFixed(2)}
            </span>
          )}
          {alert.pnlR != null && (
            <span style={{ ...S.detail, color: alert.pnlR >= 0 ? '#34d399' : '#f87171' }}>
              <span style={S.detailLabel}>R</span>
              {alert.pnlR >= 0 ? '+' : ''}{alert.pnlR.toFixed(1)}R
            </span>
          )}
        </div>
      )}

      {/* Freshness badge */}
      <div style={S.freshnessRow}>
        <span style={{ ...S.freshnessBadge, color: FRESHNESS_COLOR[freshness], borderColor: FRESHNESS_COLOR[freshness] }}>
          {FRESHNESS_LABEL[freshness]}
        </span>
        <span style={S.ageText}>{ageSec}s ago</span>
      </div>
    </div>
  );
}

// ── Detail cell ───────────────────────────────────────────────────────────────

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span style={S.detail}>
      <span style={S.detailLabel}>{label}</span>
      <span style={S.detailValue}>{value}</span>
    </span>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 16,
    right: 16,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxWidth: 380,
    pointerEvents: 'none',
  },
  toast: {
    pointerEvents: 'auto',
    background: 'rgba(10,10,14,0.96)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderLeft: '3px solid rgba(167,139,250,0.6)',
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: 'rgba(255,255,255,0.5)',
  },
  symbolLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: 400,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 4px',
    lineHeight: 1,
  },
  detailRow: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap' as const,
  },
  detail: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
  },
  detailLabel: {
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'rgba(255,255,255,0.3)',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
  },
  freshnessRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  freshnessBadge: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.1em',
    border: '1px solid',
    borderRadius: 3,
    padding: '1px 5px',
  },
  ageText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.25)',
  },
};
