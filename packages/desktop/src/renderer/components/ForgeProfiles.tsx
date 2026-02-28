import React, { useState, useEffect } from 'react';

// ── Types (mirrored from main/profiles.ts — cannot import across process boundary) ──

interface MemoryPresetEntry { type: string; content: string; }

interface ExecutionTemplate {
  id: string;
  title: string;
  description: string;
  steps: string[];
}

interface ForgeProfile {
  id: string;
  name: string;
  icon: string;
  description: string;
  systemContext: string;
  memoryPreset: MemoryPresetEntry[];
  executionTemplates: ExecutionTemplate[];
  appScaffold: { description: string; modules: string[] };
  kpiModel: string[];
  blueprintSections: string[];
  blueprintPrompt: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  tier: string;
  activeProfileId: string | null;
  onProfileChange: (id: string | null) => void;
  /** Called when user clicks "Open in Chat" on an execution template. Switches to chat screen with prompt pre-filled. */
  onSendToChat: (prompt: string) => void;
  onUpgradeClick: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForgeProfiles({ tier, activeProfileId, onProfileChange, onSendToChat, onUpgradeClick }: Props) {
  const [profiles, setProfiles] = useState<ForgeProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ForgeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [blueprintPhase, setBlueprintPhase] = useState('');
  const [blueprintMarkdown, setBlueprintMarkdown] = useState<string | null>(null);
  const [blueprintLedgerId, setBlueprintLedgerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockedByTier, setLockedByTier] = useState(false);

  // Listen to forge:update events during blueprint generation
  useEffect(() => {
    const unsub = window.triforge.forge.onUpdate((data) => {
      if (!blueprintLoading) return;
      if (data.phase === 'querying')             setBlueprintPhase('Querying AI council…');
      else if (data.phase === 'provider:responding') setBlueprintPhase(`${data.provider} drafting blueprint…`);
      else if (data.phase === 'provider:complete')   setBlueprintPhase(`${data.completedCount ?? 0}/${data.total ?? 0} providers complete`);
      else if (data.phase === 'synthesis:start')     setBlueprintPhase('Synthesizing final blueprint…');
      else if (data.phase === 'complete')             setBlueprintPhase('');
    });
    return unsub;
  }, [blueprintLoading]);

  // Load profiles and active state on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [listResult, activeResult] = await Promise.all([
          window.triforge.forgeProfiles.list(),
          window.triforge.forgeProfiles.getActive(),
        ]);
        if (listResult.error?.startsWith('FEATURE_LOCKED:')) {
          setLockedByTier(true);
          setProfiles([]);
        } else {
          setProfiles(listResult.profiles ?? []);
          setLockedByTier(false);
        }
        setActiveProfile(activeResult.profile ?? null);
      } catch {
        setError('Failed to load profiles.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleActivate(id: string) {
    setActivating(id);
    setError(null);
    setBlueprintMarkdown(null);
    setBlueprintLedgerId(null);
    try {
      const result = await window.triforge.forgeProfiles.activate(id);
      if (result.error) {
        setError(result.error);
      } else {
        setActiveProfile(result.profile ?? null);
        onProfileChange(id);
      }
    } finally {
      setActivating(null);
    }
  }

  async function handleDeactivate() {
    await window.triforge.forgeProfiles.deactivate();
    setActiveProfile(null);
    setBlueprintMarkdown(null);
    setBlueprintLedgerId(null);
    onProfileChange(null);
  }

  async function handleGenerateBlueprint() {
    if (!activeProfile) return;
    setBlueprintLoading(true);
    setBlueprintMarkdown(null);
    setBlueprintLedgerId(null);
    setBlueprintPhase('Preparing…');
    setError(null);
    try {
      const result = await window.triforge.forgeProfiles.generateBlueprint(activeProfile.id);
      if (result.error) {
        setError(result.error);
      } else {
        setBlueprintMarkdown(result.markdown ?? null);
        setBlueprintLedgerId(result.ledgerEntryId ?? null);
      }
    } finally {
      setBlueprintLoading(false);
      setBlueprintPhase('');
    }
  }

  async function handleExportBlueprint(format: 'md' | 'pdf') {
    if (!blueprintLedgerId) return;
    try {
      await window.triforge.ledger.export(blueprintLedgerId, format);
    } catch {
      setError('Export failed. Ensure the blueprint is generated first.');
    }
  }

  function handleUseTemplate(template: ExecutionTemplate) {
    const prompt = [
      `Run through this ${template.title} workflow step by step for my business:`,
      '',
      ...template.steps.map((s, i) => `${i + 1}. ${s}`),
    ].join('\n');
    onSendToChat(prompt);
  }

  // ── Free tier gate ──────────────────────────────────────────────────────────

  if (lockedByTier || tier === 'free') {
    return (
      <div style={ps.page}>
        <div style={ps.pageHeader}>
          <h2 style={ps.heading}>Forge Profiles</h2>
          <p style={ps.subheading}>
            Industry operational profiles that inject domain expertise into every AI interaction.
          </p>
        </div>
        <div style={ps.lockCard}>
          <div style={ps.lockIcon}>⊡</div>
          <div style={ps.lockTitle}>Forge Profiles — Pro Feature</div>
          <div style={ps.lockDesc}>
            Activate a Forge Profile to inject domain-specific conventions, KPIs, and execution
            templates into every AI call. Available on Pro and Business plans.
          </div>
          <button style={ps.upgradeBtn} onClick={onUpgradeClick}>
            Upgrade to Pro
          </button>
        </div>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={ps.page}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 32 }}>Loading profiles…</div>
      </div>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────────────

  return (
    <div style={ps.page}>
      {/* Header */}
      <div style={ps.pageHeader}>
        <h2 style={ps.heading}>Forge Profiles</h2>
        <p style={ps.subheading}>
          Select an operational profile to inject domain expertise into every AI interaction, blueprint generation, and App Builder scaffold.
          {activeProfile && (
            <span style={ps.activeTag}> Active: {activeProfile.icon} {activeProfile.name}</span>
          )}
        </p>
      </div>

      {error && !error.startsWith('FEATURE_LOCKED:') && (
        <div style={ps.errorBanner}>{error}</div>
      )}

      {/* Active profile panel */}
      {activeProfile && (
        <ActivePanel
          profile={activeProfile}
          blueprintLoading={blueprintLoading}
          blueprintPhase={blueprintPhase}
          blueprintMarkdown={blueprintMarkdown}
          hasBlueprintLedgerEntry={!!blueprintLedgerId}
          onDeactivate={handleDeactivate}
          onGenerate={handleGenerateBlueprint}
          onUseTemplate={handleUseTemplate}
          onExportMd={() => handleExportBlueprint('md')}
          onExportPdf={() => handleExportBlueprint('pdf')}
        />
      )}

      {/* Profile selector cards */}
      <div style={ps.sectionLabel}>
        {activeProfile ? 'Switch Profile' : 'Select a Profile'}
      </div>
      <div style={ps.cardGrid}>
        {profiles.map(profile => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            isActive={activeProfileId === profile.id}
            isActivating={activating === profile.id}
            onActivate={() => handleActivate(profile.id)}
          />
        ))}
        {/* Business placeholder for future profiles */}
        {tier === 'business' && (
          <div style={{ ...ps.card, opacity: 0.45, cursor: 'default' }}>
            <div style={ps.cardIcon}>◈</div>
            <div style={ps.cardName}>More Profiles Coming</div>
            <div style={ps.cardDesc}>
              Additional industry profiles (legal, real estate, e-commerce, and more) are in development for Business subscribers.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Profile Card ──────────────────────────────────────────────────────────────

function ProfileCard({
  profile, isActive, isActivating, onActivate,
}: {
  profile: ForgeProfile;
  isActive: boolean;
  isActivating: boolean;
  onActivate: () => void;
}) {
  return (
    <div style={{ ...ps.card, ...(isActive ? ps.cardActive : {}) }}>
      <div style={ps.cardIcon}>{profile.icon}</div>
      <div style={ps.cardName}>{profile.name}</div>
      <div style={ps.cardDesc}>{profile.description}</div>
      <button
        style={{ ...ps.activateBtn, ...(isActive ? ps.activateBtnActive : {}) }}
        onClick={onActivate}
        disabled={isActivating}
      >
        {isActivating ? 'Activating…' : isActive ? '✓ Active' : 'Activate Profile'}
      </button>
    </div>
  );
}

// ── Active Profile Panel ──────────────────────────────────────────────────────

function ActivePanel({
  profile, blueprintLoading, blueprintPhase, blueprintMarkdown,
  hasBlueprintLedgerEntry, onDeactivate, onGenerate, onUseTemplate,
  onExportMd, onExportPdf,
}: {
  profile: ForgeProfile;
  blueprintLoading: boolean;
  blueprintPhase: string;
  blueprintMarkdown: string | null;
  hasBlueprintLedgerEntry: boolean;
  onDeactivate: () => void;
  onGenerate: () => void;
  onUseTemplate: (t: ExecutionTemplate) => void;
  onExportMd: () => void;
  onExportPdf: () => void;
}) {
  const [tab, setTab] = useState<'templates' | 'kpis' | 'blueprint'>('templates');

  return (
    <div style={ps.activePanel}>
      {/* Panel header */}
      <div style={ps.activePanelHeader}>
        <div style={ps.activePanelTitle}>
          <span style={ps.activePanelIcon}>{profile.icon}</span>
          <span>{profile.name}</span>
          <span style={ps.activeBadge}>ACTIVE</span>
        </div>
        <button style={ps.deactivateBtn} onClick={onDeactivate}>Deactivate</button>
      </div>

      {/* Tab bar */}
      <div style={ps.tabBar}>
        {(['templates', 'kpis', 'blueprint'] as const).map(t => (
          <button
            key={t}
            style={{ ...ps.tabBtn, ...(tab === t ? ps.tabBtnActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t === 'templates' ? 'Execution Templates' : t === 'kpis' ? 'KPI Model' : 'Blueprint'}
          </button>
        ))}
      </div>

      {/* Execution Templates tab */}
      {tab === 'templates' && (
        <div style={ps.tabContent}>
          <p style={ps.tabIntro}>
            Click <strong>Open in Chat</strong> to pre-fill the chat input with this workflow prompt.
          </p>
          {profile.executionTemplates.map(t => (
            <div key={t.id} style={ps.templateCard}>
              <div style={ps.templateHeader}>
                <div>
                  <div style={ps.templateTitle}>{t.title}</div>
                  <div style={ps.templateDesc}>{t.description}</div>
                </div>
                <button style={ps.openInChatBtn} onClick={() => onUseTemplate(t)}>
                  Open in Chat →
                </button>
              </div>
              <ol style={ps.stepList}>
                {t.steps.map((step, i) => (
                  <li key={i} style={ps.stepItem}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {/* KPI Model tab */}
      {tab === 'kpis' && (
        <div style={ps.tabContent}>
          <p style={ps.tabIntro}>
            These KPIs are the primary metrics for this operational profile. Review them regularly to track business health.
          </p>
          <div style={ps.kpiList}>
            {profile.kpiModel.map((kpi, i) => {
              const [label, ...rest] = kpi.split(' — ');
              return (
                <div key={i} style={ps.kpiRow}>
                  <span style={ps.kpiLabel}>{label}</span>
                  {rest.length > 0 && <span style={ps.kpiDesc}>{rest.join(' — ')}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Blueprint tab */}
      {tab === 'blueprint' && (
        <div style={ps.tabContent}>
          {!blueprintMarkdown && !blueprintLoading && (
            <div style={ps.blueprintPromptSection}>
              <p style={ps.tabIntro}>
                Generate a full Operational Blueprint for your {profile.name} business using the TriForge AI council.
                The blueprint covers: {profile.blueprintSections.join(', ')}.
              </p>
              <button style={ps.generateBtn} onClick={onGenerate}>
                Generate Blueprint
              </button>
            </div>
          )}

          {blueprintLoading && (
            <div style={ps.blueprintLoading}>
              <div style={ps.spinner} />
              <span style={ps.loadingText}>{blueprintPhase || 'Generating…'}</span>
            </div>
          )}

          {blueprintMarkdown && !blueprintLoading && (
            <div>
              <div style={ps.blueprintActions}>
                <button style={ps.generateBtn} onClick={onGenerate}>
                  Regenerate Blueprint
                </button>
                {hasBlueprintLedgerEntry && (
                  <>
                    <button style={ps.exportBtn} onClick={onExportMd}>Export MD</button>
                    <button style={ps.exportBtn} onClick={onExportPdf}>Export PDF</button>
                  </>
                )}
              </div>
              <div style={ps.blueprintOutput}>
                <MarkdownRenderer markdown={blueprintMarkdown} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Minimal markdown renderer ────────────────────────────────────────────────
// Handles the headings, bullets, bold, and tables produced by blueprint prompts.

function MarkdownRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} style={md.h2}>{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} style={md.h3}>{line.slice(4)}</h3>);
    } else if (line.startsWith('#### ')) {
      elements.push(<h4 key={i} style={md.h4}>{line.slice(5)}</h4>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<div key={i} style={md.bullet}>• {inlineParse(line.slice(2))}</div>);
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1] ?? '';
      elements.push(<div key={i} style={md.bullet}>{num}. {inlineParse(line.replace(/^\d+\. /, ''))}</div>);
    } else if (line.startsWith('|')) {
      // Collect table lines
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<TableBlock key={`tbl-${i}`} lines={tableLines} />);
      continue;
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} style={md.hr} />);
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={i} style={md.p}>{inlineParse(line)}</p>);
    }
    i++;
  }

  return <div style={md.container}>{elements}</div>;
}

function inlineParse(text: string): React.ReactNode {
  // Handle **bold** only (covers most blueprint output)
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

function TableBlock({ lines }: { lines: string[] }) {
  const rows = lines
    .filter(l => !l.match(/^\|[-| :]+\|$/)) // skip separator rows
    .map(l => l.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim()));

  if (rows.length === 0) return null;
  const [header, ...body] = rows;

  return (
    <table style={md.table}>
      <thead>
        <tr>{header.map((h, i) => <th key={i} style={md.th}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => <td key={ci} style={md.td}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ps: Record<string, React.CSSProperties> = {
  page: {
    flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex',
    flexDirection: 'column', gap: 20,
  },
  pageHeader: { display: 'flex', flexDirection: 'column', gap: 4 },
  heading: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subheading: { fontSize: 13, color: 'var(--text-secondary)', margin: 0 },
  activeTag: { color: 'var(--accent)', fontWeight: 600 },
  errorBanner: {
    background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8,
    color: '#ef4444', fontSize: 13, padding: '8px 12px',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--text-muted)',
  },

  // Lock / upgrade gate
  lockCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 32, display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 12, textAlign: 'center', maxWidth: 480,
  },
  lockIcon: { fontSize: 36 },
  lockTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' },
  lockDesc: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 },
  upgradeBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 8, padding: '10px 24px', fontSize: 14,
    fontWeight: 700, cursor: 'pointer', marginTop: 8,
  },

  // Profile cards
  cardGrid: { display: 'flex', flexWrap: 'wrap', gap: 16 },
  card: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '20px 20px 16px', display: 'flex',
    flexDirection: 'column', gap: 8, minWidth: 220, maxWidth: 280, flex: '1 1 220px',
  },
  cardActive: { border: '1px solid var(--accent)', background: 'var(--accent-dim)' },
  cardIcon: { fontSize: 28 },
  cardName: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' },
  cardDesc: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, flex: 1 },
  activateBtn: {
    marginTop: 4, background: 'none', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-secondary)', fontSize: 12,
    fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
  },
  activateBtnActive: { border: '1px solid var(--accent)', color: 'var(--accent)' },

  // Active panel
  activePanel: {
    background: 'var(--bg-elevated)', border: '1px solid var(--accent)44',
    borderRadius: 12, overflow: 'hidden',
  },
  activePanelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--accent-dim)',
  },
  activePanelTitle: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' },
  activePanelIcon: { fontSize: 22 },
  activeBadge: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    background: 'var(--accent)', color: '#fff', padding: '2px 7px', borderRadius: 4,
  },
  deactivateBtn: {
    background: 'none', border: '1px solid var(--border)',
    color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px',
    fontSize: 12, cursor: 'pointer',
  },

  // Tab bar
  tabBar: { display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px' },
  tabBtn: {
    background: 'none', border: 'none', borderBottom: '2px solid transparent',
    color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
    padding: '10px 14px', cursor: 'pointer', marginBottom: -1,
  },
  tabBtnActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  tabContent: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  tabIntro: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },

  // Execution templates
  templateCard: {
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  templateHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  templateTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' },
  templateDesc: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  openInChatBtn: {
    flexShrink: 0, background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  stepList: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 },
  stepItem: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 },

  // KPIs
  kpiList: { display: 'flex', flexDirection: 'column', gap: 6 },
  kpiRow: {
    padding: '8px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 2,
  },
  kpiLabel: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' },
  kpiDesc: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 },

  // Blueprint
  blueprintPromptSection: { display: 'flex', flexDirection: 'column', gap: 12 },
  generateBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 8, padding: '9px 20px', fontSize: 13,
    fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
  },
  blueprintLoading: { display: 'flex', alignItems: 'center', gap: 12, padding: '20px 0' },
  spinner: {
    width: 18, height: 18, borderRadius: '50%',
    border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: { fontSize: 13, color: 'var(--text-secondary)' },
  blueprintActions: { display: 'flex', gap: 10, marginBottom: 14 },
  exportBtn: {
    background: 'none', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 14px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  blueprintOutput: {
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '16px 20px', overflowY: 'auto', maxHeight: 520,
  },
};

// Markdown renderer styles
const md: Record<string, React.CSSProperties> = {
  container: { fontFamily: 'inherit', color: 'var(--text-primary)' },
  h2: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '16px 0 6px', borderBottom: '1px solid var(--border)', paddingBottom: 4 },
  h3: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 4px' },
  h4: { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '8px 0 4px' },
  p: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, margin: '4px 0' },
  bullet: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, paddingLeft: 8, marginBottom: 2 },
  hr: { border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 },
  th: { textAlign: 'left', padding: '5px 8px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 700, borderBottom: '1px solid var(--border)' },
  td: { padding: '5px 8px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' },
};
