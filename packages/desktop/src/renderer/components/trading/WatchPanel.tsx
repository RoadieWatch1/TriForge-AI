// ── WatchPanel.tsx ────────────────────────────────────────────────────────────
//
// Watch alerts display for the level-to-level engine inspector.
// Shows state machine progression, confirmation signals, and progress.
// Read-only. No engine imports — local type mirrors only.

import React from 'react';

// ── Local type mirrors ───────────────────────────────────────────────────────

type WatchState = 'idle' | 'watching' | 'confirming' | 'confirmed' | 'rejected';

interface WatchLevelView {
  type: string; price: number; label?: string; qualityScore: number;
}

interface WatchRouteView {
  direction: string;
  toLevel: { type: string; price: number };
}

interface ConfirmationSignalView {
  type: string; weight: number; detected: boolean;
}

interface WatchAlertView {
  id: string;
  state: WatchState;
  level: WatchLevelView;
  route?: WatchRouteView;
  createdAt: number;
  arrivedAt?: number;
  confirmationScore?: number;
  confirmations?: ConfirmationSignalView[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<WatchState, { label: string; color: string; bg: string }> = {
  idle:        { label: 'IDLE',        color: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.04)' },
  watching:    { label: 'WATCHING',    color: '#fbbf24',              bg: 'rgba(251,191,36,0.08)' },
  confirming:  { label: 'CONFIRMING',  color: '#60a5fa',              bg: 'rgba(96,165,250,0.08)' },
  confirmed:   { label: 'CONFIRMED',   color: '#34d399',              bg: 'rgba(52,211,153,0.08)' },
  rejected:    { label: 'REJECTED',    color: '#f87171',              bg: 'rgba(248,113,113,0.08)' },
};

function formatPrice(price: number): string {
  return price >= 1000
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
}

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').toUpperCase();
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function WatchPanel({ watches }: { watches: WatchAlertView[] }) {
  if (!watches || watches.length === 0) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>Watch Alerts</div>
        <div style={s.empty}>No active watches</div>
      </div>
    );
  }

  // Sort: confirmed first, then confirming, watching, idle, rejected last
  const stateOrder: Record<WatchState, number> = {
    confirmed: 0, confirming: 1, watching: 2, idle: 3, rejected: 4,
  };
  const sorted = [...watches].sort((a, b) => stateOrder[a.state] - stateOrder[b.state]);

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>
        Watch Alerts
        <span style={s.watchCount}>{watches.length} active</span>
      </div>

      <div style={s.watchList}>
        {sorted.map(watch => (
          <WatchCard key={watch.id} watch={watch} />
        ))}
      </div>
    </div>
  );
}

function WatchCard({ watch }: { watch: WatchAlertView }) {
  const stateConfig = STATE_CONFIG[watch.state];
  const score = watch.confirmationScore ?? 0;
  const signals = watch.confirmations ?? [];
  const detected = signals.filter(sig => sig.detected);
  const showProgress = watch.state === 'confirming' || watch.state === 'confirmed';

  return (
    <div style={{ ...s.watchCard, borderColor: `${stateConfig.color}33` }}>
      {/* Header: state badge + level info */}
      <div style={s.watchHeader}>
        <span style={{ ...s.stateBadge, color: stateConfig.color, background: stateConfig.bg, borderColor: `${stateConfig.color}40` }}>
          {stateConfig.label}
        </span>
        <span style={s.watchLevel}>
          {formatPrice(watch.level.price)} — {typeLabel(watch.level.type)}
        </span>
        <span style={s.watchQuality}>Q{Math.round(watch.level.qualityScore)}</span>
      </div>

      {/* Route destination */}
      {watch.route && (
        <div style={s.watchRoute}>
          Target: {formatPrice(watch.route.toLevel.price)} {typeLabel(watch.route.toLevel.type)} ({watch.route.direction})
        </div>
      )}

      {/* Confirmation progress bar */}
      {showProgress && (
        <div style={s.progressRow}>
          <div style={s.progressBarBg}>
            <div style={{
              ...s.progressBarFill,
              width: `${Math.min(100, score)}%`,
              background: score >= 65 ? '#34d399' : score >= 40 ? '#fbbf24' : '#f87171',
            }} />
          </div>
          <span style={{ ...s.progressLabel, color: score >= 65 ? '#34d399' : score >= 40 ? '#fbbf24' : '#f87171' }}>
            {Math.round(score)}/100
          </span>
        </div>
      )}

      {/* Detected confirmation signals */}
      {detected.length > 0 && (
        <div style={s.signalList}>
          {detected.map((sig, i) => (
            <span key={i} style={s.signalTag}>
              {sig.type.replace(/_/g, ' ')} ({sig.weight})
            </span>
          ))}
        </div>
      )}

      {/* Timing info */}
      <div style={s.watchTiming}>
        {watch.arrivedAt ? `Arrived ${timeAgo(watch.arrivedAt)}` : `Created ${timeAgo(watch.createdAt)}`}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 8 },
  watchCount:  { fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  empty:       { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', padding: '8px 0' },

  watchList:   { display: 'flex', flexDirection: 'column', gap: 8 },
  watchCard:   { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  watchHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  stateBadge:  { fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', border: '1px solid', borderRadius: 3, padding: '1px 5px' },
  watchLevel:  { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },
  watchQuality:{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' },

  watchRoute:  { fontSize: 10, color: 'rgba(255,255,255,0.35)' },

  progressRow: { display: 'flex', alignItems: 'center', gap: 8 },
  progressBarBg:{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' },
  progressBarFill:{ height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  progressLabel:{ fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' },

  signalList:  { display: 'flex', gap: 4, flexWrap: 'wrap' },
  signalTag:   { fontSize: 8, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3, padding: '1px 5px' },

  watchTiming: { fontSize: 9, color: 'rgba(255,255,255,0.15)' },
};
