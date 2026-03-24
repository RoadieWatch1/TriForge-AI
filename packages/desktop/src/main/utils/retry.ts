// ── retry.ts ──────────────────────────────────────────────────────────────────
//
// Safe retry wrapper for I/O-bound reads.
//
// Use ONLY for: ledger reads, readiness fetch, ForgeHub reads, MCP tool listing.
// Do NOT use for: publish, spend, kill/scale, approval creation.
//

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
