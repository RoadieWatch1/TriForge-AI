import React from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

interface Props {
  onNavigate: (screen: string) => void;
}

const PLATFORMS = [
  { id: 'gmail',     label: 'Gmail',     note: 'Monitor and reply to email threads automatically.' },
  { id: 'linkedin',  label: 'LinkedIn',  note: 'Track DMs and connection requests.' },
  { id: 'instagram', label: 'Instagram', note: 'Manage comment replies and DMs.' },
];

export function InboxMode({ onNavigate: _onNavigate }: Props) {
  const systems = SYSTEM_REGISTRY.filter(s => s.modes.includes('inbox'));

  const extra = (
    <div style={styles.extraRoot}>
      <p style={styles.sectionLabel}>Platform Connections</p>
      <div style={styles.platformList}>
        {PLATFORMS.map(p => (
          <div key={p.id} style={styles.platformCard}>
            <div style={styles.platformInfo}>
              <span style={styles.platformName}>{p.label}</span>
              <span style={styles.platformNote}>{p.note}</span>
            </div>
            <button
              style={styles.connectBtn}
              onClick={() => console.log(`[InboxMode] stub: connect ${p.id}`)}
            >
              Connect
            </button>
          </div>
        ))}
      </div>
      <p style={styles.footNote}>
        Platform connections require OAuth setup. Inbox Agent will be available in an upcoming release.
      </p>
    </div>
  );

  return (
    <ModeShell
      title="Work Queue"
      subtitle="Monitor, reply, and follow up on platform messages — automatically."
      extra={extra}
    >
      {systems.map(s => (
        <SystemTile
          key={s.id}
          system={s}
          onAction={() => console.log('[InboxMode] stub: configure inbox agent')}
          actionLabel="Configure Agent"
        />
      ))}
    </ModeShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  extraRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  platformList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  platformCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
  },
  platformInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  platformName: {
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.65)',
  },
  platformNote: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
  },
  connectBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: 600,
    padding: '5px 14px',
    cursor: 'pointer',
  },
  footNote: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    margin: 0,
    lineHeight: 1.6,
  },
};
