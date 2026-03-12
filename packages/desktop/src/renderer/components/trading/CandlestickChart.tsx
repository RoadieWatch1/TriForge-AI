// ── CandlestickChart.tsx ─────────────────────────────────────────────────────
//
// Canvas-based candlestick chart with volume histogram, price axis,
// time axis, current price line, trade level overlays, crosshair,
// hover OHLC HUD, level map overlays, and event markers.
// No external dependencies — pure HTML5 Canvas rendering.

import React, { useRef, useState, useEffect, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────

interface OhlcBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradeLevelOverlay {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  side: 'long' | 'short';
}

interface ChartLevel {
  price: number;
  type: string;
  strength: number;
  grade?: string;
}

interface ChartEvent {
  timestamp: number;
  type: 'approved' | 'rejected';
  side?: string;
  price?: number;
}

interface CandlestickChartProps {
  bars: OhlcBar[];
  timeframe: '1m' | '5m' | '15m';
  onTimeframeChange: (tf: '1m' | '5m' | '15m') => void;
  currentPrice?: number;
  symbol?: string;
  source?: 'tradovate' | 'simulated';
  feedFreshnessMs?: number;
  tradeOverlay?: TradeLevelOverlay | null;
  levels?: ChartLevel[];
  events?: ChartEvent[];
  height?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const PRICE_AXIS_W = 72;
const TIME_AXIS_H = 22;
const CHART_RATIO = 0.74;
const VOLUME_RATIO = 0.20;
const GAP_RATIO = 0.06;
const BAR_PAD = 0.28;
const MAX_VISIBLE = 80;
const GRID_LINES = 6;

const COL = {
  bg:         '#0d0d0f',
  grid:       'rgba(255,255,255,0.04)',
  axisText:   'rgba(255,255,255,0.3)',
  timeText:   'rgba(255,255,255,0.22)',
  up:         '#34d399',
  down:       '#f87171',
  volUp:      'rgba(52,211,153,0.25)',
  volDown:    'rgba(248,113,113,0.25)',
  priceLine:  '#60a5fa',
  entry:      '#fbbf24',
  stop:       '#f87171',
  target:     '#34d399',
  badge:      'rgba(255,255,255,0.06)',
  badgeText:  'rgba(255,255,255,0.35)',
  noData:     'rgba(255,255,255,0.15)',
  crosshair:  'rgba(255,255,255,0.15)',
  hudBg:      'rgba(0,0,0,0.75)',
  hudText:    'rgba(255,255,255,0.6)',
  levelDemand:'rgba(52,211,153,0.18)',
  levelSupply:'rgba(248,113,113,0.18)',
  levelOther: 'rgba(96,165,250,0.15)',
};

// ── Drawing helpers ─────────────────────────────────────────────────────────

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, lineWidth = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function priceLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string) {
  ctx.font = '10px monospace';
  const m = ctx.measureText(text);
  const pw = 5, ph = 3;
  const bw = m.width + pw * 2;
  const bh = 14;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y - bh / 2, bw, bh);
  ctx.fillStyle = fg;
  ctx.fillText(text, x + pw, y + 3.5);
}

function formatEtTime(ts: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const h = parts.find(p => p.type === 'hour')?.value ?? '00';
  const m = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function niceStep(range: number, steps: number): number {
  const raw = range / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice: number;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3) nice = 2;
  else if (norm <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

function triangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, up: boolean, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx - size * 0.7, cy + size * 0.4);
    ctx.lineTo(cx + size * 0.7, cy + size * 0.4);
  } else {
    ctx.moveTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.7, cy - size * 0.4);
    ctx.lineTo(cx + size * 0.7, cy - size * 0.4);
  }
  ctx.closePath();
  ctx.fill();
}

/** Find nearest visible bar index for a given timestamp. */
function nearestBarIdx(visible: OhlcBar[], ts: number): number | null {
  if (visible.length === 0 || !ts) return null;
  let bestIdx = 0;
  let bestDist = Math.abs(visible[0].timestamp - ts);
  for (let i = 1; i < visible.length; i++) {
    const d = Math.abs(visible[i].timestamp - ts);
    if (d < bestDist) { bestIdx = i; bestDist = d; }
  }
  return bestIdx;
}

// ── Level type color ────────────────────────────────────────────────────────

function levelColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('demand') || t.includes('support') || t.includes('swing_low')) return COL.levelDemand;
  if (t.includes('supply') || t.includes('resistance') || t.includes('swing_high')) return COL.levelSupply;
  return COL.levelOther;
}

function levelTextColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('demand') || t.includes('support') || t.includes('swing_low')) return 'rgba(52,211,153,0.4)';
  if (t.includes('supply') || t.includes('resistance') || t.includes('swing_high')) return 'rgba(248,113,113,0.4)';
  return 'rgba(96,165,250,0.35)';
}

// ── Main draw ───────────────────────────────────────────────────────────────

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bars: OhlcBar[],
  currentPrice: number | undefined,
  overlay: TradeLevelOverlay | null | undefined,
  symbol: string | undefined,
  source: string | undefined,
  freshnessMs: number | undefined,
  levels: ChartLevel[] | undefined,
  events: ChartEvent[] | undefined,
  hoverIdx: number | null,
  mouseX: number | null,
  mouseY: number | null,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, h);

  const chartW = w - PRICE_AXIS_W;
  const chartH = (h - TIME_AXIS_H) * CHART_RATIO;
  const gapH = (h - TIME_AXIS_H) * GAP_RATIO;
  const volH = (h - TIME_AXIS_H) * VOLUME_RATIO;
  const volTop = chartH + gapH;

  // ── Badges (top-left) ──────────────────────────────────────────────────
  let bx = 8;
  const by = 10;
  ctx.font = 'bold 9px monospace';

  if (symbol) {
    const t = symbol;
    const tw = ctx.measureText(t).width + 8;
    ctx.fillStyle = COL.badge;
    ctx.fillRect(bx, by, tw, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(t, bx + 4, by + 11.5);
    bx += tw + 4;
  }

  if (source) {
    const t = source === 'tradovate' ? 'LIVE' : 'SIM';
    const col = source === 'tradovate' ? COL.up : '#a78bfa';
    const tw = ctx.measureText(t).width + 8;
    ctx.fillStyle = col + '18';
    ctx.fillRect(bx, by, tw, 16);
    ctx.fillStyle = col;
    ctx.fillText(t, bx + 4, by + 11.5);
    bx += tw + 4;
  }

  if (freshnessMs !== undefined) {
    const t = freshnessMs < 1000 ? '<1s' : `${Math.round(freshnessMs / 1000)}s`;
    const col = freshnessMs > 8000 ? COL.down : freshnessMs > 4000 ? COL.entry : 'rgba(255,255,255,0.25)';
    const tw = ctx.measureText(t).width + 8;
    ctx.fillStyle = col + '15';
    ctx.fillRect(bx, by, tw, 16);
    ctx.fillStyle = col;
    ctx.fillText(t, bx + 4, by + 11.5);
  }

  // ── No data fallback (draw shell first) ─────────────────────────────────
  if (bars.length === 0) {
    // Draw empty grid shell
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let i = 1; i <= GRID_LINES; i++) {
      const y = (chartH / (GRID_LINES + 1)) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
    }
    ctx.font = '11px monospace';
    ctx.fillStyle = COL.noData;
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for market data...', chartW / 2, chartH / 2);
    ctx.textAlign = 'start';
    return;
  }

  // ── Visible bars ──────────────────────────────────────────────────────
  const visible = bars.length > MAX_VISIBLE ? bars.slice(-MAX_VISIBLE) : bars;
  const n = visible.length;
  const barW = chartW / n;
  const baseBodyW = barW * (1 - BAR_PAD);
  const bodyOff = (barW - baseBodyW) / 2;

  // ── Price range ───────────────────────────────────────────────────────
  let pMin = Infinity, pMax = -Infinity;
  for (const b of visible) {
    if (b.low < pMin) pMin = b.low;
    if (b.high > pMax) pMax = b.high;
  }
  if (overlay) {
    pMin = Math.min(pMin, overlay.stopPrice, overlay.targetPrice, overlay.entryPrice);
    pMax = Math.max(pMax, overlay.stopPrice, overlay.targetPrice, overlay.entryPrice);
  }
  if (currentPrice !== undefined) {
    pMin = Math.min(pMin, currentPrice);
    pMax = Math.max(pMax, currentPrice);
  }
  // Include levels in range
  if (levels) {
    for (const lv of levels) {
      if (lv.price >= pMin * 0.995 && lv.price <= pMax * 1.005) continue; // already in range
      // Only widen range slightly for nearby levels
    }
  }
  const pPad = (pMax - pMin) * 0.06 || 1;
  pMin -= pPad;
  pMax += pPad;
  const pRange = pMax - pMin;

  const priceY = (p: number) => chartH - ((p - pMin) / pRange) * chartH;

  // ── Volume range ──────────────────────────────────────────────────────
  let vMax = 0;
  for (const b of visible) { if (b.volume > vMax) vMax = b.volume; }
  if (vMax === 0) vMax = 1;

  // ── Grid lines ────────────────────────────────────────────────────────
  const step = niceStep(pRange, GRID_LINES);
  const gridStart = Math.ceil(pMin / step) * step;
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  for (let p = gridStart; p <= pMax; p += step) {
    const y = priceY(p);
    if (y < 4 || y > chartH - 4) continue;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartW, y);
    ctx.stroke();
    ctx.fillStyle = COL.axisText;
    ctx.fillText(p.toFixed(2), w - 4, y + 3);
  }
  ctx.textAlign = 'start';

  // ── Level overlays (behind candles) ─────────────────────────────────────
  if (levels && levels.length > 0) {
    ctx.save();
    ctx.font = '8px monospace';
    for (const lv of levels) {
      const y = priceY(lv.price);
      if (y < -10 || y > chartH + 10) continue;
      const col = levelColor(lv.type);
      const txtCol = levelTextColor(lv.type);
      // Dashed line
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      // Small label on right
      const label = lv.type.replace(/_/g, ' ').slice(0, 8).toUpperCase();
      ctx.fillStyle = txtCol;
      ctx.textAlign = 'right';
      ctx.fillText(`${label} ${lv.price.toFixed(0)}`, chartW - 4, y - 3);
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'start';
    ctx.restore();
  }

  // ── Candlesticks ──────────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const b = visible[i];
    const x = i * barW;
    const cx = x + barW / 2;
    const isUp = b.close >= b.open;
    const color = isUp ? COL.up : COL.down;
    const isLast = i === n - 1;

    const wickTop = priceY(b.high);
    const wickBot = priceY(b.low);
    const bodyTop = priceY(isUp ? b.close : b.open);
    const bodyBot = priceY(isUp ? b.open : b.close);
    const bodyH = Math.max(bodyBot - bodyTop, 1);

    // Last candle emphasis: slightly wider and brighter
    const bw = isLast ? baseBodyW * 1.15 : baseBodyW;
    const bo = isLast ? (barW - bw) / 2 : bodyOff;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = isLast ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx, wickTop);
    ctx.lineTo(cx, wickBot);
    ctx.stroke();

    // Body
    if (isUp) {
      ctx.fillStyle = isLast ? color + 'ee' : color + 'cc';
      ctx.fillRect(x + bo, bodyTop, bw, bodyH);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + bo, bodyTop, bw, bodyH);
    } else {
      ctx.fillStyle = isLast ? color : color + 'ee';
      ctx.fillRect(x + bo, bodyTop, bw, bodyH);
    }
  }

  // ── Volume histogram ──────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const b = visible[i];
    const x = i * barW;
    const vh = (b.volume / vMax) * volH;
    const isUp = b.close >= b.open;
    ctx.fillStyle = isUp ? COL.volUp : COL.volDown;
    ctx.fillRect(x + bodyOff, volTop + volH - vh, baseBodyW, vh);
  }

  // ── Event markers (approved/rejected) ─────────────────────────────────
  if (events && events.length > 0) {
    for (const ev of events) {
      const idx = nearestBarIdx(visible, ev.timestamp);
      if (idx === null) continue;
      const bar = visible[idx];
      const cx = idx * barW + barW / 2;
      if (ev.type === 'approved') {
        triangle(ctx, cx, priceY(bar.low) + 8, 5, true, COL.up + '90');
      } else if (ev.type === 'rejected') {
        triangle(ctx, cx, priceY(bar.high) - 8, 5, false, COL.down + '90');
      }
    }
  }

  // ── Time axis ─────────────────────────────────────────────────────────
  const labelEvery = Math.max(1, Math.floor(n / 8));
  ctx.font = '9px monospace';
  ctx.fillStyle = COL.timeText;
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += labelEvery) {
    const x = i * barW + barW / 2;
    ctx.fillText(formatEtTime(visible[i].timestamp), x, h - 4);
  }
  // ET timezone indicator
  ctx.fillStyle = COL.timeText;
  ctx.textAlign = 'right';
  ctx.fillText('ET', chartW - 4, h - 4);
  ctx.textAlign = 'start';

  // ── Trade level overlays ──────────────────────────────────────────────
  if (overlay) {
    const entryY = priceY(overlay.entryPrice);
    const stopY  = priceY(overlay.stopPrice);
    const targY  = priceY(overlay.targetPrice);

    // Zone fills
    ctx.fillStyle = 'rgba(52,211,153,0.04)';
    ctx.fillRect(0, Math.min(entryY, targY), chartW, Math.abs(targY - entryY));
    ctx.fillStyle = 'rgba(248,113,113,0.04)';
    ctx.fillRect(0, Math.min(entryY, stopY), chartW, Math.abs(stopY - entryY));

    // Lines + labels
    dashedLine(ctx, 0, entryY, chartW, entryY, COL.entry);
    priceLabel(ctx, chartW + 2, entryY, `ENTRY ${overlay.entryPrice.toFixed(2)}`, COL.entry + '30', COL.entry);

    dashedLine(ctx, 0, stopY, chartW, stopY, COL.stop);
    priceLabel(ctx, chartW + 2, stopY, `STOP ${overlay.stopPrice.toFixed(2)}`, COL.stop + '30', COL.stop);

    dashedLine(ctx, 0, targY, chartW, targY, COL.target);
    priceLabel(ctx, chartW + 2, targY, `TGT ${overlay.targetPrice.toFixed(2)}`, COL.target + '30', COL.target);
  }

  // ── Current price line ────────────────────────────────────────────────
  if (currentPrice !== undefined) {
    const y = priceY(currentPrice);
    dashedLine(ctx, 0, y, chartW, y, COL.priceLine, 1);
    priceLabel(ctx, chartW + 2, y, currentPrice.toFixed(2), COL.priceLine, '#fff');
  }

  // ── Crosshair ─────────────────────────────────────────────────────────
  if (mouseX !== null && mouseY !== null && mouseX < chartW && mouseY < chartH + volH + gapH) {
    // Vertical line
    dashedLine(ctx, mouseX, 0, mouseX, chartH + gapH + volH, COL.crosshair, 0.5);
    // Horizontal line
    dashedLine(ctx, 0, mouseY, chartW, mouseY, COL.crosshair, 0.5);

    // Price label at crosshair Y
    if (mouseY <= chartH) {
      const crossPrice = pMin + (1 - mouseY / chartH) * pRange;
      ctx.font = '9px monospace';
      const label = crossPrice.toFixed(2);
      const lw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(chartW + 1, mouseY - 7, lw, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(label, chartW + 5, mouseY + 3);
      ctx.textAlign = 'start';
    }

    // Time label at crosshair X
    const barIdx = Math.min(Math.max(0, Math.floor(mouseX / barW)), n - 1);
    if (barIdx < n) {
      const timeLabel = formatEtTime(visible[barIdx].timestamp);
      ctx.font = '9px monospace';
      const tw = ctx.measureText(timeLabel).width + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(mouseX - tw / 2, h - TIME_AXIS_H, tw, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.fillText(timeLabel, mouseX, h - TIME_AXIS_H + 10);
      ctx.textAlign = 'start';
    }
  }

  // ── Hover OHLC HUD ────────────────────────────────────────────────────
  if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < n) {
    const b = visible[hoverIdx];
    const lines = [
      `O ${b.open.toFixed(2)}`,
      `H ${b.high.toFixed(2)}`,
      `L ${b.low.toFixed(2)}`,
      `C ${b.close.toFixed(2)}`,
      `V ${b.volume}`,
    ];
    ctx.font = '9px monospace';
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const hudW = maxW + 12;
    const hudH = lines.length * 13 + 8;
    const hudX = 8;
    const hudY = 32;

    ctx.fillStyle = COL.hudBg;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, hudW, hudH, 3);
    ctx.fill();

    ctx.fillStyle = COL.hudText;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], hudX + 6, hudY + 14 + i * 13);
    }
  }
}

// ── Styles ──────────────────────────────────────────────────────────────────

const sty = {
  wrap: { width: '100%' } as React.CSSProperties,
  tfBar: {
    display: 'flex', gap: 0, marginBottom: 6,
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden', width: 'fit-content',
  } as React.CSSProperties,
  tfBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.06em', padding: '5px 14px', cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s',
  } as React.CSSProperties,
  tfActive: {
    background: 'rgba(96,165,250,0.12)', color: '#60a5fa',
  } as React.CSSProperties,
};

// ── Component ───────────────────────────────────────────────────────────────

export function CandlestickChart({
  bars,
  timeframe,
  onTimeframeChange,
  currentPrice,
  symbol,
  source,
  feedFreshnessMs,
  tradeOverlay,
  levels,
  events,
  height = 340,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measuredW, setMeasuredW] = useState(600);

  // Mouse tracking for crosshair + hover
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Responsive width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setMeasuredW(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render function
  const renderChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(measuredW * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const mp = mousePosRef.current;
    draw(
      ctx, measuredW, height, bars, currentPrice, tradeOverlay,
      symbol, source, feedFreshnessMs,
      levels, events,
      hoverIdxRef.current,
      mp ? mp.x : null,
      mp ? mp.y : null,
    );
  }, [bars, currentPrice, tradeOverlay, measuredW, height, symbol, source, feedFreshnessMs, levels, events]);

  useEffect(() => { renderChart(); }, [renderChart]);

  // Mouse handlers (use rAF for smooth crosshair)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mousePosRef.current = { x, y };

    // Compute hover bar index
    const chartW = measuredW - PRICE_AXIS_W;
    const visible = bars.length > MAX_VISIBLE ? bars.slice(-MAX_VISIBLE) : bars;
    const barW = visible.length > 0 ? chartW / visible.length : 1;
    const idx = Math.floor(x / barW);
    hoverIdxRef.current = idx >= 0 && idx < visible.length ? idx : null;

    // Debounce with rAF
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderChart);
  }, [bars, measuredW, renderChart]);

  const handleMouseLeave = useCallback(() => {
    mousePosRef.current = null;
    hoverIdxRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderChart);
  }, [renderChart]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <div ref={containerRef} style={sty.wrap}>
      <div style={sty.tfBar}>
        {(['1m', '5m', '15m'] as const).map(tf => (
          <button
            key={tf}
            style={{ ...sty.tfBtn, ...(timeframe === tf ? sty.tfActive : {}) }}
            onClick={() => onTimeframeChange(tf)}
          >
            {tf}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: measuredW, height, display: 'block', borderRadius: 6, cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
