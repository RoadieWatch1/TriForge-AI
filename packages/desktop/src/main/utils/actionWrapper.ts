// ── actionWrapper.ts ──────────────────────────────────────────────────────────
//
// Generic try/catch wrapper that normalises any async function into ActionResult.
//
// Usage:
//   return wrapAction(() => someAsyncOp());
//   return wrapAction(() => someAsyncOp(), { retryable: true });
//
// Use ONLY for Income Operator mutating handlers.
// Do NOT use for streaming, reads-only, or broadcast IPC.
//

import type { ActionResult } from './actionResult';

export async function wrapAction<T>(
  fn: () => Promise<T>,
  opts: { retryable?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    return {
      success:   false,
      error:     err instanceof Error ? err.message : String(err),
      retryable: opts.retryable ?? false,
    };
  }
}
