/**
 * notifications.ts — Electron Notification service for Phase 4 real execution
 *
 * Wraps Electron's Notification API. Falls back silently if notifications
 * are not supported (e.g. Linux without libnotify).
 */

import { Notification } from 'electron';

export interface NotifyOptions {
  title: string;
  body: string;
  silent?: boolean;
}

export function sendDesktopNotification(opts: NotifyOptions): void {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({
      title: opts.title,
      body: opts.body,
      silent: opts.silent ?? false,
    });
    n.show();
  } catch (e) {
    console.warn('[notifications] failed to show notification:', e);
  }
}

/**
 * Adapter for serviceLocator.registerNotifier().
 * Returns the same function signature expected by the engine.
 */
export function createNotifyAdapter(): (title: string, body: string) => void {
  return (title: string, body: string) => {
    sendDesktopNotification({ title, body });
  };
}
