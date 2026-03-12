import React, { useState } from 'react';
import type { MissionConfig, SavedMission } from './ForgeCommand';
import { loadBaselineBias } from './ForgeContextStore';

interface Props {
  onLaunch: (config: MissionConfig) => void;
  keyStatus: Record<string, boolean>;
  tier: string;
  savedMissions: SavedMission[];
  onLoadMission: (objective: string) => void;
}

function SliderField({
  label,
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  lowLabel?: string;
  highLabel?: string;
}) {
  return (
    <div style={sf.sliderGroup}>
      <div style={sf.sliderHeader}>
        <span style={sf.sliderLabel}>{label}</span>
        <span style={sf.sliderValue}>{value}</span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={sf.range}
      />
      {(lowLabel || highLabel) && (
        <div style={sf.sliderHints}>
          <span style={sf.hint}>{lowLabel}</span>
          <span style={sf.hint}>{highLabel}</span>
        </div>
      )}
    </div>
  );
}

export function MissionBriefing({ onLaunch, keyStatus, tier, savedMissions, onLoadMission }: Props) {
  const [objective, setObjective] = useState('');
  const [constraints, setConstraints] = useState('');
  const [riskTolerance,   setRiskTolerance]   = useState(() => Math.round(loadBaselineBias().riskTolerance * 4 + 1));
  const [aggressionLevel, setAggressionLevel] = useState(() => Math.round(loadBaselineBias().aggression    * 4 + 1));
  const [speedVsDepth,    setSpeedVsDepth]    = useState(() => Math.round(loadBaselineBias().speedVsDepth  * 4 + 1));
  const [budgetSensitivity, setBudgetSensitivity] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [objectiveError, setObjectiveError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const activeProviders = Object.entries(keyStatus)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const handleLaunch = () => {
    if (!objective.trim()) {
      setObjectiveError('Mission objective is required.');
      return;
    }
    setObjectiveError('');
    onLaunch({ objective: objective.trim(), constraints: constraints.trim(), riskTolerance, aggressionLevel, speedVsDepth, budgetSensitivity });
  };

  const loadMission = (m: SavedMission) => {
    setObjective(m.objective);
    setShowHistory(false);
    onLoadMission(m.objective);
  };

  const providerNames = activeProviders
    .filter(p => ['claude', 'openai', 'grok'].includes(p.toLowerCase()))
    .map(p => p.charAt(0).toUpperCase() + p.slice(1));

  return (
    <div style={s.root}>
      <div style={s.card}>
        {/* Header row */}
        <div style={s.cardHeader}>
          <div>
            <div style={s.cardTitle}>Mission Briefing</div>
            <div style={s.cardSubtitle}>Define your strategic objective. The AI Council will deliberate.</div>
          </div>
          {savedMissions.length > 0 && (
            <button style={s.historyBtn} onClick={() => setShowHistory(v => !v)}>
              {showHistory ? 'Hide History' : `History (${savedMissions.length})`}
            </button>
          )}
        </div>

        {/* Mission history */}
        {showHistory && savedMissions.length > 0 && (
          <div style={s.historyPanel}>
            <div style={s.historyLabel}>Recent Missions</div>
            <div style={s.historyList}>
              {savedMissions.map(m => (
                <button key={m.id} style={s.historyItem} onClick={() => loadMission(m)}>
                  <span style={s.historyObj}>{m.objective.slice(0, 55)}{m.objective.length > 55 ? '…' : ''}</span>
                  <span style={{ ...s.historyBadge, color: riskColor(m.risk) }}>{m.risk} · {m.confidence}%</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={s.divider} />

        {/* Objective */}
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Objective <span style={s.required}>*</span></label>
          <textarea
            style={{ ...s.textarea, ...(objectiveError ? s.textareaError : {}) }}
            placeholder="Describe your strategic mission or business objective…"
            rows={3}
            value={objective}
            onChange={e => { setObjective(e.target.value); if (objectiveError) setObjectiveError(''); }}
          />
          {objectiveError && <span style={s.errorText}>{objectiveError}</span>}
        </div>

        {/* Constraints */}
        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Constraints <span style={s.optional}>(optional)</span></label>
          <textarea
            style={s.textarea}
            placeholder="Budget limits, regulatory requirements, timeline constraints…"
            rows={2}
            value={constraints}
            onChange={e => setConstraints(e.target.value)}
          />
        </div>

        <div style={s.divider} />

        {/* Sliders */}
        <div style={s.sliderRow}>
          <SliderField
            label="Risk Tolerance"
            value={riskTolerance}
            onChange={setRiskTolerance}
            lowLabel="Conservative"
            highLabel="Bold"
          />
          <SliderField
            label="Aggression Level"
            value={aggressionLevel}
            onChange={setAggressionLevel}
            lowLabel="Measured"
            highLabel="Maximum"
          />
        </div>
        <div style={s.sliderRow}>
          <SliderField
            label="Speed vs Depth"
            value={speedVsDepth}
            onChange={setSpeedVsDepth}
            lowLabel="Deep analysis"
            highLabel="Fast execution"
          />
          <div style={sf.sliderGroup}>
            <div style={sf.sliderHeader}>
              <span style={sf.sliderLabel}>Budget Sensitivity</span>
            </div>
            <select
              value={budgetSensitivity}
              onChange={e => setBudgetSensitivity(e.target.value as 'Low' | 'Medium' | 'High')}
              style={s.select}
            >
              <option value="Low">Low — cost is no constraint</option>
              <option value="Medium">Medium — optimize where possible</option>
              <option value="High">High — minimize spend</option>
            </select>
          </div>
        </div>

        <div style={s.divider} />

        {/* Council status */}
        <div style={s.councilRow}>
          <span style={s.councilLabel}>Council</span>
          {providerNames.length > 0 ? (
            <div style={s.councilProviders}>
              {providerNames.map(p => (
                <span key={p} style={{ ...s.providerChip, color: PROVIDER_COLOR[p] ?? 'var(--text-secondary)' }}>
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <span style={s.noProviders}>No providers configured</span>
          )}
          {providerNames.length < 2 && (
            <span style={s.councilWarning}>Add API keys in Settings for full council</span>
          )}
        </div>

        <div style={s.divider} />

        {/* Cost note */}
        <div style={s.costRow}>
          <span style={s.costLabel}>
            {providerNames.length >= 3 ? 'Multi-provider council — moderate cost' :
             providerNames.length === 2 ? 'Dual-provider analysis — light cost' :
             'Single provider — minimal cost'}
          </span>
          <span style={s.costNote}>Actual cost varies by provider and objective length.</span>
        </div>

        {/* Launch */}
        <button
          style={{ ...s.launchBtn, ...(objective.trim() ? {} : s.launchBtnDisabled) }}
          onClick={handleLaunch}
        >
          Launch Mission
        </button>
      </div>
    </div>
  );
}

const PROVIDER_COLOR: Record<string, string> = {
  Claude: '#8b5cf6',
  OpenAI: '#10b981',
  Grok:   '#3b82f6',
};

function riskColor(risk: string): string {
  if (risk === 'Low') return '#10b981';
  if (risk === 'High') return '#ef4444';
  return '#f59e0b';
}

// Slider sub-styles
const sf: Record<string, React.CSSProperties> = {
  sliderGroup: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  sliderHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' },
  sliderValue: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 16, textAlign: 'right' },
  range: { width: '100%', accentColor: 'var(--accent)', cursor: 'pointer', height: 4 },
  sliderHints: { display: 'flex', justifyContent: 'space-between' },
  hint: { fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 },
};

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    justifyContent: 'center',
    padding: '24px 20px',
    overflow: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: 680,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  historyBtn: {
    fontSize: 11,
    padding: '5px 12px',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  historyPanel: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 12,
  },
  historyLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 8,
  },
  historyList: { display: 'flex', flexDirection: 'column', gap: 4 },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: 5,
    background: 'transparent',
    border: '1px solid transparent',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.15s',
  },
  historyObj: { fontSize: 12, color: 'var(--text-secondary)' },
  historyBadge: { fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap', marginLeft: 8 },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '16px 0' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' },
  required: { color: '#ef4444', marginLeft: 2 },
  optional: { color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-primary)',
    fontSize: 13,
    lineHeight: 1.5,
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textareaError: { borderColor: 'rgba(239,68,68,0.5)' },
  errorText: { fontSize: 11, color: '#ef4444' },
  sliderRow: {
    display: 'flex',
    gap: 24,
    marginBottom: 16,
  },
  select: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 7,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-primary)',
    fontSize: 12,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  councilRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  councilLabel: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' },
  councilProviders: { display: 'flex', gap: 8 },
  providerChip: { fontSize: 12, fontWeight: 500 },
  noProviders: { fontSize: 12, color: 'var(--text-muted)' },
  councilWarning: {
    fontSize: 11,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.08)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  costRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 },
  costLabel: { fontSize: 11, color: 'var(--text-secondary)' },
  costNote: { fontSize: 10, color: 'var(--text-muted)' },
  launchBtn: {
    width: '100%',
    padding: '13px',
    borderRadius: 8,
    background: 'var(--accent)',
    border: 'none',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  launchBtnDisabled: { opacity: 0.5, cursor: 'default' },
};
