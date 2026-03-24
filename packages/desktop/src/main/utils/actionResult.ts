// ── actionResult.ts ───────────────────────────────────────────────────────────
//
// Canonical return shape for Income Operator mutating IPC handlers.
// All Phase 3–6 handlers return this type so the renderer can handle
// success/failure uniformly without checking different field names.
//
// retryable flag:
//   true  — transient I/O failure; caller may retry automatically
//   false — logical/validation error; retrying will not help

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  retryable?: boolean;
}

export function ok<T>(data?: T): ActionResult<T> {
  return { success: true, data };
}

export function fail(error: string, retryable = false): ActionResult<never> {
  return { success: false, error, retryable };
}
