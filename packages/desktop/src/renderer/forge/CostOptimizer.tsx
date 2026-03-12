import React from 'react';
import type { CostEstimate } from './ConsensusEngine';

interface Props {
  estimate: CostEstimate;
}

function formatCost(cents: number): string {
  // cents → dollars, 3 decimal places
  return `$${(cents / 100).toFixed(3)}`;
}

function CostBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={co.barTrack}>
      <div
        style={{
          ...co.barFill,
          width: `${pct}%`,
          background: color,
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

export function CostOptimizer({ estimate }: Props) {
  const { fullCouncilCost, singleProviderCost, optimizedCost, savingsPercent, qualityTradeoff } = estimate;
  const maxCost = Math.max(fullCouncilCost, singleProviderCost, optimizedCost, 0.001);

  const savingsColor = savingsPercent >= 30 ? '#10b981' : savingsPercent >= 15 ? '#f59e0b' : 'var(--text-muted)';

  return (
    <div style={co.root}>
      <div style={co.header}>
        <span style={co.sectionLabel}>Cost Analysis</span>
        {savingsPercent > 0 && (
          <span style={{ ...co.savingsBadge, color: savingsColor }}>
            save up to {savingsPercent}% optimized
          </span>
        )}
      </div>

      <div style={co.rows}>
        <div style={co.costRow}>
          <span style={co.rowLabel}>Full Council</span>
          <CostBar value={fullCouncilCost} max={maxCost} color="rgba(139,92,246,0.7)" />
          <span style={co.costValue}>{formatCost(fullCouncilCost)}</span>
        </div>
        <div style={co.costRow}>
          <span style={co.rowLabel}>Single Model</span>
          <CostBar value={singleProviderCost} max={maxCost} color="rgba(16,185,129,0.7)" />
          <span style={co.costValue}>{formatCost(singleProviderCost)}</span>
        </div>
        <div style={co.costRow}>
          <span style={co.rowLabel}>Optimized</span>
          <CostBar value={optimizedCost} max={maxCost} color="rgba(59,130,246,0.7)" />
          <span style={{ ...co.costValue, color: savingsColor }}>{formatCost(optimizedCost)}</span>
        </div>
      </div>

      {qualityTradeoff && (
        <p style={co.tradeoff}>{qualityTradeoff}</p>
      )}
    </div>
  );
}

const co: Record<string, React.CSSProperties> = {
  root: {
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
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
  savingsBadge: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  costRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
    minWidth: 90,
  },
  barTrack: {
    flex: 1,
    height: 6,
    background: 'rgba(255,255,255,0.07)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  costValue: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    minWidth: 42,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  tradeoff: {
    margin: 0,
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 5,
    borderLeft: '2px solid rgba(255,255,255,0.08)',
  },
};
