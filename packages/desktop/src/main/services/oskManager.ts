// ── oskManager.ts ─────────────────────────────────────────────────────────────
//
// On-Screen Keyboard Manager
//
// TriForge encourages and uses the OS on-screen keyboard (OSK) as the primary
// input source — it gives the AI a safe, visible way to type without needing
// direct keyboard access, and lets users see every keystroke before it happens.
//
// macOS:  Accessibility Keyboard (System Settings → Accessibility → Keyboard)
//         Enabled via `defaults write` + SystemUIServer restart.
//         Also opens Keyboard Viewer for layout reference.
//
// Windows: On-Screen Keyboard (osk.exe) — ships with every Windows installation.
//          No configuration required, instant launch via PowerShell.
//
// TriForge uses the OSK by:
//   1. Checking if OSK is running at startup
//   2. Prompting user to enable it if not running
//   3. Using `click_at` to tap keys on the OSK instead of direct keystroke injection
//   4. Taking before/after screenshots to confirm each key press

import { exec }  from 'child_process';
import os        from 'os';

const IS_MACOS   = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OSKStatus {
  platform:    'macOS' | 'Windows' | 'unsupported';
  running:     boolean;
  processName: string | null;
  /** Whether TriForge should prefer OSK over direct keystroke injection */
  recommended: boolean;
  message:     string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function run(cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) =>
      resolve(err ? '' : (stdout ?? '').trim()),
    );
  });
}

function runPs(script: string, timeoutMs = 8000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve => {
    exec(
      `powershell.exe -NonInteractive -NoProfile -EncodedCommand ${encoded}`,
      { timeout: timeoutMs },
      (err, stdout) => resolve(err ? '' : (stdout ?? '').trim()),
    );
  });
}

// ── macOS ─────────────────────────────────────────────────────────────────────

async function isMacOSKRunning(): Promise<boolean> {
  // The Accessibility Keyboard process is part of TextInputMenuAgent or a
  // WindowServer extension — check via defaults read and process list
  const [defaultsVal, procs] = await Promise.all([
    run(`defaults read com.apple.universalaccess virtualKeyboard 2>/dev/null || echo 0`),
    run(`pgrep -f "KeyboardViewer\|virtualKeyboard\|Accessibility Keyboard" 2>/dev/null`),
  ]);
  return defaultsVal.trim() === '1' || procs.length > 0;
}

async function openMacOSK(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Enable Accessibility Keyboard via defaults
    await run(`defaults write com.apple.universalaccess virtualKeyboard -int 1`, 5000);
    // Restart SystemUIServer so the change takes effect immediately
    await run(`killall SystemUIServer 2>/dev/null || true`, 3000);
    // Also open Keyboard Viewer so user can see the layout
    await run(`open /System/Library/Input\\ Methods/KeyboardViewer.app 2>/dev/null || true`, 3000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function closeMacOSK(): Promise<void> {
  await run(`defaults write com.apple.universalaccess virtualKeyboard -int 0`, 3000);
  await run(`killall SystemUIServer 2>/dev/null || true`, 3000);
  await run(`osascript -e 'quit app "KeyboardViewer"' 2>/dev/null || true`, 3000);
}

// ── Windows ───────────────────────────────────────────────────────────────────

async function isWindowsOSKRunning(): Promise<boolean> {
  const out = await runPs(`
$proc = Get-Process -Name osk -ErrorAction SilentlyContinue
if ($proc) { Write-Output 'running' } else { Write-Output 'stopped' }
  `.trim());
  return out.includes('running');
}

async function openWindowsOSK(): Promise<{ ok: boolean; error?: string }> {
  try {
    await runPs(`Start-Process osk -WindowStyle Normal`, 5000);
    // Give it a moment to appear
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function closeWindowsOSK(): Promise<void> {
  await runPs(`Stop-Process -Name osk -ErrorAction SilentlyContinue`, 5000);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Check whether the on-screen keyboard is currently running. */
export async function getOSKStatus(): Promise<OSKStatus> {
  if (IS_MACOS) {
    const running = await isMacOSKRunning();
    return {
      platform:    'macOS',
      running,
      processName: running ? 'Accessibility Keyboard' : null,
      recommended: true,
      message: running
        ? 'Accessibility Keyboard is active. TriForge will click keys on the on-screen keyboard for safe, visible input.'
        : 'On-screen keyboard is not active. TriForge recommends enabling it for transparent input — tap "Open Keyboard" to enable.',
    };
  }

  if (IS_WINDOWS) {
    const running = await isWindowsOSKRunning();
    return {
      platform:    'Windows',
      running,
      processName: running ? 'osk.exe' : null,
      recommended: true,
      message: running
        ? 'On-Screen Keyboard (osk.exe) is running. TriForge can click keys directly on the keyboard.'
        : 'Windows On-Screen Keyboard is not running. Click "Open Keyboard" to launch it — TriForge uses it as the primary input method.',
    };
  }

  return {
    platform:    'unsupported',
    running:     false,
    processName: null,
    recommended: false,
    message:     'On-screen keyboard management is supported on macOS and Windows.',
  };
}

/**
 * Open the on-screen keyboard.
 * On macOS: enables the Accessibility Keyboard + opens Keyboard Viewer.
 * On Windows: launches osk.exe.
 */
export async function openOSK(): Promise<{ ok: boolean; error?: string }> {
  if (IS_MACOS)   return openMacOSK();
  if (IS_WINDOWS) return openWindowsOSK();
  return { ok: false, error: 'OSK not supported on this platform.' };
}

/** Close the on-screen keyboard. */
export async function closeOSK(): Promise<void> {
  if (IS_MACOS)   await closeMacOSK();
  if (IS_WINDOWS) await closeWindowsOSK();
}

/**
 * Ensure the OSK is open — opens it if not already running.
 * Returns the final status.
 */
export async function ensureOSKOpen(): Promise<{ ok: boolean; wasAlreadyOpen: boolean; error?: string }> {
  const status = await getOSKStatus();
  if (status.running) return { ok: true, wasAlreadyOpen: true };

  const result = await openOSK();
  return { ok: result.ok, wasAlreadyOpen: false, error: result.error };
}

/**
 * Get the approximate screen region where the OSK typically appears.
 * Used by the click_at operator to target keys on the keyboard.
 * Returns normalized to primary screen dimensions.
 */
export async function getOSKBounds(): Promise<{
  estimated: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  if (IS_WINDOWS) {
    // osk.exe typically appears at bottom of screen, ~half-height
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$proc = Get-Process -Name osk -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) {
  # OSK is typically ~800x250 centered at bottom on 1080p
  $w = [Math]::Round($screen.Width * 0.75)
  $h = [Math]::Round($screen.Height * 0.25)
  $x = [Math]::Round(($screen.Width - $w) / 2)
  $y = $screen.Height - $h - 40
  Write-Output "$x,$y,$w,$h"
}
    `.trim();
    const out = await runPs(script, 5000);
    if (out) {
      const [x, y, w, h] = out.split(',').map(Number);
      return { estimated: true, x, y, width: w, height: h };
    }
  }

  if (IS_MACOS) {
    // macOS Accessibility Keyboard floats — default position is bottom-left
    // Return a rough estimate (vision analyzer will refine with screenshot)
    return { estimated: true, x: 0, y: 600, width: 800, height: 270 };
  }

  return null;
}

/**
 * Generate the recommendation message TriForge shows users.
 * Explains why the OSK is preferred and how it keeps them in control.
 */
export function getOSKRecommendationMessage(): string {
  return [
    '💡 TriForge uses your on-screen keyboard as the primary input method.',
    '',
    'Why? The on-screen keyboard:',
    '  • Shows you every key before TriForge presses it',
    '  • Lets you cancel input at any time',
    '  • Works without Accessibility permission on some systems',
    '  • Gives you full visibility into what the AI is typing',
    '',
    IS_WINDOWS
      ? 'Windows On-Screen Keyboard (osk.exe) will open automatically when needed.'
      : 'macOS Accessibility Keyboard will be enabled when TriForge needs to type.',
  ].join('\n');
}
