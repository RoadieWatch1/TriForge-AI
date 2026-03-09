// ── VibeCoding.tsx — Council-guided aesthetic-to-implementation translation ───
//
// Advisory-first: produces build plans, patch plans, system decisions, and
// consistency audits. Does NOT silently rewrite files.

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types (mirrored from engine — renderer cannot import engine directly) ─────

type VibeMode = 'explore' | 'refine' | 'build' | 'audit' | 'rescue';

interface VibeProfile {
  id: string;
  name: string;
  ventureId?: string;
  mode: VibeMode;
  axes: Record<string, number>;
  anchors: unknown[];
  history: unknown[];
  createdAt: number;
}

interface VibeCouncilPosition {
  role: string;
  provider: string;
  decisions: unknown[];
  confidence: number;
  reasoning: string;
}

interface VibeBuildPlan {
  decisions: unknown[];
  componentTargets: Array<{ component: string; priority: string; changes: string[] }>;
  styleChanges: Array<{ selector: string; property: string; from: string; to: string }>;
  copyChanges: Array<{ location: string; from: string; to: string; toneShift: string }>;
  guardrailViolations: string[];
  scope: string;
}

interface VibeOutcomeScore {
  trust: number;
  conversion: number;
  usability: number;
  clarity: number;
  overall: number;
}

interface VibeCouncilResult {
  signals: unknown[];
  positions: VibeCouncilPosition[];
  synthesizedDecisions: unknown[];
  plan: VibeBuildPlan;
  consistency?: { overallScore: number; violations: Array<{ dimension: string; severity: string; description: string; suggestion: string }> };
  outcomeScore: VibeOutcomeScore;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface VibeCodingProps {
  tier: string;
  onUpgradeClick?: () => void;
}

// ── Dimension display names ──────────────────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  layout: 'Layout',
  typography: 'Typography',
  spacing: 'Spacing',
  motion: 'Motion',
  color: 'Color',
  copy_tone: 'Copy Tone',
  cta_style: 'CTA Style',
  trust_indicators: 'Trust Indicators',
  imagery: 'Imagery',
  density: 'Density',
};

const MODE_LABELS: Record<VibeMode, string> = {
  explore: 'Explore',
  refine: 'Refine',
  build: 'Build',
  audit: 'Audit',
  rescue: 'Rescue',
};

const MODE_DESCRIPTIONS: Record<VibeMode, string> = {
  explore: 'Explore aesthetic directions',
  refine: 'Polish and tune the current vibe',
  build: 'Generate a concrete build plan',
  audit: 'Audit product against vibe profile',
  rescue: 'Aggressive fix for consistency issues',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function VibeCoding({ tier, onUpgradeClick }: VibeCodingProps) {
  const [profiles, setProfiles] = useState<VibeProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<VibeProfile | null>(null);
  const [mode, setMode] = useState<VibeMode>('explore');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressPhase, setProgressPhase] = useState<string | null>(null);
  const [result, setResult] = useState<VibeCouncilResult | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [showNewProfile, setShowNewProfile] = useState(false);
  const progressCleanup = useRef<(() => void) | null>(null);

  // ── Tier gate ─────────────────────────────────────────────────────────────
  const locked = tier === 'free';

  // ── Load profiles on mount ────────────────────────────────────────────────
  const loadProfiles = useCallback(async () => {
    if (locked) return;
    const res = await (window as any).triforge.vibe.listProfiles();
    if (res.ok && res.profiles) setProfiles(res.profiles);
  }, [locked]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  // ── Progress listener ─────────────────────────────────────────────────────
  useEffect(() => {
    if (locked) return;
    const cleanup = (window as any).triforge.vibe.onProgress((data: { phase: string; detail?: string }) => {
      setProgressPhase(data.detail ?? data.phase);
    });
    progressCleanup.current = cleanup;
    return () => { cleanup(); };
  }, [locked]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    const res = await (window as any).triforge.vibe.createProfile(newProfileName.trim());
    if (res.ok && res.profile) {
      setProfiles(prev => [...prev, res.profile]);
      setActiveProfile(res.profile);
      setNewProfileName('');
      setShowNewProfile(false);
    }
  };

  const handleSelectProfile = async (id: string) => {
    const res = await (window as any).triforge.vibe.getProfile(id);
    if (res.ok && res.profile) setActiveProfile(res.profile);
  };

  const handleDeleteProfile = async (id: string) => {
    await (window as any).triforge.vibe.deleteProfile(id);
    if (activeProfile?.id === id) setActiveProfile(null);
    setProfiles(prev => prev.filter(p => p.id !== id));
  };

  const handleRunCouncil = async () => {
    if (!activeProfile || !input.trim()) return;
    setLoading(true);
    setResult(null);
    setProgressPhase('Starting...');
    try {
      const res = await (window as any).triforge.vibe.runCouncil(activeProfile.id, input.trim(), mode);
      if (res.ok && res.result) {
        setResult(res.result);
        // Refresh profile to get updated axes
        const profileRes = await (window as any).triforge.vibe.getProfile(activeProfile.id);
        if (profileRes.ok && profileRes.profile) setActiveProfile(profileRes.profile);
      }
    } finally {
      setLoading(false);
      setProgressPhase(null);
    }
  };

  const handleAudit = async () => {
    if (!activeProfile) return;
    setLoading(true);
    setResult(null);
    setProgressPhase('Auditing...');
    try {
      const res = await (window as any).triforge.vibe.audit(activeProfile.id);
      if (res.ok && res.plan) {
        setResult({ signals: [], positions: [], synthesizedDecisions: [], plan: res.plan, outcomeScore: { trust: 0, conversion: 0, usability: 0, clarity: 0, overall: 0 } });
      }
    } finally {
      setLoading(false);
      setProgressPhase(null);
    }
  };

  const handleRescue = async () => {
    if (!activeProfile) return;
    setLoading(true);
    setResult(null);
    setProgressPhase('Rescue analysis...');
    try {
      const res = await (window as any).triforge.vibe.rescue(activeProfile.id);
      if (res.ok && res.plan) {
        setResult({ signals: [], positions: [], synthesizedDecisions: [], plan: res.plan, outcomeScore: { trust: 0, conversion: 0, usability: 0, clarity: 0, overall: 0 } });
      }
    } finally {
      setLoading(false);
      setProgressPhase(null);
    }
  };

  // ── Locked state ──────────────────────────────────────────────────────────
  if (locked) {
    return (
      <div style={styles.container}>
        <div style={styles.lockedBox}>
          <div style={styles.lockedTitle}>Vibe Coding</div>
          <div style={styles.lockedText}>Council-guided aesthetic translation is available on Pro and Business plans.</div>
          {onUpgradeClick && (
            <button style={styles.upgradeBtn} onClick={onUpgradeClick}>Upgrade Plan</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>Vibe Coding</div>
        <div style={styles.headerSub}>Council-guided aesthetic-to-implementation translation</div>
      </div>

      {/* ── Mode selector ───────────────────────────────────────────────────── */}
      <div style={styles.modeRow}>
        {(Object.keys(MODE_LABELS) as VibeMode[]).map(m => (
          <button
            key={m}
            style={{ ...styles.modeBtn, ...(mode === m ? styles.modeBtnActive : {}) }}
            onClick={() => setMode(m)}
            title={MODE_DESCRIPTIONS[m]}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* ── Profile picker ──────────────────────────────────────────────────── */}
      <div style={styles.profileSection}>
        <div style={styles.sectionLabel}>Profile</div>
        <div style={styles.profileRow}>
          {profiles.map(p => (
            <div
              key={p.id}
              style={{ ...styles.profileChip, ...(activeProfile?.id === p.id ? styles.profileChipActive : {}) }}
              onClick={() => handleSelectProfile(p.id)}
            >
              {p.name}
              <span
                style={styles.deleteChip}
                onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id); }}
              >x</span>
            </div>
          ))}
          {showNewProfile ? (
            <div style={styles.newProfileRow}>
              <input
                style={styles.newProfileInput}
                value={newProfileName}
                onChange={e => setNewProfileName(e.target.value)}
                placeholder="Profile name"
                onKeyDown={e => e.key === 'Enter' && handleCreateProfile()}
                autoFocus
              />
              <button style={styles.smallBtn} onClick={handleCreateProfile}>Create</button>
              <button style={styles.smallBtnDim} onClick={() => setShowNewProfile(false)}>Cancel</button>
            </div>
          ) : (
            <button style={styles.addProfileBtn} onClick={() => setShowNewProfile(true)}>+ New Profile</button>
          )}
        </div>
      </div>

      {/* ── Dimension axes ──────────────────────────────────────────────────── */}
      {activeProfile && (
        <div style={styles.axesSection}>
          <div style={styles.sectionLabel}>Dimension Axes</div>
          <div style={styles.axesGrid}>
            {Object.entries(DIMENSION_LABELS).map(([dim, label]) => {
              const val = activeProfile.axes?.[dim] ?? 50;
              return (
                <div key={dim} style={styles.axisRow}>
                  <div style={styles.axisLabel}>{label}</div>
                  <div style={styles.axisBarBg}>
                    <div style={{ ...styles.axisBarFill, width: `${val}%` }} />
                  </div>
                  <div style={styles.axisValue}>{val}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Input ───────────────────────────────────────────────────────────── */}
      <div style={styles.inputSection}>
        <textarea
          style={styles.textarea}
          rows={3}
          placeholder={activeProfile
            ? 'Describe the vibe you want... e.g. "make this feel premium and boardroom-ready"'
            : 'Select or create a profile first'}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={!activeProfile || loading}
        />
        <div style={styles.actionRow}>
          {mode === 'audit' ? (
            <button style={styles.runBtn} onClick={handleAudit} disabled={!activeProfile || loading}>
              {loading ? 'Auditing...' : 'Run Audit'}
            </button>
          ) : mode === 'rescue' ? (
            <button style={styles.runBtn} onClick={handleRescue} disabled={!activeProfile || loading}>
              {loading ? 'Rescuing...' : 'Run Rescue'}
            </button>
          ) : (
            <button style={styles.runBtn} onClick={handleRunCouncil} disabled={!activeProfile || !input.trim() || loading}>
              {loading ? 'Council Debating...' : 'Run Council'}
            </button>
          )}
          {progressPhase && <div style={styles.progressText}>{progressPhase}</div>}
        </div>
      </div>

      {/* ── Council positions ───────────────────────────────────────────────── */}
      {result?.positions && result.positions.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Council Positions</div>
          <div style={styles.positionsGrid}>
            {result.positions.map((pos, i) => (
              <div key={i} style={styles.positionCard}>
                <div style={styles.positionRole}>{formatRole(pos.role)}</div>
                <div style={styles.positionProvider}>{pos.provider}</div>
                <div style={styles.positionConfidence}>Confidence: {pos.confidence}%</div>
                <div style={styles.positionReasoning}>{pos.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Build plan ──────────────────────────────────────────────────────── */}
      {result?.plan && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>
            Build Plan
            <span style={styles.scopeBadge}>{result.plan.scope ?? 'unknown'}</span>
          </div>

          {result.plan.componentTargets?.length > 0 && (
            <div style={styles.subSection}>
              <div style={styles.subLabel}>Component Targets</div>
              {result.plan.componentTargets.map((ct, i) => (
                <div key={i} style={styles.targetRow}>
                  <span style={styles.priorityBadge(ct.priority)}>{ct.priority}</span>
                  <span style={styles.targetName}>{ct.component}</span>
                  <span style={styles.targetChanges}>{ct.changes.join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {result.plan.styleChanges?.length > 0 && (
            <div style={styles.subSection}>
              <div style={styles.subLabel}>Style Changes</div>
              {result.plan.styleChanges.map((sc, i) => (
                <div key={i} style={styles.changeRow}>
                  <code style={styles.changeSelector}>{sc.selector}</code>
                  <span style={styles.changeProp}>{sc.property}:</span>
                  <span style={styles.changeFrom}>{sc.from}</span>
                  <span style={styles.changeArrow}>&rarr;</span>
                  <span style={styles.changeTo}>{sc.to}</span>
                </div>
              ))}
            </div>
          )}

          {result.plan.copyChanges?.length > 0 && (
            <div style={styles.subSection}>
              <div style={styles.subLabel}>Copy Changes</div>
              {result.plan.copyChanges.map((cc, i) => (
                <div key={i} style={styles.changeRow}>
                  <span style={styles.changeLocation}>{cc.location}</span>
                  <span style={styles.changeFrom}>"{cc.from}"</span>
                  <span style={styles.changeArrow}>&rarr;</span>
                  <span style={styles.changeTo}>"{cc.to}"</span>
                  <span style={styles.toneBadge}>{cc.toneShift}</span>
                </div>
              ))}
            </div>
          )}

          {result.plan.guardrailViolations?.length > 0 && (
            <div style={styles.subSection}>
              <div style={{ ...styles.subLabel, color: '#ef4444' }}>Guardrail Violations</div>
              {result.plan.guardrailViolations.map((v, i) => (
                <div key={i} style={styles.violationRow}>{typeof v === 'string' ? v : JSON.stringify(v)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Consistency (audit/rescue) ──────────────────────────────────────── */}
      {result?.consistency && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>
            Consistency Audit
            <span style={styles.scoreBadge(result.consistency.overallScore)}>
              {result.consistency.overallScore}/100
            </span>
          </div>
          {result.consistency.violations?.map((v, i) => (
            <div key={i} style={styles.violationCard}>
              <span style={styles.severityBadge(v.severity)}>{v.severity}</span>
              <span style={styles.violationDim}>{v.dimension}</span>
              <div style={styles.violationDesc}>{v.description}</div>
              <div style={styles.violationSugg}>{v.suggestion}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Outcome scores ──────────────────────────────────────────────────── */}
      {result?.outcomeScore && result.outcomeScore.overall > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Outcome Scores</div>
          <div style={styles.scoresRow}>
            {(['trust', 'conversion', 'usability', 'clarity'] as const).map(dim => (
              <div key={dim} style={styles.scoreCard}>
                <div style={styles.scoreName}>{dim.charAt(0).toUpperCase() + dim.slice(1)}</div>
                <div style={styles.scoreValue}>{Math.round(result!.outcomeScore[dim])}</div>
                <div style={styles.scoreBarBg}>
                  <div style={{ ...styles.scoreBarFill, width: `${result!.outcomeScore[dim]}%` }} />
                </div>
              </div>
            ))}
            <div style={styles.scoreCard}>
              <div style={styles.scoreName}>Overall</div>
              <div style={{ ...styles.scoreValue, color: '#60a5fa' }}>{Math.round(result.outcomeScore.overall)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, any> = {
  container: {
    padding: 24, color: '#e0e0e8', fontFamily: "'Inter', system-ui, sans-serif",
    maxWidth: 900, margin: '0 auto', overflowY: 'auto' as const, height: '100%',
  },
  header: { marginBottom: 20 },
  headerTitle: { fontSize: 22, fontWeight: 700, color: '#f0f0f5' },
  headerSub: { fontSize: 13, color: '#8b8b9e', marginTop: 4 },

  // Mode
  modeRow: { display: 'flex', gap: 8, marginBottom: 20 },
  modeBtn: {
    padding: '6px 14px', borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2e',
    color: '#8b8b9e', cursor: 'pointer', fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
  },
  modeBtnActive: {
    background: '#2a2a4e', color: '#60a5fa', borderColor: '#3b3b6e',
  },

  // Profile
  profileSection: { marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: 600, color: '#a0a0b8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 },
  profileRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' },
  profileChip: {
    padding: '5px 12px', borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2e',
    color: '#c0c0d0', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
  },
  profileChipActive: { background: '#2a2a4e', borderColor: '#4a4a7e', color: '#f0f0f5' },
  deleteChip: { color: '#8b8b9e', cursor: 'pointer', fontSize: 10, marginLeft: 4 },
  addProfileBtn: {
    padding: '5px 12px', borderRadius: 6, border: '1px dashed #3a3a5e', background: 'transparent',
    color: '#60a5fa', cursor: 'pointer', fontSize: 12,
  },
  newProfileRow: { display: 'flex', gap: 6, alignItems: 'center' },
  newProfileInput: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid #3a3a5e', background: '#1a1a2e',
    color: '#f0f0f5', fontSize: 12, width: 140, outline: 'none',
  },
  smallBtn: {
    padding: '4px 10px', borderRadius: 5, border: 'none', background: '#3a3a6e',
    color: '#f0f0f5', cursor: 'pointer', fontSize: 11,
  },
  smallBtnDim: {
    padding: '4px 10px', borderRadius: 5, border: 'none', background: '#2a2a3e',
    color: '#8b8b9e', cursor: 'pointer', fontSize: 11,
  },

  // Axes
  axesSection: { marginBottom: 20 },
  axesGrid: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  axisRow: { display: 'flex', alignItems: 'center', gap: 10 },
  axisLabel: { width: 120, fontSize: 12, color: '#8b8b9e', textAlign: 'right' as const },
  axisBarBg: {
    flex: 1, height: 8, borderRadius: 4, background: '#1a1a2e', overflow: 'hidden',
  },
  axisBarFill: {
    height: '100%', borderRadius: 4,
    background: 'linear-gradient(90deg, #3a3a6e, #60a5fa)',
    transition: 'width 0.3s ease',
  },
  axisValue: { width: 30, fontSize: 11, color: '#a0a0b8', textAlign: 'right' as const },

  // Input
  inputSection: { marginBottom: 20 },
  textarea: {
    width: '100%', padding: 12, borderRadius: 8, border: '1px solid #2a2a3e', background: '#1a1a2e',
    color: '#f0f0f5', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' as const,
    outline: 'none', boxSizing: 'border-box' as const,
  },
  actionRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 },
  runBtn: {
    padding: '8px 20px', borderRadius: 6, border: 'none',
    background: 'linear-gradient(135deg, #3a3a6e, #4a4a8e)',
    color: '#f0f0f5', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
  progressText: { fontSize: 12, color: '#60a5fa', fontStyle: 'italic' },

  // Sections
  section: { marginBottom: 24, padding: 16, borderRadius: 8, border: '1px solid #2a2a3e', background: '#12121e' },
  subSection: { marginTop: 12 },
  subLabel: { fontSize: 12, fontWeight: 600, color: '#8b8b9e', marginBottom: 6 },

  // Council positions
  positionsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  positionCard: {
    padding: 14, borderRadius: 8, border: '1px solid #2a2a3e', background: '#1a1a2e',
  },
  positionRole: { fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 4 },
  positionProvider: { fontSize: 11, color: '#8b8b9e', marginBottom: 6 },
  positionConfidence: { fontSize: 11, color: '#a0a0b8', marginBottom: 8 },
  positionReasoning: { fontSize: 12, color: '#c0c0d0', lineHeight: 1.5 },

  // Build plan
  scopeBadge: {
    padding: '2px 8px', borderRadius: 4, background: '#2a2a4e', color: '#60a5fa',
    fontSize: 11, marginLeft: 8,
  },
  targetRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 },
  priorityBadge: (p: string) => ({
    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
    background: p === 'critical' ? '#3b1a1a' : p === 'standard' ? '#1a2a3b' : '#1a1a2e',
    color: p === 'critical' ? '#ef4444' : p === 'standard' ? '#60a5fa' : '#8b8b9e',
  }),
  targetName: { color: '#c0c0d0', fontWeight: 500 },
  targetChanges: { color: '#8b8b9e' },
  changeRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12, flexWrap: 'wrap' as const },
  changeSelector: { color: '#60a5fa', fontSize: 11 },
  changeProp: { color: '#a0a0b8' },
  changeFrom: { color: '#ef4444', textDecoration: 'line-through' },
  changeArrow: { color: '#8b8b9e' },
  changeTo: { color: '#4ade80' },
  changeLocation: { color: '#a0a0b8', fontWeight: 500 },
  toneBadge: { padding: '1px 6px', borderRadius: 3, background: '#2a2a4e', color: '#60a5fa', fontSize: 10 },

  // Guardrails
  violationRow: { padding: '6px 10px', borderRadius: 4, background: '#2a1a1a', color: '#ef4444', fontSize: 12, marginBottom: 4 },

  // Consistency
  scoreBadge: (score: number) => ({
    padding: '2px 8px', borderRadius: 4, fontSize: 11, marginLeft: 8,
    background: score >= 80 ? '#1a3b1a' : score >= 60 ? '#3b3b1a' : '#3b1a1a',
    color: score >= 80 ? '#4ade80' : score >= 60 ? '#facc15' : '#ef4444',
  }),
  violationCard: {
    padding: 10, borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2e', marginBottom: 6,
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  severityBadge: (sev: string) => ({
    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, alignSelf: 'flex-start',
    background: sev === 'critical' ? '#3b1a1a' : sev === 'moderate' ? '#3b3b1a' : '#1a1a3b',
    color: sev === 'critical' ? '#ef4444' : sev === 'moderate' ? '#facc15' : '#60a5fa',
  }),
  violationDim: { fontSize: 12, color: '#a0a0b8', fontWeight: 500 },
  violationDesc: { fontSize: 12, color: '#c0c0d0' },
  violationSugg: { fontSize: 11, color: '#4ade80', fontStyle: 'italic' },

  // Outcome scores
  scoresRow: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
  scoreCard: { flex: '1 1 100px', textAlign: 'center' as const },
  scoreName: { fontSize: 11, color: '#8b8b9e', marginBottom: 4 },
  scoreValue: { fontSize: 20, fontWeight: 700, color: '#f0f0f5', marginBottom: 4 },
  scoreBarBg: { height: 4, borderRadius: 2, background: '#1a1a2e', overflow: 'hidden' },
  scoreBarFill: {
    height: '100%', borderRadius: 2,
    background: 'linear-gradient(90deg, #3a3a6e, #4ade80)',
    transition: 'width 0.3s ease',
  },

  // Locked
  lockedBox: {
    textAlign: 'center' as const, padding: 48, borderRadius: 12,
    border: '1px solid #2a2a3e', background: '#12121e', marginTop: 60,
  },
  lockedTitle: { fontSize: 20, fontWeight: 700, color: '#f0f0f5', marginBottom: 12 },
  lockedText: { fontSize: 14, color: '#8b8b9e', marginBottom: 20 },
  upgradeBtn: {
    padding: '10px 24px', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg, #3a3a6e, #4a4a8e)',
    color: '#f0f0f5', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  },
};
