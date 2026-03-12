import React, { useState, useEffect } from 'react';
import { ForgeEngine, UIEngineConfig } from './forge/ForgeEngine';

// ── Types ───────────────────────────────────────────────────────────────────

interface Props {
  tier: string;
  activeProfileId?: string | null;
  onProfileChange?: (id: string | null) => void;
  onSendToChat?: (prompt: string) => void;
  onUpgradeClick: () => void;
}

type EngineCategory = 'Tech & Digital' | 'Financial Services' | 'Local & Service' | 'Retail & Hospitality';

const CATEGORY_ORDER: EngineCategory[] = [
  'Tech & Digital',
  'Financial Services',
  'Local & Service',
  'Retail & Hospitality',
];

const CATEGORY_ACCENT: Record<EngineCategory, string> = {
  'Tech & Digital':       '#818cf8',
  'Financial Services':   '#34d399',
  'Local & Service':      '#fbbf24',
  'Retail & Hospitality': '#f87171',
};

// ── Component ───────────────────────────────────────────────────────────────

export function ForgeProfiles({ tier, onUpgradeClick }: Props) {
  const [engines, setEngines] = useState<UIEngineConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEngine, setSelectedEngine] = useState<UIEngineConfig | null>(null);

  useEffect(() => {
    (window as any).triforge.forgeEngine.listEngines()
      .then((list: UIEngineConfig[]) => {
        setEngines(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Free tier gate
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
          engineConfig={selectedEngine}
          onBack={() => setSelectedEngine(null)}
        />
      </div>
    );
  }

  // Group engines by category
  const byCategory = CATEGORY_ORDER.reduce<Record<string, UIEngineConfig[]>>((acc, cat) => {
    acc[cat] = engines.filter(e => e.category === cat);
    return acc;
  }, {});

  return (
    <div style={styles.root}>
      <div style={styles.pageHeader}>
        <p style={styles.pageTitle}>Business Engines</p>
        <p style={styles.pageSub}>
          Select an engine. Answer a few questions. The AI council builds your business.
        </p>
      </div>

      {loading ? (
        <div style={styles.loadingRow}>
          <div style={styles.loadingSpinner} />
          <p style={styles.loadingText}>Loading engines…</p>
        </div>
      ) : (
        <div style={styles.categoriesRoot}>
          {CATEGORY_ORDER.map(cat => {
            const catEngines = byCategory[cat];
            if (!catEngines || catEngines.length === 0) return null;
            const accent = CATEGORY_ACCENT[cat];
            return (
              <div key={cat} style={styles.categoryBlock}>
                <div style={styles.categoryHeader}>
                  <span style={{ ...styles.categoryAccent, background: accent }} />
                  <p style={styles.categoryLabel}>{cat}</p>
                </div>
                <div style={styles.engineGrid}>
                  {catEngines.map(engine => (
                    <button
                      key={engine.id}
                      style={styles.engineCard}
                      onClick={() => setSelectedEngine(engine)}
                    >
                      <span style={styles.engineIcon}>{engine.icon}</span>
                      <p style={styles.engineLabel}>{engine.name}</p>
                      <p style={styles.engineDesc}>{engine.description}</p>
                      <p style={styles.engineDetail}>{engine.detail}</p>
                      <span style={styles.engineArrow}>→</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '24px 0',
  },
  loadingSpinner: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    border: '2px solid rgba(99,102,241,0.2)',
    borderTop: '2px solid #818cf8',
    animation: 'spin 0.9s linear infinite',
    flexShrink: 0,
  },
  loadingText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  categoriesRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  categoryBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  categoryAccent: {
    width: 3,
    height: 13,
    borderRadius: 2,
    flexShrink: 0,
  },
  categoryLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    margin: 0,
  },
  engineGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  engineCard: {
    position: 'relative',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10,
    padding: '14px 20px 14px 58px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  engineIcon: {
    position: 'absolute',
    left: 16,
    top: 14,
    fontSize: 24,
  },
  engineLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: '0 0 2px',
  },
  engineDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    margin: '0 0 4px',
  },
  engineDetail: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.22)',
    margin: 0,
    letterSpacing: '0.3px',
  },
  engineArrow: {
    position: 'absolute',
    right: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'rgba(255,255,255,0.2)',
    fontSize: 15,
  },
};
