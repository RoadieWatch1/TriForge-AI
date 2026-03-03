import React, { useState } from 'react';

export interface Asset {
  url: string;
  label: string;
  plan: string;
}

interface Props {
  assets: Asset[];
}

export function AssetGrid({ assets }: Props) {
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  if (assets.length === 0) return null;

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div style={styles.root}>
      <p style={styles.sectionLabel}>Generated Assets</p>
      <div style={styles.grid}>
        {assets.map((asset, i) => (
          <div key={i} style={styles.card}>
            <div style={styles.thumbWrapper}>
              <img src={asset.url} alt={asset.label} style={styles.thumb} />
            </div>
            <p style={styles.assetLabel}>{asset.label}</p>
            <div style={styles.assetActions}>
              <button
                style={styles.assetBtn}
                onClick={() => window.triforge.system.openExternal(asset.url)}
              >
                Download
              </button>
              <button
                style={styles.assetBtn}
                onClick={() => setExpandedPlan(expandedPlan === i ? null : i)}
              >
                {expandedPlan === i ? 'Close Plan' : 'Impl. Plan'}
              </button>
            </div>
            {expandedPlan === i && (
              <div style={styles.planPanel}>
                <div style={styles.planHeader}>
                  <p style={styles.planLabel}>Implementation Plan</p>
                  <button
                    style={styles.copyBtn}
                    onClick={() => handleCopy(asset.plan, i)}
                  >
                    {copied === i ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre style={styles.planText}>{asset.plan}</pre>
              </div>
            )}
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
    gap: 10,
    paddingTop: 8,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 10,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
  },
  thumbWrapper: {
    width: '100%',
    aspectRatio: '1 / 1',
    overflow: 'hidden',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.02)',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  assetLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.55)',
    margin: 0,
    lineHeight: 1.4,
  },
  assetActions: {
    display: 'flex',
    gap: 5,
  },
  assetBtn: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontWeight: 600,
    padding: '4px 6px',
    cursor: 'pointer',
    textAlign: 'center',
  },
  planPanel: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 5,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  planHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    margin: 0,
  },
  copyBtn: {
    background: 'transparent',
    border: 'none',
    color: '#60a5fa',
    fontSize: 9,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
  },
  planText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    margin: 0,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'monospace',
  },
};
