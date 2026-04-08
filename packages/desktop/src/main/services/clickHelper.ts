// ── clickHelper.ts ─────────────────────────────────────────────────────────────
//
// Phase 1.1 — Mouse click at pixel coordinates (macOS)
//
// Embeds a tiny Swift program inline, compiles it on first use via `swiftc`,
// and caches the binary in the app's userData directory.
//
// Why Swift compilation instead of an npm native addon:
//   - No Electron version pinning or rebuild step required
//   - `swiftc` ships with Xcode Command Line Tools (standard on developer macs)
//   - The binary uses CoreGraphics CGEvent — the same API macOS uses internally
//   - Compiled binary is cached; subsequent calls execute in <50ms
//
// Requirements:
//   - macOS only
//   - Xcode Command Line Tools (`xcode-select --install`)
//   - Accessibility permission (same as type_text / send_key)

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Embedded Swift source ──────────────────────────────────────────────────────

const SWIFT_SOURCE = `
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else { exit(1) }

let x = Double(args[1]) ?? 0
let y = Double(args[2]) ?? 0
let btnStr = args.count > 3 ? args[3] : "left"
let isDouble = btnStr == "double"
let isRight  = btnStr == "right"

let src      = CGEventSource(stateID: .hidSystemState)
let btnType: CGMouseButton = isRight ? .right : .left
let downType: CGEventType  = isRight ? .rightMouseDown : .leftMouseDown
let upType: CGEventType    = isRight ? .rightMouseUp   : .leftMouseUp
let pt = CGPoint(x: x, y: y)

func sendClick() {
  CGEvent(mouseEventSource: src, mouseType: downType,
          mouseCursorPosition: pt, mouseButton: btnType)?.post(tap: .cghidEventTap)
  usleep(50_000)
  CGEvent(mouseEventSource: src, mouseType: upType,
          mouseCursorPosition: pt, mouseButton: btnType)?.post(tap: .cghidEventTap)
}

sendClick()
if isDouble {
  usleep(120_000)
  sendClick()
}
`;

// ── Binary cache ───────────────────────────────────────────────────────────────

let _cachedBinPath: string | null = null;
let _compilePromise: Promise<string> | null = null;

/** Resolve a writable directory for the cached binary. */
function helperDir(): string {
  // Prefer userData (persists across sessions); fall back to tmpdir if app
  // isn't initialised yet (e.g. unit test context).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app.getPath('userData');
  } catch {
    return os.tmpdir();
  }
}

/**
 * Compile the Swift helper and return the path to the binary.
 * Idempotent — compiles at most once per process lifetime.
 */
async function ensureHelper(): Promise<string> {
  if (_cachedBinPath && fs.existsSync(_cachedBinPath)) return _cachedBinPath;
  if (_compilePromise) return _compilePromise;

  _compilePromise = (async (): Promise<string> => {
    const dir     = helperDir();
    const srcPath = path.join(dir, 'tf-click.swift');
    const binPath = path.join(dir, 'tf-click');

    // Write source
    fs.writeFileSync(srcPath, SWIFT_SOURCE, 'utf8');

    // Compile — takes ~2–4s on first run
    await new Promise<void>((resolve, reject) => {
      exec(`swiftc "${srcPath}" -o "${binPath}"`, { timeout: 45_000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve();
      });
    });

    fs.chmodSync(binPath, 0o755);
    _cachedBinPath = binPath;
    return binPath;
  })();

  return _compilePromise;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Click at the given screen coordinates.
 * Compiles the Swift helper on first call (cached afterwards).
 *
 * Requires:
 *   - macOS
 *   - Accessibility permission (System Settings → Privacy & Security)
 *   - `swiftc` available (Xcode Command Line Tools)
 */
export async function clickAtCoords(
  x: number,
  y: number,
  button: 'left' | 'right' | 'double' = 'left',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const bin = await ensureHelper();
    await new Promise<void>((resolve, reject) => {
      exec(`"${bin}" ${x} ${y} ${button}`, { timeout: 8_000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve();
      });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Check whether `swiftc` is available on this machine. */
export function isSwiftAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    exec('which swiftc', { timeout: 3_000 }, err => resolve(!err));
  });
}

/** Pre-warm: compile the helper in the background so the first click is instant. */
export async function prewarmClickHelper(): Promise<void> {
  const available = await isSwiftAvailable();
  if (available) {
    ensureHelper().catch(() => { /* background — ignore errors */ });
  }
}
