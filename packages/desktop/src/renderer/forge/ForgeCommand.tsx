import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MissionBriefing } from './MissionBriefing';
import { CouncilView } from './CouncilView';
import { DecisionBoard } from './DecisionBoard';
import { ExecutionGate } from './ExecutionGate';
import {
  analyzeConsensus,
  parseStructuredSynthesis,
  estimateCosts,
  projectInfluenceWithBias,
} from './ConsensusEngine';
import type { ConsensusAnalysis, StructuredSynthesis, CostEstimate, ConflictZone } from './ConsensusEngine';
import {
  saveLastMission,
  recordMissionComplete,
  getPersonaAdjustments,
  loadTrustWeights,
  recordConflictThemes,
  getConflictHint,
  loadLastMission as loadLastMissionForHint,
} from './ForgeContextStore';

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

// Trust key in localStorage
const TRUST_KEY = 'triforge-trust-v1';

function loadTrustScores(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TRUST_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveTrustScores(scores: Record<string, number>) {
  try { localStorage.setItem(TRUST_KEY, JSON.stringify(scores)); } catch { /* ignore */ }
}

function incrementTrustScores(names: string[]) {
  const scores = loadTrustScores();
  for (const name of names) {
    const base = PROVIDER_PERSONAS[name]?.trustScore ?? 85;
    const current = scores[name] ?? base;
    scores[name] = Math.min(99, Math.max(60, current + 1));
  }
  saveTrustScores(scores);
}

function getEffectiveTrustScore(name: string): number {
  const scores = loadTrustScores();
  return scores[name] ?? PROVIDER_PERSONAS[name]?.trustScore ?? 85;
}

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
    '',
    'SYNTHESIS STRUCTURE (follow this format exactly):',
    'EXECUTIVE SUMMARY: [2–3 decisive sentences on the recommended path forward]',
    'STRATEGIC PILLARS: [numbered list of key action areas]',
    'RISK MAP: [key risks with mitigations, format: Risk: Mitigation]',
    'TIMELINE: [Immediate / 30-day / 90-day actions]',
    'COST IMPACT: [budget implications and resource requirements]',
    'COUNCIL COMPROMISE: [how disagreements between council members were resolved]',
  );
  if (adjustment) {
    lines.push('', `RERUN DIRECTIVE: ${adjustment}`);
  }
  return lines.join('\n');
}

function buildConflictResolutionPrompt(zone: ConflictZone): string {
  const [pA, pB] = zone.providers;
  return [
    'CONFLICT RESOLUTION MISSION',
    `Issue: ${zone.issue}`,
    `${pA} argued: ${zone.stances[pA] ?? ''}`,
    `${pB} argued: ${zone.stances[pB] ?? ''}`,
    '',
    'Evaluate both positions thoroughly.',
    'Identify the strongest arguments from each side.',
    'Propose an explicit tradeoff resolution that both parties can accept.',
    'Return your synthesis using the standard SYNTHESIS STRUCTURE format.',
  ].join('\n');
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  keyStatus: Record<string, boolean>;
  tier: string;
  messagesThisMonth: number;
  onMessageSent: () => void;
  onUpgradeClick: () => void;
  onDiscussInChat?: (prompt: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForgeCommand({ keyStatus, tier, messagesThisMonth, onMessageSent, onUpgradeClick, onDiscussInChat }: Props) {
  const [phase, setPhase] = useState<ForgePhase>('briefing');
  const [missionConfig, setMissionConfig] = useState<MissionConfig | null>(null);
  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [result, setResult] = useState<MissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missions, setMissions] = useState<SavedMission[]>([]);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState('');

  // Phase 2 state
  const [consensusAnalysis, setConsensusAnalysis] = useState<ConsensusAnalysis | null>(null);
  const [structuredSynthesis, setStructuredSynthesis] = useState<StructuredSynthesis | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [isRealigning, setIsRealigning] = useState(false);
  const [projectedInfluence, setProjectedInfluence] = useState<Record<string, number> | null>(null);

  // Phase 3.5: conflict hint from prior missions
  const [conflictHint] = useState<string | null>(() => {
    const m = loadLastMissionForHint();
    return m ? getConflictHint(m.objective) : null;
  });

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

  const buildInitialProviders = (status: ProviderState['status'] = 'idle'): ProviderState[] => {
    const adjustments = getPersonaAdjustments();
    return Object.entries(PROVIDER_PERSONAS).map(([name, persona]) => {
      const adj = adjustments.find(a => a.name === name);
      return {
        name,
        ...persona,
        trustScore: Math.min(99, Math.max(60, getEffectiveTrustScore(name) + (adj?.trustDelta ?? 0))),
        aggressionBias: Math.min(5, Math.max(1, persona.aggressionBias + (adj?.aggressionDelta ?? 0))),
        status,
      };
    });
  };

  const launchMission = useCallback(async (config: MissionConfig, adjustment = '', forceIntensity?: string) => {
    setError(null);
    setResult(null);
    setConsensusAnalysis(null);
    setStructuredSynthesis(null);
    setCostEstimate(null);
    setProjectedInfluence(null);
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
        return match
          ? { ...p, status: 'complete', response: match.text }
          : { ...p, status: p.status === 'thinking' ? 'complete' : p.status };
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

      // Phase 2: run ConsensusEngine
      const responsesMap: Record<string, string> = {};
      for (const r of responses) responsesMap[r.provider] = r.text;

      const personaList = Object.entries(PROVIDER_PERSONAS).map(([name, p]) => ({
        name,
        trustScore: getEffectiveTrustScore(name),
        aggressionBias: p.aggressionBias,
      }));

      const analysis = analyzeConsensus(
        responsesMap,
        missionResult.synthesis,
        personaList,
        config.aggressionLevel
      );
      const structuredSynth = parseStructuredSynthesis(missionResult.synthesis);

      // Phase 3.5: apply trust weights to influence map, then normalize
      const tw = loadTrustWeights();
      const weighted: Record<string, number> = {};
      let twTotal = 0;
      for (const [name, raw] of Object.entries(analysis.influenceMap)) {
        weighted[name] = raw * (tw[name] ?? 1.0);
        twTotal += weighted[name];
      }
      const weightedInfluence: Record<string, number> = {};
      for (const [name, val] of Object.entries(weighted)) {
        weightedInfluence[name] = twTotal > 0
          ? Math.round((val / twTotal) * 100)
          : Math.round(100 / Object.keys(weighted).length);
      }
      const enrichedAnalysis = { ...analysis, influenceMap: weightedInfluence };
      setConsensusAnalysis(enrichedAnalysis);

      // Record conflict themes if high divergence
      if (analysis.divergenceIndex > 40 && analysis.conflictZones.length > 0) {
        recordConflictThemes(analysis.conflictZones.map(z => z.issue));
      }

      setStructuredSynthesis(structuredSynth);
      setCostEstimate(estimateCosts(prompt, responsesMap));
      setIsRealigning(false);
      setProjectedInfluence(null);

      // Phase 3: persist mission to shared context store
      saveLastMission({
        objective: config.objective,
        executiveSummary: structuredSynth.executiveSummary || missionResult.synthesis.slice(0, 300),
        strategicPillars: structuredSynth.strategicPillars,
        riskLevel: missionResult.forgeScore.risk,
        confidenceScore: missionResult.forgeScore.confidence,
        semanticScore: enrichedAnalysis.consensusScore,
        providerInfluenceMap: enrichedAnalysis.influenceMap,
        divergenceIndex: analysis.divergenceIndex,
        timestamp: Date.now(),
      });
      recordMissionComplete();

    } catch (err) {
      unsubRef.current?.();
      unsubRef.current = null;
      setError(err instanceof Error ? err.message : 'Council failed');
      setPhase('briefing');
    }
  }, [onMessageSent, saveMission]);

  const handleRerunWithBias = useCallback((
    adjustment: string,
    intensity: string,
    biasType?: 'aggression' | 'stability' | 'cost'
  ) => {
    if (!missionConfig) return;
    if (biasType && consensusAnalysis?.influenceMap) {
      const projected = projectInfluenceWithBias(consensusAnalysis.influenceMap, biasType);
      setProjectedInfluence(projected);
      setIsRealigning(true);
      setTimeout(() => {
        launchMission(missionConfig, adjustment, intensity);
      }, 500);
    } else {
      launchMission(missionConfig, adjustment, intensity);
    }
  }, [missionConfig, consensusAnalysis, launchMission]);

  // Legacy handleRerun for backwards compat
  const handleRerun = useCallback((adjustment: string, intensity: string) => {
    handleRerunWithBias(adjustment, intensity);
  }, [handleRerunWithBias]);

  const handleOpenConflict = useCallback((zone: ConflictZone) => {
    if (!missionConfig) return;
    const conflictPrompt = buildConflictResolutionPrompt(zone);
    const conflictConfig: MissionConfig = {
      ...missionConfig,
      objective: conflictPrompt,
    };
    launchMission(conflictConfig, '', 'critical');
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
        // Increment trust for all providers that responded
        const respondedNames = providers.filter(p => p.response).map(p => p.name);
        incrementTrustScores(respondedNames);
      }
    } catch (e) {
      setExecutionResult('Execution failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExecuting(false);
    }
  }, [result, missionConfig, providers]);

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
          <>
            {conflictHint && (
              <div style={s.conflictHint}>
                <span style={s.conflictHintIcon}>⚠</span>
                {conflictHint}
              </div>
            )}
            <MissionBriefing
              onLaunch={launchMission}
              keyStatus={keyStatus}
              tier={tier}
              savedMissions={missions}
              onLoadMission={(_objective) => { /* pre-fill handled inside MissionBriefing */ }}
            />
          </>
        )}

        {(phase === 'assembling' || phase === 'debating' || phase === 'synthesizing') && (
          <CouncilView
            providers={providers}
            phase={phase}
            objective={missionConfig?.objective ?? ''}
            consensusScore={consensusAnalysis?.consensusScore ?? result?.forgeScore.confidence}
            alignmentMatrix={consensusAnalysis?.alignmentMatrix}
          />
        )}

        {(phase === 'decision' || phase === 'authorizing') && result && missionConfig && (
          <>
            <DecisionBoard
              result={result}
              config={missionConfig}
              providers={providers}
              onRerun={handleRerunWithBias}
              onProceed={() => setPhase('authorizing')}
              consensusAnalysis={consensusAnalysis}
              structuredSynthesis={structuredSynthesis}
              costEstimate={costEstimate}
              influenceMap={projectedInfluence ?? consensusAnalysis?.influenceMap}
              isRealigning={isRealigning}
              onOpenConflict={handleOpenConflict}
              onDiscussInChat={onDiscussInChat}
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
            setConsensusAnalysis(null);
            setStructuredSynthesis(null);
            setCostEstimate(null);
            setProjectedInfluence(null);
            setIsRealigning(false);
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
  conflictHint: {
    margin: '0 0 10px 0', padding: '8px 14px',
    background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid rgba(245,158,11,0.6)',
    borderRadius: 6, fontSize: 12, color: 'rgba(245,158,11,0.85)',
    lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8,
  },
  conflictHintIcon: { fontSize: 14, flexShrink: 0, marginTop: 1 },
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
