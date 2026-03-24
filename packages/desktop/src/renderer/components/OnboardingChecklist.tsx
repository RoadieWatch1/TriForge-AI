import React, { useState, useEffect, useCallback } from 'react';

export interface ChecklistItem {
  id: string;
  label: string;
  desc: string;
  screen?: string;
  done: boolean;
}

interface OnboardingChecklistProps {
  onNavigate: (screen: string) => void;
  onDismiss?: () => void;
}

const BASE_ITEMS: Omit<ChecklistItem, 'done'>[] = [
  { id: 'api_keys',    label: 'Connect all 3 AI providers', desc: 'OpenAI, Claude, and Grok needed for full Think Tank consensus', screen: 'settings' },
  { id: 'integration', label: 'Connect an integration',     desc: 'GitHub, Slack, Jira, or Linear to unlock team workflows',       screen: 'settings' },
  { id: 'runbook',     label: 'Create your first runbook',  desc: 'Automate a repeatable workflow in the Automate screen',          screen: 'automation' },
  { id: 'session_lock',label: 'Enable session lock',        desc: 'Protect TriForge with a PIN in Settings',                        screen: 'settings' },
  { id: 'starter_pack',label: 'Import a starter pack',      desc: 'Get up and running with pre-built automation recipes',           screen: 'automation' },
];

const STORAGE_KEY = 'triforge-onboarding-done';

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveDone(done: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...done])); } catch { /* ok */ }
}

export function OnboardingChecklist({ onNavigate, onDismiss }: OnboardingChecklistProps) {
  const [items,     setItems]     = useState<ChecklistItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const buildItems = useCallback(async (isMounted: () => boolean) => {
    const done = loadDone();

    // Auto-detect completions from live state
    try {
      const keys = await window.triforge.keys.status();
      const allKeys = Object.values(keys as Record<string, boolean>).filter(Boolean).length >= 3;
      if (allKeys) done.add('api_keys');
    } catch { /* ok */ }

    try {
      const auth = await window.triforge.auth.status();
      if (auth.hasPin) done.add('session_lock');
    } catch { /* ok */ }

    try {
      const gh = await window.triforge.github.testConnection();
      if (gh.ok) done.add('integration');
    } catch { /* ok */ }

    if (!isMounted()) return;
    saveDone(done);
    setItems(BASE_ITEMS.map(item => ({ ...item, done: done.has(item.id) })));
  }, []);

  useEffect(() => {
    let mounted = true;
    buildItems(() => mounted);
    return () => { mounted = false; };
  }, [buildItems]);

  const markDone = (id: string) => {
    const done = loadDone();
    done.add(id);
    saveDone(done);
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: true } : i));
  };

  if (dismissed) return null;

  const completedCount = items.filter(i => i.done).length;
  const allDone = completedCount === items.length;

  if (allDone) return null; // Checklist complete — no need to show

  return (
    <div style={s.card}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.headerTitle}>Getting Started</span>
          <span style={s.headerProgress}>
            {completedCount} / {items.length}
          </span>
        </div>
        <div style={s.headerActions}>
          <button style={s.iconBtn} onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '▿' : '▴'}
          </button>
          <button style={s.iconBtn} onClick={() => { setDismissed(true); onDismiss?.(); }} title="Dismiss">
            ×
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={s.progressBar}>
        <div style={{ ...s.progressFill, width: `${(completedCount / items.length) * 100}%` }} />
      </div>

      {!collapsed && (
        <div style={s.list}>
          {items.map(item => (
            <div key={item.id} style={s.item}>
              <button
                style={{ ...s.check, ...(item.done ? s.checkDone : {}) }}
                onClick={() => !item.done && markDone(item.id)}
                title={item.done ? 'Complete' : 'Mark done'}
              >
                {item.done && <span style={s.checkMark}>✓</span>}
              </button>
              <div style={s.itemBody}>
                <span style={{ ...s.itemLabel, ...(item.done ? s.itemLabelDone : {}) }}>
                  {item.label}
                </span>
                <span style={s.itemDesc}>{item.desc}</span>
              </div>
              {!item.done && item.screen && (
                <button
                  style={s.goBtn}
                  onClick={() => { onNavigate(item.screen!); }}
                >
                  Go →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px',
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  headerTitle: {
    fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
  },
  headerProgress: {
    fontSize: 11, color: 'var(--text-muted)',
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 10, padding: '1px 7px',
  },
  headerActions: {
    display: 'flex', gap: 4,
  },
  iconBtn: {
    width: 22, height: 22, border: 'none',
    background: 'transparent', cursor: 'pointer',
    color: 'var(--text-muted)', fontSize: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 4,
  },
  progressBar: {
    height: 2, background: 'var(--border)',
  },
  progressFill: {
    height: '100%', background: 'var(--accent)',
    transition: 'width 0.4s ease',
  },
  list: {
    padding: '8px 0',
  },
  item: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 14px',
  },
  check: {
    width: 18, height: 18,
    border: '1px solid var(--border)',
    borderRadius: 4, background: 'transparent',
    cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  checkDone: {
    background: 'var(--accent)', borderColor: 'var(--accent)',
  },
  checkMark: { color: '#fff', fontSize: 10, fontWeight: 700 },
  itemBody: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: 1,
  },
  itemLabel: {
    fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
  },
  itemLabelDone: {
    color: 'var(--text-muted)', textDecoration: 'line-through',
  },
  itemDesc: {
    fontSize: 11, color: 'var(--text-muted)',
  },
  goBtn: {
    height: 22, padding: '0 8px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 4, color: 'var(--accent)', fontSize: 11,
    cursor: 'pointer', flexShrink: 0,
  },
};
