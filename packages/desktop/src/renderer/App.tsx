import React, { useState, useEffect } from 'react';
import type { Permission } from '../main/store';
import { PermissionWizard } from './components/PermissionWizard';
import { Chat } from './components/Chat';
import { LicensePanel } from './components/LicensePanel';

type Screen = 'chat' | 'settings' | 'memory' | 'plan';

export function App() {
  const [ready, setReady] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({ openai: false, claude: false, gemini: false });
  const [mode, setMode] = useState('none');
  const [screen, setScreen] = useState<Screen>('chat');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({ openai: '', claude: '', gemini: '' });
  const [saving, setSaving] = useState<string | null>(null);
  const [tier, setTier] = useState<string>('free');
  const [messagesThisMonth, setMessagesThisMonth] = useState(0);

  useEffect(() => {
    async function init() {
      const [isFirst, perms, keys, lic, usage] = await Promise.all([
        window.triforge.permissions.isFirstRun(),
        window.triforge.permissions.get(),
        window.triforge.keys.status(),
        window.triforge.license.load(),
        window.triforge.usage.get(),
      ]);
      setFirstRun(isFirst);
      setPermissions(perms);
      setKeyStatus(keys);
      setTier(lic.tier ?? 'free');
      setMessagesThisMonth(usage.messagesThisMonth);
      if (!isFirst) {
        try {
          const m = await window.triforge.engine.mode();
          setMode(m);
        } catch { /* no keys yet */ }
      }
      setReady(true);
    }
    init();
  }, []);

  const refreshKeys = async () => {
    const keys = await window.triforge.keys.status();
    setKeyStatus(keys);
    try { setMode(await window.triforge.engine.mode()); } catch { setMode('none'); }
  };

  const saveKey = async (provider: string) => {
    const key = apiKeys[provider].trim();
    if (!key) return;
    setSaving(provider);
    try {
      await window.triforge.keys.set(provider, key);
      await refreshKeys();
      setApiKeys(k => ({ ...k, [provider]: '' }));
    } finally {
      setSaving(null);
    }
  };

  const removeKey = async (provider: string) => {
    await window.triforge.keys.delete(provider);
    await refreshKeys();
  };

  const handleWizardDone = async (updated: Permission[]) => {
    setPermissions(updated);
    setFirstRun(false);
    try { setMode(await window.triforge.engine.mode()); } catch { /* ok */ }
  };

  if (!ready) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Starting…</span></div>;

  if (firstRun) return <PermissionWizard permissions={permissions} onComplete={handleWizardDone} />;

  return (
    <div style={styles.shell}>
      {/* Custom title bar */}
      <div style={styles.titlebar}>
        <div style={styles.trafficLights} />
        <span style={styles.appName}>⚡ TriForge AI</span>
        <div style={styles.titlebarSpacer} />
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar */}
        <nav style={styles.sidebar}>
          <NavBtn icon="💬" label="Chat"     active={screen === 'chat'}     onClick={() => setScreen('chat')} />
          <NavBtn icon="🧠" label="Memory"   active={screen === 'memory'}   onClick={() => setScreen('memory')} />
          <NavBtn icon="⚙️" label="Settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
          <div style={{ flex: 1 }} />
          <NavBtn icon="💎" label="Plan"     active={screen === 'plan'}     onClick={() => setScreen('plan')} />
        </nav>

        {/* Main content */}
        <main style={styles.main}>
          {screen === 'chat' && (
            <Chat
              mode={mode}
              keyStatus={keyStatus}
              tier={tier}
              messagesThisMonth={messagesThisMonth}
              onMessageSent={() => setMessagesThisMonth(n => n + 1)}
              onUpgradeClick={() => setScreen('plan')}
            />
          )}
          {screen === 'settings' && (
            <SettingsScreen
              keyStatus={keyStatus}
              apiKeys={apiKeys}
              setApiKeys={setApiKeys}
              permissions={permissions}
              saving={saving}
              onSaveKey={saveKey}
              onRemoveKey={removeKey}
              onUpdatePermissions={setPermissions}
            />
          )}
          {screen === 'memory' && <MemoryScreen />}
          {screen === 'plan' && <LicensePanel onTierChange={setTier} />}
        </main>
      </div>
    </div>
  );
}

// ── Settings Screen ─────────────────────────────────────────────────────────

interface SettingsProps {
  keyStatus: Record<string, boolean>;
  apiKeys: Record<string, string>;
  setApiKeys: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  permissions: Permission[];
  saving: string | null;
  onSaveKey: (p: string) => void;
  onRemoveKey: (p: string) => void;
  onUpdatePermissions: (perms: Permission[]) => void;
}

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…', color: '#10a37f' },
  { id: 'claude', label: 'Anthropic Claude', placeholder: 'sk-ant-…', color: '#d97706' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…', color: '#4285f4' },
];

function SettingsScreen({ keyStatus, apiKeys, setApiKeys, permissions, saving, onSaveKey, onRemoveKey, onUpdatePermissions }: SettingsProps) {
  const togglePermission = async (key: string) => {
    const perm = permissions.find(p => p.key === key);
    if (!perm) return;
    await window.triforge.permissions.set(key, !perm.granted);
    const updated = await window.triforge.permissions.get();
    onUpdatePermissions(updated);
  };

  return (
    <div style={styles.settingsPage}>
      <h2 style={styles.sectionTitle}>API Keys</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Keys are stored locally on your machine. TriForge needs at least one to work.
      </p>
      {PROVIDERS.map(p => (
        <div key={p.id} style={styles.keyRow}>
          <div style={{ ...styles.providerDot, background: p.color }} />
          <span style={styles.providerLabel}>{p.label}</span>
          {keyStatus[p.id] ? (
            <div style={styles.keyConfigured}>
              <span style={styles.keyActive}>● Configured</span>
              <button style={styles.removeBtn} onClick={() => onRemoveKey(p.id)}>Remove</button>
            </div>
          ) : (
            <div style={styles.keyInput}>
              <input
                type="password"
                style={styles.keyField}
                placeholder={p.placeholder}
                value={apiKeys[p.id]}
                onChange={e => setApiKeys(k => ({ ...k, [p.id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && onSaveKey(p.id)}
              />
              <button
                style={{ ...styles.saveBtn, ...((!apiKeys[p.id].trim() || saving === p.id) ? styles.saveBtnDisabled : {}) }}
                onClick={() => onSaveKey(p.id)}
                disabled={!apiKeys[p.id].trim() || saving === p.id}
              >
                {saving === p.id ? '…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      ))}

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Permissions</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Control what TriForge AI is allowed to do on your behalf.
      </p>
      {permissions.map(p => (
        <div key={p.key} style={styles.permRow}>
          <button
            style={{ ...styles.toggle, ...(p.granted ? styles.toggleOn : {}) }}
            onClick={() => togglePermission(p.key)}
          >
            <div style={{ ...styles.toggleKnob, ...(p.granted ? styles.toggleKnobOn : {}) }} />
          </button>
          <div>
            <div style={styles.permLabel}>{p.label}</div>
            <div style={styles.permDesc}>{p.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Memory Screen ───────────────────────────────────────────────────────────

function MemoryScreen() {
  const [memories, setMemories] = useState<Array<{ id: number; type: string; content: string; created_at: number }>>([]);
  const [input, setInput] = useState('');
  const [type, setType] = useState<'fact' | 'goal' | 'preference' | 'business'>('fact');

  useEffect(() => {
    window.triforge.memory.get().then(setMemories);
  }, []);

  const addMemory = async () => {
    if (!input.trim()) return;
    await window.triforge.memory.add(type, input.trim());
    setInput('');
    const updated = await window.triforge.memory.get();
    setMemories(updated);
  };

  const TYPE_COLORS: Record<string, string> = { fact: 'var(--teal)', goal: 'var(--accent)', preference: 'var(--purple)', business: '#f59e0b' };

  return (
    <div style={styles.settingsPage}>
      <h2 style={styles.sectionTitle}>Long-term Memory</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
        Things TriForge always remembers about you. The more you add, the more personalized it gets.
      </p>

      <div style={styles.memoryInput}>
        <select style={styles.typeSelect} value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="fact">Fact</option>
          <option value="goal">Goal</option>
          <option value="preference">Preference</option>
          <option value="business">Business</option>
        </select>
        <input
          style={styles.keyField}
          placeholder="e.g. I own a delivery business in Miami"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addMemory()}
        />
        <button style={styles.saveBtn} onClick={addMemory} disabled={!input.trim()}>Add</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
        {memories.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No memories yet. Add some above.</p>}
        {memories.map(m => (
          <div key={m.id} style={styles.memoryRow}>
            <span style={{ ...styles.memoryType, color: TYPE_COLORS[m.type] ?? 'var(--text-muted)' }}>{m.type}</span>
            <span style={styles.memoryContent}>{m.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Nav Button ──────────────────────────────────────────────────────────────

function NavBtn({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }} onClick={onClick} title={label}>
      <span style={styles.navIcon}>{icon}</span>
      <span style={styles.navLabel}>{label}</span>
    </button>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' },
  titlebar: {
    display: 'flex', alignItems: 'center', height: 38, padding: '0 16px',
    WebkitAppRegion: 'drag' as never,
    background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
    flexShrink: 0, userSelect: 'none',
  },
  trafficLights: { width: 60 }, // space for macOS traffic lights
  appName: { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', flex: 1 },
  titlebarSpacer: { width: 60 },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  sidebar: {
    width: 64, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 4,
    flexShrink: 0,
  },
  navBtn: {
    width: 50, height: 50, borderRadius: 'var(--radius-sm)',
    background: 'none', border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
    transition: 'background 0.15s', color: 'var(--text-muted)',
  },
  navBtnActive: { background: 'var(--accent-dim)', color: 'var(--accent)' },
  navIcon: { fontSize: 18 },
  navLabel: { fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },

  main: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },

  settingsPage: { flex: 1, overflowY: 'auto', padding: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 },

  keyRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' },
  providerDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  providerLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 140 },
  keyConfigured: { display: 'flex', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'flex-end' },
  keyActive: { fontSize: 12, color: '#10a37f' },
  keyInput: { display: 'flex', gap: 8, flex: 1 },
  keyField: { flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, padding: '6px 10px' },
  saveBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  removeBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },

  permRow: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10, padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' },
  toggle: { flexShrink: 0, width: 36, height: 20, borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', marginTop: 2 },
  toggleOn: { background: 'var(--accent)', border: '1px solid var(--accent)' },
  toggleKnob: { position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' },
  toggleKnobOn: { left: 18 },
  permLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  permDesc: { fontSize: 12, color: 'var(--text-secondary)' },

  memoryInput: { display: 'flex', gap: 8 },
  typeSelect: { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '6px 10px', fontSize: 13 },
  memoryRow: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' },
  memoryType: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 64 },
  memoryContent: { fontSize: 13, color: 'var(--text-primary)' },
};
