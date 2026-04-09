// ── capabilityScanner.ts ───────────────────────────────────────────────────
//
// Scans the user's desktop (macOS or Windows) for installed creative /
// income-relevant software, GPU capability, browser profiles, and connected
// platforms.
//
// Design rules:
//   - Read-only. Never modifies anything on the user's system.
//   - No network calls. Everything is local OS queries.
//   - Graceful degradation: partial failures return what was found.
//   - Windows: PowerShell registry scan + well-known path fallback.
//   - macOS:   /Applications + ~/Applications scan + system_profiler fallback.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { CapabilityScanResult, DetectedApp } from './store';

const IS_MAC     = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

// ── Known app definitions ──────────────────────────────────────────────────
// Each entry describes how to detect an app and which income lanes it helps.
// `macAppNames` are bundle names (e.g. "Adobe Photoshop 2024.app").

interface AppDef {
  name: string;
  registryKeywords: string[];     // substrings to match in Windows registry DisplayName
  wellKnownPaths: string[];       // Windows fallback paths to check if registry scan fails
  macAppNames: string[];          // macOS .app bundle names to look for in /Applications
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
    macAppNames: [
      'Adobe Photoshop 2024.app',
      'Adobe Photoshop 2025.app',
      'Adobe Photoshop 2026.app',
      'Adobe Photoshop CC 2019.app',
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
    macAppNames: [
      'Adobe Illustrator 2024.app',
      'Adobe Illustrator 2025.app',
      'Adobe Illustrator 2026.app',
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
    macAppNames: [
      'Adobe Premiere Pro 2024.app',
      'Adobe Premiere Pro 2025.app',
      'Adobe Premiere Pro 2026.app',
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
    macAppNames: [
      'Adobe After Effects 2024.app',
      'Adobe After Effects 2025.app',
      'Adobe After Effects 2026.app',
    ],
    exportFormats: ['MP4', 'MOV', 'GIF'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand', 'asset_packs'],
  },
  {
    name: 'Adobe Audition',
    registryKeywords: ['Adobe Audition'],
    wellKnownPaths: ['C:\\Program Files\\Adobe\\Adobe Audition 2024'],
    macAppNames: [
      'Adobe Audition 2024.app',
      'Adobe Audition 2025.app',
    ],
    exportFormats: ['MP3', 'WAV', 'AIFF', 'FLAC'],
    incomeRelevant: ['ai_music', 'faceless_youtube'],
  },
  {
    name: 'Canva',
    registryKeywords: ['Canva'],
    wellKnownPaths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Canva', 'Canva.exe'),
    ],
    macAppNames: ['Canva.app'],
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
    macAppNames: ['Blender.app'],
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
    macAppNames: [
      'Epic Games Launcher.app',
      'UnrealEditor.app',
    ],
    exportFormats: ['EXE', 'PAK', 'MP4'],
    incomeRelevant: ['mini_games'],
  },
  {
    name: 'DaVinci Resolve',
    registryKeywords: ['DaVinci Resolve'],
    wellKnownPaths: ['C:\\Program Files\\Blackmagic Design\\DaVinci Resolve'],
    macAppNames: ['DaVinci Resolve.app'],
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
    macAppNames: ['FL Studio.app'],
    exportFormats: ['MP3', 'WAV', 'FLAC', 'MIDI'],
    incomeRelevant: ['ai_music'],
  },
  {
    name: 'Reaper',
    registryKeywords: ['REAPER'],
    wellKnownPaths: ['C:\\Program Files\\REAPER (x64)'],
    macAppNames: ['REAPER.app'],
    exportFormats: ['MP3', 'WAV', 'FLAC', 'OGG'],
    incomeRelevant: ['ai_music'],
  },
  {
    name: 'Audacity',
    registryKeywords: ['Audacity'],
    wellKnownPaths: ['C:\\Program Files\\Audacity'],
    macAppNames: ['Audacity.app'],
    exportFormats: ['MP3', 'WAV', 'FLAC', 'OGG'],
    incomeRelevant: ['ai_music', 'faceless_youtube'],
  },
  {
    name: 'OBS Studio',
    registryKeywords: ['OBS Studio'],
    wellKnownPaths: ['C:\\Program Files\\obs-studio'],
    macAppNames: ['OBS.app'],
    exportFormats: ['MP4', 'MKV', 'FLV'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand'],
  },
  {
    name: 'Figma',
    registryKeywords: ['Figma'],
    wellKnownPaths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Figma', 'Figma.exe'),
    ],
    macAppNames: ['Figma.app'],
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
    macAppNames: ['Visual Studio Code.app'],
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
    macAppNames: ['Unity Hub.app', 'Unity.app'],
    exportFormats: ['EXE', 'APK', 'WEBGL'],
    incomeRelevant: ['mini_games'],
  },
  // ── macOS-only / Apple-ecosystem apps ──
  {
    name: 'Logic Pro',
    registryKeywords: [],
    wellKnownPaths: [],
    macAppNames: ['Logic Pro.app', 'Logic Pro X.app'],
    exportFormats: ['MP3', 'WAV', 'AIFF', 'AAC', 'CAF'],
    incomeRelevant: ['ai_music'],
  },
  {
    name: 'Final Cut Pro',
    registryKeywords: [],
    wellKnownPaths: [],
    macAppNames: ['Final Cut Pro.app'],
    exportFormats: ['MP4', 'MOV', 'M4V'],
    incomeRelevant: ['faceless_youtube', 'short_form_brand'],
  },
  {
    name: 'Xcode',
    registryKeywords: [],
    wellKnownPaths: [],
    macAppNames: ['Xcode.app'],
    exportFormats: ['IPA', 'APP'],
    incomeRelevant: ['client_services', 'mini_games'],
  },
  {
    name: 'Android Studio',
    registryKeywords: ['Android Studio'],
    wellKnownPaths: [
      'C:\\Program Files\\Android\\Android Studio',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Android Studio'),
    ],
    macAppNames: ['Android Studio.app'],
    exportFormats: ['APK', 'AAB'],
    incomeRelevant: ['client_services', 'mini_games'],
  },
  {
    name: 'Ableton Live',
    registryKeywords: ['Ableton Live'],
    wellKnownPaths: [
      'C:\\ProgramData\\Ableton',
      'C:\\Program Files\\Ableton',
    ],
    macAppNames: [
      'Ableton Live 11 Suite.app',
      'Ableton Live 12 Suite.app',
      'Ableton Live 11 Standard.app',
      'Ableton Live 12 Standard.app',
      'Ableton Live 11 Lite.app',
      'Ableton Live 12 Lite.app',
    ],
    exportFormats: ['MP3', 'WAV', 'AIFF', 'FLAC'],
    incomeRelevant: ['ai_music'],
  },
  {
    name: 'Pro Tools',
    registryKeywords: ['Pro Tools'],
    wellKnownPaths: ['C:\\Program Files\\Avid\\Pro Tools'],
    macAppNames: ['Pro Tools.app'],
    exportFormats: ['MP3', 'WAV', 'AIFF', 'BWF'],
    incomeRelevant: ['ai_music'],
  },
];

// ── Browser definitions ────────────────────────────────────────────────────

const BROWSER_PROFILE_PATHS_WINDOWS: Array<{ name: string; profilePath: string }> = [
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

const BROWSER_PROFILE_PATHS_MAC: Array<{ name: string; profilePath: string }> = [
  {
    name: 'Chrome',
    profilePath: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  },
  {
    name: 'Edge',
    profilePath: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
  },
  {
    name: 'Firefox',
    profilePath: path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles'),
  },
  {
    name: 'Brave',
    profilePath: path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
  },
  {
    name: 'Safari',
    profilePath: path.join(os.homedir(), 'Library', 'Safari'),
  },
];

// ── Windows registry scan ──────────────────────────────────────────────────

function queryRegistryWindows(): string[] {
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

// ── macOS /Applications scan ───────────────────────────────────────────────
//
// Returns the set of bundle names found in /Applications, ~/Applications, and
// the system /Applications/Utilities subdir. We also recursively look one level
// deep into Adobe-style group folders ("Adobe Photoshop 2024/Adobe Photoshop 2024.app").

function listMacAppBundles(): string[] {
  if (!IS_MAC) return [];

  const roots = [
    '/Applications',
    path.join(os.homedir(), 'Applications'),
  ];

  const found = new Set<string>();
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.endsWith('.app')) {
          found.add(e.name);
          continue;
        }
        // Adobe-style nested directory: scan one level deeper
        if (e.isDirectory()) {
          try {
            const sub = fs.readdirSync(path.join(root, e.name), { withFileTypes: true });
            for (const s of sub) {
              if (s.name.endsWith('.app')) found.add(s.name);
            }
          } catch {
            /* ignore unreadable subdir */
          }
        }
      }
    } catch {
      /* ignore unreadable root */
    }
  }
  return Array.from(found);
}

// ── GPU detection ──────────────────────────────────────────────────────────

function queryGpu(): { name?: string; vramMB?: number } {
  if (IS_WINDOWS) {
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

  if (IS_MAC) {
    try {
      const result = execSync(
        'system_profiler SPDisplaysDataType -detailLevel mini',
        { timeout: 8_000 }
      ).toString();

      // Parse the first "Chipset Model:" and "VRAM (Total):" pair we encounter.
      const nameMatch  = result.match(/Chipset Model:\s*(.+)/);
      const vramMatch  = result.match(/VRAM \(.+?\):\s*(\d+)\s*(MB|GB)/i);
      const memoryMatch = result.match(/Metal.*\n.*Total Number of Cores.*\n.*?Memory:\s*(\d+)\s*GB/i);

      let vramMB: number | undefined;
      if (vramMatch) {
        const value = parseInt(vramMatch[1] ?? '0', 10);
        const unit  = (vramMatch[2] ?? 'MB').toUpperCase();
        vramMB = unit === 'GB' ? value * 1024 : value;
      } else if (memoryMatch) {
        // Apple Silicon reports unified memory instead of VRAM
        vramMB = parseInt(memoryMatch[1] ?? '0', 10) * 1024;
      }

      return {
        name:   nameMatch?.[1]?.trim(),
        vramMB,
      };
    } catch {
      return {};
    }
  }

  return {};
}

// ── Storage detection ──────────────────────────────────────────────────────

function queryStorageGB(): number {
  if (IS_WINDOWS) {
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

  if (IS_MAC) {
    try {
      // df -k / → Filesystem 1024-blocks Used Available …
      const result = execSync('df -k /', { timeout: 5_000 }).toString();
      const lines = result.split('\n').filter(Boolean);
      const dataLine = lines[1] ?? '';
      const cols = dataLine.split(/\s+/);
      // Available is column index 3 in df -k output (in 1K blocks)
      const availKB = parseInt(cols[3] ?? '0', 10);
      return Math.round(availKB / (1024 * 1024));
    } catch {
      return 0;
    }
  }

  return 0;
}

// ── Browser profile detection ──────────────────────────────────────────────

function detectBrowserProfiles(): string[] {
  const paths = IS_MAC
    ? BROWSER_PROFILE_PATHS_MAC
    : IS_WINDOWS
      ? BROWSER_PROFILE_PATHS_WINDOWS
      : [];

  const found: string[] = [];
  for (const b of paths) {
    if (fs.existsSync(b.profilePath)) {
      found.push(b.name);
    }
  }
  return found;
}

// ── App matching ───────────────────────────────────────────────────────────

function matchApps(registryNames: string[], macBundles: string[]): DetectedApp[] {
  const found: DetectedApp[] = [];
  const registryLower = registryNames.map(n => n.toLowerCase());
  const bundleLower   = macBundles.map(b => b.toLowerCase());

  for (const def of APP_DEFS) {
    // ── macOS path: check /Applications bundles ──
    if (IS_MAC) {
      const matchedBundle = def.macAppNames.find(n =>
        bundleLower.includes(n.toLowerCase())
      );
      if (matchedBundle) {
        // Resolve full path: prefer /Applications then ~/Applications
        const candidates = [
          path.join('/Applications', matchedBundle),
          path.join(os.homedir(), 'Applications', matchedBundle),
        ];
        const resolved = candidates.find(c => fs.existsSync(c));
        // Adobe-style nested folder fallback
        let nestedFallback: string | undefined;
        if (!resolved) {
          const appBaseName = matchedBundle.replace(/\.app$/i, '');
          const nested = [
            path.join('/Applications', appBaseName, matchedBundle),
            path.join(os.homedir(), 'Applications', appBaseName, matchedBundle),
          ];
          nestedFallback = nested.find(c => fs.existsSync(c));
        }
        found.push({
          name: def.name,
          path: resolved ?? nestedFallback ?? matchedBundle,
          exportFormats: def.exportFormats,
          incomeRelevant: def.incomeRelevant,
        });
        continue;
      }
      // No mac match — skip Windows registry check entirely on Mac
      continue;
    }

    // ── Windows path: registry first, then well-known paths ──
    if (IS_WINDOWS) {
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

      for (const p of def.wellKnownPaths) {
        if (fs.existsSync(p)) {
          found.push({
            name: def.name,
            path: p,
            exportFormats: def.exportFormats,
            incomeRelevant: def.incomeRelevant,
          });
          break;
        }
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
  const registryNames = IS_WINDOWS ? queryRegistryWindows() : [];
  const macBundles    = IS_MAC     ? listMacAppBundles()    : [];
  const installedApps = matchApps(registryNames, macBundles);
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
