import React from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

interface Props {
  onNavigate: (screen: string) => void;
}

export function OperatorMode({ onNavigate: _onNavigate }: Props) {
  const systems = SYSTEM_REGISTRY.filter(s => s.modes.includes('operator'));

  const extra = (
    <div style={styles.statusBar}>
      <span style={styles.statusLabel}>Next scheduled post:</span>
      <span style={styles.statusValue}>None configured</span>
    </div>
  );

  return (
    <ModeShell
      title="Operator Mode"
      subtitle="Run your active business — post content, reach out to leads, and follow up automatically."
      extra={extra}
    >
      {systems.map(s => (
        <SystemTile
          key={s.id}
          system={s}
          onAction={() => {
            console.log(`[OperatorMode] stub: ${s.id} action triggered`);
          }}
          actionLabel={
            s.id === 'social_poster'    ? 'Configure OAuth' :
            s.id === 'content_calendar' ? 'Create Calendar' :
            s.id === 'outreach_engine'  ? 'Set Up Outreach' :
            'Launch'
          }
        />
      ))}
    </ModeShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  statusValue: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
  },
};
