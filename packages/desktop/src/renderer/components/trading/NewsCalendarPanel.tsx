// ── renderer/components/trading/NewsCalendarPanel.tsx ─────────────────────────
//
// Upcoming economic events with tier badges, buffer windows, and
// blocked-state indicators. Data comes from simulator state — no
// direct IPC calls.
//
// Props-driven. Local type mirrors only.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface NewsEventView {
  time: number;
  title: string;
  tier: 'top' | 'medium' | 'low';
  bufferMinutesBefore: number;
  bufferMinutesAfter: number;
}

interface NewsRiskContextView {
  hasActiveRisk: boolean;
  blocked: boolean;
  reason: string;
  nearbyEvents: NewsEventView[];
  scoreAdjustment: number;
  riskFlags: string[];
}

interface NewsCalendarPanelProps {
  newsContext: NewsRiskContextView | null;
}

// ── Component ───────────────────────────────────────────────────────────────

export function NewsCalendarPanel({ newsContext }: NewsCalendarPanelProps) {
  if (!newsContext) {
    return (
      <div style={p.card}>
        <div style={p.cardTitle}>NEWS CALENDAR</div>
        <div style={p.empty}>No news calendar data available. The calendar loads when the simulator is active.</div>
      </div>
    );
  }

  const events = newsContext.nearbyEvents;
  const now = Date.now();

  return (
    <div style={p.card}>
      <div style={p.cardTitle}>NEWS CALENDAR</div>

      {/* ── Active Block Banner ── */}
      {newsContext.blocked && (
        <div style={p.blockBanner}>
          <div style={p.blockIcon}>BLOCKED</div>
          <div style={p.blockReason}>{newsContext.reason}</div>
        </div>
      )}

      {/* ── Score Adjustment ── */}
      {!newsContext.blocked && newsContext.scoreAdjustment < 0 && (
        <div style={p.downgradeBanner}>
          Score adjustment: {newsContext.scoreAdjustment} — trade scores reduced due to nearby events.
        </div>
      )}

      {/* ── Risk Flags ── */}
      {newsContext.riskFlags.length > 0 && !newsContext.blocked && (
        <div style={p.flagsBox}>
          {newsContext.riskFlags.map((flag, i) => (
            <div key={i} style={p.flagItem}>{flag}</div>
          ))}
        </div>
      )}

      {/* ── Events List ── */}
      {events.length === 0 && !newsContext.blocked && (
        <div style={p.empty}>No upcoming events in the current window.</div>
      )}

      {events.length > 0 && (
        <div style={p.eventList}>
          {events.map((ev, i) => {
            const minutesUntil = (ev.time - now) / 60_000;
            const isPast = minutesUntil < 0;
            const isImminent = !isPast && minutesUntil <= ev.bufferMinutesBefore;
            return (
              <div key={i} style={{ ...p.eventRow, ...(isImminent ? p.eventImminent : {}), ...(isPast ? p.eventPast : {}) }}>
                <span style={tierBadgeStyle(ev.tier)}>
                  {ev.tier.toUpperCase()}
                </span>
                <span style={p.eventTitle}>{ev.title}</span>
                <span style={p.eventTime}>
                  {isPast
                    ? `${Math.abs(Math.round(minutesUntil))}m ago`
                    : `in ${Math.round(minutesUntil)}m`}
                </span>
                <span style={p.eventBuffer}>
                  {ev.bufferMinutesBefore}m / {ev.bufferMinutesAfter}m
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tierBadgeStyle(tier: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    top:    { bg: 'rgba(248,113,113,0.12)', fg: '#f87171', border: 'rgba(248,113,113,0.3)' },
    medium: { bg: 'rgba(251,191,36,0.1)',   fg: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
    low:    { bg: 'rgba(255,255,255,0.04)', fg: 'rgba(255,255,255,0.35)', border: 'rgba(255,255,255,0.12)' },
  };
  const c = colors[tier] ?? colors.low;
  return {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
    borderRadius: 3, padding: '1px 6px', flexShrink: 0,
  };
}

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:           { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:      { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  empty:          { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },

  // Block banner — prominent red when entries are blocked
  blockBanner:    { display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 6, padding: '10px 14px' },
  blockIcon:      { fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: '#f87171', background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 3, padding: '2px 7px', flexShrink: 0 },
  blockReason:    { fontSize: 11, color: '#f87171', lineHeight: 1.5 },

  // Downgrade banner — amber when scores are reduced
  downgradeBanner:{ fontSize: 11, color: 'rgba(251,191,36,0.8)', background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 },

  // Risk flags
  flagsBox:       { display: 'flex', flexDirection: 'column', gap: 4 },
  flagItem:       { fontSize: 10, color: 'rgba(251,191,36,0.7)', paddingLeft: 8, borderLeft: '2px solid rgba(251,191,36,0.2)' },

  // Event list
  eventList:      { display: 'flex', flexDirection: 'column', gap: 4 },
  eventRow:       { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.02)' },
  eventImminent:  { background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.12)' },
  eventPast:      { opacity: 0.5 },
  eventTitle:     { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.7)', flex: 1 },
  eventTime:      { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 60, textAlign: 'right' },
  eventBuffer:    { fontSize: 9, color: 'rgba(255,255,255,0.2)', flexShrink: 0, minWidth: 55, textAlign: 'right' },
};
