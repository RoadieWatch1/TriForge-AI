import React from 'react';

interface Props {
  feature: string;
  neededTier: 'pro' | 'business';
  onClose: () => void;
  onUpgrade: (url: string) => void;
  proCheckout: string;
  bizCheckout: string;
}

const FEATURE_LABELS: Record<string, string> = {
  // UPPER_SNAKE_CASE capability keys (current)
  MULTI_PROVIDER:      'Multiple AI providers',
  THINK_TANK:          'Think Tank (3-AI consensus)',
  VOICE:               'Voice input & speech output',
  EXECUTION_PLANS:     'Execution plan generation',
  WORKFLOW_TEMPLATES:  'One-click workflow templates',
  DECISION_LEDGER:     'Decision Ledger',
  EXPORT_TOOLS:        'Export to Markdown & PDF',
  APP_ANALYSIS:        'App Builder Services Guide',
  FINANCE_DASHBOARD:   'Finance dashboard',
  BROWSER_AUTOMATION:  'Browser automation',
  EMAIL_CALENDAR:      'Email & Calendar access',
  FINANCE_TRADING:     'Investment trading',
  WORKFLOW_REPLAY:     'Workflow replay from Ledger',
  GOVERNANCE_PROFILES: 'Governance profiles',
  UNLIMITED_MESSAGES:  'Unlimited messages',
  // Special system codes
  MESSAGE_LIMIT_REACHED: 'Unlimited messages',
};

const PRO_FEATURES = [
  '300 messages / month',
  'Think Tank — 3-AI consensus',
  'Voice I/O (Whisper + TTS)',
  'Execution plan generation',
  'One-click workflow templates',
  'Decision Ledger + export',
  'Long-term memory (50 entries)',
  'App Builder Services Guide',
];

const BIZ_FEATURES = [
  'Unlimited messages',
  'Everything in Pro',
  'Browser automation',
  'Email & Calendar access',
  'Investment trading',
  'Workflow replay from Ledger',
  'Governance profiles',
  'Memory up to 200 entries',
];

export function UpgradeGate({ feature, neededTier, onClose, onUpgrade, proCheckout, bizCheckout }: Props) {
  const isPro = neededTier === 'pro';
  const tierName = isPro ? 'Pro' : 'Business';
  const tierPrice = isPro ? '$19/mo' : '$49/mo';
  const featureLabel = FEATURE_LABELS[feature] ?? feature;
  const checkoutUrl = isPro ? proCheckout : bizCheckout;
  const features = isPro ? PRO_FEATURES : BIZ_FEATURES;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Icon */}
        <div style={iconCircle}>⊡</div>

        {/* Heading */}
        <h2 style={heading}>{tierName} feature</h2>
        <p style={subheading}>
          <strong style={{ color: 'var(--accent)' }}>{featureLabel}</strong> is available on the{' '}
          <strong>{tierName}</strong> plan ({tierPrice}).
        </p>

        {/* Feature list */}
        <ul style={featureList}>
          {features.map(f => (
            <li key={f} style={featureItem}>
              <span style={checkMark}>✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <button style={upgradeBtn} onClick={() => onUpgrade(checkoutUrl)}>
          Upgrade to {tierName} — {tierPrice}
        </button>

        {!isPro && (
          <button style={proBtn} onClick={() => onUpgrade(proCheckout)}>
            Or upgrade to Pro — $19/mo
          </button>
        )}

        <button style={dismissBtn} onClick={onClose}>Maybe later</button>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 999,
  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const card: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 32, maxWidth: 380, width: '90%',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
};

const iconCircle: React.CSSProperties = {
  width: 56, height: 56, borderRadius: '50%',
  background: 'var(--accent-dim)', fontSize: 26,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  marginBottom: 4,
};

const heading: React.CSSProperties = {
  margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center',
};

const subheading: React.CSSProperties = {
  margin: 0, fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.5,
};

const featureList: React.CSSProperties = {
  listStyle: 'none', padding: 0, margin: '8px 0', width: '100%',
  background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)',
};

const featureItem: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'center',
  padding: '8px 14px', fontSize: 13, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border)',
};

const checkMark: React.CSSProperties = { color: 'var(--accent)', fontWeight: 700, flexShrink: 0 };

const upgradeBtn: React.CSSProperties = {
  width: '100%', padding: '12px 0',
  background: 'linear-gradient(135deg, var(--accent), var(--purple))',
  border: 'none', borderRadius: 10, color: '#fff',
  fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4,
};

const proBtn: React.CSSProperties = {
  width: '100%', padding: '10px 0',
  background: 'none', border: '1px solid var(--border)',
  borderRadius: 10, color: 'var(--text-secondary)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const dismissBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text-muted)',
  fontSize: 13, cursor: 'pointer', marginTop: -4,
};
