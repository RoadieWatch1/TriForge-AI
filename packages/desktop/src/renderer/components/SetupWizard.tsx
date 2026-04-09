import React, { useState, useEffect } from 'react';
import type { Permission } from '../../main/store';

export type UserRole = 'solo' | 'team' | 'enterprise';

interface SetupWizardProps {
  permissions: Permission[];
  onComplete: (permissions: Permission[], role: UserRole) => void;
}

// Step layout:
//  0 — Welcome + Role
//  1 — System Access (OS permissions + OSK)
//  2 — Relay Setup (optional)
//  3 — API Keys
//  4 — Integrations
//  5 — App Permissions
//  6 — Ready
const TOTAL_STEPS = 7;

// ── Platform detection (renderer-safe) ────────────────────────────────────────
const IS_MAC     = navigator.userAgent.includes('Macintosh');
const IS_WINDOWS = navigator.userAgent.includes('Windows');

const ROLE_OPTIONS: { id: UserRole; label: string; desc: string; icon: string }[] = [
  { id: 'solo',       label: 'Solo Operator',     icon: '◎', desc: 'Individual — research, automation, trading, and personal productivity' },
  { id: 'team',       label: 'Engineering Team',   icon: '⬡', desc: 'Small team — code review, incident response, Linear/Jira/GitHub workflows' },
  { id: 'enterprise', label: 'Enterprise Admin',   icon: '◆', desc: 'Org-wide — governance, policy inheritance, runbook packs, multi-workspace' },
];

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI',            placeholder: 'sk-…',     color: '#10a37f', keysUrl: 'https://platform.openai.com/api-keys', billingUrl: 'https://platform.openai.com/settings/organization/billing' },
  { id: 'claude', label: 'Anthropic Claude',  placeholder: 'sk-ant-…', color: '#d97706', keysUrl: 'https://console.anthropic.com/settings/keys', billingUrl: 'https://console.anthropic.com/settings/billing' },
  { id: 'grok',   label: 'xAI Grok',          placeholder: 'xai-…',    color: '#6366f1', keysUrl: 'https://console.x.ai/',                  billingUrl: 'https://console.x.ai/' },
];

interface PermCategoryProps {
  label: string;
  perms: Permission[];
  onToggle: (key: string) => void;
}

function PermCategory({ label, perms, onToggle }: PermCategoryProps) {
  return (
    <div style={s.permCategory}>
      <div style={s.permCategoryLabel}>{label}</div>
      {perms.map(p => (
        <div key={p.key} style={s.permRow}>
          <button
            style={{ ...s.toggle, ...(p.granted ? s.toggleOn : {}) }}
            onClick={() => onToggle(p.key)}
          >
            <div style={{ ...s.toggleKnob, ...(p.granted ? s.toggleKnobOn : {}) }} />
          </button>
          <div>
            <div style={s.permLabel}>{p.label}</div>
            <div style={s.permDesc}>{p.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SetupWizard({ permissions: initialPermissions, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<UserRole>('solo');

  // Step 1: System Access
  const [oskStatus,        setOskStatus]        = useState<{ visible: boolean; recommendation: string } | null>(null);
  const [oskOpening,       setOskOpening]        = useState(false);
  const [oskOpened,        setOskOpened]         = useState(false);
  const [sysPermNote,      setSysPermNote]       = useState<string>('');

  // Step 2: Relay Setup
  const [relayUrl,         setRelayUrl]          = useState('');
  const [relayLabel,       setRelayLabel]        = useState('My Desktop');
  const [relayRegistering, setRelayRegistering]  = useState(false);
  const [relayResult,      setRelayResult]       = useState<{ ok: boolean; deviceId?: string; error?: string } | null>(null);

  // Step 3: API Keys
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({ openai: false, claude: false, grok: false });
  const [apiKeys,   setApiKeys]   = useState<Record<string, string>>({ openai: '', claude: '', grok: '' });
  const [saving,    setSaving]    = useState<string | null>(null);
  const [keyError,  setKeyError]  = useState<Record<string, string>>({});

  // Inline format validation — runs before save so users get instant feedback
  // instead of saving an obviously broken key and finding out later.
  const PROVIDER_PREFIX: Record<string, RegExp> = {
    openai: /^sk-[A-Za-z0-9_-]{20,}$/,
    claude: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    grok:   /^xai-[A-Za-z0-9_-]{20,}$/,
  };
  const validateKey = (provider: string, key: string): string | null => {
    const k = key.trim();
    if (!k) return null;
    const re = PROVIDER_PREFIX[provider];
    if (re && !re.test(k)) {
      const expected = provider === 'openai' ? 'sk-…' : provider === 'claude' ? 'sk-ant-…' : 'xai-…';
      return `Format looks off — expected ${expected}`;
    }
    return null;
  };

  // Step 4: Integrations
  const [githubToken, setGithubToken] = useState('');
  const [slackToken,  setSlackToken]  = useState('');
  const [githubSaved, setGithubSaved] = useState(false);
  const [slackSaved,  setSlackSaved]  = useState(false);
  const [integWorking, setIntegWorking] = useState<Record<string, boolean>>({});

  // Step 5: Permissions
  const [permissions, setPermissions] = useState<Permission[]>(initialPermissions);

  // Capability scan — kicked off in the background while user grants permissions, shown on Step 6
  type DetectedApp = { name: string; version?: string; path: string; exportFormats: string[]; incomeRelevant: string[] };
  type CapabilityScan = {
    scannedAt: number;
    installedApps: DetectedApp[];
    gpuName?: string;
    gpuVramMB?: number;
    storageGB: number;
  };
  const [capabilityScan, setCapabilityScan] = useState<CapabilityScan | null>(null);
  const [scanLoading,    setScanLoading]    = useState(true);

  useEffect(() => {
    let mounted = true;
    window.triforge.keys.status()
      .then(s => { if (mounted) setKeyStatus(s); })
      .catch(() => {});
    // Load OSK status
    if (window.triforge.osk) {
      window.triforge.osk.status()
        .then(s => { if (mounted) setOskStatus(s); })
        .catch(() => {});
    }
    // Kick off capability scan in the background — by the time the user reaches the
    // Ready step (Step 6) we'll have a "We found these on your machine" panel ready.
    if (window.triforge.incomeScanner) {
      window.triforge.incomeScanner.run()
        .then(r => {
          if (!mounted) return;
          if (r && r.result) {
            setCapabilityScan({
              scannedAt:     r.result.scannedAt,
              installedApps: r.result.installedApps,
              gpuName:       r.result.gpuName,
              gpuVramMB:     r.result.gpuVramMB,
              storageGB:     r.result.storageGB,
            });
          }
          setScanLoading(false);
        })
        .catch(() => { if (mounted) setScanLoading(false); });
    } else {
      setScanLoading(false);
    }
    return () => { mounted = false; };
  }, []);

  const refreshKeys = async () => {
    try { setKeyStatus(await window.triforge.keys.status()); } catch { /* ok */ }
  };

  const saveKey = async (provider: string) => {
    const key = apiKeys[provider].trim();
    if (!key) return;
    // Inline format check — surface obvious typos before we hit the keychain.
    const validationError = validateKey(provider, key);
    if (validationError) {
      setKeyError(e => ({ ...e, [provider]: validationError }));
      return;
    }
    setKeyError(e => ({ ...e, [provider]: '' }));
    setSaving(provider);
    try {
      await window.triforge.keys.set(provider, key);
      await refreshKeys();
      setApiKeys(k => ({ ...k, [provider]: '' }));
    } catch (err) {
      setKeyError(e => ({ ...e, [provider]: err instanceof Error ? err.message : 'Save failed' }));
    } finally {
      setSaving(null);
    }
  };

  const removeKey = async (provider: string) => {
    await window.triforge.keys.delete(provider);
    await refreshKeys();
  };

  const saveGithub = async () => {
    if (!githubToken.trim()) return;
    setSaving('github');
    try {
      await window.triforge.github.setCredential('pat', githubToken.trim());
      const r = await window.triforge.github.testConnection();
      setGithubSaved(true);
      setIntegWorking(prev => ({ ...prev, github: !!r.ok }));
      setGithubToken('');
    } catch { /* ok */ } finally { setSaving(null); }
  };

  const saveSlack = async () => {
    if (!slackToken.trim()) return;
    setSaving('slack');
    try {
      await window.triforge.slack.setToken(slackToken.trim());
      const r = await window.triforge.slack.testConnection();
      setSlackSaved(true);
      setIntegWorking(prev => ({ ...prev, slack: !!r.ok }));
      setSlackToken('');
    } catch { /* ok */ } finally { setSaving(null); }
  };

  const togglePermission = async (key: string) => {
    const perm = permissions.find(p => p.key === key);
    if (!perm) return;
    await window.triforge.permissions.set(key, !perm.granted);
    const updated = await window.triforge.permissions.get();
    setPermissions(updated);
  };

  const openOSK = async () => {
    if (!window.triforge.osk) return;
    setOskOpening(true);
    try {
      await window.triforge.osk.open();
      setOskOpened(true);
      const s = await window.triforge.osk.status();
      setOskStatus(s);
    } catch { /* ok */ } finally {
      setOskOpening(false);
    }
  };

  const openSystemPrefs = () => {
    if (IS_MAC) {
      // Open Privacy & Security → Screen Recording on macOS
      window.triforge.system.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      setSysPermNote('System Preferences opened — enable Screen Recording and Accessibility for TriForge, then return here.');
    } else if (IS_WINDOWS) {
      // Windows manages permissions automatically via UAC
      setSysPermNote('Windows manages permissions automatically. TriForge will request access when needed.');
    }
  };

  const registerRelay = async () => {
    if (!relayUrl.trim() || !window.triforge.relay) return;
    setRelayRegistering(true);
    setRelayResult(null);
    try {
      const result = await window.triforge.relay.register(relayUrl.trim(), relayLabel.trim() || 'My Desktop');
      setRelayResult(result);
    } catch (e) {
      setRelayResult({ ok: false, error: String(e) });
    } finally {
      setRelayRegistering(false);
    }
  };

  const finish = async () => {
    try {
      await window.triforge.permissions.markDone();
      // persist role via kv store
      await window.triforge.setup.setRole(role);
    } catch { /* ok */ }
    onComplete(permissions, role);
  };

  const connectedCount = PROVIDERS.filter(p => keyStatus[p.id]).length;

  const permByCategory = (cat: Permission['category']) =>
    permissions.filter(p => p.category === cat);

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.logoMark}>⬡</div>
          <div style={s.headerText}>
            <div style={s.appName}>TriForge AI</div>
            <div style={s.stepLabel}>Setup — Step {step + 1} of {TOTAL_STEPS}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={s.progressBar}>
          <div style={{ ...s.progressFill, width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
        </div>

        {/* Step content */}
        <div style={s.body}>
          {/* ── Step 0: Welcome + Role ─────────────────────────────────────────── */}
          {step === 0 && (
            <div>
              <h2 style={s.stepTitle}>Welcome to TriForge AI</h2>
              <p style={s.stepSubtitle}>
                TriForge runs a three-model council — OpenAI, Claude, and Grok — to give you multi-perspective decisions, autonomous task execution, and deep integration with your tools.
              </p>
              <p style={s.stepSubtitle}>Select the profile that best describes how you will use TriForge:</p>
              <div style={s.roleGrid}>
                {ROLE_OPTIONS.map(r => (
                  <button
                    key={r.id}
                    style={{ ...s.roleCard, ...(role === r.id ? s.roleCardActive : {}) }}
                    onClick={() => setRole(r.id)}
                  >
                    <span style={s.roleIcon}>{r.icon}</span>
                    <span style={s.roleLabel}>{r.label}</span>
                    <span style={s.roleDesc}>{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 1: System Access ─────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              <h2 style={s.stepTitle}>System Access</h2>
              <p style={s.stepSubtitle}>
                TriForge AI works as your personal remote worker — it can see your screen, control apps, and type for you. Grant OS-level permissions to unlock the full operator experience.
              </p>

              {/* Screen Recording + Accessibility */}
              <div style={s.accessBlock}>
                <div style={s.accessHeader}>
                  <span style={s.accessIcon}>◈</span>
                  <span style={s.accessName}>Screen Recording &amp; Accessibility</span>
                </div>
                <p style={s.accessDesc}>
                  {IS_MAC
                    ? 'macOS requires explicit permission to capture screenshots and control apps. Open Privacy & Security → grant Screen Recording and Accessibility to TriForge AI.'
                    : IS_WINDOWS
                    ? 'Windows requires TriForge to run as Administrator the first time so it can control other apps. Right-click the TriForge app → "Run as administrator" once, then normal launches will work.'
                    : 'Your platform manages permissions automatically.'}
                </p>
                {IS_MAC && (
                  <button style={s.primaryBtn} onClick={openSystemPrefs}>
                    Open Privacy &amp; Security
                  </button>
                )}
                {IS_WINDOWS && (
                  <div style={{ ...s.accessNote, color: '#f59e0b', marginTop: 8 }}>
                    Windows users: if TriForge cannot click or type in your app, close TriForge and relaunch it with "Run as administrator". This is a one-time step — the app will remember the permission.
                  </div>
                )}
                {sysPermNote && (
                  <div style={s.accessNote}>{sysPermNote}</div>
                )}
              </div>

              {/* On-Screen Keyboard — primary input method */}
              <div style={s.accessBlock}>
                <div style={s.accessHeader}>
                  <span style={s.accessIcon}>⌨</span>
                  <span style={s.accessName}>On-Screen Keyboard (Recommended)</span>
                </div>
                <p style={s.accessDesc}>
                  TriForge uses your screen as the input surface. The on-screen keyboard lets the AI type visibly and precisely — no background key injection, fully transparent. This is the recommended input method.
                </p>
                {oskStatus && (
                  <div style={{ fontSize: 12, color: oskStatus.visible ? '#10a37f' : 'var(--text-muted)', marginBottom: 8 }}>
                    {oskStatus.visible ? '● On-screen keyboard is active' : '○ On-screen keyboard is not open'}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    style={{ ...s.primaryBtn, ...(oskOpening ? s.btnDisabled : {}) }}
                    onClick={openOSK}
                    disabled={oskOpening}
                  >
                    {oskOpening ? 'Opening…' : oskOpened ? 'Reopen Keyboard' : 'Open On-Screen Keyboard'}
                  </button>
                  {oskOpened && (
                    <span style={{ fontSize: 12, color: '#10a37f' }}>✓ Keyboard opened</span>
                  )}
                </div>
                <p style={{ ...s.accessDesc, marginTop: 8, color: 'var(--text-muted)', fontSize: 11 }}>
                  You can always open or close the keyboard from Settings → Operator.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 2: Relay Setup ────────────────────────────────────────────── */}
          {step === 2 && (
            <div>
              <h2 style={s.stepTitle}>Remote Access <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>(Optional)</span></h2>
              <p style={s.stepSubtitle}>
                Remote Access lets you send tasks to TriForge from your phone or any browser — even when you are away from your desk. You need a relay server for this to work. Skip for now if you are just getting started.
              </p>

              {/* What is a relay — plain language */}
              <div style={{ ...s.accessBlock, background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.18)' }}>
                <div style={s.accessHeader}>
                  <span style={s.accessIcon}>◎</span>
                  <span style={s.accessName}>What is a relay?</span>
                </div>
                <p style={s.accessDesc}>
                  A relay server is a small cloud service that receives tasks from your phone and forwards them to this desktop. It never stores your data — it just passes messages through.
                </p>
                <p style={{ ...s.accessDesc, marginTop: 6 }}>
                  <strong>Setup takes ~5 minutes:</strong> Deploy the free TriForge Relay to{' '}
                  <strong>Railway.app</strong> or <strong>Render.com</strong> (both have free tiers), then paste the URL below.
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>Or skip this step — everything else works without it.</span>
                </p>
              </div>

              <div style={s.accessBlock}>
                <div style={s.accessHeader}>
                  <span style={s.accessIcon}>⊕</span>
                  <span style={s.accessName}>Connect Your Relay</span>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={s.relayFieldLabel}>Relay Server URL</div>
                  <input
                    type="text"
                    style={s.keyField}
                    placeholder="https://my-triforge-relay.railway.app"
                    value={relayUrl}
                    onChange={e => setRelayUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && registerRelay()}
                  />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={s.relayFieldLabel}>Device Label <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(what your phone will see)</span></div>
                  <input
                    type="text"
                    style={s.keyField}
                    placeholder="My Desktop"
                    value={relayLabel}
                    onChange={e => setRelayLabel(e.target.value)}
                  />
                </div>

                <button
                  style={{ ...s.primaryBtn, ...(!relayUrl.trim() || relayRegistering ? s.btnDisabled : {}) }}
                  onClick={registerRelay}
                  disabled={!relayUrl.trim() || relayRegistering}
                >
                  {relayRegistering ? 'Connecting…' : 'Register This Device'}
                </button>

                {relayResult && (
                  <div style={{ ...s.accessNote, color: relayResult.ok ? '#10a37f' : '#ef4444', marginTop: 8 }}>
                    {relayResult.ok
                      ? `✓ Connected — your phone can now trigger tasks on this device (Device ID: ${relayResult.deviceId})`
                      : `✗ Could not connect: ${relayResult.error}. Check the URL and try again.`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: API Keys ───────────────────────────────────────────────── */}
          {step === 3 && (
            <div>
              <h2 style={s.stepTitle}>Connect AI Providers</h2>
              <p style={s.stepSubtitle}>
                TriForge needs an API key from each AI provider to run its three-model council. You can add keys now or skip and add them in Settings later. All keys are stored locally.
              </p>

              <div style={s.progressPill}>
                <span style={{ color: connectedCount === 3 ? '#10a37f' : 'var(--text-muted)' }}>
                  {connectedCount} / 3 providers connected
                </span>
                {connectedCount === 3 && <span style={s.checkMark}>✓ Full consensus active</span>}
              </div>

              {PROVIDERS.map(p => {
                const liveError = keyError[p.id] || (apiKeys[p.id] ? validateKey(p.id, apiKeys[p.id]) : null);
                return (
                  <div key={p.id} style={s.keyRow}>
                    <div style={{ ...s.providerDot, background: p.color }} />
                    <div style={{ flex: 1 }}>
                      <div style={s.providerLabel}>{p.label}</div>
                      {keyStatus[p.id] ? (
                        <div style={s.keyConfigured}>
                          <span style={{ color: '#10a37f', fontSize: 12 }}>● Connected — stored locally on this device</span>
                          <button style={s.removeBtn} onClick={() => removeKey(p.id)}>Remove</button>
                        </div>
                      ) : (
                        <>
                          <div style={s.keyInputRow}>
                            <input
                              type="password"
                              style={{
                                ...s.keyField,
                                ...(liveError ? { borderColor: '#ef4444' } : {}),
                              }}
                              placeholder={p.placeholder}
                              value={apiKeys[p.id]}
                              onChange={e => {
                                setApiKeys(k => ({ ...k, [p.id]: e.target.value }));
                                if (keyError[p.id]) setKeyError(err => ({ ...err, [p.id]: '' }));
                              }}
                              onKeyDown={e => e.key === 'Enter' && saveKey(p.id)}
                            />
                            <button
                              style={{ ...s.primaryBtn, ...((!apiKeys[p.id].trim() || saving === p.id) ? s.btnDisabled : {}) }}
                              onClick={() => saveKey(p.id)}
                              disabled={!apiKeys[p.id].trim() || saving === p.id}
                            >
                              {saving === p.id ? '…' : 'Save'}
                            </button>
                            <a
                              href={p.keysUrl}
                              onClick={e => { e.preventDefault(); window.triforge.system.openExternal(p.keysUrl); }}
                              style={s.getKeyLink}
                            >
                              Get key →
                            </a>
                          </div>
                          {liveError && (
                            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>
                              {liveError}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Skip-for-now callout — make it explicit that this step is optional
                  so users don't feel forced into the browser detour. */}
              <div style={{
                marginTop: 14, padding: '10px 12px',
                background: 'var(--surface-alt, #16161a)',
                border: '1px solid var(--border)', borderRadius: 6,
                fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
              }}>
                Don't have a key right now? <strong style={{ color: 'var(--text-primary)' }}>Click Next</strong> — you can add keys anytime in Settings → API Keys. TriForge will guide you back here. Keys are stored only on this device, never sent to TriForge servers.
              </div>
            </div>
          )}

          {/* ── Step 4: Integrations ───────────────────────────────────────────── */}
          {step === 4 && (
            <div>
              <h2 style={s.stepTitle}>Connect Integrations</h2>
              <p style={s.stepSubtitle}>
                Optionally connect GitHub and Slack to unlock automated code reviews, issue triage, and Slack summaries. All integrations can be configured or changed later in Settings.
              </p>

              {/* GitHub */}
              <div style={s.integBlock}>
                <div style={s.integHeader}>
                  <span style={s.integIcon}>◈</span>
                  <span style={s.integName}>GitHub</span>
                  {githubSaved && (
                    <span style={{ color: integWorking.github ? '#10a37f' : '#ef4444', fontSize: 12, marginLeft: 8 }}>
                      {integWorking.github ? '● Connected' : '● Token saved (verify credentials)'}
                    </span>
                  )}
                </div>
                <p style={s.integDesc}>Personal access token — enables PR review, issue triage, and webhook events.</p>
                {!githubSaved ? (
                  <div style={s.keyInputRow}>
                    <input
                      type="password"
                      style={s.keyField}
                      placeholder="ghp_…"
                      value={githubToken}
                      onChange={e => setGithubToken(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveGithub()}
                    />
                    <button
                      style={{ ...s.primaryBtn, ...(!githubToken.trim() || saving === 'github' ? s.btnDisabled : {}) }}
                      onClick={saveGithub}
                      disabled={!githubToken.trim() || saving === 'github'}
                    >
                      {saving === 'github' ? '…' : 'Connect'}
                    </button>
                  </div>
                ) : (
                  <button style={s.outlineBtn} onClick={() => { setGithubSaved(false); setGithubToken(''); }}>
                    Replace token
                  </button>
                )}
              </div>

              {/* Slack */}
              <div style={s.integBlock}>
                <div style={s.integHeader}>
                  <span style={s.integIcon}>⊟</span>
                  <span style={s.integName}>Slack</span>
                  {slackSaved && (
                    <span style={{ color: integWorking.slack ? '#10a37f' : '#ef4444', fontSize: 12, marginLeft: 8 }}>
                      {integWorking.slack ? '● Connected' : '● Token saved (verify credentials)'}
                    </span>
                  )}
                </div>
                <p style={s.integDesc}>Bot token — enables channel summaries, automated replies, and incident escalation.</p>
                {!slackSaved ? (
                  <div style={s.keyInputRow}>
                    <input
                      type="password"
                      style={s.keyField}
                      placeholder="xoxb-…"
                      value={slackToken}
                      onChange={e => setSlackToken(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveSlack()}
                    />
                    <button
                      style={{ ...s.primaryBtn, ...(!slackToken.trim() || saving === 'slack' ? s.btnDisabled : {}) }}
                      onClick={saveSlack}
                      disabled={!slackToken.trim() || saving === 'slack'}
                    >
                      {saving === 'slack' ? '…' : 'Connect'}
                    </button>
                  </div>
                ) : (
                  <button style={s.outlineBtn} onClick={() => { setSlackSaved(false); setSlackToken(''); }}>
                    Replace token
                  </button>
                )}
              </div>

              <p style={s.moreInteg}>
                Jira, Linear, Telegram, Discord, and trading integrations are available in <strong>Settings → Integrations</strong>.
              </p>
            </div>
          )}

          {/* ── Step 5: Permissions ────────────────────────────────────────────── */}
          {step === 5 && (
            <div>
              <h2 style={s.stepTitle}>Grant Permissions</h2>
              <p style={s.stepSubtitle}>
                Choose what TriForge AI is allowed to do on your behalf. These can be changed at any time in Settings.
              </p>
              <PermCategory label="System" perms={permByCategory('system')} onToggle={togglePermission} />
              <PermCategory label="Communication" perms={permByCategory('communication')} onToggle={togglePermission} />
              <PermCategory label="Business" perms={permByCategory('business')} onToggle={togglePermission} />
              <PermCategory label="Finance" perms={permByCategory('finance')} onToggle={togglePermission} />
            </div>
          )}

          {/* ── Step 6: Ready ─────────────────────────────────────────────────── */}
          {step === 6 && (
            <div>
              <h2 style={s.stepTitle}>TriForge is Ready</h2>
              <p style={s.stepSubtitle}>
                Your workspace is configured. Here is a summary of what was set up and your recommended next steps.
              </p>

              {/* Summary */}
              <div style={s.summaryGrid}>
                <SummaryItem
                  label="AI Providers"
                  value={`${connectedCount} / 3 connected`}
                  status={connectedCount === 3 ? 'good' : connectedCount > 0 ? 'warn' : 'bad'}
                  hint={connectedCount < 3 ? 'Add remaining keys in Settings' : undefined}
                />
                <SummaryItem
                  label="On-Screen Keyboard"
                  value={oskOpened ? 'Opened' : oskStatus?.visible ? 'Active' : 'Not opened'}
                  status={oskOpened || oskStatus?.visible ? 'good' : 'warn'}
                  hint={!oskOpened && !oskStatus?.visible ? 'Open in Settings → Operator' : undefined}
                />
                <SummaryItem
                  label="Remote Relay"
                  value={relayResult?.ok ? 'Registered' : 'Not configured'}
                  status={relayResult?.ok ? 'good' : 'neutral'}
                  hint={!relayResult?.ok ? 'Configure in Settings → Relay' : undefined}
                />
                <SummaryItem
                  label="GitHub"
                  value={githubSaved ? (integWorking.github ? 'Connected' : 'Token saved') : 'Not connected'}
                  status={githubSaved && integWorking.github ? 'good' : githubSaved ? 'warn' : 'neutral'}
                />
                <SummaryItem
                  label="Slack"
                  value={slackSaved ? (integWorking.slack ? 'Connected' : 'Token saved') : 'Not connected'}
                  status={slackSaved && integWorking.slack ? 'good' : slackSaved ? 'warn' : 'neutral'}
                />
                <SummaryItem
                  label="Role"
                  value={ROLE_OPTIONS.find(r => r.id === role)?.label ?? role}
                  status="neutral"
                />
              </div>

              {/* Capability scan result — what TriForge found installed on this machine */}
              <div style={s.scanPanel}>
                <div style={s.scanPanelTitle}>
                  Detected on this machine
                  {scanLoading && <span style={s.scanPanelHint}>  scanning…</span>}
                </div>
                {!scanLoading && capabilityScan && capabilityScan.installedApps.length > 0 && (
                  <>
                    <div style={s.scanAppsRow}>
                      {capabilityScan.installedApps.slice(0, 12).map(app => {
                        const isOperatorApp = /unreal|photoshop|blender|premiere|after effects|davinci|illustrator|figma|maya|houdini|substance/i.test(app.name);
                        return (
                          <div
                            key={app.path}
                            style={{
                              ...s.scanAppChip,
                              borderColor: isOperatorApp ? '#10a37f' : 'var(--border)',
                              color:       isOperatorApp ? '#10a37f' : 'var(--text)',
                            }}
                            title={app.path}
                          >
                            {app.name}
                            {app.version && <span style={s.scanAppVer}>  {app.version}</span>}
                          </div>
                        );
                      })}
                      {capabilityScan.installedApps.length > 12 && (
                        <div style={{ ...s.scanAppChip, borderStyle: 'dashed' }}>
                          +{capabilityScan.installedApps.length - 12} more
                        </div>
                      )}
                    </div>
                    <div style={s.scanMeta}>
                      {capabilityScan.gpuName && <span>GPU: {capabilityScan.gpuName}{capabilityScan.gpuVramMB ? ` (${(capabilityScan.gpuVramMB / 1024).toFixed(1)} GB)` : ''}</span>}
                      {capabilityScan.storageGB > 0 && <span>  •  Storage: {capabilityScan.storageGB.toFixed(0)} GB free</span>}
                    </div>
                    <div style={s.scanCallout}>
                      TriForge can drive these apps directly from the Operate tab — open one and tell the Council what to build.
                    </div>
                  </>
                )}
                {!scanLoading && (!capabilityScan || capabilityScan.installedApps.length === 0) && (
                  <div style={s.scanEmpty}>
                    No creator apps detected. TriForge can still help with chat, browser, files, and email — install Unreal, Photoshop, or Blender to unlock the Operate workflows.
                  </div>
                )}
              </div>

              {/* Next steps by role */}
              <div style={s.nextSteps}>
                <div style={s.nextStepsTitle}>Your first 3 minutes with TriForge</div>
                {role === 'solo' && (
                  <ul style={s.nextList}>
                    <li><strong>Chat tab:</strong> Type any question or task — the Council answers with all 3 models</li>
                    <li><strong>Operate tab:</strong> Open Unreal Engine, then type "build me a survival game" — watch TriForge write the Blueprint files and compile</li>
                    <li><strong>Operate → AI Task Runner:</strong> Describe any task in plain English (e.g. "Export current Blender scene as PNG") — TriForge sees your screen and does it</li>
                  </ul>
                )}
                {role === 'team' && (
                  <ul style={s.nextList}>
                    <li><strong>Chat tab:</strong> Paste a block of code and ask "what's wrong with this?" — all 3 models review it independently</li>
                    <li><strong>Operate tab:</strong> Describe a task in any open app and TriForge will execute it step-by-step, pausing for approval before sensitive actions</li>
                    <li><strong>Settings → Relay:</strong> Set up remote access so your team can trigger tasks from their phones</li>
                  </ul>
                )}
                {role === 'enterprise' && (
                  <ul style={s.nextList}>
                    <li><strong>Chat tab:</strong> Ask the Council any question — consensus mode gives you a multi-model verified answer with a confidence score</li>
                    <li><strong>Operate tab:</strong> Try a Workflow Pack to see how TriForge executes structured, approval-gated automation</li>
                    <li><strong>Settings → Relay:</strong> Connect a relay server so operators can trigger tasks remotely across your org</li>
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div style={s.footer}>
          {step > 0 && (
            <button style={s.backBtn} onClick={() => setStep(s => s - 1)}>Back</button>
          )}
          <div style={{ flex: 1 }} />
          {step < TOTAL_STEPS - 1 ? (
            <button style={s.nextBtn} onClick={() => setStep(s => s + 1)}>
              {step === 2 || step === 4 ? 'Skip / Next' : 'Next'}
            </button>
          ) : (
            <button style={{ ...s.nextBtn, background: '#10a37f' }} onClick={finish}>
              Start using TriForge
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SummaryItem ───────────────────────────────────────────────────────────────

type StatusLevel = 'good' | 'warn' | 'bad' | 'neutral';
const STATUS_COLORS: Record<StatusLevel, string> = { good: '#10a37f', warn: '#f59e0b', bad: '#ef4444', neutral: 'var(--text-muted)' };

function SummaryItem({ label, value, status, hint }: { label: string; value: string; status: StatusLevel; hint?: string }) {
  return (
    <div style={s.summaryItem}>
      <div style={s.summaryLabel}>{label}</div>
      <div style={{ ...s.summaryValue, color: STATUS_COLORS[status] }}>{value}</div>
      {hint && <div style={s.summaryHint}>{hint}</div>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'var(--bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  card: {
    width: 560, maxHeight: '90vh',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '20px 24px 0',
  },
  logoMark: {
    fontSize: 28, color: 'var(--accent)',
  },
  headerText: {
    display: 'flex', flexDirection: 'column',
  },
  appName: {
    fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
    letterSpacing: '0.02em',
  },
  stepLabel: {
    fontSize: 11, color: 'var(--text-muted)',
  },
  progressBar: {
    height: 3, background: 'var(--border)', margin: '16px 0 0',
  },
  progressFill: {
    height: '100%', background: 'var(--accent)',
    transition: 'width 0.3s ease',
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '24px 24px 8px',
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 24px',
    borderTop: '1px solid var(--border)',
  },
  stepTitle: {
    fontSize: 18, fontWeight: 700, color: 'var(--text-primary)',
    margin: '0 0 8px',
  },
  stepSubtitle: {
    fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
    margin: '0 0 20px',
  },

  // Role selection
  roleGrid: {
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  roleCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    gap: 4, padding: '14px 16px',
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 8, cursor: 'pointer', textAlign: 'left',
    transition: 'border-color 0.15s',
  },
  roleCardActive: {
    borderColor: 'var(--accent)', background: 'rgba(99,102,241,0.07)',
  },
  roleIcon: { fontSize: 18, color: 'var(--accent)' },
  roleLabel: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  roleDesc:  { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 },

  // API Keys
  progressPill: {
    display: 'flex', alignItems: 'center', gap: 10,
    fontSize: 12, color: 'var(--text-muted)',
    marginBottom: 16,
  },
  checkMark: { color: '#10a37f', fontWeight: 600 },
  keyRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '12px 0', borderBottom: '1px solid var(--border)',
  },
  providerDot: {
    width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
  },
  providerLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 },
  keyConfigured: { display: 'flex', alignItems: 'center', gap: 10 },
  keyInputRow: { display: 'flex', alignItems: 'center', gap: 6 },
  keyField: {
    flex: 1, height: 30, padding: '0 8px',
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'monospace',
  },
  getKeyLink: {
    fontSize: 11, color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  // Integrations
  integBlock: {
    padding: '14px 0', borderBottom: '1px solid var(--border)',
  },
  integHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  integIcon:   { fontSize: 14, color: 'var(--accent)' },
  integName:   { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  integDesc:   { fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' },
  moreInteg:   { fontSize: 12, color: 'var(--text-muted)', marginTop: 16 },

  // Permissions
  permCategory: { marginBottom: 16 },
  permCategoryLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8,
  },
  permRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '7px 0', borderBottom: '1px solid var(--border)',
  },
  permLabel: { fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 },
  permDesc:  { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  toggle: {
    width: 36, height: 20, borderRadius: 10,
    background: 'var(--border)', border: 'none',
    cursor: 'pointer', position: 'relative', flexShrink: 0,
    transition: 'background 0.2s',
  },
  toggleOn: { background: 'var(--accent)' },
  toggleKnob: {
    position: 'absolute', top: 3, left: 3,
    width: 14, height: 14, borderRadius: '50%',
    background: '#fff', transition: 'left 0.2s',
  },
  toggleKnobOn: { left: 19 },

  // Done step
  summaryGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: 10, marginBottom: 20,
  },
  summaryItem: {
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 7, padding: '10px 12px',
  },
  summaryLabel: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 },
  summaryValue: { fontSize: 13, fontWeight: 600 },
  summaryHint:  { fontSize: 11, color: 'var(--text-muted)', marginTop: 3 },
  nextSteps: {
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 7, padding: '12px 14px',
  },
  nextStepsTitle: { fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 },
  nextList: {
    margin: 0, paddingLeft: 18,
    fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8,
  },

  // Capability scan panel (Step 6)
  scanPanel: {
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 7, padding: '12px 14px',
    marginBottom: 12,
  },
  scanPanelTitle: {
    fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
    marginBottom: 10,
  },
  scanPanelHint:  { fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' },
  scanAppsRow: {
    display: 'flex', flexWrap: 'wrap', gap: 6,
  },
  scanAppChip: {
    fontSize: 11, padding: '4px 8px',
    border: '1px solid var(--border)', borderRadius: 4,
    background: 'var(--bg)',
  },
  scanAppVer: { fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 },
  scanMeta: {
    fontSize: 11, color: 'var(--text-muted)', marginTop: 8,
  },
  scanCallout: {
    fontSize: 11, color: '#10a37f', marginTop: 8, lineHeight: 1.5,
  },
  scanEmpty: {
    fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
  },

  // Buttons
  primaryBtn: {
    height: 30, padding: '0 12px',
    background: 'var(--accent)', border: 'none',
    borderRadius: 5, color: '#fff', fontSize: 12,
    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  outlineBtn: {
    height: 28, padding: '0 12px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-secondary)', fontSize: 12,
    cursor: 'pointer',
  },
  removeBtn: {
    height: 24, padding: '0 10px',
    background: 'transparent', border: '1px solid #ef4444',
    borderRadius: 4, color: '#ef4444', fontSize: 11,
    cursor: 'pointer',
  },
  backBtn: {
    height: 34, padding: '0 16px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-secondary)', fontSize: 13,
    cursor: 'pointer',
  },
  nextBtn: {
    height: 34, padding: '0 20px',
    background: 'var(--accent)', border: 'none',
    borderRadius: 6, color: '#fff', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  },

  // System Access + Relay steps
  accessBlock: {
    padding: '14px 0', borderBottom: '1px solid var(--border)',
  },
  accessHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  accessIcon:   { fontSize: 14, color: 'var(--accent)' },
  accessName:   { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  accessDesc:   { fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px', lineHeight: 1.6 },
  accessNote:   { fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 },
  relayFieldLabel: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
  },
};
