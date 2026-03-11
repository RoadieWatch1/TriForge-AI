// ── RoutePanel.tsx ────────────────────────────────────────────────────────────
//
// Path prediction and route display for the level-to-level engine inspector.
// Read-only. No engine imports — local type mirrors only.

import React, { useState } from 'react';

// ── Local type mirrors ───────────────────────────────────────────────────────

interface RouteLevelView {
  type: string; price: number; label?: string; qualityScore: number;
}

interface RouteView {
  id: string;
  fromLevel: RouteLevelView;
  toLevel: RouteLevelView;
  direction: 'up' | 'down';
  distancePoints: number;
  qualityScore: number;
  qualityFactors?: Record<string, number>;
}

interface PathPredictionView {
  direction: 'up' | 'down';
  bias: string;
  confidence: number;
  primaryRoute?: RouteView;
  alternateRoutes?: RouteView[];
  timestamp: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return price >= 1000
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
}

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').toUpperCase();
}

const FACTOR_LABELS: Record<string, string> = {
  destination_clarity:   'Dest Clarity',
  clean_space:           'Clean Space',
  congestion_penalty:    'Congestion',
  destination_liquidity: 'Dest Liquidity',
  session_alignment:     'Session',
  htf_alignment:         'HTF Align',
};

// ── Component ────────────────────────────────────────────────────────────────

export function RoutePanel({ prediction }: { prediction: PathPredictionView | null }) {
  const [showAlts, setShowAlts] = useState(false);

  if (!prediction) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>Path Prediction</div>
        <div style={s.empty}>No clear path predicted</div>
      </div>
    );
  }

  const dirArrow = prediction.direction === 'up' ? '\u25B2' : '\u25BC';
  const dirColor = prediction.direction === 'up' ? '#34d399' : '#f87171';
  const confColor = prediction.confidence >= 70 ? '#34d399' : prediction.confidence >= 50 ? '#fbbf24' : '#f87171';
  const alts = prediction.alternateRoutes ?? [];
  const predTime = new Date(prediction.timestamp).toLocaleTimeString();

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>
        Path Prediction
        <span style={s.predTime}>Updated {predTime}</span>
      </div>

      {/* Direction strip */}
      <div style={s.dirStrip}>
        <span style={{ ...s.dirArrow, color: dirColor }}>{dirArrow}</span>
        <span style={{ ...s.dirLabel, color: dirColor }}>{prediction.direction.toUpperCase()}</span>
        <span style={s.biasLabel}>{prediction.bias}</span>
        <span style={{ ...s.confBadge, color: confColor, borderColor: confColor }}>
          {Math.round(prediction.confidence)}% conf
        </span>
      </div>

      {/* Primary route */}
      {prediction.primaryRoute && (
        <RouteCard route={prediction.primaryRoute} label="Primary Route" />
      )}

      {/* Alternate routes */}
      {alts.length > 0 && (
        <>
          <button style={s.altToggle} onClick={() => setShowAlts(v => !v)}>
            {showAlts ? 'Hide' : `Show ${alts.length}`} alternate route{alts.length !== 1 ? 's' : ''}
          </button>
          {showAlts && alts.map(route => (
            <RouteCard key={route.id} route={route} label="Alternate" />
          ))}
        </>
      )}
    </div>
  );
}

function RouteCard({ route, label }: { route: RouteView; label: string }) {
  const dirColor = route.direction === 'up' ? '#34d399' : '#f87171';
  const factors = route.qualityFactors ?? {};
  const factorEntries = Object.entries(factors);

  return (
    <div style={s.routeCard}>
      <div style={s.routeHeader}>
        <span style={s.routeLabel}>{label}</span>
        <span style={s.routeScore}>Quality: {Math.round(route.qualityScore)}</span>
      </div>
      <div style={s.routePath}>
        <span style={s.routeLevel}>
          {formatPrice(route.fromLevel.price)} <span style={s.routeType}>{typeLabel(route.fromLevel.type)}</span>
        </span>
        <span style={{ ...s.routeArrow, color: dirColor }}>
          {route.direction === 'up' ? '\u2192 \u25B2' : '\u2192 \u25BC'}
        </span>
        <span style={s.routeLevel}>
          {formatPrice(route.toLevel.price)} <span style={s.routeType}>{typeLabel(route.toLevel.type)}</span>
        </span>
      </div>
      <div style={s.routeMeta}>
        <span>Distance: {route.distancePoints.toFixed(1)} pts</span>
      </div>
      {factorEntries.length > 0 && (
        <div style={s.factorsGrid}>
          {factorEntries.map(([key, value]) => (
            <div key={key} style={s.factorRow}>
              <span style={s.factorLabel}>{FACTOR_LABELS[key] ?? key}</span>
              <div style={s.factorBarBg}>
                <div style={{ ...s.factorBarFill, width: `${Math.min(100, value)}%` }} />
              </div>
              <span style={s.factorValue}>{Math.round(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 8 },
  predTime:    { fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  empty:       { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', padding: '8px 0' },

  dirStrip:    { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' },
  dirArrow:    { fontSize: 16, fontWeight: 800 },
  dirLabel:    { fontSize: 12, fontWeight: 800, letterSpacing: '0.06em' },
  biasLabel:   { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  confBadge:   { fontSize: 9, fontWeight: 700, border: '1px solid', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto' },

  routeCard:   { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  routeHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  routeLabel:  { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)' },
  routeScore:  { fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.4)' },
  routePath:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  routeLevel:  { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },
  routeType:   { fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginLeft: 4 },
  routeArrow:  { fontSize: 12, fontWeight: 700 },
  routeMeta:   { fontSize: 10, color: 'rgba(255,255,255,0.3)', display: 'flex', gap: 12 },

  altToggle:   { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: 10, cursor: 'pointer', padding: '2px 0', textAlign: 'left', fontFamily: 'inherit' },

  factorsGrid: { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 },
  factorRow:   { display: 'flex', alignItems: 'center', gap: 6 },
  factorLabel: { fontSize: 9, color: 'rgba(255,255,255,0.3)', minWidth: 80, flexShrink: 0 },
  factorBarBg: { flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' },
  factorBarFill:{ height: '100%', background: 'rgba(96,165,250,0.4)', borderRadius: 2, transition: 'width 0.3s' },
  factorValue: { fontSize: 9, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums', minWidth: 20, textAlign: 'right' },
};
