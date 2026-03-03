import React, { useState, useEffect, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────

interface Question {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
}

export interface UIEngineConfig {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  detail: string;
  questions: Question[];
}

type AssetItem = { type: string; body: string };

type MarketingVisual = { prompt: string; description: string };

type ExecutionData = {
  executionPlan: { immediate: string[]; thisWeek: string[]; nextPhase: string[] };
  firstTask: {
    title: string;
    objective: string;
    steps: string[];
    resources?: string[];
    deliverable: string;
  };
  marketing?: {
    poster?: MarketingVisual;
    website?: MarketingVisual;
    app?: MarketingVisual;
  };
};

type ForgeSession = {
  engineId: string;
  answers: Record<string, string>;
  blueprint: Record<string, string>;
  assets: AssetItem[];
  buildOutput: Record<string, string[]>;
  execution?: ExecutionData;
  status: 'idle' | 'onboarding' | 'generating' | 'ready' | 'activating' | 'launched' | 'executing';
};

interface Props {
  engineConfig: UIEngineConfig;
  onBack: () => void;
}

// Bump key to clear sessions from previous schemas
const STORAGE_KEY = 'triforge-forge-session-v4';

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadSession(engineId: string): ForgeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: ForgeSession = JSON.parse(raw);
    if (parsed.engineId !== engineId) return null;
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

function buildInitialAnswers(questions: Question[]): Record<string, string> {
  return Object.fromEntries(questions.map(q => [q.key, '']));
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ── Component ───────────────────────────────────────────────────────────────

export function ForgeEngine({ engineConfig, onBack }: Props) {
  const { id: engineId, name: engineName, icon: engineIcon, questions } = engineConfig;

  const [session, setSession] = useState<ForgeSession>(() => {
    const saved = loadSession(engineId);
    if (saved && saved.status !== 'idle') return saved;
    return {
      engineId,
      answers: buildInitialAnswers(questions),
      blueprint: {},
      assets: [],
      buildOutput: {},
      status: 'onboarding',
    };
  });

  const [phaseText, setPhaseText] = useState('Initializing engine…');
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [executionLoading, setExecutionLoading] = useState(false);

  // Listen to forge:update events during generation
  useEffect(() => {
    if (session.status !== 'generating') return;
    const unsub = (window as any).triforge.forge.onUpdate(
      (data: { phase: string; provider?: string; completedCount?: number; total?: number }) => {
        if (data.phase === 'querying')               setPhaseText('Analyzing your inputs…');
        else if (data.phase === 'provider:responding') setPhaseText('Querying AI systems…');
        else if (data.phase === 'provider:complete')   setPhaseText('Cross-referencing responses…');
        else if (data.phase === 'synthesis:start')     setPhaseText('Synthesizing final output…');
        else if (data.phase === 'complete')             setPhaseText('Build complete.');
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
      setError('Please answer all questions before continuing.');
      return;
    }
    setError(null);
    const next: ForgeSession = { ...session, status: 'generating' };
    setSession(next);
    saveSession(next);
    setPhaseText('Initializing engine…');

    try {
      const result = await (window as any).triforge.forgeEngine.run(engineId, session.answers);
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
    } catch {
      setError('Engine failed. Please try again.');
      setSession(s => { const u = { ...s, status: 'onboarding' as const }; saveSession(u); return u; });
    }
  }, [engineId, session, questions]);

  const handleLaunch = useCallback(() => {
    const { blueprint, buildOutput } = session;
    setSession(s => { const u = { ...s, status: 'activating' as const }; saveSession(u); return u; });
    setTimeout(async () => {
      setSession(s => {
        if (s.status !== 'activating') return s;
        const u = { ...s, status: 'launched' as const };
        saveSession(u);
        return u;
      });
      setExecutionLoading(true);
      try {
        const result = await (window as any).triforge.forgeEngine.executeFirstStep(
          engineId, blueprint, buildOutput,
        );
        if (!result.error && result.firstTask) {
          setSession(s => {
            if (s.status !== 'launched' && s.status !== 'executing') return s;
            const u: ForgeSession = {
              ...s,
              status: 'executing',
              execution: {
                executionPlan: result.executionPlan ?? { immediate: [], thisWeek: [], nextPhase: [] },
                firstTask: result.firstTask,
                marketing: result.marketing,
              },
            };
            saveSession(u);
            return u;
          });
        }
      } catch { /* execution section stays in loading state */ }
      finally { setExecutionLoading(false); }
    }, 1800);
  }, [session, engineId]);

  const handleReset = useCallback(() => {
    clearSession();
    setError(null);
    setCopiedIdx(null);
    setSession({
      engineId,
      answers: buildInitialAnswers(questions),
      blueprint: {},
      assets: [],
      buildOutput: {},
      status: 'onboarding',
    });
  }, [engineId, questions]);

  const handleCopyAsset = useCallback((body: string, idx: number) => {
    navigator.clipboard.writeText(body).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(i => i === idx ? null : i), 2000);
    }).catch(() => {/* clipboard not available */});
  }, []);

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <span style={styles.engineLabel}>{engineIcon} {engineName}</span>
        {session.status !== 'generating' && (
          <button style={styles.resetBtn} onClick={handleReset}>Reset</button>
        )}
      </div>

      {/* ONBOARDING */}
      {session.status === 'onboarding' && (
        <div style={styles.card}>
          <p style={styles.cardTitle}>Configure Your Engine</p>
          <p style={styles.cardSub}>Answer the questions below. The AI council will build your complete business package.</p>
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
              Build My Business →
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
            <p style={styles.generatingSub}>Three AI systems are building your business in parallel. This takes 20–60 seconds.</p>
          </div>
        </div>
      )}

      {/* READY */}
      {session.status === 'ready' && (
        <div style={styles.readyRoot}>

          {/* Your Business Blueprint */}
          <Section title="Your Business Blueprint" accent="#818cf8">
            <div style={styles.blueprintGrid}>
              {Object.entries(session.blueprint).map(([key, value]) => (
                <div key={key} style={styles.blueprintCard}>
                  <p style={styles.blueprintKey}>{formatKey(key)}</p>
                  <p style={styles.blueprintVal}>{String(value)}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Your Deploy-Ready Assets */}
          {session.assets.length > 0 && (
            <Section title="Your Deploy-Ready Assets" accent="#818cf8">
              <div style={styles.assetStack}>
                {session.assets.map((asset, i) => {
                  const item = typeof asset === 'string'
                    ? { type: `Asset ${i + 1}`, body: asset as string }
                    : asset as AssetItem;
                  return (
                    <div key={i} style={styles.assetCard}>
                      <div style={styles.assetHeader}>
                        <span style={styles.assetType}>{item.type}</span>
                        <button
                          style={copiedIdx === i ? styles.copyBtnDone : styles.copyBtn}
                          onClick={() => handleCopyAsset(item.body, i)}
                        >
                          {copiedIdx === i ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre style={styles.assetBody}>{item.body}</pre>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Your Technical Foundation */}
          {Object.keys(session.buildOutput).length > 0 && (
            <Section title="Your Technical Foundation" accent="#34d399">
              <div style={styles.buildGrid}>
                {Object.entries(session.buildOutput).map(([key, items]) => (
                  <div key={key} style={styles.buildCard}>
                    <p style={styles.buildCardTitle}>Your {formatKey(key)}</p>
                    <div style={styles.buildList}>
                      {(Array.isArray(items) ? items : []).map((item, i) => (
                        <div key={i} style={styles.buildItem}>
                          <span style={styles.buildItemDot}>›</span>
                          <span>{String(item)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Launch */}
          <div style={styles.launchRow}>
            <button style={styles.launchBtn} onClick={handleLaunch}>
              Activate This Business
            </button>
          </div>
        </div>
      )}

      {/* ACTIVATING */}
      {session.status === 'activating' && (
        <div style={styles.activatingCard}>
          <div style={styles.generatingInner}>
            <div style={styles.activatingRing} />
            <p style={styles.activatingText}>Activating your business engine…</p>
          </div>
        </div>
      )}

      {/* LAUNCHED + EXECUTING */}
      {(session.status === 'launched' || session.status === 'executing') && (
        <>
          <div style={styles.launchedCard}>
            <div style={styles.launchedInner}>
              <div style={styles.launchedCheckmark}>✓</div>
              <p style={styles.launchedTitle}>{engineName} — Active</p>
              <p style={styles.launchedSub}>
                Your blueprint, assets, and technical foundation are ready to execute.
                Everything above is built for your specific market — copy, deploy, and launch.
              </p>
              <div style={styles.launchedStats}>
                <div style={styles.launchedStat}>
                  <span style={styles.launchedStatNum}>{Object.keys(session.blueprint).length}</span>
                  <span style={styles.launchedStatLabel}>Blueprint Sections</span>
                </div>
                <div style={styles.launchedStatDivider} />
                <div style={styles.launchedStat}>
                  <span style={styles.launchedStatNum}>{session.assets.length}</span>
                  <span style={styles.launchedStatLabel}>Deploy-Ready Assets</span>
                </div>
                <div style={styles.launchedStatDivider} />
                <div style={styles.launchedStat}>
                  <span style={styles.launchedStatNum}>{Object.keys(session.buildOutput).length}</span>
                  <span style={styles.launchedStatLabel}>System Components</span>
                </div>
              </div>
              <button style={styles.newBuildBtn} onClick={handleReset}>Start New Build</button>
            </div>
          </div>

          {/* Execution Section */}
          <div style={styles.executionSection}>
            <div style={styles.executionHeader}>
              <span style={styles.executionAccent}>⚡</span>
              <p style={styles.executionTitle}>Business Activated</p>
            </div>

            {executionLoading && !session.execution && (
              <div style={styles.executionLoading}>
                <div style={styles.execSpinner} />
                <p style={styles.execLoadingText}>Generating your first action…</p>
              </div>
            )}

            {session.execution && (
              <>
                <p style={styles.execConfirmLine}>Action plan ready. Execute in order.</p>

                {/* First Task */}
                <div style={styles.firstTaskCard}>
                  <p style={styles.firstTaskLabel}>First Step</p>
                  <p style={styles.firstTaskTitle}>{session.execution.firstTask.title}</p>
                  <p style={styles.firstTaskObjective}>{session.execution.firstTask.objective}</p>
                  {session.execution.firstTask.steps.length > 0 && (
                    <div style={styles.firstTaskSteps}>
                      {session.execution.firstTask.steps.map((step, i) => (
                        <div key={i} style={styles.firstTaskStep}>
                          <span style={styles.firstTaskStepNum}>{i + 1}</span>
                          <span style={styles.firstTaskStepText}>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {session.execution.firstTask.resources && session.execution.firstTask.resources.length > 0 && (
                    <p style={styles.firstTaskResources}>
                      <span style={styles.firstTaskResourcesLabel}>Resources: </span>
                      {session.execution.firstTask.resources.join(' · ')}
                    </p>
                  )}
                  <p style={styles.firstTaskDeliverable}>
                    <span style={styles.firstTaskDeliverableLabel}>Deliverable: </span>
                    {session.execution.firstTask.deliverable}
                  </p>
                </div>

                {/* Execution Plan */}
                {(() => {
                  const plan = session.execution.executionPlan;
                  const allSteps: Array<{ badge: React.CSSProperties; label: string; text: string }> = [
                    ...(plan.immediate ?? []).map(s => ({ badge: styles.badgeImmediate, label: 'IMMEDIATE', text: s })),
                    ...(plan.thisWeek ?? []).map(s => ({ badge: styles.badgeThisWeek, label: 'THIS WEEK', text: s })),
                    ...(plan.nextPhase ?? []).map(s => ({ badge: styles.badgeNextPhase, label: 'NEXT PHASE', text: s })),
                  ];
                  if (allSteps.length === 0) return null;
                  return (
                    <div style={styles.planSection}>
                      <p style={styles.planLabel}>Your Path to Launch</p>
                      <div style={styles.planSteps}>
                        {allSteps.map((step, i) => (
                          <div key={i} style={styles.planStep}>
                            <span style={styles.planStepNum}>{i + 1}</span>
                            <span style={step.badge}>{step.label}</span>
                            <span style={styles.planStepText}>{step.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Marketing Visuals */}
                {session.execution.marketing && (
                  <MarketingSection marketing={session.execution.marketing} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={{ ...styles.sectionAccent, background: accent }} />
        <p style={styles.sectionTitle}>{title}</p>
      </div>
      {children}
    </div>
  );
}

type ImageState = { url: string | null; loading: boolean; error: string | null };

function MarketingSection({ marketing }: { marketing: NonNullable<ExecutionData['marketing']> }) {
  const [images, setImages] = useState<Record<string, ImageState>>({});

  const visuals = (
    [
      marketing.poster  ? { key: 'poster',  label: 'Marketing Poster',   data: marketing.poster  } : null,
      marketing.website ? { key: 'website', label: 'Website Hero Image', data: marketing.website } : null,
      marketing.app     ? { key: 'app',     label: 'App UI Mockup',      data: marketing.app     } : null,
    ] as Array<{ key: string; label: string; data: MarketingVisual } | null>
  ).filter((v): v is { key: string; label: string; data: MarketingVisual } => v !== null);

  if (visuals.length === 0) return null;

  const handleGenerate = async (key: string, prompt: string) => {
    setImages(prev => ({ ...prev, [key]: { url: null, loading: true, error: null } }));
    try {
      const result = await (window as any).triforge.forgeEngine.generateImage(prompt);
      if (result.error) {
        setImages(prev => ({ ...prev, [key]: { url: null, loading: false, error: result.error } }));
      } else {
        setImages(prev => ({ ...prev, [key]: { url: result.url, loading: false, error: null } }));
      }
    } catch {
      setImages(prev => ({ ...prev, [key]: { url: null, loading: false, error: 'Generation failed. Please try again.' } }));
    }
  };

  return (
    <div style={styles.marketingSection}>
      <p style={styles.planLabel}>Marketing Visuals</p>
      <div style={styles.marketingGrid}>
        {visuals.map(({ key, label, data }) => {
          const state = images[key];
          return (
            <div key={key} style={styles.marketingCard}>
              <div style={styles.marketingCardHeader}>
                <p style={styles.marketingCardLabel}>{label}</p>
                <p style={styles.marketingCardDesc}>{data.description}</p>
              </div>
              {!state && (
                <button style={styles.generateBtn} onClick={() => handleGenerate(key, data.prompt)}>
                  Generate Image
                </button>
              )}
              {state?.loading && (
                <div style={styles.executionLoading}>
                  <div style={styles.execSpinner} />
                  <p style={styles.execLoadingText}>Generating with DALL-E 3…</p>
                </div>
              )}
              {state?.error && (
                <p style={styles.marketingError}>{state.error}</p>
              )}
              {state?.url && (
                <img src={state.url} style={styles.marketingImage} alt={label} />
              )}
              {state?.url && (
                <button style={styles.regenerateBtn} onClick={() => handleGenerate(key, data.prompt)}>
                  Regenerate
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
    fontSize: 15,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: '0 0 4px',
    letterSpacing: '0.1px',
  },
  cardSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 20px',
    lineHeight: 1.5,
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
    padding: '11px 0',
    cursor: 'pointer',
    width: '100%',
    letterSpacing: '0.3px',
  },
  generatingInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    padding: '16px 0',
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
    fontSize: 14,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.8)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  generatingSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  readyRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  section: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '14px 16px 18px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionAccent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    margin: 0,
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
    fontSize: 9,
    fontWeight: 700,
    color: '#818cf8',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    margin: '0 0 5px',
  },
  blueprintVal: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.72)',
    margin: 0,
    lineHeight: 1.55,
  },
  assetStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  assetCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  assetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.03)',
  },
  assetType: {
    fontSize: 10,
    fontWeight: 700,
    color: '#818cf8',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
  },
  copyBtn: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 4,
    color: '#818cf8',
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 9px',
    cursor: 'pointer',
    letterSpacing: '0.3px',
  },
  copyBtnDone: {
    background: 'rgba(52,211,153,0.15)',
    border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 4,
    color: '#34d399',
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 9px',
    cursor: 'default',
    letterSpacing: '0.3px',
  },
  assetBody: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.6,
    margin: 0,
    padding: '12px 14px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'inherit',
    maxHeight: 220,
    overflowY: 'auto',
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
    fontSize: 9,
    fontWeight: 700,
    color: '#34d399',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    margin: '0 0 8px',
  },
  buildList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  buildItem: {
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start',
  },
  buildItemDot: {
    fontSize: 12,
    color: 'rgba(52,211,153,0.5)',
    flexShrink: 0,
    lineHeight: 1.4,
    fontWeight: 700,
  },
  launchRow: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 2,
  },
  launchBtn: {
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    padding: '12px 36px',
    cursor: 'pointer',
    letterSpacing: '0.4px',
  },
  launchedCard: {
    background: 'rgba(52,211,153,0.06)',
    border: '1px solid rgba(52,211,153,0.2)',
    borderRadius: 10,
    padding: '28px 20px',
  },
  launchedInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    textAlign: 'center',
  },
  launchedCheckmark: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'rgba(52,211,153,0.15)',
    border: '2px solid rgba(52,211,153,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: '#34d399',
    fontWeight: 700,
  } as React.CSSProperties,
  launchedTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  launchedSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    margin: 0,
    maxWidth: 360,
    lineHeight: 1.6,
  },
  launchedStats: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    marginTop: 4,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  launchedStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '10px 20px',
  } as React.CSSProperties,
  launchedStatNum: {
    fontSize: 20,
    fontWeight: 700,
    color: '#34d399',
    lineHeight: 1,
  },
  launchedStatLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  launchedStatDivider: {
    width: 1,
    height: 32,
    background: 'rgba(255,255,255,0.07)',
    flexShrink: 0,
  },
  newBuildBtn: {
    marginTop: 4,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    padding: '7px 18px',
    cursor: 'pointer',
  },
  activatingCard: {
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 10,
    padding: '36px 20px',
  },
  activatingRing: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: '3px solid rgba(99,102,241,0.15)',
    borderTop: '3px solid #818cf8',
    animation: 'spin 1s linear infinite',
  },
  activatingText: {
    fontSize: 14,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  executionSection: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '16px 16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  } as React.CSSProperties,
  executionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  executionAccent: {
    fontSize: 13,
  },
  executionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    margin: 0,
  },
  executionLoading: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
  },
  execSpinner: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    border: '2px solid rgba(99,102,241,0.2)',
    borderTop: '2px solid #818cf8',
    animation: 'spin 0.9s linear infinite',
    flexShrink: 0,
  },
  execLoadingText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  execConfirmLine: {
    fontSize: 11,
    fontWeight: 600,
    color: '#34d399',
    margin: 0,
    letterSpacing: '0.2px',
  },
  // First Task — new structure
  firstTaskCard: {
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.18)',
    borderRadius: 8,
    padding: '14px 14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,
  firstTaskLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: '#818cf8',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  firstTaskTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
    letterSpacing: '0.1px',
  },
  firstTaskObjective: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    margin: 0,
    lineHeight: 1.55,
    fontStyle: 'italic',
  },
  firstTaskSteps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 2,
  } as React.CSSProperties,
  firstTaskStep: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  firstTaskStepNum: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'rgba(99,102,241,0.2)',
    border: '1px solid rgba(99,102,241,0.35)',
    fontSize: 9,
    fontWeight: 700,
    color: '#818cf8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    lineHeight: 1,
    marginTop: 1,
  } as React.CSSProperties,
  firstTaskStepText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.5,
  },
  firstTaskResources: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: '2px 0 0',
    lineHeight: 1.5,
  },
  firstTaskResourcesLabel: {
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    fontSize: 9,
    letterSpacing: '0.5px',
  },
  firstTaskDeliverable: {
    fontSize: 11,
    color: '#34d399',
    margin: '2px 0 0',
    lineHeight: 1.5,
    background: 'rgba(52,211,153,0.07)',
    border: '1px solid rgba(52,211,153,0.15)',
    borderRadius: 5,
    padding: '6px 10px',
  },
  firstTaskDeliverableLabel: {
    fontWeight: 700,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginRight: 2,
  },
  // Execution Plan
  planSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,
  planLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    margin: 0,
  },
  planSteps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as React.CSSProperties,
  planStep: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  planStepNum: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    lineHeight: 1,
  } as React.CSSProperties,
  badgeImmediate: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: '#34d399',
    background: 'rgba(52,211,153,0.12)',
    border: '1px solid rgba(52,211,153,0.25)',
    borderRadius: 3,
    padding: '2px 6px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 3,
  } as React.CSSProperties,
  badgeThisWeek: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.1)',
    border: '1px solid rgba(251,191,36,0.22)',
    borderRadius: 3,
    padding: '2px 6px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 3,
  } as React.CSSProperties,
  badgeNextPhase: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 3,
    padding: '2px 6px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 3,
  } as React.CSSProperties,
  planStepText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.5,
    paddingTop: 2,
  },
  // Marketing Visuals
  marketingSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  } as React.CSSProperties,
  marketingGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  } as React.CSSProperties,
  marketingCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  marketingCardHeader: {
    padding: '10px 12px 8px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  marketingCardLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#818cf8',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    margin: '0 0 2px',
  },
  marketingCardDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  generateBtn: {
    display: 'block',
    width: 'calc(100% - 24px)',
    margin: '10px 12px',
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 6,
    color: '#818cf8',
    fontSize: 12,
    fontWeight: 600,
    padding: '8px 0',
    cursor: 'pointer',
    letterSpacing: '0.2px',
  },
  marketingError: {
    fontSize: 11,
    color: '#f87171',
    margin: '8px 12px',
  },
  marketingImage: {
    display: 'block',
    width: '100%',
    maxHeight: 280,
    objectFit: 'cover',
  } as React.CSSProperties,
  regenerateBtn: {
    display: 'block',
    width: 'calc(100% - 24px)',
    margin: '8px 12px',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    padding: '5px 0',
    cursor: 'pointer',
  },
};
