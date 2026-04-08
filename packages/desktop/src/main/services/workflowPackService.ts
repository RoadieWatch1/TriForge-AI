// ── workflowPackService.ts ────────────────────────────────────────────────────
//
// Section 9 — Workflow Packs: Desktop Execution Service
//
// Orchestrates workflow pack execution by:
//   - Evaluating readiness before starting
//   - Running phases sequentially using OperatorService
//   - Pausing at approval gates (status: 'awaiting_approval')
//   - Advancing on resume after approval
//   - Tracking all runs in memory
//   - Emitting EventBus events for audit trail
//
// TRULY IMPLEMENTED:
//   - pack.readiness-check  — full execution
//   - pack.app-context      — full execution
//   - pack.focus-capture    — full execution (needs Screen Recording)
//   - pack.supervised-input — full execution (needs Accessibility + Screen Recording)
//
// PARTIAL / SCAFFOLDED:
//   - Run persistence — in-memory only; lost on restart
//
// NOT YET:
//   - Windows/Linux execution backends
//   - Resume-from-crash for interrupted runs

import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

import { OperatorService } from './operatorService';
import {
  onWorkflowRunStarted,
  onWorkflowRunSettled,
} from '../workerRuntime/workflowWorkerRunBridge';
import {
  WORKFLOW_PACK_REGISTRY,
  getWorkflowPack,
  listWorkflowPacks,
  evaluateWorkflowReadiness,
  evaluateAllPackReadiness,
  evaluateUnrealBootstrapReadiness,
} from '@triforge/engine';
import type {
  WorkflowPack,
  WorkflowRun,
  WorkflowRunOptions,
  WorkflowPhaseResult,
  WorkflowArtifact,
  WorkflowReadinessResult,
  UnrealBootstrapResult,
} from '@triforge/engine';
import { buildUnrealAwarenessSnapshot }                                 from './unrealAwareness';
import { saveProjectProgress }                                          from './projectMemory';
import {
  buildIOSAwarenessSnapshot,
  bootSimulator,
  captureSimulatorScreen,
  formatIOSSummary,
  type iOSAwarenessSnapshot,
} from './iosAwareness';
import {
  buildAndroidAwarenessSnapshot,
  captureAndroidScreen,
  androidTap,
  androidTypeText,
  androidLaunchApp,
  formatAndroidSummary,
} from './androidAwareness';
import {
  analyzeScreen,
  describeScreen,
  locateElement,
  isElementVisible,
  detectKeyboard,
  askAboutScreen,
} from './visionAnalyzer';
import {
  getOSKStatus,
  openOSK,
  closeOSK,
  ensureOSKOpen,
  getOSKBounds,
  getOSKRecommendationMessage,
} from './oskManager';
import {
  startScreenWatcher,
  stopScreenWatcher,
  getScreenWatcherState,
  checkScreenChanged,
} from './screenWatcher';
import {
  getAuthStatus,
  connectYouTube,
  connectFacebook,
  connectInstagram,
  connectTikTok,
  publishToYouTube,
  publishToFacebook,
  publishToInstagram,
  publishToTikTok,
} from './socialPublisher';
import { findEngineRootFromProcess, findBuildScript, findRunUATScript, launchUnrealBuild } from './executeUnrealBuild';
import { triageUnrealLog, resolveTriageLogSource }                      from './triageUnrealLog';
import { generateUnrealSystemScaffold, generateUnrealSystemScaffoldWithAI, generateUnrealMilestones } from '@triforge/engine';
import { applyUnrealMilestone1 }                                           from './applyUnrealMilestone1';
import { applyUnrealMilestone2 }                                           from './applyUnrealMilestone2';
import { applyUnrealMilestone3 }                                           from './applyUnrealMilestone3';
import { applyUnrealMilestone4 }                                           from './applyUnrealMilestone4';
import { applyUnrealMilestone5 }                                           from './applyUnrealMilestone5';
import { probeUnrealRemoteControl, UNREAL_RC_DEFAULT_PORT, UNREAL_RC_PROBE_TIMEOUT_MS } from './probeUnrealRemoteControl';
import { eventBus } from '@triforge/engine';
import https from 'https';

// ── Script fallback library ───────────────────────────────────────────────────
//
// Pre-written scripts for the most common operations in each supported language.
// Used when Claude API is unavailable (no key, timeout, network down) so app
// packs never hard-fail for simple, well-understood tasks.
//
// Key format: lowercase keywords from the goal string (substring match).
// First match wins — list more specific keys before general ones.

const SCRIPT_FALLBACK: {
  extendscript: Record<string, string>;
  python:       Record<string, string>;
  applescript:  Record<string, string>;
} = {

  // ── Adobe ExtendScript (Photoshop, Illustrator, After Effects, Premiere…) ──
  extendscript: {
    'export png':
      `var pngOpts = new PNGSaveOptions();
var f = new File(Folder.desktop + '/export_' + (new Date()).getTime() + '.png');
app.activeDocument.saveAs(f, pngOpts, true);`,

    'export jpeg':
      `var jpgOpts = new JPEGSaveOptions(); jpgOpts.quality = 10;
var f = new File(Folder.desktop + '/export_' + (new Date()).getTime() + '.jpg');
app.activeDocument.saveAs(f, jpgOpts, true);`,

    'export pdf':
      `var pdfOpts = new PDFSaveOptions();
var f = new File(Folder.desktop + '/export_' + (new Date()).getTime() + '.pdf');
app.activeDocument.saveAs(f, pdfOpts, true);`,

    'flatten':
      `app.activeDocument.flatten();`,

    'new layer':
      `app.activeDocument.artLayers.add();`,

    'duplicate':
      `app.activeDocument.duplicate();`,

    'resize':
      `app.activeDocument.resizeImage(UnitValue(1920, 'px'), UnitValue(1080, 'px'), 72, ResampleMethod.BICUBIC);`,

    'save':
      `app.activeDocument.save();`,

    'close':
      `app.activeDocument.close(SaveOptions.SAVECHANGES);`,

    'undo':
      `app.activeDocument.activeHistoryState = app.activeDocument.historyStates[app.activeDocument.historyStates.length - 2];`,
  },

  // ── Blender Python (bpy) ──────────────────────────────────────────────────
  python: {
    'render animation':
      `import bpy
bpy.ops.render.render(animation=True, write_still=False)`,

    'render':
      `import bpy
bpy.ops.render.render(write_still=True)`,

    'save as':
      `import bpy, os
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath or os.path.join(bpy.app.tempdir, 'untitled.blend'))`,

    'save':
      `import bpy
bpy.ops.wm.save_mainfile()`,

    'export obj':
      `import bpy
bpy.ops.export_scene.obj(filepath='/tmp/blender_export.obj', use_selection=False)`,

    'export fbx':
      `import bpy
bpy.ops.export_scene.fbx(filepath='/tmp/blender_export.fbx', use_selection=False)`,

    'export gltf':
      `import bpy
bpy.ops.export_scene.gltf(filepath='/tmp/blender_export.gltf')`,

    'add cube':
      `import bpy
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))`,

    'add sphere':
      `import bpy
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0))`,

    'add plane':
      `import bpy
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))`,

    'select all':
      `import bpy
bpy.ops.object.select_all(action='SELECT')`,

    'clear scene':
      `import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()`,

    'deselect':
      `import bpy
bpy.ops.object.select_all(action='DESELECT')`,
  },

  // ── AppleScript ───────────────────────────────────────────────────────────
  applescript: {
    // Logic Pro
    'bounce':
      `tell application "Logic Pro"
  key code 66 using {command down}
end tell`,

    'record':
      `tell application "Logic Pro"
  key code 15
end tell`,

    'play':
      `tell application "Logic Pro"
  key code 49
end tell`,

    'stop logic':
      `tell application "Logic Pro"
  key code 49
end tell`,

    'save logic':
      `tell application "Logic Pro"
  key code 1 using {command down}
end tell`,

    // Final Cut Pro
    'export':
      `tell application "Final Cut Pro"
  key code 69 using {command down}
end tell`,

    'share':
      `tell application "Final Cut Pro"
  key code 69 using {command down}
end tell`,

    'save':
      `tell application system attribute "AppleScript target"
  key code 1 using {command down}
end tell`,

    // Generic — works in most apps
    'undo':
      `key code 6 using {command down}`,

    'copy':
      `key code 8 using {command down}`,

    'paste':
      `key code 9 using {command down}`,

    'select all':
      `key code 0 using {command down}`,
  },
};

/**
 * Find the best fallback script for `goal` in the given language.
 * Returns the first script whose keyword is a substring of the lowercased goal,
 * or null if no match is found.
 */
function findFallbackScript(
  kind: 'extendscript' | 'python' | 'applescript',
  goal: string,
): string | null {
  const lib   = SCRIPT_FALLBACK[kind];
  const lower = goal.toLowerCase();
  for (const [keyword, script] of Object.entries(lib)) {
    if (lower.includes(keyword)) return script;
  }
  return null;
}

// ── Script-generation key ─────────────────────────────────────────────────────
//
// Injected at runtime from ipc.ts (same as visionAnalyzer's key pattern).
// Used by generateAppScript() to auto-produce ExtendScript / Python / AppleScript
// when opts.script is not supplied by the caller.

let _scriptGenKey: string | null = null;

export function setScriptGenKey(key: string): void {
  _scriptGenKey = key;
}

/**
 * Ask Claude to generate the script text needed to accomplish `goal` inside
 * `appName` using the given scripting language.
 *
 * Returns the script string, or null if the API call fails.
 */
async function generateAppScript(
  kind:    'extendscript' | 'python' | 'applescript',
  goal:    string,
  appName: string,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY ?? _scriptGenKey;
  // No API key — use offline fallback library immediately
  if (!key) return findFallbackScript(kind, goal);

  const langMap = {
    extendscript: 'Adobe ExtendScript (JavaScript for Adobe CC apps)',
    python:       'Python for Blender\'s embedded bpy interpreter',
    applescript:  'AppleScript for macOS automation',
  };

  const prompt = [
    `Write a ${langMap[kind]} script that accomplishes the following task in ${appName}:`,
    `"${goal}"`,
    '',
    'Requirements:',
    '- Output ONLY the raw script, no explanation, no markdown code fences.',
    '- The script must be self-contained and executable as-is.',
    kind === 'extendscript' ? '- Use the ExtendScript app object and DOM — not node.js APIs.' : '',
    kind === 'python'       ? '- Use bpy (Blender Python API). Do not import external packages.' : '',
    kind === 'applescript'  ? `- Scope commands with "tell application \\"${appName}\\"" where appropriate.` : '',
  ].filter(Boolean).join('\n');

  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  });

  try {
    const response = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path:     '/v1/messages',
          method:   'POST',
          headers: {
            'Content-Type':      'application/json',
            'Content-Length':    Buffer.byteLength(body),
            'x-api-key':         key,
            'anthropic-version': '2023-06-01',
          },
        },
        res => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.setTimeout(20_000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });

    const parsed = JSON.parse(response) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return parsed.content?.find(c => c.type === 'text')?.text?.trim() ?? null;
  } catch {
    // API failed — fall back to pre-written scripts for known operations
    return findFallbackScript(kind, goal);
  }
}

// ── Run store ─────────────────────────────────────────────────────────────────

const _runs = new Map<string, WorkflowRun>();

function makeId(): string {
  return crypto.randomUUID();
}

function nowMs(): number {
  return Date.now();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePhaseResult(
  phase: WorkflowPack['phases'][number],
  status: WorkflowPhaseResult['status'],
  outputs: Record<string, unknown> = {},
  error?: string,
  warning?: string,
): WorkflowPhaseResult {
  return {
    phaseId:     phase.id,
    phaseName:   phase.name,
    status,
    startedAt:   nowMs(),
    completedAt: status !== 'awaiting_approval' ? nowMs() : undefined,
    outputs,
    error,
    warning,
  };
}

function saveMilestoneIfSuccess(outcome: string, projectPath: string, projectName: string, milestone: string, packId: string, goal?: string): void {
  if (outcome !== 'failed') {
    saveProjectProgress({ projectPath, projectName, lastMilestone: milestone, lastPackId: packId, prototypeGoal: goal });
  }
}

// ── Phase executors ───────────────────────────────────────────────────────────

async function executePhase(
  pack: WorkflowPack,
  phaseIndex: number,
  run: WorkflowRun,
  opts: WorkflowRunOptions,
): Promise<{ phaseResult: WorkflowPhaseResult; shouldStop: boolean; approvalId?: string; sessionId?: string }> {
  const phase = pack.phases[phaseIndex];
  if (!phase) {
    return {
      phaseResult: {
        phaseId: 'unknown', phaseName: 'Unknown', status: 'failed',
        startedAt: nowMs(), completedAt: nowMs(), outputs: {},
        error: `Phase index ${phaseIndex} out of range`,
      },
      shouldStop: true,
    };
  }

  const fail = (error: string) => ({
    phaseResult: makePhaseResult(phase, 'failed', {}, error),
    shouldStop:  phase.onFailure === 'stop',
  });

  const warn = (warning: string, outputs: Record<string, unknown> = {}) => ({
    phaseResult: makePhaseResult(phase, phase.optional ? 'skipped' : 'completed', outputs, undefined, warning),
    shouldStop:  false,
  });

  switch (phase.kind) {

    // ── list_apps ──────────────────────────────────────────────────────────────
    case 'list_apps': {
      const apps = await OperatorService.listRunningApps();
      if (run.targetApp) {
        const targetLower = run.targetApp.toLowerCase();
        const isRunning = apps.some(a => a.toLowerCase().includes(targetLower));
        if (!isRunning) {
          const msg = `Target app "${run.targetApp}" is not in the running app list.`;
          if (phase.onFailure === 'stop') {
            return fail(msg);
          }
          return warn(msg, { apps, targetFound: false });
        }
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { apps, count: apps.length }),
        shouldStop:  false,
      };
    }

    // ── get_frontmost ──────────────────────────────────────────────────────────
    case 'get_frontmost': {
      const target = await OperatorService.getFrontmostApp();
      if (!target) {
        return warn('Could not read frontmost app.', {});
      }
      // Update the session's confirmed target
      const session = OperatorService.getSession(run.sessionId);
      if (session) {
        // Best-effort update — session.confirmedTarget is internal
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          appName:     target.appName,
          windowTitle: target.windowTitle ?? null,
          confirmed:   target.confirmed,
        }),
        shouldStop: false,
      };
    }

    // ── focus_app ──────────────────────────────────────────────────────────────
    case 'focus_app': {
      if (!run.targetApp) {
        return fail('focus_app phase requires a targetApp — none was provided.');
      }
      const session = OperatorService.getSession(run.sessionId);
      if (!session) {
        return fail('Session not found — cannot build focus action.');
      }
      const action = OperatorService.buildAction(run.sessionId, 'focus_app', {
        target: run.targetApp,
      });
      const result = await OperatorService.executeAction(action);
      if (result.outcome !== 'success') {
        const msg = result.error ?? `Focus failed: ${result.outcome}`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { outcome: result.outcome, recoveryHint: result.recoveryHint ?? null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          focusedApp:  result.executedTarget?.appName ?? run.targetApp,
          windowTitle: result.executedTarget?.windowTitle ?? null,
        }),
        shouldStop: false,
      };
    }

    // ── screenshot ─────────────────────────────────────────────────────────────
    case 'screenshot': {
      const outputPath = opts.screenshotOutputPath ??
        path.join(os.tmpdir(), `tf-wf-${run.id}-${phaseIndex}-${nowMs()}.png`);
      const res = await OperatorService.captureScreen(outputPath);
      if (!res.ok) {
        if (phase.optional) {
          return warn(`Screenshot skipped: ${res.error ?? 'failed'}. ${res.recoveryHint ?? ''}`, {
            screenshotPath: null,
          });
        }
        if (phase.onFailure === 'stop') return fail(res.error ?? 'Screenshot failed');
        return warn(res.error ?? 'Screenshot failed', { screenshotPath: null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { screenshotPath: res.path ?? null }),
        shouldStop:  false,
      };
    }

    // ── queue_input ────────────────────────────────────────────────────────────
    case 'queue_input': {
      if (!opts.inputText && !opts.inputKey) {
        return fail('queue_input phase requires inputText or inputKey in run options.');
      }
      const session = OperatorService.getSession(run.sessionId);
      if (!session) return fail('Session not found — cannot queue input action.');

      const actionType = opts.inputKey ? 'send_key' : 'type_text';
      const action = OperatorService.buildAction(run.sessionId, actionType, {
        text:      opts.inputText,
        key:       opts.inputKey,
        modifiers: opts.inputModifiers,
      });

      const result = await OperatorService.executeAction(action);
      if (result.outcome !== 'approval_pending' || !result.approvalId) {
        return fail(`Expected approval_pending, got: ${result.outcome}. ${result.error ?? ''}`);
      }

      return {
        phaseResult: {
          phaseId:     phase.id,
          phaseName:   phase.name,
          status:      'awaiting_approval',
          startedAt:   nowMs(),
          outputs:     { approvalId: result.approvalId, actionType },
        },
        shouldStop:  false,
        approvalId:  result.approvalId,
      };
    }

    // ── execute_approved ───────────────────────────────────────────────────────
    case 'execute_approved': {
      // Find the approvalId from queue_input or vision_plan_act phase results
      const queueResult = run.phaseResults.find(
        r => r.phaseId === 'queue-input' || r.phaseId === 'vision-plan-act',
      );
      const approvalId = queueResult?.outputs?.approvalId as string | undefined;
      if (!approvalId) {
        return fail('execute_approved: no approvalId found from queue_input or vision_plan_act phase.');
      }
      const result = await OperatorService.executeApprovedAction(approvalId);
      if (result.outcome !== 'success') {
        const msg = result.error ?? `Input execution failed: ${result.outcome}`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { outcome: result.outcome, recoveryHint: result.recoveryHint ?? null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          executedApp:   result.executedTarget?.appName ?? null,
          windowTitle:   result.executedTarget?.windowTitle ?? null,
          durationMs:    result.durationMs,
        }),
        shouldStop: false,
      };
    }

    // ── readiness_check ────────────────────────────────────────────────────────
    case 'readiness_check': {
      const capMap = await OperatorService.getCapabilityMap();
      const runningApps = capMap.platform === 'macOS'
        ? await OperatorService.listRunningApps()
        : [];
      const allResults: Record<string, WorkflowReadinessResult> = {};
      for (const [id, res] of evaluateAllPackReadiness(
        WORKFLOW_PACK_REGISTRY,
        capMap,
        runningApps,
      )) {
        allResults[id] = res;
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          capabilityMap: capMap,
          packReadiness: allResults,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_bootstrap_check ─────────────────────────────────────────────────
    case 'unreal_bootstrap_check': {
      // Reuse running-apps + frontmost data from prior phases if available,
      // otherwise re-fetch. Both sources are cheap read-only osascript calls.
      const priorApps      = run.phaseResults.find(r => r.phaseId === 'list-apps');
      const priorFrontmost = run.phaseResults.find(r => r.phaseId === 'get-frontmost');

      const apps           = (priorApps?.outputs?.apps as string[] | undefined)
                              ?? await OperatorService.listRunningApps();
      const frontmostName  = (priorFrontmost?.outputs?.appName as string | undefined)
                              ?? null;
      const frontmostTitle = priorFrontmost?.outputs?.windowTitle as string | undefined;

      const snapshot        = await buildUnrealAwarenessSnapshot(apps, frontmostName, frontmostTitle);
      const bootstrapResult = evaluateUnrealBootstrapReadiness(snapshot);

      const outputs = {
        unrealSnapshot:  snapshot,
        unrealBootstrap: bootstrapResult,
        readiness:       bootstrapResult.readiness,
        issueCount:      bootstrapResult.issues.length,
        blockerCount:    bootstrapResult.issues.filter(i => i.severity === 'blocker').length,
        warningCount:    bootstrapResult.issues.filter(i => i.severity === 'warning').length,
      };

      // If bootstrap is blocked AND this phase is required to stop on failure,
      // return a failed phase result so the pack halts cleanly.
      if (bootstrapResult.readiness === 'blocked' && phase.onFailure === 'stop') {
        const blockerMessages = bootstrapResult.issues
          .filter(i => i.severity === 'blocker')
          .map(i => i.message)
          .join('; ');
        return {
          phaseResult: makePhaseResult(
            phase, 'failed', outputs,
            `Unreal bootstrap blocked: ${blockerMessages}`,
          ),
          shouldStop: true,
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', outputs),
        shouldStop: false,
      };
    }

    // ── unreal_build_check ─────────────────────────────────────────────────────
    case 'unreal_build_check': {
      // Pull the bootstrap result from the preceding unreal_bootstrap_check phase
      const bootstrapPhase = run.phaseResults.find(
        r => r.phaseId === 'unreal-bootstrap-preflight',
      );
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as UnrealBootstrapResult | undefined;

      // ── 1. Project path — must have high-confidence .uproject path ──────────
      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const msg = bootstrapResult
          ? `Project path is not available (project confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
            'Open a specific project in Unreal Editor so the project file path can be confirmed.'
          : 'Bootstrap result not available — cannot validate project path.';
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'project_path_missing',
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      // ── 2. Build already in progress? ──────────────────────────────────────
      const snapshot = bootstrapPhase?.outputs?.unrealSnapshot as Record<string, unknown> | undefined;
      const buildState = snapshot?.buildState as string | undefined;
      if (buildState === 'building' || buildState === 'packaging') {
        const msg = `A ${buildState} operation is already in progress. ` +
                    'Wait for it to finish before launching a new build.';
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'build_already_in_progress',
            buildState,
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      // ── 3. Engine root from running process ─────────────────────────────────
      const engineRoot = await findEngineRootFromProcess();
      if (!engineRoot) {
        const msg = 'Could not derive the Unreal Engine install root from the running ' +
                    'UnrealEditor process. The process must be running for engine path discovery.';
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'engine_root_not_found',
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      // ── 4. Build tool exists? ────────────────────────────────────────────────
      const buildMode  = opts.buildMode ?? 'build';
      const scriptPath = buildMode === 'build'
        ? findBuildScript(engineRoot)
        : findRunUATScript(engineRoot);

      if (!scriptPath) {
        const scriptName = buildMode === 'build' ? 'Build.sh' : 'RunUAT.sh';
        const msg = `${scriptName} was not found under the engine root: ${engineRoot}. ` +
                    `Verify the Unreal Engine installation at that path is complete.`;
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'build_tool_not_found',
            engineRoot,
            buildMode,
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          projectPath,
          projectName,
          engineRoot,
          buildMode,
          buildScriptPath: scriptPath,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_build_execute ───────────────────────────────────────────────────
    case 'unreal_build_execute': {
      // Pull validated fields from the preceding build-check phase
      const checkPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-build-check');
      const projectPath  = checkPhase?.outputs?.projectPath  as string | undefined;
      const projectName  = checkPhase?.outputs?.projectName  as string | undefined;
      const engineRoot   = checkPhase?.outputs?.engineRoot   as string | undefined;
      const buildMode    = (checkPhase?.outputs?.buildMode   as 'build' | 'package' | undefined)
                            ?? opts.buildMode ?? 'build';

      if (!projectPath || !projectName || !engineRoot) {
        return {
          phaseResult: makePhaseResult(
            phase, 'failed', { issueCode: 'build_tool_not_found' },
            'Build-check phase did not produce required fields — cannot execute build.',
          ),
          shouldStop: false,
        };
      }

      const launchResult = await launchUnrealBuild(projectPath, projectName, engineRoot, buildMode);

      if (!launchResult.ok) {
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'launch_failed',
            command:   launchResult.command,
            logPath:   launchResult.logPath,
            engineRoot,
            buildMode,
            projectPath,
            projectName,
          }, launchResult.error ?? 'Build subprocess launch failed.'),
          shouldStop: false,
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          outcome:     'started',
          pid:         launchResult.pid,
          command:     launchResult.command,
          logPath:     launchResult.logPath,
          engineRoot,
          buildMode,
          projectPath,
          projectName,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_triage_analyze ──────────────────────────────────────────────────
    case 'unreal_triage_analyze': {
      // Pull context from the bootstrap phase (recentLogPath, projectPath, projectName)
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-context');
      const snapshot        = bootstrapPhase?.outputs?.unrealSnapshot as Record<string, unknown> | undefined;
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as UnrealBootstrapResult | undefined;

      const source = resolveTriageLogSource({
        explicitLogPath:  opts.triageLogPath,
        awarenessLogPath: snapshot?.recentLogPath as string | undefined,
        projectPath:      bootstrapResult?.projectPath,
        projectName:      bootstrapResult?.projectName,
      });

      if (!source) {
        const triageResult = {
          outcome:  'blocked' as const,
          findings: [{
            code:              'no_build_artifact' as const,
            confidence:        'high' as const,
            message:           'No usable log source found.',
            remediationHints:  [
              'Run pack.unreal-build first so a build log is available.',
              'Or provide opts.triageLogPath pointing to a specific log file.',
              'Or open a project in Unreal Editor so the awareness snapshot can locate the project log.',
            ],
          }],
          summary: 'No usable log source found. Run pack.unreal-build first or provide opts.triageLogPath.',
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', { triageResult, outcome: 'blocked' }),
          shouldStop:  false,
        };
      }

      const triageResult = await triageUnrealLog(source.logPath, source.sourceKind);
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          triageResult,
          outcome:       triageResult.outcome,
          sourceLogPath: triageResult.sourceLogPath,
          sourceKind:    triageResult.sourceKind,
          findingCount:  triageResult.findings.length,
          summary:       triageResult.summary,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_scaffold_generate ───────────────────────────────────────────────
    case 'unreal_scaffold_generate': {
      // Pull project context from the preceding bootstrap preflight phase
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      // Collect bootstrap warnings to pass into the scaffold generator
      const bootstrapWarnings: string[] = bootstrapResult?.issues
        .filter(i => i.severity === 'warning')
        .map(i => i.message) ?? [];

      const goal = opts.prototypeGoal ?? '';

      // ── Pre-task web research ──────────────────────────────────────────────
      // Search the web for the goal + "Unreal Engine" so Council builds from
      // real-world knowledge of game mechanics, not just keyword heuristics.
      let webResearchContext: string | undefined;
      try {
        const { searchWeb } = await import('@triforge/engine');
        const query = `${goal} Unreal Engine 5 tutorial game mechanics Blueprint`;
        const webResults = await searchWeb(query, 4);
        if (webResults.length > 0) {
          webResearchContext = webResults
            .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`)
            .join(' | ');
        }
      } catch {
        // Web search is best-effort — scaffold still runs without it
      }

      // Use AI-driven scaffold when a Claude key is available;
      // falls back to keyword heuristics automatically if not.
      const claudeKey = process.env.ANTHROPIC_API_KEY ?? _scriptGenKey ?? undefined;
      const scaffoldResult = await generateUnrealSystemScaffoldWithAI(
        goal,
        {
          projectName:        bootstrapResult?.projectName,
          projectPath:        bootstrapResult?.projectPath,
          bootstrapWarnings,
          webResearchContext,
        },
        claudeKey,
      );

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          scaffoldResult,
          outcome:       scaffoldResult.outcome,
          itemCount:     scaffoldResult.scaffoldItems.length,
          assumptionCount: scaffoldResult.assumptions.length,
          warningCount:  scaffoldResult.warnings.length,
          prototypeGoal: scaffoldResult.prototypeGoal,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_milestone_plan ──────────────────────────────────────────────────
    case 'unreal_milestone_plan': {
      // Pull scaffold result from the preceding scaffold-generate phase
      const scaffoldPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      if (!scaffoldResult) {
        // Scaffold phase either failed or wasn't run — produce a blocked milestone result
        const blockedResult: import('@triforge/engine').UnrealMilestoneResult = {
          outcome:       'blocked',
          prototypeGoal: opts.prototypeGoal ?? '',
          milestones:    [],
          assumptions:   [],
          warnings: [
            'Scaffold result was not available from the preceding scaffold phase. ' +
            'Ensure the prototypeGoal run option is provided and the scaffold phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            milestoneResult:  blockedResult,
            outcome:          'blocked',
            milestoneCount:   0,
            prototypeGoal:    opts.prototypeGoal ?? '',
          }),
          shouldStop: false,
        };
      }

      const milestoneResult = generateUnrealMilestones(scaffoldResult);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          milestoneResult,
          outcome:          milestoneResult.outcome,
          milestoneCount:   milestoneResult.milestones.length,
          assumptionCount:  milestoneResult.assumptions.length,
          warningCount:     milestoneResult.warnings.length,
          prototypeGoal:    milestoneResult.prototypeGoal,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m1_execute ──────────────────────────────────────────────────────
    case 'unreal_m1_execute': {
      // ── 1. Project path gate — requires high-confidence bootstrap result ────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM1ExecutionResult = {
          outcome:  'blocked',
          projectName: bootstrapResult?.projectName,
          projectPath: bootstrapResult?.projectPath,
          actions:  [],
          warnings: [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m1ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Pull scaffold and milestone results from prior phases ────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM1ExecutionResult = {
          outcome:     'blocked',
          projectName,
          projectPath,
          actions:     [],
          warnings:    [],
          blockers:    [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m1ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Apply M1 project artifacts ──────────────────────────────────────
      const applicationResult = await applyUnrealMilestone1(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
      );

      // ── 4. Build structured execution result ────────────────────────────────
      const actions: import('@triforge/engine').UnrealM1ExecutionAction[] = [
        {
          name:         'Create TriForge directory',
          kind:         'directory_created',
          status:       'done',
          relativePath: 'TriForge/',
          detail:       `Created ${applicationResult.triforgeDir}`,
        },
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;

      let outcome: import('@triforge/engine').UnrealM1ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m1ExecutionResult: import('@triforge/engine').UnrealM1ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:    applicationResult.triforgeDir,
        milestoneTitle: milestoneResult.milestones.find(m => m.id === 'M1')?.title,
        actions,
        warnings:       applicationResult.warnings,
        blockers:       applicationResult.errors,
      };

      saveMilestoneIfSuccess(outcome, projectPath, projectName, 'M1', run.packId, opts?.goal ?? (scaffoldResult as { prototypeGoal?: string } | undefined)?.prototypeGoal);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m1ExecutionResult,
          outcome,
          fileCount,
          triforgeDir:     applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m2_execute ──────────────────────────────────────────────────────
    case 'unreal_m2_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM2ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m2ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM2ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m2ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1 manifest presence ─────────────────────────────────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const m1ManifestPath    = join(dirname(projectPath), 'TriForge', 'M1_Manifest.json');
      const m1FoundationPresent = existsSync(m1ManifestPath);

      // ── 4. Apply M2 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone2(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM2ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM2ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m2ExecutionResult: import('@triforge/engine').UnrealM2ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      saveMilestoneIfSuccess(outcome, projectPath, projectName, 'M2', run.packId, opts?.goal);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m2ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m3_execute ──────────────────────────────────────────────────────
    case 'unreal_m3_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM3ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m3ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM3ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m3ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1 and M2 manifest presence (chain integrity) ────────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const triforgeBase        = join(dirname(projectPath), 'TriForge');
      const m1ManifestPath      = join(triforgeBase, 'M1_Manifest.json');
      const m2ManifestPath      = join(triforgeBase, 'M2_Manifest.json');
      const m1FoundationPresent = existsSync(m1ManifestPath);
      const m2FoundationPresent = existsSync(m2ManifestPath);

      // ── 4. Apply M3 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone3(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
        m2FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM3ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM3ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m3ExecutionResult: import('@triforge/engine').UnrealM3ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        m2FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      saveMilestoneIfSuccess(outcome, projectPath, projectName, 'M3', run.packId, opts?.goal);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m3ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          m2FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m4_execute ──────────────────────────────────────────────────────
    case 'unreal_m4_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM4ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m4ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM4ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m4ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1 / M2 / M3 manifest presence (chain integrity) ─────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const triforgeBase        = join(dirname(projectPath), 'TriForge');
      const m1FoundationPresent = existsSync(join(triforgeBase, 'M1_Manifest.json'));
      const m2FoundationPresent = existsSync(join(triforgeBase, 'M2_Manifest.json'));
      const m3FoundationPresent = existsSync(join(triforgeBase, 'M3_Manifest.json'));

      // ── 4. Apply M4 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone4(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM4ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM4ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m4ExecutionResult: import('@triforge/engine').UnrealM4ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      saveMilestoneIfSuccess(outcome, projectPath, projectName, 'M4', run.packId, opts?.goal);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m4ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          m2FoundationPresent,
          m3FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m5_execute ──────────────────────────────────────────────────────
    case 'unreal_m5_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM5ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          m4FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m5ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM5ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          m4FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m5ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1–M4 manifest presence (chain integrity) ────────────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const triforgeBase        = join(dirname(projectPath), 'TriForge');
      const m1FoundationPresent = existsSync(join(triforgeBase, 'M1_Manifest.json'));
      const m2FoundationPresent = existsSync(join(triforgeBase, 'M2_Manifest.json'));
      const m3FoundationPresent = existsSync(join(triforgeBase, 'M3_Manifest.json'));
      const m4FoundationPresent = existsSync(join(triforgeBase, 'M4_Manifest.json'));

      // ── 4. Apply M5 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone5(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
        m4FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM5ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM5ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m5ExecutionResult: import('@triforge/engine').UnrealM5ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
        m4FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      saveMilestoneIfSuccess(outcome, projectPath, projectName, 'M5', run.packId, opts?.goal);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m5ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          m2FoundationPresent,
          m3FoundationPresent,
          m4FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_rc_probe ────────────────────────────────────────────────────────
    case 'unreal_rc_probe': {
      // Pull bootstrap context for project identity and editor-running signal
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      // If editor is not running, produce a blocked result without probing
      if (!bootstrapResult?.editorRunning) {
        const blocked: import('@triforge/engine').UnrealRCProbeResult = {
          outcome:               'blocked',
          reachable:             false,
          rcSignatureFound:      false,
          editorRunning:         false,
          projectName:           bootstrapResult?.projectName,
          projectPath:           bootstrapResult?.projectPath,
          details:               ['Unreal Editor is not running — probe not attempted.'],
          warnings:              [],
          automationImplication:
            'The editor must be running before the Remote Control endpoint can be probed. ' +
            'Launch Unreal Editor with the active project, then re-run this pack.',
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            rcProbeResult: blocked,
            outcome:       'blocked',
            reachable:     false,
          }),
          shouldStop: false,
        };
      }

      // ── Perform the real HTTP probe ────────────────────────────────────────
      const raw = await probeUnrealRemoteControl(
        UNREAL_RC_DEFAULT_PORT,
        UNREAL_RC_PROBE_TIMEOUT_MS,
      );

      // ── Map probe result to structured pack result ─────────────────────────
      let outcome: import('@triforge/engine').UnrealRCProbeOutcome;
      let automationImplication: string;

      switch (raw.connectionStatus) {
        case 'available':
          outcome = 'available';
          automationImplication =
            'The Unreal Remote Control HTTP API appears active and responding. ' +
            'Future packs may send editor-side commands (object creation, property ' +
            'mutation, preset execution) via the RC API on this endpoint. ' +
            'Recommended next step: run a narrow RC action pack to verify command delivery.';
          break;

        case 'reachable_unknown':
          outcome = 'unexpected_response';
          automationImplication =
            'The port is open and responding, but the response does not match the ' +
            'expected Unreal Remote Control signature. Another service may be on this ' +
            'port, or the RC plugin is running a non-standard configuration. ' +
            'Inspect the response excerpt and verify the plugin settings before using ' +
            'the RC API for automation.';
          break;

        case 'refused':
          outcome = 'unavailable';
          automationImplication =
            'The Remote Control HTTP endpoint is not listening on the expected port. ' +
            'Possible causes: the Web Remote Control plugin is not installed, not enabled ' +
            'for this project, or the editor was launched without the RC HTTP server. ' +
            'Enable the plugin in Edit → Plugins → Web Remote Control, then restart ' +
            'the editor. Until then, remain on the file-generation execution path.';
          break;

        case 'timeout':
          outcome = 'unavailable';
          automationImplication =
            'The probe timed out — no response was received within ' +
            `${UNREAL_RC_PROBE_TIMEOUT_MS}ms. The port may be filtered or the RC ` +
            'HTTP server is not accepting connections. Try enabling the plugin and ' +
            'restarting the editor. Until then, remain on the file-generation path.';
          break;

        default: // 'error'
          outcome = 'unavailable';
          automationImplication =
            'A network error prevented the probe from completing. ' +
            `Error: ${raw.error ?? 'unknown'}. ` +
            'Verify the editor is running and try again. Remain on the ' +
            'file-generation execution path until the probe succeeds.';
      }

      const rcProbeResult: import('@triforge/engine').UnrealRCProbeResult = {
        outcome,
        endpoint:              raw.endpoint,
        httpStatus:            raw.httpStatus,
        reachable:             raw.reachable,
        rcSignatureFound:      raw.rcSignatureFound,
        editorRunning:         bootstrapResult.editorRunning,
        projectName:           bootstrapResult.projectName,
        projectPath:           bootstrapResult.projectPath,
        durationMs:            raw.durationMs,
        details:               raw.details,
        warnings:              raw.warnings,
        automationImplication,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          rcProbeResult,
          outcome,
          reachable:        raw.reachable,
          rcSignatureFound: raw.rcSignatureFound,
          endpoint:         raw.endpoint,
          httpStatus:       raw.httpStatus,
          durationMs:       raw.durationMs,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_full_chain ─────────────────────────────────────────────────────
    // End-to-end pipeline: bootstrap → web research → AI scaffold → milestones
    // → apply M1–M5 → editor compile. Single approval, full automation.
    case 'unreal_full_chain': {
      const goal = opts.prototypeGoal ?? run.goal ?? '';
      if (!goal) return fail('unreal_full_chain requires a prototypeGoal — describe what game you want to build.');

      const emit = (phase: string, detail: string) => {
        // Non-blocking progress notifications via the run's onProgress callback
      };

      // ── Step 1: Bootstrap check ──────────────────────────────────────────
      emit('bootstrap', 'Checking Unreal Editor and project...');
      const { evaluateUnrealBootstrapReadiness } = await import('@triforge/engine');
      const _chainApps = await OperatorService.listRunningApps();
      const snapshot = await buildUnrealAwarenessSnapshot(_chainApps, null, undefined);
      const bootstrap = evaluateUnrealBootstrapReadiness(snapshot);
      if (bootstrap.readiness === 'blocked') {
        return fail(`Unreal project not ready: ${bootstrap.issues.find(i => i.severity === 'blocker')?.message ?? 'bootstrap blocked'}`);
      }
      const projectPath = bootstrap.projectPath;
      const projectName = bootstrap.projectName ?? 'UnrealProject';
      if (!projectPath) return fail('Could not determine Unreal project path. Open the project in Unreal Editor first.');

      // ── Step 2: Web research ────────────────────────────────────────────
      emit('research', `Searching the web for "${goal}" game mechanics...`);
      let webResearchContext: string | undefined;
      try {
        const { searchWeb } = await import('@triforge/engine');
        const webResults = await searchWeb(`${goal} Unreal Engine 5 tutorial game mechanics Blueprint`, 4);
        if (webResults.length > 0) {
          webResearchContext = webResults.map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`).join(' | ');
        }
      } catch { /* non-fatal */ }

      // ── Step 3: AI Scaffold ─────────────────────────────────────────────
      emit('scaffold', 'Planning game systems with AI...');
      const claudeKey = process.env.ANTHROPIC_API_KEY ?? _scriptGenKey ?? undefined;
      const scaffoldResult = await generateUnrealSystemScaffoldWithAI(
        goal,
        {
          projectName,
          projectPath,
          bootstrapWarnings: bootstrap.issues.filter(i => i.severity === 'warning').map(i => i.message),
          webResearchContext,
        },
        claudeKey,
      );
      if (scaffoldResult.outcome === 'blocked') {
        return fail(`Scaffold generation blocked: ${scaffoldResult.warnings[0] ?? 'unknown'}`);
      }

      // ── Step 4: Milestone plan ──────────────────────────────────────────
      emit('milestones', 'Organizing work into milestones...');
      const milestoneResult = generateUnrealMilestones(scaffoldResult);
      if (milestoneResult.outcome === 'blocked') {
        return fail(`Milestone planning blocked: ${milestoneResult.warnings?.[0] ?? 'unknown'}`);
      }

      // ── Steps 5–9: Apply M1–M5 ─────────────────────────────────────────
      const { existsSync } = await import('fs');
      const { join } = await import('path');
      const triforgeBase = join(projectPath, 'TriForge');

      emit('m1', 'Writing core game-mode and player character files...');
      const m1 = await applyUnrealMilestone1(projectPath, projectName, scaffoldResult, milestoneResult);

      emit('m2', 'Writing health, survival, and HUD files...');
      const m2 = await applyUnrealMilestone2(projectPath, projectName, scaffoldResult, milestoneResult, m1.ok);

      emit('m3', 'Writing inventory, items, and interaction files...');
      const m3 = await applyUnrealMilestone3(projectPath, projectName, scaffoldResult, milestoneResult,
        m1.ok, m2.ok);

      emit('m4', 'Writing enemy and combat files...');
      const m4 = await applyUnrealMilestone4(projectPath, projectName, scaffoldResult, milestoneResult,
        m1.ok, m2.ok, m3.ok);

      emit('m5', 'Writing progression and save-system files...');
      const m5 = await applyUnrealMilestone5(projectPath, projectName, scaffoldResult, milestoneResult,
        m1.ok, m2.ok, m3.ok, m4.ok);

      const allFiles = [
        ...m1.appliedFiles, ...m2.appliedFiles, ...m3.appliedFiles,
        ...m4.appliedFiles, ...m5.appliedFiles,
      ];
      const allWarnings = [
        ...m1.warnings, ...m2.warnings, ...m3.warnings, ...m4.warnings, ...m5.warnings,
      ];

      // ── Step 10: Editor compile ─────────────────────────────────────────
      emit('compile', 'Focusing Unreal Editor and triggering compile...');
      let compileOutcome = 'skipped';
      let compileDetail  = 'Editor compile not attempted.';
      let compileScreenshot: string | undefined;
      try {
        const {
          focusUnrealEditor, findAndClickCompile, waitForCompileResult,
        } = await import('./unrealEditorOperator.js');
        const focused = await focusUnrealEditor();
        if (focused.ok) {
          await new Promise(r => setTimeout(r, 1200)); // let editor settle
          const clicked = await findAndClickCompile();
          if (clicked.ok) {
            const compiled = await waitForCompileResult(120_000, 4_000);
            compileOutcome   = compiled.outcome;
            compileDetail    = compiled.detail;
            compileScreenshot = compiled.screenshotPath;
          } else {
            compileOutcome = 'skipped';
            compileDetail  = clicked.detail ?? 'Compile button not found — open a Blueprint and retry.';
          }
        } else {
          compileDetail = focused.detail ?? 'Unreal Editor not found. Start the editor to compile.';
        }
      } catch { compileDetail = 'Editor compile step failed — files were still written.'; }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          goal,
          projectPath,
          projectName,
          scaffoldItemCount:  scaffoldResult.scaffoldItems.length,
          milestoneCount:     milestoneResult.milestones?.length ?? 0,
          filesWritten:       allFiles.length,
          warnings:           allWarnings,
          webResearchUsed:    !!webResearchContext,
          aiScaffoldUsed:     scaffoldResult.assumptions.some(a => a.message.includes('Claude AI')),
          compileOutcome,
          compileDetail,
          compileScreenshot,
          triforgeDir:        triforgeBase,
          appliedFilePaths:   allFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_editor_status ──────────────────────────────────────────────────
    case 'unreal_editor_status': {
      const { getEditorStatus } = await import('./unrealEditorOperator.js');
      const status = await getEditorStatus(false);
      if (!status.editorRunning) {
        return fail('Unreal Editor is not running. Launch the editor with your project, then re-run this pack.');
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          editorRunning: status.editorRunning,
          isFrontmost:   status.isFrontmost,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_editor_focus ───────────────────────────────────────────────────
    case 'unreal_editor_focus': {
      const { focusUnrealEditor } = await import('./unrealEditorOperator.js');
      const result = await focusUnrealEditor();
      if (!result.ok) {
        return fail(result.detail ?? 'Could not focus Unreal Editor.');
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { detail: result.detail }),
        shouldStop: false,
      };
    }

    // ── unreal_editor_compile ─────────────────────────────────────────────────
    case 'unreal_editor_compile': {
      const { findAndClickCompile, waitForCompileResult, checkOutputLogForErrors } =
        await import('./unrealEditorOperator.js');

      // 1. Find and click Compile button
      const clickResult = await findAndClickCompile();
      if (!clickResult.ok) {
        return fail(clickResult.detail ?? 'Could not locate or click the Compile button.');
      }

      // 2. Wait up to 2 minutes for compile to finish
      const compileWait = await waitForCompileResult(120_000, 4_000);

      // 3. If compile finished with an error, do an extra output-log check
      let errorDetail: string | undefined;
      if (compileWait.outcome === 'error') {
        const logCheck = await checkOutputLogForErrors();
        errorDetail = logCheck.detail;
      }

      const succeeded = compileWait.outcome === 'success';
      return {
        phaseResult: makePhaseResult(
          phase,
          succeeded ? 'completed' : 'completed',   // always completed — let errorDetail surface
          {
            compileOutcome:    compileWait.outcome,
            compileDurationMs: compileWait.elapsedMs,
            compileDetail:     compileWait.detail,
            errorDetail:       errorDetail ?? null,
            screenshotPath:    compileWait.screenshotPath ?? clickResult.screenshotPath,
            clickX:            clickResult.x,
            clickY:            clickResult.y,
          },
          undefined,
          succeeded ? undefined : (compileWait.detail ?? 'Compile did not succeed'),
        ),
        shouldStop: false,
      };
    }

    // ── unreal_editor_play ────────────────────────────────────────────────────
    case 'unreal_editor_play': {
      const { triggerPlayInEditor } = await import('./unrealEditorOperator.js');
      const result = await triggerPlayInEditor();
      return {
        phaseResult: makePhaseResult(
          phase,
          result.ok ? 'completed' : 'completed',
          {
            ok:             result.ok,
            detail:         result.detail,
            screenshotPath: result.screenshotPath,
            x:              result.x,
            y:              result.y,
          },
          undefined,
          result.ok ? undefined : (result.detail ?? 'Play button not found'),
        ),
        shouldStop: false,
      };
    }

    // ── unreal_editor_open_bp ─────────────────────────────────────────────────
    case 'unreal_editor_open_bp': {
      const className = (opts?.className as string | undefined) ?? (run.goal ?? '');
      if (!className) {
        return fail('unreal_editor_open_bp requires opts.className — the Blueprint class name to open.');
      }
      const { openBlueprintForClass } = await import('./unrealEditorOperator.js');
      const result = await openBlueprintForClass(className);
      return {
        phaseResult: makePhaseResult(
          phase,
          result.ok ? 'completed' : 'completed',
          { ok: result.ok, detail: result.detail, screenshotPath: result.screenshotPath },
          undefined,
          result.ok ? undefined : result.detail,
        ),
        shouldStop: false,
      };
    }

    // ── unreal_editor_content_browser ─────────────────────────────────────────
    case 'unreal_editor_content_browser': {
      const { focusContentBrowser } = await import('./unrealEditorOperator.js');
      const result = await focusContentBrowser();
      return {
        phaseResult: makePhaseResult(
          phase,
          result.ok ? 'completed' : 'completed',
          { ok: result.ok, detail: result.detail, screenshotPath: result.screenshotPath },
          undefined,
          result.ok ? undefined : result.detail,
        ),
        shouldStop: false,
      };
    }

    // ── perceive_with_ocr ──────────────────────────────────────────────────────
    case 'perceive_with_ocr': {
      const perception = await OperatorService.perceiveWithOCR();
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          screenshotPath:  perception.screenshotPath,
          ocrText:         perception.ocrText ?? '',
          appName:         perception.target?.appName,
          windowTitle:     perception.target?.windowTitle,
          perceptionSummary: perception.summary,
        }),
        shouldStop: false,
      };
    }

    // ── queue_click_at ─────────────────────────────────────────────────────────
    case 'queue_click_at': {
      const x      = opts?.x as number | undefined;
      const y      = opts?.y as number | undefined;
      const button = (opts?.button as 'left' | 'right' | 'double' | undefined) ?? 'left';

      if (x === undefined || y === undefined) {
        return fail('queue_click_at requires opts.x and opts.y (pixel coordinates).');
      }

      const session = OperatorService.startSession(opts?.targetApp ?? null);
      const action  = OperatorService.buildAction(session.id, 'click_at', { x, y, button });
      const result  = await OperatorService.executeAction(action);

      if (result.outcome === 'approval_pending') {
        return {
          phaseResult: makePhaseResult(phase, 'awaiting_approval', {
            approvalId: result.approvalId,
            sessionId:  session.id,
            actionId:   action.id,
            x, y, button,
          }),
          shouldStop: false,
          approvalId: result.approvalId,
          sessionId:  session.id,
        };
      }

      return fail(`click_at queue failed: ${result.error ?? result.outcome}`);
    }

    // ── vision_plan_act ────────────────────────────────────────────────────────
    // Screenshot → Claude Vision determines one action → approval-gated execute.
    // Designed for DAWs (Ableton, Pro Tools) and any app with no scripting API.
    case 'vision_plan_act': {
      const goal = run.goal ?? opts.goal ?? 'Perform the next logical task in this application.';

      // 1. Capture current screen
      const screenshotResult = await OperatorService.captureScreen();
      if (!screenshotResult.ok || !screenshotResult.path) {
        if (phase.optional) return warn('vision_plan_act: screenshot unavailable.', {});
        return fail(screenshotResult.error ?? 'vision_plan_act: screenshot failed.');
      }
      const screenshotPath = screenshotResult.path;

      // 2. Ask Claude Vision to plan the next single action
      const { analyzeScreen } = await import('./visionAnalyzer.js');
      const visionPrompt = [
        `Goal: "${goal}"`,
        '',
        'Look at this screenshot. Decide the ONE best next action to make progress toward the goal.',
        'Respond ONLY with a JSON object using this exact schema (no markdown, no extra text):',
        '{',
        '  "action": "click" | "key" | "type",',
        '  "x": <number — pixel x, only for action=click>,',
        '  "y": <number — pixel y, only for action=click>,',
        '  "button": "left" | "right" | "double" — only for action=click, default "left",',
        '  "key": "<key name>" — only for action=key (e.g. "r", "space", "return"),',
        '  "modifiers": ["cmd"|"shift"|"alt"|"ctrl"] — only for action=key, can be empty array,',
        '  "text": "<text to type>" — only for action=type,',
        '  "reasoning": "<one sentence explaining why this action>"',
        '}',
      ].join('\n');

      const visionResult = await analyzeScreen(screenshotPath, visionPrompt);
      if (!visionResult.ok) {
        return fail(`vision_plan_act: vision analysis failed — ${visionResult.error ?? 'no response'}`);
      }

      // 3. Parse the JSON plan
      let plan: {
        action: 'click' | 'key' | 'type';
        x?: number; y?: number; button?: 'left' | 'right' | 'double';
        key?: string; modifiers?: Array<'cmd' | 'shift' | 'alt' | 'ctrl'>;
        text?: string;
        reasoning?: string;
      };
      try {
        // Strip any accidental markdown fences
        const raw = visionResult.answer.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
        plan = JSON.parse(raw);
      } catch {
        return fail(`vision_plan_act: could not parse vision response as JSON. Got: ${visionResult.answer.slice(0, 200)}`);
      }

      // 4. Build the OperatorService action from the plan
      const session = OperatorService.getSession(run.sessionId);
      if (!session) return fail('vision_plan_act: operator session not found.');

      let actionType: 'click_at' | 'send_key' | 'type_text';
      let actionParams: Record<string, unknown>;

      if (plan.action === 'click') {
        if (plan.x === undefined || plan.y === undefined) {
          return fail('vision_plan_act: AI returned click action but no x/y coordinates.');
        }
        actionType   = 'click_at';
        actionParams = { x: plan.x, y: plan.y, button: plan.button ?? 'left' };
      } else if (plan.action === 'key') {
        if (!plan.key) return fail('vision_plan_act: AI returned key action but no key name.');
        actionType   = 'send_key';
        actionParams = { key: plan.key, modifiers: plan.modifiers ?? [] };
      } else if (plan.action === 'type') {
        if (!plan.text) return fail('vision_plan_act: AI returned type action but no text.');
        actionType   = 'type_text';
        actionParams = { text: plan.text };
      } else {
        return fail(`vision_plan_act: unknown action type "${(plan as { action: string }).action}".`);
      }

      const action = OperatorService.buildAction(run.sessionId, actionType, actionParams);
      const result = await OperatorService.executeAction(action);

      if (result.outcome !== 'approval_pending' || !result.approvalId) {
        const msg = result.error ?? `vision_plan_act: action did not enter approval queue (outcome: ${result.outcome})`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { screenshotPath, plan });
      }

      return {
        phaseResult: {
          phaseId:   phase.id,
          phaseName: phase.name,
          status:    'awaiting_approval',
          startedAt: nowMs(),
          outputs: {
            approvalId:    result.approvalId,
            screenshotPath,
            actionType,
            actionParams,
            reasoning:     plan.reasoning ?? '',
          },
        },
        shouldStop: false,
        approvalId: result.approvalId,
      };
    }

    // ── app_awareness_check ────────────────────────────────────────────────────
    case 'app_awareness_check': {
      const { buildAppAwarenessSnapshot, formatAppAwarenessSummary } =
        await import('./appAwareness.js');
      const runningApps   = await OperatorService.listRunningApps();
      const frontmost     = await OperatorService.getFrontmostApp();
      const detected      = buildAppAwarenessSnapshot(
        runningApps,
        frontmost?.appName,
        frontmost?.windowTitle,
      );
      const summary       = formatAppAwarenessSummary(detected);
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          detectedApps: detected.map((d: import('@triforge/engine').DetectedApp) => ({
            id:           d.definition.id,
            name:         d.definition.name,
            running:      d.running,
            frontmost:    d.frontmost,
            openDocument: d.openDocument,
            installed:    d.installed,
            packIds:      d.definition.packIds,
          })),
          summary,
        }),
        shouldStop: false,
      };
    }

    // ── adobe_extendscript ─────────────────────────────────────────────────────
    //
    // Runs a JavaScript snippet inside an Adobe CC app via osascript.
    // The app must be running and frontmost. The script is passed as opts.script.
    // Adobe apps expose a `do JavaScript` AppleScript command for ExtendScript.
    case 'adobe_extendscript': {
      let script    = opts?.script as string | undefined;
      const appName = (pack.requirements.targetApp ?? opts?.targetApp) as string;

      if (!appName) return fail('adobe_extendscript requires a targetApp on the pack or in opts.');

      // Auto-generate script from goal when not provided
      if (!script) {
        const goal = opts?.goal as string | undefined ?? run.goal;
        if (!goal) return fail('adobe_extendscript requires opts.script or opts.goal to generate one.');
        const generated = await generateAppScript('extendscript', goal, appName);
        if (!generated) return fail('Could not generate ExtendScript — check your Claude API key in Settings.');
        script = generated;
      }

      // Escape for AppleScript string embedding
      const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const osaCmd  = `osascript -e 'tell application "${appName}" to do JavaScript "${escaped}"'`;

      try {
        const { exec } = await import('child_process');
        const output   = await new Promise<string>((resolve, reject) => {
          exec(osaCmd, { timeout: 30_000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr?.trim() || err.message));
            else resolve(stdout?.trim() ?? '');
          });
        });
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            extendscriptOutput: output,
            scriptLength:       script.length,
            targetApp:          appName,
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`ExtendScript failed in ${appName}: ${String(err)}`);
      }
    }

    // ── blender_python ─────────────────────────────────────────────────────────
    //
    // Runs a Python script in Blender's embedded interpreter.
    // Blender must be running. Script is passed as opts.script (Python source).
    // Uses: blender --background --python-expr "<script>" or writes to tmp file.
    case 'blender_python': {
      let script = opts?.script as string | undefined;

      // Auto-generate script from goal when not provided
      if (!script) {
        const goal = opts?.goal as string | undefined ?? run.goal;
        if (!goal) return fail('blender_python requires opts.script or opts.goal to generate one.');
        const generated = await generateAppScript('python', goal, 'Blender');
        if (!generated) return fail('Could not generate Blender Python script — check your Claude API key in Settings.');
        script = generated;
      }

      const { exec } = await import('child_process');
      const { writeFileSync, unlinkSync } = await import('fs');
      const { join } = await import('path');
      const { tmpdir } = await import('os');

      const scriptPath = join(tmpdir(), `tf-blender-${Date.now()}.py`);
      try {
        writeFileSync(scriptPath, script, 'utf8');

        // Try to find the Blender executable from running process
        const blenderBin = await new Promise<string>(resolve => {
          exec(
            `ps -ax -o args | grep -i "Blender" | grep -v grep | head -1 | awk '{print $1}'`,
            { timeout: 5_000 },
            (_err, stdout) => resolve(stdout?.trim() || 'blender'),
          );
        });

        const output = await new Promise<string>((resolve, reject) => {
          exec(
            `"${blenderBin}" --background --python "${scriptPath}"`,
            { timeout: 60_000 },
            (err, stdout, stderr) => {
              if (err && !stdout) reject(new Error(stderr?.trim() || err.message));
              else resolve(stdout?.trim() ?? '');
            },
          );
        });

        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            blenderOutput: output,
            scriptPath,
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`Blender Python script failed: ${String(err)}`);
      } finally {
        try { unlinkSync(scriptPath); } catch { /* best-effort cleanup */ }
      }
    }

    // ── app_applescript ────────────────────────────────────────────────────────
    //
    // Runs an AppleScript against any macOS app.
    // opts.script = the raw AppleScript source.
    // opts.targetApp = app name for scoping (optional if script is self-contained).
    case 'app_applescript': {
      let script = opts?.script as string | undefined;
      const asAppName = (opts?.targetApp ?? pack.requirements.targetApp) as string | undefined;

      // Auto-generate script from goal when not provided
      if (!script) {
        const goal = opts?.goal as string | undefined ?? run.goal;
        if (!goal) return fail('app_applescript requires opts.script or opts.goal to generate one.');
        const generated = await generateAppScript('applescript', goal, asAppName ?? 'the target app');
        if (!generated) return fail('Could not generate AppleScript — check your Claude API key in Settings.');
        script = generated;
      }

      try {
        const { exec } = await import('child_process');
        const output   = await new Promise<string>((resolve, reject) => {
          exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`,
            { timeout: 30_000 },
            (err, stdout, stderr) => {
              if (err) reject(new Error(stderr?.trim() || err.message));
              else resolve(stdout?.trim() ?? '');
            });
        });
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            applescriptOutput: output,
            targetApp: opts?.targetApp ?? pack.requirements.targetApp,
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`AppleScript failed: ${String(err)}`);
      }
    }

    // ── adb_command ────────────────────────────────────────────────────────────
    //
    // Runs an ADB command against a connected Android device/emulator.
    // opts.adbArgs = the arguments after "adb", e.g. "install /path/to/app.apk"
    case 'adb_command': {
      const adbArgs = opts?.adbArgs as string | undefined;
      if (!adbArgs) return fail('adb_command requires opts.adbArgs (e.g. "install app.apk").');

      try {
        const { exec } = await import('child_process');
        // Try to find adb — it may be in Android SDK platform-tools
        const adbPath  = await new Promise<string>(resolve => {
          exec('which adb', { timeout: 3_000 }, (_err, stdout) => {
            const found = stdout?.trim();
            resolve(found || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`);
          });
        });

        const output = await new Promise<string>((resolve, reject) => {
          exec(`"${adbPath}" ${adbArgs}`, { timeout: 60_000 }, (err, stdout, stderr) => {
            if (err && !stdout) reject(new Error(stderr?.trim() || err.message));
            else resolve((stdout + '\n' + stderr).trim());
          });
        });

        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            adbOutput: output,
            adbArgs,
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`ADB command failed: ${String(err)}`);
      }
    }

    // ── xcodebuild ─────────────────────────────────────────────────────────────
    //
    // Runs xcodebuild with the given arguments.
    // opts.xcodebuildArgs = arguments string, e.g. "-scheme MyApp -configuration Debug build"
    // opts.projectPath = path to .xcodeproj or .xcworkspace (optional)
    case 'xcodebuild': {
      const xcodebuildArgs = opts?.xcodebuildArgs as string | undefined;
      const projectPath    = opts?.projectPath as string | undefined;

      if (!xcodebuildArgs) {
        return fail('xcodebuild requires opts.xcodebuildArgs (e.g. "-scheme MyApp build").');
      }

      const { exec } = await import('child_process');
      const projectFlag = projectPath
        ? (projectPath.endsWith('.xcworkspace')
            ? `-workspace "${projectPath}"`
            : `-project "${projectPath}"`)
        : '';

      const cmd = `xcodebuild ${projectFlag} ${xcodebuildArgs}`.trim();

      try {
        const output = await new Promise<string>((resolve, reject) => {
          exec(cmd, { timeout: 300_000 }, (err, stdout, stderr) => {
            // xcodebuild returns non-zero on build failure — capture output regardless
            if (err && !stdout && !stderr) reject(new Error(err.message));
            else resolve((stdout + '\n' + stderr).trim());
          });
        });

        // Detect success/failure from output
        const succeeded = output.includes('** BUILD SUCCEEDED **') ||
                          output.includes('** TEST SUCCEEDED **');
        const failed    = output.includes('** BUILD FAILED **') ||
                          output.includes('** TEST FAILED **');

        return {
          phaseResult: makePhaseResult(phase, succeeded ? 'completed' : (failed ? 'failed' : 'completed'), {
            xcodebuildOutput: output.slice(-5000),  // last 5k chars (build output is verbose)
            succeeded,
            failed,
            command: cmd,
          }),
          shouldStop: failed && phase.onFailure === 'stop',
        };
      } catch (err) {
        return fail(`xcodebuild failed: ${String(err)}`);
      }
    }

    // ── ios_awareness_check ────────────────────────────────────────────────────
    //
    // Enumerates all iOS simulators (via simctl) and connected real devices
    // (via devicectl). Returns a structured snapshot used by subsequent iOS phases.
    case 'ios_awareness_check': {
      const runningApps   = await OperatorService.listRunningApps();
      const frontmost     = await OperatorService.getFrontmostApp();
      const snapshot      = await buildIOSAwarenessSnapshot(
        runningApps,
        frontmost?.windowTitle,
      );
      const summary = formatIOSSummary(snapshot);

      if (!snapshot.xcodeCLTAvailable) {
        if (phase.onFailure === 'stop') {
          return fail(
            'Xcode Command Line Tools not found. ' +
            'Run: xcode-select --install, then restart TriForge.',
          );
        }
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          iosSnapshot:       snapshot,
          summary,
          simulatorCount:    snapshot.simulators.length,
          bootedCount:       snapshot.bootedSimulators.length,
          deviceCount:       snapshot.realDevices.length,
          // Convenience: first booted UDID for subsequent phases
          firstBootedUDID:   snapshot.bootedSimulators[0]?.udid,
          firstBootedName:   snapshot.bootedSimulators[0]?.name,
          // Convenience: first available simulator (even if not booted) for auto-select
          firstAvailableUDID:   snapshot.simulators[0]?.udid,
          firstAvailableName:   snapshot.simulators[0]?.name,
          firstAvailableRuntime: snapshot.simulators[0]?.runtime,
          // Real device convenience
          firstDeviceIdentifier: snapshot.realDevices[0]?.identifier,
          firstDeviceName:       snapshot.realDevices[0]?.name,
        }),
        shouldStop: false,
      };
    }

    // ── ios_simctl ─────────────────────────────────────────────────────────────
    //
    // Runs xcrun simctl <args>. The most common use is booting a simulator.
    // opts.simctlArgs = string of arguments after "simctl", e.g. "boot <UDID>"
    // opts.udid       = UDID shorthand — used when simctlArgs is "boot" or "shutdown"
    case 'ios_simctl': {
      // If this phase is for booting, use the bootSimulator helper (handles "already booted")
      const simctlArgs = opts?.simctlArgs as string | undefined;
      const udid       = (opts?.udid as string | undefined)
                        ?? (run.phaseResults.find(r => r.outputs?.firstBootedUDID)?.outputs?.firstBootedUDID as string)
                        ?? (run.phaseResults.find(r => r.outputs?.firstAvailableUDID)?.outputs?.firstAvailableUDID as string);

      if (!udid && !simctlArgs) {
        return fail('ios_simctl requires opts.udid or opts.simctlArgs.');
      }

      // Shorthand: just "boot" → use bootSimulator which handles "already booted" gracefully
      if (simctlArgs === 'boot' || (!simctlArgs && udid)) {
        if (!udid) return fail('ios_simctl boot requires a UDID.');
        const result = await bootSimulator(udid);
        if (!result.ok) {
          return fail(`Simulator boot failed (${udid}): ${result.error}`);
        }
        // Wait briefly for boot to register
        await new Promise(r => setTimeout(r, 2000));
        return {
          phaseResult: makePhaseResult(phase, 'completed', { booted: true, udid }),
          shouldStop: false,
        };
      }

      // Generic simctl command
      const { exec } = await import('child_process');
      const cmd = `xcrun simctl ${simctlArgs}`;
      try {
        const output = await new Promise<string>((resolve, reject) => {
          exec(cmd, { timeout: 60_000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr?.trim() || err.message));
            else resolve((stdout + '\n' + stderr).trim());
          });
        });
        return {
          phaseResult: makePhaseResult(phase, 'completed', { simctlOutput: output, command: cmd }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`simctl failed: ${String(err)}`);
      }
    }

    // ── ios_simulator_screenshot ───────────────────────────────────────────────
    //
    // Captures the current screen of a booted simulator via simctl io screenshot.
    // Picks the first booted simulator from prior ios_awareness_check output.
    // opts.udid = specific simulator UDID (optional — auto-selects if omitted)
    case 'ios_simulator_screenshot': {
      // Find UDID: opts → prior booted result → fail
      const udid: string | undefined =
        (opts?.udid as string | undefined) ??
        (run.phaseResults
          .flatMap(r => [r.outputs?.firstBootedUDID, r.outputs?.udid])
          .find((v): v is string => typeof v === 'string' && v.length > 0));

      if (!udid) {
        if (phase.optional) {
          return {
            phaseResult: makePhaseResult(phase, 'skipped', {
              reason: 'No booted simulator found. Boot a simulator first.',
            }),
            shouldStop: false,
          };
        }
        return fail('No booted simulator UDID available. Run ios_awareness_check first.');
      }

      const result = await captureSimulatorScreen(udid, opts?.outputPath as string | undefined);
      if (!result.ok) {
        if (phase.optional) {
          return {
            phaseResult: makePhaseResult(phase, 'skipped', { reason: result.error }),
            shouldStop: false,
          };
        }
        return fail(`Simulator screenshot failed: ${result.error}`);
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          simulatorScreenshotPath: result.path,
          screenshotUDID: udid,
        }),
        shouldStop: false,
      };
    }

    // ── ios_build_simulator ────────────────────────────────────────────────────
    //
    // Full build + install + launch pipeline for a simulator.
    // Resolves: project path, scheme, UDID, bundle ID, then runs xcodebuild.
    //
    // Required opts (or auto-detected from prior ios_awareness_check):
    //   opts.projectPath  — .xcodeproj or .xcworkspace path
    //   opts.scheme       — build scheme name
    //   opts.udid         — simulator UDID (auto-selects booted if omitted)
    //   opts.bundleId     — app bundle identifier (for launch)
    case 'ios_build_simulator': {
      const { exec } = await import('child_process');

      // Resolve project path
      const projectPath = opts?.projectPath as string | undefined;
      if (!projectPath) return fail('ios_build_simulator requires opts.projectPath (.xcodeproj or .xcworkspace).');

      const scheme = opts?.scheme as string | undefined;
      if (!scheme) return fail('ios_build_simulator requires opts.scheme (build scheme name).');

      // Resolve UDID — prefer explicitly provided, fall back to first booted from scan
      const udid: string | undefined =
        (opts?.udid as string | undefined) ??
        (run.phaseResults
          .flatMap(r => [r.outputs?.firstBootedUDID, r.outputs?.udid])
          .find((v): v is string => typeof v === 'string' && v.length > 0));

      if (!udid) return fail('ios_build_simulator: no booted simulator UDID found. Run ios-scan first.');

      // Build project flag
      const projectFlag = projectPath.endsWith('.xcworkspace')
        ? `-workspace "${projectPath}"`
        : `-project "${projectPath}"`;

      // Derived data path — store build products in tmp for easy retrieval
      const derivedData = path.join(os.tmpdir(), `tf-ios-build-${Date.now()}`);

      const buildCmd = [
        'xcodebuild',
        projectFlag,
        `-scheme "${scheme}"`,
        `-configuration Debug`,
        `-destination "id=${udid}"`,
        `-derivedDataPath "${derivedData}"`,
        'build',
      ].join(' ');

      let buildOutput = '';
      let succeeded   = false;
      try {
        buildOutput = await new Promise<string>((resolve, reject) => {
          exec(buildCmd, { timeout: 300_000 }, (err, stdout, stderr) => {
            const combined = (stdout + '\n' + stderr).trim();
            if (err && !stdout && !stderr) reject(new Error(err.message));
            else resolve(combined);
          });
        });
        succeeded = buildOutput.includes('** BUILD SUCCEEDED **');
      } catch (err) {
        return fail(`xcodebuild failed: ${String(err)}`);
      }

      if (!succeeded) {
        return fail(
          `Build failed for scheme "${scheme}".\n` +
          `Last 2000 chars of output:\n${buildOutput.slice(-2000)}`,
        );
      }

      // Find the built .app bundle
      let appPath = '';
      try {
        const { execSync } = await import('child_process');
        appPath = execSync(
          `find "${derivedData}" -name "*.app" -not -path "*/PlugIns/*" | head -1`,
          { timeout: 5000 },
        ).toString().trim();
      } catch { /* app path is best-effort */ }

      // Install onto simulator
      if (appPath) {
        try {
          await new Promise<void>((resolve, reject) => {
            exec(`xcrun simctl install "${udid}" "${appPath}"`, { timeout: 30_000 }, (err, _stdout, stderr) => {
              if (err) reject(new Error(stderr?.trim() || err.message));
              else resolve();
            });
          });
        } catch (err) {
          return fail(`Simulator install failed: ${String(err)}`);
        }
      }

      // Launch app if bundleId provided
      const bundleId = opts?.bundleId as string | undefined;
      let launched = false;
      if (bundleId && appPath) {
        try {
          await new Promise<void>((resolve, reject) => {
            exec(`xcrun simctl launch "${udid}" "${bundleId}"`, { timeout: 15_000 }, (err, _stdout, stderr) => {
              if (err) reject(new Error(stderr?.trim() || err.message));
              else resolve();
            });
          });
          launched = true;
        } catch { /* launch is best-effort */ }
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          buildSucceeded:   true,
          simulatorUDID:    udid,
          scheme,
          appPath,
          bundleId,
          launched,
          buildOutputTail:  buildOutput.slice(-3000),
          derivedDataPath:  derivedData,
        }),
        shouldStop: false,
      };
    }

    // ── ios_build_device ───────────────────────────────────────────────────────
    //
    // Build for a real device. Requires provisioning profile + signing in project.
    // opts.projectPath, opts.scheme, opts.deviceIdentifier required.
    // Actual install is handled by ios_devicectl phase.
    case 'ios_build_device': {
      const { exec } = await import('child_process');

      const projectPath = opts?.projectPath as string | undefined;
      const scheme      = opts?.scheme as string | undefined;
      const deviceId    = (opts?.deviceIdentifier as string | undefined)
                         ?? (run.phaseResults
                              .flatMap(r => [r.outputs?.firstDeviceIdentifier])
                              .find((v): v is string => typeof v === 'string' && v.length > 0));

      if (!projectPath) return fail('ios_build_device requires opts.projectPath.');
      if (!scheme)      return fail('ios_build_device requires opts.scheme.');
      if (!deviceId)    return fail('ios_build_device: no device identifier. Run ios-scan first.');

      const projectFlag  = projectPath.endsWith('.xcworkspace')
        ? `-workspace "${projectPath}"` : `-project "${projectPath}"`;
      const derivedData  = path.join(os.tmpdir(), `tf-ios-device-${Date.now()}`);
      const buildCmd     = [
        'xcodebuild',
        projectFlag,
        `-scheme "${scheme}"`,
        `-configuration Debug`,
        `-destination "id=${deviceId}"`,
        `-derivedDataPath "${derivedData}"`,
        'build',
      ].join(' ');

      let buildOutput = '';
      let succeeded   = false;
      try {
        buildOutput = await new Promise<string>((resolve, reject) => {
          exec(buildCmd, { timeout: 300_000 }, (err, stdout, stderr) => {
            const combined = (stdout + '\n' + stderr).trim();
            if (err && !stdout && !stderr) reject(new Error(err.message));
            else resolve(combined);
          });
        });
        succeeded = buildOutput.includes('** BUILD SUCCEEDED **');
      } catch (err) {
        return fail(`xcodebuild (device) failed: ${String(err)}`);
      }

      if (!succeeded) {
        return fail(
          `Build failed for device "${deviceId}".\n` +
          `Last 2000 chars:\n${buildOutput.slice(-2000)}`,
        );
      }

      // Find built .app
      let appPath = '';
      try {
        const { execSync } = await import('child_process');
        appPath = execSync(
          `find "${derivedData}" -name "*.app" -not -path "*/PlugIns/*" | head -1`,
          { timeout: 5000 },
        ).toString().trim();
      } catch { /* best-effort */ }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          buildSucceeded:   true,
          deviceIdentifier: deviceId,
          scheme,
          appPath,
          buildOutputTail:  buildOutput.slice(-3000),
          derivedDataPath:  derivedData,
        }),
        shouldStop: false,
      };
    }

    // ── ios_devicectl ──────────────────────────────────────────────────────────
    //
    // Runs xcrun devicectl <args> against a connected real device.
    // Primary use: install app after ios_build_device.
    // opts.devicectlArgs = string of arguments after "devicectl"
    case 'ios_devicectl': {
      const { exec } = await import('child_process');

      // Resolve device identifier
      const deviceId =
        (opts?.deviceIdentifier as string | undefined) ??
        (run.phaseResults
          .flatMap(r => [r.outputs?.firstDeviceIdentifier, r.outputs?.deviceIdentifier])
          .find((v): v is string => typeof v === 'string' && v.length > 0));

      // Resolve app path from prior build
      const appPath =
        (opts?.appPath as string | undefined) ??
        (run.phaseResults
          .map(r => r.outputs?.appPath)
          .find((v): v is string => typeof v === 'string' && v.length > 0));

      if (!deviceId) return fail('ios_devicectl: no device identifier available.');
      if (!appPath)  return fail('ios_devicectl: no app path available. Run ios_build_device first.');

      const installCmd = `xcrun devicectl device install app --device "${deviceId}" "${appPath}"`;

      try {
        const tmpOut = path.join(os.tmpdir(), `tf-devicectl-install-${Date.now()}.json`);
        const output = await new Promise<string>((resolve, reject) => {
          exec(`${installCmd} --json-output "${tmpOut}"`, { timeout: 120_000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr?.trim() || err.message));
            else resolve((stdout + '\n' + stderr).trim());
          });
        });

        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            installed:        true,
            deviceIdentifier: deviceId,
            appPath,
            devicectlOutput:  output,
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`devicectl install failed: ${String(err)}`);
      }
    }

    // ── vision_describe ────────────────────────────────────────────────────────
    case 'vision_describe': {
      const priorShot = run.phaseResults.find(r => r.outputs.screenshotPath)?.outputs.screenshotPath as string | undefined;
      const imgPath   = priorShot ?? opts.screenshotOutputPath as string | undefined;
      if (!imgPath) return fail('vision_describe: no screenshot available. Add a screenshot phase before this one.');

      const desc = await describeScreen(imgPath);
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          visionSummary:    desc.summary,
          activeApp:        desc.activeApp ?? null,
          visibleWindows:   desc.visibleWindows,
          hasKeyboard:      desc.hasKeyboard,
          keyboardType:     desc.keyboardType ?? null,
          dominantContent:  desc.dominantContent ?? null,
          screenshotPath:   imgPath,
        }),
        shouldStop: false,
      };
    }

    // ── vision_locate ──────────────────────────────────────────────────────────
    case 'vision_locate': {
      const priorShot = run.phaseResults.find(r => r.outputs.screenshotPath)?.outputs.screenshotPath as string | undefined;
      const imgPath   = priorShot ?? opts.screenshotOutputPath as string | undefined;
      const element   = opts.elementDescription as string | undefined;
      if (!imgPath)  return fail('vision_locate: no screenshot available. Add a screenshot phase before this one.');
      if (!element)  return fail('vision_locate requires opts.elementDescription.');

      const loc = await locateElement(imgPath, element);
      if (!loc.found) return fail(`vision_locate: "${element}" not found on screen. ${loc.description ?? ''}`);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          found:           true,
          x:               loc.x,
          y:               loc.y,
          width:           loc.width,
          height:          loc.height,
          confidence:      loc.confidence,
          elementDesc:     element,
          description:     loc.description,
          screenshotPath:  imgPath,
        }),
        shouldStop: false,
      };
    }

    // ── vision_ask ─────────────────────────────────────────────────────────────
    case 'vision_ask': {
      const priorShot = run.phaseResults.find(r => r.outputs.screenshotPath)?.outputs.screenshotPath as string | undefined;
      const imgPath   = priorShot ?? opts.screenshotOutputPath as string | undefined;
      const question  = opts.visionQuestion as string | undefined;
      if (!imgPath)  return fail('vision_ask: no screenshot available.');
      if (!question) return fail('vision_ask requires opts.visionQuestion.');

      const answer = await askAboutScreen(imgPath, question);
      return {
        phaseResult: makePhaseResult(phase, 'completed', { question, answer, screenshotPath: imgPath }),
        shouldStop: false,
      };
    }

    // ── vision_verify ──────────────────────────────────────────────────────────
    case 'vision_verify': {
      const priorShot = run.phaseResults.find(r => r.outputs.screenshotPath)?.outputs.screenshotPath as string | undefined;
      const imgPath   = priorShot ?? opts.screenshotOutputPath as string | undefined;
      const expected  = opts.expectedOutcome as string | undefined;
      if (!imgPath) return fail('vision_verify: no screenshot available.');

      const question = expected
        ? `Did the following happen? "${expected}" — answer YES or NO and explain briefly.`
        : 'Describe what happened — did any visible action complete successfully?';

      const answer  = await askAboutScreen(imgPath, question);
      const success = !expected || answer.trim().toUpperCase().startsWith('YES');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          verified:       success,
          expectedOutcome: expected ?? null,
          visionAnswer:   answer,
          screenshotPath: imgPath,
        }),
        shouldStop: false,
      };
    }

    // ── osk_status ─────────────────────────────────────────────────────────────
    case 'osk_status': {
      const status = await getOSKStatus();
      const recommendation = getOSKRecommendationMessage();
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          platform:       status.platform,
          oskRunning:     status.running,
          processName:    status.processName,
          recommended:    status.recommended,
          statusMessage:  status.message,
          recommendation,
        }),
        shouldStop: false,
      };
    }

    // ── osk_open ───────────────────────────────────────────────────────────────
    case 'osk_open': {
      const result = await ensureOSKOpen();
      if (!result.ok) {
        if (phase.onFailure === 'stop') return fail(result.error ?? 'Failed to open on-screen keyboard.');
      }
      const bounds = await getOSKBounds();
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          oskOpened:       result.ok,
          wasAlreadyOpen:  result.wasAlreadyOpen,
          error:           result.error ?? null,
          oskBounds:       bounds,
          recommendation:  getOSKRecommendationMessage(),
        }),
        shouldStop: false,
      };
    }

    // ── osk_close ──────────────────────────────────────────────────────────────
    case 'osk_close': {
      await closeOSK();
      return {
        phaseResult: makePhaseResult(phase, 'completed', { oskClosed: true }),
        shouldStop: false,
      };
    }

    // ── osk_vision_locate ──────────────────────────────────────────────────────
    // Uses vision to find the OSK on screen and locate key positions.
    case 'osk_vision_locate': {
      const priorShot = run.phaseResults.find(r => r.outputs.screenshotPath)?.outputs.screenshotPath as string | undefined;
      const imgPath   = priorShot ?? opts.screenshotOutputPath as string | undefined;
      if (!imgPath) return fail('osk_vision_locate: no screenshot available. Take a screenshot first.');

      const kbDetect = await detectKeyboard(imgPath);
      if (!kbDetect.visible) {
        // OSK not detected by vision — fall back to estimated bounds
        const estimated = await getOSKBounds();
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            keyboardVisible:    false,
            usingEstimatedBounds: true,
            oskBounds:          estimated,
          }),
          shouldStop: false,
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          keyboardVisible:    true,
          keyboardType:       kbDetect.type,
          keyboardPosition:   kbDetect.position,
          oskBounds:          kbDetect.approximate,
          usingEstimatedBounds: false,
        }),
        shouldStop: false,
      };
    }

    // ── osk_type ───────────────────────────────────────────────────────────────
    // Types text by clicking keys on the on-screen keyboard.
    // Each character is looked up in the keyboard bounds and clicked via click_at.
    case 'osk_type': {
      const text = opts.inputText as string | undefined;
      if (!text) return fail('osk_type requires opts.inputText.');

      const priorBounds = run.phaseResults.find(r => r.outputs.oskBounds)?.outputs.oskBounds as
        { x: number; y: number; width: number; height: number } | undefined;

      if (!priorBounds) return fail('osk_type: no keyboard bounds. Run osk_vision_locate first.');

      // For each character, use vision to locate the key then click it.
      // This is intentionally deliberate — one key at a time, fully visible.
      const clickLog: Array<{ char: string; x: number; y: number; ok: boolean }> = [];

      for (const char of text.split('')) {
        // Take a fresh screenshot for each key to get accurate coordinates
        const shotPath = path.join(os.tmpdir(), `tf-osk-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        const shotResult = await OperatorService.captureScreen(shotPath);
        if (!shotResult.ok) {
          clickLog.push({ char, x: 0, y: 0, ok: false });
          continue;
        }

        const loc = await locateElement(shotPath, `the "${char}" key on the on-screen keyboard`);
        if (!loc.found || loc.x === undefined || loc.y === undefined) {
          clickLog.push({ char, x: 0, y: 0, ok: false });
          continue;
        }

        const clickResult = await OperatorService.directClick(loc.x, loc.y, 'left');
        clickLog.push({ char, x: loc.x, y: loc.y, ok: clickResult.ok });
        // Brief pause between keys for the OSK to register the press
        await new Promise(r => setTimeout(r, 80));
      }

      const successCount = clickLog.filter(l => l.ok).length;
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          textTyped:    text,
          keyCount:     text.length,
          successCount,
          failCount:    text.length - successCount,
          clickLog,
        }),
        shouldStop: false,
      };
    }

    // ── screen_watch_start ─────────────────────────────────────────────────────
    case 'screen_watch_start': {
      const state = startScreenWatcher({
        intervalMs:      opts.watchIntervalMs as number | undefined,
        changeThreshold: opts.changeThreshold as number | undefined,
        visionOnChange:  opts.visionOnChange  as boolean | undefined,
      });
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          watcherStarted: true,
          intervalMs:     state.intervalMs,
          threshold:      state.threshold,
          startedAt:      state.startedAt,
        }),
        shouldStop: false,
      };
    }

    // ── screen_watch_stop ──────────────────────────────────────────────────────
    case 'screen_watch_stop': {
      const state = getScreenWatcherState();
      stopScreenWatcher();
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          watcherStopped: true,
          changeCount:    state.changeCount,
          lastChangedAt:  state.lastChangedAt ?? null,
        }),
        shouldStop: false,
      };
    }

    // ── screen_watch_check ─────────────────────────────────────────────────────
    case 'screen_watch_check': {
      const result = await checkScreenChanged();
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          captured:       result.captured,
          screenshotPath: result.screenshotPath,
          changeScore:    result.changeScore,
          significant:    result.significant,
          previousPath:   result.previousPath ?? null,
        }),
        shouldStop: false,
      };
    }

    // ── social_auth ────────────────────────────────────────────────────────────
    //
    // Checks if the platform is already authenticated (stored tokens).
    // If not, opens the browser OAuth flow and waits for the callback.
    // Requires opts.socialPlatform and opts.appCredentials.
    case 'social_auth': {
      const platform = opts.socialPlatform;
      if (!platform) return fail('social_auth requires opts.socialPlatform (youtube|facebook|instagram|tiktok).');

      const status = getAuthStatus();

      if (status[platform]) {
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            platform,
            alreadyConnected: true,
          }),
          shouldStop: false,
        };
      }

      // Not connected — start OAuth flow
      const creds = opts.appCredentials ?? {};

      let connectResult: { ok: boolean; error?: string };

      if (platform === 'youtube') {
        const { clientId, clientSecret } = creds;
        if (!clientId || !clientSecret) return fail('social_auth YouTube requires opts.appCredentials.clientId and clientSecret.');
        connectResult = await connectYouTube({ clientId, clientSecret });

      } else if (platform === 'facebook') {
        const { appId, appSecret } = creds;
        if (!appId || !appSecret) return fail('social_auth Facebook requires opts.appCredentials.appId and appSecret.');
        connectResult = await connectFacebook({ appId, appSecret });

      } else if (platform === 'instagram') {
        const { appId, appSecret } = creds;
        if (!appId || !appSecret) return fail('social_auth Instagram requires opts.appCredentials.appId and appSecret.');
        connectResult = await connectInstagram({ appId, appSecret });

      } else if (platform === 'tiktok') {
        const { clientKey, clientSecret } = creds;
        if (!clientKey || !clientSecret) return fail('social_auth TikTok requires opts.appCredentials.clientKey and clientSecret.');
        connectResult = await connectTikTok({ clientKey, clientSecret });

      } else {
        return fail(`social_auth: unknown platform "${platform}".`);
      }

      if (!connectResult.ok) return fail(connectResult.error ?? 'OAuth flow failed.');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          platform,
          alreadyConnected: false,
          justConnected:    true,
        }),
        shouldStop: false,
      };
    }

    // ── social_select_file ─────────────────────────────────────────────────────
    //
    // Validates that the local file path exists and is a supported type.
    case 'social_select_file': {
      const filePath = opts.filePath;
      if (!filePath) return fail('social_select_file requires opts.filePath.');

      const fsSync = await import('fs');
      if (!fsSync.existsSync(filePath)) {
        return fail(`File not found: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const isVideo = videoExts.includes(ext);
      const isImage = imageExts.includes(ext);

      if (!isVideo && !isImage) {
        return fail(`Unsupported file type "${ext}". Images: ${imageExts.join(', ')}. Videos: ${videoExts.join(', ')}.`);
      }

      const stat = fsSync.statSync(filePath);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          filePath,
          isVideo,
          isImage,
          fileSizeBytes: stat.size,
          ext,
        }),
        shouldStop: false,
      };
    }

    // ── social_upload_youtube ──────────────────────────────────────────────────
    case 'social_upload_youtube': {
      const filePath = opts.filePath ?? (run.phaseResults.find(r => r.outputs.filePath)?.outputs.filePath as string);
      if (!filePath) return fail('social_upload_youtube: no filePath. Run social_select_file first.');

      const creds = opts.appCredentials ?? {};
      if (!creds.clientId || !creds.clientSecret) {
        return fail('social_upload_youtube requires opts.appCredentials.clientId and clientSecret.');
      }

      const result = await publishToYouTube(
        { clientId: creds.clientId, clientSecret: creds.clientSecret },
        filePath,
        {
          title:       opts.videoTitle       ?? path.basename(filePath, path.extname(filePath)),
          description: opts.videoDescription ?? opts.caption ?? '',
          tags:        opts.videoTags,
          privacy:     opts.youtubePrivacy ?? 'private',
        },
      );

      if (!result.ok) return fail(result.error ?? 'YouTube upload failed.');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          platform:  'youtube',
          videoId:   result.videoId,
          videoUrl:  result.videoUrl,
          filePath,
        }),
        shouldStop: false,
      };
    }

    // ── social_upload_facebook ─────────────────────────────────────────────────
    case 'social_upload_facebook': {
      const filePath = opts.filePath ?? (run.phaseResults.find(r => r.outputs.filePath)?.outputs.filePath as string);
      const isVideo  = opts.isVideo ?? (run.phaseResults.find(r => r.outputs.isVideo)?.outputs.isVideo as boolean);
      if (!filePath) return fail('social_upload_facebook: no filePath. Run social_select_file first.');

      const result = await publishToFacebook(
        filePath,
        opts.caption ?? opts.videoTitle ?? path.basename(filePath),
        isVideo,
        opts.videoTitle,
      );

      if (!result.ok) return fail(result.error ?? 'Facebook post failed.');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          platform: 'facebook',
          postId:   result.postId,
          filePath,
        }),
        shouldStop: false,
      };
    }

    // ── social_upload_instagram ────────────────────────────────────────────────
    case 'social_upload_instagram': {
      const filePath = opts.filePath ?? (run.phaseResults.find(r => r.outputs.filePath)?.outputs.filePath as string);
      const isVideo  = opts.isVideo ?? (run.phaseResults.find(r => r.outputs.isVideo)?.outputs.isVideo as boolean);
      if (!filePath) return fail('social_upload_instagram: no filePath. Run social_select_file first.');

      const result = await publishToInstagram(
        filePath,
        opts.caption ?? '',
        isVideo,
      );

      if (!result.ok) return fail(result.error ?? 'Instagram post failed.');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          platform: 'instagram',
          mediaId:  result.mediaId,
          filePath,
        }),
        shouldStop: false,
      };
    }

    // ── social_upload_tiktok ───────────────────────────────────────────────────
    case 'social_upload_tiktok': {
      const filePath = opts.filePath ?? (run.phaseResults.find(r => r.outputs.filePath)?.outputs.filePath as string);
      if (!filePath) return fail('social_upload_tiktok: no filePath. Run social_select_file first.');

      const creds = opts.appCredentials ?? {};
      if (!creds.clientKey || !creds.clientSecret) {
        return fail('social_upload_tiktok requires opts.appCredentials.clientKey and clientSecret.');
      }

      const result = await publishToTikTok(
        { clientKey: creds.clientKey, clientSecret: creds.clientSecret },
        filePath,
        {
          title:        (opts.videoTitle ?? opts.caption ?? path.basename(filePath)).slice(0, 150),
          privacyLevel: opts.tiktokPrivacy ?? 'SELF_ONLY',
          caption:      opts.caption,
        },
      );

      if (!result.ok) return fail(result.error ?? 'TikTok upload failed.');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          platform:  'tiktok',
          publishId: result.publishId,
          shareUrl:  result.shareUrl,
          filePath,
        }),
        shouldStop: false,
      };
    }

    // ── android_awareness_check ────────────────────────────────────────────────
    case 'android_awareness_check': {
      const runningApps  = await OperatorService.listRunningApps();
      const projectPath  = opts.projectPath as string | undefined;
      const snapshot     = await buildAndroidAwarenessSnapshot(runningApps, projectPath);
      const summary      = formatAndroidSummary(snapshot);
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          adbAvailable:        snapshot.adbAvailable,
          adbPath:             snapshot.adbPath,
          deviceCount:         snapshot.devices.length,
          realDeviceCount:     snapshot.realDevices.length,
          emulatorCount:       snapshot.emulators.length,
          avdCount:            snapshot.avds.length,
          avdNames:            snapshot.avds.map(a => a.name),
          firstDeviceSerial:   snapshot.devices[0]?.serial ?? null,
          firstEmulatorSerial: snapshot.emulators[0]?.serial ?? null,
          gradleProjectPath:   snapshot.gradleProject?.rootPath ?? null,
          gradlePath:          snapshot.gradleProject?.gradlePath ?? null,
          expectedApkPath:     snapshot.gradleProject?.expectedApkPath ?? null,
          androidStudioRunning: snapshot.androidStudioRunning,
          summary,
        }),
        shouldStop: false,
      };
    }

    // ── android_gradle_build ───────────────────────────────────────────────────
    case 'android_gradle_build': {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Resolve gradle path from prior phase output or opts
      const priorAndroid = run.phaseResults.find(r => r.outputs.gradlePath);
      const gradlePath   = (opts.gradlePath as string | undefined)
                        ?? (priorAndroid?.outputs.gradlePath as string | undefined);
      const projectRoot  = (opts.projectPath as string | undefined)
                        ?? (priorAndroid?.outputs.gradleProjectPath as string | undefined);

      if (!gradlePath) return fail('android_gradle_build: no Gradle wrapper found. Run android_awareness_check first or set opts.projectPath.');

      try {
        const { stdout, stderr } = await execAsync(`"${gradlePath}" assembleDebug`, {
          cwd:     projectRoot ?? path.dirname(gradlePath),
          timeout: 180_000, // 3 min
        });
        const succeeded = stdout.includes('BUILD SUCCESSFUL') || !stdout.includes('BUILD FAILED');
        const apkPath   = (priorAndroid?.outputs.expectedApkPath as string | undefined)
                       ?? path.join(path.dirname(gradlePath), 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        if (!succeeded) return fail(`Gradle build failed:\n${stderr || stdout}`);
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            buildSucceeded: true,
            apkPath,
            stdout: stdout.slice(-2000),
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`Gradle build error: ${String(err)}`);
      }
    }

    // ── android_install_launch ─────────────────────────────────────────────────
    case 'android_install_launch': {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const priorBuild   = run.phaseResults.find(r => r.outputs.apkPath);
      const priorAware   = run.phaseResults.find(r => r.outputs.adbPath);
      const adbPath      = priorAware?.outputs.adbPath as string | null;
      const serial       = (opts.serial as string | undefined)
                        ?? (priorAware?.outputs.firstEmulatorSerial as string | undefined)
                        ?? (priorAware?.outputs.firstDeviceSerial as string | undefined) as string | undefined;
      const apkPath      = (opts.apkPath as string | undefined) ?? (priorBuild?.outputs.apkPath as string | undefined);

      if (!adbPath)  return fail('android_install_launch: ADB not found.');
      if (!serial)   return fail('android_install_launch: no device serial. Connect a device or boot an emulator.');
      if (!apkPath)  return fail('android_install_launch: no APK path. Run android_gradle_build first.');

      try {
        // Install
        await execAsync(`"${adbPath}" -s "${serial}" install -r "${apkPath}"`, { timeout: 60_000 });

        // Launch — derive package name from APK path or opts
        const packageName = opts.packageName as string | undefined;
        let launched = false;
        if (packageName) {
          const activity = opts.activity as string | undefined;
          const result   = await androidLaunchApp(adbPath, serial, packageName, activity);
          launched = result.ok;
        }

        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            installed: true,
            serial,
            apkPath,
            launched,
            packageName: packageName ?? null,
          }),
          shouldStop: false,
        };
      } catch (err) {
        return fail(`Install/launch error: ${String(err)}`);
      }
    }

    // ── android_screenshot ─────────────────────────────────────────────────────
    case 'android_screenshot': {
      const priorAware = run.phaseResults.find(r => r.outputs.adbPath);
      const adbPath    = priorAware?.outputs.adbPath as string | null;
      const serial     = (opts.serial as string | undefined)
                      ?? (priorAware?.outputs.firstEmulatorSerial as string | undefined)
                      ?? (priorAware?.outputs.firstDeviceSerial as string | undefined) as string | undefined;

      if (!adbPath) return fail('android_screenshot: ADB not available.');
      if (!serial)  return fail('android_screenshot: no device serial. Run android_awareness_check first.');

      const outputPath = opts.screenshotOutputPath as string | undefined;
      const result     = await captureAndroidScreen(adbPath, serial, outputPath);
      if (!result.ok)  return fail(result.error ?? 'Screenshot failed');

      // Optional OCR
      let ocrText: string | undefined;
      try {
        const perception = await OperatorService.perceiveWithOCR(result.path);
        ocrText = perception.ocrText;
      } catch { /* skip OCR if unavailable */ }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          screenshotPath: result.path,
          serial,
          ocrText: ocrText ?? null,
        }),
        shouldStop: false,
      };
    }

    // ── android_input ──────────────────────────────────────────────────────────
    case 'android_input': {
      const priorAware = run.phaseResults.find(r => r.outputs.adbPath);
      const adbPath    = priorAware?.outputs.adbPath as string | null;
      const serial     = (opts.serial as string | undefined)
                      ?? (priorAware?.outputs.firstEmulatorSerial as string | undefined)
                      ?? (priorAware?.outputs.firstDeviceSerial as string | undefined) as string | undefined;

      if (!adbPath) return fail('android_input: ADB not available.');
      if (!serial)  return fail('android_input: no device serial.');

      const inputType = (opts.inputType as string | undefined) ?? 'tap';
      let result: { ok: boolean; error?: string };

      if (inputType === 'tap') {
        const x = opts.x as number | undefined;
        const y = opts.y as number | undefined;
        if (x === undefined || y === undefined) return fail('android_input tap requires opts.x and opts.y.');
        result = await androidTap(adbPath, serial, x, y);

      } else if (inputType === 'text') {
        const text = opts.inputText as string | undefined;
        if (!text) return fail('android_input text requires opts.inputText.');
        result = await androidTypeText(adbPath, serial, text);

      } else if (inputType === 'keyevent') {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const keycode = opts.keycode as string | number | undefined;
        if (!keycode) return fail('android_input keyevent requires opts.keycode.');
        const { stderr } = await execAsync(`"${adbPath}" -s "${serial}" shell input keyevent ${keycode}`, { timeout: 5000 }).catch(e => ({ stderr: String(e) }));
        result = { ok: !stderr, error: stderr || undefined };

      } else {
        return fail(`android_input: unknown inputType "${inputType}". Use tap, text, or keyevent.`);
      }

      if (!result.ok) return fail(result.error ?? 'Input delivery failed');

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          inputDelivered: true,
          inputType,
          serial,
        }),
        shouldStop: false,
      };
    }

    // ── android_launch_avd ─────────────────────────────────────────────────────
    case 'android_launch_avd': {
      const priorAware  = run.phaseResults.find(r => r.outputs.avdNames);
      const avdName     = (opts.avdName as string | undefined)
                       ?? (priorAware?.outputs.avdNames as string[] | undefined)?.[0];

      if (!avdName) return fail('android_launch_avd: no AVD name. Run android_awareness_check first or set opts.avdName.');

      // Resolve emulator binary by checking known paths
      const knownEmulatorPaths = [
        ...(process.env.ANDROID_HOME ? [path.join(process.env.ANDROID_HOME, 'emulator', 'emulator')] : []),
        path.join(os.homedir(), 'Library', 'Android', 'sdk', 'emulator', 'emulator'),
        path.join(os.homedir(), 'Android', 'Sdk', 'emulator', 'emulator'),
        '/usr/local/bin/emulator',
        '/opt/homebrew/bin/emulator',
      ];
      const fs = await import('fs');
      let emulatorPath: string | null = null;
      for (const p of knownEmulatorPaths) {
        if (fs.existsSync(p)) { emulatorPath = p; break; }
      }
      if (!emulatorPath) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const fromPath = await promisify(exec)('which emulator', { timeout: 3000 }).then(r => r.stdout.trim()).catch(() => '');
        if (fromPath && !fromPath.includes('not found')) emulatorPath = fromPath;
      }
      if (!emulatorPath) return fail('android_launch_avd: emulator binary not found. Install Android SDK.');

      // Launch in background (detached)
      const { spawn } = await import('child_process');
      spawn(emulatorPath, [`@${avdName}`], {
        detached: true,
        stdio:    'ignore',
      }).unref();

      // Wait up to 30s for the emulator to appear in adb devices
      const adbPath = priorAware?.outputs.adbPath as string | null;
      let emulatorSerial: string | null = null;
      if (adbPath) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const { stdout } = await execAsync(`"${adbPath}" devices`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
          const match = stdout.match(/^(emulator-\d+)\s+device/m);
          if (match) { emulatorSerial = match[1]; break; }
        }
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          avdName,
          launched:       true,
          emulatorSerial: emulatorSerial ?? 'pending',
          booted:         emulatorSerial !== null,
        }),
        shouldStop: false,
      };
    }

    // ── report ─────────────────────────────────────────────────────────────────
    case 'report': {
      // Assemble outputs from all previous phases into an artifact
      const allOutputs: Record<string, unknown> = {};
      for (const r of run.phaseResults) {
        Object.assign(allOutputs, r.outputs);
      }

      let artifactType: WorkflowArtifact['type'] = 'context_report';
      if (pack.category === 'input')           artifactType = 'input_delivery';
      if (pack.id === 'pack.readiness-check')  artifactType = 'readiness_report';
      if (pack.id === 'pack.unreal-bootstrap') artifactType = 'unreal_readiness_report';
      if (pack.id === 'pack.unreal-build')     artifactType = 'unreal_build_report';
      if (pack.id === 'pack.unreal-triage')    artifactType = 'unreal_triage_report';
      if (pack.id === 'pack.unreal-scaffold')   artifactType = 'unreal_scaffold_report';
      if (pack.id === 'pack.unreal-milestone')   artifactType = 'unreal_milestone_report';
      if (pack.id === 'pack.unreal-m1-execute')  artifactType = 'unreal_m1_execution_report';
      if (pack.id === 'pack.unreal-m2-execute')  artifactType = 'unreal_m2_execution_report';
      if (pack.id === 'pack.unreal-rc-probe')    artifactType = 'unreal_rc_probe_report';
      if (pack.id === 'pack.unreal-m3-execute')  artifactType = 'unreal_m3_execution_report';
      if (pack.id === 'pack.unreal-m4-execute')  artifactType = 'unreal_m4_execution_report';
      if (pack.id === 'pack.unreal-m5-execute')  artifactType = 'unreal_m5_execution_report';
      if (pack.id === 'pack.unreal-editor-operate') artifactType = 'input_delivery';
      if (pack.id === 'pack.unreal-editor-compile') artifactType = 'input_delivery';
      if (pack.id === 'pack.unreal-full-build')     artifactType = 'unreal_m5_execution_report';
      if (pack.category === 'perception')            artifactType = 'perception_snapshot';
      if (pack.id === 'pack.visual-observe')         artifactType = 'perception_snapshot';
      if (pack.id === 'pack.visual-click')           artifactType = 'input_delivery';
      if (pack.id?.startsWith('pack.adobe-'))        artifactType = 'context_report';
      if (pack.id === 'pack.blender')                artifactType = 'context_report';
      if (pack.id === 'pack.logic-pro')              artifactType = 'context_report';
      if (pack.id === 'pack.ableton-live')           artifactType = 'input_delivery';
      if (pack.id === 'pack.pro-tools')              artifactType = 'input_delivery';
      if (pack.id === 'pack.xcode')                  artifactType = 'context_report';
      if (pack.id === 'pack.android-studio')         artifactType = 'context_report';
      if (pack.id === 'pack.ios-scan')               artifactType = 'perception_snapshot';
      if (pack.id === 'pack.ios-build-sim')          artifactType = 'context_report';
      if (pack.id === 'pack.ios-screenshot')         artifactType = 'perception_snapshot';
      if (pack.id === 'pack.ios-build-device')       artifactType = 'context_report';
      if (pack.id === 'pack.android-scan')           artifactType = 'android_scan_report';
      if (pack.id === 'pack.android-build')          artifactType = 'android_build_report';
      if (pack.id === 'pack.android-screenshot')     artifactType = 'android_screenshot_report';
      if (pack.id === 'pack.android-input')          artifactType = 'android_input_report';
      if (pack.id === 'pack.android-launch-avd')     artifactType = 'android_avd_report';
      if (pack.id?.startsWith('pack.publish-'))      artifactType = 'social_publish_report';
      if (pack.id?.startsWith('pack.vision-'))      artifactType = 'vision_report';
      if (pack.id?.startsWith('pack.osk-'))         artifactType = 'osk_report';
      if (pack.id === 'pack.screen-watch')          artifactType = 'screen_watch_report';

      const artifact: WorkflowArtifact = {
        type:        artifactType,
        capturedAt:  nowMs(),
        data:        allOutputs,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', { artifactType, artifact }),
        shouldStop:  false,
      };
    }

    default:
      return fail(`Unknown phase kind: ${phase.kind}`);
  }
}

// ── WorkflowPackService ───────────────────────────────────────────────────────

// ── Run history persistence ───────────────────────────────────────────────────
//
// Saves the last 200 completed/stopped/failed runs to userData/workflow-runs.json.
// Survives app restarts and crashes. Runs that were 'running' or 'paused' at
// crash time are marked 'failed' on hydration so users see an honest state.
//
// Call loadRunHistory(userDataPath) once at startup.
// _runs.set() helpers below call _persistRuns() automatically.

const MAX_PERSISTED_RUNS = 200;
let _runsFilePath = '';

function _persistRuns(): void {
  if (!_runsFilePath) return;
  try {
    // Keep only terminal runs; in-progress runs are persisted as-is
    const all   = Array.from(_runs.values());
    // Sort by startedAt desc, cap at MAX_PERSISTED_RUNS
    const kept  = all
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      .slice(0, MAX_PERSISTED_RUNS);
    fs.writeFileSync(_runsFilePath, JSON.stringify(kept, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

/**
 * Load run history from disk. Call once at startup before any workflow runs.
 * Runs that were interrupted mid-execution are marked 'failed'.
 */
export function loadRunHistory(userDataPath: string): void {
  _runsFilePath = path.join(userDataPath, 'workflow-runs.json');
  try {
    if (!fs.existsSync(_runsFilePath)) return;
    const raw  = fs.readFileSync(_runsFilePath, 'utf8');
    const runs = JSON.parse(raw) as WorkflowRun[];
    for (const run of runs) {
      if (!run?.id) continue;
      // Runs that were active when the process died are marked failed
      if (run.status === 'running' || run.status === 'awaiting_approval') {
        run.status  = 'failed';
        run.endedAt = run.endedAt ?? Date.now();
        run.error   = run.error ?? 'Interrupted — app was closed or crashed before this run finished.';
      }
      _runs.set(run.id, run);
    }
  } catch { /* ignore corrupt or missing file */ }
}

// ── Custom pack store ─────────────────────────────────────────────────────────
// Persists user-built packs to userData/custom-packs.json.
// Loaded once at startup via loadCustomPacks(); mutated by save/delete.

const _customPacks = new Map<string, WorkflowPack>();
let _customPacksFilePath = '';

function _writeCustomPacks(): void {
  if (!_customPacksFilePath) return;
  try {
    fs.writeFileSync(
      _customPacksFilePath,
      JSON.stringify(Array.from(_customPacks.values()), null, 2),
      'utf8',
    );
  } catch { /* best-effort */ }
}

export function loadCustomPacks(userDataPath: string): void {
  _customPacksFilePath = path.join(userDataPath, 'custom-packs.json');
  try {
    if (!fs.existsSync(_customPacksFilePath)) return;
    const raw = fs.readFileSync(_customPacksFilePath, 'utf8');
    const packs = JSON.parse(raw) as WorkflowPack[];
    for (const p of packs) {
      if (p?.id) _customPacks.set(p.id, p);
    }
  } catch { /* ignore corrupt file */ }
}

export const WorkflowPackService = {

  // ── Pack discovery ────────────────────────────────────────────────────────────

  listPacks(): WorkflowPack[] {
    return [...listWorkflowPacks(), ...Array.from(_customPacks.values())];
  },

  getPack(id: string): WorkflowPack | undefined {
    return getWorkflowPack(id) ?? _customPacks.get(id);
  },

  // ── Custom pack CRUD ──────────────────────────────────────────────────────────

  listCustomPacks(): WorkflowPack[] {
    return Array.from(_customPacks.values());
  },

  saveCustomPack(pack: WorkflowPack): void {
    _customPacks.set(pack.id, pack);
    _writeCustomPacks();
  },

  deleteCustomPack(id: string): boolean {
    const had = _customPacks.delete(id);
    if (had) _writeCustomPacks();
    return had;
  },

  // ── Readiness ─────────────────────────────────────────────────────────────────

  async evaluateReadiness(
    packId: string,
    targetApp?: string,
  ): Promise<WorkflowReadinessResult | null> {
    const pack = getWorkflowPack(packId) ?? _customPacks.get(packId);
    if (!pack) return null;

    const capMap = await OperatorService.getCapabilityMap();
    const runningApps = capMap.platform === 'macOS' && (pack.requirements.targetApp || targetApp)
      ? await OperatorService.listRunningApps()
      : undefined;

    const effectivePack: WorkflowPack = targetApp
      ? { ...pack, requirements: { ...pack.requirements, targetApp } }
      : pack;

    return evaluateWorkflowReadiness(effectivePack, capMap, runningApps);
  },

  async evaluateAllReadiness(): Promise<Record<string, WorkflowReadinessResult>> {
    const capMap = await OperatorService.getCapabilityMap();
    const runningApps = capMap.platform === 'macOS'
      ? await OperatorService.listRunningApps()
      : undefined;
    const results: Record<string, WorkflowReadinessResult> = {};
    for (const [id, res] of evaluateAllPackReadiness(
      WORKFLOW_PACK_REGISTRY,
      capMap,
      runningApps,
    )) {
      results[id] = res;
    }
    return results;
  },

  // ── Run management ────────────────────────────────────────────────────────────

  getRun(id: string): WorkflowRun | null {
    return _runs.get(id) ?? null;
  },

  listRuns(): WorkflowRun[] {
    return Array.from(_runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  },

  stopRun(id: string): boolean {
    const run = _runs.get(id);
    if (!run || run.status === 'completed' || run.status === 'failed') return false;
    const updated: WorkflowRun = { ...run, status: 'stopped', endedAt: nowMs() };
    _runs.set(id, updated);
    _persistRuns();
    onWorkflowRunSettled(updated);
    OperatorService.stopSession(run.sessionId, 'workflow stopped');
    eventBus.emit({
      type:      'OPERATOR_SESSION_ENDED',
      sessionId: run.sessionId,
      status:    'stopped',
      actionCount: run.phaseResults.length,
    });
    return true;
  },

  // ── Start a workflow run ──────────────────────────────────────────────────────

  async startRun(
    packId: string,
    opts: WorkflowRunOptions = {},
  ): Promise<{ ok: boolean; run?: WorkflowRun; readinessBlockers?: WorkflowReadinessResult['blockers']; error?: string }> {
    const pack = getWorkflowPack(packId) ?? _customPacks.get(packId);
    if (!pack) {
      return { ok: false, error: `Workflow pack "${packId}" not found.` };
    }

    // Readiness check before starting
    const readiness = await this.evaluateReadiness(packId, opts.targetApp);
    if (!readiness) {
      return { ok: false, error: 'Could not evaluate readiness.' };
    }
    if (!readiness.ready) {
      return { ok: false, readinessBlockers: readiness.blockers };
    }

    // Create operator session
    const session = OperatorService.startSession(opts.targetApp ?? pack.requirements.targetApp);

    const run: WorkflowRun = {
      id:                makeId(),
      packId:            pack.id,
      packName:          pack.name,
      sessionId:         session.id,
      targetApp:         opts.targetApp ?? pack.requirements.targetApp,
      goal:              opts.goal,
      startedAt:         nowMs(),
      status:            'running',
      currentPhaseIndex: 0,
      phaseResults:      [],
    };
    _runs.set(run.id, run);
    _persistRuns();

    eventBus.emit({
      type:            'OPERATOR_SESSION_STARTED',
      sessionId:       session.id,
      intendedTarget:  run.targetApp,
    });

    // Create durable WorkerRun — bridge is a no-op if not initialized
    onWorkflowRunStarted(run, pack);

    // Execute phases sequentially until done, approval gate, or failure
    const result = await this._executePhasesFrom(run.id, pack, opts, 0);

    // Mirror terminal/gate state into durable WorkerRun
    onWorkflowRunSettled(result);

    return { ok: true, run: result };
  },

  // ── Advance a run after an approval is granted ────────────────────────────────

  async advanceRun(
    runId: string,
    opts: WorkflowRunOptions = {},
  ): Promise<{ ok: boolean; run?: WorkflowRun; error?: string }> {
    const run = _runs.get(runId);
    if (!run) return { ok: false, error: `Run "${runId}" not found.` };
    if (run.status !== 'awaiting_approval') {
      return { ok: false, error: `Run is not awaiting approval (status: ${run.status}).` };
    }

    const pack = getWorkflowPack(run.packId);
    if (!pack) return { ok: false, error: `Pack "${run.packId}" not found.` };

    // Advance from the NEXT phase — the approval gate phase already ran and its
    // approvalId is stored in phaseResults. The execute_approved phase reads it.
    // Starting at currentPhaseIndex would re-run queue_input and queue a new action.
    const result = await this._executePhasesFrom(
      run.id, pack, opts, run.currentPhaseIndex + 1,
    );

    // Mirror post-approval terminal/gate state into durable WorkerRun
    onWorkflowRunSettled(result);

    return { ok: true, run: result };
  },

  // ── Internal: execute phases from a given index ───────────────────────────────

  async _executePhasesFrom(
    runId: string,
    pack: WorkflowPack,
    opts: WorkflowRunOptions,
    fromPhaseIndex: number,
  ): Promise<WorkflowRun> {
    let run = _runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    for (let i = fromPhaseIndex; i < pack.phases.length; i++) {
      run = _runs.get(runId)!;

      // Update current phase index
      const updatedRun: WorkflowRun = { ...run, currentPhaseIndex: i };
      _runs.set(runId, updatedRun);
      _persistRuns();
      run = updatedRun;

      const { phaseResult, shouldStop, approvalId } = await executePhase(pack, i, run, opts);

      // Append phase result
      const withResult: WorkflowRun = {
        ...run,
        phaseResults: [...run.phaseResults, phaseResult],
      };
      _runs.set(runId, withResult);
      _persistRuns();
      run = withResult;

      if (phaseResult.status === 'awaiting_approval' && approvalId) {
        const suspended: WorkflowRun = {
          ...run,
          status:             'awaiting_approval',
          pendingApprovalId:  approvalId,
          currentPhaseIndex:  i,  // stay at this phase for advance()
        };
        _runs.set(runId, suspended);
        _persistRuns();
        return suspended;
      }

      if (shouldStop || phaseResult.status === 'failed') {
        const failed: WorkflowRun = {
          ...run,
          status:   'failed',
          endedAt:  nowMs(),
          error:    phaseResult.error ?? 'Phase failed',
        };
        _runs.set(runId, failed);
        _persistRuns();
        eventBus.emit({
          type:       'OPERATOR_ACTION_FAILED',
          sessionId:  run.sessionId,
          actionId:   run.id,
          actionType: pack.phases[i]?.kind ?? 'unknown',
          error:      phaseResult.error ?? 'Phase failed',
        });
        OperatorService.stopSession(run.sessionId, phaseResult.error ?? 'Phase failed');
        return failed;
      }
    }

    // All phases done — build final artifact from the 'report' phase output
    run = _runs.get(runId)!;
    const reportPhaseResult = run.phaseResults.find(r => r.phaseId === 'report');
    const artifact = reportPhaseResult?.outputs?.artifact as WorkflowArtifact | undefined;

    const completed: WorkflowRun = {
      ...run,
      status:   'completed',
      endedAt:  nowMs(),
      artifact,
    };
    _runs.set(runId, completed);
    _persistRuns();

    eventBus.emit({
      type:       'OPERATOR_SESSION_ENDED',
      sessionId:  run.sessionId,
      status:     'completed',
      actionCount: run.phaseResults.length,
    });

    return completed;
  },
};
