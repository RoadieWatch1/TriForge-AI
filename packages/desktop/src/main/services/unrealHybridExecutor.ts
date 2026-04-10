// ── unrealHybridExecutor.ts ───────────────────────────────────────────────────
//
// Hybrid Control Layer for Unreal Engine
//
// Tries the deterministic path first (Remote Control HTTP API), falls back to
// visual automation (screenshot → vision → click) when RC is unavailable.
//
// This is the difference between a gimmick and a reliable operator:
//   RC API   → instant, deterministic, no pixel-hunting
//   Visual   → universal fallback, works even when RC isn't enabled
//
// Every function follows the same pattern:
//   1. If rcAvailable → send HTTP command to localhost:30010
//   2. If RC fails or unavailable → fall back to unrealEditorOperator (vision)
//   3. Return a unified result with controlMethod ('rc' | 'visual' | 'failed')

import http from 'http';
import crypto from 'crypto';
import {
  focusUnrealEditor,
  captureEditorScreen,
  findAndClickCompile,
  triggerPlayInEditor,
  focusContentBrowser,
  type UnrealEditorResult,
} from './unrealEditorOperator';

function actionId(): string { return crypto.randomUUID(); }

// ── Types ────────────────────────────────────────────────────────────────────

export type ControlMethod = 'rc' | 'visual' | 'failed';

export interface HybridResult {
  ok:              boolean;
  controlMethod:   ControlMethod;
  detail:          string;
  screenshotPath?: string;
  rcResponse?:     unknown;   // raw RC API response if used
}

export interface HybridExecutorState {
  rcAvailable:    boolean;
  rcPort:         number;
  lastRcCheckAt:  number;
  rcCheckCount:   number;
  rcSuccessCount: number;
  visualFallbackCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const RC_PORT         = 30010;
const RC_TIMEOUT_MS   = 5000;
const RC_CHECK_TTL_MS = 30_000; // re-probe RC availability every 30s

// ── Module state ─────────────────────────────────────────────────────────────

let _rcAvailable     = false;
let _lastRcCheckAt   = 0;
let _rcCheckCount    = 0;
let _rcSuccessCount  = 0;
let _visualFallbackCount = 0;

export function getExecutorState(): HybridExecutorState {
  return {
    rcAvailable: _rcAvailable,
    rcPort: RC_PORT,
    lastRcCheckAt: _lastRcCheckAt,
    rcCheckCount: _rcCheckCount,
    rcSuccessCount: _rcSuccessCount,
    visualFallbackCount: _visualFallbackCount,
  };
}

// ── RC availability check (cached) ───────────────────────────────────────────

async function checkRcAvailable(forceRefresh = false): Promise<boolean> {
  if (!forceRefresh && Date.now() - _lastRcCheckAt < RC_CHECK_TTL_MS) {
    return _rcAvailable;
  }

  _rcCheckCount++;
  _lastRcCheckAt = Date.now();

  try {
    const result = await rcGet('/remote/info');
    _rcAvailable = result.ok;
    return _rcAvailable;
  } catch {
    _rcAvailable = false;
    return false;
  }
}

/** Force a fresh RC availability check, bypassing cache. */
export async function refreshRcStatus(): Promise<boolean> {
  return checkRcAvailable(true);
}

// ── RC HTTP helpers ──────────────────────────────────────────────────────────

interface RcHttpResult {
  ok:         boolean;
  statusCode: number;
  body:       string;
  parsed?:    unknown;
}

function rcGet(path: string): Promise<RcHttpResult> {
  return rcRequest('GET', path);
}

function rcPut(path: string, payload: unknown): Promise<RcHttpResult> {
  return rcRequest('PUT', path, payload);
}

function rcRequest(method: string, urlPath: string, payload?: unknown): Promise<RcHttpResult> {
  return new Promise((resolve) => {
    const bodyStr = payload ? JSON.stringify(payload) : undefined;
    const req = http.request(
      {
        hostname: 'localhost',
        port:     RC_PORT,
        path:     urlPath,
        method,
        timeout:  RC_TIMEOUT_MS,
        headers: {
          'Accept':       'application/json',
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { /* raw text */ }
          resolve({
            ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
            statusCode: res.statusCode ?? 500,
            body: data,
            parsed,
          });
        });
      },
    );
    req.on('error', () => resolve({ ok: false, statusCode: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0, body: 'timeout' }); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Hybrid helper: try RC, fall back to visual ───────────────────────────────

async function withVisualFallback(
  rcAttempt:     () => Promise<HybridResult | null>,
  visualFallback: () => Promise<UnrealEditorResult>,
  actionLabel:   string,
): Promise<HybridResult> {
  // Try RC first
  if (await checkRcAvailable()) {
    try {
      const rcResult = await rcAttempt();
      if (rcResult && rcResult.ok) {
        _rcSuccessCount++;
        return rcResult;
      }
    } catch { /* fall through to visual */ }
  }

  // Visual fallback
  _visualFallbackCount++;
  const visualResult = await visualFallback();
  return {
    ok:            visualResult.ok,
    controlMethod: visualResult.ok ? 'visual' : 'failed',
    detail:        visualResult.detail ?? `${actionLabel} via visual automation`,
    screenshotPath: visualResult.screenshotPath,
  };
}

// ── Public API: Hybrid Unreal Commands ───────────────────────────────────────

/**
 * Focus the Unreal Editor window.
 * RC: Not applicable (RC doesn't control window focus).
 * Always uses visual/OS-level focus.
 */
export async function hybridFocusEditor(): Promise<HybridResult> {
  const result = await focusUnrealEditor();
  return {
    ok:            result.ok,
    controlMethod: result.ok ? 'visual' : 'failed',
    detail:        result.detail ?? 'Focus editor',
    screenshotPath: result.screenshotPath,
  };
}

/**
 * Trigger compile in Unreal Editor.
 * RC: PUT /remote/object/call with CompileBlueprint or RequestEndPlayMap
 * Visual: find and click Compile button
 */
export async function hybridCompile(): Promise<HybridResult> {
  return withVisualFallback(
    async () => {
      // RC approach: call the editor compile function
      const res = await rcPut('/remote/object/call', {
        objectPath: '/Script/UnrealEd.Default__EditorLevelLibrary',
        functionName: 'EditorRequestEndPIE',
      });
      // Also try the compile-all-blueprints route
      const compileRes = await rcPut('/remote/object/call', {
        objectPath: '/Script/UnrealEd.Default__KismetEditorUtilities',
        functionName: 'CompileBlueprint',
      });
      if (res.ok || compileRes.ok) {
        return {
          ok: true, controlMethod: 'rc' as ControlMethod,
          detail: 'Compile triggered via Remote Control API',
          rcResponse: compileRes.parsed ?? res.parsed,
        };
      }
      return null;
    },
    findAndClickCompile,
    'Compile',
  );
}

/**
 * Trigger Play In Editor.
 * RC: PUT /remote/object/call with RequestPlaySession
 * Visual: find and click Play button
 */
export async function hybridPlayInEditor(): Promise<HybridResult> {
  return withVisualFallback(
    async () => {
      const res = await rcPut('/remote/object/call', {
        objectPath: '/Script/UnrealEd.Default__EditorLevelLibrary',
        functionName: 'EditorPlaySimulate',
      });
      if (res.ok) {
        return {
          ok: true, controlMethod: 'rc' as ControlMethod,
          detail: 'Play In Editor triggered via Remote Control API',
          rcResponse: res.parsed,
        };
      }
      return null;
    },
    triggerPlayInEditor,
    'Play In Editor',
  );
}

/**
 * Open Content Browser.
 * RC: not directly available
 * Visual: locate and click Content Browser tab
 */
export async function hybridFocusContentBrowser(): Promise<HybridResult> {
  return withVisualFallback(
    async () => {
      // RC: Execute console command to open Content Browser
      const res = await rcPut('/remote/object/call', {
        objectPath: '/Script/UnrealEd.Default__EditorLevelLibrary',
        functionName: 'EditorInvalidateViewports',
      });
      // Content Browser doesn't have a direct RC command — return null to trigger visual
      return null;
    },
    focusContentBrowser,
    'Focus Content Browser',
  );
}

/**
 * Execute an arbitrary Unreal console command.
 * RC: POST /remote/object/call on the KismetSystemLibrary
 * Visual: open console with ` key, type command, press Enter
 */
export async function hybridExecConsoleCommand(command: string): Promise<HybridResult> {
  // Try RC first
  if (await checkRcAvailable()) {
    const res = await rcPut('/remote/object/call', {
      objectPath: '/Script/Engine.Default__KismetSystemLibrary',
      functionName: 'ExecuteConsoleCommand',
      parameters: {
        WorldContextObject: '/Game/Maps/Default',
        Command: command,
      },
    });
    if (res.ok) {
      _rcSuccessCount++;
      return {
        ok: true, controlMethod: 'rc',
        detail: `Console command "${command}" executed via RC`,
        rcResponse: res.parsed,
      };
    }
  }

  // Visual fallback: open console with backtick, type command, press enter
  _visualFallbackCount++;
  const { OperatorService } = await import('./operatorService.js');

  const now = Date.now();

  // Press backtick to open Unreal console
  await OperatorService.executeAction({
    id: actionId(), type: 'send_key', key: '`', modifiers: [],
    sessionId: '', requestedAt: now,
  });
  await new Promise(r => setTimeout(r, 300));

  // Type the command
  await OperatorService.executeAction({
    id: actionId(), type: 'type_text', text: command,
    sessionId: '', requestedAt: now,
  });
  await new Promise(r => setTimeout(r, 200));

  // Press Enter to execute
  await OperatorService.executeAction({
    id: actionId(), type: 'send_key', key: 'return', modifiers: [],
    sessionId: '', requestedAt: now,
  });

  return {
    ok: true, controlMethod: 'visual',
    detail: `Console command "${command}" typed via keyboard`,
  };
}

/**
 * Get a property value from an Unreal object.
 * RC only — no visual fallback (you can't read properties by looking at the screen).
 */
export async function rcGetProperty(
  objectPath: string,
  propertyName: string,
): Promise<HybridResult> {
  if (!(await checkRcAvailable())) {
    return { ok: false, controlMethod: 'failed', detail: 'RC not available — cannot read properties visually' };
  }

  const res = await rcPut('/remote/object/property', {
    objectPath,
    access: 'READ_ACCESS',
    propertyName,
  });

  return {
    ok: res.ok,
    controlMethod: res.ok ? 'rc' : 'failed',
    detail: res.ok ? `Read ${propertyName} from ${objectPath}` : `Failed to read ${propertyName}`,
    rcResponse: res.parsed,
  };
}

/**
 * Set a property value on an Unreal object.
 * RC only — no visual fallback.
 */
export async function rcSetProperty(
  objectPath: string,
  propertyName: string,
  propertyValue: unknown,
): Promise<HybridResult> {
  if (!(await checkRcAvailable())) {
    return { ok: false, controlMethod: 'failed', detail: 'RC not available — cannot set properties visually' };
  }

  const res = await rcPut('/remote/object/property', {
    objectPath,
    access: 'WRITE_ACCESS',
    propertyName,
    propertyValue: { [propertyName]: propertyValue },
  });

  return {
    ok: res.ok,
    controlMethod: res.ok ? 'rc' : 'failed',
    detail: res.ok ? `Set ${propertyName} on ${objectPath}` : `Failed to set ${propertyName}`,
    rcResponse: res.parsed,
  };
}

/**
 * Call an arbitrary function on an Unreal object via RC.
 * RC only — no visual fallback.
 */
export async function rcCallFunction(
  objectPath: string,
  functionName: string,
  parameters?: Record<string, unknown>,
): Promise<HybridResult> {
  if (!(await checkRcAvailable())) {
    return { ok: false, controlMethod: 'failed', detail: 'RC not available' };
  }

  const body: Record<string, unknown> = { objectPath, functionName };
  if (parameters) body.parameters = parameters;

  const res = await rcPut('/remote/object/call', body);

  return {
    ok: res.ok,
    controlMethod: res.ok ? 'rc' : 'failed',
    detail: res.ok ? `Called ${functionName} on ${objectPath} via RC` : `RC call failed: ${res.body.slice(0, 200)}`,
    rcResponse: res.parsed,
  };
}

/**
 * Get list of available RC presets — useful for discovering what the user has set up.
 */
export async function rcListPresets(): Promise<HybridResult> {
  if (!(await checkRcAvailable())) {
    return { ok: false, controlMethod: 'failed', detail: 'RC not available' };
  }

  const res = await rcGet('/remote/presets');
  return {
    ok: res.ok,
    controlMethod: res.ok ? 'rc' : 'failed',
    detail: res.ok ? 'Retrieved RC presets' : 'Failed to list presets',
    rcResponse: res.parsed,
  };
}

/**
 * Screenshot the editor — always visual (RC can't do this).
 */
export async function hybridCaptureScreen(): Promise<HybridResult> {
  const result = await captureEditorScreen();
  return {
    ok: result.ok,
    controlMethod: result.ok ? 'visual' : 'failed',
    detail: result.detail ?? 'Screenshot captured',
    screenshotPath: result.screenshotPath,
  };
}
