import React, { useState, useEffect, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────

export type EngineProfileType = 'saas' | 'realestate' | 'restaurant';

type ForgeSession = {
  profileType: EngineProfileType;
  answers: Record<string, string>;
  blueprint: Record<string, string>;
  assets: string[];
  buildOutput: Record<string, string[]>;
  status: 'idle' | 'onboarding' | 'generating' | 'ready' | 'launched';
};

interface Question {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
}

interface Props {
  profileType: EngineProfileType;
  onBack: () => void;
}

// ── Question definitions ────────────────────────────────────────────────────

const QUESTIONS: Record<EngineProfileType, Question[]> = {
  saas: [
    { key: 'problem',  label: 'What problem does your SaaS solve?',   type: 'text' },
    { key: 'audience', label: 'Who is your target audience?',          type: 'text' },
    { key: 'appType',  label: 'App type',    type: 'select', options: ['web', 'mobile'] },
    { key: 'pricing',  label: 'Pricing model', type: 'select', options: ['free', 'paid'] },
  ],
  realestate: [
    { key: 'city',       label: 'City / market?',        type: 'text' },
    { key: 'focus',      label: 'Focus area',            type: 'select', options: ['buyer', 'seller'] },
    { key: 'priceRange', label: 'Target price range?',   type: 'text' },
  ],
  restaurant: [
    { key: 'cuisine',     label: 'Cuisine type?',   type: 'text' },
    { key: 'location',    label: 'Location / city?', type: 'text' },
    { key: 'serviceType', label: 'Service type',    type: 'select', options: ['dine-in', 'takeout'] },
  ],
};

const ENGINE_META: Record<EngineProfileType, { label: string; icon: string }> = {
  saas:       { label: 'SaaS Builder',       icon: '💻' },
  realestate: { label: 'Real Estate Growth', icon: '🏠' },
  restaurant: { label: 'Restaurant Growth',  icon: '🍽' },
};

const STORAGE_KEY = 'triforge-forge-session';

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadSession(profileType: EngineProfileType): ForgeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: ForgeSession = JSON.parse(raw);
    if (parsed.profileType !== profileType) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: ForgeSession): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* ignore */ }
}

function clearSession(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function buildInitialAnswers(profileType: EngineProfileType): Record<string, string> {
  return Object.fromEntries(QUESTIONS[profileType].map(q => [q.key, '']));
}

// ── Component ───────────────────────────────────────────────────────────────

export function ForgeEngine({ profileType, onBack }: Props) {
  const meta = ENGINE_META[profileType];
  const questions = QUESTIONS[profileType];

  const [session, setSession] = useState<ForgeSession>(() => {
    const saved = loadSession(profileType);
    if (saved && saved.status !== 'idle') return saved;
    return {
      profileType,
      answers: buildInitialAnswers(profileType),
      blueprint: {},
      assets: [],
      buildOutput: {},
      status: 'onboarding',
    };
  });

  const [phaseText, setPhaseText] = useState('Initializing engine…');
  const [error, setError] = useState<string | null>(null);

  // Listen to forge:update events during generation
  useEffect(() => {
    if (session.status !== 'generating') return;
    const unsub = (window as any).triforge.forge.onUpdate(
      (data: { phase: string; provider?: string; completedCount?: number; total?: number }) => {
        if (data.phase === 'querying')             setPhaseText('Analyzing inputs…');
        else if (data.phase === 'provider:responding') setPhaseText('Querying AI systems…');
        else if (data.phase === 'provider:complete')   setPhaseText('Synthesizing results…');
        else if (data.phase === 'synthesis:start')     setPhaseText('Synthesizing results…');
        else if (data.phase === 'complete')             setPhaseText('Engine complete.');
      }
    );
    return unsub;
  }, [session.status]);

  const updateAnswer = useCallback((key: string, value: string) => {
    setSession(s => ({ ...s, answers: { ...s.answers, [key]: value } }));
  }, []);

  const handleContinue = useCallback(async () => {
    const unanswered = questions.filter(q => !session.answers[q.key]?.trim());
    if (unanswered.length > 0) {
      setError(`Please answer all questions before continuing.`);
      return;
    }
    setError(null);
    const next: ForgeSession = { ...session, status: 'generating' };
    setSession(next);
    saveSession(next);
    setPhaseText('Initializing engine…');

    try {
      const result = await (window as any).triforge.forgeEngine.run(profileType, session.answers);
      if (result.error) {
        setError(result.error);
        setSession(s => { const u = { ...s, status: 'onboarding' as const }; saveSession(u); return u; });
        return;
      }
      const ready: ForgeSession = {
        ...session,
        blueprint: result.blueprint ?? {},
        assets: result.assets ?? [],
        buildOutput: result.buildOutput ?? {},
        status: 'ready',
      };
      setSession(ready);
      saveSession(ready);
    } catch (err: unknown) {
      setError('Engine failed. Please try again.');
      setSession(s => { const u = { ...s, status: 'onboarding' as const }; saveSession(u); return u; });
    }
  }, [profileType, session, questions]);

  const handleLaunch = useCallback(() => {
    setSession(s => { const u = { ...s, status: 'launched' as const }; saveSession(u); return u; });
  }, []);

  const handleReset = useCallback(() => {
    clearSession();
    setError(null);
    setSession({
      profileType,
      answers: buildInitialAnswers(profileType),
      blueprint: {},
      assets: [],
      buildOutput: {},
      status: 'onboarding',
    });
  }, [profileType]);

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <span style={styles.engineLabel}>{meta.icon} {meta.label}</span>
        {session.status !== 'generating' && (
          <button style={styles.resetBtn} onClick={handleReset}>Reset</button>
        )}
      </div>

      {/* ONBOARDING */}
      {session.status === 'onboarding' && (
        <div style={styles.card}>
          <p style={styles.cardTitle}>Tell us about your business</p>
          <p style={styles.cardSub}>Answer a few questions so the engine can build your custom plan.</p>
          <div style={styles.form}>
            {questions.map(q => (
              <div key={q.key} style={styles.fieldRow}>
                <label style={styles.label}>{q.label}</label>
                {q.type === 'select' ? (
                  <select
                    style={styles.select}
                    value={session.answers[q.key] || ''}
                    onChange={e => updateAnswer(q.key, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {q.options!.map(o => (
                      <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={styles.input}
                    type="text"
                    value={session.answers[q.key] || ''}
                    onChange={e => updateAnswer(q.key, e.target.value)}
                    placeholder=""
                  />
                )}
              </div>
            ))}
            {error && <p style={styles.errorText}>{error}</p>}
            <button style={styles.continueBtn} onClick={handleContinue}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* GENERATING */}
      {session.status === 'generating' && (
        <div style={styles.card}>
          <div style={styles.generatingInner}>
            <div style={styles.spinner} />
            <p style={styles.generatingPhase}>{phaseText}</p>
            <p style={styles.generatingSub}>The AI council is building your business engine. This takes 20–60 seconds.</p>
          </div>
        </div>
      )}

      {/* READY */}
      {session.status === 'ready' && (
        <div style={styles.readyRoot}>
          {/* Blueprint */}
          <Section title="Blueprint">
            <div style={styles.blueprintGrid}>
              {Object.entries(session.blueprint).map(([key, value]) => (
                <div key={key} style={styles.blueprintCard}>
                  <p style={styles.blueprintKey}>{formatKey(key)}</p>
                  <p style={styles.blueprintVal}>{String(value)}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Assets */}
          {session.assets.length > 0 && (
            <Section title="Assets">
              <ul style={styles.assetList}>
                {session.assets.map((a, i) => (
                  <li key={i} style={styles.assetItem}>{a}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* Build Output */}
          {Object.keys(session.buildOutput).length > 0 && (
            <Section title="Build Output">
              <div style={styles.buildGrid}>
                {Object.entries(session.buildOutput).map(([key, items]) => (
                  <div key={key} style={styles.buildCard}>
                    <p style={styles.buildCardTitle}>{formatKey(key)}</p>
                    <ul style={styles.buildList}>
                      {(Array.isArray(items) ? items : []).map((item, i) => (
                        <li key={i} style={styles.buildItem}>{String(item)}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Launch */}
          <div style={styles.launchRow}>
            <button style={styles.launchBtn} onClick={handleLaunch}>
              🚀 Launch This Business
            </button>
          </div>
        </div>
      )}

      {/* LAUNCHED */}
      {session.status === 'launched' && (
        <div style={styles.card}>
          <div style={styles.launchedInner}>
            <p style={styles.launchedIcon}>🚀</p>
            <p style={styles.launchedTitle}>Engine Launched</p>
            <p style={styles.launchedSub}>Your business build is ready. Use the assets and blueprint above to execute your plan.</p>
            <button style={styles.resetBtn2} onClick={handleReset}>Start New Build</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <p style={styles.sectionTitle}>{title}</p>
      {children}
    </div>
  );
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '0 0 32px',
    minHeight: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  backBtn: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  resetBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    padding: '3px 9px',
    cursor: 'pointer',
  },
  engineLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: '0.3px',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '24px 20px',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: '0 0 4px',
  },
  cardSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
  },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    padding: '8px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    padding: '8px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  errorText: {
    fontSize: 11,
    color: '#f87171',
    margin: 0,
  },
  continueBtn: {
    marginTop: 6,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: 7,
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    padding: '10px 0',
    cursor: 'pointer',
    width: '100%',
    letterSpacing: '0.3px',
  },
  generatingInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    padding: '12px 0',
  },
  spinner: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '3px solid rgba(99,102,241,0.2)',
    borderTop: '3px solid #6366f1',
    animation: 'spin 0.9s linear infinite',
  },
  generatingPhase: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.75)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  generatingSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
    textAlign: 'center',
  },
  readyRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  section: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '16px 16px 20px',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    margin: '0 0 12px',
  },
  blueprintGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  blueprintCard: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 7,
    padding: '10px 12px',
    border: '1px solid rgba(255,255,255,0.07)',
  },
  blueprintKey: {
    fontSize: 10,
    fontWeight: 700,
    color: '#818cf8',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    margin: '0 0 5px',
  },
  blueprintVal: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    margin: 0,
    lineHeight: 1.5,
  },
  assetList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  assetItem: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    padding: '7px 10px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 5,
    borderLeft: '2px solid rgba(99,102,241,0.5)',
  },
  buildGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 10,
  },
  buildCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 7,
    padding: '10px 12px',
    border: '1px solid rgba(255,255,255,0.07)',
  },
  buildCardTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#34d399',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    margin: '0 0 7px',
  },
  buildList: {
    listStyle: 'disc',
    paddingLeft: 14,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  buildItem: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.4,
  },
  launchRow: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 4,
  },
  launchBtn: {
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    padding: '12px 32px',
    cursor: 'pointer',
    letterSpacing: '0.3px',
  },
  launchedInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
    textAlign: 'center',
  },
  launchedIcon: {
    fontSize: 36,
    margin: 0,
  },
  launchedTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: 0,
  },
  launchedSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    maxWidth: 340,
    lineHeight: 1.5,
  },
  resetBtn2: {
    marginTop: 8,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    padding: '7px 18px',
    cursor: 'pointer',
  },
};
