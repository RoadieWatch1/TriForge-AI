import React from 'react';
import {
  CAPABILITY_LABELS,
  CAPABILITY_DESCRIPTIONS,
  PRO_FEATURE_BULLETS,
  BUSINESS_FEATURE_BULLETS,
} from '../capabilityRegistry';

interface Props {
  feature:    string;
  neededTier: 'pro' | 'business';
  onClose:    () => void;
  onUpgrade:  (url: string) => void;
  proCheckout:  string;
  bizCheckout:  string;
}

export function UpgradeGate({ feature, neededTier, onClose, onUpgrade, proCheckout, bizCheckout }: Props) {
  const isPro      = neededTier === 'pro';
  const tierName   = isPro ? 'Pro' : 'Business';
  const tierPrice  = isPro ? '$19/mo' : '$49/mo';
  const featureLabel = CAPABILITY_LABELS[feature] ?? feature;
  const featureDesc  = CAPABILITY_DESCRIPTIONS[feature] ?? `${featureLabel} is available on the ${tierName} plan.`;
  const checkoutUrl  = isPro ? proCheckout : bizCheckout;
  const bullets      = isPro ? PRO_FEATURE_BULLETS : BUSINESS_FEATURE_BULLETS;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        {/* Icon */}
        <div style={s.iconCircle}>⊡</div>

        {/* Heading */}
        <h2 style={s.heading}>{tierName} feature</h2>

        {/* Feature description */}
        <p style={s.subheading}>
          <strong style={{ color: 'var(--accent)' }}>{featureLabel}</strong>
          {' '}—{' '}{featureDesc}
        </p>

        {/* Plan bullet list */}
        <div style={s.planCard}>
          <div style={s.planName}>{tierName} plan includes</div>
          <ul style={s.featureList}>
            {bullets.map(f => (
              <li key={f} style={s.featureItem}>
                <span style={s.checkMark}>✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Primary CTA */}
        <button style={s.upgradeBtn} onClick={() => onUpgrade(checkoutUrl)}>
          Upgrade to {tierName} — {tierPrice}
        </button>

        {/* Show Pro option when Business is needed */}
        {!isPro && (
          <button style={s.proBtn} onClick={() => onUpgrade(proCheckout)}>
            Or upgrade to Pro — $19/mo
          </button>
        )}

        <button style={s.dismissBtn} onClick={onClose}>Maybe later</button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  heading: {
    margin: 0, fontSize: 19, fontWeight: 700,
    color: 'var(--text-primary)', textAlign: 'center',
  },
  subheading: {
    margin: 0, fontSize: 13,
    color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.55,
  },
  planCard: {
    width: '100%',
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 10, overflow: 'hidden',
    marginTop: 4,
  },
  planName: {
    padding: '8px 14px', fontSize: 11,
    fontWeight: 700, letterSpacing: '0.07em',
    color: 'var(--accent)', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)',
  },
  featureList: {
    listStyle: 'none', padding: 0, margin: 0,
  },
  featureItem: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    padding: '6px 14px', fontSize: 12,
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
  },
  checkMark: {
    color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1,
  },
  upgradeBtn: {
    width: '100%', padding: '11px 0',
    background: 'linear-gradient(135deg, var(--accent, #6366f1), #8b5cf6)',
    border: 'none', borderRadius: 9, color: '#fff',
    fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 4,
  },
  proBtn: {
    width: '100%', padding: '9px 0',
    background: 'none', border: '1px solid var(--border)',
    borderRadius: 9, color: 'var(--text-secondary)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  dismissBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 12,
    cursor: 'pointer', marginTop: -2,
  },
};
