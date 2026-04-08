// ── relay-server/src/jobQueue.ts ──────────────────────────────────────────────
//
// In-memory job queue.
//
// Jobs flow through these states:
//   pending   → Desktop hasn't picked it up yet
//   running   → Desktop acknowledged and is executing
//   completed → Finished successfully (result attached)
//   failed    → Execution error (error attached)
//   cancelled → Cancelled before execution started
//
// Jobs expire after 24 hours to prevent unbounded memory growth.
// For production, replace the Map with Redis or a lightweight SQLite store.

import crypto from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RelayJob {
  id:          string;
  deviceId:    string;
  packId:      string;
  opts:        Record<string, unknown>;
  submittedAt: number;
  expiresAt:   number;
  status:      JobStatus;
  pickedUpAt?: number;
  completedAt?: number;
  result?:     unknown;
  error?:      string;
  /** Optional label shown in the relay dashboard */
  label?:      string;
  /** Who submitted: 'web' | 'api' | 'mobile' — informational only */
  submittedBy?: string;
}

export interface JobSubmission {
  deviceId:     string;
  packId:       string;
  opts?:        Record<string, unknown>;
  label?:       string;
  submittedBy?: string;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const _jobs = new Map<string, RelayJob>();
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Cleanup expired jobs every 10 minutes ─────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of _jobs) {
    if (job.expiresAt < now) _jobs.delete(id);
  }
}, 10 * 60 * 1000);

// ── Public API ────────────────────────────────────────────────────────────────

export function submitJob(submission: JobSubmission): RelayJob {
  const job: RelayJob = {
    id:          crypto.randomUUID(),
    deviceId:    submission.deviceId,
    packId:      submission.packId,
    opts:        submission.opts ?? {},
    submittedAt: Date.now(),
    expiresAt:   Date.now() + JOB_TTL_MS,
    status:      'pending',
    label:       submission.label,
    submittedBy: submission.submittedBy ?? 'api',
  };
  _jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): RelayJob | undefined {
  return _jobs.get(jobId);
}

/** Return all pending jobs for a device, sorted oldest-first. */
export function getPendingJobs(deviceId: string): RelayJob[] {
  const now = Date.now();
  return Array.from(_jobs.values())
    .filter(j => j.deviceId === deviceId && j.status === 'pending' && j.expiresAt > now)
    .sort((a, b) => a.submittedAt - b.submittedAt);
}

/** All jobs for a device (any status), newest first, up to limit. */
export function getJobHistory(deviceId: string, limit = 50): RelayJob[] {
  return Array.from(_jobs.values())
    .filter(j => j.deviceId === deviceId)
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, limit);
}

export function markRunning(jobId: string): RelayJob | null {
  const job = _jobs.get(jobId);
  if (!job || job.status !== 'pending') return null;
  job.status    = 'running';
  job.pickedUpAt = Date.now();
  return job;
}

export function markCompleted(jobId: string, result: unknown): RelayJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.status      = 'completed';
  job.completedAt = Date.now();
  job.result      = result;
  return job;
}

export function markFailed(jobId: string, error: string): RelayJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.status      = 'failed';
  job.completedAt = Date.now();
  job.error       = error;
  return job;
}

export function cancelJob(jobId: string): RelayJob | null {
  const job = _jobs.get(jobId);
  if (!job || job.status !== 'pending') return null;
  job.status = 'cancelled';
  return job;
}

/** All jobs across all devices — for admin dashboard. */
export function getAllJobs(limit = 200): RelayJob[] {
  return Array.from(_jobs.values())
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, limit);
}
