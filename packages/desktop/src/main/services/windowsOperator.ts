// ── windowsOperator.ts ────────────────────────────────────────────────────────
//
// Phase 4 — Windows Operator Substrate
//
// PowerShell-backed implementations of every OperatorService primitive on Windows.
// No native addons required — PowerShell ships with every Windows 7+ installation
// and has full access to user32.dll via P/Invoke + .NET APIs.
//
// IMPLEMENTED:
//   - listRunningApps()      — Get-Process | visible windows only
//   - getFrontmostTarget()   — GetForegroundWindow + GetWindowThreadProcessId
//   - focusApp()             — SetForegroundWindow via process handle
//   - captureScreen()        — System.Drawing CopyFromScreen → PNG
//   - typeText()             — System.Windows.Forms.SendKeys.SendWait
//   - sendKey()              — SendKeys with modifier prefix strings
//   - clickAt()              — SetCursorPos + mouse_event (left/right/double)
//   - checkPermissions()     — Windows has no Accessibility gate (always true)
//                              Screen recording: verify .NET Drawing is available
//
// NOT HERE:
//   - Per-monitor DPI scaling adjustments (uses primary screen coordinates)
//   - UAC elevation detection
//   - Windows Hello / Credential Guard integration

import { exec }    from 'child_process';
import path        from 'path';
import os          from 'os';

// ── Helpers ───────────────────────────────────────────────────────────────────

function shellExecPs(script: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // -NonInteractive: no prompts; -NoProfile: faster startup; -Command: inline script
    const child = exec(
      `powershell.exe -NonInteractive -NoProfile -Command "${script.replace(/"/g, '\\"')}"`,
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
        } else {
          resolve((stdout ?? '').trim());
        }
      },
    );
    child.on('error', reject);
  });
}

/**
 * Execute a multi-line PowerShell script passed via -EncodedCommand
 * (avoids quoting hell for complex scripts).
 */
function shellExecPsEncoded(script: string, timeoutMs = 10_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = exec(
      `powershell.exe -NonInteractive -NoProfile -EncodedCommand ${encoded}`,
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
        } else {
          resolve((stdout ?? '').trim());
        }
      },
    );
    child.on('error', reject);
  });
}

// ── P/Invoke type definitions (reused across multiple calls) ──────────────────

const WIN32_USER32_TYPE_DEF = `
using System;
using System.Runtime.InteropServices;
public class Win32User32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
`.trim();

// ── Capability checks ─────────────────────────────────────────────────────────

/**
 * On Windows, Accessibility is not a gated permission — SendKeys and
 * SetForegroundWindow work from any process. Return true if PowerShell is
 * reachable (which it always is on Windows).
 */
export async function checkWindowsAccessibility(): Promise<boolean> {
  try {
    const out = await shellExecPs('Write-Output ok', 3000);
    return out === 'ok';
  } catch {
    return false;
  }
}

/**
 * Screen capture via .NET System.Drawing is always available on Windows.
 * Verify by checking that the assembly loads without error.
 */
export async function checkWindowsScreenRecording(): Promise<boolean> {
  const script = `
Add-Type -AssemblyName System.Drawing
Write-Output ok
  `.trim();
  try {
    const out = await shellExecPsEncoded(script, 5000);
    return out.includes('ok');
  } catch {
    return false;
  }
}

// ── App enumeration ───────────────────────────────────────────────────────────

/**
 * Return the names of all visible (non-background) processes on Windows.
 * Filters to processes that own a visible window (MainWindowTitle != '').
 */
export async function windowsListRunningApps(): Promise<string[]> {
  const script = `
Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.ProcessName } | Sort-Object -Unique
  `.trim();
  try {
    const raw = await shellExecPsEncoded(script, 8000);
    return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Frontmost window ──────────────────────────────────────────────────────────

export interface WindowsTarget {
  appName: string;
  windowTitle: string;
}

/**
 * Return the foreground window's process name and title.
 * Uses GetForegroundWindow → GetWindowThreadProcessId → Get-Process.
 */
export async function windowsGetFrontmostTarget(): Promise<WindowsTarget | null> {
  const script = `
Add-Type -TypeDefinition @'
${WIN32_USER32_TYPE_DEF}
'@
$hwnd = [Win32User32]::GetForegroundWindow()
$pid = 0
[Win32User32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
if ($proc) {
  Write-Output ($proc.ProcessName + '|' + $proc.MainWindowTitle)
}
  `.trim();
  try {
    const raw = await shellExecPsEncoded(script, 5000);
    if (!raw) return null;
    const idx = raw.indexOf('|');
    if (idx === -1) return { appName: raw, windowTitle: '' };
    return {
      appName:     raw.slice(0, idx).trim(),
      windowTitle: raw.slice(idx + 1).trim(),
    };
  } catch {
    return null;
  }
}

// ── App focus ─────────────────────────────────────────────────────────────────

/**
 * Bring the named process to the foreground.
 * Matches case-insensitively on ProcessName or MainWindowTitle.
 */
export async function windowsFocusApp(appName: string): Promise<{ ok: boolean; error?: string }> {
  const safeName = appName.replace(/'/g, "''");
  const script = `
Add-Type -TypeDefinition @'
${WIN32_USER32_TYPE_DEF}
'@
$target = Get-Process | Where-Object {
  ($_.ProcessName -like '*${safeName}*' -or $_.MainWindowTitle -like '*${safeName}*') -and $_.MainWindowHandle -ne 0
} | Sort-Object { $_.MainWindowTitle.Length } -Descending | Select-Object -First 1
if ($target) {
  [Win32User32]::ShowWindow($target.MainWindowHandle, 9) | Out-Null
  [Win32User32]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
  Write-Output ok
} else {
  Write-Error "Process not found: ${safeName}"
}
  `.trim();
  try {
    const out = await shellExecPsEncoded(script, 8000);
    if (out.includes('ok')) return { ok: true };
    return { ok: false, error: `Could not focus: ${appName}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────────

/**
 * Capture the primary screen to a PNG file using .NET System.Drawing.
 * Works on all Windows versions with .NET Framework 4.x+ (always present).
 */
export async function windowsCaptureScreen(outputPath: string): Promise<{ ok: boolean; error?: string }> {
  // Escape backslashes for PowerShell string
  const dest = outputPath.replace(/\\/g, '\\\\');
  // Use GetSystemMetrics(SM_CXSCREEN=0 / SM_CYSCREEN=1) which returns PHYSICAL pixels —
  // the same coordinate space that SetCursorPos / mouse_event use.
  // This ensures screenshot pixel coordinates exactly match click coordinates on any DPI.
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System.Runtime.InteropServices;
public class TfSM { [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n); }
'@
$w = [TfSM]::GetSystemMetrics(0)
$h = [TfSM]::GetSystemMetrics(1)
$bitmap = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($w, $h))
$bitmap.Save('${dest}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bitmap.Dispose()
Write-Output ok
  `.trim();
  try {
    const out = await shellExecPsEncoded(script, 15_000);
    if (out.includes('ok')) return { ok: true };
    return { ok: false, error: 'Screenshot script did not confirm success.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Keyboard input ────────────────────────────────────────────────────────────

/**
 * Type arbitrary text into the currently focused window.
 * Uses System.Windows.Forms.SendKeys — respects the current IME / keyboard layout.
 * Special SendKeys characters ({ } + ^ % ~) are escaped automatically.
 */
export async function windowsTypeText(text: string): Promise<{ ok: boolean; error?: string }> {
  // Escape SendKeys special characters
  const escaped = text.replace(/[+^%~(){}[\]]/g, c => `{${c}}`);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
Write-Output ok
  `.trim();
  try {
    const out = await shellExecPsEncoded(script, 10_000);
    if (out.includes('ok')) return { ok: true };
    return { ok: false, error: 'SendKeys did not complete.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Semantic key name → SendKeys string mapping for Windows.
 * Modifiers: + = Shift, ^ = Ctrl, % = Alt
 */
const WIN_KEY_MAP: Record<string, string> = {
  return:    '{ENTER}',
  enter:     '{ENTER}',
  escape:    '{ESC}',
  tab:       '{TAB}',
  space:     ' ',
  delete:    '{DEL}',
  backspace: '{BS}',
  up:        '{UP}',
  down:      '{DOWN}',
  left:      '{LEFT}',
  right:     '{RIGHT}',
  home:      '{HOME}',
  end:       '{END}',
  pageup:    '{PGUP}',
  pagedown:  '{PGDN}',
  f1:  '{F1}',  f2:  '{F2}',  f3:  '{F3}',  f4:  '{F4}',
  f5:  '{F5}',  f6:  '{F6}',  f7:  '{F7}',  f8:  '{F8}',
  f9:  '{F9}',  f10: '{F10}', f11: '{F11}', f12: '{F12}',
};

const WIN_MOD_MAP: Record<string, string> = {
  shift: '+',
  cmd:   '^',   // Ctrl is the Windows equivalent of Cmd
  ctrl:  '^',
  alt:   '%',
};

/**
 * Send a keyboard shortcut via SendKeys.
 * Modifiers wrap the key: e.g. Ctrl+C → '^c', Ctrl+Shift+S → '^+s'
 */
export async function windowsSendKey(
  key: string,
  modifiers: Array<'cmd' | 'shift' | 'alt' | 'ctrl'>,
): Promise<{ ok: boolean; error?: string }> {
  const keyLower = key.toLowerCase();
  const keyStr   = WIN_KEY_MAP[keyLower] ?? (key.length === 1 ? key : null);
  if (!keyStr) return { ok: false, error: `Unknown key: "${key}"` };

  const modPrefix = modifiers.map(m => WIN_MOD_MAP[m] ?? '').join('');
  const sendStr   = `${modPrefix}${keyStr}`;

  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${sendStr.replace(/'/g, "''")}')
Write-Output ok
  `.trim();
  try {
    const out = await shellExecPsEncoded(script, 8000);
    if (out.includes('ok')) return { ok: true };
    return { ok: false, error: 'SendKeys did not complete.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Mouse click ───────────────────────────────────────────────────────────────

const MOUSEEVENTF_LEFTDOWN  = 0x0002;
const MOUSEEVENTF_LEFTUP    = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP   = 0x0010;

/**
 * Move the cursor to (x, y) and send a click.
 * Supports left, right, and double-click.
 */
export async function windowsClickAt(
  x: number,
  y: number,
  button: 'left' | 'right' | 'double' = 'left',
): Promise<{ ok: boolean; error?: string }> {
  const clicks = button === 'double' ? 2 : 1;

  const clickBlock = Array.from({ length: clicks }).map(() => `
[Win32User32]::mouse_event(${MOUSEEVENTF_LEFTDOWN}, 0, 0, 0, [UIntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 30
[Win32User32]::mouse_event(${MOUSEEVENTF_LEFTUP}, 0, 0, 0, [UIntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 30
  `.trim()).join('\n');

  const rightBlock = button === 'right' ? `
[Win32User32]::mouse_event(${MOUSEEVENTF_RIGHTDOWN}, 0, 0, 0, [UIntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 30
[Win32User32]::mouse_event(${MOUSEEVENTF_RIGHTUP}, 0, 0, 0, [UIntPtr]::Zero) | Out-Null
  `.trim() : '';

  const script = `
Add-Type -TypeDefinition @'
${WIN32_USER32_TYPE_DEF}
'@
[Win32User32]::SetCursorPos(${x}, ${y}) | Out-Null
Start-Sleep -Milliseconds 50
${button === 'right' ? rightBlock : clickBlock}
Write-Output ok
  `.trim();

  try {
    const out = await shellExecPsEncoded(script, 8000);
    if (out.includes('ok')) return { ok: true };
    return { ok: false, error: 'Click script did not confirm success.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Capability map ─────────────────────────────────────────────────────────────

/**
 * Build a Windows capability snapshot.
 * On Windows, Accessibility is not separately gated — all input actions
 * are available as long as PowerShell is reachable.
 */
export async function buildWindowsCapabilityMap(): Promise<{
  platform: 'Windows';
  canListApps: boolean;
  canGetFrontmost: boolean;
  canFocusApp: boolean;
  canScreenshot: boolean;
  canTypeText: boolean;
  canSendKey: boolean;
  canClickAtCoords: boolean;
  canOCRScreen: boolean;
  accessibilityGranted: boolean;
  screenRecordingGranted: boolean;
}> {
  const [accessOk, screenOk] = await Promise.all([
    checkWindowsAccessibility(),
    checkWindowsScreenRecording(),
  ]);

  return {
    platform:              'Windows',
    canListApps:           accessOk,
    canGetFrontmost:       accessOk,
    canFocusApp:           accessOk,
    canScreenshot:         screenOk,
    canTypeText:           accessOk,
    canSendKey:            accessOk,
    canClickAtCoords:      accessOk,
    canOCRScreen:          screenOk,
    accessibilityGranted:  accessOk,
    screenRecordingGranted: screenOk,
  };
}
