import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Permission } from '../main/store';
import { PermissionWizard } from './components/PermissionWizard';
import { SetupWizard } from './components/SetupWizard';
import type { UserRole } from './components/SetupWizard';
import { SystemHealth } from './components/SystemHealth';
import { RecoveryScreen } from './components/RecoveryScreen';
import { DocsScreen } from './components/DocsScreen';
import { ReadinessScreen } from './components/ReadinessScreen';
import GuideScreen from './screens/GuideScreen';
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
import { ForgeHubCatalog } from './components/ForgeHubCatalog';
import { PhoneLink } from './components/PhoneLink';
import { VentureDiscovery } from './components/VentureDiscovery';
import { VibeCoding } from './components/VibeCoding';
import { TradeDesk } from './components/TradeDesk';
import { LiveTradeAdvisor } from './components/LiveTradeAdvisor';
import { ImageGenerator } from './components/ImageGenerator';
import { TrianglePresence } from './components/TrianglePresence';
import { OperateScreen } from './screens/OperateScreen';
import { SessionsScreen } from './screens/SessionsScreen';
import { MissionQueueScreen } from './screens/MissionQueueScreen';
import { PackBuilderScreen } from './components/PackBuilderScreen';

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

// ── Primary Shell Contract ─────────────────────────────────────────────────────
// Authoritative definition of TriForge AI's five top-level product pillars.
// This is the single source of truth for the app's primary navigation identity.
// Phase 2+ work should rebuild visible navigation from this contract.
//
// Pillar descriptions:
//   triforge  — the primary thinking/chat surface (default)
//   operate   — unified action surface (Phase 2; not separate File/Inbox/Operator modes)
//   sessions  — runtime/execution visibility (Phase 2; NOT a second chat lane)
//   memory    — persistent memory management
//   settings  — configuration and account settings

export type PrimaryPillar = 'triforge' | 'operate' | 'sessions' | 'memory' | 'settings';

export const PRIMARY_PILLARS: ReadonlyArray<{ key: PrimaryPillar; label: string }> = [
  { key: 'triforge', label: 'TriForge' },
  { key: 'operate',  label: 'Operate'  },
  { key: 'sessions', label: 'Sessions' },
  { key: 'memory',   label: 'Memory'   },
  { key: 'settings', label: 'Settings' },
] as const;

export const DEFAULT_PRIMARY_PILLAR: PrimaryPillar = 'triforge';

// Pillar → current Screen mapping (consumed by Phase 2 shell routing):
//   triforge → 'chat'      (TriForge is the chat/thinking surface)
//   operate  → (Phase 2)   currently served by legacy mode screens
//   sessions → (Phase 2)   runtime/execution visibility; not a conversation surface
//   memory   → 'memory'
//   settings → 'settings'

// ── Screen Router ──────────────────────────────────────────────────────────────
// 'chat', 'memory', and 'settings' map directly to primary pillars.
// All other values are legacy/internal destinations retained for routing continuity.
// They are NOT part of the primary shell identity and will be reorganised in Phase 2+.
type Screen =
  // Primary pillar screens
  | 'chat'                                                        // pillar: triforge (default)
  | 'memory'                                                      // pillar: memory
  | 'settings'                                                    // pillar: settings
  // Primary pillar wrapper screens (Phase 2)
  | 'operate' | 'sessions'
  // Internal / secondary screens (not primary shell)
  | 'ledger' | 'plan' | 'builder' | 'profiles' | 'pack-builder'
  | 'missioncontrol' | 'agenthq' | 'missions'
  // Legacy destinations — retained for routing, hidden from future primary nav
  | 'dashboard' | 'operator' | 'world' | 'files' | 'inbox'
  | 'automation' | 'hustle' | 'forgehub'
  | 'forge' | 'phonelink' | 'tradeDesk' | 'liveTradeAdvisor'
  | 'ventures' | 'vibeCoding' | 'imageGenerator'
  // System / diagnostic screens
  | 'health' | 'recovery' | 'docs' | 'readiness' | 'guide';

const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function App() {
  const [ready, setReady] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({ openai: false, claude: false, grok: false });
  const [mode, setMode] = useState('none');
  const [screen, setScreen] = useState<Screen>('chat');
  const [primaryPillar, setPrimaryPillar] = useState<PrimaryPillar>(DEFAULT_PRIMARY_PILLAR);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({ openai: '', claude: '', grok: '' });
  const [saving, setSaving] = useState<string | null>(null);
  const [tier, setTier] = useState<string>('free');
  const [messagesThisMonth, setMessagesThisMonth] = useState(0);
  const [updateStatus, setUpdateStatus] = useState<{ state: string; version?: string; percent?: number } | null>(null);
  const [promptActivation, setPromptActivation] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  // Chat prefill — set by ForgeProfiles "Open in Chat", consumed once by Chat
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);
  // Voice output mode — lifted so Settings screen can toggle it too
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('triforge-voice-mode') === 'on');
  const handleVoiceModeChange = (on: boolean) => {
    setVoiceMode(on);
    localStorage.setItem('triforge-voice-mode', on ? 'on' : 'off');
  };

  // ── Primary pillar navigation ─────────────────────────────────────────────────
  // This is the authoritative top-level routing function for the five-pillar shell.
  // Internal/legacy screen navigation via setScreen() still works for sub-routes.
  const navigateToPillar = useCallback((pillar: PrimaryPillar) => {
    setPrimaryPillar(pillar);
    switch (pillar) {
      case 'triforge': setScreen('chat');     break;
      case 'operate':  setScreen('operate');  break;
      case 'sessions': setScreen('sessions'); break;
      case 'memory':   setScreen('memory');   break;
      case 'settings': setScreen('settings'); break;
    }
  }, []);

  // Window state
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleToggleFullscreen = useCallback(async () => {
    const next = await window.triforge.appWindow.toggleFullscreen();
    setIsFullscreen(next);
  }, []);

  const [pendingSessionName, setPendingSessionName] = useState<string | null>(null);

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

  // Deep link: triforge://activate — user returning from LemonSqueezy checkout
  useEffect(() => {
    return window.triforge.license.onActivateDeepLink(() => {
      setScreen('plan');
      setPromptActivation(true);
    });
  }, []);

  // Wake-word voice has been removed by user request — no Vosk wake engine,
  // no auto-route on wake phrase. Manual hands-free voice (Council Mode in
  // the Chat sidebar) is unaffected and still available as a click-to-start.

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

  const handleWizardDone = async (updated: Permission[], _role?: UserRole) => {
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
    setPrimaryPillar('triforge');
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

  if (firstRun) return <SetupWizard permissions={permissions} onComplete={handleWizardDone} />;

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
        {/* Sidebar — five-pillar primary navigation */}
        <nav style={styles.sidebar}>
          {/* Council presence indicator — reflects wake/listening/thinking/speaking/consensus */}
          <TrianglePresence />
          <NavBtn icon="⬡" label="TriForge" active={primaryPillar === 'triforge'} onClick={() => navigateToPillar('triforge')} />
          <NavBtn icon="▣"  label="Operate"  active={primaryPillar === 'operate'}  onClick={() => navigateToPillar('operate')} />
          <NavBtn icon="◉" label="Sessions" active={primaryPillar === 'sessions'} onClick={() => navigateToPillar('sessions')} />
          <div style={{ flex: 1 }} />
          <div style={styles.navDivider} />
          <NavBtn icon="?" label="Guide"    active={screen === 'guide'}           onClick={() => setScreen('guide')} />
          <NavBtn icon="◎" label="Memory"   active={primaryPillar === 'memory'}   onClick={() => navigateToPillar('memory')} />
          <NavBtn icon="⚙" label="Settings" active={primaryPillar === 'settings'} onClick={() => navigateToPillar('settings')} />
        </nav>

        {/* Main content */}
        <main style={styles.main}>
          {screen === 'operate'    && <OperateScreen  onNavigate={s => setScreen(s as Screen)} onViewSessions={() => navigateToPillar('sessions')} tier={tier} permissions={permissions} keyStatus={keyStatus} />}
          {screen === 'sessions'   && <SessionsScreen />}
          {screen === 'dashboard'  && <Dashboard      onNavigate={s => setScreen(s as Screen)} tier={tier} />}
          {screen === 'operator'   && <OperatorMode   onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'world'      && <WorldMode      onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'files'      && <FileMode       onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'inbox'      && <InboxMode      onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'automation' && <AutomationMode onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'hustle'     && <HustleMode     onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'forgehub'   && <ForgeHubCatalog onBack={() => setScreen('hustle')} />}
          {screen === 'ventures'       && <VentureDiscovery tier={tier} />}
          {screen === 'vibeCoding'     && <VibeCoding tier={tier} onUpgradeClick={() => navigateToPillar('settings')} />}
          {screen === 'imageGenerator' && <ImageGenerator tier={tier} onBack={() => setScreen('operator')} />}
          {screen === 'tradeDesk'        && <TradeDesk         onBack={() => setScreen('hustle')} />}
          {screen === 'liveTradeAdvisor' && <LiveTradeAdvisor   onBack={() => setScreen('hustle')} />}
          {screen === 'chat' && (
            <Chat
              mode={mode}
              keyStatus={keyStatus}
              tier={tier}
              messagesThisMonth={messagesThisMonth}
              onMessageSent={() => setMessagesThisMonth(n => n + 1)}
              onUpgradeClick={() => navigateToPillar('settings')}
              onBuildApp={() => setScreen('builder')}
              activeProfileId={activeProfileId}
              onProfileSwitch={() => setScreen('profiles')}
              onProfileDeactivate={() => setActiveProfileId(null)}
              prefill={chatPrefill}
              onClearPrefill={() => setChatPrefill(null)}
              onNavigateToCommand={() => setScreen('forge')}
              onNavigateToFiles={() => setScreen('files')}
              onNavigate={(s) => setScreen(s as any)}
              voiceMode={voiceMode}
              onVoiceModeChange={handleVoiceModeChange}
              pendingVoiceSession={pendingSessionName}
              onVoiceSessionClaimed={() => setPendingSessionName(null)}
            />
          )}
          {screen === 'forge' && (
            <ForgeCommand
              keyStatus={keyStatus}
              tier={tier}
              messagesThisMonth={messagesThisMonth}
              onMessageSent={() => setMessagesThisMonth(n => n + 1)}
              onUpgradeClick={() => navigateToPillar('settings')}
              onDiscussInChat={handleDiscussInChat}
            />
          )}
          {screen === 'builder' && <AppBuilder onBack={() => setScreen('operate')} />}
          {screen === 'pack-builder' && <PackBuilderScreen />}
          {screen === 'profiles' && (
            <ForgeProfiles
              tier={tier}
              activeProfileId={activeProfileId}
              onProfileChange={(id) => setActiveProfileId(id)}
              onSendToChat={(prompt) => { setChatPrefill(prompt); navigateToPillar('triforge'); }}
              onUpgradeClick={() => setScreen('plan')}
            />
          )}
          {screen === 'agenthq' && <AgentHQ />}
          {screen === 'missions' && <MissionQueueScreen onNavigate={s => setScreen(s as Screen)} />}
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
          {screen === 'plan' && <LicensePanel onTierChange={t => { setTier(t); setPromptActivation(false); }} promptActivation={promptActivation} />}
          {screen === 'phonelink' && <PhoneLink />}
          {screen === 'health'    && <SystemHealth     onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'recovery'  && <RecoveryScreen />}
          {screen === 'docs'      && <DocsScreen />}
          {screen === 'readiness' && <ReadinessScreen onNavigate={s => setScreen(s as Screen)} />}
          {screen === 'guide'     && <GuideScreen onNavigate={s => setScreen(s as Screen)} />}
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

  // Operator kill switch state
  const [operatorEnabled, setOperatorEnabled] = useState<boolean | null>(null);
  const [operatorToggling, setOperatorToggling] = useState(false);
  const [operatorError, setOperatorError] = useState<string | null>(null);

  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [appTier, setAppTier]       = useState<string>('free');

  // Relay state
  const [relayStatus, setRelayStatus]     = useState<any>(null);
  const [relayUrl, setRelayUrl]           = useState('');
  const [relayLabel, setRelayLabel]       = useState('');
  const [relaySaving, setRelaySaving]     = useState(false);
  const [relayError, setRelayError]       = useState<string | null>(null);
  const [relayExpanded, setRelayExpanded] = useState(false);

  // Social accounts state
  const [socialAccounts, setSocialAccounts]     = useState<any[]>([]);
  const [socialConnecting, setSocialConnecting] = useState<string | null>(null);
  const [socialError, setSocialError]           = useState<string | null>(null);
  const [socialExpanded, setSocialExpanded]     = useState<string | null>(null);
  const [socialCreds, setSocialCreds]           = useState<Record<string, Record<string, string>>>({});

  // OSK state
  const [oskOpen, setOskOpen]     = useState<boolean | null>(null);
  const [oskActing, setOskActing] = useState(false);

  // Screen watcher state
  const [watcherRunning, setWatcherRunning] = useState<boolean | null>(null);
  const [watcherLastAt, setWatcherLastAt]   = useState<number | null>(null);
  const [watcherActing, setWatcherActing]   = useState(false);

  useEffect(() => {
    Promise.all([
      window.triforge.app?.version?.().catch(() => ''),
      window.triforge.license.load().catch(() => ({ tier: 'free' })),
    ]).then(([v, lic]) => {
      setAppVersion(v as string);
      setAppTier((lic as any)?.tier ?? 'free');
    });
    // Load operator kill switch state
    window.triforge.operatorSafety.getStatus().then(res => {
      if (res.ok) setOperatorEnabled(res.enabled);
    }).catch(() => { /* kill switch unavailable — leave null */ });
    // Load relay status
    (window.triforge as any).relay?.status?.().then((s: any) => setRelayStatus(s)).catch(() => {});
    // Load social accounts (status returns { ok, status: { youtube: bool, ... } })
    (window.triforge as any).social?.getAccounts?.().then((res: any) => {
      const status: Record<string, boolean> = res?.status ?? {};
      setSocialAccounts(Object.keys(status).map(p => ({ platform: p, connected: !!status[p] })));
    }).catch(() => {});
    // Load OSK status
    (window.triforge as any).osk?.status?.().then((r: any) => setOskOpen(r?.open ?? false)).catch(() => {});
    // Load screen watcher status
    (window.triforge as any).screenWatch?.check?.().then((r: any) => {
      setWatcherRunning(r?.running ?? false);
      setWatcherLastAt(r?.lastChangedAt ?? null);
    }).catch(() => {});
  }, []);

  const handleToggleOperator = async () => {
    if (operatorToggling || operatorEnabled === null) return;
    setOperatorToggling(true);
    setOperatorError(null);
    try {
      const res = operatorEnabled
        ? await window.triforge.operatorSafety.disable()
        : await window.triforge.operatorSafety.enable();
      if (res.ok) {
        setOperatorEnabled(res.enabled);
      } else {
        setOperatorError(res.error ?? 'Failed to update operator state.');
      }
    } catch (e: any) {
      setOperatorError(e?.message ?? 'Unexpected error.');
    } finally {
      setOperatorToggling(false);
    }
  };

  // ── Relay handlers ──────────────────────────────────────────────────────────

  const handleRelayRegister = async () => {
    if (!relayUrl.trim()) { setRelayError('Enter a relay URL.'); return; }
    setRelaySaving(true);
    setRelayError(null);
    try {
      const res = await (window.triforge as any).relay.register(relayUrl.trim(), relayLabel.trim() || 'TriForge Desktop');
      if (res?.ok) {
        const s = await (window.triforge as any).relay.status();
        setRelayStatus(s);
        setRelayExpanded(false);
        setRelayUrl('');
        setRelayLabel('');
      } else {
        setRelayError(res?.error ?? 'Registration failed.');
      }
    } catch (e: any) {
      setRelayError(e?.message ?? 'Unexpected error.');
    } finally {
      setRelaySaving(false);
    }
  };

  const handleRelayDisconnect = async () => {
    setRelayError(null);
    try {
      await (window.triforge as any).relay.disconnect();
      setRelayStatus(null);
      setRelayExpanded(false);
    } catch (e: any) {
      setRelayError(e?.message ?? 'Disconnect failed.');
    }
  };

  // ── Social handlers ──────────────────────────────────────────────────────────

  /** Required credential field names per platform — matches socialPublisher.connect*. */
  const SOCIAL_CRED_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
    youtube: [
      { key: 'clientId',     label: 'OAuth Client ID',     placeholder: 'xxxxxxxx.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...' },
    ],
    facebook: [
      { key: 'appId',     label: 'Facebook App ID',     placeholder: '1234567890' },
      { key: 'appSecret', label: 'Facebook App Secret', placeholder: 'abcd1234…' },
    ],
    instagram: [
      { key: 'appId',     label: 'Facebook App ID',     placeholder: '1234567890' },
      { key: 'appSecret', label: 'Facebook App Secret', placeholder: 'abcd1234…' },
    ],
    tiktok: [
      { key: 'clientKey',    label: 'TikTok Client Key',    placeholder: 'awxxxxxxxxxxxx' },
      { key: 'clientSecret', label: 'TikTok Client Secret', placeholder: 'xxxxxxxxxxxxxxxxxx' },
    ],
  };

  const SOCIAL_CRED_HINTS: Record<string, { docsUrl: string; label: string }> = {
    youtube:   { docsUrl: 'https://console.cloud.google.com/apis/credentials',           label: 'Google Cloud Console → Credentials → OAuth client ID (Desktop app)' },
    facebook:  { docsUrl: 'https://developers.facebook.com/apps/',                       label: 'Meta for Developers → My Apps → Settings → Basic' },
    instagram: { docsUrl: 'https://developers.facebook.com/apps/',                       label: 'Same as Facebook — IG Business uses the Meta app credentials' },
    tiktok:    { docsUrl: 'https://developers.tiktok.com/',                              label: 'TikTok for Developers → Manage Apps → App Info' },
  };

  const reloadSocialAccounts = async () => {
    const res = await (window.triforge as any).social.getAccounts();
    const status: Record<string, boolean> = res?.status ?? {};
    setSocialAccounts(Object.keys(status).map(p => ({ platform: p, connected: !!status[p] })));
  };

  const handleSocialExpand = (platform: string) => {
    setSocialError(null);
    setSocialExpanded(prev => prev === platform ? null : platform);
  };

  const handleSocialCredChange = (platform: string, field: string, value: string) => {
    setSocialCreds(prev => ({ ...prev, [platform]: { ...(prev[platform] ?? {}), [field]: value } }));
  };

  const handleSocialConnect = async (platform: string) => {
    const fields = SOCIAL_CRED_FIELDS[platform];
    const creds  = socialCreds[platform] ?? {};
    const missing = fields.filter(f => !creds[f.key]?.trim());
    if (missing.length > 0) {
      setSocialError(`Fill in: ${missing.map(m => m.label).join(', ')}`);
      return;
    }

    setSocialConnecting(platform);
    setSocialError(null);
    try {
      const res = await (window.triforge as any).social.connect(platform, creds);
      if (res?.ok) {
        await reloadSocialAccounts();
        setSocialExpanded(null);
        // Wipe local credential cache once stored — they're now in safeStorage
        setSocialCreds(prev => { const next = { ...prev }; delete next[platform]; return next; });
      } else {
        setSocialError(res?.error ?? `Failed to connect ${platform}.`);
      }
    } catch (e: any) {
      setSocialError(e?.message ?? 'Unexpected error.');
    } finally {
      setSocialConnecting(null);
    }
  };

  const handleSocialDisconnect = async (platform: string) => {
    setSocialError(null);
    try {
      await (window.triforge as any).social.disconnect(platform);
      await reloadSocialAccounts();
    } catch (e: any) {
      setSocialError(e?.message ?? 'Unexpected error.');
    }
  };

  // ── OSK handler ───────────────────────────────────────────────────────────────

  const handleToggleOsk = async () => {
    if (oskActing) return;
    setOskActing(true);
    try {
      if (oskOpen) {
        await (window.triforge as any).osk.close();
        setOskOpen(false);
      } else {
        await (window.triforge as any).osk.open();
        setOskOpen(true);
      }
    } catch {
      // best-effort
    } finally {
      setOskActing(false);
    }
  };

  // ── Screen watcher handler ────────────────────────────────────────────────────

  const handleToggleWatcher = async () => {
    if (watcherActing) return;
    setWatcherActing(true);
    try {
      if (watcherRunning) {
        await (window.triforge as any).screenWatch.stop();
        setWatcherRunning(false);
      } else {
        await (window.triforge as any).screenWatch.start();
        setWatcherRunning(true);
      }
    } catch {
      // best-effort
    } finally {
      setWatcherActing(false);
    }
  };

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

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Operator Execution</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Controls whether the supervised operator can execute desktop actions (typing, key presses) during workflow runs.
        Disabling this stops all operator and workflow action execution — chat, reasoning, and memory are not affected.
      </p>
      <div style={styles.permRow}>
        <button
          style={{
            ...styles.toggle,
            ...(operatorEnabled ? styles.toggleOn : {}),
            opacity: (operatorEnabled === null || operatorToggling) ? 0.5 : 1,
            cursor: (operatorEnabled === null || operatorToggling) ? 'not-allowed' : 'pointer',
          }}
          onClick={handleToggleOperator}
          disabled={operatorEnabled === null || operatorToggling}
          aria-label={operatorEnabled ? 'Disable operator execution' : 'Enable operator execution'}
        >
          <div style={{ ...styles.toggleKnob, ...(operatorEnabled ? styles.toggleKnobOn : {}) }} />
        </button>
        <div>
          <div style={styles.permLabel}>
            {operatorEnabled === null
              ? 'Operator Execution'
              : operatorEnabled
                ? 'Operator Execution — Enabled'
                : 'Operator Execution — Disabled'}
          </div>
          <div style={styles.permDesc}>
            {operatorEnabled === null
              ? 'Loading status…'
              : operatorEnabled
                ? 'Operator and workflow actions can execute. Disable to immediately block all supervised desktop actions.'
                : 'All operator and workflow action execution is blocked. Chat, reasoning, and memory continue to work normally.'}
          </div>
          {operatorError && (
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{operatorError}</div>
          )}
        </div>
      </div>

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Spoken Reply Voice</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Lets TriForge speak its replies out loud. This does <strong>not</strong> enable wake access — it only controls whether AI responses are read aloud.
      </p>
      <div style={styles.permRow}>
        <button
          style={{ ...styles.toggle, ...(voiceMode ? styles.toggleOn : {}) }}
          onClick={() => onToggleVoice(!voiceMode)}
        >
          <div style={{ ...styles.toggleKnob, ...(voiceMode ? styles.toggleKnobOn : {}) }} />
        </button>
        <div>
          <div style={styles.permLabel}>Spoken Reply Voice</div>
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

      {/* ── Relay ─────────────────────────────────────────────────────────── */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Remote Relay</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Connect to a relay server to trigger automation jobs remotely from your phone or browser. Your device polls the relay for pending jobs.
      </p>
      {relayStatus?.connected ? (
        <div style={styles.relayCard}>
          <div style={styles.relayConnectedRow}>
            <span style={styles.relayDotGreen} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>Connected</span>
            <button style={styles.removeBtn} onClick={handleRelayDisconnect}>Disconnect</button>
            <button style={{ ...styles.removeBtn, marginLeft: 6 }} onClick={() => setRelayExpanded(x => !x)}>
              {relayExpanded ? 'Cancel' : 'Re-register'}
            </button>
          </div>
          <div style={styles.relayInfoRow}>
            <span style={styles.relayInfoKey}>Relay URL</span>
            <span style={styles.relayInfoVal}>{relayStatus.relayUrl}</span>
          </div>
          {relayStatus.deviceId && (
            <div style={styles.relayInfoRow}>
              <span style={styles.relayInfoKey}>Device ID</span>
              <span style={{ ...styles.relayInfoVal, fontFamily: 'monospace', fontSize: 11 }}>{relayStatus.deviceId}</span>
            </div>
          )}
          {relayStatus.label && (
            <div style={styles.relayInfoRow}>
              <span style={styles.relayInfoKey}>Label</span>
              <span style={styles.relayInfoVal}>{relayStatus.label}</span>
            </div>
          )}
          {relayExpanded && (
            <div style={styles.relayForm}>
              <input style={styles.keyField} placeholder="Relay URL" value={relayUrl} onChange={e => setRelayUrl(e.target.value)} />
              <input style={styles.keyField} placeholder="Device label (optional)" value={relayLabel} onChange={e => setRelayLabel(e.target.value)} />
              <button
                style={{ ...styles.saveBtn, ...(!relayUrl.trim() || relaySaving ? styles.saveBtnDisabled : {}) }}
                onClick={handleRelayRegister}
                disabled={!relayUrl.trim() || relaySaving}
              >
                {relaySaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={styles.relayCard}>
          <div style={styles.relayConnectedRow}>
            <span style={styles.relayDotGray} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flex: 1 }}>Not connected</span>
          </div>
          <div style={styles.relayForm}>
            <input style={styles.keyField} placeholder="https://your-relay.railway.app" value={relayUrl} onChange={e => setRelayUrl(e.target.value)} />
            <input style={styles.keyField} placeholder="Device label (optional)" value={relayLabel} onChange={e => setRelayLabel(e.target.value)} />
            <button
              style={{ ...styles.saveBtn, ...(!relayUrl.trim() || relaySaving ? styles.saveBtnDisabled : {}) }}
              onClick={handleRelayRegister}
              disabled={!relayUrl.trim() || relaySaving}
            >
              {relaySaving ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      )}
      {relayError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{relayError}</p>}

      {/* ── Social Accounts ─────────────────────────────────────────────────── */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Social Accounts</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Connect social platforms so TriForge can publish on your behalf. Each platform requires
        you to register an OAuth app and paste your own client credentials below — TriForge does
        not ship shared keys. Tokens are encrypted with your OS keychain after authorization.
      </p>
      {(['youtube', 'instagram', 'tiktok', 'facebook'] as const).map(platform => {
        const account = socialAccounts.find((a: any) => a.platform === platform);
        const isConnecting = socialConnecting === platform;
        const isExpanded   = socialExpanded === platform;
        const icons: Record<string, string> = { youtube: '▶', instagram: '◈', tiktok: '♪', facebook: 'f' };
        const colors: Record<string, string> = { youtube: '#ff0000', instagram: '#e1306c', tiktok: '#010101', facebook: '#1877f2' };
        const fields = SOCIAL_CRED_FIELDS[platform] ?? [];
        const hint   = SOCIAL_CRED_HINTS[platform];
        const creds  = socialCreds[platform] ?? {};
        return (
          <div key={platform} style={{ ...styles.permRow, flexDirection: 'column' as const, alignItems: 'stretch' as const }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
              <div style={{ ...styles.socialIcon, background: colors[platform] }}>{icons[platform]}</div>
              <div style={{ flex: 1 }}>
                <div style={styles.permLabel}>{platform.charAt(0).toUpperCase() + platform.slice(1)}</div>
                <div style={styles.permDesc}>
                  {account?.connected ? 'Connected — tokens stored in keychain' : 'Not connected'}
                </div>
              </div>
              {account?.connected ? (
                <button style={styles.removeBtn} onClick={() => handleSocialDisconnect(platform)}>Disconnect</button>
              ) : (
                <button
                  style={{ ...styles.saveBtn, fontSize: 12, padding: '5px 12px' }}
                  onClick={() => handleSocialExpand(platform)}
                >
                  {isExpanded ? 'Cancel' : 'Connect'}
                </button>
              )}
            </div>

            {isExpanded && !account?.connected && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hint && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    Get your credentials from{' '}
                    <a
                      href={hint.docsUrl}
                      onClick={e => { e.preventDefault(); (window.triforge as any).system?.openExternal?.(hint.docsUrl); }}
                      style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {hint.label}
                    </a>
                    .
                  </p>
                )}
                {fields.map(f => (
                  <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{f.label}</label>
                    <input
                      type={f.key.toLowerCase().includes('secret') ? 'password' : 'text'}
                      value={creds[f.key] ?? ''}
                      placeholder={f.placeholder}
                      onChange={e => handleSocialCredChange(platform, f.key, e.target.value)}
                      style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '7px 10px',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                ))}
                <button
                  style={{ ...styles.saveBtn, marginTop: 4, opacity: isConnecting ? 0.6 : 1 }}
                  disabled={isConnecting}
                  onClick={() => handleSocialConnect(platform)}
                >
                  {isConnecting ? 'Waiting for browser…' : 'Authorize in browser'}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {socialError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{socialError}</p>}
      {socialConnecting && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
          Waiting for browser OAuth — complete sign-in in the browser window that opened…
        </p>
      )}

      {/* ── On-Screen Keyboard ──────────────────────────────────────────────── */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>On-Screen Keyboard</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Toggle the system on-screen keyboard for touchscreen or accessibility input. On macOS this opens the Accessibility Keyboard; on Windows it opens the built-in OSK.
      </p>
      <div style={styles.permRow}>
        <button
          style={{
            ...styles.toggle,
            ...(oskOpen ? styles.toggleOn : {}),
            opacity: oskOpen === null || oskActing ? 0.5 : 1,
            cursor: oskOpen === null || oskActing ? 'not-allowed' : 'pointer',
          }}
          onClick={handleToggleOsk}
          disabled={oskOpen === null || oskActing}
        >
          <div style={{ ...styles.toggleKnob, ...(oskOpen ? styles.toggleKnobOn : {}) }} />
        </button>
        <div>
          <div style={styles.permLabel}>
            {oskOpen === null ? 'On-Screen Keyboard' : oskOpen ? 'On-Screen Keyboard — Open' : 'On-Screen Keyboard — Closed'}
          </div>
          <div style={styles.permDesc}>
            {oskOpen === null ? 'Loading…' : oskOpen ? 'Keyboard is visible. Toggle to close it.' : 'Keyboard is hidden. Toggle to open it.'}
          </div>
        </div>
      </div>

      {/* ── Screen Watcher ──────────────────────────────────────────────────── */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>Screen Watcher</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Runs a background screenshot diff loop that detects screen changes. When active, the operator and workflow packs receive real-time screen-change signals to guide automation decisions.
      </p>
      <div style={styles.permRow}>
        <button
          style={{
            ...styles.toggle,
            ...(watcherRunning ? styles.toggleOn : {}),
            opacity: watcherRunning === null || watcherActing ? 0.5 : 1,
            cursor: watcherRunning === null || watcherActing ? 'not-allowed' : 'pointer',
          }}
          onClick={handleToggleWatcher}
          disabled={watcherRunning === null || watcherActing}
        >
          <div style={{ ...styles.toggleKnob, ...(watcherRunning ? styles.toggleKnobOn : {}) }} />
        </button>
        <div>
          <div style={styles.permLabel}>
            {watcherRunning === null ? 'Screen Watcher' : watcherRunning ? 'Screen Watcher — Active' : 'Screen Watcher — Stopped'}
          </div>
          <div style={styles.permDesc}>
            {watcherRunning === null
              ? 'Loading…'
              : watcherRunning
                ? `Monitoring screen for changes.${watcherLastAt ? ` Last change: ${new Date(watcherLastAt).toLocaleTimeString()}` : ''}`
                : 'Screen monitoring is off. Enable to give automation real-time screen awareness.'}
          </div>
        </div>
      </div>

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>About</h2>
      <div style={styles.aboutCard}>
        <div style={styles.aboutRow}>
          <span style={styles.aboutKey}>Application</span>
          <span style={styles.aboutVal}>TriForge AI</span>
        </div>
        {appVersion && (
          <div style={styles.aboutRow}>
            <span style={styles.aboutKey}>Version</span>
            <span style={styles.aboutVal}>v{appVersion}</span>
          </div>
        )}
        <div style={styles.aboutRow}>
          <span style={styles.aboutKey}>Plan</span>
          <span style={{ ...styles.aboutVal, color: appTier === 'free' ? 'var(--text-muted)' : 'var(--accent)', fontWeight: 700, textTransform: 'capitalize' as const }}>
            {appTier}
          </span>
        </div>
        <div style={styles.aboutRow}>
          <span style={styles.aboutKey}>License</span>
          <span style={styles.aboutVal}>
            {appTier !== 'free' ? 'Active' : 'Free tier — upgrade for full capabilities'}
          </span>
        </div>
        <div style={styles.aboutRow}>
          <span style={styles.aboutKey}>Platform</span>
          <span style={styles.aboutVal}>{typeof window !== 'undefined' ? window.navigator?.platform ?? 'Desktop' : 'Desktop'}</span>
        </div>
      </div>
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

  aboutCard: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  aboutRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid var(--border)' },
  aboutKey: { fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 },
  aboutVal: { fontSize: 12, color: 'var(--text-primary)' },

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

  relayCard: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 4 },
  relayConnectedRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  relayDotGreen: { width: 8, height: 8, borderRadius: '50%', background: '#10a37f', flexShrink: 0 },
  relayDotGray: { width: 8, height: 8, borderRadius: '50%', background: 'var(--border)', flexShrink: 0 },
  relayInfoRow: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 },
  relayInfoKey: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', minWidth: 80 },
  relayInfoVal: { fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all' as const },
  relayForm: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginTop: 10 },

  socialIcon: { width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 },
};
