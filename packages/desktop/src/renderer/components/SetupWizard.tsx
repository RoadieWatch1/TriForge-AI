import React, { useState, useEffect } from 'react';
import type { Permission } from '../../main/store';

export type UserRole = 'solo' | 'team' | 'enterprise';

interface SetupWizardProps {
  permissions: Permission[];
  onComplete: (permissions: Permission[], role: UserRole) => void;
}

const TOTAL_STEPS = 5;

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

  // Step 1: API Keys
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({ openai: false, claude: false, grok: false });
  const [apiKeys,   setApiKeys]   = useState<Record<string, string>>({ openai: '', claude: '', grok: '' });
  const [saving,    setSaving]    = useState<string | null>(null);

  // Step 2: Integrations
  const [githubToken, setGithubToken] = useState('');
  const [slackToken,  setSlackToken]  = useState('');
  const [githubSaved, setGithubSaved] = useState(false);
  const [slackSaved,  setSlackSaved]  = useState(false);
  const [integWorking, setIntegWorking] = useState<Record<string, boolean>>({});

  // Step 3: Permissions
  const [permissions, setPermissions] = useState<Permission[]>(initialPermissions);

  useEffect(() => {
    let mounted = true;
    window.triforge.keys.status()
      .then(s => { if (mounted) setKeyStatus(s); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const refreshKeys = async () => {
    try { setKeyStatus(await window.triforge.keys.status()); } catch { /* ok */ }
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

          {/* ── Step 1: API Keys ───────────────────────────────────────────────── */}
          {step === 1 && (
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

              {PROVIDERS.map(p => (
                <div key={p.id} style={s.keyRow}>
                  <div style={{ ...s.providerDot, background: p.color }} />
                  <div style={{ flex: 1 }}>
                    <div style={s.providerLabel}>{p.label}</div>
                    {keyStatus[p.id] ? (
                      <div style={s.keyConfigured}>
                        <span style={{ color: '#10a37f', fontSize: 12 }}>● Connected</span>
                        <button style={s.removeBtn} onClick={() => removeKey(p.id)}>Remove</button>
                      </div>
                    ) : (
                      <div style={s.keyInputRow}>
                        <input
                          type="password"
                          style={s.keyField}
                          placeholder={p.placeholder}
                          value={apiKeys[p.id]}
                          onChange={e => setApiKeys(k => ({ ...k, [p.id]: e.target.value }))}
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
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Step 2: Integrations ───────────────────────────────────────────── */}
          {step === 2 && (
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

          {/* ── Step 3: Permissions ────────────────────────────────────────────── */}
          {step === 3 && (
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

          {/* ── Step 4: Ready ─────────────────────────────────────────────────── */}
          {step === 4 && (
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

              {/* Next steps by role */}
              <div style={s.nextSteps}>
                <div style={s.nextStepsTitle}>Recommended next steps</div>
                {role === 'solo' && (
                  <ul style={s.nextList}>
                    <li>Open <strong>TriForge</strong> and ask the Council your first question</li>
                    <li>Visit <strong>Automate</strong> to create your first runbook</li>
                    <li>Try <strong>Hustle</strong> for venture discovery and growth tools</li>
                  </ul>
                )}
                {role === 'team' && (
                  <ul style={s.nextList}>
                    <li>Open <strong>Operate</strong> and connect your GitHub repo for PR review</li>
                    <li>Visit <strong>Automate</strong> and import the GitHub + Slack review pack</li>
                    <li>Set up <strong>Dispatch</strong> so teammates can trigger runbooks remotely</li>
                  </ul>
                )}
                {role === 'enterprise' && (
                  <ul style={s.nextList}>
                    <li>Open <strong>Control</strong> to create your first workspace and invite members</li>
                    <li>Visit <strong>Automate</strong> and configure trust policies for runbook packs</li>
                    <li>Enable <strong>Push Notifications</strong> and review policy inheritance in Settings</li>
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
              {step === 2 ? 'Skip / Next' : 'Next'}
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
};
