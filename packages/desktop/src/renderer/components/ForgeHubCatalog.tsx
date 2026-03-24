// ── ForgeHubCatalog.tsx ───────────────────────────────────────────────────────
//
// Phase 7.1–7.2–7.5 — ForgeHub skill catalog, starter packs, and pack manager.
//
// Three tabs:
//   Skills     — searchable/filterable ForgeHub skill catalog (7.1)
//   Packs      — curated starter packs with guided install wizard (7.2 + 7.3)
//   My Packs   — installed RunbookPacks with import/uninstall/rollback (7.5)

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { STARTER_PACKS } from '../starterPacks';
import type { StarterPack } from '../starterPacks';
import { StarterPackInstallWizard } from './StarterPackInstallWizard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubSkill {
  id:          string;
  name:        string;
  version:     string;
  description: string;
  author:      string;
  tags:        string[];
  incomeLanes: string[];
}

interface InstalledSkill {
  id:   string;
  name: string;
}

interface InstalledPack {
  packId:      string;
  name:        string;
  version:     string;
  description: string;
  installedAt: number;
  runbookIds:  string[];
}

type Tab = 'skills' | 'packs' | 'mypacks';

// ── Constants ─────────────────────────────────────────────────────────────────

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

const ALL_LANES = Object.entries(LANE_LABELS);

const tf = () => (window as any).triforge;

// ── ForgeHubCatalog ───────────────────────────────────────────────────────────

export function ForgeHubCatalog({ onBack, initialLane }: { onBack: () => void; initialLane?: string }) {
  const [tab, setTab] = useState<Tab>('skills');

  return (
    <div style={styles.root}>
      {/* Sticky header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <span style={styles.title}>ForgeHub</span>
        <div style={styles.tabBar}>
          <TabBtn label="Skills"    active={tab === 'skills'}   onClick={() => setTab('skills')} />
          <TabBtn label="Packs"     active={tab === 'packs'}    onClick={() => setTab('packs')} />
          <TabBtn label="My Packs"  active={tab === 'mypacks'}  onClick={() => setTab('mypacks')} />
        </div>
      </div>

      {tab === 'skills'  && <SkillsTab  initialLane={initialLane} />}
      {tab === 'packs'   && <PacksTab   onBack={onBack} />}
      {tab === 'mypacks' && <MyPacksTab />}
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// ── Skills Tab (7.1) ──────────────────────────────────────────────────────────

function SkillsTab({ initialLane }: { initialLane?: string }) {
  const [hubSkills,       setHubSkills]       = useState<HubSkill[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [query,           setQuery]           = useState('');
  const [laneFilter,      setLaneFilter]      = useState<string>(initialLane ?? 'all');
  const [installing,      setInstalling]      = useState<Set<string>>(new Set());
  const [installErrors,   setInstallErrors]   = useState<Record<string, string>>({});
  const [justInstalled,   setJustInstalled]   = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hubResult, installedResult] = await Promise.all([
        tf().forgeHub.list() as Promise<{ skills?: HubSkill[] }>,
        tf().skillStore.list() as Promise<{ skills?: InstalledSkill[] }>,
      ]);
      setHubSkills(hubResult.skills ?? []);
      setInstalledSkills(installedResult.skills ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // The first skill listed for each income lane is that lane's "starter" pick.
  const featuredIds = useMemo(() => {
    const seenLanes = new Set<string>();
    const ids = new Set<string>();
    for (const skill of hubSkills) {
      for (const lane of skill.incomeLanes) {
        if (!seenLanes.has(lane)) { seenLanes.add(lane); ids.add(skill.id); }
      }
    }
    return ids;
  }, [hubSkills]);

  const installedNames = useMemo(
    () => new Set(installedSkills.map(s => s.name.toLowerCase())),
    [installedSkills],
  );

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hubSkills.filter(skill => {
      if (laneFilter !== 'all' && !skill.incomeLanes.includes(laneFilter)) return false;
      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags.some(t => t.toLowerCase().includes(q))
      );
    });
  }, [hubSkills, query, laneFilter]);

  const handleInstall = async (skill: HubSkill) => {
    if (installing.has(skill.id)) return;
    setInstalling(prev => new Set(prev).add(skill.id));
    setInstallErrors(prev => { const n = { ...prev }; delete n[skill.id]; return n; });
    try {
      const mdResult = await tf().forgeHub.getMarkdown(skill.id) as { markdown?: string; error?: string };
      if (!mdResult.markdown) {
        setInstallErrors(prev => ({ ...prev, [skill.id]: mdResult.error ?? 'Skill not found.' }));
        return;
      }
      const result = await tf().skillStore.install(mdResult.markdown, 'forgehub') as { success: boolean; error?: string };
      if (!result.success) {
        setInstallErrors(prev => ({ ...prev, [skill.id]: result.error ?? 'Install failed.' }));
        return;
      }
      setJustInstalled(prev => new Set(prev).add(skill.id));
      setInstalledSkills(prev => [...prev, { id: skill.id, name: skill.name }]);
    } catch (e) {
      setInstallErrors(prev => ({ ...prev, [skill.id]: e instanceof Error ? e.message : 'Install failed.' }));
    } finally {
      setInstalling(prev => { const n = new Set(prev); n.delete(skill.id); return n; });
    }
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.filterRow}>
        <input
          style={styles.searchInput}
          placeholder="Search by name, description, or tag..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        <select
          style={styles.laneSelect}
          value={laneFilter}
          onChange={e => setLaneFilter(e.target.value)}
        >
          <option value="all">All Lanes</option>
          {ALL_LANES.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      {(!loading && (query || laneFilter !== 'all')) && (
        <div style={styles.resultsLabel}>
          {filteredSkills.length} result{filteredSkills.length !== 1 ? 's' : ''}
          {laneFilter !== 'all' && ` in ${LANE_LABELS[laneFilter] ?? laneFilter}`}
        </div>
      )}

      {loading && <div style={styles.centerMsg}>Loading catalog...</div>}

      {!loading && filteredSkills.length === 0 && (
        <div style={styles.centerMsg}>No skills match this filter.</div>
      )}

      {!loading && filteredSkills.length > 0 && (
        <>
          {!loading && (
            <div style={styles.catalogMeta}>
              {hubSkills.length} skills · {installedSkills.length} installed
            </div>
          )}
          <div style={styles.skillGrid}>
            {filteredSkills.map(skill => {
              const isInstalled  = installedNames.has(skill.name.toLowerCase()) || justInstalled.has(skill.id);
              const isInstalling = installing.has(skill.id);
              const error        = installErrors[skill.id];
              const isFeatured   = featuredIds.has(skill.id);

              return (
                <div
                  key={skill.id}
                  style={{ ...styles.skillCard, ...(isFeatured ? styles.skillCardFeatured : {}) }}
                >
                  <div style={styles.cardTop}>
                    <div style={styles.cardNameRow}>
                      <span style={styles.cardName}>{skill.name}</span>
                      <span style={styles.cardVersion}>v{skill.version}</span>
                    </div>
                    <div style={styles.cardBadges}>
                      {isFeatured  && <span style={styles.badgeStarter}>Starter</span>}
                      {isInstalled && <span style={styles.badgeInstalled}>Installed</span>}
                    </div>
                  </div>

                  <div style={styles.cardDesc}>{skill.description}</div>

                  <div style={styles.chipRow}>
                    {skill.incomeLanes.map(l => (
                      <span
                        key={l}
                        style={{ ...styles.laneChip, ...(l === laneFilter ? styles.laneChipActive : {}) }}
                        onClick={() => setLaneFilter(l === laneFilter ? 'all' : l)}
                      >
                        {LANE_LABELS[l] ?? l}
                      </span>
                    ))}
                  </div>

                  {skill.tags.length > 0 && (
                    <div style={styles.chipRow}>
                      {skill.tags.map(t => <span key={t} style={styles.tagChip}>{t}</span>)}
                    </div>
                  )}

                  {error && <div style={styles.cardError}>{error}</div>}

                  {!isInstalled && (
                    <button
                      style={{ ...styles.installBtn, ...(isInstalling ? styles.installBtnBusy : {}) }}
                      onClick={() => void handleInstall(skill)}
                      disabled={isInstalling}
                    >
                      {isInstalling ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Packs Tab (7.2 + 7.3) ────────────────────────────────────────────────────

function PacksTab({ onBack }: { onBack: () => void }) {
  const [wizardPack, setWizardPack] = useState<StarterPack | null>(null);

  return (
    <div style={styles.tabContent}>
      <p style={styles.tabIntro}>
        Starter packs bundle the skills, platform requirements, and an experiment template for a specific income lane.
        Install a pack to get set up in minutes.
      </p>

      <div style={styles.packGrid}>
        {STARTER_PACKS.map(pack => (
          <PackCard key={pack.id} pack={pack} onInstall={() => setWizardPack(pack)} />
        ))}
      </div>

      {wizardPack && (
        <StarterPackInstallWizard
          pack={wizardPack}
          onClose={() => setWizardPack(null)}
          onDone={() => { setWizardPack(null); onBack(); }}
        />
      )}
    </div>
  );
}

function PackCard({ pack, onInstall }: { pack: StarterPack; onInstall: () => void }) {
  return (
    <div style={styles.packCard}>
      <div style={styles.packCardHeader}>
        <span style={styles.packName}>{pack.name}</span>
        <span style={styles.packLane}>{LANE_LABELS[pack.laneId] ?? pack.laneId}</span>
      </div>

      <div style={styles.packDesc}>{pack.description}</div>

      <div style={styles.packMeta}>
        <div style={styles.packMetaItem}>
          <span style={styles.packMetaKey}>Skills</span>
          <span style={styles.packMetaVal}>{pack.skillIds.length}</span>
        </div>
        <div style={styles.packMetaItem}>
          <span style={styles.packMetaKey}>Platforms</span>
          <span style={styles.packMetaVal}>{pack.platforms.map(p => p.name).join(', ')}</span>
        </div>
        <div style={styles.packMetaItem}>
          <span style={styles.packMetaKey}>Budget</span>
          <span style={styles.packMetaVal}>${pack.template.budgetAsk}</span>
        </div>
      </div>

      <button style={styles.installPackBtn} onClick={onInstall}>
        Install Pack →
      </button>
    </div>
  );
}

// ── My Packs Tab (7.5) ───────────────────────────────────────────────────────

function MyPacksTab() {
  const [packs,      setPacks]      = useState<InstalledPack[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [importMode, setImportMode] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importing,  setImporting]  = useState(false);
  const [importMsg,  setImportMsg]  = useState<string | null>(null);
  const [importErr,  setImportErr]  = useState<string | null>(null);
  const [removing,   setRemoving]   = useState<Set<string>>(new Set());

  const loadPacks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await tf().pack.list() as { packs: InstalledPack[] };
      setPacks(result.packs ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPacks(); }, [loadPacks]);

  const handleUninstall = async (packId: string) => {
    if (!confirm('Uninstall this pack? Runbooks it owns will be removed.')) return;
    setRemoving(prev => new Set(prev).add(packId));
    try {
      await tf().pack.uninstall(packId);
      void loadPacks();
    } finally {
      setRemoving(prev => { const n = new Set(prev); n.delete(packId); return n; });
    }
  };

  const handleImport = async () => {
    if (!importJson.trim()) { setImportErr('Paste pack JSON first.'); return; }
    setImporting(true);
    setImportErr(null);
    setImportMsg(null);
    try {
      const preview = await tf().pack.previewImport(importJson.trim()) as { ok: boolean; preview?: { pack?: { name?: string } }; error?: string };
      if (!preview.ok) { setImportErr(preview.error ?? 'Invalid pack JSON.'); return; }

      const result = await tf().pack.import(importJson.trim()) as { ok: boolean; installedIds?: string[]; updatedIds?: string[]; error?: string };
      if (!result.ok) { setImportErr(result.error ?? 'Import failed.'); return; }

      const count = (result.installedIds?.length ?? 0) + (result.updatedIds?.length ?? 0);
      setImportMsg(`Pack imported — ${count} runbook${count !== 1 ? 's' : ''} installed.`);
      setImportJson('');
      setImportMode(false);
      void loadPacks();
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.myPacksHeader}>
        <span style={styles.tabIntro}>Installed automation packs.</span>
        <button style={styles.importBtn} onClick={() => { setImportMode(v => !v); setImportErr(null); setImportMsg(null); }}>
          {importMode ? 'Cancel' : 'Import Pack'}
        </button>
      </div>

      {importMsg && <div style={styles.importSuccess}>{importMsg}</div>}

      {importMode && (
        <div style={styles.importPanel}>
          <div style={styles.importLabel}>Paste pack JSON</div>
          <textarea
            style={styles.importTextarea}
            value={importJson}
            onChange={e => setImportJson(e.target.value)}
            placeholder='{"schemaVersion":"35","id":"...","name":"...","runbooks":[...]}'
            rows={6}
            autoFocus
          />
          {importErr && <div style={styles.importError}>{importErr}</div>}
          <div style={styles.importActions}>
            <button
              style={{ ...styles.importConfirmBtn, ...(importing ? styles.importConfirmBusy : {}) }}
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {loading && <div style={styles.centerMsg}>Loading packs...</div>}

      {!loading && packs.length === 0 && !importMode && (
        <div style={styles.centerMsg}>No packs installed. Import a pack JSON to get started.</div>
      )}

      {!loading && packs.length > 0 && (
        <div style={styles.installedPackList}>
          {packs.map(pack => (
            <div key={pack.packId} style={styles.installedPackRow}>
              <div style={styles.installedPackInfo}>
                <div style={styles.installedPackName}>{pack.name}</div>
                <div style={styles.installedPackMeta}>
                  v{pack.version} · {pack.runbookIds.length} runbook{pack.runbookIds.length !== 1 ? 's' : ''}
                  {' · installed '}
                  {new Date(pack.installedAt).toLocaleDateString()}
                </div>
                {pack.description && (
                  <div style={styles.installedPackDesc}>{pack.description}</div>
                )}
              </div>
              <button
                style={{
                  ...styles.uninstallBtn,
                  ...(removing.has(pack.packId) ? styles.uninstallBtnBusy : {}),
                }}
                onClick={() => void handleUninstall(pack.packId)}
                disabled={removing.has(pack.packId)}
              >
                {removing.has(pack.packId) ? 'Removing...' : 'Uninstall'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  root: {
    background: '#0d0d0f',
    minHeight: '100vh',
    paddingBottom: 48,
    color: '#f0f0f5',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    overflowY: 'auto' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(13,13,15,0.96)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    color: 'rgba(255,255,255,0.55)',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 12,
    cursor: 'pointer',
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f0f0f5',
    letterSpacing: '-0.3px',
    marginRight: 8,
  },
  tabBar: {
    display: 'flex',
    gap: 2,
    flex: 1,
  },
  tab: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    padding: '5px 12px',
    cursor: 'pointer',
  },
  tabActive: {
    background: 'rgba(167,139,250,0.1)',
    border: '1px solid rgba(167,139,250,0.25)',
    color: '#a78bfa',
  },
  tabContent: {
    padding: '14px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  tabIntro: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 1.5,
    margin: 0,
  },
  catalogMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.28)',
  },
  // ── Skills ────────────────────────────────────────────────────────────────
  filterRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 7,
    padding: '8px 14px',
    color: '#f0f0f5',
    fontSize: 13,
    outline: 'none',
  },
  laneSelect: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 7,
    padding: '8px 12px',
    color: '#f0f0f5',
    fontSize: 12,
    cursor: 'pointer',
    outline: 'none',
    minWidth: 145,
  },
  resultsLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  centerMsg: {
    padding: '40px 0',
    textAlign: 'center' as const,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
  },
  skillGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12,
  },
  skillCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 14,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  skillCardFeatured: {
    border: '1px solid rgba(167,139,250,0.28)',
    background: 'rgba(167,139,250,0.03)',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardNameRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap' as const,
    minWidth: 0,
  },
  cardName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f0f5',
  },
  cardVersion: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.28)',
    flexShrink: 0,
  },
  cardBadges: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  badgeStarter: {
    fontSize: 9,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'rgba(167,139,250,0.14)',
    color: '#a78bfa',
    border: '1px solid rgba(167,139,250,0.3)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  badgeInstalled: {
    fontSize: 9,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'rgba(74,222,128,0.11)',
    color: '#4ade80',
    border: '1px solid rgba(74,222,128,0.28)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  cardDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 1.5,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  laneChip: {
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    background: 'rgba(96,165,250,0.09)',
    color: 'rgba(96,165,250,0.8)',
    border: '1px solid rgba(96,165,250,0.18)',
    cursor: 'pointer',
  },
  laneChipActive: {
    background: 'rgba(96,165,250,0.18)',
    border: '1px solid rgba(96,165,250,0.42)',
    color: '#60a5fa',
  },
  tagChip: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.3)',
  },
  cardError: {
    fontSize: 11,
    color: '#f87171',
    background: 'rgba(248,113,113,0.07)',
    border: '1px solid rgba(248,113,113,0.18)',
    borderRadius: 5,
    padding: '5px 8px',
  },
  installBtn: {
    marginTop: 2,
    background: 'rgba(167,139,250,0.1)',
    border: '1px solid rgba(167,139,250,0.28)',
    borderRadius: 6,
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: 500,
    padding: '6px 13px',
    cursor: 'pointer',
    alignSelf: 'flex-start' as const,
  },
  installBtnBusy: {
    opacity: 0.45,
    cursor: 'not-allowed' as const,
  },
  // ── Packs ─────────────────────────────────────────────────────────────────
  packGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 14,
  },
  packCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10,
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  packCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  packName: {
    fontSize: 14,
    fontWeight: 700,
    color: '#f0f0f5',
  },
  packLane: {
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    background: 'rgba(96,165,250,0.1)',
    color: '#60a5fa',
    border: '1px solid rgba(96,165,250,0.2)',
  },
  packDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 1.55,
  },
  packMeta: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  packMetaItem: {
    display: 'flex',
    gap: 8,
    fontSize: 11,
  },
  packMetaKey: {
    color: 'rgba(255,255,255,0.3)',
    width: 64,
    flexShrink: 0,
  },
  packMetaVal: {
    color: 'rgba(255,255,255,0.65)',
  },
  installPackBtn: {
    marginTop: 4,
    background: 'rgba(167,139,250,0.12)',
    border: '1px solid rgba(167,139,250,0.3)',
    borderRadius: 7,
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: 500,
    padding: '7px 14px',
    cursor: 'pointer',
    alignSelf: 'flex-start' as const,
  },
  // ── My Packs ──────────────────────────────────────────────────────────────
  myPacksHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  importBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    padding: '5px 12px',
    cursor: 'pointer',
  },
  importPanel: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 8,
    padding: 14,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  importLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  importTextarea: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#f0f0f5',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  importError: {
    fontSize: 11,
    color: '#f87171',
    background: 'rgba(248,113,113,0.07)',
    border: '1px solid rgba(248,113,113,0.18)',
    borderRadius: 5,
    padding: '5px 8px',
  },
  importSuccess: {
    fontSize: 12,
    color: '#4ade80',
    background: 'rgba(74,222,128,0.08)',
    border: '1px solid rgba(74,222,128,0.2)',
    borderRadius: 6,
    padding: '8px 12px',
  },
  importActions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  importConfirmBtn: {
    background: 'rgba(167,139,250,0.12)',
    border: '1px solid rgba(167,139,250,0.28)',
    borderRadius: 6,
    color: '#a78bfa',
    fontSize: 12,
    padding: '6px 14px',
    cursor: 'pointer',
  },
  importConfirmBusy: {
    opacity: 0.45,
    cursor: 'not-allowed' as const,
  },
  installedPackList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  installedPackRow: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  installedPackInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
    minWidth: 0,
  },
  installedPackName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f0f5',
  },
  installedPackMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
  },
  installedPackDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  uninstallBtn: {
    background: 'transparent',
    border: '1px solid rgba(248,113,113,0.25)',
    borderRadius: 6,
    color: 'rgba(248,113,113,0.7)',
    fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  uninstallBtnBusy: {
    opacity: 0.45,
    cursor: 'not-allowed' as const,
  },
} as const;
