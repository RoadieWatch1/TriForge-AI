import React, { useState, useRef, useEffect } from 'react';

type Phase = 'questions' | 'building' | 'preview' | 'done';

interface Spec {
  appType: string;
  audience: string;
  features: string;
  style: string;
  extras: string;
}

const QUESTIONS: Array<{ id: keyof Spec; prompt: string; placeholder: string }> = [
  {
    id: 'appType',
    prompt: 'What type of app do you want to build?',
    placeholder: 'e.g., task manager, expense tracker, portfolio site, calculator…',
  },
  {
    id: 'audience',
    prompt: 'Who will use this app?',
    placeholder: 'e.g., just me, my team, my customers…',
  },
  {
    id: 'features',
    prompt: 'What should it do? List your 2–3 must-have features.',
    placeholder: 'e.g., add tasks, mark complete, track deadlines…',
  },
  {
    id: 'style',
    prompt: 'What look and feel do you want?',
    placeholder: 'e.g., dark/modern, clean/minimal, colorful/playful…',
  },
  {
    id: 'extras',
    prompt: 'Anything else? (optional — press Enter to skip)',
    placeholder: 'e.g., include charts, export to CSV, support Spanish…',
  },
];

const BUILD_STEPS = [
  'Analyzing your requirements…',
  'Generating layout…',
  'Writing JavaScript…',
  'Polishing styles…',
  'Almost done…',
];

interface Props {
  onBack: () => void;
}

export function AppBuilder({ onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('questions');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Spec>({ appType: '', audience: '', features: '', style: '', extras: '' });
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [appName, setAppName] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [buildStep, setBuildStep] = useState(0);
  const [revising, setRevising] = useState(false);
  const [revisionInput, setRevisionInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [questionIndex]);

  useEffect(() => {
    if (revising) revisionRef.current?.focus();
  }, [revising]);

  // Animate build step text
  useEffect(() => {
    if (phase !== 'building') return;
    const interval = setInterval(() => {
      setBuildStep(s => (s + 1) % BUILD_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [phase]);

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
        // Keep answers intact so user doesn't re-type everything
        setError(result.error ?? 'No HTML was generated. Please try again.');
        setQuestionIndex(QUESTIONS.length - 1);
        setCurrentAnswer(spec.extras); // restore last answer
        setPhase('questions');
        return;
      }
      // Strip markdown code fences if the AI wrapped the response
      let cleanHtml = result.html.trim();
      if (cleanHtml.startsWith('```')) {
        cleanHtml = cleanHtml.replace(/^```(?:html)?\r?\n?/, '').replace(/\r?\n?```$/, '');
      }
      setHtml(cleanHtml);
      // Auto-generate app name from appType answer
      const slug = spec.appType
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 30) || 'my-app';
      setAppName(slug);
      setPhase('preview');
    } catch (e) {
      // Keep answers intact so user doesn't re-type everything
      setError(e instanceof Error ? e.message : 'Failed to generate app. Check your API keys in Settings.');
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
        setPhase('done');
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setPhase('questions');
    setQuestionIndex(0);
    setAnswers({ appType: '', audience: '', features: '', style: '', extras: '' });
    setCurrentAnswer('');
    setHtml('');
    setError(null);
    setSavedPath('');
    setRevising(false);
    setRevisionInput('');
  };

  // ── Questions phase ──────────────────────────────────────────────────────────
  if (phase === 'questions') {
    const q = QUESTIONS[questionIndex];
    const progress = ((questionIndex) / QUESTIONS.length) * 100;
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button style={s.backBtn} onClick={onBack}>← Back</button>
          <h1 style={s.title}>🛠️ App Builder</h1>
          <div style={{ width: 64 }} />
        </div>

        {error && (
          <div style={s.errorBanner}>{error}</div>
        )}

        <div style={s.card}>
          {/* Progress bar */}
          <div style={s.progressTrack}>
            <div style={{ ...s.progressBar, width: `${progress}%` }} />
          </div>
          <div style={s.progressLabel}>{questionIndex + 1} of {QUESTIONS.length}</div>

          <div style={s.questionText}>{q.prompt}</div>

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
              }}>
                ← Back
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              style={{ ...s.primaryBtn, ...((!currentAnswer.trim() && questionIndex < QUESTIONS.length - 1) ? s.primaryBtnDisabled : {}) }}
              onClick={nextQuestion}
              disabled={!currentAnswer.trim() && questionIndex < QUESTIONS.length - 1}
            >
              {questionIndex < QUESTIONS.length - 1 ? 'Next →' : '🚀 Build My App'}
            </button>
          </div>
        </div>

        <div style={s.tip}>
          Press <kbd style={s.kbd}>Enter</kbd> to advance · Your answers guide the AI
        </div>
      </div>
    );
  }

  // ── Building phase ────────────────────────────────────────────────────────────
  if (phase === 'building') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div style={{ width: 64 }} />
          <h1 style={s.title}>🛠️ App Builder</h1>
          <div style={{ width: 64 }} />
        </div>
        <div style={s.buildingCard}>
          <div style={s.spinner}>⚡</div>
          <div style={s.buildingTitle}>Building your app…</div>
          <div style={s.buildingStep}>{BUILD_STEPS[buildStep]}</div>
          <div style={s.buildingHint}>The AI is writing your full HTML, CSS, and JavaScript.</div>
        </div>
      </div>
    );
  }

  // ── Preview phase ─────────────────────────────────────────────────────────────
  if (phase === 'preview') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button style={s.backBtn} onClick={reset}>← Start over</button>
          <h1 style={s.title}>🛠️ App Builder — Preview</h1>
          <div style={{ width: 100 }} />
        </div>

        {error && <div style={s.errorBanner}>{error}</div>}

        {/* Live preview */}
        <div style={s.previewWrapper}>
          <iframe
            srcDoc={html}
            style={s.iframe}
            sandbox="allow-scripts allow-forms allow-modals"
            title="App Preview"
          />
        </div>

        {/* App name + action row */}
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
            <button style={s.secondaryBtn} onClick={() => setRevising(r => !r)}>
              ✏️ Request Changes
            </button>
            <button style={s.secondaryBtn} onClick={reset}>
              🔄 Start Over
            </button>
            <button
              style={{ ...s.primaryBtn, ...(saving ? s.primaryBtnDisabled : {}) }}
              onClick={handleSave}
              disabled={saving || !appName.trim()}
            >
              {saving ? 'Saving…' : '✅ Save to Desktop'}
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
                placeholder="e.g., make the background dark, add a delete button, show totals at the bottom…"
                rows={3}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRevise(); } }}
              />
              <div style={s.btnRow}>
                <button style={s.secondaryBtn} onClick={() => { setRevising(false); setRevisionInput(''); }}>
                  Cancel
                </button>
                <button
                  style={{ ...s.primaryBtn, ...((!revisionInput.trim()) ? s.primaryBtnDisabled : {}) }}
                  onClick={handleRevise}
                  disabled={!revisionInput.trim()}
                >
                  🔨 Apply Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Done phase ────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ width: 64 }} />
        <h1 style={s.title}>🛠️ App Builder</h1>
        <div style={{ width: 64 }} />
      </div>
      <div style={s.doneCard}>
        <div style={s.doneIcon}>🎉</div>
        <div style={s.doneTitle}>Your app is ready!</div>
        <div style={s.donePath}>{savedPath}</div>
        <div style={s.btnRow}>
          <button
            style={s.secondaryBtn}
            onClick={() => {
              if (savedPath) window.triforge.files.showInFolder(savedPath);
            }}
          >
            📁 Open Folder
          </button>
          <button style={s.primaryBtn} onClick={reset}>
            🛠️ Build Another
          </button>
        </div>
        <button style={{ ...s.secondaryBtn, marginTop: 8, alignSelf: 'center' }} onClick={onBack}>
          ← Back to Chat
        </button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: 'var(--bg-base)', overflow: 'hidden',
  },
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

  card: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 28, margin: '32px auto', width: '100%',
    maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 20,
  },

  progressTrack: { height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.4s' },
  progressLabel: { fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' as const },

  questionText: { fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 },
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

  tip: {
    textAlign: 'center' as const, fontSize: 12, color: 'var(--text-muted)',
    marginTop: 8, flexShrink: 0,
  },
  kbd: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '1px 6px', fontSize: 11, color: 'var(--text-secondary)',
  },
  errorBanner: {
    background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8,
    color: '#ef4444', fontSize: 13, padding: '10px 16px',
    margin: '12px 20px', flexShrink: 0,
  },

  // Building phase
  buildingCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 16, flex: 1, padding: 32,
  },
  spinner: {
    fontSize: 48, animation: 'spin 1.5s linear infinite',
  },
  buildingTitle: { fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' },
  buildingStep: { fontSize: 14, color: 'var(--accent)', fontWeight: 500 },
  buildingHint: { fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' as const, maxWidth: 360 },

  // Preview phase
  previewWrapper: {
    flex: 1, margin: '12px 16px 0', overflow: 'hidden',
    borderRadius: 10, border: '1px solid var(--border)',
    background: '#fff',
  },
  iframe: { width: '100%', height: '100%', border: 'none', display: 'block' },

  previewActions: {
    padding: '12px 16px 14px', background: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)', flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  nameRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
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

  // Done phase
  doneCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 14, flex: 1, padding: 40,
  },
  doneIcon: { fontSize: 56 },
  doneTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' },
  donePath: {
    fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' as const,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 14px', maxWidth: 500, textAlign: 'center' as const,
  },
};
