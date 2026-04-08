// ── unrealEditorOperator.ts ───────────────────────────────────────────────────
//
// Unreal Editor UI Operator — bridges the generic operator primitives
// (operatorService + visionAnalyzer + clickHelper) to Unreal Editor-specific
// UI operations.
//
// This is how TriForge operates inside the user's running Unreal Editor exactly
// as a human with remote-desktop access would: it sees the screen via vision,
// locates UI elements, and clicks or keys them.
//
// TRULY IMPLEMENTED:
//   - focusUnrealEditor()          — bring Unreal Editor window to front
//   - captureEditorScreen()        — screenshot the current editor state
//   - findAndClickCompile()        — vision-locate the Compile button and click it
//   - waitForCompileResult()       — poll screenshots for "Compile Complete" / error text
//   - triggerPlayInEditor()        — vision-locate the Play button and click it
//   - openBlueprintForClass()      — File > Open Blueprint class via keyboard nav
//   - focusContentBrowser()        — click Content Browser tab via vision
//   - getEditorStatus()            — quick snapshot: is editor running, frontmost, responding?
//
// NOT YET:
//   - Remote Control HTTP API (use probeUnrealRemoteControl for availability check)
//   - Windows support (depends on windowsOperator for mouse/key)
//
// Design rules:
//   - Every action is non-destructive until user confirms (approval gates in
//     workflowPackService handle gating; this layer only executes)
//   - Always use visionAnalyzer for element location — never hard-code pixel positions
//   - Every result returns { ok, detail?, screenshotPath? } for transparency

import path  from 'path';
import os    from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';

import { locateElement, analyzeScreen, isElementVisible } from './visionAnalyzer';
import { clickAtCoords } from './clickHelper';

// ── Helpers ───────────────────────────────────────────────────────────────────

const IS_MACOS   = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

function tmpPng(tag: string): string {
  return path.join(os.tmpdir(), `tf-unreal-${tag}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
}

function shellExec(cmd: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else     resolve(stdout?.trim() ?? '');
    });
  });
}

function escapeAS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Common result type ────────────────────────────────────────────────────────

export interface UnrealEditorResult {
  ok:              boolean;
  detail?:         string;
  screenshotPath?: string;
  x?:              number;
  y?:              number;
}

// ── Focus Unreal Editor ───────────────────────────────────────────────────────

/**
 * Bring the Unreal Editor window to front.
 * Tries common Unreal Editor process names across versions.
 */
export async function focusUnrealEditor(): Promise<UnrealEditorResult> {
  const candidates = [
    'Unreal Editor',
    'UE5Editor',
    'UE4Editor',
    'UnrealEditor',
  ];

  if (IS_MACOS) {
    for (const name of candidates) {
      try {
        await shellExec(
          `osascript -e 'tell application "${escapeAS(name)}" to activate'`,
          5000,
        );
        await new Promise(r => setTimeout(r, 800)); // allow focus animation
        return { ok: true, detail: `Focused "${name}"` };
      } catch {
        // try next candidate
      }
    }
    // Fallback: try to activate by process name via System Events
    try {
      await shellExec(
        `osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "UE") to true'`,
        5000,
      );
      await new Promise(r => setTimeout(r, 800));
      return { ok: true, detail: 'Focused Unreal Editor via System Events process search' };
    } catch {
      return { ok: false, detail: 'Could not find or focus Unreal Editor. Is it running?' };
    }
  }

  if (IS_WINDOWS) {
    try {
      // PowerShell: bring UE window to foreground
      await shellExec(
        `powershell -Command "(Get-Process | Where-Object { $_.MainWindowTitle -like '*Unreal*' } | Select-Object -First 1).MainWindowHandle | ForEach-Object { [void][System.Windows.Forms.Form]::new(); Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($_) }"`,
        8000,
      );
      await new Promise(r => setTimeout(r, 800));
      return { ok: true, detail: 'Focused Unreal Editor (Windows)' };
    } catch {
      return { ok: false, detail: 'Could not focus Unreal Editor on Windows.' };
    }
  }

  return { ok: false, detail: 'Platform not supported for editor focus' };
}

// ── Capture Editor Screen ──────────────────────────────────────────────────────

/**
 * Take a screenshot and return the local file path.
 */
export async function captureEditorScreen(): Promise<UnrealEditorResult> {
  const outputPath = tmpPng('screen');

  if (IS_MACOS) {
    try {
      await shellExec(`screencapture -x "${outputPath}"`, 10_000);
      return { ok: true, screenshotPath: outputPath };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  if (IS_WINDOWS) {
    try {
      await shellExec(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save('${outputPath}') }"`,
        15_000,
      );
      return { ok: true, screenshotPath: outputPath };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  return { ok: false, detail: 'Screenshot not supported on this platform.' };
}

// ── Find and Click Compile Button ─────────────────────────────────────────────

/**
 * Screenshot → vision-locate the Compile button → click it.
 *
 * Unreal Editor shows a "Compile" button in the toolbar (top-left area).
 * In Blueprint editors it appears as "Compile" in the top toolbar.
 * We use vision to locate it robustly regardless of window size.
 */
export async function findAndClickCompile(): Promise<UnrealEditorResult> {
  const screenshot = await captureEditorScreen();
  if (!screenshot.ok || !screenshot.screenshotPath) {
    return { ok: false, detail: screenshot.detail ?? 'Screenshot failed before compile click.' };
  }

  const loc = await locateElement(
    screenshot.screenshotPath,
    'the Compile button in the Unreal Editor toolbar — it typically shows a yellow/orange hammer icon with the word "Compile" and may show a green checkmark when up to date',
  );

  if (!loc.found || loc.x === undefined || loc.y === undefined) {
    return {
      ok:             false,
      detail:         'Could not locate the Compile button on screen. Is Unreal Editor open with a Blueprint?',
      screenshotPath: screenshot.screenshotPath,
    };
  }

  const clickResult = await clickAtCoords(loc.x, loc.y, 'left');
  if (!clickResult.ok) {
    return {
      ok:             false,
      detail:         `Compile button found at (${loc.x}, ${loc.y}) but click failed: ${clickResult.error ?? 'unknown'}`,
      screenshotPath: screenshot.screenshotPath,
      x:              loc.x,
      y:              loc.y,
    };
  }

  return {
    ok:             true,
    detail:         `Clicked Compile at (${loc.x}, ${loc.y})`,
    screenshotPath: screenshot.screenshotPath,
    x:              loc.x,
    y:              loc.y,
  };
}

// ── Wait for Compile Result ───────────────────────────────────────────────────

export type CompileOutcome = 'success' | 'error' | 'timeout' | 'unknown';

export interface CompileWaitResult {
  outcome:         CompileOutcome;
  detail:          string;
  screenshotPath?: string;
  elapsedMs:       number;
}

/**
 * Poll screenshots + vision every `pollMs` ms for up to `timeoutMs` ms,
 * checking whether the Unreal Editor compile finished (success or error).
 */
export async function waitForCompileResult(
  timeoutMs = 120_000,
  pollMs    = 4_000,
): Promise<CompileWaitResult> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));

    const screenshot = await captureEditorScreen();
    if (!screenshot.ok || !screenshot.screenshotPath) continue;

    // Ask vision to read the compile status from the screen
    const analysis = await analyzeScreen(
      screenshot.screenshotPath,
      [
        'Look at this Unreal Editor screenshot. Has the compilation finished?',
        'Reply ONLY with JSON: { "done": true|false, "outcome": "success"|"error"|"in_progress", "detail": "<one sentence>" }',
        'Look for: progress bar disappearing, "Compile Complete" notification, error count in the output log, or the Blueprint compile status indicator.',
      ].join('\n'),
    );

    if (!analysis.ok) continue;

    let parsed: { done?: boolean; outcome?: string; detail?: string } = {};
    try {
      const raw = analysis.answer.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
      parsed = JSON.parse(raw);
    } catch {
      // Vision gave non-JSON — check for keywords in plain text
      const lower = analysis.answer.toLowerCase();
      if (lower.includes('compile complete') || lower.includes('0 error')) {
        return { outcome: 'success', detail: analysis.answer, screenshotPath: screenshot.screenshotPath, elapsedMs: Date.now() - start };
      }
      if (lower.includes('error') && lower.includes('compil')) {
        return { outcome: 'error', detail: analysis.answer, screenshotPath: screenshot.screenshotPath, elapsedMs: Date.now() - start };
      }
      continue;
    }

    if (parsed.done) {
      const outcome: CompileOutcome =
        parsed.outcome === 'success' ? 'success' :
        parsed.outcome === 'error'   ? 'error'   : 'unknown';
      return {
        outcome,
        detail:          parsed.detail ?? analysis.answer,
        screenshotPath:  screenshot.screenshotPath,
        elapsedMs:       Date.now() - start,
      };
    }
  }

  return {
    outcome:   'timeout',
    detail:    `Compile did not finish within ${Math.round(timeoutMs / 1000)}s.`,
    elapsedMs: Date.now() - start,
  };
}

// ── Trigger Play In Editor ────────────────────────────────────────────────────

/**
 * Vision-locate the Play button (green triangle) in the Unreal toolbar and click it.
 */
export async function triggerPlayInEditor(): Promise<UnrealEditorResult> {
  const screenshot = await captureEditorScreen();
  if (!screenshot.ok || !screenshot.screenshotPath) {
    return { ok: false, detail: screenshot.detail ?? 'Screenshot failed before Play click.' };
  }

  const loc = await locateElement(
    screenshot.screenshotPath,
    'the Play button in the Unreal Editor main toolbar — a green triangle / play icon used to launch Play In Editor (PIE)',
  );

  if (!loc.found || loc.x === undefined || loc.y === undefined) {
    // Fallback: use keyboard shortcut Alt+P (Play In Editor shortcut)
    if (IS_MACOS) {
      try {
        await shellExec(
          `osascript -e 'tell application "System Events" to key code 35 using {option down}'`,
          5000,
        );
        return {
          ok:             true,
          detail:         'Play In Editor triggered via keyboard shortcut (Alt+P) — button not located on screen.',
          screenshotPath: screenshot.screenshotPath,
        };
      } catch {
        // fallthrough to failure
      }
    }
    return {
      ok:             false,
      detail:         'Could not locate Play button. Ensure the main level editor is in the foreground.',
      screenshotPath: screenshot.screenshotPath,
    };
  }

  const clickResult = await clickAtCoords(loc.x, loc.y, 'left');
  if (!clickResult.ok) {
    return {
      ok:             false,
      detail:         `Play button found at (${loc.x}, ${loc.y}) but click failed: ${clickResult.error ?? 'unknown'}`,
      screenshotPath: screenshot.screenshotPath,
      x:              loc.x,
      y:              loc.y,
    };
  }

  return {
    ok:             true,
    detail:         `Clicked Play In Editor at (${loc.x}, ${loc.y})`,
    screenshotPath: screenshot.screenshotPath,
    x:              loc.x,
    y:              loc.y,
  };
}

// ── Open Blueprint for Class ───────────────────────────────────────────────────

/**
 * Attempt to open a named Blueprint class in the Unreal Editor.
 * Uses keyboard: Ctrl+P (Quick Open / asset search) then types the class name.
 */
export async function openBlueprintForClass(className: string): Promise<UnrealEditorResult> {
  if (!IS_MACOS && !IS_WINDOWS) {
    return { ok: false, detail: 'Platform not supported.' };
  }

  const screenshot = await captureEditorScreen();
  if (!screenshot.ok || !screenshot.screenshotPath) {
    return { ok: false, detail: 'Screenshot failed before Blueprint open.' };
  }

  try {
    if (IS_MACOS) {
      // Ctrl+P = Quick Open in Unreal Editor 5.x
      await shellExec(
        `osascript -e 'tell application "System Events" to key code 35 using {control down}'`,
        5000,
      );
      await new Promise(r => setTimeout(r, 500));
      // Type the class name
      const escaped = escapeAS(className);
      await shellExec(
        `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
        5000,
      );
      await new Promise(r => setTimeout(r, 1000));
      // Press Return to open the first match
      await shellExec(
        `osascript -e 'tell application "System Events" to key code 36'`,
        3000,
      );
      return {
        ok:             true,
        detail:         `Quick-Open sent for "${className}" — Blueprint should be opening.`,
        screenshotPath: screenshot.screenshotPath,
      };
    }

    if (IS_WINDOWS) {
      await shellExec(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^p')"`,
        5000,
      );
      await new Promise(r => setTimeout(r, 500));
      await shellExec(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${className.replace(/'/g, "''")}')"`,
        5000,
      );
      await new Promise(r => setTimeout(r, 1000));
      await shellExec(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"`,
        3000,
      );
      return {
        ok:             true,
        detail:         `Quick-Open sent for "${className}" (Windows).`,
        screenshotPath: screenshot.screenshotPath,
      };
    }
  } catch (err) {
    return { ok: false, detail: String(err), screenshotPath: screenshot.screenshotPath };
  }

  return { ok: false, detail: 'Platform not supported.' };
}

// ── Focus Content Browser ─────────────────────────────────────────────────────

/**
 * Vision-locate the Content Browser tab and click it to bring it to front.
 */
export async function focusContentBrowser(): Promise<UnrealEditorResult> {
  const screenshot = await captureEditorScreen();
  if (!screenshot.ok || !screenshot.screenshotPath) {
    return { ok: false, detail: 'Screenshot failed before Content Browser focus.' };
  }

  const loc = await locateElement(
    screenshot.screenshotPath,
    'the Content Browser tab or drawer toggle button in the Unreal Editor — usually at the bottom of the screen or along the bottom toolbar',
  );

  if (!loc.found || loc.x === undefined || loc.y === undefined) {
    // Keyboard fallback: Ctrl+Space opens Content Drawer in UE5
    if (IS_MACOS) {
      try {
        await shellExec(
          `osascript -e 'tell application "System Events" to key code 49 using {control down}'`,
          5000,
        );
        return {
          ok:             true,
          detail:         'Content Browser toggled via keyboard (Ctrl+Space).',
          screenshotPath: screenshot.screenshotPath,
        };
      } catch { /* fall through */ }
    }
    return {
      ok:             false,
      detail:         'Could not locate Content Browser tab on screen.',
      screenshotPath: screenshot.screenshotPath,
    };
  }

  const clickResult = await clickAtCoords(loc.x, loc.y, 'left');
  if (!clickResult.ok) {
    return {
      ok:             false,
      detail:         `Content Browser found at (${loc.x}, ${loc.y}) but click failed.`,
      screenshotPath: screenshot.screenshotPath,
    };
  }

  return {
    ok:             true,
    detail:         `Clicked Content Browser at (${loc.x}, ${loc.y})`,
    screenshotPath: screenshot.screenshotPath,
    x:              loc.x,
    y:              loc.y,
  };
}

// ── Editor Status Snapshot ────────────────────────────────────────────────────

export interface UnrealEditorStatus {
  editorRunning:   boolean;
  isFrontmost:     boolean;
  screenshotPath?: string;
  visionSummary?:  string;
}

/**
 * Quick non-destructive snapshot: is Unreal Editor running, is it frontmost?
 * Optionally takes a screenshot and asks vision for a one-line summary.
 */
export async function getEditorStatus(withVision = false): Promise<UnrealEditorStatus> {
  let editorRunning = false;
  let isFrontmost   = false;

  if (IS_MACOS) {
    try {
      const apps = await shellExec(
        `osascript -e 'tell application "System Events" to get name of every process where background only is false'`,
        5000,
      );
      editorRunning = /UE[45]?Editor|UnrealEditor|Unreal Engine/i.test(apps);
    } catch { /* no-op */ }

    try {
      const frontmost = await shellExec(
        `osascript -e 'tell application "System Events" to get name of first process where frontmost is true'`,
        3000,
      );
      isFrontmost = /UE[45]?Editor|UnrealEditor|Unreal Engine/i.test(frontmost);
    } catch { /* no-op */ }
  }

  if (!withVision || !editorRunning) {
    return { editorRunning, isFrontmost };
  }

  const screenshot = await captureEditorScreen();
  if (!screenshot.ok || !screenshot.screenshotPath) {
    return { editorRunning, isFrontmost };
  }

  const { describeScreen } = await import('./visionAnalyzer.js');
  const desc = await describeScreen(screenshot.screenshotPath);
  return {
    editorRunning,
    isFrontmost,
    screenshotPath: screenshot.screenshotPath,
    visionSummary:  desc.summary,
  };
}

// ── Check if output log has compile errors ────────────────────────────────────

/**
 * Vision check: look at current screen and determine if there are compile errors
 * visible in the Output Log panel.
 */
export async function checkOutputLogForErrors(): Promise<{ hasErrors: boolean; detail: string; screenshotPath?: string }> {
  const screenshot = await captureEditorScreen();
  if (!screenshot.ok || !screenshot.screenshotPath) {
    return { hasErrors: false, detail: 'Could not capture screen to check output log.' };
  }

  const analysis = await analyzeScreen(
    screenshot.screenshotPath,
    [
      'Look at the Output Log panel in this Unreal Editor screenshot.',
      'Are there any compile errors or error messages visible (red text, "Error:" lines, failed counts)?',
      'Reply ONLY with JSON: { "hasErrors": true|false, "errorCount": <number or null>, "summary": "<one sentence>" }',
    ].join('\n'),
  );

  if (!analysis.ok) {
    return { hasErrors: false, detail: 'Vision analysis failed for output log check.', screenshotPath: screenshot.screenshotPath };
  }

  let parsed: { hasErrors?: boolean; errorCount?: number | null; summary?: string } = {};
  try {
    const raw = analysis.answer.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(raw);
  } catch {
    const lower = analysis.answer.toLowerCase();
    return {
      hasErrors:      lower.includes('error'),
      detail:         analysis.answer,
      screenshotPath: screenshot.screenshotPath,
    };
  }

  return {
    hasErrors:      parsed.hasErrors ?? false,
    detail:         parsed.summary ?? analysis.answer,
    screenshotPath: screenshot.screenshotPath,
  };
}
