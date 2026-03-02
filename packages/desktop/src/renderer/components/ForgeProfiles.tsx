import React, { useState } from 'react';
import { ForgeEngine, EngineProfileType } from './forge/ForgeEngine';

// ── Types ───────────────────────────────────────────────────────────────────

interface Props {
  tier: string;
  activeProfileId: string | null;
  onProfileChange: (id: string | null) => void;
  onSendToChat: (prompt: string) => void;
  onUpgradeClick: () => void;
}

interface EngineCard {
  id: EngineProfileType;
  label: string;
  icon: string;
  desc: string;
  detail: string;
}

// ── Engine definitions ──────────────────────────────────────────────────────

const ENGINES: EngineCard[] = [
  {
    id: 'saas',
    label: 'SaaS Builder',
    icon: '💻',
    desc: 'Build and launch a software product',
    detail: 'Blueprint · Assets · Screens · API routes · DB schema',
  },
  {
    id: 'realestate',
    label: 'Real Estate Growth',
    icon: '🏠',
    desc: 'Scale your real estate business',
    detail: 'Blueprint · Outreach assets · Lead funnel · CRM structure',
  },
  {
    id: 'restaurant',
    label: 'Restaurant Growth',
    icon: '🍽',
    desc: 'Optimize and grow your restaurant',
    detail: 'Blueprint · Marketing assets · Menu · Pricing · Landing page',
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export function ForgeProfiles({ tier, onUpgradeClick }: Props) {
  const [selectedEngine, setSelectedEngine] = useState<EngineProfileType | null>(null);

  // Free tier — upgrade gate
  if (tier === 'free') {
    return (
      <div style={styles.root}>
        <div style={styles.lockedCard}>
          <p style={styles.lockedIcon}>🔒</p>
          <p style={styles.lockedTitle}>Business Engines</p>
          <p style={styles.lockedSub}>
            Business Engines are available on Pro and Business plans. Unlock AI-powered business building — blueprints, assets, and full build output in minutes.
          </p>
          <button style={styles.upgradeBtn} onClick={onUpgradeClick}>
            Upgrade to Pro
          </button>
        </div>
      </div>
    );
  }

  // Engine selected — run the engine flow
  if (selectedEngine) {
    return (
      <div style={styles.root}>
        <ForgeEngine
          profileType={selectedEngine}
          onBack={() => setSelectedEngine(null)}
        />
      </div>
    );
  }

  // Engine selection
  return (
    <div style={styles.root}>
      <div style={styles.pageHeader}>
        <p style={styles.pageTitle}>Business Engines</p>
        <p style={styles.pageSub}>
          Select an engine. Answer a few questions. The AI council builds your business.
        </p>
      </div>

      <div style={styles.engineGrid}>
        {ENGINES.map(engine => (
          <button
            key={engine.id}
            style={styles.engineCard}
            onClick={() => setSelectedEngine(engine.id)}
          >
            <span style={styles.engineIcon}>{engine.icon}</span>
            <p style={styles.engineLabel}>{engine.label}</p>
            <p style={styles.engineDesc}>{engine.desc}</p>
            <p style={styles.engineDetail}>{engine.detail}</p>
            <span style={styles.engineArrow}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: '20px 20px 40px',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    height: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  lockedCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 10,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '40px 32px',
    maxWidth: 420,
    margin: '40px auto 0',
  },
  lockedIcon: {
    fontSize: 32,
    margin: 0,
  },
  lockedTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.8)',
    margin: 0,
  },
  lockedSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 1.6,
    margin: 0,
  },
  upgradeBtn: {
    marginTop: 8,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: 7,
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    padding: '10px 24px',
    cursor: 'pointer',
    letterSpacing: '0.3px',
  },
  pageHeader: {
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: '0 0 4px',
    letterSpacing: '0.2px',
  },
  pageSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.5,
  },
  engineGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  engineCard: {
    position: 'relative',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10,
    padding: '18px 20px 18px 64px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'border-color 0.15s, background 0.15s',
    width: '100%',
  },
  engineIcon: {
    position: 'absolute',
    left: 18,
    top: 18,
    fontSize: 28,
  },
  engineLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: '0 0 3px',
  },
  engineDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 5px',
  },
  engineDetail: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    margin: 0,
    letterSpacing: '0.3px',
  },
  engineArrow: {
    position: 'absolute',
    right: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'rgba(255,255,255,0.2)',
    fontSize: 16,
  },
};
