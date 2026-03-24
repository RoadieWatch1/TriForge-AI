// ── capabilityScanner.ts ───────────────────────────────────────────────────
//
// Scans the user's Windows desktop for installed creative/income-relevant
// software, GPU capability, browser profiles, and connected platforms.
//
// Design rules:
//   - Read-only. Never modifies anything on the user's system.
//   - No network calls. Everything is local OS queries.
//   - Graceful degradation: partial failures return what was found.
//   - Uses PowerShell for registry access, with well-known path fallback.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { CapabilityScanResult, DetectedApp } from './store';

// ── Known app definitions ──────────────────────────────────────────────────
// Each entry describes how to detect an app and which income lanes it helps.

interface AppDef {
  name: string;
  registryKeywords: string[];     // substrings to match in registry DisplayName
  wellKnownPaths: string[];       // fallback paths to check if registry scan fails
  exportFormats: string[];
  incomeRelevant: string[];       // income lane IDs this app enables
}

const APP_DEFS: AppDef[] = [
  {
    name: 'Adobe Photoshop',
    registryKeywords: ['Adobe Photoshop'],
    wellKnownPaths: [
      'C:\\Program Files\\Adobe\\Adobe Photoshop 2024',
      'C:\\Program Files\\Adobe\\Adobe Photoshop 2025',
      'C:\\Program Files\\Adobe\\Adobe Photoshop 2026',
    ],
    exportFormats: ['PNG', 'JPG', 'PSD', 'PDF', 'SVG'],
    incomeRelevant: ['digital_products', 'asset_packs', 'faceless_youtube', 'affiliate_content'],
  },
  {
    name: 'Adobe Illustrator',
    registryKeywords: ['Adobe Illustrator'],
    wellKnownPaths: [
      'C:\\Program Files\\Adobe\\Adobe Illustrator 2024',
      'C:\\Program Files\\Adobe\\Adobe Illustrator 2025',
    ],
    exportFormats: ['SVG', 'PDF', 'PNG', 'AI', 'EPS'],
    incomeRelevant: ['digital_products', 'asset_packs'],
  },
  {
    name: 'Adobe Premiere Pro',
    registryKeywords: ['Adobe Premiere Pro'],
    wellKnownPaths: [
      'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2024',
      'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025',
    ],
    exportFormats: ['MP4', 'MOV', 'AVI', 'MXF'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand', 'ai_music'],
  },
  {
    name: 'Adobe After Effects',
    registryKeywords: ['Adobe After Effects'],
    wellKnownPaths: [
      'C:\\Program Files\\Adobe\\Adobe After Effects 2024',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2025',
    ],
    exportFormats: ['MP4', 'MOV', 'GIF'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand', 'asset_packs'],
  },
  {
    name: 'Adobe Audition',
    registryKeywords: ['Adobe Audition'],
    wellKnownPaths: ['C:\\Program Files\\Adobe\\Adobe Audition 2024'],
    exportFormats: ['MP3', 'WAV', 'AIFF', 'FLAC'],
    incomeRelevant: ['ai_music', 'faceless_youtube'],
  },
  {
    name: 'Canva',
    registryKeywords: ['Canva'],
    wellKnownPaths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Canva', 'Canva.exe'),
    ],
    exportFormats: ['PNG', 'JPG', 'PDF', 'MP4', 'GIF'],
    incomeRelevant: ['digital_products', 'affiliate_content', 'faceless_youtube', 'short_form_brand'],
  },
  {
    name: 'Blender',
    registryKeywords: ['Blender'],
    wellKnownPaths: [
      'C:\\Program Files\\Blender Foundation\\Blender 3.6',
      'C:\\Program Files\\Blender Foundation\\Blender 4.0',
      'C:\\Program Files\\Blender Foundation\\Blender 4.1',
      'C:\\Program Files\\Blender Foundation\\Blender 4.2',
      'C:\\Program Files\\Blender Foundation\\Blender 4.3',
    ],
    exportFormats: ['FBX', 'OBJ', 'GLB', 'GLTF', 'STL', 'PNG', 'MP4'],
    incomeRelevant: ['mini_games', 'asset_packs', 'faceless_youtube'],
  },
  {
    name: 'Unreal Engine',
    registryKeywords: ['Unreal Engine', 'Epic Games Launcher'],
    wellKnownPaths: [
      'C:\\Program Files\\Epic Games\\UE_5.0',
      'C:\\Program Files\\Epic Games\\UE_5.1',
      'C:\\Program Files\\Epic Games\\UE_5.2',
      'C:\\Program Files\\Epic Games\\UE_5.3',
      'C:\\Program Files\\Epic Games\\UE_5.4',
      'C:\\Program Files\\Epic Games\\UE_5.5',
    ],
    exportFormats: ['EXE', 'PAK', 'MP4'],
    incomeRelevant: ['mini_games'],
  },
  {
    name: 'DaVinci Resolve',
    registryKeywords: ['DaVinci Resolve'],
    wellKnownPaths: ['C:\\Program Files\\Blackmagic Design\\DaVinci Resolve'],
    exportFormats: ['MP4', 'MOV', 'MXF', 'DCP'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand', 'ai_music'],
  },
  {
    name: 'FL Studio',
    registryKeywords: ['FL Studio'],
    wellKnownPaths: [
      'C:\\Program Files\\Image-Line\\FL Studio 20',
      'C:\\Program Files\\Image-Line\\FL Studio 21',
    ],
    exportFormats: ['MP3', 'WAV', 'FLAC', 'MIDI'],
    incomeRelevant: ['ai_music'],
  },
  {
    name: 'Reaper',
    registryKeywords: ['REAPER'],
    wellKnownPaths: ['C:\\Program Files\\REAPER (x64)'],
    exportFormats: ['MP3', 'WAV', 'FLAC', 'OGG'],
    incomeRelevant: ['ai_music'],
  },
  {
    name: 'Audacity',
    registryKeywords: ['Audacity'],
    wellKnownPaths: ['C:\\Program Files\\Audacity'],
    exportFormats: ['MP3', 'WAV', 'FLAC', 'OGG'],
    incomeRelevant: ['ai_music', 'faceless_youtube'],
  },
  {
    name: 'OBS Studio',
    registryKeywords: ['OBS Studio'],
    wellKnownPaths: ['C:\\Program Files\\obs-studio'],
    exportFormats: ['MP4', 'MKV', 'FLV'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand'],
  },
  {
    name: 'Figma',
    registryKeywords: ['Figma'],
    wellKnownPaths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Figma', 'Figma.exe'),
    ],
    exportFormats: ['PNG', 'SVG', 'PDF', 'JPG'],
    incomeRelevant: ['digital_products', 'asset_packs', 'client_services'],
  },
  {
    name: 'VS Code',
    registryKeywords: ['Microsoft Visual Studio Code'],
    wellKnownPaths: [
      'C:\\Program Files\\Microsoft VS Code',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code'),
    ],
    exportFormats: [],
    incomeRelevant: ['client_services', 'mini_games'],
  },
  {
    name: 'Unity',
    registryKeywords: ['Unity'],
    wellKnownPaths: [
      'C:\\Program Files\\Unity',
      'C:\\Program Files\\Unity Hub',
    ],
    exportFormats: ['EXE', 'APK', 'WEBGL'],
    incomeRelevant: ['mini_games'],
  },
];

// ── Browser definitions ────────────────────────────────────────────────────

const BROWSER_PROFILE_PATHS: Array<{ name: string; profilePath: string }> = [
  {
    name: 'Chrome',
    profilePath: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
  },
  {
    name: 'Edge',
    profilePath: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
  },
  {
    name: 'Firefox',
    profilePath: path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles'),
  },
  {
    name: 'Brave',
    profilePath: path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
  },
];

// ── Registry scan ──────────────────────────────────────────────────────────

function queryRegistry(): string[] {
  try {
    const ps = `
      $keys = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      )
      $keys | ForEach-Object {
        Get-ItemProperty $_ -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        Select-Object -ExpandProperty DisplayName
      }
    `.trim();

    const result = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { timeout: 15_000, windowsHide: true }
    ).toString();

    return result.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── GPU detection ──────────────────────────────────────────────────────────

function queryGpu(): { name?: string; vramMB?: number } {
  try {
    const result = execSync(
      'wmic path win32_VideoController get Name,AdapterRAM /format:csv',
      { timeout: 8_000, windowsHide: true }
    ).toString();

    const lines = result.split('\n').filter(l => l.includes(',') && !l.startsWith('Node'));
    if (lines.length === 0) return {};

    const best = lines
      .map(line => {
        const parts = line.split(',');
        const ram = parseInt(parts[1] ?? '0', 10);
        const name = (parts[2] ?? '').trim();
        return { name, vramMB: Math.round(ram / (1024 * 1024)) };
      })
      .filter(g => g.name && g.vramMB > 0)
      .sort((a, b) => b.vramMB - a.vramMB)[0];

    return best ?? {};
  } catch {
    return {};
  }
}

// ── Storage detection ──────────────────────────────────────────────────────

function queryStorageGB(): number {
  try {
    const result = execSync(
      'wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /format:csv',
      { timeout: 5_000, windowsHide: true }
    ).toString();

    const lines = result.split('\n').filter(l => l.includes(',') && !l.startsWith('Node'));
    const freeBytes = parseInt((lines[0] ?? '').split(',')[1] ?? '0', 10);
    return Math.round(freeBytes / (1024 * 1024 * 1024));
  } catch {
    return 0;
  }
}

// ── Browser profile detection ──────────────────────────────────────────────

function detectBrowserProfiles(): string[] {
  const found: string[] = [];
  for (const b of BROWSER_PROFILE_PATHS) {
    if (fs.existsSync(b.profilePath)) {
      found.push(b.name);
    }
  }
  return found;
}

// ── App matching ───────────────────────────────────────────────────────────

function matchApps(registryNames: string[]): DetectedApp[] {
  const found: DetectedApp[] = [];
  const registryLower = registryNames.map(n => n.toLowerCase());

  for (const def of APP_DEFS) {
    // 1. Try registry match
    const inRegistry = def.registryKeywords.some(kw =>
      registryLower.some(name => name.includes(kw.toLowerCase()))
    );

    if (inRegistry) {
      found.push({
        name: def.name,
        path: '',
        exportFormats: def.exportFormats,
        incomeRelevant: def.incomeRelevant,
      });
      continue;
    }

    // 2. Fallback: well-known path check
    for (const p of def.wellKnownPaths) {
      const checkPath = p.endsWith('.exe') ? p : p;
      if (fs.existsSync(checkPath)) {
        found.push({
          name: def.name,
          path: checkPath,
          exportFormats: def.exportFormats,
          incomeRelevant: def.incomeRelevant,
        });
        break;
      }
    }
  }

  return found;
}

// ── Connected platform inference ───────────────────────────────────────────
// Inferred from which credential keys are set in the store.
// credentialKeys is passed in from ipc.ts — capabilityScanner stays pure.

const PLATFORM_CREDENTIAL_MAP: Record<string, string> = {
  youtube_client_id:    'YouTube',
  tiktok_access_token:  'TikTok',
  gumroad_access_token: 'Gumroad',
  itch_api_key:         'Itch.io',
  twitter_api_key:      'Twitter / X',
  slack_token:          'Slack',
  github_token:         'GitHub',
  smtp_host:            'Email (SMTP)',
  telegram_bot_token:   'Telegram',
};

export function inferConnectedPlatforms(setCredentialKeys: string[]): string[] {
  const connected: string[] = [];
  for (const [key, platform] of Object.entries(PLATFORM_CREDENTIAL_MAP)) {
    if (setCredentialKeys.includes(key)) {
      connected.push(platform);
    }
  }
  return connected;
}

// ── Main scanner ───────────────────────────────────────────────────────────

export async function runCapabilityScan(
  setCredentialKeys: string[] = []
): Promise<CapabilityScanResult> {
  const scannedAt = Date.now();

  // Run all scans; partial failures degrade gracefully
  const registryNames = queryRegistry();
  const installedApps = matchApps(registryNames);
  const gpu = queryGpu();
  const storageGB = queryStorageGB();
  const browserProfiles = detectBrowserProfiles();
  const connectedPlatforms = inferConnectedPlatforms(setCredentialKeys);

  return {
    scannedAt,
    installedApps,
    gpuName: gpu.name,
    gpuVramMB: gpu.vramMB,
    storageGB,
    connectedPlatforms,
    browserProfiles,
  };
}
