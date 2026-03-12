// ── nativeIntentRouter.ts ─────────────────────────────────────────────────────
//
// Shared native intent execution layer for all chat handlers.
//
// Rule: when a user message maps to a Triforge-native capability, execute the
// real internal service instead of sending the message to an LLM.
//
// Returns null for non-native intents → caller falls through to normal chat.
// Returns NativeExecutionResult for native intents → caller short-circuits.
//
// Capabilities routed here:
//   image_request    → ImageService.generate()
//   mission_request  → missionController.startMission()
//   task_request     → TaskStore.create()
//   phone_request    → PhoneLinkServer status + pairing
//   desktop_control  → BrowserWindow.show/focus
//   folder_audit     → buildFolderAudit() + formatAuditAsText()
//
// Adding a new capability: add its intent case to route(), implement a private
// _handle<X> method, done. ipc.ts stays thin.

import * as path from 'path';
import { BrowserWindow } from 'electron';
import {
  detectIntentType,
  ImageService,
  TaskStore,
  buildFolderAudit,
  formatAuditAsText,
  type SystemStateSnapshot,
} from '@triforge/engine';
import { missionController } from '../core/engineering/MissionController';
import type { MissionIntent } from '../core/engineering/types';
import type { PhoneLinkServer } from './phoneLink';
import { AUTONOMY_FLAGS } from '../core/config/autonomyFlags';

// ── Result shape ──────────────────────────────────────────────────────────────

export type NativeExecutionStatus =
  | 'executed'
  | 'created'
  | 'scheduled'
  | 'requires_approval'
  | 'missing_args'
  | 'unavailable'
  | 'already_active'
  | 'error';

export type NativeExecutionType =
  | 'image'
  | 'mission'
  | 'task'
  | 'phone'
  | 'desktop'
  | 'folder_audit';

export interface NativeExecutionResult {
  ok: boolean;
  type: NativeExecutionType;
  status: NativeExecutionStatus;
  /** Human-readable message safe to show directly as a Council response */
  message: string;
  data?: Record<string, unknown>;
  missingArgs?: string[];
  unavailableReason?: string;
}

// ── Dependency bag (injected from ipc.ts) ─────────────────────────────────────

export interface NativeIntentRouterDeps {
  getImageService: () => Promise<ImageService>;
  getTaskStore:    () => TaskStore;
  getPhoneLinkRef: () => PhoneLinkServer | null;
  /** Opens native folder picker; returns selected path or null if canceled. */
  pickFolder:      () => Promise<string | null>;
}

// ── Goal / title extraction helpers ──────────────────────────────────────────

const MISSION_TRIGGER_RE =
  /^(?:plan|start|launch|create|run|begin|kick off|initiate)\s+(?:a\s+)?mission\s+(?:to|for|about|on|around)?\s*/i;

const TASK_TRIGGER_RE =
  /^(?:create|add|make|schedule|set up|remind me to|add a task to|create a task to|schedule a task for|remind me)\s*/i;

function extractGoal(message: string, re: RegExp): string {
  return message.replace(re, '').trim() || message.trim();
}

function inferMissionIntent(message: string): MissionIntent {
  const lower = message.toLowerCase();
  if (/\bfix\b|\bdebug\b|\brepair\b|\bsolve\b/.test(lower))     return 'fix';
  if (/\brefactor\b|\bclean\b|\boptimize\b|\bimprove\b/.test(lower)) return 'refactor';
  if (/\baudit\b|\breview\b|\banalyze\b|\binspect\b/.test(lower)) return 'audit';
  if (/\btest\b|\btesting\b/.test(lower))                        return 'test';
  if (/\bdocs?\b|\bdocument\b/.test(lower))                      return 'docs';
  return 'build';
}

// ── Router ────────────────────────────────────────────────────────────────────

export class NativeIntentRouter {
  constructor(private deps: NativeIntentRouterDeps) {}

  /**
   * Inspect message, execute the matching native capability if one is found.
   * Returns null when the message should be handled by the normal chat path.
   */
  async route(message: string, snapshot: SystemStateSnapshot): Promise<NativeExecutionResult | null> {
    const intent = detectIntentType(message);
    switch (intent) {
      case 'image_request':   return this._handleImage(message, snapshot);
      case 'mission_request': return this._handleMission(message, snapshot);
      case 'task_request':    return this._handleTask(message, snapshot);
      case 'phone_request':   return this._handlePhone(snapshot);
      case 'desktop_control': return this._handleDesktop();
      case 'folder_audit':    return this._handleFolderAudit(message, snapshot);
      default:                return null;
    }
  }

  // ── Image ──────────────────────────────────────────────────────────────────

  private async _handleImage(
    message: string,
    snapshot: SystemStateSnapshot,
  ): Promise<NativeExecutionResult> {
    if (!snapshot.imageReady) {
      return {
        ok: false, type: 'image', status: 'unavailable',
        message: 'Image generation is installed but not configured. Add an OpenAI or Grok API key in Settings → API Keys to enable it.',
        unavailableReason: 'No image-capable API key found.',
      };
    }
    try {
      const svc = await this.deps.getImageService();
      if (!svc.canGenerate()) {
        return {
          ok: false, type: 'image', status: 'unavailable',
          message: 'Image generation requires an OpenAI or Grok API key. Add one in Settings → API Keys.',
          unavailableReason: 'ImageService.canGenerate() returned false.',
        };
      }
      const result = await svc.generate({ userPrompt: message, enableRefine: true });
      return {
        ok: true, type: 'image', status: 'executed',
        message: `Here's your generated image.\n\nPrompt used: ${result.refinedPrompt}`,
        data: { imageResult: result as unknown as Record<string, unknown> },
      };
    } catch (err: unknown) {
      return {
        ok: false, type: 'image', status: 'error',
        message: `Image generation failed: ${err instanceof Error ? err.message : String(err)}. You can also try the Image Generator directly from the sidebar.`,
      };
    }
  }

  // ── Mission ────────────────────────────────────────────────────────────────

  private async _handleMission(
    message: string,
    snapshot: SystemStateSnapshot,
  ): Promise<NativeExecutionResult> {
    if (!AUTONOMY_FLAGS.enableMissionController) {
      return {
        ok: false, type: 'mission', status: 'unavailable',
        message: 'Mission control is not enabled in this build. Enable it in autonomy flags to start missions from chat.',
        unavailableReason: 'AUTONOMY_FLAGS.enableMissionController is false.',
      };
    }

    const anyProvider = Object.values(snapshot.providers).some(Boolean);
    if (!anyProvider) {
      return {
        ok: false, type: 'mission', status: 'unavailable',
        message: 'At least one AI provider key is required to start a mission. Add an API key in Settings.',
        unavailableReason: 'No AI provider configured.',
      };
    }

    if (snapshot.activeMissionId) {
      return {
        ok: false, type: 'mission', status: 'already_active',
        message: `A mission is already active (ID: ${snapshot.activeMissionId}). Complete or cancel it before starting a new one.`,
        data: { activeMissionId: snapshot.activeMissionId },
      };
    }

    const goal = extractGoal(message, MISSION_TRIGGER_RE);
    if (!goal || goal.length < 5) {
      return {
        ok: false, type: 'mission', status: 'missing_args',
        message: 'What should this mission accomplish? Describe your goal and I\'ll set it up.',
        missingArgs: ['goal'],
      };
    }

    try {
      const intent = inferMissionIntent(message);
      const req = {
        id: crypto.randomUUID(),
        raw: message,
        intent,
        source: 'typed' as const,
        goal,
        constraints: { noUiChanges: true, requireApproval: true, safePreviewOnly: true },
        createdAt: Date.now(),
      };
      const missionId = await missionController.startMission(req);
      return {
        ok: true, type: 'mission', status: 'requires_approval',
        message: `Mission created: **${goal}**\n\nThe Council is planning the mission steps. You'll be asked to review and approve the plan before anything executes. Mission ID: \`${missionId}\``,
        data: { missionId, goal, intent },
      };
    } catch (err: unknown) {
      return {
        ok: false, type: 'mission', status: 'error',
        message: `Mission creation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── Task ───────────────────────────────────────────────────────────────────

  private _handleTask(message: string, snapshot: SystemStateSnapshot): NativeExecutionResult {
    const title = extractGoal(message, TASK_TRIGGER_RE);
    if (!title || title.length < 3) {
      return {
        ok: false, type: 'task', status: 'missing_args',
        message: 'What should the task be? Describe it and I\'ll create it for you.',
        missingArgs: ['title'],
      };
    }

    try {
      const ts = this.deps.getTaskStore();
      const task = ts.create({
        id: crypto.randomUUID(),
        goal: title,
        category: 'general',
        status: 'queued',
        currentStepIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return {
        ok: true, type: 'task', status: 'created',
        message: `Task created: **${title}**\n\nIt's been added to your task queue. You can review it in the Tasks panel. Task ID: \`${task.id}\``,
        data: { taskId: task.id, goal: task.goal },
      };
    } catch (err: unknown) {
      return {
        ok: false, type: 'task', status: 'error',
        message: `Task creation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── Phone ──────────────────────────────────────────────────────────────────

  private _handlePhone(snapshot: SystemStateSnapshot): NativeExecutionResult {
    const server = this.deps.getPhoneLinkRef();

    if (!server) {
      return {
        ok: false, type: 'phone', status: 'unavailable',
        message: 'Phone Link service is not available in this session. Try restarting Triforge.',
        unavailableReason: 'PhoneLinkServer reference not initialized.',
      };
    }

    const st = server.status();

    if (snapshot.phonePaired && (st.pairedDevices ?? 0) > 0) {
      return {
        ok: true, type: 'phone', status: 'already_active',
        message: `Your phone is already paired (${st.pairedDevices} device${st.pairedDevices === 1 ? '' : 's'} connected). You can manage it in Settings → Phone Link.`,
        data: { pairedDevices: st.pairedDevices },
      };
    }

    // Start the server if not running, then return a pair token
    try {
      if (!st.running) {
        server.start();
      }
      const tokenData = server.generateNewPairToken();
      return {
        ok: true, type: 'phone', status: 'executed',
        message: `Phone pairing started. Scan the QR code or enter the token in the Triforge mobile app to pair your device.\n\nYou can also open Settings → Phone Link for the full pairing interface.`,
        data: { tokenData: tokenData as unknown as Record<string, unknown>, url: st.url },
      };
    } catch (err: unknown) {
      return {
        ok: false, type: 'phone', status: 'error',
        message: `Phone pairing failed: ${err instanceof Error ? err.message : String(err)}. Open Settings → Phone Link to pair manually.`,
      };
    }
  }

  // ── Desktop ────────────────────────────────────────────────────────────────

  private _handleDesktop(): NativeExecutionResult {
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    if (windows.length === 0) {
      return {
        ok: false, type: 'desktop', status: 'unavailable',
        message: 'No Triforge window is available to focus.',
        unavailableReason: 'No open BrowserWindows found.',
      };
    }
    for (const win of windows) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    return {
      ok: true, type: 'desktop', status: 'executed',
      message: `Triforge is now in the foreground. ${windows.length > 1 ? `${windows.length} windows brought forward.` : ''}`.trim(),
      data: { windowCount: windows.length },
    };
  }

  // ── Folder Audit ───────────────────────────────────────────────────────────

  private async _handleFolderAudit(
    message: string,
    snapshot: SystemStateSnapshot,
  ): Promise<NativeExecutionResult> {
    // Permission check
    if (!snapshot.permissions.files) {
      return {
        ok: false, type: 'folder_audit', status: 'unavailable',
        message: 'Folder audit is installed but the **Files** permission is not enabled. Go to Settings → Permissions and grant Files access to use this capability.',
        unavailableReason: 'Files permission not granted.',
      };
    }

    // Try to extract an explicit path from the message
    // Pattern: a path-like token (C:\..., /home/..., ~/..., ./...)
    const explicitPath = this._extractPath(message);
    let folderPath = explicitPath;

    if (!folderPath) {
      // No explicit path — open native folder picker
      folderPath = await this.deps.pickFolder();
      if (!folderPath) {
        return {
          ok: false, type: 'folder_audit', status: 'missing_args',
          message: 'No folder was selected. Open the folder picker again and choose a folder to audit.',
          missingArgs: ['folderPath'],
        };
      }
    }

    try {
      const result = await buildFolderAudit(folderPath);
      if (!result.ok) {
        return {
          ok: false, type: 'folder_audit', status: 'error',
          message: `Could not audit the folder: ${result.unavailableReason ?? result.summary}`,
          unavailableReason: result.unavailableReason,
        };
      }
      return {
        ok: true, type: 'folder_audit', status: 'executed',
        message: formatAuditAsText(result),
        data: { auditResult: result as unknown as Record<string, unknown> },
      };
    } catch (err: unknown) {
      return {
        ok: false, type: 'folder_audit', status: 'error',
        message: `Folder audit failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Extract a file-system path from a message, or return null. */
  private _extractPath(message: string): string | null {
    // Windows absolute path: C:\... or D:/...
    const winMatch = message.match(/[A-Za-z]:[/\\][^\s"']+/);
    if (winMatch) return path.normalize(winMatch[0]);
    // Unix absolute: /home/... /Users/...
    const unixMatch = message.match(/\/[a-zA-Z][^\s"']+/);
    if (unixMatch) return unixMatch[0];
    // Home-relative: ~/...
    const homeMatch = message.match(/~[/\\][^\s"']*/);
    if (homeMatch) return homeMatch[0];
    return null;
  }
}
