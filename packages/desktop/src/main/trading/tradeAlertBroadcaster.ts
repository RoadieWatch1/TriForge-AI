// ── tradeAlertBroadcaster.ts — Single canonical emitter for shadow trade alerts ─
//
// Used by both shadowTradingController (legacy path) and TriForgeShadowSimulator
// (level engine path). Pushes real-time alerts to all renderer windows via IPC
// and fires desktop notifications only when the app is not focused.
//
// The `source` field allows the renderer to deduplicate if both paths ever fire
// for the same trade lifecycle event.

import { BrowserWindow } from 'electron';
import { sendDesktopNotification } from '../notifications';
import { INSTRUMENT_META } from '@triforge/engine';

export interface TradeSignalAlert {
  type: 'trade_opened' | 'trade_closed';
  source: 'controller' | 'simulator';
  tradeId: string;
  symbol: string;
  symbolLabel: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  timestamp: number;
  // Trust context (open)
  setupGrade?: 'A' | 'B' | 'C' | 'D';
  confidence?: string;
  qualityScore?: number;
  // Close context
  exitPrice?: number;
  exitReason?: string;
  pnl?: number;
  pnlR?: number;
}

/**
 * Resolve the human-readable label for a symbol from INSTRUMENT_META.
 */
export function symbolLabel(symbol: string): string {
  return INSTRUMENT_META[symbol.toUpperCase()]?.label ?? symbol;
}

/**
 * Broadcast a shadow trade alert to all renderer windows + desktop notification.
 * Desktop notification fires only when no window is focused (background use).
 */
export function broadcastTradeAlert(alert: TradeSignalAlert): void {
  // Push to all renderer windows
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('shadow:tradeAlert', alert);
    }
  }

  // Desktop notification — only when app is not focused
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return;

  if (alert.type === 'trade_opened') {
    sendDesktopNotification({
      title: `Signal: ${alert.side.toUpperCase()} ${alert.symbol} — ${alert.symbolLabel}`,
      body: `Entry ${alert.entryPrice}  Stop ${alert.stopPrice}  Target ${alert.targetPrice}  Qty ${alert.qty}`,
    });
  } else {
    const pnlStr = alert.pnl !== undefined
      ? (alert.pnl >= 0 ? `+$${alert.pnl.toFixed(2)}` : `-$${Math.abs(alert.pnl).toFixed(2)}`)
      : '';
    const rStr = alert.pnlR !== undefined
      ? ` (${alert.pnlR >= 0 ? '+' : ''}${alert.pnlR.toFixed(1)}R)`
      : '';
    sendDesktopNotification({
      title: `Closed: ${alert.side.toUpperCase()} ${alert.symbol} — ${(alert.exitReason ?? '').toUpperCase()}`,
      body: `${pnlStr}${rStr}  Exit ${alert.exitPrice}`,
    });
  }
}
