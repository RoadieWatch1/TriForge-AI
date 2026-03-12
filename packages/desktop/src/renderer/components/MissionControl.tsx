import React, { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
}

interface ConsensusResponse {
  provider: string;
  text: string;
}

interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string | Date;
  consensusResponses?: ConsensusResponse[];
  forgeScore?: ForgeScore;
  provider?: string;
  debateIntensity?: string;
}

const HISTORY_KEY = 'triforge-chat-v2';

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  claude: '#d97706',
  grok: '#6366f1',
};

const RISK_COLORS: Record<string, string> = { Low: '#10a37f', Medium: '#f59e0b', High: '#ef4444' };

const TRUST_DOMAINS = ['Marketing', 'Outreach', 'Trading'];
const TRUST_LEVELS = ['Off', 'Suggest', 'Approve', 'Full'];

interface AutonomyStatusSnapshot {
  professionName: string | null;
  approvalStrictness: string | null;
  runningSensors: number;
  enabledWorkflows: number;
  pendingApprovals: number;
  lastFiredName: string | null;
  lastFiredAt: number | null;
  engineRunning: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MissionControl() {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [selected, setSelected] = useState<SessionMessage | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionMessage[];
        setMessages(parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp as string) })));
      }
    } catch { /* ok */ }
  }, []);

  const [autonomyStatus, setAutonomyStatus] = useState<AutonomyStatusSnapshot | null>(null);

  const fetchAutonomyStatus = useCallback(async () => {
    try {
      const tf = (window as unknown as { triforge?: Record<string, unknown> }).triforge;
      if (!tf) return;
      const [profStatus, sensorList, wfList] = await Promise.allSettled([
        (tf['profession'] as Record<string, () => Promise<unknown>>)?.['getStatus']?.(),
        (tf['sensors'] as Record<string, () => Promise<unknown>>)?.['list']?.(),
        (tf['autonomy'] as Record<string, () => Promise<unknown>>)?.['listWorkflows']?.(),
      ]);
      const prof = profStatus.status === 'fulfilled' ? (profStatus.value as Record<string, unknown> | null) : null;
      const sensors = sensorList.status === 'fulfilled' ? (sensorList.value as Array<{ running: boolean }>) : [];
      const workflows = wfList.status === 'fulfilled' ? (wfList.value as Array<{ enabled: boolean }>) : [];
      setAutonomyStatus({
        professionName:      prof ? String(prof['professionName'] ?? '') || null : null,
        approvalStrictness:  prof ? String(prof['approvalStrictness'] ?? '') || null : null,
        runningSensors:      Array.isArray(sensors) ? sensors.filter(s => s.running).length : 0,
        enabledWorkflows:    Array.isArray(workflows) ? workflows.filter(w => w.enabled).length : 0,
        pendingApprovals:    prof ? Number(prof['pendingActionCount'] ?? 0) : 0,
        lastFiredName:       prof ? String(prof['lastFiredWorkflowName'] ?? '') || null : null,
        lastFiredAt:         prof ? Number(prof['lastFiredAt'] ?? 0) || null : null,
        engineRunning:       prof ? Boolean(prof['engineRunning']) : false,
      });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAutonomyStatus();
    const timer = setInterval(fetchAutonomyStatus, 10_000);
    return () => clearInterval(timer);
  }, [fetchAutonomyStatus]);

  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const totalConsensus = assistantMsgs.filter(m => m.consensusResponses).length;
  const avgConf = assistantMsgs.filter(m => m.forgeScore).length > 0
    ? Math.round(assistantMsgs.filter(m => m.forgeScore).reduce((s, m) => s + (m.forgeScore?.confidence ?? 0), 0) / assistantMsgs.filter(m => m.forgeScore).length)
    : null;

  return (
    <div style={mc.container}>
      {/* Header */}
      <div style={mc.header}>
        <div>
          <h1 style={mc.title}>Mission Control</h1>
          <p style={mc.subtitle}>Session intelligence &amp; trust management</p>
        </div>
        <div style={mc.statRow}>
          <div style={mc.stat}>
            <span style={mc.statNum}>{assistantMsgs.length}</span>
            <span style={mc.statLbl}>Responses</span>
          </div>
          <div style={mc.stat}>
            <span style={mc.statNum}>{totalConsensus}</span>
            <span style={mc.statLbl}>Think Tank</span>
          </div>
          {avgConf !== null && (
            <div style={mc.stat}>
              <span style={{ ...mc.statNum, color: avgConf >= 75 ? '#10a37f' : avgConf >= 50 ? '#f59e0b' : '#ef4444' }}>{avgConf}%</span>
              <span style={mc.statLbl}>Avg Confidence</span>
            </div>
          )}
        </div>
      </div>

      {/* Body: history | detail | trust */}
      <div style={mc.body}>
        {/* History panel */}
        <div style={mc.historyPanel}>
          <div style={mc.sectionTitle}>SESSION HISTORY</div>
          {assistantMsgs.length === 0 && (
            <div style={mc.empty}>No session data yet. Start a conversation in Forge.</div>
          )}
          {[...assistantMsgs].reverse().map(msg => {
            const ts = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);
            const isActive = selected?.id === msg.id;
            const riskColor = msg.forgeScore ? (RISK_COLORS[msg.forgeScore.risk] ?? '#f59e0b') : null;
            return (
              <div
                key={msg.id}
                style={{ ...mc.historyItem, ...(isActive ? mc.historyItemActive : {}) }}
                onClick={() => { setSelected(msg); setActiveTab(0); }}
              >
                <div style={mc.historyLabel}>
                  <span style={{ color: msg.consensusResponses ? 'var(--accent)' : 'var(--text-muted)', fontSize: 10, fontWeight: 700 }}>
                    {msg.consensusResponses ? '⬡ Think Tank' : `◈ ${msg.provider ? msg.provider.toUpperCase() : 'Response'}`}
                  </span>
                  {msg.forgeScore && riskColor && (
                    <span style={{ fontSize: 9, color: riskColor, fontWeight: 700, background: riskColor + '15', border: `1px solid ${riskColor}33`, borderRadius: 4, padding: '1px 5px' }}>
                      {msg.forgeScore.confidence}%
                    </span>
                  )}
                </div>
                <div style={mc.historyPreview}>{msg.content.slice(0, 72)}{msg.content.length > 72 ? '…' : ''}</div>
                <div style={mc.historyMeta}>
                  {ts.toLocaleDateString()} {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <div style={mc.detailPanel}>
          {selected ? (
            <>
              <div style={mc.detailHeader}>
                <span style={mc.detailBadge}>{selected.consensusResponses ? 'Think Tank Synthesis' : 'AI Response'}</span>
                {selected.forgeScore && (
                  <span style={{ ...mc.detailBadge, background: (RISK_COLORS[selected.forgeScore.risk] ?? '#f59e0b') + '15', color: RISK_COLORS[selected.forgeScore.risk] ?? '#f59e0b', borderColor: (RISK_COLORS[selected.forgeScore.risk] ?? '#f59e0b') + '33' }}>
                    {selected.forgeScore.confidence}% · {selected.forgeScore.risk} Risk
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <button style={mc.copyBtn} onClick={() => navigator.clipboard.writeText(selected.content)}>Copy</button>
              </div>

              {/* Tabs */}
              {selected.consensusResponses && selected.consensusResponses.length > 0 && (
                <div style={mc.tabBar}>
                  <button style={{ ...mc.tab, ...(activeTab === 0 ? mc.tabActive : {}) }} onClick={() => setActiveTab(0)}>Synthesis</button>
                  {selected.consensusResponses.map((r, i) => (
                    <button key={r.provider} style={{ ...mc.tab, ...(activeTab === i + 1 ? mc.tabActive : {}) }} onClick={() => setActiveTab(i + 1)}>
                      <span style={{ color: PROVIDER_COLORS[r.provider.toLowerCase()] ?? 'var(--accent)' }}>●</span>
                      {' '}{r.provider.charAt(0).toUpperCase() + r.provider.slice(1)}
                    </button>
                  ))}
                </div>
              )}

              <div style={mc.detailContent}>
                {activeTab === 0 ? (
                  <>
                    {selected.forgeScore && (
                      <div style={mc.scoreCard}>
                        <div style={mc.scoreHeader}>FORGE SCORE</div>
                        <div style={mc.scoreBar}>
                          <div style={{ ...mc.scoreBarFill, width: `${selected.forgeScore.confidence}%`, background: selected.forgeScore.confidence >= 75 ? '#10a37f' : selected.forgeScore.confidence >= 50 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        {selected.forgeScore.agreement && <div style={mc.scoreRow}><span style={mc.scoreKey}>Agreement:</span> {selected.forgeScore.agreement}</div>}
                        {selected.forgeScore.disagreement && <div style={mc.scoreRow}><span style={mc.scoreKey}>Disagreement:</span> {selected.forgeScore.disagreement}</div>}
                        {selected.forgeScore.verify && <div style={mc.scoreRow}><span style={mc.scoreKey}>Verify:</span> {selected.forgeScore.verify}</div>}
                      </div>
                    )}
                    <pre style={mc.detailText}>{selected.content}</pre>
                  </>
                ) : (
                  selected.consensusResponses && selected.consensusResponses[activeTab - 1] && (
                    <div>
                      <div style={{ ...mc.sectionTitle, marginBottom: 12 }}>
                        {selected.consensusResponses[activeTab - 1].provider.toUpperCase()} RESPONSE
                      </div>
                      <pre style={mc.detailText}>{selected.consensusResponses[activeTab - 1].text}</pre>
                    </div>
                  )
                )}
              </div>
            </>
          ) : (
            <div style={mc.detailEmpty}>
              <div style={{ fontSize: 32, opacity: 0.1, marginBottom: 10 }}>⬡</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Select a response to inspect</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>Full output, Forge Score, and individual model responses</div>
            </div>
          )}
        </div>

        {/* Trust Modes panel */}
        <div style={mc.trustPanel}>
          <div style={mc.sectionTitle}>TRUST MODES</div>
          <div style={mc.trustNote}>
            Configure autonomous action boundaries per domain. Higher levels allow TriForge to act without confirmation.
          </div>
          <div style={mc.trustGrid}>
            {TRUST_DOMAINS.map(domain => (
              <div key={domain} style={mc.trustRow}>
                <span style={mc.trustDomain}>{domain}</span>
                <div style={mc.trustLevels}>
                  {TRUST_LEVELS.map((level, i) => (
                    <button
                      key={level}
                      disabled
                      style={{
                        ...mc.trustLvl,
                        ...(i === 0 ? mc.trustLvlActive : {}),
                      }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={mc.trustComingSoon}>Coming in a future update</div>

          {/* Autonomy Status — non-invasive read-only panel */}
          <div style={mc.sectionTitle}>AUTONOMY STATUS</div>
          <div style={mc.autonomyPanel}>
            <div style={mc.autonomyRow}>
              <span style={mc.autonomyKey}>Engine</span>
              <span style={{ ...mc.autonomyVal, color: autonomyStatus?.engineRunning ? '#10a37f' : 'var(--text-muted)' }}>
                {autonomyStatus?.engineRunning ? 'Running' : 'Idle'}
              </span>
            </div>
            <div style={mc.autonomyRow}>
              <span style={mc.autonomyKey}>Profession</span>
              <span style={mc.autonomyVal}>
                {autonomyStatus?.professionName
                  ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{autonomyStatus.professionName}</span>
                  : <span style={{ color: 'var(--text-muted)' }}>None</span>}
              </span>
            </div>
            {autonomyStatus?.approvalStrictness && (
              <div style={mc.autonomyRow}>
                <span style={mc.autonomyKey}>Strictness</span>
                <span style={{ ...mc.autonomyVal, textTransform: 'capitalize' }}>{autonomyStatus.approvalStrictness}</span>
              </div>
            )}
            <div style={mc.autonomyRow}>
              <span style={mc.autonomyKey}>Sensors</span>
              <span style={mc.autonomyVal}>{autonomyStatus?.runningSensors ?? '—'} running</span>
            </div>
            <div style={mc.autonomyRow}>
              <span style={mc.autonomyKey}>Workflows</span>
              <span style={mc.autonomyVal}>{autonomyStatus?.enabledWorkflows ?? '—'} enabled</span>
            </div>
            <div style={mc.autonomyRow}>
              <span style={mc.autonomyKey}>Pending</span>
              <span style={{ ...mc.autonomyVal, color: (autonomyStatus?.pendingApprovals ?? 0) > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                {autonomyStatus?.pendingApprovals ?? 0} approvals
              </span>
            </div>
            {autonomyStatus?.lastFiredName && (
              <div style={mc.autonomyLastFired}>
                <span style={mc.autonomyKey}>Last fired</span>
                <span style={mc.autonomyLastFiredName}>{autonomyStatus.lastFiredName}</span>
                {autonomyStatus.lastFiredAt && (
                  <span style={mc.autonomyMeta}>
                    {new Date(autonomyStatus.lastFiredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const mc: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)' },
  title: { fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' },
  subtitle: { fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' },
  statRow: { display: 'flex', gap: 24 },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  statNum: { fontSize: 22, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 },
  statLbl: { fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  historyPanel: { width: 220, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--bg-surface)', flexShrink: 0 },
  sectionTitle: { fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '10px 12px 6px' },
  empty: { padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 },
  historyItem: { padding: '10px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' },
  historyItemActive: { background: 'var(--accent-dim)', borderLeft: '2px solid var(--accent)' },
  historyLabel: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  historyPreview: { fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  historyMeta: { fontSize: 10, color: 'var(--text-muted)', marginTop: 4 },

  detailPanel: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' },
  detailBadge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)33' },
  copyBtn: { fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-muted)', padding: '3px 10px', cursor: 'pointer' },
  tabBar: { display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' },
  tab: { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  tabActive: { background: 'var(--accent)22', border: '1px solid var(--accent)55', color: 'var(--text-primary)' },
  detailContent: { flex: 1, overflowY: 'auto', padding: '16px' },
  detailEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  detailText: { fontSize: 13, lineHeight: 1.65, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font)' },
  scoreCard: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 },
  scoreHeader: { fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 },
  scoreBar: { height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  scoreBarFill: { height: '100%', borderRadius: 3, transition: 'width 0.6s' },
  scoreRow: { fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 },
  scoreKey: { fontWeight: 600, color: 'var(--text-muted)' },

  trustPanel: { width: 220, borderLeft: '1px solid var(--border)', padding: '0 0 16px', background: 'var(--bg-surface)', overflowY: 'auto', flexShrink: 0 },
  trustNote: { fontSize: 11, color: 'var(--text-muted)', padding: '0 12px 10px', lineHeight: 1.5 },
  trustGrid: { display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px' },
  trustRow: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 },
  trustDomain: { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.02em' },
  trustLevels: { display: 'flex', gap: 3 },
  trustLvl: { flex: 1, fontSize: 9, fontWeight: 600, padding: '3px 0', borderRadius: 4, background: 'none', border: '1px solid var(--border)', color: 'rgba(255,255,255,0.2)', cursor: 'not-allowed', textTransform: 'uppercase', letterSpacing: '0.04em' },
  trustLvlActive: { background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.12)' },
  trustComingSoon: { fontSize: 10, color: 'rgba(255,255,255,0.18)', textAlign: 'center', padding: '14px 12px 0', fontStyle: 'italic' },

  autonomyPanel: { display: 'flex', flexDirection: 'column', gap: 5, padding: '4px 12px 8px' },
  autonomyRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  autonomyKey: { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600, flexShrink: 0 },
  autonomyVal: { fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500, textAlign: 'right' as const },
  autonomyLastFired: { display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4, borderTop: '1px solid var(--border)', marginTop: 2 },
  autonomyLastFiredName: { fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' as const },
  autonomyMeta: { fontSize: 9, color: 'var(--text-muted)' },
};
