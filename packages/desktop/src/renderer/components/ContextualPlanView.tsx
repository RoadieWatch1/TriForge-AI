import React, { useState } from 'react';
import type { ContextualIntelligenceResult } from '@triforge/engine';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  result: ContextualIntelligenceResult;
}

// ── Readiness color map ───────────────────────────────────────────────────────

const READINESS_COLORS: Record<string, string> = {
  ready:            '#10a37f',
  partially_ready:  '#f59e0b',
  blocked:          '#ef4444',
  unknown:          '#6b7280',
};

const READINESS_LABELS: Record<string, string> = {
  ready:            'Ready',
  partially_ready:  'Partially Ready',
  blocked:          'Blocked',
  unknown:          'Unknown',
};

const SEVERITY_COLORS: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#6b7280',
};

const TASK_LABELS: Record<string, string> = {
  app_submission:             'App Submission',
  creative_editing:           'Creative Editing',
  coding_build_debug:         'Build / Debug',
  file_project_organization:  'File Organization',
  browser_admin_workflow:     'Browser / Admin',
  desktop_assistance:         'Desktop Assistance',
  research_planning:          'Research & Planning',
  unknown:                    'Unknown',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={s.sectionHeader}>{label}</div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul style={s.list}>
      {items.map((item, i) => (
        <li key={i} style={s.listItem}>{item}</li>
      ))}
    </ul>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContextualPlanView({ result }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const { fusion, plan, explanation } = result;
  const readiness = plan.readiness;
  const readinessColor = READINESS_COLORS[readiness] ?? '#6b7280';
  const taskLabel = TASK_LABELS[fusion.interpretedTaskType] ?? fusion.interpretedTaskType;
  const confidence = Math.round(plan.confidence * 100);

  const blockingBlockers = plan.blockers.filter(b => b.blocking);
  const nonBlockingBlockers = plan.blockers.filter(b => !b.blocking);

  return (
    <div style={s.card}>
      {/* Header row */}
      <div style={s.cardHeader}>
        <div style={s.headerLeft}>
          <span style={s.cardLabel}>CONTEXTUAL ANALYSIS</span>
          <span style={{ ...s.taskBadge }}>
            {taskLabel}
          </span>
          <span style={{ ...s.readinessBadge, background: `${readinessColor}18`, color: readinessColor, border: `1px solid ${readinessColor}44` }}>
            {READINESS_LABELS[readiness] ?? readiness}
          </span>
          <span style={s.confidenceBadge}>{confidence}%</span>
        </div>
        <button style={s.collapseBtn} onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div style={s.cardBody}>

          {/* Understanding */}
          <SectionHeader label="Understanding" />
          <div style={s.sectionContent}>
            <div style={s.summaryText}>{explanation.whatIThinkYouWant}</div>
            {explanation.honestyNote && (
              <div style={s.honestyNote}>{explanation.honestyNote}</div>
            )}
          </div>

          {/* Environment */}
          {explanation.whatIFound.length > 0 && (
            <>
              <SectionHeader label="Environment" />
              <div style={s.sectionContent}>
                <BulletList items={explanation.whatIFound} />
              </div>
            </>
          )}

          {/* Blockers / Still Needed */}
          {(blockingBlockers.length > 0 || explanation.whatIStillNeed.length > 0) && (
            <>
              <SectionHeader label="Blockers & Needs" />
              <div style={s.sectionContent}>
                {blockingBlockers.map(b => (
                  <div key={b.id} style={{ ...s.blockerRow, borderColor: `${SEVERITY_COLORS[b.severity]}44` }}>
                    <span style={{ ...s.severityDot, background: SEVERITY_COLORS[b.severity] }} />
                    <span style={s.blockerTitle}>{b.title}</span>
                    {b.suggestedResolution && (
                      <span style={s.blockerHint}> — {b.suggestedResolution}</span>
                    )}
                  </div>
                ))}
                {nonBlockingBlockers.map(b => (
                  <div key={b.id} style={{ ...s.blockerRow, opacity: 0.75, borderColor: `${SEVERITY_COLORS[b.severity]}33` }}>
                    <span style={{ ...s.severityDot, background: SEVERITY_COLORS[b.severity] }} />
                    <span style={s.blockerTitle}>{b.title}</span>
                  </div>
                ))}
                {explanation.whatIStillNeed.length > 0 && blockingBlockers.length === 0 && (
                  <BulletList items={explanation.whatIStillNeed} />
                )}
              </div>
            </>
          )}

          {/* Approvals */}
          {explanation.whereApprovalIsNeeded.length > 0 && (
            <>
              <SectionHeader label="Approval Points" />
              <div style={s.sectionContent}>
                <BulletList items={explanation.whereApprovalIsNeeded} />
              </div>
            </>
          )}

          {/* Reasoning Plan */}
          {plan.orderedSteps.length > 0 && (
            <>
              <SectionHeader label="Reasoning Plan" />
              <div style={s.sectionContent}>
                {plan.orderedSteps.map((step) => (
                  <div key={step.id} style={s.planStep}>
                    <span style={s.stepOrder}>{step.order}</span>
                    <div style={s.stepBody}>
                      <div style={s.stepTitle}>{step.title}</div>
                      <div style={s.stepDesc}>{step.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    marginTop: 10,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text-primary, #e2e8f0)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.02)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  cardLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--text-muted, #9ca3af)',
    textTransform: 'uppercase' as const,
  },
  taskBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 10,
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    border: '1px solid rgba(99,102,241,0.3)',
  },
  readinessBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 10,
  },
  confidenceBadge: {
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--text-muted, #9ca3af)',
  },
  collapseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted, #9ca3af)',
    fontSize: 12,
    padding: '0 4px',
    lineHeight: 1,
  },
  cardBody: {
    padding: '10px 12px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  sectionHeader: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted, #9ca3af)',
    marginTop: 10,
    marginBottom: 4,
  },
  sectionContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text-primary, #e2e8f0)',
  },
  honestyNote: {
    fontSize: 11,
    lineHeight: 1.45,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.08)',
    border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: 5,
    padding: '5px 8px',
    marginTop: 4,
  },
  list: {
    margin: 0,
    paddingLeft: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  listItem: {
    fontSize: 11,
    lineHeight: 1.45,
    color: 'var(--text-secondary, #cbd5e1)',
  },
  blockerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 7,
    padding: '5px 8px',
    borderRadius: 5,
    border: '1px solid',
    background: 'rgba(255,255,255,0.02)',
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  blockerTitle: {
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.4,
    flex: 1,
  },
  blockerHint: {
    fontSize: 10,
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: 1.4,
  },
  planStep: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 4,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  stepOrder: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(99,102,241,0.8)',
    background: 'rgba(99,102,241,0.12)',
    width: 18,
    height: 18,
    borderRadius: '50%',
    display: 'flex' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepBody: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    color: 'var(--text-primary, #e2e8f0)',
  },
  stepDesc: {
    fontSize: 10,
    lineHeight: 1.45,
    color: 'var(--text-muted, #9ca3af)',
    marginTop: 2,
  },
};
