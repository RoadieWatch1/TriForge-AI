import React from 'react';
import { CAPABILITY_LABELS, CAPABILITY_DESCRIPTIONS, PRO_FEATURE_BULLETS } from '../capabilityRegistry';

interface Props {
  feature:     string;
  onClose:     () => void;
  onUpgrade:   (url: string) => void;
  proCheckout: string;
  annualCheckout: string;
  // kept for call-site compatibility — ignored
  neededTier?: string;
  bizCheckout?: string;
}

export function UpgradeGate({ feature, onClose, onUpgrade, proCheckout, annualCheckout }: Props) {
  const featureLabel = CAPABILITY_LABELS[feature] ?? feature;
  const featureDesc  = CAPABILITY_DESCRIPTIONS[feature] ?? `${featureLabel} is available on the Pro plan.`;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        <div style={s.iconCircle}>⊡</div>

        <h2 style={s.heading}>Pro feature</h2>

        <p style={s.subheading}>
          <strong style={{ color: 'var(--accent)' }}>{featureLabel}</strong>
          {' '}—{' '}{featureDesc}
        </p>

        <div style={s.planCard}>
          <div style={s.planName}>Pro plan includes everything</div>
          <ul style={s.featureList}>
            {PRO_FEATURE_BULLETS.map(f => (
              <li key={f} style={s.featureItem}>
                <span style={s.checkMark}>✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <button style={s.upgradeBtn} onClick={() => onUpgrade(proCheckout)}>
          Subscribe monthly — $19/mo
        </button>

        <button style={s.annualBtn} onClick={() => onUpgrade(annualCheckout)}>
          Subscribe annually — $15/mo (save 21%)
        </button>

        <button style={s.dismissBtn} onClick={onClose}>Maybe later</button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 999,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: 'var(--surface, #1a1a22)',
    border: '1px solid var(--border)',
    borderRadius: 16, padding: '28px 32px',
    maxWidth: 400, width: '90%',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  },
  iconCircle: {
    width: 52, height: 52, borderRadius: '50%',
    background: 'rgba(99,102,241,0.12)',
    fontSize: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  heading: { margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' },
  subheading: { margin: 0, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.55 },
  planCard: {
    width: '100%', background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 4,
  },
  planName: {
    padding: '8px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
    color: 'var(--accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)',
  },
  featureList: { listStyle: 'none', padding: 0, margin: 0 },
  featureItem: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    padding: '6px 14px', fontSize: 12, color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
  },
  checkMark: { color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1 },
  upgradeBtn: {
    width: '100%', padding: '11px 0',
    background: 'linear-gradient(135deg, var(--accent, #6366f1), #8b5cf6)',
    border: 'none', borderRadius: 9, color: '#fff',
    fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 4,
  },
  annualBtn: {
    width: '100%', padding: '9px 0',
    background: 'none', border: '1px solid var(--accent)',
    borderRadius: 9, color: 'var(--accent)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  dismissBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 12,
    cursor: 'pointer', marginTop: -2,
  },
};
