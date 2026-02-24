import React, { useState, useEffect } from 'react';

interface LicenseInfo {
  tier: string;
  valid: boolean;
  key: string | null;
  email: string | null;
  expiresAt: string | null;
  error: string | null;
}

interface TierConfig {
  name: string;
  price: string;
  annualPrice: string;
  tagline: string;
  maxMessagesPerMonth: number;
  providers: number;
  voice: boolean;
  consensusMode: boolean;
  longTermMemory: boolean;
  browserAutomation: boolean;
  emailCalendar: boolean;
  financeView: boolean;
  financeTrading: boolean;
  checkoutUrl: string;
}

interface Props {
  onTierChange: (tier: string) => void;
}

export function LicensePanel({ onTierChange }: Props) {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [tiers, setTiers] = useState<Record<string, TierConfig>>({});
  const [urls, setUrls] = useState<{ pro: string; business: string; portal: string }>({ pro: '', business: '', portal: '' });
  const [messagesUsed, setMessagesUsed] = useState(0);
  const [keyInput, setKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [lic, tierData, urlData, usage] = await Promise.all([
        window.triforge.license.load(),
        window.triforge.license.tiers(),
        window.triforge.license.checkoutUrls(),
        window.triforge.usage.get(),
      ]);
      setLicense(lic);
      setTiers(tierData as Record<string, TierConfig>);
      setUrls(urlData);
      setMessagesUsed(usage.messagesThisMonth);
    }
    load();
  }, []);

  const activate = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setActivating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.triforge.license.activate(trimmed);
      if (result.valid) {
        setLicense(result);
        setKeyInput('');
        setSuccess(`✓ Activated! You're now on the ${result.tier} plan.`);
        onTierChange(result.tier);
      } else {
        setError(result.error ?? 'Invalid license key. Check it and try again.');
      }
    } catch {
      setError('Could not reach the license server. Check your connection.');
    } finally {
      setActivating(false);
    }
  };

  const deactivate = async () => {
    setDeactivating(true);
    setError(null);
    try {
      await window.triforge.license.deactivate();
      const fresh = await window.triforge.license.load();
      setLicense(fresh);
      setSuccess('License removed. You are now on the free plan.');
      onTierChange('free');
    } catch {
      setError('Failed to deactivate.');
    } finally {
      setDeactivating(false);
    }
  };

  const openUrl = (url: string) => window.triforge.system.openExternal(url);

  const currentTier = (license?.tier ?? 'free') as 'free' | 'pro' | 'business';
  const tierConfig = tiers[currentTier];
  const msgLimit = tierConfig?.maxMessagesPerMonth ?? 30;
  const unlimited = msgLimit === Infinity;
  const remaining = unlimited ? Infinity : Math.max(0, msgLimit - messagesUsed);

  const TIER_BADGE: Record<string, { label: string; color: string }> = {
    free:     { label: 'Free',     color: 'var(--text-muted)' },
    pro:      { label: 'Pro',      color: 'var(--accent)' },
    business: { label: 'Business', color: 'var(--purple)' },
  };
  const badge = TIER_BADGE[currentTier] ?? TIER_BADGE.free;

  return (
    <div style={styles.page}>
      {/* Current plan card */}
      <h2 style={styles.sectionTitle}>Your Plan</h2>
      <div style={styles.planCard}>
        <div style={styles.planCardLeft}>
          <span style={{ ...styles.tierBadge, color: badge.color, borderColor: badge.color }}>{badge.label}</span>
          <div style={styles.planName}>{tierConfig?.name ?? 'Free'} plan</div>
          <div style={styles.planTagline}>{tierConfig?.tagline ?? 'Try TriForge AI'}</div>
        </div>
        <div style={styles.planCardRight}>
          {!unlimited && (
            <div style={styles.quotaBlock}>
              <div style={styles.quotaLabel}>Messages this month</div>
              <div style={styles.quotaBar}>
                <div style={{ ...styles.quotaFill, width: `${Math.min(100, (messagesUsed / msgLimit) * 100)}%`, background: remaining < 5 ? '#ef4444' : 'var(--accent)' }} />
              </div>
              <div style={styles.quotaText}>{remaining} of {msgLimit} remaining</div>
            </div>
          )}
          {unlimited && (
            <div style={styles.unlimitedBadge}>∞ Unlimited messages</div>
          )}
        </div>
      </div>

      {/* License key section */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 28 }}>License Key</h2>
      {license?.valid && license.key ? (
        <div style={styles.activeKey}>
          <div style={styles.keyInfo}>
            <span style={styles.keyActive}>● Active</span>
            <span style={styles.keyMasked}>{maskKey(license.key)}</span>
            {license.email && <span style={styles.keyEmail}>{license.email}</span>}
          </div>
          <button style={styles.deactivateBtn} onClick={deactivate} disabled={deactivating}>
            {deactivating ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : (
        <>
          <p style={styles.hint}>
            Enter your license key to unlock Pro or Business features.{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Dev keys: <code>TF-DEV-PRO</code> or <code>TF-DEV-BIZ</code>
            </span>
          </p>
          <div style={styles.keyInputRow}>
            <input
              style={styles.keyField}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && activate()}
            />
            <button
              style={{ ...styles.activateBtn, ...(!keyInput.trim() || activating ? styles.activateBtnDisabled : {}) }}
              onClick={activate}
              disabled={!keyInput.trim() || activating}
            >
              {activating ? 'Checking…' : 'Activate'}
            </button>
          </div>
        </>
      )}

      {error  && <div style={styles.errorMsg}>{error}</div>}
      {success && <div style={styles.successMsg}>{success}</div>}

      {/* Manage subscription */}
      {license?.valid && (
        <button style={styles.portalBtn} onClick={() => openUrl(urls.portal)}>
          Manage subscription →
        </button>
      )}

      {/* Upgrade cards */}
      {currentTier !== 'business' && (
        <>
          <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Upgrade</h2>
          <div style={styles.upgradeGrid}>
            {currentTier === 'free' && (
              <PlanCard
                name="Pro"
                price="$19"
                period="/mo"
                annual="$15/mo billed annually"
                tagline="Your personal think tank"
                features={['Unlimited messages', '3-model consensus', 'Voice I/O (Whisper + TTS)', 'Long-term memory', 'Finance dashboard']}
                ctaLabel="Upgrade to Pro"
                accentColor="var(--accent)"
                onCta={() => openUrl(urls.pro)}
              />
            )}
            <PlanCard
              name="Business"
              price="$49"
              period="/mo"
              annual="$39/mo billed annually"
              tagline="Full autonomous agent"
              features={['Everything in Pro', 'Browser automation', 'Email & Calendar', 'Investment trading', 'CRM & lead management', 'Printer access']}
              ctaLabel="Upgrade to Business"
              accentColor="var(--purple)"
              onCta={() => openUrl(urls.business)}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({ name, price, period, annual, tagline, features, ctaLabel, accentColor, onCta }: {
  name: string; price: string; period: string; annual: string; tagline: string;
  features: string[]; ctaLabel: string; accentColor: string; onCta: () => void;
}) {
  return (
    <div style={{ ...styles.planCard2, borderColor: accentColor + '55' }}>
      <div style={{ ...styles.planBadge2, color: accentColor }}>{name}</div>
      <div style={styles.planPrice2}>
        <span style={styles.planAmount}>{price}</span>
        <span style={styles.planPeriod}>{period}</span>
      </div>
      <div style={styles.planAnnual}>{annual}</div>
      <div style={styles.planTagline2}>{tagline}</div>
      <ul style={styles.planFeatures}>
        {features.map(f => (
          <li key={f} style={styles.planFeatureItem}>
            <span style={{ color: accentColor, fontWeight: 700 }}>✓</span> {f}
          </li>
        ))}
      </ul>
      <button style={{ ...styles.planCta, background: accentColor }} onClick={onCta}>{ctaLabel}</button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 8) return '••••-••••';
  return key.slice(0, 4) + '-••••-••••-' + key.slice(-4);
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { flex: 1, overflowY: 'auto', padding: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, marginTop: 0 },

  planCard: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px 20px', gap: 16,
  },
  planCardLeft: { display: 'flex', flexDirection: 'column', gap: 4 },
  planCardRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  tierBadge: { fontSize: 11, fontWeight: 700, border: '1px solid', borderRadius: 20, padding: '2px 10px', textTransform: 'uppercase', letterSpacing: '0.08em', width: 'fit-content' },
  planName: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' },
  planTagline: { fontSize: 12, color: 'var(--text-secondary)' },

  quotaBlock: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  quotaLabel: { fontSize: 11, color: 'var(--text-muted)' },
  quotaBar: { width: 120, height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' },
  quotaFill: { height: '100%', borderRadius: 2, transition: 'width 0.4s' },
  quotaText: { fontSize: 12, color: 'var(--text-secondary)' },
  unlimitedBadge: { fontSize: 13, fontWeight: 700, color: 'var(--accent)' },

  hint: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 },
  keyInputRow: { display: 'flex', gap: 8 },
  keyField: { flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, padding: '8px 12px', fontFamily: 'var(--font)', letterSpacing: '0.04em' },
  activateBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  activateBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  activeKey: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' },
  keyInfo: { display: 'flex', alignItems: 'center', gap: 10 },
  keyActive: { fontSize: 12, color: '#10a37f', fontWeight: 600 },
  keyMasked: { fontSize: 13, color: 'var(--text-primary)', fontFamily: 'monospace' },
  keyEmail: { fontSize: 12, color: 'var(--text-muted)' },
  deactivateBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' },

  errorMsg: { background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, padding: '8px 12px', marginTop: 10 },
  successMsg: { background: '#10a37f20', border: '1px solid #10a37f', borderRadius: 8, color: '#10a37f', fontSize: 13, padding: '8px 12px', marginTop: 10 },

  portalBtn: { background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 12, padding: 0 },

  upgradeGrid: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  planCard2: { flex: 1, minWidth: 220, background: 'var(--bg-elevated)', border: '1px solid', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 8 },
  planBadge2: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
  planPrice2: { display: 'flex', alignItems: 'baseline', gap: 2 },
  planAmount: { fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' },
  planPeriod: { fontSize: 14, color: 'var(--text-secondary)' },
  planAnnual: { fontSize: 11, color: 'var(--text-muted)', marginTop: -4 },
  planTagline2: { fontSize: 13, color: 'var(--text-secondary)' },
  planFeatures: { listStyle: 'none', padding: 0, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 5 },
  planFeatureItem: { fontSize: 13, color: 'var(--text-primary)', display: 'flex', gap: 6 },
  planCta: { border: 'none', borderRadius: 8, color: '#fff', padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginTop: 4 },
};
