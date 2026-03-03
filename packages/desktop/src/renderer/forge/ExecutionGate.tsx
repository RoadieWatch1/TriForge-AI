import React, { useState } from 'react';
import type { MissionResult } from './ForgeCommand';

interface Props {
  result: MissionResult;
  onApply: () => void;
  onModify: () => void;
  onSimulate: () => void;
  onSchedule: () => void;
  executing: boolean;
  executionResult: string;
}

type Action = 'none' | 'applying' | 'modifying' | 'scheduling' | 'simulating';

export function ExecutionGate({ result, onApply, onModify, onSimulate, onSchedule, executing, executionResult }: Props) {
  const [action, setAction] = useState<Action>('none');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [showSchedule, setShowSchedule] = useState(false);

  const handleApply = () => {
    setAction('applying');
    setShowSchedule(false);
    onApply();
  };

  const handleModify = () => {
    setAction('modifying');
    setShowSchedule(false);
    onModify();
  };

  const handleSimulate = () => {
    setAction('simulating');
    setShowSchedule(false);
    onSimulate();
  };

  const handleSchedule = () => {
    if (showSchedule) {
      setAction('scheduling');
      onSchedule();
      setShowSchedule(false);
    } else {
      setShowSchedule(true);
    }
  };

  const isIdle = !executing && !executionResult;
  const statusText =
    executionResult ||
    (action === 'applying'   ? 'Dispatching to task engine…' :
     action === 'modifying'  ? 'Generating execution plan…' :
     action === 'simulating' ? 'Running simulation…' :
     action === 'scheduling' ? 'Scheduling…' :
     'Awaiting Authorization');

  const isDone = !!executionResult;

  return (
    <div style={eg.root}>
      <div style={eg.header}>
        <div style={eg.headerLeft}>
          <span style={eg.label}>Execution Authorization</span>
          <span style={eg.sub}>
            This mission has been reviewed by the AI Council. Authorize execution to proceed.
          </span>
        </div>
      </div>

      <div style={eg.actions}>
        <button
          style={{ ...eg.actionBtn, ...eg.applyBtn, ...(executing ? eg.btnDisabled : {}) }}
          onClick={handleApply}
          disabled={executing}
        >
          <span style={eg.btnIcon}>▶</span>
          Apply Now
        </button>

        <button
          style={{ ...eg.actionBtn, ...(executing ? eg.btnDisabled : {}) }}
          onClick={handleModify}
          disabled={executing}
        >
          <span style={eg.btnIcon}>✎</span>
          Modify Plan
        </button>

        <button
          style={{ ...eg.actionBtn, ...(showSchedule ? eg.activeBtn : {}), ...(executing ? eg.btnDisabled : {}) }}
          onClick={handleSchedule}
          disabled={executing}
        >
          <span style={eg.btnIcon}>⊙</span>
          {showSchedule ? 'Confirm Schedule' : 'Schedule'}
        </button>

        <button
          style={{ ...eg.actionBtn, ...(executing ? eg.btnDisabled : {}) }}
          onClick={handleSimulate}
          disabled={executing}
        >
          <span style={eg.btnIcon}>◎</span>
          Simulate Impact
        </button>
      </div>

      {/* Schedule time picker */}
      {showSchedule && (
        <div style={eg.schedulePicker}>
          <span style={eg.scheduleLabel}>Schedule for</span>
          <input
            type="time"
            value={scheduleTime}
            onChange={e => setScheduleTime(e.target.value)}
            style={eg.timeInput}
          />
          <span style={eg.scheduleLabel}>today</span>
        </div>
      )}

      {/* Status */}
      <div style={eg.statusRow}>
        <div style={{
          ...eg.statusDot,
          background: isDone
            ? (executionResult.toLowerCase().includes('error') ? '#ef4444' : '#10b981')
            : executing
              ? '#f59e0b'
              : 'rgba(255,255,255,0.2)',
          animation: executing ? 'statusPulse 1.2s ease-in-out infinite' : 'none',
        }} />
        <span style={{
          ...eg.statusText,
          color: isDone
            ? (executionResult.toLowerCase().includes('error') ? '#ef4444' : '#10b981')
            : 'var(--text-muted)',
        }}>
          {statusText}
        </span>
      </div>

      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const eg: Record<string, React.CSSProperties> = {
  root: {
    margin: '16px 20px 20px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '18px 20px',
    background: 'rgba(255,255,255,0.02)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  sub: { fontSize: 12, color: 'var(--text-secondary)', maxWidth: 500 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '9px 16px',
    borderRadius: 7,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  applyBtn: {
    background: 'rgba(139,92,246,0.12)',
    border: '1px solid rgba(139,92,246,0.3)',
    color: '#8b5cf6',
  },
  activeBtn: {
    background: 'rgba(16,185,129,0.1)',
    border: '1px solid rgba(16,185,129,0.3)',
    color: '#10b981',
  },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  btnIcon: { fontSize: 11 },
  schedulePicker: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 7,
  },
  scheduleLabel: { fontSize: 12, color: 'var(--text-secondary)' },
  timeInput: {
    padding: '5px 8px',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8 },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: { fontSize: 12 },
};
