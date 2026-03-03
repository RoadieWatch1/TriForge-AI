import React, { useState } from 'react';
import type { MissionResult, MissionConfig, ProviderState } from './ForgeCommand';

interface Props {
  result: MissionResult;
  config: MissionConfig;
  providers: ProviderState[];
  onRerun: (adjustment: string, intensity: string) => void;
  onProceed: () => void;
}

// ── Confidence Meter ───────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const color =
    value >= 75 ? '#10b981' :
    value >= 50 ? '#f59e0b' :
    '#ef4444';
  return (
    <div style={cm.root}>
      <div style={cm.track}>
        <div style={{ ...cm.fill, width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span style={{ ...cm.label, color }}>{value}%</span>
    </div>
  );
}

const cm: Record<string, React.CSSProperties> = {
  root: { display: 'flex', alignItems: 'center', gap: 10 },
  track: {
    width: 120,
    height: 6,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3, transition: 'width 0.4s ease' },
  label: { fontSize: 14, fontWeight: 700, minWidth: 38 },
};

// ── Risk Badge ────────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: string }) {
  const color = risk === 'Low' ? '#10b981' : risk === 'High' ? '#ef4444' : '#f59e0b';
  const bg = risk === 'Low' ? 'rgba(16,185,129,0.1)' : risk === 'High' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)';
  return (
    <span style={{ ...rb.badge, color, background: bg, borderColor: `${color}30` }}>
      Risk: {risk.toUpperCase()}
    </span>
  );
}

const rb: Record<string, React.CSSProperties> = {
  badge: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    padding: '3px 10px',
    borderRadius: 5,
    border: '1px solid',
  },
};

// ── Provider Accordion ────────────────────────────────────────────────────────

function ProviderAccordion({ provider }: { provider: ProviderState }) {
  const [expanded, setExpanded] = useState(false);
  if (!provider.response) return null;

  return (
    <div style={pa.root}>
      <button style={pa.trigger} onClick={() => setExpanded(v => !v)}>
        <span style={{ ...pa.name, color: provider.color }}>{provider.name}</span>
        <span style={pa.role}>{provider.role}</span>
        <span style={pa.preview}>
          {expanded ? '' : provider.response.slice(0, 70).replace(/\n/g, ' ') + (provider.response.length > 70 ? '…' : '')}
        </span>
        <span style={pa.chevron}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={pa.body}>
          <p style={pa.text}>{provider.response}</p>
        </div>
      )}
    </div>
  );
}

const pa: Record<string, React.CSSProperties> = {
  root: {
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    overflow: 'hidden',
  },
  trigger: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  name: { fontSize: 12, fontWeight: 600, minWidth: 50 },
  role: { fontSize: 10, color: 'var(--text-muted)', minWidth: 70 },
  preview: { flex: 1, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  chevron: { fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 },
  body: { padding: '10px 12px', background: 'rgba(255,255,255,0.015)' },
  text: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
};

// ── Strategic Controls ────────────────────────────────────────────────────────

const CONTROLS: Array<{ label: string; adjustment: string; intensity: string }> = [
  { label: '+Aggression',       adjustment: 'Increase aggression weight significantly. Push for more aggressive recommendations.',    intensity: 'combative' },
  { label: '+Stability',        adjustment: 'Increase stability weight. Prioritize risk mitigation and conservative planning.',       intensity: 'analytical' },
  { label: '-Cost',             adjustment: 'Minimize complexity and operational cost. Optimize for lean execution.',                  intensity: 'cooperative' },
  { label: 'Claude Counter',    adjustment: 'CLAUDE DIRECTIVE: Argue the contrarian position. Challenge the consensus recommendation.', intensity: 'critical' },
  { label: 'Grok Push',         adjustment: 'GROK DIRECTIVE: Push maximum aggression alternative. No compromise on speed or scale.',   intensity: 'combative' },
];

// ── Main Component ─────────────────────────────────────────────────────────────

export function DecisionBoard({ result, config, providers, onRerun, onProceed }: Props) {
  const { synthesis, forgeScore, providerResponses } = result;
  const providersWithResponses = providers.filter(p => p.response);

  return (
    <div style={db.root}>
      {/* Score header */}
      <div style={db.scoreHeader}>
        <div style={db.scoreLeft}>
          <span style={db.scoreTitle}>Forge Recommendation</span>
          <div style={db.scoreMeta}>
            <span style={db.confidenceLabel}>Confidence</span>
            <ConfidenceMeter value={forgeScore.confidence} />
            <RiskBadge risk={forgeScore.risk} />
          </div>
        </div>
        <button style={db.proceedBtn} onClick={onProceed}>
          Proceed to Execution
        </button>
      </div>

      {/* Main split */}
      <div style={db.mainSplit}>
        {/* Synthesis */}
        <div style={db.synthesisPanel}>
          <div style={db.sectionLabel}>Synthesis</div>
          <div style={db.synthesisScroll}>
            <p style={db.synthesisText}>{synthesis}</p>
          </div>
        </div>

        {/* Council breakdown */}
        <div style={db.breakdownPanel}>
          <div style={db.sectionLabel}>Council Breakdown</div>
          <div style={db.accordionList}>
            {providersWithResponses.length > 0
              ? providersWithResponses.map(p => <ProviderAccordion key={p.name} provider={p} />)
              : providerResponses.map(r => (
                  <div key={r.provider} style={db.rawResponse}>
                    <span style={db.rawProvider}>{r.provider}</span>
                    <p style={db.rawText}>{r.text.slice(0, 200)}…</p>
                  </div>
                ))
            }
          </div>
        </div>
      </div>

      {/* Intelligence strip */}
      <div style={db.intelStrip}>
        {forgeScore.agreement && (
          <div style={db.intelRow}>
            <span style={db.intelLabel}>Alignment</span>
            <span style={db.intelText}>{forgeScore.agreement}</span>
          </div>
        )}
        {forgeScore.disagreement && (
          <div style={db.intelRow}>
            <span style={db.intelLabel}>Conflict Zones</span>
            <span style={{ ...db.intelText, ...db.conflictText }}>{forgeScore.disagreement}</span>
          </div>
        )}
        {forgeScore.assumptions && (
          <div style={db.intelRow}>
            <span style={db.intelLabel}>Assumptions</span>
            <span style={db.intelText}>{forgeScore.assumptions}</span>
          </div>
        )}
        {forgeScore.verify && (
          <div style={db.intelRow}>
            <span style={db.intelLabel}>Verify</span>
            <span style={db.intelText}>{forgeScore.verify}</span>
          </div>
        )}
      </div>

      {/* Strategic Controls */}
      <div style={db.controls}>
        <div style={db.controlsLabel}>Strategic Controls</div>
        <div style={db.controlsRow}>
          {CONTROLS.map(c => (
            <button
              key={c.label}
              style={db.controlBtn}
              onClick={() => onRerun(c.adjustment, c.intensity)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const db: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: '20px',
    overflow: 'auto',
  },
  scoreHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: '16px 20px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px 12px 0 0',
  },
  scoreLeft: { display: 'flex', flexDirection: 'column', gap: 10 },
  scoreTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  scoreMeta: { display: 'flex', alignItems: 'center', gap: 14 },
  confidenceLabel: { fontSize: 11, color: 'var(--text-muted)' },
  proceedBtn: {
    padding: '9px 20px',
    borderRadius: 7,
    background: 'var(--accent)',
    border: 'none',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  mainSplit: {
    display: 'flex',
    gap: 0,
    border: '1px solid rgba(255,255,255,0.08)',
    borderTop: 'none',
  },
  synthesisPanel: {
    flex: 1.6,
    padding: '16px',
    borderRight: '1px solid rgba(255,255,255,0.07)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  breakdownPanel: {
    flex: 1,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  synthesisScroll: {
    flex: 1,
    overflow: 'auto',
    maxHeight: 280,
  },
  synthesisText: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.65,
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  accordionList: { display: 'flex', flexDirection: 'column', gap: 5 },
  rawResponse: { padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  rawProvider: { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 },
  rawText: { fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 },
  intelStrip: {
    border: '1px solid rgba(255,255,255,0.08)',
    borderTop: 'none',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  intelRow: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  intelLabel: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    minWidth: 100,
    paddingTop: 1,
  },
  intelText: { fontSize: 12, color: 'var(--text-secondary)', flex: 1, lineHeight: 1.5 },
  conflictText: {
    color: 'rgba(251,191,36,0.9)',
    background: 'rgba(251,191,36,0.07)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  controls: {
    border: '1px solid rgba(255,255,255,0.08)',
    borderTop: 'none',
    borderRadius: '0 0 12px 12px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  controlsLabel: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  controlsRow: { display: 'flex', gap: 7, flexWrap: 'wrap' },
  controlBtn: {
    fontSize: 11,
    padding: '5px 12px',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
};
