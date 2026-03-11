// ── CandlestickChart.tsx ─────────────────────────────────────────────────────
//
// Canvas-based candlestick chart with volume histogram, price axis,
// time axis, current price line, and trade level overlays.
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

interface CandlestickChartProps {
  bars: OhlcBar[];
  timeframe: '1m' | '5m' | '15m';
  onTimeframeChange: (tf: '1m' | '5m' | '15m') => void;
  currentPrice?: number;
  symbol?: string;
  source?: 'tradovate' | 'simulated';
  feedFreshnessMs?: number;
  tradeOverlay?: TradeLevelOverlay | null;
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

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
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

  // ── No data fallback ──────────────────────────────────────────────────
  if (bars.length === 0) {
    ctx.font = '12px monospace';
    ctx.fillStyle = COL.noData;
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for market data...', w / 2, h / 2);
    ctx.textAlign = 'start';
    return;
  }

  // ── Visible bars ──────────────────────────────────────────────────────
  const visible = bars.length > MAX_VISIBLE ? bars.slice(-MAX_VISIBLE) : bars;
  const n = visible.length;
  const barW = chartW / n;
  const bodyW = barW * (1 - BAR_PAD);
  const bodyOff = (barW - bodyW) / 2;

  // ── Price range ───────────────────────────────────────────────────────
  let pMin = Infinity, pMax = -Infinity;
  for (const b of visible) {
    if (b.low < pMin) pMin = b.low;
    if (b.high > pMax) pMax = b.high;
  }
  // Include overlay levels in range
  if (overlay) {
    pMin = Math.min(pMin, overlay.stopPrice, overlay.targetPrice, overlay.entryPrice);
    pMax = Math.max(pMax, overlay.stopPrice, overlay.targetPrice, overlay.entryPrice);
  }
  if (currentPrice !== undefined) {
    pMin = Math.min(pMin, currentPrice);
    pMax = Math.max(pMax, currentPrice);
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

  // ── Candlesticks ──────────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const b = visible[i];
    const x = i * barW;
    const cx = x + barW / 2;
    const isUp = b.close >= b.open;
    const color = isUp ? COL.up : COL.down;

    const wickTop = priceY(b.high);
    const wickBot = priceY(b.low);
    const bodyTop = priceY(isUp ? b.close : b.open);
    const bodyBot = priceY(isUp ? b.open : b.close);
    const bodyH = Math.max(bodyBot - bodyTop, 1);

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx, wickTop);
    ctx.lineTo(cx, wickBot);
    ctx.stroke();

    // Body
    if (isUp) {
      ctx.fillStyle = color + 'cc';
      ctx.fillRect(x + bodyOff, bodyTop, bodyW, bodyH);
      ctx.strokeStyle = color;
      ctx.strokeRect(x + bodyOff, bodyTop, bodyW, bodyH);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x + bodyOff, bodyTop, bodyW, bodyH);
    }
  }

  // ── Volume histogram ──────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const b = visible[i];
    const x = i * barW;
    const vh = (b.volume / vMax) * volH;
    const isUp = b.close >= b.open;
    ctx.fillStyle = isUp ? COL.volUp : COL.volDown;
    ctx.fillRect(x + bodyOff, volTop + volH - vh, bodyW, vh);
  }

  // ── Time axis ─────────────────────────────────────────────────────────
  const labelEvery = Math.max(1, Math.floor(n / 8));
  ctx.font = '9px monospace';
  ctx.fillStyle = COL.timeText;
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += labelEvery) {
    const x = i * barW + barW / 2;
    ctx.fillText(formatTime(visible[i].timestamp), x, h - 4);
  }
  ctx.textAlign = 'start';

  // ── Trade level overlays ──────────────────────────────────────────────
  if (overlay) {
    const entryY = priceY(overlay.entryPrice);
    const stopY  = priceY(overlay.stopPrice);
    const targY  = priceY(overlay.targetPrice);

    // Zone fills
    if (overlay.side === 'long') {
      ctx.fillStyle = 'rgba(52,211,153,0.04)';
      ctx.fillRect(0, Math.min(entryY, targY), chartW, Math.abs(targY - entryY));
      ctx.fillStyle = 'rgba(248,113,113,0.04)';
      ctx.fillRect(0, Math.min(entryY, stopY), chartW, Math.abs(stopY - entryY));
    } else {
      ctx.fillStyle = 'rgba(52,211,153,0.04)';
      ctx.fillRect(0, Math.min(entryY, targY), chartW, Math.abs(targY - entryY));
      ctx.fillStyle = 'rgba(248,113,113,0.04)';
      ctx.fillRect(0, Math.min(entryY, stopY), chartW, Math.abs(stopY - entryY));
    }

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
  height = 340,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measuredW, setMeasuredW] = useState(600);

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

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(measuredW * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    draw(ctx, measuredW, height, bars, currentPrice, tradeOverlay, symbol, source, feedFreshnessMs);
  }, [bars, currentPrice, tradeOverlay, measuredW, height, symbol, source, feedFreshnessMs]);

  useEffect(() => { render(); }, [render]);

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
        style={{ width: measuredW, height, display: 'block', borderRadius: 6 }}
      />
    </div>
  );
}
