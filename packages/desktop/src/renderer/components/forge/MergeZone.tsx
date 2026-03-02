import React, { useState, useEffect, useRef } from 'react';

// Inject keyframe animations once at module load
if (typeof document !== 'undefined' && !document.getElementById('merge-zone-css')) {
  const s = document.createElement('style');
  s.id = 'merge-zone-css';
  s.textContent = `
    @keyframes mz-entrance {
      from { transform: scale(0.97); opacity: 0.5; }
      to   { transform: scale(1);    opacity: 1;   }
    }
    @keyframes mz-scale-pop {
      0%   { transform: scale(0.95); opacity: 0.6; }
      55%  { transform: scale(1.025); opacity: 1;  }
      100% { transform: scale(1);    opacity: 1;   }
    }
    @keyframes mz-consensus-glow {
      0%, 100% { box-shadow: 0 0 18px rgba(16,185,129,0.1);  }
      50%      { box-shadow: 0 0 44px rgba(16,185,129,0.32); }
    }
    @keyframes mz-border-flash {
      0%   { border-color: rgba(16,185,129,0.25); }
      35%  { border-color: rgba(16,185,129,0.75); }
      100% { border-color: rgba(16,185,129,0.38); }
    }
    @keyframes mz-text-cycle {
      0%, 100% { opacity: 0; transform: translateY(4px); }
      15%, 80%  { opacity: 1; transform: translateY(0);  }
    }
    @keyframes mz-authority {
      0%   { opacity: 0; transform: translateY(-5px); }
      18%  { opacity: 1; transform: translateY(0);    }
      78%  { opacity: 1; transform: translateY(0);    }
      100% { opacity: 0; transform: translateY(-3px); }
    }
    @keyframes mz-idle-pulse {
      0%,100% { opacity: 0.05; }
      50%     { opacity: 0.12; }
    }
  `;
  document.head.appendChild(s);
}

interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
}

interface Props {
  synthesis: string | null;
  agreementCount: number;
  totalProviders: number;
  thinking: boolean;
  forgeScore?: ForgeScore;
}

const RISK_COLORS: Record<string, string> = {
  Low: '#10a37f',
  Medium: '#f59e0b',
  High: '#ef4444',
};

const LAYER_MESSAGES = (count: number, total: number): string[] => [
  '⬡  Council Decision Ready',
  `Consensus: ${count} of ${total} minds aligned`,
  'Validated by multi-model agreement',
];

export function MergeZone({ synthesis, agreementCount, totalProviders, thinking, forgeScore }: Props) {
  const [showLayers, setShowLayers] = useState(false);
  const [displayedConsensus, setDisplayedConsensus] = useState(false);
  const [layerIdx, setLayerIdx] = useState(0);
  const prevSynthesisRef = useRef<string | null>(null);

  // Cycle layer messages while showLayers is active
  useEffect(() => {
    if (!showLayers) { setLayerIdx(0); return; }
    const id = setInterval(() => setLayerIdx(i => (i + 1) % 3), 1600);
    return () => clearInterval(id);
  }, [showLayers]);

  // Trigger layered messages + delayed consensus animation when synthesis first arrives
  useEffect(() => {
    if (synthesis && !prevSynthesisRef.current) {
      const t1 = setTimeout(() => {
        setDisplayedConsensus(true);
        setShowLayers(true);
      }, 400);
      const t2 = setTimeout(() => setShowLayers(false), 5400);
      prevSynthesisRef.current = synthesis;
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (synthesis) prevSynthesisRef.current = synthesis;
    if (!synthesis) {
      setShowLayers(false);
      setDisplayedConsensus(false);
      setLayerIdx(0);
      prevSynthesisRef.current = null;
    }
  }, [synthesis]);

  const hasConsensus = agreementCount >= 2;
  const riskColor = forgeScore ? (RISK_COLORS[forgeScore.risk] ?? '#f59e0b') : null;
  const barColor = forgeScore
    ? forgeScore.confidence >= 75 ? '#10a37f' : forgeScore.confidence >= 50 ? '#f59e0b' : '#ef4444'
    : '#6366f1';

  // Idle state — no query yet
  if (!synthesis && !thinking) {
    return (
      <div style={{ ...mz.base, ...mz.idle }}>
        <div style={{
          fontSize: 28, marginBottom: 6,
          animation: 'mz-idle-pulse 3.5s ease-in-out infinite',
        }}>⬡</div>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase' as const }}>
          MERGE ZONE
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 5 }}>
          Submit a prompt to initiate the Think Tank
        </div>
      </div>
    );
  }

  // Thinking state
  if (thinking) {
    return (
      <div style={{ ...mz.base, ...mz.deliberating }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0, 0.2, 0.4].map((d, i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--accent)',
                animation: `pulse 1.2s ease-in-out ${d}s infinite`,
              }} />
            ))}
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>
            COUNCIL DELIBERATING
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Waiting for {totalProviders} AIs…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative' as const,
      borderRadius: 10, padding: '12px 16px', marginBottom: 10,
      transition: 'background 0.4s, border-color 0.4s',
      ...(displayedConsensus && hasConsensus ? {
        background: 'linear-gradient(160deg, rgba(16,185,129,0.07) 0%, rgba(16,185,129,0.03) 100%)',
        border: '1px solid rgba(16,185,129,0.38)',
        animation: 'mz-scale-pop 0.5s ease-out, mz-consensus-glow 3s ease-in-out 0.5s 2, mz-border-flash 1.2s ease-out',
      } : hasConsensus ? {
        background: 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.25)',
        animation: 'mz-entrance 0.4s ease-out',
      } : {
        background: 'rgba(245,158,11,0.05)',
        border: '1px solid rgba(245,158,11,0.2)',
        animation: 'mz-entrance 0.4s ease-out',
      }),
    }}>

      {/* Layered cycling messages — Council Decision Ready, etc. */}
      {showLayers && hasConsensus && (
        <div style={{ textAlign: 'center' as const, marginBottom: 8, height: 22, overflow: 'hidden' }}>
          <div
            key={layerIdx}
            style={{
              fontSize: layerIdx === 0 ? 10 : 9,
              fontWeight: layerIdx === 0 ? 800 : 700,
              color: layerIdx === 0 ? '#10b981' : 'rgba(16,185,129,0.75)',
              letterSpacing: layerIdx === 0 ? '0.14em' : '0.07em',
              textTransform: layerIdx === 0 ? 'uppercase' as const : 'none' as const,
              animation: 'mz-text-cycle 1.6s ease-in-out forwards',
            }}
          >
            {LAYER_MESSAGES(agreementCount, totalProviders)[layerIdx]}
          </div>
        </div>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 15, opacity: hasConsensus ? 0.9 : 0.5, marginTop: 1 }}>⬡</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '0.05em',
            color: hasConsensus ? '#10b981' : '#f59e0b',
          }}>
            {hasConsensus ? 'COUNCIL DECISION READY' : 'COUNCIL IS DIVIDED'}
          </span>
          <span style={{
            fontSize: 9, letterSpacing: '0.04em',
            color: hasConsensus ? 'rgba(16,185,129,0.55)' : 'rgba(245,158,11,0.5)',
          }}>
            {hasConsensus
              ? `${agreementCount} of ${totalProviders} minds in agreement`
              : `${agreementCount} of ${totalProviders} agreeing`}
          </span>
        </div>
        {forgeScore && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <span style={{ ...chip, color: barColor }}>{forgeScore.confidence}% conf</span>
            {riskColor && <span style={{ ...chip, color: riskColor }}>{forgeScore.risk} risk</span>}
          </div>
        )}
      </div>

      {/* Confidence bar with label */}
      {forgeScore && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, fontWeight: 700, letterSpacing: '0.09em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase' as const, marginBottom: 3 }}>
            <span>Confidence Level</span>
            <span style={{ color: barColor }}>{forgeScore.confidence}%</span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{
              height: '100%', width: `${forgeScore.confidence}%`, background: barColor,
              borderRadius: 2, transition: 'width 0.8s ease',
              boxShadow: `0 0 6px ${barColor}66`,
            }} />
          </div>
        </>
      )}

      {/* Content */}
      {hasConsensus ? (
        <>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(16,185,129,0.45)', textTransform: 'uppercase' as const, marginBottom: 5 }}>
            Final Decision · Selected by the Think Tank
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {synthesis?.slice(0, 500)}{(synthesis?.length ?? 0) > 500 ? '…' : ''}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
          Council is divided — select a direction or request an alternative.
        </div>
      )}

      {/* "Why this was chosen" — score details */}
      {forgeScore && hasConsensus && (forgeScore.agreement || forgeScore.disagreement) && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {forgeScore.agreement && (
            <div style={{ marginBottom: forgeScore.disagreement ? 5 : 0 }}>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase' as const, marginBottom: 3 }}>
                Why this was chosen
              </div>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                <strong style={{ color: '#10b981' }}>✓ </strong>{forgeScore.agreement.slice(0, 120)}
              </span>
            </div>
          )}
          {forgeScore.disagreement && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
              <strong style={{ color: '#f59e0b' }}>≠ </strong>{forgeScore.disagreement.slice(0, 80)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const mz: Record<string, React.CSSProperties> = {
  base: { borderRadius: 10, padding: '12px 16px', marginBottom: 10, transition: 'all 0.4s' },
  idle: {
    background: 'rgba(99,102,241,0.04)', border: '1px dashed rgba(99,102,241,0.14)',
    textAlign: 'center', padding: '18px 16px',
  },
  deliberating: {
    background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)',
  },
};

const chip: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
};
