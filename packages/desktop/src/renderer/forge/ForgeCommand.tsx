import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MissionBriefing } from './MissionBriefing';
import { CouncilView } from './CouncilView';
import { DecisionBoard } from './DecisionBoard';
import { ExecutionGate } from './ExecutionGate';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ForgePhase =
  | 'briefing'
  | 'assembling'
  | 'debating'
  | 'synthesizing'
  | 'decision'
  | 'authorizing';

export interface MissionConfig {
  objective: string;
  constraints: string;
  riskTolerance: number;
  aggressionLevel: number;
  budgetSensitivity: 'Low' | 'Medium' | 'High';
  speedVsDepth: number;
}

export interface ProviderState {
  name: string;
  role: 'Strategist' | 'Critic' | 'Executor' | 'Synthesis';
  personality: string;
  trustScore: number;
  aggressionBias: number;
  color: string;
  status: 'idle' | 'connecting' | 'thinking' | 'complete' | 'failed';
  response?: string;
}

export interface MissionResult {
  synthesis: string;
  forgeScore: {
    confidence: number;
    risk: string;
    agreement: string;
    disagreement: string;
    assumptions: string;
    verify: string;
  };
  providerResponses: Array<{ provider: string; text: string }>;
}

export interface SavedMission {
  id: string;
  objective: string;
  createdAt: string;
  confidence: number;
  risk: string;
}

// ── Provider Personas ─────────────────────────────────────────────────────────

const PROVIDER_PERSONAS: Record<string, Omit<ProviderState, 'status' | 'name'>> = {
  Claude: {
    role: 'Strategist',
    personality: 'Stability-weighted · Long-term planning',
    trustScore: 92,
    aggressionBias: 2,
    color: '#8b5cf6',
  },
  OpenAI: {
    role: 'Critic',
    personality: 'Balanced · Structure-optimized',
    trustScore: 88,
    aggressionBias: 3,
    color: '#10b981',
  },
  Grok: {
    role: 'Executor',
    personality: 'High-velocity · Growth-biased',
    trustScore: 85,
    aggressionBias: 5,
    color: '#3b82f6',
  },
};

// ── Intensity Mapping ─────────────────────────────────────────────────────────

function configToIntensity(config: MissionConfig): string {
  const agg = config.aggressionLevel;
  const risk = 6 - config.riskTolerance;
  const score = (agg + risk) / 2;
  if (score <= 1.5) return 'cooperative';
  if (score <= 2.5) return 'analytical';
  if (score <= 3.5) return 'critical';
  if (score <= 4.5) return 'combative';
  return 'ruthless';
}

// ── Mission Prompt Builder ────────────────────────────────────────────────────

function buildMissionPrompt(config: MissionConfig, adjustment = ''): string {
  const lines: string[] = [
    `MISSION: ${config.objective}`,
    '',
  ];
  if (config.constraints.trim()) {
    lines.push(`CONSTRAINTS: ${config.constraints}`, '');
  }
  lines.push(
    'MISSION PARAMETERS:',
    `- Risk Tolerance: ${config.riskTolerance}/5`,
    `- Aggression Level: ${config.aggressionLevel}/5`,
    `- Budget Sensitivity: ${config.budgetSensitivity}`,
    `- Speed vs Depth: ${config.speedVsDepth}/5`,
    '',
    'COUNCIL DIRECTIVE: Analyze this mission through your designated strategic lens.',
    'Claude (Strategist): Prioritize long-term sustainability and risk management.',
    'OpenAI (Critic): Surface hidden assumptions, failure modes, and tradeoffs.',
    'Grok (Executor): Emphasize speed, aggressive growth, and immediate action.',
    '',
    'Return structured strategic analysis suitable for executive decision-making.',
    'Do not soften recommendations. This is a command decision environment.',
  );
  if (adjustment) {
    lines.push('', `RERUN DIRECTIVE: ${adjustment}`);
  }
  return lines.join('\n');
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  keyStatus: Record<string, boolean>;
  tier: string;
  messagesThisMonth: number;
  onMessageSent: () => void;
  onUpgradeClick: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForgeCommand({ keyStatus, tier, messagesThisMonth, onMessageSent, onUpgradeClick }: Props) {
  const [phase, setPhase] = useState<ForgePhase>('briefing');
  const [missionConfig, setMissionConfig] = useState<MissionConfig | null>(null);
  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [result, setResult] = useState<MissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missions, setMissions] = useState<SavedMission[]>([]);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState('');
  const unsubRef = useRef<(() => void) | null>(null);

  // Load mission history
  useEffect(() => {
    try {
      const raw = localStorage.getItem('triforge-missions-v1');
      if (raw) setMissions(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const saveMission = useCallback((objective: string, confidence: number, risk: string) => {
    const entry: SavedMission = {
      id: Date.now().toString(),
      objective,
      createdAt: new Date().toISOString(),
      confidence,
      risk,
    };
    setMissions(prev => {
      const updated = [entry, ...prev].slice(0, 20);
      try { localStorage.setItem('triforge-missions-v1', JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  const buildInitialProviders = (status: ProviderState['status'] = 'idle'): ProviderState[] =>
    Object.entries(PROVIDER_PERSONAS).map(([name, persona]) => ({
      name,
      ...persona,
      status,
    }));

  const launchMission = useCallback(async (config: MissionConfig, adjustment = '', forceIntensity?: string) => {
    setError(null);
    setResult(null);
    setMissionConfig(config);

    const initialProviders = buildInitialProviders('connecting');
    setProviders(initialProviders);
    setPhase('assembling');

    const intensity = forceIntensity ?? configToIntensity(config);
    const prompt = buildMissionPrompt(config, adjustment);

    // Subscribe to forge:update events
    unsubRef.current?.();
    unsubRef.current = window.triforge.forge.onUpdate((e) => {
      const evPhase = (e as Record<string, unknown>).phase as string;
      const provName = (e as Record<string, unknown>).provider as string | undefined;

      if (evPhase === 'provider:responding' && provName) {
        setPhase('debating');
        setProviders(prev => prev.map(p =>
          p.name.toLowerCase() === provName.toLowerCase() ? { ...p, status: 'thinking' } : p
        ));
      } else if (evPhase === 'provider:complete' && provName) {
        setProviders(prev => prev.map(p =>
          p.name.toLowerCase() === provName.toLowerCase() ? { ...p, status: 'complete' } : p
        ));
      } else if (evPhase === 'synthesis:start') {
        setPhase('synthesizing');
      }
    });

    try {
      const res = await window.triforge.chat.consensus(prompt, [], intensity);

      // Unsubscribe
      unsubRef.current?.();
      unsubRef.current = null;

      if ((res as Record<string, unknown>).error) {
        const errMsg = ((res as Record<string, unknown>).error as string) ?? 'Council failed';
        setError(errMsg);
        setPhase('briefing');
        return;
      }

      const typedRes = res as {
        synthesis?: string;
        forgeScore?: Record<string, unknown>;
        responses?: Array<{ provider: string; text: string }>;
        failedProviders?: Array<{ provider: string; error: string }>;
      };

      const responses = typedRes.responses ?? [];
      const fs = typedRes.forgeScore ?? {};

      // Map responses back to provider panels
      setProviders(prev => prev.map(p => {
        const match = responses.find(r => r.provider.toLowerCase() === p.name.toLowerCase());
        return match ? { ...p, status: 'complete', response: match.text } : { ...p, status: p.status === 'thinking' ? 'complete' : p.status };
      }));

      const missionResult: MissionResult = {
        synthesis: typedRes.synthesis ?? '',
        forgeScore: {
          confidence: (fs['confidence'] as number) ?? 0,
          risk: (fs['risk'] as string) ?? 'Medium',
          agreement: (fs['agreement'] as string) ?? '',
          disagreement: (fs['disagreement'] as string) ?? '',
          assumptions: (fs['assumptions'] as string) ?? '',
          verify: (fs['verify'] as string) ?? '',
        },
        providerResponses: responses,
      };

      setResult(missionResult);
      setPhase('decision');
      onMessageSent();
      saveMission(config.objective, missionResult.forgeScore.confidence, missionResult.forgeScore.risk);
    } catch (err) {
      unsubRef.current?.();
      unsubRef.current = null;
      setError(err instanceof Error ? err.message : 'Council failed');
      setPhase('briefing');
    }
  }, [onMessageSent, saveMission]);

  const handleRerun = useCallback((adjustment: string, intensity: string) => {
    if (!missionConfig) return;
    launchMission(missionConfig, adjustment, intensity);
  }, [missionConfig, launchMission]);

  const handleApply = useCallback(async () => {
    if (!result || !missionConfig) return;
    setExecuting(true);
    setExecutionResult('Dispatching to task engine…');
    try {
      const res = await window.triforge.task.run(missionConfig.objective);
      const taskRes = res as Record<string, unknown>;
      if (taskRes['error']) {
        setExecutionResult(`Error: ${taskRes['error']}`);
      } else {
        setExecutionResult('Execution Authorized — Task dispatched to queue.');
      }
    } catch (e) {
      setExecutionResult('Execution failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExecuting(false);
    }
  }, [result, missionConfig]);

  const handleModify = useCallback(async () => {
    if (!result) return;
    setExecuting(true);
    setExecutionResult('Generating execution plan…');
    try {
      const res = await window.triforge.plan.generate(result.synthesis);
      const planRes = res as Record<string, unknown>;
      if (planRes['error']) {
        setExecutionResult(`Error: ${planRes['error']}`);
      } else {
        setExecutionResult('Plan generated — review in Ledger.');
      }
    } catch (e) {
      setExecutionResult('Plan generation failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExecuting(false);
    }
  }, [result]);

  const handleSimulate = useCallback(() => {
    setExecuting(true);
    setExecutionResult('Simulation running…');
    setTimeout(() => {
      setExecutionResult('Simulation complete — no live changes made.');
      setExecuting(false);
    }, 2200);
  }, []);

  const handleSchedule = useCallback(() => {
    setExecutionResult('Scheduling not yet configured — use Automation to schedule tasks.');
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { unsubRef.current?.(); }, []);

  const activeProviderCount = Object.values(keyStatus).filter(Boolean).length;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.title}>TriForge Command</span>
          <span style={s.phasePill}>{PHASE_LABELS[phase]}</span>
        </div>
        <div style={s.headerRight}>
          {missions.length > 0 && (
            <span style={s.missionCount}>{missions.length} mission{missions.length !== 1 ? 's' : ''}</span>
          )}
          {activeProviderCount < 2 && (
            <button style={s.upgradeBtn} onClick={onUpgradeClick}>
              Configure Providers
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={s.errorBanner}>
          {error.includes('FEATURE_LOCKED') ? 'Think Tank requires Pro or higher. Upgrade to access the AI Council.' : error}
          <button style={s.errorDismiss} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Phase content */}
      <div style={s.content}>
        {phase === 'briefing' && (
          <MissionBriefing
            onLaunch={launchMission}
            keyStatus={keyStatus}
            tier={tier}
            savedMissions={missions}
            onLoadMission={(objective) => {
              // Pre-fill is handled inside MissionBriefing via prop
            }}
          />
        )}

        {(phase === 'assembling' || phase === 'debating' || phase === 'synthesizing') && (
          <CouncilView
            providers={providers}
            phase={phase}
            objective={missionConfig?.objective ?? ''}
            consensusScore={result?.forgeScore.confidence}
          />
        )}

        {(phase === 'decision' || phase === 'authorizing') && result && missionConfig && (
          <>
            <DecisionBoard
              result={result}
              config={missionConfig}
              providers={providers}
              onRerun={handleRerun}
              onProceed={() => setPhase('authorizing')}
            />
            {phase === 'authorizing' && (
              <ExecutionGate
                result={result}
                onApply={handleApply}
                onModify={handleModify}
                onSimulate={handleSimulate}
                onSchedule={handleSchedule}
                executing={executing}
                executionResult={executionResult}
              />
            )}
          </>
        )}
      </div>

      {/* Bottom mission bar — when not in briefing, allow restart */}
      {phase !== 'briefing' && (
        <div style={s.bottomBar}>
          <button style={s.newMissionBtn} onClick={() => {
            setPhase('briefing');
            setResult(null);
            setError(null);
            setExecutionResult('');
          }}>
            New Mission
          </button>
          {phase === 'decision' && (
            <span style={s.missionLabel}>
              {missionConfig?.objective.slice(0, 60)}{(missionConfig?.objective.length ?? 0) > 60 ? '…' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Phase Labels ──────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<ForgePhase, string> = {
  briefing:    'Mission Briefing',
  assembling:  'Council Assembling',
  debating:    'In Session',
  synthesizing:'Synthesizing',
  decision:    'Recommendation Ready',
  authorizing: 'Awaiting Authorization',
};

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    letterSpacing: '0.02em',
  },
  phasePill: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    background: 'rgba(255,255,255,0.06)',
    padding: '3px 8px',
    borderRadius: 4,
  },
  missionCount: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  upgradeBtn: {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 5,
    background: 'rgba(139,92,246,0.15)',
    border: '1px solid rgba(139,92,246,0.3)',
    color: '#8b5cf6',
    cursor: 'pointer',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: 'rgba(239,68,68,0.1)',
    borderBottom: '1px solid rgba(239,68,68,0.2)',
    fontSize: 12,
    color: '#ef4444',
    flexShrink: 0,
  },
  errorDismiss: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 4,
    background: 'transparent',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444',
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '0',
  },
  bottomBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  newMissionBtn: {
    fontSize: 11,
    padding: '5px 12px',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  missionLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
};
