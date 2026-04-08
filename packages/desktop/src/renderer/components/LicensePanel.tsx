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
  memoryLimit: number;
  providers: number;
  checkoutUrl: string;
  annualCheckoutUrl: string;
}

interface Props {
  onTierChange: (tier: string) => void;
}

const PLAN_FEATURES = [
  'Unlimited messages — no cap',
  'Think Tank — Claude, GPT & Grok in consensus',
  'Voice I/O (Whisper STT + TTS)',
  'Autonomous Task Engine with approval flows',
  'Browser automation + Email & Calendar access',
  'Execution plans, workflow templates & Ledger',
  'Venture Discovery, Vibe Coding & Income Operator',
  'Forge Profiles (industry operational intelligence)',
  'Investment trading via connected brokers',
  'Long-term memory — 500 entries',
];

export function LicensePanel({ onTierChange }: Props) {
  const [license, setLicense]         = useState<LicenseInfo | null>(null);
  const [tiers, setTiers]             = useState<Record<string, TierConfig>>({});
  const [urls, setUrls]               = useState<{ pro: string; annual: string; portal: string }>({ pro: '', annual: '', portal: '' });
  const [messagesUsed, setMessagesUsed] = useState(0);
  const [keyInput, setKeyInput]       = useState('');
  const [activating, setActivating]   = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState<string | null>(null);

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
      setUrls(urlData as any);
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
        setLicense({ expiresAt: null, ...result });
        setKeyInput('');
        setSuccess('✓ Activated! You now have full access.');
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

  const isPro    = license?.tier === 'pro' && license?.valid;
  const msgLimit = isPro ? Infinity : (tiers['free']?.maxMessagesPerMonth ?? 30);
  const unlimited = msgLimit === Infinity;
  const remaining = unlimited ? Infinity : Math.max(0, msgLimit - messagesUsed);

  return (
    <div style={styles.page}>
      {/* Current plan */}
      <h2 style={styles.sectionTitle}>Your Plan</h2>
      <div style={styles.planCard}>
        <div style={styles.planCardLeft}>
          <span style={{
            ...styles.tierBadge,
            color:       isPro ? 'var(--accent)' : 'var(--text-muted)',
            borderColor: isPro ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {isPro ? 'Pro' : 'Free'}
          </span>
          <div style={styles.planName}>{isPro ? 'Pro' : 'Free'} plan</div>
          <div style={styles.planTagline}>
            {isPro ? 'Full access. Everything included.' : "Explore what's possible"}
          </div>
        </div>
        <div style={styles.planCardRight}>
          {!unlimited ? (
            <div style={styles.quotaBlock}>
              <div style={styles.quotaLabel}>Messages this month</div>
              <div style={styles.quotaBar}>
                <div style={{
                  ...styles.quotaFill,
                  width:      `${Math.min(100, (messagesUsed / msgLimit) * 100)}%`,
                  background: remaining < 5 ? '#ef4444' : 'var(--accent)',
                }} />
              </div>
              <div style={styles.quotaText}>{remaining} of {msgLimit} remaining</div>
            </div>
          ) : (
            <div style={styles.unlimitedBadge}>∞ Unlimited messages</div>
          )}
        </div>
      </div>

      {/* License key */}
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
          <p style={styles.hint}>Enter your license key to unlock full access.</p>
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

      {error   && <div style={styles.errorMsg}>{error}</div>}
      {success && <div style={styles.successMsg}>{success}</div>}

      {license?.valid && (
        <button style={styles.portalBtn} onClick={() => openUrl(urls.portal)}>
          Manage subscription →
        </button>
      )}

      {/* Upgrade section — only shown to free users */}
      {!isPro && (
        <>
          <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Upgrade to Pro</h2>
          <div style={styles.upgradeCard}>
            <div style={styles.upgradeHeader}>
              <span style={styles.upgradeBadge}>Pro</span>
              <span style={styles.upgradeTagline}>Full access. Everything included.</span>
            </div>

            <ul style={styles.featureList}>
              {PLAN_FEATURES.map(f => (
                <li key={f} style={styles.featureItem}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span> {f}
                </li>
              ))}
            </ul>

            <div style={styles.pricingRow}>
              <button style={styles.monthlyBtn} onClick={() => openUrl(urls.pro)}>
                <div style={styles.btnPriceLabel}>Monthly</div>
                <div style={styles.btnPrice}>$19 <span style={styles.btnPer}>/mo</span></div>
                <div style={styles.btnSub}>cancel anytime</div>
              </button>

              <button style={styles.annualBtn} onClick={() => openUrl(urls.annual)}>
                <div style={styles.btnBadge}>Save 21%</div>
                <div style={styles.btnPriceLabel}>Annual</div>
                <div style={styles.btnPrice}>$15 <span style={styles.btnPer}>/mo</span></div>
                <div style={styles.btnSub}>$180 billed yearly</div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••-••••';
  return key.slice(0, 4) + '-••••-••••-' + key.slice(-4);
}

const styles: Record<string, React.CSSProperties> = {
  page:         { flex: 1, overflowY: 'auto', padding: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, marginTop: 0 },

  planCard: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px 20px', gap: 16,
  },
  planCardLeft:  { display: 'flex', flexDirection: 'column', gap: 4 },
  planCardRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  tierBadge: {
    fontSize: 11, fontWeight: 700, border: '1px solid', borderRadius: 20,
    padding: '2px 10px', textTransform: 'uppercase', letterSpacing: '0.08em', width: 'fit-content',
  },
  planName:    { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' },
  planTagline: { fontSize: 12, color: 'var(--text-secondary)' },

  quotaBlock:     { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  quotaLabel:     { fontSize: 11, color: 'var(--text-muted)' },
  quotaBar:       { width: 120, height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' },
  quotaFill:      { height: '100%', borderRadius: 2, transition: 'width 0.4s' },
  quotaText:      { fontSize: 12, color: 'var(--text-secondary)' },
  unlimitedBadge: { fontSize: 13, fontWeight: 700, color: 'var(--accent)' },

  hint:              { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 },
  keyInputRow:       { display: 'flex', gap: 8 },
  keyField:          { flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, padding: '8px 12px', fontFamily: 'var(--font)', letterSpacing: '0.04em' },
  activateBtn:       { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  activateBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  activeKey:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' },
  keyInfo:      { display: 'flex', alignItems: 'center', gap: 10 },
  keyActive:    { fontSize: 12, color: '#10a37f', fontWeight: 600 },
  keyMasked:    { fontSize: 13, color: 'var(--text-primary)', fontFamily: 'monospace' },
  keyEmail:     { fontSize: 12, color: 'var(--text-muted)' },
  deactivateBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' },

  errorMsg:  { background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, padding: '8px 12px', marginTop: 10 },
  successMsg: { background: '#10a37f20', border: '1px solid #10a37f', borderRadius: 8, color: '#10a37f', fontSize: 13, padding: '8px 12px', marginTop: 10 },
  portalBtn: { background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 12, padding: 0 },

  upgradeCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--accent)33',
    borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
  },
  upgradeHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  upgradeBadge: {
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
    color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 20,
    padding: '2px 10px',
  },
  upgradeTagline: { fontSize: 14, color: 'var(--text-secondary)' },
  featureList:    { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 5 },
  featureItem:    { fontSize: 13, color: 'var(--text-primary)', display: 'flex', gap: 6 },

  pricingRow: { display: 'flex', gap: 12 },
  monthlyBtn: {
    flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '14px 12px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    color: 'var(--text-primary)',
  },
  annualBtn: {
    flex: 1, background: 'linear-gradient(135deg, var(--accent, #6366f1)22, #8b5cf622)',
    border: '1px solid var(--accent)', borderRadius: 10, padding: '14px 12px',
    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    position: 'relative', color: 'var(--text-primary)',
  },
  btnBadge: {
    position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
    background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700,
    borderRadius: 20, padding: '2px 8px', letterSpacing: '0.05em',
  },
  btnPriceLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  btnPrice:      { fontSize: 24, fontWeight: 800 },
  btnPer:        { fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' },
  btnSub:        { fontSize: 11, color: 'var(--text-muted)' },
};
