// ── DecisionReasonCard.tsx ───────────────────────────────────────────────────
//
// Decision rail card: short human-readable explanation of what the engine is doing.

import React from 'react';

interface DecisionReasonCardProps {
  shadowBlockedReason: string | null;
  simulatorBlockedReason: string | null;
  latestReviewed: { outcome: string; reason?: string; intent?: { side?: string; entry?: number; score?: number } } | null;
  shadowEnabled: boolean;
  onEnableShadow?: () => void;
}

export function DecisionReasonCard({ shadowBlockedReason, simulatorBlockedReason, latestReviewed, shadowEnabled, onEnableShadow }: DecisionReasonCardProps) {
  if (!shadowEnabled) {
    return (
      <div style={s.card}>
        <div style={s.label}>DECISION</div>
        <div style={s.text}>Paper Trading is off.</div>
        {onEnableShadow && (
          <button style={s.enableBtn} onClick={onEnableShadow}>
            Start Paper Trading
          </button>
        )}
      </div>
    );
  }

  const blocked = shadowBlockedReason || simulatorBlockedReason;
  if (blocked) {
    return (
      <div style={s.card}>
        <div style={s.label}>DECISION</div>
        <div style={{ ...s.text, color: '#f87171' }}>Blocked: {blocked}</div>
      </div>
    );
  }

  if (latestReviewed) {
    const isApproved = latestReviewed.outcome === 'approved';
    const color = isApproved ? '#34d399' : latestReviewed.outcome === 'rejected' ? '#f87171' : 'rgba(255,255,255,0.4)';
    const verb = isApproved ? 'Approved' : latestReviewed.outcome === 'rejected' ? 'Rejected' : 'Reviewed';
    return (
      <div style={s.card}>
        <div style={s.label}>LATEST DECISION</div>
        <div style={{ ...s.outcomeRow }}>
          <span style={{ ...s.outcomeBadge, color, borderColor: color + '40' }}>{verb.toUpperCase()}</span>
          {latestReviewed.intent?.side && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
              {latestReviewed.intent.side} @ {latestReviewed.intent.entry?.toFixed(2) ?? '—'}
            </span>
          )}
        </div>
        {latestReviewed.reason && (
          <div style={s.text}>{latestReviewed.reason}</div>
        )}
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.label}>DECISION</div>
      <div style={s.text}>Waiting — scanning for paper trade setups...</div>
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
  text: {
    fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: '1.5',
  },
  enableBtn: {
    marginTop: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    color: '#60a5fa', background: 'rgba(96,165,250,0.1)',
    border: '1px solid rgba(96,165,250,0.3)', borderRadius: 4,
    padding: '5px 12px', cursor: 'pointer',
  },
  outcomeRow: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  outcomeBadge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    border: '1px solid', borderRadius: 3, padding: '1px 6px',
  },
};
