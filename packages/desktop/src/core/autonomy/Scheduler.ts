// ── Scheduler.ts — Periodic task scheduler with jitter ───────────────────────
//
// Thin wrapper around setInterval that adds random jitter to avoid thundering-herd
// when multiple scanners fire simultaneously.

export class Scheduler {
  /**
   * Schedule a function to run periodically.
   * @param fn      Function to call
   * @param intervalMs  Base interval in milliseconds
   * @param jitterMs    Random jitter added to each interval (default 5s)
   * @returns Unsubscribe function — call it to stop the schedule
   */
  schedule(fn: () => void, intervalMs: number, jitterMs = 5000): () => void {
    const jitter = Math.random() * jitterMs;
    const timer = setInterval(fn, intervalMs + jitter);
    return () => clearInterval(timer);
  }
}
