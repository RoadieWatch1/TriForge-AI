import React, { useState } from 'react';

// Inject button animation CSS once
if (typeof document !== 'undefined' && !document.getElementById('council-seat-css')) {
  const s = document.createElement('style');
  s.id = 'council-seat-css';
  s.textContent = `
    .cs-btn:active { transform: scale(0.97) !important; }
    .cs-btn { transition: all 0.15s !important; }
    @keyframes cs-review-blink {
      0%, 100% { opacity: 0.7; }
      50%       { opacity: 1;   }
    }
    @keyframes cs-agree-pop {
      0%   { transform: scale(1);    }
      40%  { transform: scale(1.03); }
      100% { transform: scale(1);    }
    }
    @keyframes cs-listen-pulse {
      0%, 100% { box-shadow: 0 0 0 0px rgba(99,179,237,0.55); }
      50%       { box-shadow: 0 0 0 7px rgba(99,179,237,0);    }
    }
  `;
  document.head.appendChild(s);
}

// Disagree prefix per role
const DISAGREE_PREFIX: Record<string, string> = {
  Analyst:    'I have concerns about this approach. ',
  Strategist: 'Structurally, this can be improved. ',
  Disruptor:  'This is too conservative. ',
};

interface Props {
  provider: string;
  label: string;
  color: string;
  role?: string;                // e.g. "Analyst", "Strategist", "Disruptor"
  response: string | null;
  /** Live streaming tokens during the thinking phase — shown before final response arrives */
  liveText?: string;
  /** Council Awareness message shown while thinking but before tokens arrive */
  thinkingMsg?: string;
  status: 'idle' | 'thinking' | 'responded' | 'error';
  errorMsg?: string;
  agreeing: boolean | null;     // null = neutral, true = agrees, false = disagrees
  thinking: boolean;
  isSelected: boolean;
  reviewingLabel?: string;      // label of a provider already responded (for cross-review text)
  onAgree: () => void;
  onDisagree: () => void;
  onProposeAlternative: () => void;
  onSelect: () => void;
  /** When true, plays a brief blue pulse ring — council is in wake-word listening mode. */
  listening?: boolean;
}

export function CouncilSeat({
  label, color, role, response, liveText, thinkingMsg, status, errorMsg, agreeing, thinking,
  isSelected, reviewingLabel, listening,
  onAgree, onDisagree, onProposeAlternative, onSelect,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const TRUNCATE = 280;

  // Inject disagree prefix visually when AI disagrees
  const disagreePrefix = (agreeing === false && response && role)
    ? (DISAGREE_PREFIX[role] ?? '')
    : '';

  const rawDisplay = response
    ? (expanded ? response : response.slice(0, TRUNCATE) + (response.length > TRUNCATE ? '…' : ''))
    : null;
  const displayText = rawDisplay ? (disagreePrefix + rawDisplay) : null;

  const hasResponse = status === 'responded';
  const isNeutral = agreeing === null || agreeing === undefined;

  const borderColor = hasResponse
    ? isNeutral ? 'rgba(255,255,255,0.14)'
      : agreeing ? `${color}66`
      : 'rgba(239,68,68,0.35)'
    : 'var(--border)';

  const bgGlow = hasResponse && agreeing === true ? `${color}0d` : 'transparent';

  const hoverShadow = hovered
    ? (hasResponse && agreeing === true
        ? `0 8px 24px rgba(0,0,0,0.32), 0 0 18px ${color}18`
        : '0 8px 24px rgba(0,0,0,0.32)')
    : (hasResponse && agreeing === true ? `0 0 14px ${color}1a` : 'none');

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        background: `linear-gradient(160deg, ${bgGlow}, var(--bg-elevated))`,
        overflow: 'hidden',
        transition: 'border-color 0.35s, box-shadow 0.35s, transform 0.2s',
        boxShadow: hoverShadow,
        minHeight: 160,
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        animation: listening
          ? 'cs-listen-pulse 0.5s ease-out 1'
          : agreeing === true && hasResponse ? 'cs-agree-pop 0.3s ease-out' : 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
        borderBottom: '1px solid var(--border)',
        background: `${color}0a`,
        flexShrink: 0,
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: status !== 'idle' ? color : 'rgba(255,255,255,0.1)',
          flexShrink: 0,
          boxShadow: thinking ? `0 0 6px ${color}` : 'none',
        }} />

        {/* Name + personality role */}
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, gap: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: '0.06em' }}>{label}</span>
          {role && (
            <span style={{
              fontSize: 8, fontWeight: 600, letterSpacing: '0.1em',
              color: `${color}88`, textTransform: 'uppercase' as const,
            }}>
              {role}
            </span>
          )}
        </div>

        {/* Status badge */}
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
          textTransform: 'uppercase' as const, letterSpacing: '0.08em',
          background: hasResponse && agreeing === true
            ? 'rgba(16,185,129,0.12)'
            : hasResponse && agreeing === false
              ? 'rgba(239,68,68,0.1)'
              : hasResponse
                ? 'rgba(255,255,255,0.05)'
                : thinking
                  ? `${color}15`
                  : 'rgba(255,255,255,0.05)',
          color: hasResponse && agreeing === true
            ? '#10b981'
            : hasResponse && agreeing === false
              ? '#ef4444'
              : hasResponse
                ? 'rgba(255,255,255,0.3)'
                : thinking
                  ? color
                  : status === 'error'
                    ? '#ef4444'
                    : 'rgba(255,255,255,0.25)',
          border: `1px solid ${
            hasResponse && agreeing === true
              ? 'rgba(16,185,129,0.3)'
              : hasResponse && agreeing === false
                ? 'rgba(239,68,68,0.25)'
                : hasResponse
                  ? 'rgba(255,255,255,0.1)'
                  : thinking
                    ? `${color}30`
                    : 'rgba(255,255,255,0.08)'
          }`,
        }}>
          {thinking ? 'Thinking…'
            : hasResponse && agreeing === true ? 'Agrees'
            : hasResponse && agreeing === false ? 'Disagrees'
            : hasResponse ? 'Neutral'
            : status === 'error' ? 'Error'
            : 'Idle'}
        </span>

        {hasResponse && (
          <button
            className="cs-btn"
            style={{
              marginLeft: 'auto', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
              padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
              background: isSelected ? `${color}22` : 'none',
              border: `1px solid ${isSelected ? color : 'var(--border)'}`,
              color: isSelected ? color : 'var(--text-muted)',
            }}
            onClick={onSelect}
          >
            {isSelected ? '✓ SELECTED' : 'SELECT'}
          </button>
        )}
      </div>

      {/* Response body */}
      <div style={{ flex: 1, padding: '10px 12px', overflowY: 'auto', minHeight: 80 }}>
        {thinking && !liveText && (
          <div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '10px 0 6px' }}>
              {[0, 0.18, 0.36].map((delay, i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: color,
                  animation: `pulse 1.2s ease-in-out ${delay}s infinite`,
                }} />
              ))}
            </div>
            {/* Council Awareness — role-specific thinking message */}
            {thinkingMsg && !reviewingLabel && (
              <div style={{
                fontSize: 9, fontStyle: 'italic',
                color: `${color}99`,
                letterSpacing: '0.02em',
                animation: 'cs-review-blink 2s ease-in-out infinite',
              }}>
                {thinkingMsg}
              </div>
            )}
            {/* Cross-review text — shown when another AI has already responded */}
            {reviewingLabel && (
              <div style={{
                fontSize: 9, fontStyle: 'italic',
                color: `${color}99`,
                letterSpacing: '0.02em',
                animation: 'cs-review-blink 2s ease-in-out infinite',
              }}>
                Reviewing {reviewingLabel}'s position…
              </div>
            )}
          </div>
        )}

        {/* Live streaming tokens — shown while thinking and tokens are arriving */}
        {thinking && liveText && (
          <div style={{
            fontSize: 12, lineHeight: 1.65, color: `${color}cc`,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {liveText}
            <span style={{
              display: 'inline-block', width: 7, height: 13, marginLeft: 2,
              background: color, opacity: 0.7,
              animation: 'cs-review-blink 0.8s ease-in-out infinite',
              verticalAlign: 'text-bottom', borderRadius: 1,
            }} />
          </div>
        )}

        {!thinking && !response && status === 'error' && errorMsg && (
          <div style={{ fontSize: 11, color: '#ef4444', fontStyle: 'italic', textAlign: 'center', paddingTop: 16 }}>
            Failed — {errorMsg.length > 80 ? errorMsg.slice(0, 80) + '...' : errorMsg}
          </div>
        )}

        {!thinking && !response && status !== 'error' && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', fontStyle: 'italic', textAlign: 'center', paddingTop: 16 }}>
            Awaiting query
          </div>
        )}

        {displayText && (
          <div style={{
            fontSize: 12, lineHeight: 1.65, color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {disagreePrefix && (
              <span style={{ color: '#ef4444', fontStyle: 'italic' }}>{disagreePrefix}</span>
            )}
            {rawDisplay}
          </div>
        )}

        {response && response.length > TRUNCATE && (
          <button
            className="cs-btn"
            style={{ marginTop: 5, fontSize: 10, color, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? '▲ Collapse' : `▼ ${Math.ceil(response.length / 280)} more screens`}
          </button>
        )}
      </div>

      {/* Action bar */}
      {hasResponse && (
        <div style={{
          display: 'flex', gap: 4, padding: '7px 10px',
          borderTop: '1px solid var(--border)', flexShrink: 0,
          background: 'rgba(0,0,0,0.15)',
        }}>
          <button
            className="cs-btn"
            style={{ ...btn, ...(agreeing === true ? { background: 'rgba(16,185,129,0.14)', color: '#10b981', border: '1px solid rgba(16,185,129,0.32)' } : {}) }}
            onClick={onAgree}
            title="Mark as agreeing with consensus"
          >
            👍 Agree
          </button>
          <button
            className="cs-btn"
            style={{ ...btn, ...(agreeing === false ? { background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.28)' } : {}) }}
            onClick={onDisagree}
            title="Mark as disagreeing"
          >
            👎 Disagree
          </button>
          <button
            className="cs-btn"
            style={btn}
            onClick={onProposeAlternative}
            title="Ask this AI to propose an alternative"
          >
            🔁 Alt
          </button>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
  color: 'var(--text-secondary)', cursor: 'pointer',
};
