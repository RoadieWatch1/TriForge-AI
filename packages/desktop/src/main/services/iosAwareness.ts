// ── iosAwareness.ts ───────────────────────────────────────────────────────────
//
// Phase 3 — iOS Awareness: Simulator + Device Detection
//
// Detects the full iOS development environment:
//   - Xcode installation + running state
//   - Available iOS simulators (via xcrun simctl list devices --json)
//   - Booted simulators (ready for install/launch)
//   - Connected real devices (via xcrun devicectl list devices)
//   - Active Xcode project (from frontmost window title)
//   - Available build schemes (from xcodebuild -list)
//
// TRULY IMPLEMENTED:
//   - Simulator enumeration + state (booted/shutdown)
//   - Real device enumeration (when connected via USB/WiFi)
//   - Xcode process detection
//   - Project detection from Xcode window title
//   - Xcode CLT availability probe (xcrun --find xcodebuild)
//
// NOT HERE:
//   - Automatic scheme selection
//   - Provisioning profile validation
//   - Code signing checks

import { exec }  from 'child_process';
import fs        from 'fs';
import path      from 'path';
import os        from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SimulatorState = 'Booted' | 'Shutdown' | 'Booting' | 'ShuttingDown' | 'unknown';

export interface SimulatorDevice {
  udid: string;
  name: string;
  state: SimulatorState;
  /** e.g. "iOS 17.2" */
  runtime: string;
  isAvailable: boolean;
  /** e.g. "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro" */
  deviceTypeIdentifier: string;
  lastBootedAt?: string;
}

export interface RealDevice {
  identifier: string;
  name: string;
  osVersion: string;
  deviceType: string;
  connectionType: 'usb' | 'wifi' | 'unknown';
}

export interface iOSAwarenessSnapshot {
  /** xcrun + xcodebuild available on PATH */
  xcodeCLTAvailable: boolean;
  /** Xcode.app installed at /Applications/Xcode.app */
  xcodeInstalled: boolean;
  /** Xcode process currently running */
  xcodeRunning: boolean;
  /** All iOS simulators (booted + shutdown) */
  simulators: SimulatorDevice[];
  /** Only currently booted simulators */
  bootedSimulators: SimulatorDevice[];
  /** Connected real iOS devices */
  realDevices: RealDevice[];
  /** Project name extracted from Xcode window title */
  activeProjectName?: string;
  /** Full path if detectable */
  activeProjectPath?: string;
  capturedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeExec(cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) =>
      resolve(err ? '' : (stdout ?? '').trim()),
    );
  });
}

// ── Xcode detection ────────────────────────────────────────────────────────────

async function checkXcodeCLT(): Promise<boolean> {
  const out = await safeExec('xcrun --find xcodebuild', 3000);
  return out.length > 0 && !out.includes('error');
}

function checkXcodeInstalled(): boolean {
  return fs.existsSync('/Applications/Xcode.app');
}

function isXcodeRunning(runningApps: string[]): boolean {
  return runningApps.some(a => a.toLowerCase().includes('xcode'));
}

// ── Simulator detection ────────────────────────────────────────────────────────

/**
 * Parse xcrun simctl list devices --json output into SimulatorDevice[].
 * Only returns iOS simulators (filters out watchOS, tvOS, visionOS).
 */
async function listSimulators(): Promise<SimulatorDevice[]> {
  const raw = await safeExec('xcrun simctl list devices --json', 8000);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as {
      devices: Record<string, Array<{
        udid: string;
        name: string;
        state: string;
        isAvailable: boolean;
        deviceTypeIdentifier: string;
        lastBootedAt?: string;
      }>>;
    };

    const devices: SimulatorDevice[] = [];

    for (const [runtimeKey, devList] of Object.entries(parsed.devices)) {
      // Only iOS — skip watchOS, tvOS, visionOS
      if (!runtimeKey.toLowerCase().includes('ios')) continue;

      // Extract readable runtime string, e.g. "iOS 17.2"
      const runtimeMatch = runtimeKey.match(/iOS-(\d+)-(\d+)/i);
      const runtime = runtimeMatch
        ? `iOS ${runtimeMatch[1]}.${runtimeMatch[2]}`
        : runtimeKey.split('.').pop() ?? runtimeKey;

      for (const dev of devList) {
        if (!dev.isAvailable) continue;
        devices.push({
          udid:                 dev.udid,
          name:                 dev.name,
          state:                (dev.state as SimulatorState) ?? 'unknown',
          runtime,
          isAvailable:          dev.isAvailable,
          deviceTypeIdentifier: dev.deviceTypeIdentifier,
          lastBootedAt:         dev.lastBootedAt,
        });
      }
    }

    // Sort: booted first, then alphabetically
    return devices.sort((a, b) => {
      if (a.state === 'Booted' && b.state !== 'Booted') return -1;
      if (b.state === 'Booted' && a.state !== 'Booted') return 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

// ── Real device detection ──────────────────────────────────────────────────────

/**
 * List connected real iOS/iPadOS devices via xcrun devicectl.
 * Writes JSON to a tmp file (devicectl requires --json-output flag).
 * Returns empty array if no devices or devicectl unavailable.
 */
async function listRealDevices(): Promise<RealDevice[]> {
  const tmpOut = path.join(os.tmpdir(), `tf-devicectl-${Date.now()}.json`);
  try {
    await safeExec(`xcrun devicectl list devices --json-output "${tmpOut}"`, 8000);
    if (!fs.existsSync(tmpOut)) return [];

    const raw    = fs.readFileSync(tmpOut, 'utf8');
    const parsed = JSON.parse(raw) as {
      result?: {
        devices?: Array<{
          identifier: string;
          deviceProperties?: { name?: string; osVersionNumber?: string };
          hardwareProperties?: { deviceType?: string };
          connectionProperties?: { transportType?: string };
        }>;
      };
    };

    return (parsed.result?.devices ?? []).map(d => ({
      identifier:     d.identifier,
      name:           d.deviceProperties?.name ?? 'Unknown Device',
      osVersion:      d.deviceProperties?.osVersionNumber ?? 'unknown',
      deviceType:     d.hardwareProperties?.deviceType ?? 'iPhone',
      connectionType: (d.connectionProperties?.transportType === 'localNetwork' ? 'wifi'
                     : d.connectionProperties?.transportType === 'wired'        ? 'usb'
                     : 'unknown') as 'usb' | 'wifi' | 'unknown',
    }));
  } catch {
    return [];
  } finally {
    try { fs.unlinkSync(tmpOut); } catch { /* best-effort */ }
  }
}

// ── Project detection ──────────────────────────────────────────────────────────

/**
 * Extract project name from Xcode window title.
 * Common formats:
 *   "MyApp — MyApp.xcodeproj"
 *   "MyApp — Not Saved"
 *   "MyApp — Edited"
 */
function parseXcodeWindowTitle(title?: string): { name?: string; path?: string } {
  if (!title) return {};

  // Format: "AppName — scheme/config" or "AppName.xcodeproj — ..."
  const match = title.match(/^(.+?)(?:\.xcodeproj|\.xcworkspace)?\s*(?:[-—]\s*.+)?$/i);
  if (match) return { name: match[1].trim() };

  return {};
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a full iOS awareness snapshot.
 * Runs simctl, devicectl, and checks process list in parallel.
 *
 * @param runningApps          From OperatorService.listRunningApps()
 * @param frontmostWindowTitle Window title of frontmost app (for project detection)
 */
export async function buildIOSAwarenessSnapshot(
  runningApps: string[],
  frontmostWindowTitle?: string,
): Promise<iOSAwarenessSnapshot> {
  const xcodeRunning = isXcodeRunning(runningApps);

  // Parallel: CLT check + simulator list + device list
  const [xcodeCLT, simulators, realDevices] = await Promise.all([
    checkXcodeCLT(),
    listSimulators(),
    listRealDevices(),
  ]);

  const bootedSimulators = simulators.filter(s => s.state === 'Booted');

  // Project from window title (only meaningful when Xcode is frontmost)
  const { name: activeProjectName } = xcodeRunning
    ? parseXcodeWindowTitle(frontmostWindowTitle)
    : {};

  return {
    xcodeCLTAvailable:  xcodeCLT,
    xcodeInstalled:     checkXcodeInstalled(),
    xcodeRunning,
    simulators,
    bootedSimulators,
    realDevices,
    activeProjectName,
    capturedAt: Date.now(),
  };
}

/**
 * Boot a simulator by UDID. Returns true if boot command succeeded.
 * Boot is async on the simulator side — poll state with listSimulators() to confirm.
 */
export async function bootSimulator(udid: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    exec(`xcrun simctl boot "${udid}"`, { timeout: 30_000 }, (err, _stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        // "already booted" is not a real error
        if (msg.toLowerCase().includes('already booted')) resolve({ ok: true });
        else resolve({ ok: false, error: msg });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

/**
 * Capture a screenshot from a booted simulator.
 * Returns the path to the saved PNG, or an error.
 */
export async function captureSimulatorScreen(
  udid: string,
  outputPath?: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const dest = outputPath ?? path.join(os.tmpdir(), `tf-sim-${Date.now()}.png`);
  return new Promise(resolve => {
    exec(`xcrun simctl io "${udid}" screenshot "${dest}"`, { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) resolve({ ok: false, error: stderr?.trim() || err.message });
      else resolve({ ok: true, path: dest });
    });
  });
}

/**
 * Format a compact awareness summary for council injection.
 */
export function formatIOSSummary(snapshot: iOSAwarenessSnapshot): string {
  const parts: string[] = [];

  if (!snapshot.xcodeCLTAvailable) {
    return 'Xcode Command Line Tools not found. Install via: xcode-select --install';
  }

  if (snapshot.xcodeRunning) {
    parts.push(`Xcode running${snapshot.activeProjectName ? ` (project: ${snapshot.activeProjectName})` : ''}`);
  }

  if (snapshot.bootedSimulators.length > 0) {
    const names = snapshot.bootedSimulators.map(s => `${s.name} (${s.runtime})`).join(', ');
    parts.push(`Booted simulators: ${names}`);
  } else {
    parts.push(`${snapshot.simulators.length} simulators available (none booted)`);
  }

  if (snapshot.realDevices.length > 0) {
    const names = snapshot.realDevices.map(d => `${d.name} iOS ${d.osVersion}`).join(', ');
    parts.push(`Connected devices: ${names}`);
  }

  return parts.join('. ') + '.';
}
