// ── workerRuntime/machineId.ts — Stable Machine Identity ─────────────────────
//
// Generates and persists a stable UUID for this installation.
// Used as the `machineId` on all WorkerRun records so runs are clearly
// scoped to the machine that created them.
//
// File: triforge-machine-id.json in app.getPath('userData')
// Format: { "machineId": "uuid-v4" }
//
// On first call: generates UUID, writes file, returns it.
// On subsequent calls: reads from disk (in-memory cached after first read).
// Thread-safe: synchronous reads/writes within the single Node.js event loop.

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';

const FILENAME = 'triforge-machine-id.json';

let _cached: string | null = null;

interface MachineIdFile {
  machineId: string;
}

function isMachineIdFile(obj: unknown): obj is MachineIdFile {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as MachineIdFile).machineId === 'string' &&
    (obj as MachineIdFile).machineId.length > 0
  );
}

/**
 * Return the stable machine ID for this installation.
 * Creates and persists a new UUID if one does not yet exist.
 */
export function getMachineId(dataDir: string): string {
  if (_cached) return _cached;

  const filePath = path.join(dataDir, FILENAME);

  // Try to load existing
  try {
    if (fs.existsSync(filePath)) {
      const raw  = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (isMachineIdFile(parsed)) {
        _cached = parsed.machineId;
        return _cached;
      }
    }
  } catch {
    // Fall through — generate a new one
  }

  // Generate and persist
  const machineId = crypto.randomUUID();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ machineId }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[machineId] failed to persist machine ID:', e);
    // Non-fatal — return in-memory value even if write failed
  }

  _cached = machineId;
  return _cached;
}

/** Clear the in-memory cache. For testing only. */
export function clearMachineIdCache(): void {
  _cached = null;
}
