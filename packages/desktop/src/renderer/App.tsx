import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Permission } from '../main/store';
import { PermissionWizard } from './components/PermissionWizard';
import { Chat } from './components/Chat';
import { ForgeCommand } from './forge/ForgeCommand';
import { LicensePanel } from './components/LicensePanel';
import { LockScreen } from './components/LockScreen';
import { AppBuilder } from './components/AppBuilder';
import { Ledger } from './components/Ledger';
import { ForgeProfiles } from './components/ForgeProfiles';
import { MissionControl } from './components/MissionControl';
import { AgentHQ } from './components/AgentHQ';
import { Dashboard } from './ui/Dashboard';
import { OperatorMode } from './modes/OperatorMode';
import { WorldMode } from './modes/WorldMode';
import { FileMode } from './modes/FileMode';
import { InboxMode } from './modes/InboxMode';
import { AutomationMode } from './modes/AutomationMode';
import { HustleMode } from './modes/HustleMode';
import { PhoneLink } from './components/PhoneLink';

// ── Error Boundary ───────────────────────────────────────────────────────────
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#f0f0f5', fontFamily: 'monospace', background: '#0d0d0f', height: '100vh', overflowY: 'auto' }}>
          <div style={{ color: '#ef4444', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>⚠ TriForge render error</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#8b8b9e' }}>{this.state.error.message}{'\n\n'}{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type Screen =
  | 'chat' | 'settings' | 'memory' | 'ledger' | 'plan' | 'builder'
  | 'profiles' | 'missioncontrol' | 'agenthq'
  | 'dashboard' | 'operator' | 'world' | 'files' | 'inbox' | 'automation' | 'hustle'
  | 'forge' | 'phonelink';

const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function App() {
  const [ready, setReady] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({ openai: false, claude: false, grok: false });
  const [mode, setMode] = useState('none');
  const [screen, setScreen] = useState<Screen>('chat');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({ openai: '', claude: '', grok: '' });
  const [saving, setSaving] = useState<string | null>(null);
  const [tier, setTier] = useState<string>('free');
  const [messagesThisMonth, setMessagesThisMonth] = useState(0);
  const [updateStatus, setUpdateStatus] = useState<{ state: string; version?: string; percent?: number } | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  // Chat prefill — set by ForgeProfiles "Open in Chat", consumed once by Chat
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);
  // Voice output mode — lifted so Settings screen can toggle it too
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('triforge-voice-mode') === 'on');
  const handleVoiceModeChange = (on: boolean) => {
    setVoiceMode(on);
    localStorage.setItem('triforge-voice-mode', on ? 'on' : 'off');
  };

  // Window state
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleToggleFullscreen = useCallback(async () => {
    const next = await window.triforge.appWindow.toggleFullscreen();
    setIsFullscreen(next);
  }, []);

  // Session lock state
  const [hasPin, setHasPin] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockUsername, setLockUsername] = useState<string | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Inactivity timer ─────────────────────────────────────────────────────────
  const resetLockTimer = useCallback(() => {
    if (!hasPin) return;
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => setLocked(true), LOCK_TIMEOUT_MS);
  }, [hasPin]);

  // Attach global activity listeners once hasPin is known
  useEffect(() => {
    if (!hasPin) return;
    const handleActivity = () => resetLockTimer();
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    resetLockTimer(); // start the timer
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [hasPin, resetLockTimer]);

  // ── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        // 8-second timeout so a slow/offline license check never hangs the app
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('startup_timeout')), 8000)
        );
        const load = Promise.all([
          window.triforge.permissions.isFirstRun(),
          window.triforge.permissions.get(),
          window.triforge.keys.status(),
          window.triforge.license.load(),
          window.triforge.usage.get(),
          window.triforge.auth.status(),
          window.triforge.forgeProfiles.getActive(),
        ]);
        const [isFirst, perms, keys, lic, usage, authStatus, forgeActive] = await Promise.race([load, timeout]);
        setFirstRun(isFirst);
        setPermissions(perms);
        setKeyStatus(keys);
        setTier(lic.tier ?? 'free');
        setMessagesThisMonth(usage.messagesThisMonth);
        setHasPin(authStatus.hasPin);
        setLockUsername(authStatus.username);
        if (authStatus.hasPin) setLocked(true); // require PIN on every launch
        setActiveProfileId(forgeActive.id ?? null);
        if (!isFirst) {
          try {
            const m = await window.triforge.engine.mode();
            setMode(m);
          } catch { /* no keys yet */ }
        }
        // Sync fullscreen state
        const fs = await window.triforge.appWindow.isFullscreen();
        setIsFullscreen(fs);
      } catch {
        // Startup failed or timed out — open on free tier so the app is usable
        setTier('free');
      }
      setReady(true);
    }
    init();
  }, []);

  useEffect(() => {
    return window.triforge.updater.onStatus(s => {
      if (s.state === 'available' || s.state === 'downloading' || s.state === 'downloaded') {
        setUpdateStatus(s);
      } else if (s.state === 'up-to-date' || s.state === 'error') {
        setUpdateStatus(null);
      }
    });
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

  const handleUnlock = () => {
    setLocked(false);
    resetLockTimer();
  };

  const handleLock = () => setLocked(true);

  const handleDiscussInChat = useCallback((prompt: string) => {
    setChatPrefill(prompt);
    setScreen('chat');
  }, []);

  const handlePinChanged = async () => {
    const status = await window.triforge.auth.status();
    setHasPin(status.hasPin);
    setLockUsername(status.username);
  };

  if (!ready) return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Initializing</span>
    </div>
  );

  if (firstRun) return <PermissionWizard permissions={permissions} onComplete={handleWizardDone} />;

  // Show lock screen if PIN is set and app is locked
  if (locked && hasPin) return <LockScreen username={lockUsername} onUnlock={handleUnlock} />;

  return (
    <div style={styles.shell}>
      {/* Custom title bar */}
      <div style={styles.titlebar}>
        <div style={styles.trafficLights} />
        <span style={styles.appName}>TriForge AI</span>
        <div style={styles.titlebarRight}>
          {hasPin && (
            <button style={styles.lockBtn} onClick={handleLock} title="Lock TriForge">
              Lock
            </button>
          )}
          <button style={styles.winBtn} onClick={() => window.triforge.appWindow.minimize()} title="Minimize">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button style={styles.winBtn} onClick={handleToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Auto-update banner */}
      {updateStatus && (
        <div style={styles.updateBanner}>
          {updateStatus.state === 'available' && (
            <span>Update v{updateStatus.version} available — downloading</span>
          )}
          {updateStatus.state === 'downloading' && (
            <span>Downloading update — {updateStatus.percent}%</span>
          )}
          {updateStatus.state === 'downloaded' && (
            <>
              <span>Update v{updateStatus.version} ready to install</span>
              <button style={styles.updateInstallBtn} onClick={() => window.triforge.updater.install()}>
                Restart &amp; Install
              </button>
              <button style={styles.updateDismissBtn} onClick={() => setUpdateStatus(null)}>Later</button>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar */}
        <nav style={styles.sidebar}>
          {/* Agent Modes */}
          <NavBtn icon="⬡" label="TriForge"  active={screen === 'chat'}           onClick={() => setScreen('chat')} />
          <NavBtn icon="◉" label="Command"   active={screen === 'forge'}          onClick={() => setScreen('forge')} />
          <NavBtn icon="◈" label="Dashboard" active={screen === 'dashboard'}      onClick={() => setScreen('dashboard')} />
          <NavBtn icon="⬡" label="Launch"   active={screen === 'profiles'}       onClick={() => setScreen('profiles')} />
          <NavBtn icon="↗" label="Operate"  active={screen === 'operator'}       onClick={() => setScreen('operator')} />
          <NavBtn icon="○" label="World"    active={screen === 'world'}          onClick={() => setScreen('world')} />
          <NavBtn icon="⊡" label="Files"    active={screen === 'files'}          onClick={() => setScreen('files')} />
          <NavBtn icon="⊟" label="Inbox"    active={screen === 'inbox'}          onClick={() => setScreen('inbox')} />
          <NavBtn icon="∞" label="Automate" active={screen === 'automation'}     onClick={() => setScreen('automation')} />
          <NavBtn icon="◇" label="Hustle"   active={screen === 'hustle'}         onClick={() => setScreen('hustle')} />
          {/* Divider */}
          <div style={styles.navDivider} />
          <NavBtn icon="⊞" label="Builder"  active={screen === 'builder'}        onClick={() => setScreen('builder')} />
          <NavBtn icon="◎" label="Memory"   active={screen === 'memory'}         onClick={() => setScreen('memory')} />
          <NavBtn icon="≡" label="Ledger"   active={screen === 'ledger'}         onClick={() => setScreen('ledger')} />
          <NavBtn icon="⊕" label="Control"  active={screen === 'missioncontrol'} onClick={() => setScreen('missioncontrol')} />
          <NavBtn icon="⚙" label="Settings" active={screen === 'settings'}       onClick={() => setScreen('settings')} />
          <NavBtn icon="⊛" label="Phone"    active={screen === 'phonelink'}      onClick={() => setScreen('phonelink')} />
          <div style={{ flex: 1 }} />
          <NavBtn icon="▷" label="Plan"     active={screen === 'plan'}           onClick={() => setScreen('plan')} />
        </nav>

        {/* Main content */}
        <main style={styles.main}>
          {screen === 'dashboard'  && <Dashboard      onNavigate={s => setScreen(s as Screen)} tier={tier} />}
          {screen === 'operator'   && <OperatorMode   onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'world'      && <WorldMode      onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'files'      && <FileMode       onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'inbox'      && <InboxMode      onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'automation' && <AutomationMode onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'hustle'     && <HustleMode     onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'chat' && (
            <Chat
              mode={mode}
              keyStatus={keyStatus}
              tier={tier}
              messagesThisMonth={messagesThisMonth}
              onMessageSent={() => setMessagesThisMonth(n => n + 1)}
              onUpgradeClick={() => setScreen('settings')}
              onBuildApp={() => setScreen('builder')}
              activeProfileId={activeProfileId}
              onProfileSwitch={() => setScreen('profiles')}
              onProfileDeactivate={() => setActiveProfileId(null)}
              prefill={chatPrefill}
              onClearPrefill={() => setChatPrefill(null)}
              onNavigateToCommand={() => setScreen('forge')}
              onNavigateToFiles={() => setScreen('files')}
              voiceMode={voiceMode}
              onVoiceModeChange={handleVoiceModeChange}
            />
          )}
          {screen === 'forge' && (
            <ForgeCommand
              keyStatus={keyStatus}
              tier={tier}
              messagesThisMonth={messagesThisMonth}
              onMessageSent={() => setMessagesThisMonth(n => n + 1)}
              onUpgradeClick={() => setScreen('settings')}
              onDiscussInChat={handleDiscussInChat}
            />
          )}
          {screen === 'builder' && <AppBuilder onBack={() => setScreen('dashboard')} />}
          {screen === 'profiles' && (
            <ForgeProfiles
              tier={tier}
              activeProfileId={activeProfileId}
              onProfileChange={(id) => setActiveProfileId(id)}
              onSendToChat={(prompt) => { setChatPrefill(prompt); setScreen('chat'); }}
              onUpgradeClick={() => setScreen('plan')}
            />
          )}
          {screen === 'agenthq' && <AgentHQ />}
          {screen === 'missioncontrol' && <MissionControl />}
          {screen === 'ledger' && <Ledger tier={tier} onUpgradeClick={() => setScreen('plan')} />}
          {screen === 'settings' && (
            <SettingsScreen
              keyStatus={keyStatus}
              apiKeys={apiKeys}
              setApiKeys={setApiKeys}
              permissions={permissions}
              saving={saving}
              hasPin={hasPin}
              lockUsername={lockUsername}
              onSaveKey={saveKey}
              onRemoveKey={removeKey}
              onUpdatePermissions={setPermissions}
              onPinChanged={handlePinChanged}
              voiceMode={voiceMode}
              onToggleVoice={handleVoiceModeChange}
            />
          )}
          {screen === 'memory' && <MemoryScreen />}
          {screen === 'plan' && <LicensePanel onTierChange={setTier} />}
          {screen === 'phonelink' && <PhoneLink />}
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
  hasPin: boolean;
  lockUsername: string | null;
  onSaveKey: (p: string) => void;
  onRemoveKey: (p: string) => void;
  onUpdatePermissions: (perms: Permission[]) => void;
  onPinChanged: () => void;
  voiceMode: boolean;
  onToggleVoice: (on: boolean) => void;
}

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…', color: '#10a37f', billingUrl: 'https://platform.openai.com/settings/organization/billing', keysUrl: 'https://platform.openai.com/api-keys' },
  { id: 'claude', label: 'Anthropic Claude', placeholder: 'sk-ant-…', color: '#d97706', billingUrl: 'https://console.anthropic.com/settings/billing', keysUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'grok', label: 'xAI Grok', placeholder: 'xai-…', color: '#6366f1', billingUrl: 'https://console.x.ai/', keysUrl: 'https://console.x.ai/' },
];

function SettingsScreen({ keyStatus, apiKeys, setApiKeys, permissions, saving, hasPin, lockUsername, onSaveKey, onRemoveKey, onUpdatePermissions, onPinChanged, voiceMode, onToggleVoice }: SettingsProps) {
  const connectedCount = PROVIDERS.filter(p => keyStatus[p.id]).length;

  const togglePermission = async (key: string) => {
    const perm = permissions.find(p => p.key === key);
    if (!perm) return;
    await window.triforge.permissions.set(key, !perm.granted);
    const updated = await window.triforge.permissions.get();
    onUpdatePermissions(updated);
  };

  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  const checkForUpdates = async () => {
    setUpdateStatus('Checking for updates…');
    setUpdateReady(false);
    const unsub = window.triforge.updater.onStatus((s: any) => {
      if (s.state === 'checking')      setUpdateStatus('Checking for updates…');
      else if (s.state === 'up-to-date')  { setUpdateStatus('You are on the latest version.'); unsub(); }
      else if (s.state === 'available')   setUpdateStatus('Update found — downloading…');
      else if (s.state === 'downloading') setUpdateStatus(`Downloading… ${s.percent != null ? Math.round(s.percent) + '%' : ''}`);
      else if (s.state === 'downloaded')  { setUpdateStatus('Update ready to install.'); setUpdateReady(true); unsub(); }
      else if (s.state === 'error')       { setUpdateStatus(`Update error: ${s.message ?? 'unknown'}`); unsub(); }
    });
    await window.triforge.updater.check();
  };

  return (
    <div style={styles.settingsPage}>
      <h2 style={styles.sectionTitle}>API Keys</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
        TriForge runs three AI models simultaneously — each needs its own API key. Add all three to unlock full Think Tank consensus mode. Keys are stored locally and never transmitted.
      </p>

      {/* Think Tank progress banner */}
      <div style={styles.thinkTankBanner}>
        <div style={styles.thinkTankHeader}>
          <span style={styles.thinkTankLabel}>Think Tank</span>
          <span style={{ ...styles.thinkTankCount, color: connectedCount === 3 ? '#10a37f' : 'var(--text-secondary)' }}>
            {connectedCount} / 3
          </span>
        </div>
        <div style={styles.thinkTankDots}>
          {PROVIDERS.map(p => (
            <div key={p.id} style={styles.thinkTankProvider}>
              <div style={{ ...styles.thinkTankDot, background: keyStatus[p.id] ? p.color : 'var(--border)' }} />
              <span style={{ fontSize: 11, color: keyStatus[p.id] ? p.color : 'var(--text-muted)', fontWeight: keyStatus[p.id] ? 600 : 400 }}>
                {p.label}
              </span>
              {!keyStatus[p.id] && (
                <a
                  href={p.keysUrl}
                  onClick={e => { e.preventDefault(); window.triforge.system.openExternal(p.keysUrl); }}
                  style={styles.thinkTankGetKey}
                >
                  Get key →
                </a>
              )}
            </div>
          ))}
        </div>
        <p style={styles.thinkTankMsg}>
          {connectedCount === 3
            ? 'All three AIs are online — full consensus mode active.'
            : connectedCount === 0
              ? 'Add API keys below. Click "Get key →" next to each provider to open their key page.'
              : `${3 - connectedCount} more key${3 - connectedCount > 1 ? 's' : ''} needed for full consensus. Click "Get key →" to add them.`}
        </p>
      </div>

      <p style={{ color: '#f59e0b', fontSize: 12, marginBottom: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '7px 10px' }}>
        <strong>Billing note:</strong> All three APIs require paid accounts. Anthropic (Claude) has no free tier — add credits at{' '}
        <a href="https://console.anthropic.com/settings/billing" onClick={e => { e.preventDefault(); window.triforge.system.openExternal('https://console.anthropic.com/settings/billing'); }} style={{ color: '#f59e0b', textDecoration: 'underline', cursor: 'pointer' }}>console.anthropic.com</a>.{' '}
        xAI Grok requires a credit balance at{' '}
        <a href="https://console.x.ai/" onClick={e => { e.preventDefault(); window.triforge.system.openExternal('https://console.x.ai/'); }} style={{ color: '#f59e0b', textDecoration: 'underline', cursor: 'pointer' }}>console.x.ai</a>.{' '}
        OpenAI requires a minimum deposit at{' '}
        <a href="https://platform.openai.com/settings/organization/billing" onClick={e => { e.preventDefault(); window.triforge.system.openExternal('https://platform.openai.com/settings/organization/billing'); }} style={{ color: '#f59e0b', textDecoration: 'underline', cursor: 'pointer' }}>platform.openai.com</a>.
      </p>
      {PROVIDERS.map(p => (
        <div key={p.id} style={styles.keyRow}>
          <div style={{ ...styles.providerDot, background: p.color }} />
          <span style={styles.providerLabel}>{p.label}</span>
          {keyStatus[p.id] ? (
            <div style={styles.keyConfigured}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <span style={styles.keyActive}>● Configured</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Billing issues?{' '}
                  <a href={p.billingUrl} onClick={e => { e.preventDefault(); window.triforge.system.openExternal(p.billingUrl); }}
                    style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Add credits
                  </a>
                </span>
              </div>
              <button style={styles.removeBtn} onClick={() => onRemoveKey(p.id)}>Remove</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
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
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' as const }}>
                <a href={p.keysUrl} onClick={e => { e.preventDefault(); window.triforge.system.openExternal(p.keysUrl); }}
                  style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}>
                  Get API key →
                </a>
              </span>
            </div>
          )}
        </div>
      ))}

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Session Lock</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Protect TriForge with a username and 7-digit PIN. Locks automatically after 30 minutes of inactivity.
      </p>
      <PinSection hasPin={hasPin} lockUsername={lockUsername} onPinChanged={onPinChanged} />

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

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Voice</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Enable spoken AI responses. When active, TriForge reads answers aloud using your system voice or OpenAI TTS (if an OpenAI key is configured). You can also toggle voice from the chat dock.
      </p>
      <div style={styles.permRow}>
        <button
          style={{ ...styles.toggle, ...(voiceMode ? styles.toggleOn : {}) }}
          onClick={() => onToggleVoice(!voiceMode)}
        >
          <div style={{ ...styles.toggleKnob, ...(voiceMode ? styles.toggleKnobOn : {}) }} />
        </button>
        <div>
          <div style={styles.permLabel}>Voice Output (Text-to-Speech)</div>
          <div style={styles.permDesc}>
            {voiceMode
              ? 'Active — AI responses will be spoken aloud.'
              : 'Off — AI responses are text only.'}
          </div>
        </div>
      </div>

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Updates</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        TriForge checks for updates automatically. Use this to check right now.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
        <button style={styles.saveBtn} onClick={checkForUpdates}>Check for Updates</button>
        {updateReady && (
          <button style={{ ...styles.saveBtn, background: 'var(--accent)' }}
            onClick={() => window.triforge.updater.install()}>
            Install & Restart
          </button>
        )}
      </div>
      {updateStatus && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 10 }}>{updateStatus}</p>
      )}
    </div>
  );
}

// ── PIN Setup/Management Section ─────────────────────────────────────────────

function PinSection({ hasPin, lockUsername, onPinChanged }: { hasPin: boolean; lockUsername: string | null; onPinChanged: () => void }) {
  const [newUsername, setNewUsername] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handlePinInput = (val: string, setter: (v: string) => void) => {
    setter(val.replace(/\D/g, '').slice(0, 7));
    setError(null);
  };

  const setupPin = async () => {
    if (!newUsername.trim()) { setError('Enter a username.'); return; }
    if (newPin.length !== 7) { setError('PIN must be exactly 7 digits.'); return; }
    if (newPin !== confirmPin) { setError('PINs do not match.'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await window.triforge.auth.setup(newUsername.trim(), newPin);
      if (result.ok) {
        setSuccess('Session lock enabled.');
        setNewUsername(''); setNewPin(''); setConfirmPin('');
        onPinChanged();
      } else {
        setError(result.error ?? 'Failed to set PIN.');
      }
    } finally {
      setSaving(false);
    }
  };

  const removePin = async () => {
    setRemoving(true);
    setError(null);
    try {
      await window.triforge.auth.clear();
      setSuccess('Session lock removed.');
      onPinChanged();
    } finally {
      setRemoving(false);
    }
  };

  if (hasPin) {
    return (
      <div style={styles.pinCard}>
        <div style={styles.pinActiveRow}>
          <span style={{ color: '#10a37f', fontWeight: 600, fontSize: 13 }}>Session lock active</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>User: <strong>{lockUsername}</strong></span>
        </div>
        <button style={styles.removeBtn} onClick={removePin} disabled={removing}>
          {removing ? 'Removing…' : 'Remove lock'}
        </button>
        {success && <div style={styles.successMsg}>{success}</div>}
        {error && <div style={styles.errorMsg}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={styles.pinCard}>
      <div style={styles.pinFields}>
        <input
          style={styles.keyField}
          placeholder="Username"
          value={newUsername}
          onChange={e => { setNewUsername(e.target.value); setError(null); }}
          autoComplete="off"
        />
        <input
          style={styles.keyField}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="7-digit PIN"
          value={newPin}
          onChange={e => handlePinInput(e.target.value, setNewPin)}
          maxLength={7}
        />
        <input
          style={styles.keyField}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Confirm PIN"
          value={confirmPin}
          onChange={e => handlePinInput(e.target.value, setConfirmPin)}
          maxLength={7}
        />
        <button
          style={{ ...styles.saveBtn, ...(saving ? styles.saveBtnDisabled : {}) }}
          onClick={setupPin}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Enable lock'}
        </button>
      </div>
      {error && <div style={styles.errorMsg}>{error}</div>}
      {success && <div style={styles.successMsg}>{success}</div>}
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
    setMemories(await window.triforge.memory.get());
  };

  const deleteMemory = async (id: number) => {
    const updated = await window.triforge.memory.delete(id);
    setMemories(updated);
  };

  const TYPE_COLORS: Record<string, string> = {
    fact: 'var(--teal)', goal: 'var(--accent)',
    preference: 'var(--purple)', business: '#f59e0b',
  };

  const formatAge = (ts: number) => {
    const diff = Date.now() - ts;
    const d = Math.floor(diff / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 30) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div style={styles.settingsPage}>
      <h2 style={styles.sectionTitle}>Long-term Memory</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
        Things TriForge always remembers about you. The more you add, the smarter and more personal it gets.
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({memories.length} saved)</span>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 20 }}>
        {memories.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No memories yet. Add some above.</p>}
        {memories.map(m => (
          <div key={m.id} style={styles.memoryRow}>
            <span style={{ ...styles.memoryType, color: TYPE_COLORS[m.type] ?? 'var(--text-muted)' }}>{m.type}</span>
            <span style={styles.memoryContent}>{m.content}</span>
            <span style={styles.memoryAge}>{formatAge(m.created_at)}</span>
            <button style={styles.memoryDeleteBtn} onClick={() => deleteMemory(m.id)} title="Delete memory">✕</button>
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

const styles: Record<string, React.CSSProperties & { WebkitAppRegion?: string }> = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' },
  titlebar: {
    display: 'flex', alignItems: 'center', height: 38, padding: '0 16px',
    WebkitAppRegion: 'drag' as never,
    background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
    flexShrink: 0, userSelect: 'none',
  },
  trafficLights: { width: 60 },
  appName: { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', flex: 1 },
  titlebarRight: { display: 'flex', alignItems: 'center', gap: 4, paddingRight: 2 },
  lockBtn: {
    background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
    fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
    color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 4, marginRight: 4,
    WebkitAppRegion: 'no-drag' as never,
  },
  winBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: 4, padding: 0, flexShrink: 0,
    WebkitAppRegion: 'no-drag' as never,
    transition: 'color 0.15s, background 0.15s',
  },

  updateBanner: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: 'linear-gradient(90deg, var(--accent)22, var(--purple)22)',
    borderBottom: '1px solid var(--accent)44',
    padding: '6px 16px', fontSize: 12, color: 'var(--text-primary)',
    flexShrink: 0,
  },
  updateInstallBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 6, padding: '3px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  updateDismissBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    fontSize: 12, cursor: 'pointer', padding: 0,
  },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  sidebar: {
    width: 64, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 4,
    flexShrink: 0,
  },
  navDivider: {
    width: 36, height: 1, background: 'rgba(255,255,255,0.06)',
    flexShrink: 0, margin: '4px 0',
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

  thinkTankBanner: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 14 },
  thinkTankHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  thinkTankLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--text-muted)' },
  thinkTankCount: { fontSize: 13, fontWeight: 700 },
  thinkTankDots: { display: 'flex', flexDirection: 'column' as const, gap: 6, marginBottom: 10 },
  thinkTankProvider: { display: 'flex', alignItems: 'center', gap: 8 },
  thinkTankDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  thinkTankGetKey: { fontSize: 11, color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', marginLeft: 4 },
  thinkTankMsg: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },

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

  pinCard: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
  pinActiveRow: { display: 'flex', alignItems: 'center', gap: 16 },
  pinFields: { display: 'flex', flexDirection: 'column', gap: 8 },

  errorMsg: { background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, padding: '8px 12px' },
  successMsg: { background: '#10a37f20', border: '1px solid #10a37f', borderRadius: 8, color: '#10a37f', fontSize: 13, padding: '8px 12px' },

  permRow: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10, padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' },
  toggle: { flexShrink: 0, width: 36, height: 20, borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', marginTop: 2 },
  toggleOn: { background: 'var(--accent)', border: '1px solid var(--accent)' },
  toggleKnob: { position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' },
  toggleKnobOn: { left: 18 },
  permLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  permDesc: { fontSize: 12, color: 'var(--text-secondary)' },

  memoryInput: { display: 'flex', gap: 8 },
  typeSelect: { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '6px 10px', fontSize: 13 },
  memoryRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' },
  memoryType: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 64, flexShrink: 0 },
  memoryContent: { fontSize: 13, color: 'var(--text-primary)', flex: 1 },
  memoryAge: { fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' },
  memoryDeleteBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '0 2px', flexShrink: 0, opacity: 0.5 },
};
