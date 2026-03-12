import React from 'react';
import type { ProviderState } from './ForgeCommand';
import type { AlignmentMatrix } from './ConsensusEngine';

interface Props {
  providers: ProviderState[];
  phase: string;
  objective: string;
  consensusScore?: number;
  alignmentMatrix?: AlignmentMatrix;
}

// ── Provider Panel ─────────────────────────────────────────────────────────────

function avgAlignment(name: string, matrix?: AlignmentMatrix): number {
  if (!matrix || !matrix[name]) return 0.5;
  const scores = Object.values(matrix[name]);
  if (scores.length === 0) return 0.5;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function ProviderPanel({
  provider,
  index,
  matrix,
}: {
  provider: ProviderState;
  index: number;
  matrix?: AlignmentMatrix;
}) {
  const isActive = provider.status === 'thinking' || provider.status === 'connecting';
  const isDone   = provider.status === 'complete';
  const isFailed = provider.status === 'failed';

  const avg = isDone ? avgAlignment(provider.name, matrix) : 0;
  const hasMatrix = isDone && matrix && Object.keys(matrix).length > 0;
  const highAlign = hasMatrix && avg >= 0.75;
  const lowAlign  = hasMatrix && avg < 0.55;

  return (
    <div
      style={{
        ...p.panel,
        borderColor: isDone
          ? (lowAlign ? 'rgba(245,158,11,0.4)' : `${provider.color}40`)
          : isFailed
            ? 'rgba(239,68,68,0.3)'
            : isActive
              ? `${provider.color}25`
              : 'rgba(255,255,255,0.07)',
        boxShadow: highAlign ? `0 0 0 1px ${provider.color}50` : undefined,
        animationDelay: `${index * 80}ms`,
      }}
    >
      {/* Panel header */}
      <div style={p.panelHeader}>
        <div style={p.nameRow}>
          <span style={{ ...p.providerName, color: provider.color }}>{provider.name}</span>
          <span style={{ ...p.roleBadge, borderColor: `${provider.color}30`, color: provider.color }}>
            {provider.role.toUpperCase()}
          </span>
        </div>
        <span style={p.personality}>{provider.personality}</span>
      </div>

      {/* Trust + Aggression */}
      {provider.trustScore > 0 && (
        <div style={p.metricsRow}>
          <div style={p.metricGroup}>
            <span style={p.metricLabel}>Trust</span>
            <div style={p.trustBar}>
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  style={{
                    ...p.trustSegment,
                    background: i <= Math.round(provider.trustScore / 20)
                      ? provider.color
                      : 'rgba(255,255,255,0.1)',
                  }}
                />
              ))}
            </div>
            <span style={p.metricValue}>{provider.trustScore}%</span>
          </div>
          <div style={p.metricGroup}>
            <span style={p.metricLabel}>Aggression</span>
            <div style={p.trustBar}>
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  style={{
                    ...p.trustSegment,
                    background: i <= provider.aggressionBias
                      ? provider.color
                      : 'rgba(255,255,255,0.1)',
                  }}
                />
              ))}
            </div>
            <span style={p.metricValue}>{provider.aggressionBias}/5</span>
          </div>
        </div>
      )}

      {/* Status + response area */}
      <div style={p.responseArea}>
        {provider.status === 'idle' || provider.status === 'connecting' ? (
          <div style={p.statusRow}>
            <div style={{ ...p.statusDot, background: provider.color }} />
            <span style={p.statusText}>Connecting…</span>
          </div>
        ) : provider.status === 'thinking' ? (
          <div style={p.statusRow}>
            <div style={p.thinkingDots}>
              <span style={{ ...p.dot, animationDelay: '0ms' }} />
              <span style={{ ...p.dot, animationDelay: '160ms' }} />
              <span style={{ ...p.dot, animationDelay: '320ms' }} />
            </div>
            <span style={p.statusText}>Analyzing…</span>
          </div>
        ) : provider.status === 'failed' ? (
          <span style={p.failedText}>Provider unavailable</span>
        ) : provider.response ? (
          <p style={p.responseText}>{provider.response.slice(0, 380)}{provider.response.length > 380 ? '…' : ''}</p>
        ) : (
          <div style={p.statusRow}>
            <div style={{ ...p.statusDot, background: provider.color, opacity: 0.6 }} />
            <span style={p.statusText}>Waiting…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pairwise Alignment Table ───────────────────────────────────────────────────

function AlignmentMatrixTable({ matrix, providers }: { matrix: AlignmentMatrix; providers: ProviderState[] }) {
  const names = providers.map(p => p.name).filter(n => matrix[n] !== undefined || Object.keys(matrix).some(k => matrix[k][n] !== undefined));

  if (names.length < 2) return null;

  const cellColor = (val: number | undefined): string => {
    if (val === undefined) return 'var(--text-muted)';
    if (val >= 0.75) return '#10b981';
    if (val >= 0.55) return 'var(--text-secondary)';
    return '#f59e0b';
  };

  return (
    <div style={am.root}>
      <div style={am.label}>Pairwise Alignment</div>
      <div style={am.tableWrap}>
        <table style={am.table}>
          <thead>
            <tr>
              <th style={am.th} />
              {names.map(n => (
                <th key={n} style={am.th}>
                  <span style={am.colHeader}>{n.slice(0, 6)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map(rowName => {
              const provColor = providers.find(p => p.name === rowName)?.color ?? 'var(--text-secondary)';
              return (
                <tr key={rowName}>
                  <td style={am.td}>
                    <span style={{ ...am.rowHeader, color: provColor }}>{rowName.slice(0, 6)}</span>
                  </td>
                  {names.map(colName => {
                    if (rowName === colName) {
                      return <td key={colName} style={am.td}><span style={am.dash}>—</span></td>;
                    }
                    const val = matrix[rowName]?.[colName];
                    return (
                      <td key={colName} style={am.td}>
                        <span style={{ ...am.cell, color: cellColor(val) }}>
                          {val !== undefined ? val.toFixed(2) : '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const am: Record<string, React.CSSProperties> = {
  root: {
    marginTop: 10,
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 7,
  },
  label: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 8,
  },
  tableWrap: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%' },
  th: { padding: '2px 8px', textAlign: 'center' },
  td: { padding: '2px 8px', textAlign: 'center' },
  colHeader: { fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em' },
  rowHeader: { fontSize: 9, fontWeight: 600, letterSpacing: '0.05em' },
  cell: { fontSize: 10, fontVariantNumeric: 'tabular-nums' },
  dash: { fontSize: 10, color: 'rgba(255,255,255,0.15)' },
};

// ── Main Component ─────────────────────────────────────────────────────────────

export function CouncilView({ providers, phase, objective, consensusScore, alignmentMatrix }: Props) {
  const score = consensusScore ?? 0;
  const alignmentAchieved = score >= 70;

  const phaseLabel =
    phase === 'assembling'   ? 'Council Assembling…' :
    phase === 'debating'     ? 'Council in Session — Analyzing Mission' :
    phase === 'synthesizing' ? 'Synthesizing Strategic Recommendation…' :
    '';

  return (
    <div style={cv.root}>
      {/* Mission objective strip */}
      <div style={cv.objectiveStrip}>
        <span style={cv.objectiveLabel}>Mission</span>
        <span style={cv.objectiveText}>
          {objective.slice(0, 90)}{objective.length > 90 ? '…' : ''}
        </span>
      </div>

      {/* Council grid */}
      <div style={cv.grid}>
        {providers.map((prov, i) => (
          <ProviderPanel key={prov.name} provider={prov} index={i} matrix={alignmentMatrix} />
        ))}
      </div>

      {/* Alignment strip */}
      <div style={cv.alignmentStrip}>
        <div style={cv.alignmentRow}>
          <span style={cv.alignmentLabel}>Council Alignment</span>
          <div style={cv.alignmentBar}>
            <div
              style={{
                ...cv.alignmentFill,
                width: score > 0 ? `${score}%` : '30%',
                background: alignmentAchieved
                  ? 'linear-gradient(to right, #10b981, #059669)'
                  : score >= 50
                    ? 'linear-gradient(to right, #f59e0b, #d97706)'
                    : 'linear-gradient(to right, #ef4444, #dc2626)',
                transition: 'width 0.6s ease',
                animation: score === 0 ? 'alignPulse 2s ease-in-out infinite' : 'none',
              }}
            />
          </div>
          {score > 0 && (
            <span style={{ ...cv.scoreText, color: alignmentAchieved ? '#10b981' : '#f59e0b' }}>
              {score}%
            </span>
          )}
        </div>

        <div style={cv.phaseRow}>
          {alignmentAchieved ? (
            <span style={cv.achievedLabel}>Council Alignment Achieved</span>
          ) : (
            <span style={cv.phaseLabel}>{phaseLabel}</span>
          )}
        </div>

        {/* Pairwise alignment matrix */}
        {alignmentMatrix && Object.keys(alignmentMatrix).length >= 2 && (
          <AlignmentMatrixTable matrix={alignmentMatrix} providers={providers} />
        )}
      </div>

      <style>{`
        @keyframes panelIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40%            { opacity: 1;   transform: scale(1); }
        }
        @keyframes alignPulse {
          0%, 100% { width: 20%; }
          50%       { width: 45%; }
        }
        @keyframes connectPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Panel Styles ───────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  panel: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    animation: 'panelIn 0.4s ease both',
    transition: 'border-color 0.3s, box-shadow 0.3s',
  },
  panelHeader: { display: 'flex', flexDirection: 'column', gap: 4 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 8 },
  providerName: { fontSize: 14, fontWeight: 600 },
  roleBadge: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    border: '1px solid',
    padding: '1px 6px',
    borderRadius: 3,
  },
  personality: { fontSize: 10, color: 'var(--text-muted)' },
  metricsRow: { display: 'flex', gap: 16 },
  metricGroup: { display: 'flex', alignItems: 'center', gap: 5, flex: 1 },
  metricLabel: { fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' },
  trustBar: { display: 'flex', gap: 2, flex: 1 },
  trustSegment: { flex: 1, height: 4, borderRadius: 2, transition: 'background 0.3s' },
  metricValue: { fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' },
  responseArea: {
    flex: 1,
    minHeight: 60,
    display: 'flex',
    alignItems: 'flex-start',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8 },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    animation: 'connectPulse 1.4s ease-in-out infinite',
    flexShrink: 0,
  },
  statusText: { fontSize: 12, color: 'var(--text-muted)' },
  thinkingDots: { display: 'flex', gap: 3 },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'var(--text-muted)',
    display: 'inline-block',
    animation: 'dotPulse 1.4s ease-in-out infinite both',
  },
  failedText: { fontSize: 12, color: '#ef4444' },
  responseText: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.55,
    margin: 0,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 7,
    WebkitBoxOrient: 'vertical',
  },
};

// ── Council View Styles ────────────────────────────────────────────────────────

const cv: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: '20px',
    height: '100%',
    boxSizing: 'border-box',
  },
  objectiveStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    marginBottom: 16,
  },
  objectiveLabel: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  objectiveText: { fontSize: 12, color: 'var(--text-secondary)' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    flex: 1,
    alignContent: 'start',
  },
  alignmentStrip: {
    marginTop: 16,
    padding: '14px 16px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  alignmentRow: { display: 'flex', alignItems: 'center', gap: 12 },
  alignmentLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    minWidth: 130,
  },
  alignmentBar: {
    flex: 1,
    height: 6,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  alignmentFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.6s ease',
  },
  scoreText: { fontSize: 12, fontWeight: 600, minWidth: 34, textAlign: 'right' },
  phaseRow: { display: 'flex', justifyContent: 'center' },
  phaseLabel: { fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' },
  achievedLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#10b981',
    letterSpacing: '0.04em',
  },
};
