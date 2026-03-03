import React from 'react';

type BuilderScreen = 'home' | 'webapp' | 'marketing' | 'brand' | 'product' | 'fashion';

interface Props {
  onNavigate: (screen: BuilderScreen) => void;
  onBack: () => void;
}

const STUDIOS: Array<{
  id: BuilderScreen;
  title: string;
  description: string;
}> = [
  {
    id: 'webapp',
    title: 'Web & App Studio',
    description: 'UI mockups, landing pages, dashboards, and mobile screens. High-fidelity product-ready visuals.',
  },
  {
    id: 'marketing',
    title: 'Marketing Studio',
    description: 'Ad creatives, social posts, campaign posters, and promo graphics at agency quality.',
  },
  {
    id: 'brand',
    title: 'Brand Studio',
    description: 'Logo concepts, color palettes, typography direction, and identity boards.',
  },
  {
    id: 'product',
    title: 'Product Studio',
    description: 'Packaging mockups, product renders, merchandise visuals, and label concepts.',
  },
  {
    id: 'fashion',
    title: 'Fashion Studio',
    description: 'Outfit concepts, apparel collections, lookbook visuals, and editorial direction.',
  },
];

export function BuilderHome({ onNavigate, onBack }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>
          Back
        </button>
        <div>
          <p style={styles.title}>Creative Production Studio</p>
          <p style={styles.subtitle}>
            Structured visual execution — from UI concepts to brand identity. Every output is production-intent.
          </p>
        </div>
      </div>

      <div style={styles.grid}>
        {STUDIOS.map(studio => (
          <div key={studio.id} style={styles.card}>
            <div style={styles.cardText}>
              <p style={styles.cardTitle}>{studio.title}</p>
              <p style={styles.cardDesc}>{studio.description}</p>
            </div>
            <button
              style={styles.enterBtn}
              onClick={() => onNavigate(studio.id)}
            >
              Enter Studio
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    padding: '24px 24px 40px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
  },
  backBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: 700,
    padding: '6px 12px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
    marginTop: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: '4px 0 0',
    lineHeight: 1.6,
    maxWidth: 500,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 12,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '18px 18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    justifyContent: 'space-between',
  },
  cardText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: 0,
    letterSpacing: '0.1px',
  },
  cardDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.6,
  },
  enterBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: 600,
    padding: '8px 0',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'center',
    letterSpacing: '0.2px',
  },
};
