// ── machineContext.ts ─────────────────────────────────────────────────────────
//
// Section 4 — Goal 1/2: Machine Awareness Foundation + Stabilization
//
// Read-only. Returns a stable, normalized snapshot of the local machine.
//
// Design constraints:
//   - No writes, no exec/spawn, no subprocess calls
//   - No recursion, no deep directory scanning
//   - Desktop + Documents top-level only, capped at 50 entries each
//   - Graceful degradation: always returns a valid structure, never throws
//   - In-memory cache: 30-second TTL to prevent redundant disk reads

import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DetectedApp = {
  name: string;
  path: string;
  present: boolean;
};

export type MachineContext = {
  system: {
    os: 'macOS' | 'Windows' | 'Linux' | 'Unknown';
    platform: string;
  };
  apps: DetectedApp[];
  files: {
    desktop: string[];
    documents: string[];
  };
};

// ── Fallback ──────────────────────────────────────────────────────────────────

const FALLBACK: MachineContext = {
  system: { os: 'Unknown', platform: 'unknown' },
  apps: [],
  files: { desktop: [], documents: [] },
};

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;

let cachedContext: MachineContext | null = null;
let lastComputedAt: number = 0;

// ── App definitions ───────────────────────────────────────────────────────────

interface AppDef {
  name: string;
  paths: { darwin?: string[]; win32?: string[]; linux?: string[] };
}

const APP_DEFS: AppDef[] = [
  {
    name: 'Google Chrome',
    paths: {
      darwin: ['/Applications/Google Chrome.app'],
      win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ],
      linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    },
  },
  {
    name: 'Visual Studio Code',
    paths: {
      darwin: ['/Applications/Visual Studio Code.app'],
      win32: [
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        'C:\\Users\\' + os.userInfo().username + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      ],
      linux: ['/usr/bin/code', '/snap/bin/code'],
    },
  },
  {
    name: 'Adobe Photoshop',
    paths: {
      darwin: [
        '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app',
        '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app',
        '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app',
      ],
      win32: [
        'C:\\Program Files\\Adobe\\Adobe Photoshop 2024',
        'C:\\Program Files\\Adobe\\Adobe Photoshop 2025',
        'C:\\Program Files\\Adobe\\Adobe Photoshop 2026',
      ],
    },
  },
  {
    name: 'Unreal Engine',
    paths: {
      darwin: [
        '/Users/Shared/Epic Games/UE_5.0',
        '/Users/Shared/Epic Games/UE_5.1',
        '/Users/Shared/Epic Games/UE_5.2',
        '/Users/Shared/Epic Games/UE_5.3',
        '/Users/Shared/Epic Games/UE_5.4',
      ],
      win32: [
        'C:\\Program Files\\Epic Games\\UE_5.0',
        'C:\\Program Files\\Epic Games\\UE_5.1',
        'C:\\Program Files\\Epic Games\\UE_5.2',
        'C:\\Program Files\\Epic Games\\UE_5.3',
        'C:\\Program Files\\Epic Games\\UE_5.4',
      ],
    },
  },
];

// ── Detection helpers ─────────────────────────────────────────────────────────

function getSystemInfo(): MachineContext['system'] {
  const platform = os.platform();
  const osName: MachineContext['system']['os'] =
    platform === 'darwin' ? 'macOS' :
    platform === 'win32'  ? 'Windows' :
    platform === 'linux'  ? 'Linux' :
    'Unknown';
  return { os: osName, platform };
}

function getDetectedApps(): DetectedApp[] {
  const platform = os.platform() as 'darwin' | 'win32' | 'linux';
  const results: DetectedApp[] = [];

  for (const def of APP_DEFS) {
    const candidates = def.paths[platform] ?? [];
    const found = candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    if (found) {
      results.push({ name: def.name, path: found, present: true });
    }
  }

  return results;
}

function getTopLevelFiles(): MachineContext['files'] {
  const home = os.homedir();

  function readDir(dirPath: string): string[] {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.slice(0, 50).map(e => e.name);
    } catch {
      return [];
    }
  }

  return {
    desktop: readDir(path.join(home, 'Desktop')),
    documents: readDir(path.join(home, 'Documents')),
  };
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalize(raw: MachineContext): MachineContext {
  // OS must be one of the known values — already enforced by getSystemInfo(),
  // but guard here in case a future caller passes raw data directly.
  const knownOs: MachineContext['system']['os'][] = ['macOS', 'Windows', 'Linux', 'Unknown'];
  const os: MachineContext['system']['os'] = knownOs.includes(raw.system.os as never)
    ? raw.system.os
    : 'Unknown';

  const platform = typeof raw.system.platform === 'string' && raw.system.platform.length > 0
    ? raw.system.platform
    : 'unknown';

  // Apps: deduplicate by name, sort alphabetically
  const seen = new Set<string>();
  const apps = raw.apps
    .filter(a => typeof a.name === 'string' && a.name.length > 0 && !seen.has(a.name) && seen.add(a.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Files: sort alphabetically, enforce string type, cap at 50
  const sanitize = (arr: string[]) =>
    arr
      .filter(f => typeof f === 'string')
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 50);

  return {
    system: { os, platform },
    apps,
    files: {
      desktop: sanitize(raw.files.desktop),
      documents: sanitize(raw.files.documents),
    },
  };
}

// ── Compute ───────────────────────────────────────────────────────────────────

function compute(): MachineContext {
  return normalize({
    system: getSystemInfo(),
    apps: getDetectedApps(),
    files: getTopLevelFiles(),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getMachineContext(): Promise<MachineContext> {
  try {
    const now = Date.now();

    if (cachedContext !== null && now - lastComputedAt < CACHE_TTL_MS) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[MachineContext] cache hit');
      }
      return cachedContext;
    }

    cachedContext = compute();
    lastComputedAt = now;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[MachineContext] computed');
    }

    return cachedContext;
  } catch {
    return { ...FALLBACK };
  }
}

/** Force-clears the cache. Useful for testing only. */
export function clearMachineContextCache(): void {
  cachedContext = null;
  lastComputedAt = 0;
}
