/**
 * bootLogger.ts — lightweight startup diagnostics
 * Timestamps every boot step so logs clearly show where startup stalled.
 */

export function bootLog(step: string): void {
  console.log(`[BOOT ${new Date().toISOString()}] ${step}`);
}

export function bootError(step: string, err: unknown): void {
  console.error(`[BOOT ERROR ${new Date().toISOString()}] ${step}`, err);
}
