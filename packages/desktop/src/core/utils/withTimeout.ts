// ── withTimeout.ts — Promise timeout wrapper ──────────────────────────────────
//
// Wraps any promise with a hard deadline. If the promise does not settle
// within `ms` milliseconds, the returned promise rejects with a TimeoutError.
//
// Usage:
//   const result = await withTimeout(provider.generate(prompt), 20_000);
//
// Use Promise.allSettled when one timeout should not cancel others:
//   const results = await Promise.allSettled(
//     providers.map(p => withTimeout(p.generate(prompt), 20_000))
//   );

export class TimeoutError extends Error {
  constructor(ms: number, label?: string) {
    super(label ? `"${label}" timed out after ${ms}ms` : `Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a deadline.
 *
 * @param promise  The operation to time-box.
 * @param ms       Maximum milliseconds to wait.
 * @param label    Optional name for clearer error messages.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err); },
    );
  });
}
