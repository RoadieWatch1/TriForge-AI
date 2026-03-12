import React from 'react';
import type { ProviderState } from './ForgeCommand';

interface Props {
  influenceMap: Record<string, number>;
  providers: ProviderState[];
  isRealigning?: boolean;
  label?: string;
}

export function InfluencePanel({ influenceMap, providers, isRealigning, label }: Props) {
  const listed = providers.filter(p => influenceMap[p.name] !== undefined);

  return (
    <div style={ip.root}>
      <div style={ip.headerRow}>
        <span style={ip.sectionLabel}>Council Influence</span>
        {isRealigning && (
          <span style={ip.realigningLabel}>{label ?? 'Council Realigning…'}</span>
        )}
      </div>

      <div style={ip.barList}>
        {listed.map(p => {
          const pct = influenceMap[p.name] ?? 0;
          return (
            <div key={p.name} style={ip.barRow}>
              <span style={{ ...ip.providerName, color: p.color }}>{p.name}</span>
              <div style={ip.trackOuter}>
                <div
                  style={{
                    ...ip.trackFill,
                    width: `${pct}%`,
                    background: isRealigning
                      ? `linear-gradient(90deg, ${p.color}80, ${p.color})`
                      : p.color,
                    transition: 'width 0.5s ease',
                    animation: isRealigning ? 'influenceShimmer 1.2s ease-in-out infinite' : 'none',
                  }}
                />
              </div>
              <span style={{ ...ip.pctLabel, color: isRealigning ? '#f59e0b' : p.color }}>
                {pct}%
              </span>
              <span style={ip.roleLabel}>{p.role}</span>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes influenceShimmer {
          0%, 100% { opacity: 0.6; }
          50%       { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const ip: Record<string, React.CSSProperties> = {
  root: {
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  realigningLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#f59e0b',
    letterSpacing: '0.04em',
  },
  barList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  providerName: {
    fontSize: 12,
    fontWeight: 600,
    minWidth: 52,
  },
  trackOuter: {
    flex: 1,
    height: 6,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 3,
  },
  pctLabel: {
    fontSize: 11,
    fontWeight: 600,
    minWidth: 32,
    textAlign: 'right',
  },
  roleLabel: {
    fontSize: 10,
    color: 'var(--text-muted)',
    minWidth: 68,
  },
};
