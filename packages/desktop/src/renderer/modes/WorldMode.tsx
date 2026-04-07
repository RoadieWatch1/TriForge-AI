import React, { useState } from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

interface Props {
  onNavigate: (screen: string) => void;
}

export function WorldMode({ onNavigate: _onNavigate }: Props) {
  const systems = SYSTEM_REGISTRY.filter(s => s.modes.includes('world'));
  const [interests, setInterests] = useState('');

  const extra = (
    <div style={styles.extraRoot}>
      {/* Morning Brief placeholder */}
      <div style={styles.briefSection}>
        <p style={styles.sectionLabel}>Morning Brief</p>
        <div style={styles.briefGrid}>
          {PLACEHOLDER_TOPICS.map((t, i) => (
            <div key={i} style={styles.briefCard}>
              <p style={styles.briefCategory}>{t.category}</p>
              <p style={styles.briefHeadline}>{t.headline}</p>
            </div>
          ))}
        </div>
        <p style={styles.briefNote}>Feed not configured. Activate World Feed Engine to receive live briefings.</p>
      </div>

      {/* Interest input */}
      <div style={styles.interestSection}>
        <p style={styles.sectionLabel}>Your Topics</p>
        <div style={styles.interestRow}>
          <input
            style={styles.interestInput}
            placeholder="e.g. AI, real estate, crypto, sports"
            value={interests}
            onChange={e => setInterests(e.target.value)}
          />
          <button
            style={styles.saveBtn}
            onClick={() => console.log('[WorldMode] stub: save interests', interests)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <ModeShell
      title="World Feed"
      subtitle="Stay informed — receive daily briefings on topics that matter to your business."
      extra={extra}
    >
      {systems.map(s => (
        <SystemTile
          key={s.id}
          system={s}
          onAction={() => console.log('[WorldMode] stub: configure world feed')}
          actionLabel="Configure Feed"
        />
      ))}
    </ModeShell>
  );
}

const PLACEHOLDER_TOPICS = [
  { category: 'Markets', headline: 'Feed not active — configure interests to receive market updates.' },
  { category: 'Industry', headline: 'Industry news will appear here once the World Feed Engine is connected.' },
  { category: 'Politics', headline: 'Political and regulatory updates relevant to your sector will appear here.' },
];

const styles: Record<string, React.CSSProperties> = {
  extraRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  } as React.CSSProperties,
  briefSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  } as React.CSSProperties,
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  briefGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as React.CSSProperties,
  briefCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  } as React.CSSProperties,
  briefCategory: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    margin: 0,
  },
  briefHeadline: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.5,
    fontStyle: 'italic',
  },
  briefNote: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    margin: 0,
    lineHeight: 1.5,
  },
  interestSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,
  interestRow: {
    display: 'flex',
    gap: 8,
  },
  interestInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  saveBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: 600,
    padding: '7px 16px',
    cursor: 'pointer',
  },
};
