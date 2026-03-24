// ── StarterPackInstallWizard.tsx ──────────────────────────────────────────────
//
// Phase 7.3 — Guided install/import flow for income starter packs.
//
// Four steps:
//   1. Overview     — shows skills + platforms included in the pack
//   2. Install      — auto-installs each ForgeHub skill with per-skill status
//   3. Platforms    — informational checklist of credentials the user needs
//   4. Experiment   — pre-filled create-experiment form; submits via experiments.create
//
// On step 4 success, calls onDone() (navigates back to Income Operator).

import React, { useState } from 'react';
import type { StarterPack } from '../starterPacks';

// ── Types ─────────────────────────────────────────────────────────────────────

type InstallStatus = 'idle' | 'installing' | 'done' | 'error';

interface SkillState {
  id:     string;
  name:   string;
  status: InstallStatus;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const tf = () => (window as any).triforge;

const LANE_LABELS: Record<string, string> = {
  digital_products:  'Digital Products',
  client_services:   'Client Services',
  affiliate_content: 'Affiliate Content',
  faceless_youtube:  'Faceless YouTube',
  short_form_brand:  'Short-Form Brand',
  ai_music:          'AI Music',
  mini_games:        'Mini Games',
  asset_packs:       'Asset Packs',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function StarterPackInstallWizard({
  pack,
  onClose,
  onDone,
}: {
  pack:    StarterPack;
  onClose: () => void;
  onDone:  () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 2 — skill install state
  const [skillStates, setSkillStates] = useState<SkillState[]>(
    pack.skillIds.map(id => ({ id, name: id, status: 'idle' as InstallStatus })),
  );
  const [allInstalled, setAllInstalled] = useState(false);

  // Step 4 — experiment form state
  const [expName,     setExpName]     = useState(pack.template.name);
  const [expBudget,   setExpBudget]   = useState(String(pack.template.budgetAsk));
  const [expRationale,setExpRationale]= useState(pack.template.rationale);
  const [killPct,     setKillPct]     = useState(String(pack.template.autoKillRule.budgetPctSpent));
  const [killDays,    setKillDays]    = useState(String(pack.template.autoKillRule.afterDays));
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Step 2: install all skills ────────────────────────────────────────────

  const runInstall = async () => {
    // Load hub to get skill names
    const hubResult = await tf().forgeHub.list() as { skills?: Array<{ id: string; name: string }> };
    const nameMap: Record<string, string> = {};
    for (const s of hubResult.skills ?? []) nameMap[s.id] = s.name;

    // Initialize names
    setSkillStates(prev => prev.map(s => ({ ...s, name: nameMap[s.id] ?? s.id, status: 'installing' })));

    // Install sequentially so we can show progress per skill
    const updated: SkillState[] = [];
    for (const skillId of pack.skillIds) {
      const name = nameMap[skillId] ?? skillId;
      try {
        const mdResult = await tf().forgeHub.getMarkdown(skillId) as { markdown?: string; error?: string };
        if (!mdResult.markdown) throw new Error(mdResult.error ?? 'Skill not found.');
        const result = await tf().skillStore.install(mdResult.markdown, 'forgehub') as { success: boolean; error?: string };
        if (!result.success) throw new Error(result.error ?? 'Install failed.');
        updated.push({ id: skillId, name, status: 'done' });
      } catch (e) {
        updated.push({ id: skillId, name, status: 'error', error: e instanceof Error ? e.message : 'Install failed.' });
      }
      setSkillStates([...updated, ...pack.skillIds.slice(updated.length).map(id => ({ id, name: nameMap[id] ?? id, status: 'installing' as InstallStatus }))]);
    }

    setSkillStates(updated);
    setAllInstalled(true);
  };

  const handleStartInstall = () => {
    void runInstall();
  };

  // ── Step 4: create experiment ─────────────────────────────────────────────

  const handleCreateExperiment = async () => {
    const budget = parseFloat(expBudget);
    if (!expName.trim())    { setCreateError('Name is required.'); return; }
    if (!expRationale.trim()){ setCreateError('Rationale is required.'); return; }
    if (isNaN(budget) || budget < 0) { setCreateError('Enter a valid budget (0 or more).'); return; }

    setCreating(true);
    setCreateError(null);
    try {
      const result = await tf().experiments.create({
        laneId:       pack.laneId,
        name:         expName.trim(),
        rationale:    expRationale.trim(),
        budgetAsk:    budget,
        autoKillRule: {
          budgetPctSpent: parseInt(killPct, 10),
          afterDays:      parseInt(killDays, 10),
        },
      }) as { success: boolean; error?: string };

      if (!result.success) {
        setCreateError(result.error ?? 'Failed to create experiment. Is a budget configured?');
        return;
      }
      onDone();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setCreating(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.title}>{pack.name}</div>
            <div style={styles.stepLabel}>Step {step} of 4</div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Progress bar */}
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${(step / 4) * 100}%` }} />
        </div>

        {/* ── Step 1: Overview ─────────────────────────────────────────── */}
        {step === 1 && (
          <div style={styles.body}>
            <p style={styles.packDesc}>{pack.description}</p>

            <Section label="Skills included">
              {pack.skillIds.map(id => (
                <div key={id} style={styles.listRow}>
                  <span style={styles.dot} />
                  <span style={styles.listText}>{id}</span>
                </div>
              ))}
            </Section>

            <Section label="Required platforms">
              {pack.platforms.map(p => (
                <div key={p.id} style={styles.listRow}>
                  <span style={styles.dot} />
                  <div>
                    <span style={styles.listText}>{p.name}</span>
                    <span style={styles.listHint}> — {p.setupHint}</span>
                  </div>
                </div>
              ))}
            </Section>

            <Section label="Experiment template">
              <div style={styles.templatePreview}>
                <div style={styles.templateRow}>
                  <span style={styles.templateKey}>Lane</span>
                  <span style={styles.templateVal}>{LANE_LABELS[pack.laneId] ?? pack.laneId}</span>
                </div>
                <div style={styles.templateRow}>
                  <span style={styles.templateKey}>Name</span>
                  <span style={styles.templateVal}>{pack.template.name}</span>
                </div>
                <div style={styles.templateRow}>
                  <span style={styles.templateKey}>Budget</span>
                  <span style={styles.templateVal}>${pack.template.budgetAsk}</span>
                </div>
                <div style={styles.templateRow}>
                  <span style={styles.templateKey}>Auto-kill</span>
                  <span style={styles.templateVal}>
                    {pack.template.autoKillRule.budgetPctSpent}% spent or {pack.template.autoKillRule.afterDays}d with no revenue
                  </span>
                </div>
              </div>
            </Section>

            <div style={styles.footer}>
              <button style={styles.secondaryBtn} onClick={onClose}>Cancel</button>
              <button style={styles.primaryBtn} onClick={() => { setStep(2); handleStartInstall(); }}>
                Install Skills
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Install skills ────────────────────────────────────── */}
        {step === 2 && (
          <div style={styles.body}>
            <p style={styles.bodyHint}>Installing skills for this pack...</p>

            <div style={styles.skillList}>
              {skillStates.map(s => (
                <div key={s.id} style={styles.skillRow}>
                  <StatusIcon status={s.status} />
                  <div style={styles.skillInfo}>
                    <span style={styles.skillName}>{s.name}</span>
                    {s.error && <span style={styles.skillError}>{s.error}</span>}
                  </div>
                </div>
              ))}
            </div>

            {allInstalled && (
              <div style={styles.footer}>
                <button style={styles.primaryBtn} onClick={() => setStep(3)}>
                  Continue
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Platforms ────────────────────────────────────────── */}
        {step === 3 && (
          <div style={styles.body}>
            <p style={styles.bodyHint}>
              This pack requires the following platform credentials. You can set them now or later in Settings → Credentials.
            </p>

            {pack.platforms.map(p => (
              <div key={p.id} style={styles.platformRow}>
                <div style={styles.platformName}>{p.name}</div>
                <div style={styles.platformKey}>Credential: <code style={styles.code}>{p.credentialKey}</code></div>
                <div style={styles.platformHint}>{p.setupHint}</div>
              </div>
            ))}

            <div style={styles.footer}>
              <button style={styles.secondaryBtn} onClick={() => setStep(2)}>Back</button>
              <button style={styles.primaryBtn} onClick={() => setStep(4)}>Continue</button>
            </div>
          </div>
        )}

        {/* ── Step 4: Create experiment ─────────────────────────────────── */}
        {step === 4 && (
          <div style={styles.body}>
            <p style={styles.bodyHint}>Review and create your first experiment for this pack.</p>

            <div style={styles.formGroup}>
              <label style={styles.label}>Experiment name</label>
              <input
                style={styles.input}
                value={expName}
                onChange={e => setExpName(e.target.value)}
                placeholder="e.g. First Gumroad Product"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Rationale</label>
              <textarea
                style={styles.textarea}
                value={expRationale}
                onChange={e => setExpRationale(e.target.value)}
                rows={3}
              />
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Budget ($)</label>
                <input
                  style={styles.input}
                  type="number"
                  min="0"
                  value={expBudget}
                  onChange={e => setExpBudget(e.target.value)}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Kill if spent %</label>
                <input
                  style={styles.input}
                  type="number"
                  min="1"
                  max="100"
                  value={killPct}
                  onChange={e => setKillPct(e.target.value)}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>After days (no revenue)</label>
                <input
                  style={styles.input}
                  type="number"
                  min="1"
                  value={killDays}
                  onChange={e => setKillDays(e.target.value)}
                />
              </div>
            </div>

            {createError && <div style={styles.errorBox}>{createError}</div>}

            <div style={styles.footer}>
              <button style={styles.secondaryBtn} onClick={() => setStep(3)}>Back</button>
              <button
                style={{ ...styles.primaryBtn, ...(creating ? styles.primaryBtnBusy : {}) }}
                onClick={() => void handleCreateExperiment()}
                disabled={creating}
              >
                {creating ? 'Creating...' : 'Create Experiment'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionLabel}>{label}</div>
      {children}
    </div>
  );
}

function StatusIcon({ status }: { status: InstallStatus }) {
  if (status === 'idle')      return <span style={{ ...styles.statusIcon, color: 'rgba(255,255,255,0.25)' }}>○</span>;
  if (status === 'installing') return <span style={{ ...styles.statusIcon, color: '#f59e0b' }}>◌</span>;
  if (status === 'done')       return <span style={{ ...styles.statusIcon, color: '#4ade80' }}>✓</span>;
  return <span style={{ ...styles.statusIcon, color: '#f87171' }}>✕</span>;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#131316',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    width: '100%',
    maxWidth: 520,
    maxHeight: '85vh',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '20px 20px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f0f0f5',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  stepLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
    cursor: 'pointer',
    padding: '2px 4px',
  },
  progressTrack: {
    height: 2,
    background: 'rgba(255,255,255,0.07)',
  },
  progressFill: {
    height: '100%',
    background: '#a78bfa',
    transition: 'width 0.3s ease',
  },
  body: {
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  packDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.55,
    margin: 0,
  },
  bodyHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 1.5,
    margin: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.6px',
  },
  listRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
  },
  dot: {
    display: 'inline-block',
    width: 4,
    height: 4,
    borderRadius: '50%',
    background: '#a78bfa',
    marginTop: 5,
    flexShrink: 0,
  },
  listText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  listHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
  },
  templatePreview: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 5,
  },
  templateRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
  },
  templateKey: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    width: 60,
    flexShrink: 0,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.4px',
  },
  templateVal: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
  },
  skillList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  skillRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
  },
  statusIcon: {
    fontSize: 16,
    width: 20,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  skillInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  skillName: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  skillError: {
    fontSize: 11,
    color: '#f87171',
  },
  platformRow: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  platformName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.8)',
  },
  platformKey: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  platformHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  code: {
    background: 'rgba(255,255,255,0.07)',
    borderRadius: 3,
    padding: '1px 5px',
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#a78bfa',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 5,
    flex: 1,
  },
  formRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  input: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '7px 10px',
    color: '#f0f0f5',
    fontSize: 12,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  textarea: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '7px 10px',
    color: '#f0f0f5',
    fontSize: 12,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  errorBox: {
    fontSize: 12,
    color: '#f87171',
    background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 6,
    padding: '8px 10px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
    paddingTop: 10,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  primaryBtn: {
    background: 'rgba(167,139,250,0.14)',
    border: '1px solid rgba(167,139,250,0.35)',
    borderRadius: 7,
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 18px',
    cursor: 'pointer',
  },
  primaryBtnBusy: {
    opacity: 0.45,
    cursor: 'not-allowed' as const,
  },
  secondaryBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 7,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    padding: '8px 16px',
    cursor: 'pointer',
  },
} as const;
