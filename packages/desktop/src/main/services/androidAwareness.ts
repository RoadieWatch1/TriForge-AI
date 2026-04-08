// ── androidAwareness.ts ───────────────────────────────────────────────────────
//
// Phase 3 — Android Awareness: Device + Emulator Detection
//
// Detects the full Android development environment:
//   - ADB binary location (probes $ANDROID_HOME, $PATH, known SDK paths)
//   - Connected real devices (adb devices -l)
//   - Running emulators (adb devices + emulator process list)
//   - Available AVDs (emulator -list-avds)
//   - Android Studio process running
//   - Active Gradle project (from window title or cwd)
//
// TRULY IMPLEMENTED:
//   - Multi-path ADB discovery (env vars, known macOS/Linux locations)
//   - Connected device enumeration with model + Android version via getprop
//   - Running emulator detection
//   - AVD list via emulator -list-avds
//   - Gradle wrapper detection (./gradlew in cwd)
//
// NOT HERE:
//   - Automatic APK signing
//   - Provisioning / keystore management
//   - ADB over WiFi pairing flow

import { exec }  from 'child_process';
import fs        from 'fs';
import path      from 'path';
import os        from 'os';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AndroidDeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';

export interface AndroidDevice {
  serial: string;           // e.g. "emulator-5554" or "R58M47XXXXX"
  state: AndroidDeviceState;
  isEmulator: boolean;
  model?: string;           // from ro.product.model
  androidVersion?: string;  // from ro.build.version.release
  apiLevel?: string;        // from ro.build.version.sdk
  transport: 'usb' | 'wifi' | 'emulator';
}

export interface AndroidAVD {
  name: string;             // AVD name (used to launch: emulator @name)
  /** True if this AVD is currently running (matched against emulator-XXXX serial) */
  running: boolean;
}

export interface AndroidGradleProject {
  rootPath: string;
  hasWrapper: boolean;
  gradlePath: string;       // ./gradlew or absolute path
  /** Inferred from typical output path convention */
  expectedApkPath: string;
}

export interface AndroidAwarenessSnapshot {
  /** Resolved path to the adb binary, or null if not found */
  adbPath: string | null;
  adbAvailable: boolean;
  androidStudioRunning: boolean;
  /** All connected devices + running emulators */
  devices: AndroidDevice[];
  /** Only real physical devices */
  realDevices: AndroidDevice[];
  /** Only emulator instances */
  emulators: AndroidDevice[];
  /** Available AVD names (from emulator -list-avds) */
  avds: AndroidAVD[];
  /** Detected Gradle project if Android Studio is frontmost */
  gradleProject?: AndroidGradleProject;
  capturedAt: number;
}

// ── ADB Discovery ─────────────────────────────────────────────────────────────

const KNOWN_ADB_PATHS = [
  // $ANDROID_HOME / $ANDROID_SDK_ROOT (set by Android Studio)
  ...(process.env.ANDROID_HOME     ? [path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb')]     : []),
  ...(process.env.ANDROID_SDK_ROOT ? [path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb')] : []),
  // macOS default (Android Studio installs here)
  path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  // Linux default
  path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
  // Homebrew / manual installs
  '/usr/local/bin/adb',
  '/opt/homebrew/bin/adb',
  // Windows (future)
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
];

const KNOWN_EMULATOR_PATHS = [
  ...(process.env.ANDROID_HOME ? [path.join(process.env.ANDROID_HOME, 'emulator', 'emulator')] : []),
  path.join(os.homedir(), 'Library', 'Android', 'sdk', 'emulator', 'emulator'),
  path.join(os.homedir(), 'Android', 'Sdk', 'emulator', 'emulator'),
  '/usr/local/bin/emulator',
  '/opt/homebrew/bin/emulator',
];

function safeExec(cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) =>
      resolve(err ? '' : (stdout ?? '').trim()),
    );
  });
}

async function resolveAdb(): Promise<string | null> {
  // 1. Check known paths first (fastest)
  for (const p of KNOWN_ADB_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  // 2. Probe PATH
  const fromPath = await safeExec('which adb', 3000);
  if (fromPath && !fromPath.includes('not found')) return fromPath;
  return null;
}

async function resolveEmulator(): Promise<string | null> {
  for (const p of KNOWN_EMULATOR_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  const fromPath = await safeExec('which emulator', 3000);
  if (fromPath && !fromPath.includes('not found')) return fromPath;
  return null;
}

// ── Device enumeration ─────────────────────────────────────────────────────────

/** Parse `adb devices -l` output into AndroidDevice[] */
async function listDevices(adbPath: string): Promise<AndroidDevice[]> {
  const raw = await safeExec(`"${adbPath}" devices -l`, 6000);
  if (!raw) return [];

  const lines = raw.split('\n').slice(1); // skip "List of devices attached" header
  const devices: AndroidDevice[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const serial = parts[0];
    const state  = parts[1] as AndroidDeviceState;
    if (!serial || !state) continue;

    const isEmulator = serial.startsWith('emulator-');
    const transport: AndroidDevice['transport'] = isEmulator ? 'emulator'
      : serial.includes('.') ? 'wifi'   // WiFi adb (IP:port or mDNS)
      : 'usb';

    const dev: AndroidDevice = { serial, state, isEmulator, transport };

    // Fetch device properties (best-effort, only for 'device' state)
    if (state === 'device') {
      const [model, version, api] = await Promise.all([
        safeExec(`"${adbPath}" -s "${serial}" shell getprop ro.product.model`, 3000),
        safeExec(`"${adbPath}" -s "${serial}" shell getprop ro.build.version.release`, 3000),
        safeExec(`"${adbPath}" -s "${serial}" shell getprop ro.build.version.sdk`, 3000),
      ]);
      if (model)   dev.model          = model.trim();
      if (version) dev.androidVersion = version.trim();
      if (api)     dev.apiLevel       = api.trim();
    }

    devices.push(dev);
  }

  return devices;
}

// ── AVD enumeration ────────────────────────────────────────────────────────────

async function listAVDs(
  emulatorPath: string | null,
  runningEmulators: AndroidDevice[],
): Promise<AndroidAVD[]> {
  // Try emulator -list-avds
  const raw = emulatorPath
    ? await safeExec(`"${emulatorPath}" -list-avds`, 6000)
    : '';

  // Also check ~/.android/avd/*.avd directories as fallback
  const avdDir = path.join(os.homedir(), '.android', 'avd');
  let avdNames: string[] = [];

  if (raw) {
    avdNames = raw.split('\n').map(l => l.trim()).filter(Boolean);
  } else {
    try {
      avdNames = fs.existsSync(avdDir)
        ? fs.readdirSync(avdDir)
            .filter(f => f.endsWith('.avd'))
            .map(f => f.replace(/\.avd$/, ''))
        : [];
    } catch { /* skip */ }
  }

  const runningSerials = new Set(runningEmulators.map(e => e.serial));

  return avdNames.map(name => ({
    name,
    // Heuristic: emulator serials are emulator-5554, -5556, etc.
    // We can't perfectly map serial→AVD name without extra getprop calls,
    // so mark any as running if any emulator is running
    running: runningSerials.size > 0 && raw.length > 0,
  }));
}

// ── Gradle project detection ───────────────────────────────────────────────────

function detectGradleProject(projectPath?: string): AndroidGradleProject | undefined {
  const candidates = [
    projectPath,
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const root of candidates) {
    const wrapper = path.join(root, 'gradlew');
    if (fs.existsSync(wrapper)) {
      return {
        rootPath: root,
        hasWrapper: true,
        gradlePath: wrapper,
        expectedApkPath: path.join(root, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      };
    }
  }
  return undefined;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function buildAndroidAwarenessSnapshot(
  runningApps: string[],
  projectPath?: string,
): Promise<AndroidAwarenessSnapshot> {
  const androidStudioRunning = runningApps.some(a =>
    a.toLowerCase().includes('android studio') || a.toLowerCase().includes('studio'),
  );

  // Parallel: resolve adb + emulator paths
  const [adbPath, emulatorPath] = await Promise.all([
    resolveAdb(),
    resolveEmulator(),
  ]);

  let devices: AndroidDevice[] = [];
  if (adbPath) {
    devices = await listDevices(adbPath);
  }

  const emulators   = devices.filter(d => d.isEmulator);
  const realDevices = devices.filter(d => !d.isEmulator);

  const avds = await listAVDs(emulatorPath, emulators);

  const gradleProject = detectGradleProject(projectPath);

  return {
    adbPath,
    adbAvailable: adbPath !== null,
    androidStudioRunning,
    devices,
    realDevices,
    emulators,
    avds,
    gradleProject,
    capturedAt: Date.now(),
  };
}

// ── ADB helpers ────────────────────────────────────────────────────────────────

/** Take a screenshot on a connected device/emulator. Returns PNG file path. */
export async function captureAndroidScreen(
  adbPath: string,
  serial: string,
  outputPath?: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const dest = outputPath ?? path.join(os.tmpdir(), `tf-android-${Date.now()}.png`);
  return new Promise(resolve => {
    // adb exec-out screencap -p writes raw PNG bytes to stdout
    const { spawn } = require('child_process') as typeof import('child_process');
    const proc = spawn(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {
      timeout: 10_000,
    });
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', (code: number) => {
      if (code !== 0) {
        resolve({ ok: false, error: `adb screencap exited with code ${code}` });
        return;
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 100) {
        resolve({ ok: false, error: 'Screenshot returned empty data. Device may be asleep.' });
        return;
      }
      fs.writeFile(dest, buf, err => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, path: dest });
      });
    });
    proc.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
  });
}

/** Send a tap at (x, y) on a device. */
export async function androidTap(
  adbPath: string,
  serial: string,
  x: number,
  y: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    exec(
      `"${adbPath}" -s "${serial}" shell input tap ${x} ${y}`,
      { timeout: 5000 },
      (err, _stdout, stderr) => {
        if (err) resolve({ ok: false, error: stderr?.trim() || err.message });
        else resolve({ ok: true });
      },
    );
  });
}

/** Type text on a device (escapes spaces for shell). */
export async function androidTypeText(
  adbPath: string,
  serial: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  // adb input text handles alphanumeric; special chars need URL encoding
  const escaped = text.replace(/[^a-zA-Z0-9]/g, char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return new Promise(resolve => {
    exec(
      `"${adbPath}" -s "${serial}" shell input text "${escaped}"`,
      { timeout: 8000 },
      (err, _stdout, stderr) => {
        if (err) resolve({ ok: false, error: stderr?.trim() || err.message });
        else resolve({ ok: true });
      },
    );
  });
}

/** Launch an app by package + activity. */
export async function androidLaunchApp(
  adbPath: string,
  serial: string,
  packageName: string,
  activity?: string,
): Promise<{ ok: boolean; error?: string }> {
  const target = activity ? `${packageName}/${activity}` : packageName;
  const cmd = activity
    ? `"${adbPath}" -s "${serial}" shell am start -n "${target}"`
    : `"${adbPath}" -s "${serial}" shell monkey -p "${packageName}" -c android.intent.category.LAUNCHER 1`;

  return new Promise(resolve => {
    exec(cmd, { timeout: 10000 }, (err, _stdout, stderr) => {
      if (err) resolve({ ok: false, error: stderr?.trim() || err.message });
      else resolve({ ok: true });
    });
  });
}

/** Format a compact awareness summary for council injection. */
export function formatAndroidSummary(snapshot: AndroidAwarenessSnapshot): string {
  if (!snapshot.adbAvailable) {
    return 'ADB not found. Install Android Studio or add platform-tools to PATH.';
  }

  const parts: string[] = [];

  if (snapshot.androidStudioRunning) parts.push('Android Studio running');

  if (snapshot.realDevices.length > 0) {
    const names = snapshot.realDevices
      .filter(d => d.state === 'device')
      .map(d => `${d.model ?? d.serial} (Android ${d.androidVersion ?? '?'})`)
      .join(', ');
    if (names) parts.push(`Connected devices: ${names}`);
  }

  if (snapshot.emulators.length > 0) {
    parts.push(`Running emulators: ${snapshot.emulators.map(e => e.serial).join(', ')}`);
  } else if (snapshot.avds.length > 0) {
    parts.push(`${snapshot.avds.length} AVDs available (none running)`);
  }

  if (snapshot.gradleProject) {
    parts.push(`Gradle project: ${snapshot.gradleProject.rootPath}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : 'No Android devices or emulators detected.';
}
