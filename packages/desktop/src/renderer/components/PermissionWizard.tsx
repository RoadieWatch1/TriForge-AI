import React, { useState } from 'react';
import type { Permission } from '../../main/store';

interface Props {
  permissions: Permission[];
  onComplete: (updated: Permission[]) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  system: '🖥  System Access',
  communication: '📬  Communication',
  business: '💼  Business Tools',
  finance: '📈  Finance & Investments',
};

const CATEGORY_ORDER = ['system', 'communication', 'business', 'finance'];

export function PermissionWizard({ permissions, onComplete }: Props) {
  const [perms, setPerms] = useState<Permission[]>(permissions);
  const [budgets, setBudgets] = useState<Record<string, string>>({});

  const toggle = (key: string) => {
    setPerms(p => p.map(x => x.key === key ? { ...x, granted: !x.granted } : x));
  };

  const grouped = CATEGORY_ORDER.reduce<Record<string, Permission[]>>((acc, cat) => {
    acc[cat] = perms.filter(p => p.category === cat);
    return acc;
  }, {});

  const handleDone = async () => {
    for (const p of perms) {
      const budget = p.budgetLimit !== undefined ? parseFloat(budgets[p.key] ?? '0') : undefined;
      await window.triforge.permissions.set(p.key, p.granted, budget);
    }
    await window.triforge.permissions.markDone();
    onComplete(perms);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>⚡</div>
          <h1 style={styles.title}>Welcome to TriForge AI</h1>
          <p style={styles.subtitle}>
            Your personal think tank. Choose what TriForge can access —
            you can change this anytime in Settings.
          </p>
        </div>

        {/* Permission groups */}
        <div style={styles.groups}>
          {CATEGORY_ORDER.map(cat => (
            <div key={cat} style={styles.group}>
              <div style={styles.groupLabel}>{CATEGORY_LABELS[cat]}</div>
              {grouped[cat].map(p => (
                <div key={p.key} style={styles.row}>
                  <div style={styles.rowLeft}>
                    <button
                      style={{ ...styles.toggle, ...(p.granted ? styles.toggleOn : {}) }}
                      onClick={() => toggle(p.key)}
                      aria-pressed={p.granted}
                    >
                      <div style={{ ...styles.toggleKnob, ...(p.granted ? styles.toggleKnobOn : {}) }} />
                    </button>
                    <div>
                      <div style={styles.permLabel}>{p.label}</div>
                      <div style={styles.permDesc}>{p.description}</div>
                    </div>
                  </div>
                  {p.granted && p.budgetLimit !== undefined && (
                    <div style={styles.budgetRow}>
                      <span style={styles.budgetLabel}>Monthly limit $</span>
                      <input
                        type="number"
                        min="0"
                        style={styles.budgetInput}
                        placeholder="0"
                        value={budgets[p.key] ?? ''}
                        onChange={e => setBudgets(b => ({ ...b, [p.key]: e.target.value }))}
                      />
                    </div>
                  )}
                  {p.granted && p.requireConfirm && (
                    <div style={styles.confirmBadge}>Requires confirmation</div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p style={styles.footerNote}>
            Keys are stored locally. TriForge never sends your data to third parties.
          </p>
          <button style={styles.doneBtn} onClick={handleDone}>
            Let's go →
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'var(--bg-base)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    zIndex: 100,
    overflowY: 'auto',
    padding: '24px 16px',
  },
  card: {
    width: '100%', maxWidth: 560,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '32px',
    display: 'flex', flexDirection: 'column', gap: 24,
    // margin: auto centers when content fits; collapses to 0 when scrolling needed
    marginTop: 'auto', marginBottom: 'auto',
  },
  header: { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  logo: { fontSize: 40 },
  title: { fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' },
  subtitle: { fontSize: 14, color: 'var(--text-secondary)', maxWidth: 400, textAlign: 'center' },

  groups: { display: 'flex', flexDirection: 'column', gap: 20 },
  group: { display: 'flex', flexDirection: 'column', gap: 8 },
  groupLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 },

  row: { display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' },
  rowLeft: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  permLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  permDesc: { fontSize: 12, color: 'var(--text-secondary)' },

  toggle: { flexShrink: 0, width: 36, height: 20, borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', marginTop: 2 },
  toggleOn: { background: 'var(--accent)', border: '1px solid var(--accent)' },
  toggleKnob: { position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' },
  toggleKnobOn: { left: 18 },

  budgetRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, marginLeft: 48 },
  budgetLabel: { fontSize: 12, color: 'var(--text-secondary)' },
  budgetInput: { width: 80, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, padding: '3px 8px' },

  confirmBadge: { marginLeft: 48, fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 4, padding: '1px 6px', width: 'fit-content' },

  footer: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  footerNote: { fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' },
  doneBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '12px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
    letterSpacing: '0.01em',
  },
};
