import React, { useState, useEffect, useRef } from 'react';
import crypto from 'crypto';

// ── Types (local mirrors of engine types — avoids import chain in renderer) ──

type WorkflowCategory = 'perception' | 'input' | 'diagnostic' | 'handoff';
type OnFailure = 'stop' | 'warn_continue' | 'ask_user';

const USABLE_PHASE_KINDS: { kind: string; label: string; group: string }[] = [
  // Observation
  { kind: 'list_apps',         label: 'List Running Apps',      group: 'Observation' },
  { kind: 'get_frontmost',     label: 'Get Frontmost App',      group: 'Observation' },
  { kind: 'focus_app',         label: 'Focus App',              group: 'Observation' },
  { kind: 'screenshot',        label: 'Capture Screenshot',     group: 'Observation' },
  { kind: 'perceive_with_ocr', label: 'Perceive (OCR)',         group: 'Observation' },
  // Input
  { kind: 'queue_input',       label: 'Queue Input (type/key)', group: 'Input' },
  { kind: 'execute_approved',  label: 'Execute Approved Input', group: 'Input' },
  { kind: 'queue_click_at',    label: 'Queue Click at Coords',  group: 'Input' },
  // Vision
  { kind: 'vision_describe',   label: 'Vision: Describe Screen', group: 'Vision' },
  { kind: 'vision_locate',     label: 'Vision: Locate Element',  group: 'Vision' },
  { kind: 'vision_ask',        label: 'Vision: Ask Question',    group: 'Vision' },
  { kind: 'vision_verify',     label: 'Vision: Verify Outcome',  group: 'Vision' },
  // Screen Watcher
  { kind: 'screen_watch_start', label: 'Start Screen Watcher',  group: 'Screen Watcher' },
  { kind: 'screen_watch_stop',  label: 'Stop Screen Watcher',   group: 'Screen Watcher' },
  { kind: 'screen_watch_check', label: 'Check Screen Changed',  group: 'Screen Watcher' },
  // OSK
  { kind: 'osk_open',           label: 'Open On-Screen KB',     group: 'OSK' },
  { kind: 'osk_close',          label: 'Close On-Screen KB',    group: 'OSK' },
  { kind: 'osk_type',           label: 'Type via OSK',          group: 'OSK' },
  // Diagnostics
  { kind: 'readiness_check',    label: 'Readiness Check',       group: 'Diagnostics' },
  { kind: 'app_awareness_check',label: 'App Awareness Scan',    group: 'Diagnostics' },
  // Output
  { kind: 'report',             label: 'Assemble Report',       group: 'Output' },
];

const KIND_GROUPS = Array.from(new Set(USABLE_PHASE_KINDS.map(k => k.group)));

interface BuilderPhase {
  id: string;
  name: string;
  description: string;
  kind: string;
  requiresApproval: boolean;
  approvalDescription: string;
  onFailure: OnFailure;
  optional: boolean;
}

interface CustomPack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: WorkflowCategory;
  version: string;
  successCriteria: string;
  tags: string[];
  requirements: {
    platforms: string[];
    capabilities: string[];
    permissions: { accessibility?: boolean; screenRecording?: boolean };
    targetApp: string | null;
    providerRequired: boolean;
  };
  phases: BuilderPhase[];
}

function makePhase(): BuilderPhase {
  return {
    id: Math.random().toString(36).slice(2),
    name: '',
    description: '',
    kind: 'screenshot',
    requiresApproval: false,
    approvalDescription: '',
    onFailure: 'stop',
    optional: false,
  };
}

function makeBlankPack(): CustomPack {
  return {
    id: 'pack.custom-' + Math.random().toString(36).slice(2, 8),
    name: '',
    tagline: '',
    description: '',
    category: 'perception',
    version: '1.0.0',
    successCriteria: '',
    tags: [],
    requirements: {
      platforms: ['macOS'],
      capabilities: [],
      permissions: {},
      targetApp: null,
      providerRequired: false,
    },
    phases: [],
  };
}

const tf = () => (window as any).triforge;

// ── Component ─────────────────────────────────────────────────────────────────

export function PackBuilderScreen() {
  const [saved, setSaved]           = useState<CustomPack[]>([]);
  const [editing, setEditing]       = useState<CustomPack | null>(null);
  const [activeTab, setActiveTab]   = useState<'meta' | 'phases'>('meta');
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState<{ text: string; ok: boolean } | null>(null);
  const [dragOver, setDragOver]     = useState<number | null>(null);
  const dragSrc                     = useRef<number | null>(null);

  const load = async () => {
    const res = await tf()?.packBuilder?.list();
    if (res?.ok) setSaved((res.packs ?? []) as CustomPack[]);
  };

  useEffect(() => { load(); }, []);

  const newPack = () => { setEditing(makeBlankPack()); setActiveTab('meta'); setSaveMsg(null); };

  const editPack = (p: CustomPack) => { setEditing(JSON.parse(JSON.stringify(p))); setActiveTab('meta'); setSaveMsg(null); };

  const deletePack = async (id: string) => {
    await tf()?.packBuilder?.delete(id);
    await load();
    if (editing?.id === id) setEditing(null);
  };

  const savePack = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setSaveMsg({ text: 'Name is required.', ok: false }); return; }
    if (!editing.phases.length) { setSaveMsg({ text: 'Add at least one phase.', ok: false }); return; }
    setSaving(true);
    setSaveMsg(null);
    try {
      // Build a proper WorkflowPack shape
      const pack = {
        ...editing,
        phases: editing.phases.map((ph, i) => ({
          id: ph.id,
          name: ph.name || (USABLE_PHASE_KINDS.find(k => k.kind === ph.kind)?.label ?? ph.kind),
          description: ph.description,
          kind: ph.kind,
          requiresApproval: ph.requiresApproval,
          approvalDescription: ph.approvalDescription || undefined,
          onFailure: ph.onFailure,
          optional: ph.optional,
        })),
        estimatedDurationSec: editing.phases.length * 5,
      };
      const res = await tf()?.packBuilder?.save(pack);
      if (res?.ok) {
        setSaveMsg({ text: 'Pack saved.', ok: true });
        await load();
      } else {
        setSaveMsg({ text: res?.error ?? 'Save failed.', ok: false });
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Phases editor helpers ────────────────────────────────────────────────────

  const addPhase = () => {
    if (!editing) return;
    setEditing({ ...editing, phases: [...editing.phases, makePhase()] });
  };

  const updatePhase = (idx: number, patch: Partial<BuilderPhase>) => {
    if (!editing) return;
    const phases = editing.phases.map((p, i) => i === idx ? { ...p, ...patch } : p);
    setEditing({ ...editing, phases });
  };

  const removePhase = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, phases: editing.phases.filter((_, i) => i !== idx) });
  };

  // HTML5 drag-to-reorder
  const handleDragStart = (idx: number) => { dragSrc.current = idx; };
  const handleDragOver  = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOver(idx); };
  const handleDrop      = (idx: number) => {
    if (!editing || dragSrc.current === null || dragSrc.current === idx) { setDragOver(null); return; }
    const phases = [...editing.phases];
    const [moved] = phases.splice(dragSrc.current, 1);
    phases.splice(idx, 0, moved);
    setEditing({ ...editing, phases });
    dragSrc.current = null;
    setDragOver(null);
  };

  return (
    <div style={pb.root}>
      {/* ── Sidebar: saved packs ──────────────────────────────────────────── */}
      <div style={pb.sidebar}>
        <div style={pb.sidebarHeader}>
          <span style={pb.sidebarTitle}>Custom Packs</span>
          <button style={pb.newBtn} onClick={newPack}>+ New</button>
        </div>
        {saved.length === 0 && (
          <p style={pb.sidebarEmpty}>No custom packs yet. Click "+ New" to build one.</p>
        )}
        {saved.map(p => (
          <div
            key={p.id}
            style={{ ...pb.sidebarItem, ...(editing?.id === p.id ? pb.sidebarItemActive : {}) }}
            onClick={() => editPack(p)}
          >
            <div style={pb.sidebarItemName}>{p.name || '(unnamed)'}</div>
            <div style={pb.sidebarItemMeta}>{p.phases.length} phase{p.phases.length !== 1 ? 's' : ''} · {p.category}</div>
            <button
              style={pb.sidebarDeleteBtn}
              onClick={e => { e.stopPropagation(); deletePack(p.id); }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* ── Editor ───────────────────────────────────────────────────────── */}
      <div style={pb.editor}>
        {!editing ? (
          <div style={pb.emptyState}>
            <div style={pb.emptyIcon}>⚙</div>
            <div style={pb.emptyTitle}>Pack Builder</div>
            <p style={pb.emptyDesc}>
              Compose custom workflow packs from existing phase actions — no code required.
              Select a pack from the sidebar or create a new one.
            </p>
            <button style={pb.primaryBtn} onClick={newPack}>Build a Pack</button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={pb.editorHeader}>
              <div>
                <div style={pb.editorTitle}>{editing.name || 'New Pack'}</div>
                <div style={pb.editorId}>{editing.id}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {saveMsg && (
                  <span style={{ fontSize: 12, color: saveMsg.ok ? '#10a37f' : '#ef4444' }}>
                    {saveMsg.text}
                  </span>
                )}
                <button
                  style={{ ...pb.primaryBtn, opacity: saving ? 0.6 : 1 }}
                  onClick={savePack}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save Pack'}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div style={pb.tabs}>
              {(['meta', 'phases'] as const).map(t => (
                <button
                  key={t}
                  style={{ ...pb.tab, ...(activeTab === t ? pb.tabActive : {}) }}
                  onClick={() => setActiveTab(t)}
                >
                  {t === 'meta' ? 'Metadata' : `Phases (${editing.phases.length})`}
                </button>
              ))}
            </div>

            {/* ── Metadata tab ────────────────────────────────────────── */}
            {activeTab === 'meta' && (
              <div style={pb.tabContent}>
                <FieldRow label="Pack Name *">
                  <input style={pb.input} value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="e.g. My Screen Capture Flow" />
                </FieldRow>
                <FieldRow label="Pack ID">
                  <input style={pb.input} value={editing.id}
                    onChange={e => setEditing({ ...editing, id: e.target.value })}
                    placeholder="pack.my-custom-flow" />
                </FieldRow>
                <FieldRow label="Tagline">
                  <input style={pb.input} value={editing.tagline}
                    onChange={e => setEditing({ ...editing, tagline: e.target.value })}
                    placeholder="One-line summary shown in Operate" />
                </FieldRow>
                <FieldRow label="Description">
                  <textarea style={{ ...pb.input, minHeight: 64, resize: 'vertical' as const }}
                    value={editing.description}
                    onChange={e => setEditing({ ...editing, description: e.target.value })}
                    placeholder="What does this pack do?" />
                </FieldRow>
                <FieldRow label="Category">
                  <select style={pb.select} value={editing.category}
                    onChange={e => setEditing({ ...editing, category: e.target.value as WorkflowCategory })}>
                    <option value="perception">Perception (observe)</option>
                    <option value="input">Input (keyboard/click)</option>
                    <option value="diagnostic">Diagnostic (checks)</option>
                    <option value="handoff">Handoff (prepare context)</option>
                  </select>
                </FieldRow>
                <FieldRow label="Success Criteria">
                  <input style={pb.input} value={editing.successCriteria}
                    onChange={e => setEditing({ ...editing, successCriteria: e.target.value })}
                    placeholder="Plain-English definition of success" />
                </FieldRow>
                <FieldRow label="Target App (optional)">
                  <input style={pb.input}
                    value={editing.requirements.targetApp ?? ''}
                    onChange={e => setEditing({
                      ...editing,
                      requirements: { ...editing.requirements, targetApp: e.target.value.trim() || null },
                    })}
                    placeholder="e.g. Xcode (blank = any app)" />
                </FieldRow>
                <div style={pb.checkRow}>
                  <label style={pb.checkLabel}>
                    <input type="checkbox"
                      checked={editing.requirements.permissions.accessibility ?? false}
                      onChange={e => setEditing({
                        ...editing,
                        requirements: { ...editing.requirements, permissions: { ...editing.requirements.permissions, accessibility: e.target.checked } },
                      })} />
                    Requires Accessibility permission
                  </label>
                  <label style={pb.checkLabel}>
                    <input type="checkbox"
                      checked={editing.requirements.permissions.screenRecording ?? false}
                      onChange={e => setEditing({
                        ...editing,
                        requirements: { ...editing.requirements, permissions: { ...editing.requirements.permissions, screenRecording: e.target.checked } },
                      })} />
                    Requires Screen Recording permission
                  </label>
                  <label style={pb.checkLabel}>
                    <input type="checkbox"
                      checked={editing.requirements.providerRequired}
                      onChange={e => setEditing({
                        ...editing,
                        requirements: { ...editing.requirements, providerRequired: e.target.checked },
                      })} />
                    Requires AI provider
                  </label>
                </div>
              </div>
            )}

            {/* ── Phases tab ──────────────────────────────────────────── */}
            {activeTab === 'phases' && (
              <div style={pb.tabContent}>
                {editing.phases.length === 0 && (
                  <p style={pb.phasesEmpty}>No phases yet. Add your first phase below.</p>
                )}
                {editing.phases.map((phase, idx) => (
                  <div
                    key={phase.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={() => setDragOver(null)}
                    style={{
                      ...pb.phaseCard,
                      ...(dragOver === idx ? pb.phaseCardDragOver : {}),
                    }}
                  >
                    <div style={pb.phaseHeader}>
                      <span style={pb.dragHandle}>⠿</span>
                      <span style={pb.phaseIndex}>{idx + 1}</span>
                      <input
                        style={{ ...pb.input, flex: 1, marginRight: 8 }}
                        value={phase.name}
                        placeholder={USABLE_PHASE_KINDS.find(k => k.kind === phase.kind)?.label ?? phase.kind}
                        onChange={e => updatePhase(idx, { name: e.target.value })}
                      />
                      <select
                        style={{ ...pb.select, flex: '0 0 200px' }}
                        value={phase.kind}
                        onChange={e => updatePhase(idx, { kind: e.target.value })}
                      >
                        {KIND_GROUPS.map(g => (
                          <optgroup key={g} label={g}>
                            {USABLE_PHASE_KINDS.filter(k => k.group === g).map(k => (
                              <option key={k.kind} value={k.kind}>{k.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <button style={pb.removePhaseBtn} onClick={() => removePhase(idx)}>✕</button>
                    </div>

                    <div style={pb.phaseBody}>
                      <textarea
                        style={{ ...pb.input, minHeight: 44, resize: 'vertical' as const, width: '100%', marginBottom: 8 }}
                        value={phase.description}
                        placeholder="Describe what this phase does (shown in Sessions)"
                        onChange={e => updatePhase(idx, { description: e.target.value })}
                      />
                      <div style={pb.phaseControls}>
                        <label style={pb.checkLabel}>
                          <input type="checkbox"
                            checked={phase.requiresApproval}
                            onChange={e => updatePhase(idx, { requiresApproval: e.target.checked })} />
                          Requires approval gate
                        </label>
                        <label style={pb.checkLabel}>
                          <input type="checkbox"
                            checked={phase.optional}
                            onChange={e => updatePhase(idx, { optional: e.target.checked })} />
                          Optional (skip if blocked)
                        </label>
                        <label style={{ ...pb.checkLabel, alignItems: 'center' as const, gap: 6 }}>
                          On failure:
                          <select style={{ ...pb.select, width: 'auto', marginTop: 0 }}
                            value={phase.onFailure}
                            onChange={e => updatePhase(idx, { onFailure: e.target.value as OnFailure })}>
                            <option value="stop">Stop run</option>
                            <option value="warn_continue">Warn + continue</option>
                            <option value="ask_user">Ask user</option>
                          </select>
                        </label>
                      </div>
                      {phase.requiresApproval && (
                        <input
                          style={{ ...pb.input, marginTop: 8, width: '100%' }}
                          value={phase.approvalDescription}
                          placeholder="Approval description shown to user…"
                          onChange={e => updatePhase(idx, { approvalDescription: e.target.value })}
                        />
                      )}
                    </div>
                  </div>
                ))}

                <button style={pb.addPhaseBtn} onClick={addPhase}>+ Add Phase</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Field Row helper ──────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={pb.fieldRow}>
      <label style={pb.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pb: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--bg-primary)',
  },

  // Sidebar
  sidebar: {
    width: 220,
    flexShrink: 0,
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 12px 10px',
    borderBottom: '1px solid var(--border)',
  },
  sidebarTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'var(--text-muted)',
  },
  newBtn: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  sidebarEmpty: {
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '14px 12px',
    lineHeight: 1.5,
  },
  sidebarItem: {
    position: 'relative',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  sidebarItemActive: {
    background: 'var(--accent-dim)',
    borderLeft: '2px solid var(--accent)',
  },
  sidebarItemName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    paddingRight: 20,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sidebarItemMeta: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  sidebarDeleteBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 4px',
    opacity: 0.6,
  },

  // Editor
  editor: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyIcon: { fontSize: 36, opacity: 0.3 },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' },
  emptyDesc: { fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 400, lineHeight: 1.6 },
  editorHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  editorTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' },
  editorId: { fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 },

  // Tabs
  tabs: {
    display: 'flex',
    gap: 2,
    padding: '8px 20px 0',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  tab: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-muted)',
    cursor: 'pointer',
    marginBottom: -1,
  },
  tabActive: {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
  },
  tabContent: {
    flex: 1,
    overflowY: 'auto',
    padding: '18px 20px',
  },

  // Form fields
  fieldRow: { marginBottom: 14 },
  fieldLabel: {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontSize: 13,
    padding: '7px 10px',
    outline: 'none',
  },
  select: {
    width: '100%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontSize: 13,
    padding: '7px 10px',
    outline: 'none',
    marginTop: 0,
  },
  checkRow: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 },
  checkLabel: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 13,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },

  // Phases
  phasesEmpty: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 },
  phaseCard: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    marginBottom: 10,
    overflow: 'hidden',
    cursor: 'grab',
  },
  phaseCardDragOver: {
    border: '1px solid var(--accent)',
    boxShadow: '0 0 0 2px var(--accent-dim)',
  },
  phaseHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    background: 'var(--bg-primary)',
    borderBottom: '1px solid var(--border)',
  },
  dragHandle: {
    fontSize: 14,
    color: 'var(--text-muted)',
    cursor: 'grab',
    flexShrink: 0,
  },
  phaseIndex: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    minWidth: 16,
    textAlign: 'center',
    flexShrink: 0,
  },
  phaseBody: { padding: '10px 12px' },
  phaseControls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 20px',
    marginBottom: 4,
  },
  removePhaseBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 13,
    cursor: 'pointer',
    padding: '2px 6px',
    flexShrink: 0,
  },
  addPhaseBtn: {
    background: 'none',
    border: '1px dashed var(--border)',
    borderRadius: 7,
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 600,
    padding: '10px 16px',
    cursor: 'pointer',
    width: '100%',
    marginTop: 4,
  },

  // Shared
  primaryBtn: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
