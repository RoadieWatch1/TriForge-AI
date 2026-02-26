import React, { useState, useEffect } from 'react';

interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
}

interface LedgerEntry {
  id: string;
  timestamp: number;
  request: string;
  synthesis: string;
  forgeScore?: ForgeScore;
  responses?: Array<{ provider: string; text: string }>;
  workflow?: string;
  starred: boolean;
}

const RISK_COLORS: Record<string, string> = { Low: '#10a37f', Medium: '#f59e0b', High: '#ef4444' };
const PROVIDER_COLORS: Record<string, string> = { openai: '#10a37f', claude: '#d97706', gemini: '#4285f4' };
const PROVIDER_LABELS: Record<string, string> = { openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini' };

function formatAge(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface LedgerProps {
  tier: string;
  onUpgradeClick: () => void;
}

export function Ledger({ tier, onUpgradeClick }: LedgerProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState<string | null>(null);

  const isLocked = tier === 'free';

  useEffect(() => {
    if (isLocked) return;
    const timer = setTimeout(() => {
      window.triforge.ledger.get(search || undefined).then(setEntries as (v: unknown) => void);
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, isLocked]);

  const reload = async () => {
    const updated = await window.triforge.ledger.get(search || undefined) as unknown as LedgerEntry[];
    setEntries(updated);
  };

  const handleStar = async (id: string, starred: boolean) => {
    const updated = await window.triforge.ledger.star(id, !starred) as unknown as LedgerEntry[];
    setEntries(updated);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this decision from your ledger?')) return;
    const updated = await window.triforge.ledger.delete(id) as unknown as LedgerEntry[];
    setEntries(updated);
    if (expanded === id) setExpanded(null);
  };

  const handleExport = async (id: string | null, format: 'md' | 'pdf') => {
    const key = (id ?? 'all') + format;
    setExporting(key);
    try { await window.triforge.ledger.export(id, format); } finally { setExporting(null); }
  };

  const starred = entries.filter(e => e.starred);
  const rest = entries.filter(e => !e.starred);
  const sorted = [...starred, ...rest];

  if (isLocked) {
    return (
      <div style={{ ...s.page, alignItems: 'center', justifyContent: 'center' }}>
        <div style={s.upgradeGate}>
          <div style={s.upgradeIcon}>📋</div>
          <div style={s.upgradeTitle}>Decision Ledger</div>
          <div style={s.upgradeDesc}>
            Every Think Tank answer is automatically saved, searchable, and exportable — all in one place.
            This feature is available on Pro and Business plans.
          </div>
          <div style={s.upgradeFeatures}>
            <span style={s.upgradeFeature}>✓ Auto-save every Think Tank result</span>
            <span style={s.upgradeFeature}>✓ Search and filter all decisions</span>
            <span style={s.upgradeFeature}>✓ Star important entries</span>
            <span style={s.upgradeFeature}>✓ Export to Markdown &amp; PDF</span>
          </div>
          <button style={s.upgradeBtn} onClick={onUpgradeClick}>
            ⭐ Upgrade to Pro — $19/mo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h2 style={s.title}>📋 Decision Ledger</h2>
          <p style={s.subtitle}>Every Think Tank result is automatically saved here. Searchable, exportable, starred.</p>
        </div>
        <div style={s.headerActions}>
          <button
            style={{ ...s.exportBtn, ...(exporting === 'allmd' ? s.exportBtnDisabled : {}) }}
            onClick={() => handleExport(null, 'md')} disabled={!!exporting || entries.length === 0}
          >{exporting === 'allmd' ? 'Saving…' : '⬇ Export All MD'}</button>
          <button
            style={{ ...s.exportBtn, ...s.exportBtnPrimary, ...(exporting === 'allpdf' ? s.exportBtnDisabled : {}) }}
            onClick={() => handleExport(null, 'pdf')} disabled={!!exporting || entries.length === 0}
          >{exporting === 'allpdf' ? 'Saving…' : '⬇ Export All PDF'}</button>
        </div>
      </div>

      {/* Search */}
      <div style={s.searchRow}>
        <input
          style={s.searchInput}
          placeholder="Search decisions, workflows, or any keyword…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button style={s.clearSearch} onClick={() => setSearch('')}>✕</button>
        )}
        <span style={s.entryCount}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
      </div>

      {/* Entries */}
      <div style={s.list}>
        {sorted.length === 0 && (
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>📋</div>
            <div style={s.emptyTitle}>
              {search ? 'No results found' : 'Your ledger is empty'}
            </div>
            <div style={s.emptyDesc}>
              {search
                ? 'Try a different search term'
                : 'Every Think Tank answer is automatically saved here. Ask the Think Tank anything to get started.'}
            </div>
          </div>
        )}

        {sorted.map(entry => {
          const isExpanded = expanded === entry.id;
          const riskColor = entry.forgeScore ? (RISK_COLORS[entry.forgeScore.risk] ?? '#f59e0b') : null;
          const tab = activeTab[entry.id] ?? 0;

          return (
            <div key={entry.id} style={{ ...s.entryCard, ...(isExpanded ? s.entryCardOpen : {}), ...(entry.starred ? s.entryCardStarred : {}) }}>
              {/* Collapsed header row */}
              <div style={s.entryRow}>
                {/* Star */}
                <button style={s.starBtn} onClick={() => handleStar(entry.id, entry.starred)}
                  title={entry.starred ? 'Unstar' : 'Star'}>
                  {entry.starred ? '⭐' : '☆'}
                </button>

                {/* Content summary */}
                <div style={s.entrySummary} onClick={() => setExpanded(isExpanded ? null : entry.id)}>
                  <div style={s.entryRequest}>
                    {entry.workflow && <span style={s.workflowBadge}>{entry.workflow}</span>}
                    {entry.request.slice(0, 120)}{entry.request.length > 120 ? '…' : ''}
                  </div>
                  <div style={s.entryMeta}>
                    <span style={s.entryAge}>{formatAge(entry.timestamp)}</span>
                    {riskColor && (
                      <span style={{ ...s.riskPill, background: riskColor + '22', color: riskColor, border: `1px solid ${riskColor}44` }}>
                        {entry.forgeScore!.risk} Risk
                      </span>
                    )}
                    {entry.forgeScore && (
                      <span style={s.confPill}>{entry.forgeScore.confidence}% confidence</span>
                    )}
                    {entry.responses && (
                      <span style={s.providerPill}>{entry.responses.length} AI{entry.responses.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>

                {/* Expand chevron */}
                <button style={s.chevronBtn} onClick={() => setExpanded(isExpanded ? null : entry.id)}>
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={s.entryDetail}>

                  {/* Synthesis */}
                  <div style={s.detailSection}>
                    <div style={s.detailSectionLabel}>SYNTHESIS</div>
                    <div style={s.synthesisText}>{entry.synthesis}</div>
                  </div>

                  {/* Forge Score */}
                  {entry.forgeScore && (
                    <div style={s.detailSection}>
                      <div style={s.detailSectionLabel}>FORGE SCORE</div>
                      <div style={s.forgeGrid}>
                        <ForgeBar confidence={entry.forgeScore.confidence} />
                        {entry.forgeScore.agreement    && <ForgeDetailRow icon="✅" label="Agreement"    text={entry.forgeScore.agreement} />}
                        {entry.forgeScore.disagreement && <ForgeDetailRow icon="⚠️" label="Disagreement" text={entry.forgeScore.disagreement} />}
                        {entry.forgeScore.assumptions  && <ForgeDetailRow icon="💭" label="Assumptions"  text={entry.forgeScore.assumptions} />}
                        {entry.forgeScore.verify       && <ForgeDetailRow icon="🔍" label="Verify"       text={entry.forgeScore.verify} />}
                      </div>
                    </div>
                  )}

                  {/* Individual AI responses */}
                  {entry.responses && entry.responses.length > 1 && (
                    <div style={s.detailSection}>
                      <div style={s.detailSectionLabel}>INDIVIDUAL AI RESPONSES</div>
                      <div style={s.tabBar}>
                        {entry.responses.map((r, i) => (
                          <button key={r.provider}
                            style={{ ...s.tab, ...(tab === i ? s.tabActive : {}) }}
                            onClick={() => setActiveTab(t => ({ ...t, [entry.id]: i }))}>
                            <span style={{ color: PROVIDER_COLORS[r.provider.toLowerCase()] ?? 'var(--accent)' }}>●</span>
                            {' '}{PROVIDER_LABELS[r.provider.toLowerCase()] ?? r.provider}
                          </button>
                        ))}
                      </div>
                      <div style={s.tabContent}>{entry.responses[tab]?.text}</div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={s.entryActions}>
                    <button style={s.actionBtn}
                      disabled={!!exporting}
                      onClick={() => handleExport(entry.id, 'md')}>
                      {exporting === entry.id + 'md' ? 'Saving…' : '⬇ MD'}
                    </button>
                    <button style={{ ...s.actionBtn, ...s.actionBtnPrimary }}
                      disabled={!!exporting}
                      onClick={() => handleExport(entry.id, 'pdf')}>
                      {exporting === entry.id + 'pdf' ? 'Saving…' : '⬇ PDF'}
                    </button>
                    <div style={{ flex: 1 }} />
                    <button style={s.deleteBtn} onClick={() => handleDelete(entry.id)}>
                      🗑 Delete
                    </button>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ForgeBar({ confidence }: { confidence: number }) {
  const color = confidence >= 75 ? '#10a37f' : confidence >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 80 }}>Confidence</span>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${confidence}%`, background: color, borderRadius: 3, transition: 'width 0.6s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 36, textAlign: 'right' }}>{confidence}%</span>
    </div>
  );
}

function ForgeDetailRow({ icon, label, text }: { icon: string; label: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ width: 18, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontWeight: 600 }}>{label}: </span>
      <span style={{ color: 'var(--text-secondary)' }}>{text}</span>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' },

  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 24px 0', flexShrink: 0 },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' },
  subtitle: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },
  headerActions: { display: 'flex', gap: 8, flexShrink: 0, marginTop: 4 },

  exportBtn: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
  exportBtnPrimary: { background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 },
  exportBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  searchRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '16px 24px 12px', flexShrink: 0 },
  searchInput: { flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '8px 14px', outline: 'none' },
  clearSearch: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', padding: '4px 8px' },
  entryCount: { fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' },

  list: { flex: 1, overflowY: 'auto', padding: '0 24px 32px', display: 'flex', flexDirection: 'column', gap: 8 },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60, textAlign: 'center' },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' },
  emptyDesc: { fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400, lineHeight: 1.6 },

  entryCard: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  entryCardOpen: { border: '1px solid var(--accent)44' },
  entryCardStarred: { border: '1px solid #f59e0b44', background: '#f59e0b05' },

  entryRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' },
  starBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', flexShrink: 0, padding: '0 2px', opacity: 0.8 },
  entrySummary: { flex: 1, cursor: 'pointer', minWidth: 0 },
  entryRequest: { fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.4, marginBottom: 4, wordBreak: 'break-word' },
  entryMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  entryAge: { fontSize: 11, color: 'var(--text-muted)' },
  riskPill: { fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  confPill: { fontSize: 11, color: 'var(--text-muted)' },
  providerPill: { fontSize: 11, color: 'var(--text-muted)' },
  workflowBadge: { display: 'inline-block', fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 4, padding: '1px 6px', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.04em' },
  chevronBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: '4px 8px', flexShrink: 0 },

  entryDetail: { borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 0 },
  detailSection: { padding: '14px 16px', borderBottom: '1px solid var(--border)' },
  detailSectionLabel: { fontSize: 9, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 },
  synthesisText: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' },
  forgeGrid: { display: 'flex', flexDirection: 'column', gap: 6 },

  tabBar: { display: 'flex', gap: 4, marginBottom: 10 },
  tab: { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  tabActive: { background: 'var(--accent)22', border: '1px solid var(--accent)55', color: 'var(--text-primary)' },
  tabContent: { fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' },

  entryActions: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' },
  actionBtn: { background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' },
  actionBtnPrimary: { background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 },
  deleteBtn: { background: 'none', border: '1px solid var(--border)', color: '#ef4444', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' },

  // Upgrade gate
  upgradeGate: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 16,
    maxWidth: 420, textAlign: 'center' as const, padding: 32,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 16,
  },
  upgradeIcon: { fontSize: 48 },
  upgradeTitle: { fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' },
  upgradeDesc: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 },
  upgradeFeatures: { display: 'flex', flexDirection: 'column' as const, gap: 6, alignItems: 'flex-start', width: '100%' },
  upgradeFeature: { fontSize: 13, color: '#10a37f', fontWeight: 500 },
  upgradeBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    color: '#fff', border: 'none', borderRadius: 10,
    padding: '12px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
    width: '100%', marginTop: 4,
  },
};
