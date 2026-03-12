// ── LevelMapPanel.tsx ─────────────────────────────────────────────────────────
//
// Text-based level map display for the level-to-level engine inspector.
// Read-only. No engine imports — local type mirrors only.

import React from 'react';

// ── Local type mirrors ───────────────────────────────────────────────────────

interface PriceLevelView {
  id: string; type: string; price: number; priceHigh?: number;
  strength: number; touchCount: number; broken: boolean;
  label?: string; qualityScore: number;
}

interface LevelMapView {
  symbol: string; buildTime: number; levels: PriceLevelView[];
  currentPrice: number; nearestAbove?: PriceLevelView; nearestBelow?: PriceLevelView;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  supply:            '#f87171',
  demand:            '#34d399',
  swing_high:        'rgba(255,255,255,0.5)',
  swing_low:         'rgba(255,255,255,0.5)',
  fvg:               '#60a5fa',
  imbalance:         '#60a5fa',
  liquidity_pool:    '#c084fc',
  volume_poc:        '#fb923c',
  volume_vah:        '#fb923c',
  volume_val:        '#fb923c',
  session_high:      '#fbbf24',
  session_low:       '#fbbf24',
  prev_day_high:     '#fbbf24',
  prev_day_low:      '#fbbf24',
  overnight_high:    '#fbbf24',
  overnight_low:     '#fbbf24',
  opening_range_high:'#fbbf24',
  opening_range_low: '#fbbf24',
  displacement_origin:'#c084fc',
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? 'rgba(255,255,255,0.35)';
}

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').toUpperCase();
}

function qualityBand(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'A', color: '#34d399' };
  if (score >= 65) return { label: 'B', color: '#60a5fa' };
  if (score >= 50) return { label: 'C', color: '#fbbf24' };
  return { label: '—', color: 'rgba(255,255,255,0.2)' };
}

function formatPrice(price: number): string {
  return price >= 1000
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
}

// ── Component ────────────────────────────────────────────────────────────────

export function LevelMapPanel({ levelMap }: { levelMap: LevelMapView | null }) {
  if (!levelMap) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>Level Map</div>
        <div style={s.empty}>No level map built yet</div>
      </div>
    );
  }

  // Sort levels descending by price (highest first)
  const sorted = [...levelMap.levels]
    .filter(l => !l.broken)
    .sort((a, b) => b.price - a.price);

  const brokenLevels = levelMap.levels.filter(l => l.broken);

  // Find where current price falls
  const aboveIdx = sorted.findIndex(l => l.price <= levelMap.currentPrice);
  const levelsAbove = aboveIdx === -1 ? sorted : sorted.slice(0, aboveIdx);
  const levelsBelow = aboveIdx === -1 ? [] : sorted.slice(aboveIdx);

  const nearAboveId = levelMap.nearestAbove?.id;
  const nearBelowId = levelMap.nearestBelow?.id;

  const buildTime = new Date(levelMap.buildTime).toLocaleTimeString();

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>
        Level Map — {levelMap.symbol}
        <span style={s.buildTime}>Built {buildTime}</span>
        <span style={s.levelCount}>{levelMap.levels.length} levels</span>
      </div>

      <div style={s.mapContainer}>
        {levelsAbove.map(level => (
          <LevelRow key={level.id} level={level} isNearest={level.id === nearAboveId} />
        ))}

        {/* Current price marker */}
        <div style={s.priceMarker}>
          {'>>>>>>>'}  {formatPrice(levelMap.currentPrice)}  CURRENT PRICE  {'<<<<<<<<'}
        </div>

        {levelsBelow.map(level => (
          <LevelRow key={level.id} level={level} isNearest={level.id === nearBelowId} />
        ))}
      </div>

      {brokenLevels.length > 0 && (
        <div style={s.brokenSection}>
          <span style={s.brokenLabel}>Broken ({brokenLevels.length})</span>
          {brokenLevels.slice(0, 5).map(l => (
            <span key={l.id} style={s.brokenItem}>
              {formatPrice(l.price)} {typeLabel(l.type)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LevelRow({ level, isNearest }: { level: PriceLevelView; isNearest: boolean }) {
  const band = qualityBand(level.qualityScore);
  const color = typeColor(level.type);

  return (
    <div style={{
      ...s.levelRow,
      ...(isNearest ? s.nearestRow : {}),
    }}>
      <span style={{ ...s.levelPrice, color }}>{formatPrice(level.price)}</span>
      <span style={{ ...s.levelType, color }}>{typeLabel(level.type)}</span>
      <span style={s.levelDetail}>
        {level.label ?? `${level.touchCount} touch${level.touchCount !== 1 ? 'es' : ''}`}
      </span>
      <span style={s.levelScore}>{Math.round(level.qualityScore)}</span>
      <span style={{ ...s.levelBand, color: band.color, borderColor: band.color }}>[{band.label}]</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 8 },
  buildTime:   { fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  levelCount:  { fontSize: 9, color: 'rgba(255,255,255,0.15)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  empty:       { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', padding: '8px 0' },
  mapContainer:{ display: 'flex', flexDirection: 'column', gap: 0 },
  priceMarker: { fontSize: 10, fontWeight: 800, color: '#fbbf24', textAlign: 'center', padding: '6px 0', borderTop: '1px dashed rgba(251,191,36,0.3)', borderBottom: '1px dashed rgba(251,191,36,0.3)', margin: '2px 0', letterSpacing: '0.06em', fontFamily: 'inherit' },
  levelRow:    { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 11 },
  nearestRow:  { background: 'rgba(255,255,255,0.04)', borderLeft: '2px solid rgba(96,165,250,0.4)' },
  levelPrice:  { fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 70, flexShrink: 0 },
  levelType:   { fontSize: 9, fontWeight: 600, letterSpacing: '0.04em', minWidth: 90, flexShrink: 0 },
  levelDetail: { fontSize: 10, color: 'rgba(255,255,255,0.3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  levelScore:  { fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right' },
  levelBand:   { fontSize: 9, fontWeight: 800, border: '1px solid', borderRadius: 3, padding: '0 4px', flexShrink: 0 },
  brokenSection:{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  brokenLabel: { fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.15)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  brokenItem:  { fontSize: 9, color: 'rgba(255,255,255,0.15)', textDecoration: 'line-through' },
};
