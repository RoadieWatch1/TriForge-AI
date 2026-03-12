import React, { useState, useEffect } from 'react';
import { CouncilSeat } from './CouncilSeat';
import { MergeZone } from './MergeZone';
import { ForgeChamber } from '../ForgeChamber';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConsensusResponse {
  provider: string;
  text: string;
}

interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
}

interface ConsensusMessage {
  content: string;
  consensusResponses?: ConsensusResponse[];
  forgeScore?: ForgeScore;
}

interface Props {
  latestMsg: ConsensusMessage | null;
  thinking: boolean;
  keyStatus: Record<string, boolean>;
  agreementMap: Record<string, boolean | null>;
  selectedProvider: string | null;
  onAgreementChange: (provider: string, agrees: boolean) => void;
  onProposeAlternative: (provider: string) => void;
  onSelectOutput: (key: string) => void;
  onMergeProviders: (p1: string, p2: string) => void;
  /** Live streaming tokens per provider during the thinking phase */
  liveProviderTokens?: Record<string, string>;
  /** Live streaming tokens for synthesis — shown in MergeZone before final synthesis arrives */
  liveSynthesisText?: string;
  /** Council Awareness thinking messages per provider (before tokens arrive) */
  providerThinkingMessages?: Record<string, string>;
  /** Provider error messages (provider failed during consensus) */
  providerErrors?: Record<string, string>;
  /** When true, all seats pulse blue — council is in wake-word listening mode */
  listening?: boolean;
}

// ── Provider config ───────────────────────────────────────────────────────────

const PROVIDERS = [
  { id: 'openai', label: 'GPT',    color: '#10a37f', role: 'Analyst'    },
  { id: 'claude', label: 'Claude', color: '#d97706', role: 'Strategist' },
  { id: 'grok',   label: 'Grok',   color: '#6366f1', role: 'Disruptor'  },
];

// Timeline stage labels + colors
type TimelineStage = 'thinking' | 'response' | 'agreement' | 'merge';
const TIMELINE_STAGES: { id: TimelineStage; label: string; color: string }[] = [
  { id: 'thinking',  label: 'THINKING',  color: '#6366f1' },
  { id: 'response',  label: 'RESPONSE',  color: '#d97706' },
  { id: 'agreement', label: 'AGREEMENT', color: '#10a37f' },
  { id: 'merge',     label: 'MERGE',     color: '#10b981' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function CouncilChamber({
  latestMsg, thinking, keyStatus, agreementMap,
  selectedProvider, onAgreementChange, onProposeAlternative, onSelectOutput, onMergeProviders,
  liveProviderTokens, liveSynthesisText, providerThinkingMessages, providerErrors, listening,
}: Props) {
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);

  const responses = latestMsg?.consensusResponses ?? [];
  const respondedIds = responses.map(r => r.provider.toLowerCase());
  const respondedProviders = PROVIDERS.filter(p => respondedIds.includes(p.id));

  // Only explicitly agreed (=== true) providers count toward consensus
  const agreementCount = respondedProviders.filter(p => agreementMap[p.id] === true).length;

  // Determine current timeline stage
  const timelineStage: TimelineStage =
    latestMsg?.content && agreementCount >= 2 ? 'merge' :
    latestMsg?.content && agreementCount > 0  ? 'agreement' :
    respondedProviders.length > 0             ? 'response' :
    thinking                                   ? 'thinking' :
    'thinking';

  // Reset merge selection when a new synthesis arrives
  useEffect(() => {
    setMergeSelection([]);
  }, [latestMsg?.content]);

  // Show top options panel when: not thinking, 2+ responded, and not full agreement
  const showTopOptions = !thinking && respondedProviders.length >= 2 && agreementCount < respondedProviders.length;

  const toggleMergeSelect = (id: string) => {
    setMergeSelection(prev =>
      prev.includes(id)
        ? prev.filter(p => p !== id)
        : prev.length < 2 ? [...prev, id] : [prev[1], id]
    );
  };

  // Compute reviewingLabel for each seat: first other provider that has already responded
  function getReviewingLabel(seatId: string): string | undefined {
    if (!thinking) return undefined;
    const otherResponded = respondedProviders.find(p => p.id !== seatId);
    return otherResponded?.label;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ForgeChamber animation — shown during thinking */}
      {thinking && (
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          <ForgeChamber visible={true} />
        </div>
      )}

      {/* Main council area — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 8px' }}>
        {/* Merge Zone — sits above the seats */}
        <MergeZone
          synthesis={latestMsg?.content ?? null}
          agreementCount={agreementCount}
          totalProviders={respondedProviders.length || PROVIDERS.filter(p => keyStatus[p.id]).length}
          thinking={thinking}
          forgeScore={latestMsg?.forgeScore}
          liveText={liveSynthesisText}
        />

        {/* Top 2 Options — shown when council is divided */}
        {showTopOptions && (
          <div style={{
            padding: '8px 10px', marginBottom: 8,
            border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8,
            background: 'rgba(245,158,11,0.04)',
          }}>
            <div style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
              color: '#f59e0b', marginBottom: 6, textTransform: 'uppercase' as const,
            }}>
              Council Divided — Select Directions to Merge
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, alignItems: 'center' }}>
              {respondedProviders.map(({ id, label, color }) => {
                const sel = mergeSelection.includes(id);
                return (
                  <button
                    key={id}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      background: sel ? `${color}22` : 'rgba(255,255,255,0.05)',
                      color: sel ? color : 'var(--text-muted)',
                      border: `1px solid ${sel ? color : 'var(--border)'}`,
                      transition: 'all 0.2s',
                    }}
                    onClick={() => toggleMergeSelect(id)}
                  >
                    {sel ? '✓ ' : ''}{label}
                  </button>
                );
              })}
              {mergeSelection.length === 2 && (
                <button
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(16,185,129,0.15))',
                    color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.4)',
                    marginLeft: 'auto', transition: 'all 0.2s',
                  }}
                  onClick={() => {
                    onMergeProviders(mergeSelection[0], mergeSelection[1]);
                    setMergeSelection([]);
                  }}
                >
                  Merge These Two →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Council Seats — 3-column grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          alignItems: 'start',
        }}>
          {PROVIDERS.map(({ id, label, color, role }) => {
            const resp = responses.find(r => r.provider.toLowerCase() === id);
            const isActive = keyStatus[id];
            const hasResponse = !!resp;
            const hasError = !!providerErrors?.[id];
            const status = thinking && isActive && !hasError ? 'thinking' : hasResponse ? 'responded' : hasError ? 'error' : 'idle';
            const reviewingLabel = status === 'thinking' ? getReviewingLabel(id) : undefined;

            return (
              <CouncilSeat
                key={id}
                provider={id}
                label={label}
                color={color}
                role={role}
                response={resp?.text ?? null}
                liveText={liveProviderTokens?.[id]}
                thinkingMsg={providerThinkingMessages?.[id]}
                status={status}
                errorMsg={providerErrors?.[id]}
                agreeing={agreementMap[id] ?? null}
                thinking={!!(thinking && isActive && !hasError)}
                isSelected={selectedProvider === id}
                reviewingLabel={reviewingLabel}
                listening={listening}
                onAgree={() => onAgreementChange(id, true)}
                onDisagree={() => onAgreementChange(id, false)}
                onProposeAlternative={() => onProposeAlternative(id)}
                onSelect={() => onSelectOutput(id)}
              />
            );
          })}
        </div>

        {/* Timeline — shown after thinking has started */}
        {(thinking || respondedProviders.length > 0 || latestMsg) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            marginTop: 10, padding: '6px 10px',
            border: '1px solid rgba(255,255,255,0.06)', borderRadius: 7,
            background: 'rgba(0,0,0,0.12)',
          }}>
            {TIMELINE_STAGES.map(({ id, label, color }, i) => {
              const stageOrder: TimelineStage[] = ['thinking', 'response', 'agreement', 'merge'];
              const currentIdx = stageOrder.indexOf(timelineStage);
              const stageIdx = stageOrder.indexOf(id);
              const isDone = stageIdx < currentIdx;
              const isCurrent = stageIdx === currentIdx;

              return (
                <React.Fragment key={id}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    opacity: isDone || isCurrent ? 1 : 0.28,
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: isDone || isCurrent ? color : 'rgba(255,255,255,0.15)',
                      boxShadow: isCurrent ? `0 0 6px ${color}` : 'none',
                      animation: isCurrent ? 'pulse 1.4s ease-in-out infinite' : 'none',
                      transition: 'all 0.4s',
                    }} />
                    <span style={{
                      fontSize: 8, fontWeight: isCurrent ? 800 : 600,
                      letterSpacing: '0.1em',
                      color: isCurrent ? color : isDone ? `${color}88` : 'rgba(255,255,255,0.2)',
                      transition: 'all 0.4s',
                    }}>
                      {label}
                    </span>
                  </div>
                  {i < TIMELINE_STAGES.length - 1 && (
                    <div style={{
                      flex: 1, height: 1, margin: '0 6px',
                      background: isDone
                        ? `linear-gradient(90deg, ${color}66, ${TIMELINE_STAGES[i + 1].color}44)`
                        : 'rgba(255,255,255,0.07)',
                      transition: 'background 0.6s',
                    }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
