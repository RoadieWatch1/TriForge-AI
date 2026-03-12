// ── SessionContextPanel.tsx ───────────────────────────────────────────────────
//
// Compact session context strip for the level-to-level engine inspector.
// Shows current trading window, time remaining, and session score.
// Read-only. No engine imports — local type mirrors only.

import React from 'react';

// ── Local type mirrors ───────────────────────────────────────────────────────

interface SessionContextView {
  isActive: boolean;
  isPrime: boolean;
  isReduced: boolean;
  isPreMap: boolean;
  minutesUntilClose: number;
  sessionScore?: number;
  windowLabel?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveWindow(session: SessionContextView): { label: string; color: string; bg: string } {
  if (!session.isActive)  return { label: 'CLOSED',   color: '#f87171',              bg: 'rgba(248,113,113,0.08)' };
  if (session.isPreMap)   return { label: 'PRE-MAP',  color: '#60a5fa',              bg: 'rgba(96,165,250,0.08)' };
  if (session.isPrime)    return { label: 'PRIME',    color: '#34d399',              bg: 'rgba(52,211,153,0.08)' };
  if (session.isReduced)  return { label: 'REDUCED',  color: '#fbbf24',              bg: 'rgba(251,191,36,0.08)' };
  return                          { label: 'OPENING',  color: '#fb923c',              bg: 'rgba(251,146,60,0.08)' };
}

// ── Component ────────────────────────────────────────────────────────────────

export function SessionContextPanel({ session }: { session: SessionContextView | null }) {
  if (!session) {
    return (
      <div style={s.strip}>
        <span style={s.inactiveLabel}>Session data unavailable</span>
      </div>
    );
  }

  const window = resolveWindow(session);
  const displayLabel = session.windowLabel ?? window.label;
  const minutes = session.minutesUntilClose;
  const timeLabel = minutes > 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;

  return (
    <div style={s.strip}>
      <span style={{ ...s.windowBadge, color: window.color, background: window.bg, borderColor: `${window.color}40` }}>
        {displayLabel}
      </span>
      {session.isActive && (
        <span style={s.timeLeft}>{timeLabel} until close</span>
      )}
      {session.sessionScore !== undefined && session.sessionScore !== null && (
        <span style={s.sessionScore}>Score: {Math.round(session.sessionScore)}</span>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  strip:        { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' },
  windowBadge:  { fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', border: '1px solid', borderRadius: 4, padding: '2px 7px' },
  timeLeft:     { fontSize: 10, color: 'rgba(255,255,255,0.35)' },
  sessionScore: { fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' },
  inactiveLabel:{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' },
};
