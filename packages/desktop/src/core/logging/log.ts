// ── log.ts — Centralized structured logger for core/ modules ──────────────────
//
// Intentionally lightweight — no AuditLedger dependency (that's main-process only).
// Each module creates its own logger with createLogger('ModuleName').

export interface Logger {
  info:  (...args: unknown[]) => void;
  warn:  (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  return {
    info:  (...args) => console.info(prefix,  ...args),
    warn:  (...args) => console.warn(prefix,  ...args),
    error: (...args) => console.error(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args),
  };
}
