import React, { useState, useCallback, useEffect, useRef } from 'react';

// ── Shared Types (exported so Chat.tsx can import them) ─────────────────────

export interface ExecutionStep {
  id: string;
  title: string;
  type: 'review' | 'browser' | 'file' | 'research' | 'decision' | 'command' | 'print';
  description: string;
  details?: string;
  requiresApproval: boolean;
  risk: 'Low' | 'Medium' | 'High';
}

export interface ExecutionPlan {
  planTitle: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  summary: string;
  steps: ExecutionStep[];
}

// ── Internal types ───────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

interface StepState {
  status: StepStatus;
  result?: string;
  error?: string;
  executedAt?: number;
  userConfirmed?: boolean;
}

interface AuditEntry {
  stepId: string;
  stepTitle: string;
  action: 'run' | 'skip';
  result?: string;
  error?: string;
  timestamp: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  Low: '#10a37f',
  Medium: '#f59e0b',
  High: '#ef4444',
};

const TYPE_ICONS: Record<ExecutionStep['type'], string> = {
  review:   '◻',
  browser:  '◈',
  file:     '⊞',
  research: '◎',
  decision: '◆',
  command:  '⌘',
  print:    '≡',
};

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  plan: ExecutionPlan;
  /** When true, auto-executes Low/Medium risk steps sequentially on mount. */
  autoRun?: boolean;
  /** Called when all steps have reached a terminal state (completed/skipped/failed). */
  onComplete?: () => void;
}

export function ExecutionPlanView({ plan, autoRun, onComplete }: Props) {
  const [stepStates, setStepStates] = useState<Record<string, StepState>>(() =>
    Object.fromEntries(plan.steps.map(s => [s.id, { status: 'pending' as StepStatus }]))
  );
  const [confirmStep, setConfirmStep] = useState<ExecutionStep | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const autoRunStarted = useRef(false);
  // Used by autoRun to bridge the High-risk confirmation modal with a promise.
  const autoRunHighRiskResolve = useRef<((confirmed: boolean) => void) | null>(null);

  const completedCount = Object.values(stepStates).filter(
    s => s.status === 'completed' || s.status === 'skipped'
  ).length;
  const riskC = RISK_COLORS[plan.riskLevel] ?? '#f59e0b';

  const updateStep = useCallback((id: string, patch: Partial<StepState>) => {
    setStepStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const addAudit = useCallback((step: ExecutionStep, action: 'run' | 'skip', result?: string, error?: string) => {
    setAuditLog(prev => [...prev, {
      stepId: step.id,
      stepTitle: step.title,
      action,
      result,
      error,
      timestamp: Date.now(),
    }]);
  }, []);

  const executeStep = useCallback(async (step: ExecutionStep) => {
    updateStep(step.id, { status: 'running' });
    try {
      let result = '';

      switch (step.type) {
        case 'review':
          result = 'Reviewed and noted.';
          break;

        case 'browser':
          if (step.details) {
            await window.triforge.system.openExternal(step.details);
            result = `Opened in browser: ${step.details}`;
          } else {
            result = 'No URL specified — open your browser manually.';
          }
          break;

        case 'file':
          if (step.details) {
            await window.triforge.files.openFile(step.details);
            result = `Opened: ${step.details}`;
          } else {
            const chosen = await window.triforge.files.pickFile();
            if (chosen) {
              await window.triforge.files.openFile(chosen);
              result = `Opened: ${chosen}`;
            } else {
              result = 'No file selected.';
            }
          }
          break;

        case 'research': {
          const res = await window.triforge.chat.send(step.description, []);
          result = res.text ?? res.error ?? 'Research completed.';
          break;
        }

        case 'command': {
          const cmdRes = await window.triforge.plan.runCommand(step.details ?? step.description);
          if (cmdRes.error) {
            updateStep(step.id, { status: 'failed', error: cmdRes.error, executedAt: Date.now() });
            addAudit(step, 'run', undefined, cmdRes.error);
            return;
          }
          result = cmdRes.output?.trim() ?? 'Command executed.';
          break;
        }

        case 'print': {
          const filePath = await window.triforge.files.pickFile([
            { name: 'Documents & Images', extensions: ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'] },
            { name: 'All Files', extensions: ['*'] },
          ]);
          if (filePath) {
            const printRes = await window.triforge.print.file(filePath);
            result = printRes.ok
              ? `Sent to printer: ${filePath.split(/[\\/]/).pop()}`
              : `Print failed: ${printRes.error}`;
          } else {
            result = 'No file selected for printing.';
          }
          break;
        }

        case 'decision':
          result = 'Decision noted. Continue with the next step when ready.';
          break;

        default:
          result = 'Step completed.';
      }

      updateStep(step.id, { status: 'completed', result, executedAt: Date.now(), userConfirmed: true });
      addAudit(step, 'run', result);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Step failed.';
      updateStep(step.id, { status: 'failed', error, executedAt: Date.now() });
      addAudit(step, 'run', undefined, error);
    }
  }, [updateStep, addAudit]);

  const handleRun = useCallback((step: ExecutionStep) => {
    if (step.risk === 'High') {
      setConfirmStep(step);
    } else {
      executeStep(step);
    }
  }, [executeStep]);

  const handleSkip = useCallback((step: ExecutionStep) => {
    updateStep(step.id, { status: 'skipped', executedAt: Date.now() });
    addAudit(step, 'skip');
  }, [updateStep, addAudit]);

  const handleConfirmRun = () => {
    if (confirmStep) {
      executeStep(confirmStep);
      setConfirmStep(null);
      autoRunHighRiskResolve.current?.(true);
      autoRunHighRiskResolve.current = null;
    }
  };

  const handleConfirmCancel = () => {
    setConfirmStep(null);
    autoRunHighRiskResolve.current?.(false);
    autoRunHighRiskResolve.current = null;
  };

  // Auto-run loop — runs once on mount when autoRun=true.
  // Executes Low/Medium-risk steps automatically in sequence.
  // Pauses at High-risk steps to show the existing confirmation modal;
  // resumes or stops depending on the user's choice (Confirm vs Cancel).
  useEffect(() => {
    if (!autoRun || autoRunStarted.current) return;
    autoRunStarted.current = true;

    (async () => {
      for (const step of plan.steps) {
        if (step.risk === 'High') {
          // Show the modal and wait for user decision.
          const confirmed = await new Promise<boolean>(resolve => {
            autoRunHighRiskResolve.current = resolve;
            setConfirmStep(step);
          });
          if (!confirmed) continue; // user cancelled — skip this step, keep going
          // executeStep was already called by handleConfirmRun; wait briefly for state
          await new Promise(r => setTimeout(r, 100));
        } else {
          await executeStep(step);
        }
      }
      onComplete?.();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={cs.container}>
      {/* Header */}
      <div style={cs.header}>
        <div style={cs.headerLeft}>
          <span style={cs.govBadge}>Governed Execution</span>
          <span style={cs.planTitle}>{plan.planTitle}</span>
        </div>
        <span style={{ ...cs.riskPill, background: riskC + '22', color: riskC, border: `1px solid ${riskC}55` }}>
          {plan.riskLevel} Risk
        </span>
      </div>

      {/* Summary */}
      <div style={cs.summary}>{plan.summary}</div>

      {/* Progress bar */}
      <div style={cs.progressRow}>
        <div style={cs.progressTrack}>
          <div style={{
            ...cs.progressBar,
            width: `${plan.steps.length ? (completedCount / plan.steps.length) * 100 : 0}%`,
          }} />
        </div>
        <span style={cs.progressLabel}>{completedCount} / {plan.steps.length} steps</span>
      </div>

      {/* Steps */}
      <div style={cs.stepList}>
        {plan.steps.map((step, idx) => {
          const state = stepStates[step.id] ?? { status: 'pending' };
          const rc = RISK_COLORS[step.risk] ?? '#f59e0b';
          const isDone = state.status === 'completed' || state.status === 'skipped';
          const isFailed = state.status === 'failed';
          const isRunning = state.status === 'running';

          return (
            <div key={step.id} style={{
              ...cs.stepCard,
              ...(isDone ? cs.stepCardDone : {}),
              ...(isFailed ? cs.stepCardFailed : {}),
            }}>
              <div style={cs.stepTop}>
                <span style={cs.stepNum}>{idx + 1}</span>
                <span style={cs.stepTypeIcon}>{TYPE_ICONS[step.type]}</span>
                <div style={cs.stepInfo}>
                  <div style={cs.stepTitle}>{step.title}</div>
                  <div style={cs.stepDesc}>{step.description}</div>
                  {step.details && (
                    <div style={cs.stepDetails} title={step.details}>{step.details}</div>
                  )}
                </div>
                <span style={{ ...cs.stepRiskPill, background: rc + '18', color: rc, border: `1px solid ${rc}44` }}>
                  {step.risk}
                </span>
              </div>

              {/* Outcome */}
              {state.result  && <div style={cs.stepResult}>{state.result}</div>}
              {state.error   && <div style={cs.stepError}>{state.error}</div>}
              {state.status === 'skipped' && <div style={cs.stepSkipped}>Skipped</div>}

              {/* Action buttons — pending or failed */}
              {(!isDone || isFailed) && (
                <div style={cs.stepActions}>
                  <button
                    style={{
                      ...cs.runBtn,
                      ...(isRunning ? cs.runBtnRunning : {}),
                      ...(step.risk === 'High' && !isRunning ? cs.runBtnHigh : {}),
                    }}
                    onClick={() => handleRun(step)}
                    disabled={isRunning}
                  >
                    {isRunning ? 'Running…' : isFailed ? 'Retry' : '▶ Run'}
                  </button>
                  <button style={cs.skipBtn} onClick={() => handleSkip(step)} disabled={isRunning}>
                    Skip
                  </button>
                  <span style={cs.approvalNote}>requires approval</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div style={cs.auditSection}>
          <button style={cs.auditToggle} onClick={() => setShowAudit(s => !s)}>
            Audit Log ({auditLog.length} {auditLog.length === 1 ? 'entry' : 'entries'}) {showAudit ? '▲' : '▼'}
          </button>
          {showAudit && (
            <div style={cs.auditList}>
              {auditLog.map((entry, i) => (
                <div key={i} style={cs.auditEntry}>
                  <span style={cs.auditTime}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span style={{ ...cs.auditAction, color: entry.action === 'skip' ? 'var(--text-muted)' : 'var(--accent)' }}>
                    {entry.action === 'skip' ? '⏭' : '▶'} {entry.stepTitle}
                  </span>
                  {entry.result && <span style={cs.auditResult}>{entry.result}</span>}
                  {entry.error  && <span style={cs.auditError}>{entry.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* High-risk confirmation modal */}
      {confirmStep && (
        <div style={cs.modalOverlay}>
          <div style={cs.modal}>
            <div style={cs.modalTitle}>High-Risk Step</div>
            <div style={cs.modalStepName}>{confirmStep.title}</div>
            <div style={cs.modalDesc}>{confirmStep.description}</div>
            {confirmStep.details && (
              <div style={cs.modalDetails}>{confirmStep.details}</div>
            )}
            <div style={cs.modalNote}>
              This step is rated <strong>High Risk</strong>. Review it carefully before proceeding.
              No action will be taken without your explicit confirmation.
            </div>
            <div style={cs.modalActions}>
              <button style={cs.modalCancel} onClick={handleConfirmCancel}>Cancel</button>
              <button style={cs.modalConfirm} onClick={handleConfirmRun}>Confirm &amp; Run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const cs: Record<string, React.CSSProperties> = {
  container: {
    borderTop: '1px solid var(--border)',
    padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 12,
    background: 'rgba(139,92,246,0.04)',
  },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  govBadge: {
    fontSize: 9, fontWeight: 800, color: '#8b5cf6',
    background: '#8b5cf618', border: '1px solid #8b5cf644',
    borderRadius: 20, padding: '2px 8px', flexShrink: 0,
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  planTitle: {
    fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  riskPill: {
    fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em', flexShrink: 0,
  },

  summary: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 },

  progressRow: { display: 'flex', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, var(--accent), var(--purple))',
    borderRadius: 2, transition: 'width 0.4s',
  },
  progressLabel: { fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 },

  stepList: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  stepCard: {
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '10px 12px',
    display: 'flex', flexDirection: 'column' as const, gap: 8,
    transition: 'opacity 0.2s',
  },
  stepCardDone: { opacity: 0.55 },
  stepCardFailed: { border: '1px solid #ef444444', background: '#ef44440d' },

  stepTop: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  stepNum: {
    fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: '50%', width: 20, height: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepTypeIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  stepInfo: { flex: 1, minWidth: 0 },
  stepTitle: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 },
  stepDesc: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 },
  stepDetails: {
    fontSize: 11, color: 'var(--accent)', marginTop: 4,
    fontFamily: 'monospace', background: 'var(--bg-elevated)',
    padding: '2px 6px', borderRadius: 4,
    display: 'block', maxWidth: '100%',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  stepRiskPill: {
    fontSize: 9, fontWeight: 700, borderRadius: 20, padding: '2px 7px',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em', flexShrink: 0,
  },

  stepResult: { fontSize: 12, color: '#10a37f', background: '#10a37f11', borderRadius: 6, padding: '4px 8px' },
  stepError:  { fontSize: 12, color: '#ef4444', background: '#ef444411', borderRadius: 6, padding: '4px 8px' },
  stepSkipped: { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' as const },

  stepActions: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 },
  approvalNote: { fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', fontStyle: 'italic' as const },

  runBtn: {
    fontSize: 12, fontWeight: 700,
    background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer',
  },
  runBtnRunning: { opacity: 0.6, cursor: 'not-allowed' },
  runBtnHigh: { background: '#ef4444' },
  skipBtn: {
    fontSize: 12, background: 'none',
    border: '1px solid var(--border)', color: 'var(--text-secondary)',
    borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
  },

  auditSection: { borderTop: '1px solid var(--border)', paddingTop: 10 },
  auditToggle: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: 0,
  },
  auditList: { marginTop: 8, display: 'flex', flexDirection: 'column' as const, gap: 4 },
  auditEntry: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    fontSize: 11, lineHeight: 1.5, flexWrap: 'wrap' as const,
  },
  auditTime: { color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'monospace' },
  auditAction: { fontWeight: 600, flexShrink: 0 },
  auditResult: { color: '#10a37f', flex: 1 },
  auditError:  { color: '#ef4444', flex: 1 },

  // High-risk confirmation modal
  modalOverlay: {
    position: 'fixed' as const, inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    background: 'var(--bg-surface)', border: '2px solid #ef4444',
    borderRadius: 12, padding: 24, maxWidth: 420, width: '90%',
    display: 'flex', flexDirection: 'column' as const, gap: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  modalTitle:    { fontSize: 15, fontWeight: 800, color: '#ef4444' },
  modalStepName: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' },
  modalDesc:     { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 },
  modalDetails: {
    fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace',
    background: 'var(--bg-elevated)', padding: '6px 10px', borderRadius: 6,
    wordBreak: 'break-all' as const,
  },
  modalNote: { fontSize: 12, color: '#ef4444', lineHeight: 1.6 },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 },
  modalCancel: {
    background: 'none', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 6,
    padding: '8px 18px', cursor: 'pointer', fontSize: 13,
  },
  modalConfirm: {
    background: '#ef4444', color: '#fff', border: 'none',
    borderRadius: 6, padding: '8px 18px', cursor: 'pointer',
    fontSize: 13, fontWeight: 700,
  },
};
