import React, { useState } from 'react';
import type { ConflictZone } from './ConsensusEngine';
import type { ProviderState } from './ForgeCommand';

interface Props {
  zones: ConflictZone[];
  providers: ProviderState[];
  onResolveConflict: (zone: ConflictZone) => void;
  onRerunWithBias: (adjustment: string, intensity: string) => void;
  divergenceIndex: number;
  isResolving?: boolean;
}

function divColor(score: number): string {
  if (score < 25) return '#10b981';
  if (score < 50) return '#f59e0b';
  return '#ef4444';
}

function ZoneRow({
  zone,
  providers,
  onResolveConflict,
  onRerunWithBias,
}: {
  zone: ConflictZone;
  providers: ProviderState[];
  onResolveConflict: (zone: ConflictZone) => void;
  onRerunWithBias: (adjustment: string, intensity: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pA, pB] = zone.providers;
  const colorA = providers.find(p => p.name === pA)?.color ?? 'var(--text-secondary)';
  const colorB = providers.find(p => p.name === pB)?.color ?? 'var(--text-secondary)';
  const dc = divColor(zone.divergenceScore);

  return (
    <div style={cz.zone}>
      <button style={cz.zoneTrigger} onClick={() => setExpanded(v => !v)}>
        <span style={cz.zoneWarn}>⚠</span>
        <span style={cz.zoneIssue}>{zone.issue}</span>
        <span style={{ ...cz.divBadge, color: dc, borderColor: `${dc}40` }}>
          div: {zone.divergenceScore}%
        </span>
        <span style={cz.chevron}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={cz.zoneBody}>
          {/* Stances */}
          <div style={cz.stanceRow}>
            <span style={{ ...cz.stanceName, color: colorA }}>{pA}:</span>
            <span style={cz.stanceText}>"{zone.stances[pA]}"</span>
          </div>
          <div style={cz.stanceRow}>
            <span style={{ ...cz.stanceName, color: colorB }}>{pB}:</span>
            <span style={cz.stanceText}>"{zone.stances[pB]}"</span>
          </div>

          {/* Actions */}
          <div style={cz.zoneActions}>
            <button
              style={{ ...cz.resolveBtn, ...cz.resolvePrimary }}
              onClick={() => onResolveConflict(zone)}
            >
              Force Resolution
            </button>
            <button
              style={cz.resolveBtn}
              onClick={() =>
                onRerunWithBias(
                  `${pA.toUpperCase()} DIRECTIVE: Defend and strengthen your position on ${zone.issue}. Do not concede.`,
                  'critical'
                )
              }
            >
              {pA} Defends
            </button>
            <button
              style={cz.resolveBtn}
              onClick={() =>
                onRerunWithBias(
                  `${pB.toUpperCase()} DIRECTIVE: Defend and strengthen your position on ${zone.issue}. Do not concede.`,
                  'combative'
                )
              }
            >
              {pB} Defends
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConflictZonePanel({
  zones,
  providers,
  onResolveConflict,
  onRerunWithBias,
  divergenceIndex,
  isResolving,
}: Props) {
  if (zones.length === 0) return null;

  const dc = divColor(divergenceIndex);

  return (
    <div style={cz.root}>
      <div style={cz.header}>
        <span style={cz.sectionLabel}>Conflict Zones</span>
        <div style={cz.divIndexRow}>
          <span style={cz.divLabel}>divergence index</span>
          <span style={{ ...cz.divValue, color: dc }}>{divergenceIndex}%</span>
          {isResolving && <span style={cz.resolvingLabel}>Resolving…</span>}
        </div>
      </div>

      <div style={cz.zoneList}>
        {zones.map((zone, i) => (
          <ZoneRow
            key={i}
            zone={zone}
            providers={providers}
            onResolveConflict={onResolveConflict}
            onRerunWithBias={onRerunWithBias}
          />
        ))}
      </div>
    </div>
  );
}

const cz: Record<string, React.CSSProperties> = {
  root: {
    padding: '12px 14px',
    background: 'rgba(245,158,11,0.04)',
    border: '1px solid rgba(245,158,11,0.15)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: {
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
  divIndexRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  divLabel: {
    fontSize: 9,
    color: 'var(--text-muted)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  divValue: {
    fontSize: 11,
    fontWeight: 700,
  },
  resolvingLabel: {
    fontSize: 10,
    color: '#f59e0b',
    marginLeft: 6,
  },
  zoneList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  zone: {
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  zoneTrigger: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 10px',
    background: 'rgba(255,255,255,0.02)',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  zoneWarn: {
    fontSize: 11,
    color: '#f59e0b',
    flexShrink: 0,
  },
  zoneIssue: {
    flex: 1,
    fontSize: 12,
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  divBadge: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '2px 7px',
    borderRadius: 4,
    border: '1px solid',
    whiteSpace: 'nowrap',
  },
  chevron: {
    fontSize: 9,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  zoneBody: {
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.015)',
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  stanceRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
  },
  stanceName: {
    fontSize: 11,
    fontWeight: 600,
    minWidth: 50,
    flexShrink: 0,
    paddingTop: 1,
  },
  stanceText: {
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    fontStyle: 'italic',
  },
  zoneActions: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  resolveBtn: {
    fontSize: 10,
    padding: '4px 10px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  resolvePrimary: {
    background: 'rgba(245,158,11,0.1)',
    border: '1px solid rgba(245,158,11,0.25)',
    color: '#f59e0b',
  },
};
