import React, { useState, useRef, useEffect } from 'react';

type Phase = 'questions' | 'building' | 'preview' | 'done';

interface Spec {
  appType: string;
  audience: string;
  features: string;
  dataSave: string;
  style: string;
  extras: string;
}

interface ServiceInfo {
  name: string;
  emoji: string;
  tagline: string;
  what: string;
  where: string;
  why: string;
  how: string[];
  free: boolean;
  freeNote?: string;
}

const QUESTIONS: Array<{ id: keyof Spec; prompt: string; placeholder: string; hint?: string }> = [
  {
    id: 'appType',
    prompt: 'What type of application do you want to build?',
    placeholder: 'e.g., task manager, expense tracker, portfolio site, quiz game…',
  },
  {
    id: 'audience',
    prompt: 'Who is the intended user?',
    placeholder: 'e.g., just me, my small team, my customers, students in my class…',
  },
  {
    id: 'features',
    prompt: 'List 2–3 core features required.',
    placeholder: 'e.g., add tasks, mark complete, filter by category, track deadlines…',
  },
  {
    id: 'dataSave',
    prompt: 'Should the application retain data between sessions?',
    placeholder: 'e.g., yes save my entries / no fresh start each time / yes + user accounts',
    hint: 'Browser storage is used by default. Specify "user accounts" if each person needs their own login.',
  },
  {
    id: 'style',
    prompt: 'Describe the visual style and layout.',
    placeholder: 'e.g., dark and modern, clean white minimal, colorful and playful, corporate blue…',
  },
  {
    id: 'extras',
    prompt: 'Any additional requirements? (optional)',
    placeholder: 'e.g., include charts, export CSV, support Spanish, print button…',
  },
];

const BUILD_STEPS = [
  'Analyzing your requirements…',
  'Designing the layout…',
  'Writing JavaScript logic…',
  'Polishing styles & transitions…',
  'Adding sample data…',
  'Final review…',
];

interface Props {
  onBack: () => void;
  activeProfileId?: string | null;
  onProfileSwitch?: () => void;
  onProfileDeactivate?: () => void;
}

export function AppBuilder({ onBack, activeProfileId, onProfileSwitch, onProfileDeactivate }: Props) {
  const [phase, setPhase] = useState<Phase>('questions');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Spec>({ appType: '', audience: '', features: '', dataSave: '', style: '', extras: '' });
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [appName, setAppName] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [buildStep, setBuildStep] = useState(0);
  const [revising, setRevising] = useState(false);
  const [revisionInput, setRevisionInput] = useState('');
  const [openingPreview, setOpeningPreview] = useState(false);
  const [services, setServices] = useState<ServiceInfo[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [questionIndex]);
  useEffect(() => { if (revising) revisionRef.current?.focus(); }, [revising]);

  // Build step animation
  useEffect(() => {
    if (phase !== 'building') return;
    const interval = setInterval(() => setBuildStep(s => (s + 1) % BUILD_STEPS.length), 1600);
    return () => clearInterval(interval);
  }, [phase]);

  // Kick off analysis when we enter done phase
  useEffect(() => {
    if (phase !== 'done' || !html || services !== null) return;
    setAnalyzing(true);
    window.triforge.appBuilder.analyze(answers, html)
      .then(r => setServices(r.services ?? []))
      .catch(() => setServices([]))
      .finally(() => setAnalyzing(false));
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextQuestion = () => {
    const q = QUESTIONS[questionIndex];
    const updated = { ...answers, [q.id]: currentAnswer.trim() };
    setAnswers(updated);
    setCurrentAnswer('');
    if (questionIndex < QUESTIONS.length - 1) {
      setQuestionIndex(i => i + 1);
    } else {
      startBuilding(updated);
    }
  };

  const startBuilding = async (spec: Spec) => {
    setPhase('building');
    setBuildStep(0);
    setError(null);
    try {
      const result = await window.triforge.appBuilder.generate(spec);
      if (result.error || !result.html) {
        setError(result.error ?? 'No HTML generated. Please try again.');
        setQuestionIndex(QUESTIONS.length - 1);
        setCurrentAnswer(spec.extras);
        setPhase('questions');
        return;
      }
      let cleanHtml = result.html.trim();
      if (cleanHtml.startsWith('```')) {
        cleanHtml = cleanHtml.replace(/^```(?:html)?\r?\n?/, '').replace(/\r?\n?```$/, '');
      }
      setHtml(cleanHtml);
      const slug = spec.appType
        .toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
        .replace(/\s+/g, '-').slice(0, 30) || 'my-app';
      setAppName(slug);
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate. Check your API keys in Settings.');
      setQuestionIndex(QUESTIONS.length - 1);
      setCurrentAnswer(spec.extras);
      setPhase('questions');
    }
  };

  const handleRevise = async () => {
    if (!revisionInput.trim()) return;
    const revisedSpec: Spec = {
      ...answers,
      extras: answers.extras
        ? `${answers.extras}. REVISION: ${revisionInput.trim()}`
        : `REVISION: ${revisionInput.trim()}`,
    };
    setRevising(false);
    setRevisionInput('');
    await startBuilding(revisedSpec);
  };

  const handleSave = async () => {
    if (!appName.trim()) return;
    setSaving(true);
    try {
      const result = await window.triforge.appBuilder.save(appName.trim(), html);
      if (result.error) {
        setError(result.error);
      } else {
        setSavedPath(result.path ?? '');
        setServices(null); // reset so analysis runs fresh
        setPhase('done');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPreview = async () => {
    setOpeningPreview(true);
    try { await window.triforge.appBuilder.openPreview(html); }
    finally { setOpeningPreview(false); }
  };

  const reset = () => {
    setPhase('questions');
    setQuestionIndex(0);
    setAnswers({ appType: '', audience: '', features: '', dataSave: '', style: '', extras: '' });
    setCurrentAnswer('');
    setHtml('');
    setError(null);
    setSavedPath('');
    setRevising(false);
    setRevisionInput('');
    setServices(null);
  };

  // ── Questions ──────────────────────────────────────────────────────────────
  if (phase === 'questions') {
    const q = QUESTIONS[questionIndex];
    const isOptional = questionIndex === QUESTIONS.length - 1;
    const canAdvance = !!currentAnswer.trim() || isOptional;
    const progress = (questionIndex / QUESTIONS.length) * 100;

    return (
      <div style={s.page}>
        <div style={s.header}>
          <button style={s.backBtn} onClick={onBack}>← Back</button>
          <h1 style={s.title}>App Builder</h1>
          <div style={{ width: 64 }} />
        </div>

        {error && <div style={s.errorBanner}>{error}</div>}

        {activeProfileId && (
          <ProfileStatusStrip
            profileId={activeProfileId}
            onSwitch={onProfileSwitch ?? (() => {})}
            onDeactivate={onProfileDeactivate ?? (() => {})}
          />
        )}

        <div style={s.card}>
          <div style={s.progressTrack}><div style={{ ...s.progressBar, width: `${progress}%` }} /></div>
          <div style={s.progressLabel}>Step {questionIndex + 1} of {QUESTIONS.length}</div>

          <div style={s.questionText}>{q.prompt}</div>
          {q.hint && <div style={s.questionHint}>{q.hint}</div>}

          <input
            ref={inputRef}
            style={s.answerInput}
            value={currentAnswer}
            onChange={e => setCurrentAnswer(e.target.value)}
            placeholder={q.placeholder}
            onKeyDown={e => { if (e.key === 'Enter') nextQuestion(); }}
          />

          <div style={s.btnRow}>
            {questionIndex > 0 && (
              <button style={s.secondaryBtn} onClick={() => {
                setQuestionIndex(i => i - 1);
                setCurrentAnswer(answers[QUESTIONS[questionIndex - 1].id]);
              }}>← Back</button>
            )}
            <div style={{ flex: 1 }} />
            <button
              style={{ ...s.primaryBtn, ...(!canAdvance ? s.primaryBtnDisabled : {}) }}
              onClick={nextQuestion}
              disabled={!canAdvance}
            >
              {questionIndex < QUESTIONS.length - 1 ? 'Next →' : 'Generate Application'}
            </button>
          </div>
        </div>

        <div style={s.tip}>
          Press <kbd style={s.kbd}>Enter</kbd> to advance · Your answers guide the AI
        </div>
      </div>
    );
  }

  // ── Building ───────────────────────────────────────────────────────────────
  if (phase === 'building') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div style={{ width: 64 }} />
          <h1 style={s.title}>App Builder</h1>
          <div style={{ width: 64 }} />
        </div>
        <div style={s.buildingCard}>
          <div style={s.spinner}>◈</div>
          <div style={s.buildingTitle}>Generating application…</div>
          <div style={s.buildingStep}>{BUILD_STEPS[buildStep]}</div>
          <div style={s.buildingHint}>The AI is writing your complete HTML, CSS, and JavaScript.</div>
        </div>
      </div>
    );
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  if (phase === 'preview') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button style={s.backBtn} onClick={reset}>← Start over</button>
          <h1 style={s.title}>App Builder — Preview</h1>
          <button
            style={{ ...s.glowBtn, ...(openingPreview ? s.primaryBtnDisabled : {}) }}
            onClick={handleOpenPreview}
            disabled={openingPreview}
          >
            {openingPreview ? 'Opening…' : 'Open in Browser'}
          </button>
        </div>

        {error && <div style={s.errorBanner}>{error}</div>}

        <div style={s.previewWrapper}>
          <iframe srcDoc={html} style={s.iframe} sandbox="allow-scripts allow-forms allow-modals" title="App Preview" />
        </div>

        <div style={s.previewActions}>
          <div style={s.nameRow}>
            <label style={s.nameLabel}>App name:</label>
            <input
              style={s.nameInput}
              value={appName}
              onChange={e => setAppName(e.target.value.replace(/[^a-zA-Z0-9\-_]/g, '-'))}
              placeholder="my-app"
              maxLength={40}
            />
            <span style={s.nameSuffix}>/index.html</span>
          </div>

          <div style={s.actionRow}>
            <button style={s.secondaryBtn} onClick={() => setRevising(r => !r)}>Request Changes</button>
            <button style={s.secondaryBtn} onClick={reset}>Start Over</button>
            <button
              style={{ ...s.primaryBtn, ...(saving || !appName.trim() ? s.primaryBtnDisabled : {}) }}
              onClick={handleSave}
              disabled={saving || !appName.trim()}
            >
              {saving ? 'Saving…' : 'Save to Desktop'}
            </button>
          </div>

          {revising && (
            <div style={s.revisionBox}>
              <div style={s.revisionLabel}>What would you like to change?</div>
              <textarea
                ref={revisionRef}
                style={s.revisionInput}
                value={revisionInput}
                onChange={e => setRevisionInput(e.target.value)}
                placeholder="e.g., make the header blue, add a delete button, show totals at the bottom…"
                rows={3}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRevise(); } }}
              />
              <div style={s.btnRow}>
                <button style={s.secondaryBtn} onClick={() => { setRevising(false); setRevisionInput(''); }}>Cancel</button>
                <button
                  style={{ ...s.primaryBtn, ...(!revisionInput.trim() ? s.primaryBtnDisabled : {}) }}
                  onClick={handleRevise}
                  disabled={!revisionInput.trim()}
                >Apply Changes</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Done / Launch Guide ────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ width: 64 }} />
        <h1 style={s.title}>App Builder</h1>
        <div style={{ width: 64 }} />
      </div>

      <div style={s.launchPage}>

        {/* Hero */}
        <div style={s.launchHero}>
          <div style={s.doneTitle}>Application saved.</div>
          <div style={s.donePath}>{savedPath}</div>
        </div>

        {/* Step 1 — Test */}
        <LaunchStep num={1} title="Test your app" desc="Open it in your browser to make sure everything works the way you expect.">
          <div style={s.stepBtnRow}>
            <button style={s.stepBtn} onClick={() => window.triforge.files.showInFolder(savedPath)}>
              Show App Folder
            </button>
            <button
              style={{ ...s.stepBtn, ...s.stepBtnPrimary }}
              onClick={() => window.triforge.system.openExternal(`file://${savedPath}/index.html`)}
            >
              Open in Browser
            </button>
          </div>
        </LaunchStep>

        {/* Step 2 — Go Live */}
        <LaunchStep
          num={2}
          title="Deploy — free hosting, no account required"
          desc="Netlify Drop is a free hosting service. Upload your app folder and receive a shareable URL in under 2 minutes."
        >
          <ol style={s.stepList}>
            <li>Click <strong style={{ color: 'var(--accent)' }}>Show App Folder</strong> — your app files will appear on screen.</li>
            <li>Click <strong style={{ color: 'var(--accent)' }}>Open Netlify Drop</strong> — it opens a page in your browser.</li>
            <li>Drag your app folder into the big upload box on that page. Wait a few seconds.</li>
            <li>Netlify gives you a free shareable link instantly, like: <code style={s.code}>your-app-1234.netlify.app</code></li>
          </ol>
          <div style={s.stepBtnRow}>
            <button style={s.stepBtn} onClick={() => window.triforge.files.showInFolder(savedPath)}>
              Show App Folder
            </button>
            <button
              style={{ ...s.stepBtn, ...s.stepBtnPrimary }}
              onClick={() => window.triforge.system.openExternal('https://app.netlify.com/drop')}
            >
              Open Netlify Drop
            </button>
          </div>
        </LaunchStep>

        {/* Step 3 — Share */}
        <LaunchStep
          num={3}
          title="Share your link"
          desc="Your Netlify link works on any phone, tablet, or computer — send it to anyone."
        >
          <div style={s.tipBox}>
            <TipRow>To <strong>update your app</strong>: build a new version here, then drag the new folder to Netlify — it replaces the old version automatically.</TipRow>
            <TipRow>Want a <strong>custom domain</strong> like myapp.com? In Netlify, go to Site Settings → Domain Management and follow the steps.</TipRow>
          </div>
        </LaunchStep>

        {/* Tech Stack Guide — AI analysis */}
        <TechStackGuide analyzing={analyzing} services={services} />

        {/* Footer */}
        <div style={s.launchFooter}>
          <button style={s.secondaryBtn} onClick={onBack}>← Back to Chat</button>
          <button style={s.primaryBtn} onClick={reset}>Build Another App</button>
        </div>

      </div>
    </div>
  );
}

// ── Tech Stack Guide component ─────────────────────────────────────────────

function TechStackGuide({ analyzing, services }: { analyzing: boolean; services: ServiceInfo[] | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (analyzing) {
    return (
      <div style={s.techCard}>
        <div style={s.techHeader}>
          <div>
            <div style={s.techTitle}>Analyzing tech requirements…</div>
            <div style={s.techSubtitle}>Checking if your app requires any third-party services to be production-ready.</div>
          </div>
        </div>
        <div style={s.analyzeSpinner}>Analyzing…</div>
      </div>
    );
  }

  if (!services || services.length === 0) {
    return (
      <div style={s.techCard}>
        <div style={s.techHeader}>
          <div>
            <div style={s.techTitle}>No external services required</div>
            <div style={s.techSubtitle}>Your app is fully self-contained. Everything runs in the browser — nothing to sign up for.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.techCard}>
      <div style={s.techHeader}>
        <div>
          <div style={s.techTitle}>Tech integration guide</div>
          <div style={s.techSubtitle}>
            To make your app fully production-ready, you may eventually need these services.
            Click each one to learn exactly what it is, why you need it, and how to set it up — step by step.
          </div>
        </div>
      </div>

      <div style={s.serviceList}>
        {services.map(svc => (
          <ServiceCard
            key={svc.name}
            svc={svc}
            open={expanded === svc.name}
            onToggle={() => setExpanded(expanded === svc.name ? null : svc.name)}
          />
        ))}
      </div>
    </div>
  );
}

function ServiceCard({ svc, open, onToggle }: { svc: ServiceInfo; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ ...s.serviceCard, ...(open ? s.serviceCardOpen : {}) }}>
      {/* Header row — always visible */}
      <button style={s.serviceCardBtn} onClick={onToggle}>
        <div style={s.serviceCardLeft}>
          <div style={s.serviceName}>{svc.name}</div>
          <div style={s.serviceTagline}>{svc.tagline}</div>
        </div>
        <div style={s.serviceCardRight}>
          {svc.free && (
            <span style={s.freeBadge}>FREE to start</span>
          )}
          <span style={s.chevron}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={s.serviceDetail}>
          <DetailBlock label="WHAT IS IT?" text={svc.what} />
          <DetailBlock label="WHY YOUR APP NEEDS IT" text={svc.why} />

          <div style={s.detailBlock}>
            <div style={s.detailLabel}>HOW TO GET STARTED</div>
            <ol style={s.howList}>
              {svc.how.map((step, i) => (
                <li key={i} style={s.howStep}>{step}</li>
              ))}
            </ol>
          </div>

          {svc.freeNote && (
            <div style={s.freeNote}>{svc.freeNote}</div>
          )}

          <button
            style={s.serviceLink}
            onClick={() => window.triforge.system.openExternal(svc.where)}
          >
            Go to {svc.name} →
          </button>
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, text }: { label: string; text: string }) {
  return (
    <div style={s.detailBlock}>
      <div style={s.detailLabel}>{label}</div>
      <div style={s.detailText}>{text}</div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────

function LaunchStep({ num, title, desc, children }: {
  num: number; title: string; desc: string; children?: React.ReactNode;
}) {
  return (
    <div style={s.launchStep}>
      <div style={s.stepHeader}>
        <div style={s.stepNum}>{num}</div>
        <div>
          <div style={s.stepTitle}>{title}</div>
          <div style={s.stepDesc}>{desc}</div>
        </div>
      </div>
      {children && <div style={s.stepContent}>{children}</div>}
    </div>
  );
}

function TipRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={s.tipRow}>
      <span style={s.tipText}>{children}</span>
    </div>
  );
}

// ── Profile Status Strip ──────────────────────────────────────────────────────

const AB_PROFILE_DISPLAY: Record<string, { name: string }> = {
  restaurant: { name: 'Restaurant & Food Service' },
  trucking:   { name: 'Trucking & Freight' },
  consultant: { name: 'Consultant & Agency' },
};

function ProfileStatusStrip({ profileId, onSwitch, onDeactivate }: {
  profileId: string;
  onSwitch: () => void;
  onDeactivate: () => void;
}) {
  const info = AB_PROFILE_DISPLAY[profileId] ?? { name: profileId };
  return (
    <div style={abStrip.bar}>
      <span style={abStrip.label}>Active Profile: <strong>{info.name}</strong> — scaffold context will be injected</span>
      <div style={abStrip.actions}>
        <button style={abStrip.btn} onClick={onSwitch}>Switch Profile</button>
        <button style={abStrip.btn} onClick={onDeactivate}>Deactivate</button>
      </div>
    </div>
  );
}

const abStrip: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 20px', background: 'var(--accent-dim)',
    borderBottom: '1px solid var(--accent)33', flexShrink: 0,
  },
  label: { fontSize: 12, color: 'var(--text-secondary)' },
  actions: { display: 'flex', gap: 8 },
  btn: {
    background: 'none', border: '1px solid var(--accent)55',
    color: 'var(--accent)', borderRadius: 5, padding: '3px 10px',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
};

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' },

  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-surface)', flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  backBtn: {
    background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)',
    borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
  },
  glowBtn: {
    background: 'var(--bg-elevated)', border: '1px solid var(--accent)',
    color: 'var(--accent)', borderRadius: 6, padding: '5px 14px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },

  card: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 28, margin: '32px auto', width: '100%',
    maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 18,
  },
  progressTrack: { height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.4s' },
  progressLabel: { fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' as const },
  questionText: { fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 },
  questionHint: { fontSize: 12, color: 'var(--text-muted)', marginTop: -10 },
  answerInput: {
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: 14,
    padding: '10px 14px', outline: 'none', fontFamily: 'var(--font)',
    boxSizing: 'border-box' as const,
  },

  btnRow: { display: 'flex', gap: 10, alignItems: 'center' },
  primaryBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px',
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  primaryBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  secondaryBtn: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 8, padding: '9px 16px',
    fontSize: 13, cursor: 'pointer',
  },

  tip: { textAlign: 'center' as const, fontSize: 12, color: 'var(--text-muted)', marginTop: 8, flexShrink: 0 },
  kbd: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '1px 6px', fontSize: 11, color: 'var(--text-secondary)',
  },
  errorBanner: {
    background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8,
    color: '#ef4444', fontSize: 13, padding: '10px 16px',
    margin: '12px 20px', flexShrink: 0,
  },

  buildingCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 16, flex: 1, padding: 32,
  },
  spinner: { fontSize: 48, animation: 'spin 1.5s linear infinite' },
  buildingTitle: { fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' },
  buildingStep: { fontSize: 14, color: 'var(--accent)', fontWeight: 500 },
  buildingHint: { fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' as const, maxWidth: 360 },

  previewWrapper: {
    flex: 1, margin: '12px 16px 0', overflow: 'hidden',
    borderRadius: 10, border: '1px solid var(--border)', background: '#fff',
  },
  iframe: { width: '100%', height: '100%', border: 'none', display: 'block' },

  previewActions: {
    padding: '12px 16px 14px', background: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)', flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  nameRow: { display: 'flex', alignItems: 'center', gap: 8 },
  nameLabel: { fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' as const },
  nameInput: {
    flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-primary)', fontSize: 13,
    padding: '5px 10px', outline: 'none', fontFamily: 'var(--font)',
  },
  nameSuffix: { fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' as const },
  actionRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },

  revisionBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
  },
  revisionLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  revisionInput: {
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: 13,
    padding: '8px 12px', resize: 'none' as const, outline: 'none',
    fontFamily: 'var(--font)', boxSizing: 'border-box' as const,
  },

  // Done / Launch page
  launchPage: {
    flex: 1, overflowY: 'auto' as const, padding: '24px 24px 40px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  launchHero: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    padding: '28px 20px', background: 'var(--bg-elevated)',
    border: '1px solid var(--border)', borderRadius: 14, textAlign: 'center' as const,
  },
  doneIcon: { fontSize: 48 },
  doneTitle: { fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' },
  donePath: {
    fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' as const,
    background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '6px 14px', maxWidth: 500,
  },

  launchStep: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  stepHeader: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  stepNum: {
    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    color: '#fff', fontSize: 13, fontWeight: 800,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  stepTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 },
  stepDesc: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 },
  stepContent: { marginLeft: 42 },
  stepList: {
    margin: '0 0 14px', paddingLeft: 20,
    display: 'flex', flexDirection: 'column', gap: 8,
    fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
  },
  stepBtnRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  stepBtn: {
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 16px',
    fontSize: 13, cursor: 'pointer',
  },
  stepBtnPrimary: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    color: '#fff', border: 'none', fontWeight: 600,
  },
  code: {
    fontFamily: 'monospace', background: 'var(--bg-input)',
    border: '1px solid var(--border)', borderRadius: 4,
    padding: '1px 6px', fontSize: 12,
  },

  tipBox: {
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '12px 16px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  tipRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  tipText: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 },

  launchFooter: { display: 'flex', gap: 12, justifyContent: 'center', paddingTop: 8 },

  // Tech stack guide
  techCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  techHeader: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  techIcon: { fontSize: 24, flexShrink: 0, marginTop: 2 },
  techTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 },
  techSubtitle: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 },
  analyzeSpinner: {
    textAlign: 'center' as const, fontSize: 13, color: 'var(--accent)',
    padding: '12px 0', animation: 'pulse 1.5s ease infinite',
  },

  serviceList: { display: 'flex', flexDirection: 'column', gap: 8 },

  serviceCard: {
    border: '1px solid var(--border)', borderRadius: 10,
    overflow: 'hidden',
  },
  serviceCardOpen: {
    border: '1px solid var(--accent)',
  },
  serviceCardBtn: {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    background: 'var(--bg-base)', border: 'none', padding: '12px 16px',
    cursor: 'pointer', textAlign: 'left' as const,
  },
  serviceEmoji: { fontSize: 22, flexShrink: 0 },
  serviceCardLeft: { flex: 1 },
  serviceName: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 },
  serviceTagline: { fontSize: 12, color: 'var(--text-secondary)' },
  serviceCardRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  freeBadge: {
    fontSize: 10, fontWeight: 700, color: '#10a37f',
    background: '#10a37f22', border: '1px solid #10a37f55',
    borderRadius: 20, padding: '2px 8px', textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  chevron: { fontSize: 11, color: 'var(--text-muted)' },

  serviceDetail: {
    background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)',
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14,
  },
  detailBlock: { display: 'flex', flexDirection: 'column', gap: 6 },
  detailLabel: {
    fontSize: 10, fontWeight: 800, color: 'var(--accent)',
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
  },
  detailText: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 },
  howList: {
    margin: 0, paddingLeft: 20,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  howStep: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 },
  freeNote: {
    fontSize: 12, color: '#10a37f',
    background: '#10a37f15', border: '1px solid #10a37f44',
    borderRadius: 8, padding: '8px 12px',
  },
  serviceLink: {
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    alignSelf: 'flex-start' as const,
  },
};
