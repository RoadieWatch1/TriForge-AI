// ── operator/workflowPackRegistry.ts ─────────────────────────────────────────
//
// Section 9 — Workflow Packs: Registry
//
// Defines the four honest workflow packs supported by the Section 8 substrate.
//
// Honesty constraints:
//   - Every pack only uses capabilities that Section 8 truly built
//   - No OCR, no pixel-level clicks, no cross-platform pretense
//   - Each pack's phases map directly to OperatorService methods
//   - Approval gates are explicit, not implicit
//
// Packs:
//   1. focus-capture      — Focus an app, capture a screenshot artifact
//   2. supervised-input   — Approval-gated keyboard input delivery
//   3. readiness-check    — Platform/permission/capability diagnostic
//   4. app-context        — Multi-step app context capture

import type { WorkflowPack } from './workflowPackTypes';
import { UNREAL_BOOTSTRAP }        from './unrealBootstrapPack';
import { UNREAL_BUILD_PACKAGE }    from './unrealBuildPack';
import { UNREAL_ERROR_TRIAGE }     from './unrealTriagePack';
import { UNREAL_SYSTEM_SCAFFOLD }  from './unrealScaffoldPack';
import { UNREAL_MILESTONE }         from './unrealMilestonePack';
import { UNREAL_M1_EXECUTE }        from './unrealM1ExecutePack';
import { UNREAL_M2_EXECUTE }        from './unrealM2ExecutePack';
import { UNREAL_RC_PROBE }          from './unrealRCProbePack';
import { UNREAL_M3_EXECUTE }        from './unrealM3ExecutePack';
import { UNREAL_M4_EXECUTE }        from './unrealM4ExecutePack';
import { UNREAL_M5_EXECUTE }        from './unrealM5ExecutePack';
import { UNREAL_EDITOR_OPERATE, UNREAL_EDITOR_COMPILE_ONLY } from './unrealEditorOperatePack';
import { UNREAL_FULL_BUILD } from './unrealFullBuildPack';
// Phase 2 — Visual + App packs
import { VISUAL_OBSERVE, VISUAL_CLICK } from './visualPacks';
// Phase 3 — iOS packs
import {
  IOS_SCAN,
  IOS_BUILD_SIMULATOR,
  IOS_SIMULATOR_SCREENSHOT,
  IOS_BUILD_DEVICE,
} from './iosPacks';
// Phase 3 — Android packs
import {
  ANDROID_SCAN,
  ANDROID_BUILD,
  ANDROID_SCREENSHOT,
  ANDROID_INPUT,
  ANDROID_LAUNCH_AVD,
} from './androidPacks';
// Phase 5 — Social Media packs
import {
  PUBLISH_YOUTUBE,
  PUBLISH_FACEBOOK,
  PUBLISH_INSTAGRAM,
  PUBLISH_TIKTOK,
} from './socialPacks';
// Phase 6 — Vision + OSK + Screen Watch packs
import {
  VISION_DESCRIBE,
  VISION_LOCATE,
  VISION_CLICK,
  OSK_OPEN,
  OSK_TYPE,
  SCREEN_WATCH,
} from './visionPacks';
import {
  ADOBE_PHOTOSHOP_PACK,
  ADOBE_PREMIERE_PACK,
  ADOBE_AFTEREFFECTS_PACK,
  ADOBE_ILLUSTRATOR_PACK,
  BLENDER_PACK,
  LOGIC_PRO_PACK,
  ABLETON_LIVE_PACK,
  PRO_TOOLS_PACK,
  XCODE_PACK,
  ANDROID_STUDIO_PACK,
  DAVINCI_RESOLVE_PACK,
  FINAL_CUT_PRO_PACK,
} from './appPacks';

// ── Pack 1: Focus & Capture ───────────────────────────────────────────────────

const FOCUS_CAPTURE: WorkflowPack = {
  id: 'pack.focus-capture',
  name: 'Focus & Capture',
  tagline: 'Bring an app to front and capture the visible screen state.',
  description:
    'Focuses a named application, confirms the target window is frontmost, ' +
    'then takes a screenshot of the current display. Returns a perception artifact ' +
    'containing the confirmed target and the screenshot path. ' +
    'Useful for: recording what a running app currently shows, creating visual ' +
    'context before a Council discussion, or beginning a supervised work session.',
  category: 'perception',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['focus_app', 'get_frontmost', 'screenshot'],
    permissions: {
      accessibility:   false,
      screenRecording: true,
    },
    targetApp:        null,    // caller supplies the app name
    providerRequired: false,
  },
  phases: [
    {
      id:          'confirm-running',
      name:        'Confirm Target Is Running',
      description: 'Lists running apps and verifies the target is available.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'focus-target',
      name:        'Focus Target App',
      description: 'Brings the target app to the foreground.',
      kind:        'focus_app',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'verify-frontmost',
      name:        'Verify Frontmost Window',
      description: 'Confirms the target app is now the frontmost window.',
      kind:        'get_frontmost',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'capture-screen',
      name:        'Capture Screen',
      description: 'Takes a screenshot of the current display state.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Perception Artifact',
      description: 'Assembles the target confirmation and screenshot into a perception artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['perception', 'screenshot', 'focus', 'context', 'visual'],
  estimatedDurationSec: 5,
  successCriteria:
    'Target app is confirmed frontmost and a screenshot artifact is returned.',
};

// ── Pack 2: Supervised Input ──────────────────────────────────────────────────

const SUPERVISED_INPUT: WorkflowPack = {
  id: 'pack.supervised-input',
  name: 'Supervised Input',
  tagline: 'Deliver approval-gated keyboard input to a focused app.',
  description:
    'Focuses a named application, captures a context screenshot, then queues a ' +
    'keyboard input (typed text or shortcut) for explicit human approval. ' +
    'The run pauses at the approval gate — nothing is typed until you approve. ' +
    'After approval, the input is delivered and a post-action screenshot is taken. ' +
    'Requires Accessibility permission. Input actions cannot be undone once executed.',
  category: 'input',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['focus_app', 'get_frontmost', 'screenshot', 'type_text', 'send_key'],
    permissions: {
      accessibility:   true,
      screenRecording: true,
    },
    targetApp:        null,   // caller supplies the app name
    providerRequired: false,
  },
  phases: [
    {
      id:          'confirm-running',
      name:        'Confirm Target Is Running',
      description: 'Lists running apps and verifies the target is available.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'focus-target',
      name:        'Focus Target App',
      description: 'Brings the target app to the foreground.',
      kind:        'focus_app',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'capture-before',
      name:        'Capture Context Screenshot',
      description: 'Records the screen state before input delivery.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:               'queue-input',
      name:             'Queue Input for Approval',
      description:      'Queues the keyboard input and pauses for human approval.',
      kind:             'queue_input',
      requiresApproval: true,
      approvalDescription:
        'Review the queued keyboard input. The target app must still be focused when you approve.',
      onFailure:        'stop',
    },
    {
      id:          'execute-approved',
      name:        'Execute Approved Input',
      description: 'Delivers the approved keyboard input to the focused window.',
      kind:        'execute_approved',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'capture-after',
      name:        'Capture Post-Input Screenshot',
      description: 'Records the screen state after input delivery.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Input Delivery Artifact',
      description: 'Records the input delivery result as a session artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['input', 'keyboard', 'type', 'shortcut', 'supervised', 'approval'],
  estimatedDurationSec: 30,    // includes human approval wait
  successCriteria:
    'Target app received the approved input without a wrong-target or permission error.',
};

// ── Pack 3: Readiness Check ───────────────────────────────────────────────────

const READINESS_CHECK: WorkflowPack = {
  id: 'pack.readiness-check',
  name: 'Readiness Check',
  tagline: 'Diagnose whether the system is ready for desktop operator work.',
  description:
    'Evaluates platform, permissions, and operator capabilities. ' +
    'Returns a structured readiness report with any blockers and their remediations. ' +
    'Run this before starting more complex workflows to surface missing permissions ' +
    'or unsupported platform constraints. No approval required — entirely read-only.',
  category: 'diagnostic',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows', 'Linux', 'unknown'],
    capabilities: [],
    permissions: {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'check-platform',
      name:        'Check Platform Support',
      description: 'Verifies the current OS is supported for operator work.',
      kind:        'readiness_check',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'check-permissions',
      name:        'Check Permissions',
      description: 'Tests whether Accessibility and Screen Recording are granted.',
      kind:        'readiness_check',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'check-capabilities',
      name:        'Check Operator Capabilities',
      description: 'Verifies each Section 8 capability is available.',
      kind:        'readiness_check',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Readiness Report',
      description: 'Returns a structured readiness report with blockers and remediations.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['diagnostic', 'readiness', 'permissions', 'platform', 'capabilities', 'check'],
  estimatedDurationSec: 8,
  successCriteria:
    'A readiness report is returned — success regardless of blocker count.',
};

// ── Pack 4: App Context Capture ───────────────────────────────────────────────

const APP_CONTEXT: WorkflowPack = {
  id: 'pack.app-context',
  name: 'App Context Capture',
  tagline: 'Build a structured context snapshot of a running app.',
  description:
    'Checks whether a target app is running, identifies the frontmost window ' +
    'and title, and optionally captures a screenshot. Returns a structured context ' +
    'report containing app name, window title, running status, and screenshot path. ' +
    'Designed as the "perceive before acting" preparation step — run this before ' +
    'a Supervised Input or Council discussion to give TriForge machine context.',
  category: 'perception',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['list_apps', 'get_frontmost'],
    permissions: {
      accessibility:   false,
      screenRecording: false,  // screenshot is optional; no hard requirement
    },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'list-apps',
      name:        'List Running Apps',
      description: 'Retrieves all visible running applications.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'get-frontmost',
      name:        'Get Frontmost App',
      description: 'Reads the currently focused app and window title.',
      kind:        'get_frontmost',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'optional-screenshot',
      name:        'Screenshot (Optional)',
      description: 'Captures a screenshot if Screen Recording is granted.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Context Report',
      description: 'Assembles running status, frontmost info, and screenshot into a context report.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['context', 'perception', 'app', 'frontmost', 'snapshot', 'prepare'],
  estimatedDurationSec: 6,
  successCriteria:
    'A context report is returned with running app list and frontmost app details.',
};

// ── Registry ──────────────────────────────────────────────────────────────────

/** All registered workflow packs, in display order. */
export const WORKFLOW_PACK_REGISTRY: WorkflowPack[] = [
  // ── Generic / diagnostic ───────────────────────────────────────────────────
  READINESS_CHECK,
  APP_CONTEXT,
  FOCUS_CAPTURE,
  SUPERVISED_INPUT,
  // ── Phase 2: Generic visual packs (any app) ────────────────────────────────
  VISUAL_OBSERVE,
  VISUAL_CLICK,
  // ── Phase 2: Adobe Creative Suite ─────────────────────────────────────────
  ADOBE_PHOTOSHOP_PACK,
  ADOBE_PREMIERE_PACK,
  ADOBE_AFTEREFFECTS_PACK,
  ADOBE_ILLUSTRATOR_PACK,
  // ── Phase 2: 3D ────────────────────────────────────────────────────────────
  BLENDER_PACK,
  // ── Phase 2: DAWs ──────────────────────────────────────────────────────────
  LOGIC_PRO_PACK,
  ABLETON_LIVE_PACK,
  PRO_TOOLS_PACK,
  // ── Phase 2: Mobile dev ────────────────────────────────────────────────────
  XCODE_PACK,
  ANDROID_STUDIO_PACK,
  // ── Phase 2: Video production ──────────────────────────────────────────────
  DAVINCI_RESOLVE_PACK,
  FINAL_CUT_PRO_PACK,
  // ── Phase 3: iOS ───────────────────────────────────────────────────────────
  IOS_SCAN,
  IOS_BUILD_SIMULATOR,
  IOS_SIMULATOR_SCREENSHOT,
  IOS_BUILD_DEVICE,
  // ── Phase 3: Android ───────────────────────────────────────────────────────
  ANDROID_SCAN,
  ANDROID_BUILD,
  ANDROID_SCREENSHOT,
  ANDROID_INPUT,
  ANDROID_LAUNCH_AVD,
  // ── Phase 6: Vision + OSK + Screen Watch ──────────────────────────────────
  VISION_DESCRIBE,
  VISION_LOCATE,
  VISION_CLICK,
  OSK_OPEN,
  OSK_TYPE,
  SCREEN_WATCH,
  // ── Phase 5: Social Media ──────────────────────────────────────────────────
  PUBLISH_YOUTUBE,
  PUBLISH_FACEBOOK,
  PUBLISH_INSTAGRAM,
  PUBLISH_TIKTOK,
  // ── Unreal Engine ─────────────────────────────────────────────────────────
  UNREAL_BOOTSTRAP,
  UNREAL_BUILD_PACKAGE,
  UNREAL_ERROR_TRIAGE,
  UNREAL_SYSTEM_SCAFFOLD,
  UNREAL_MILESTONE,
  UNREAL_M1_EXECUTE,
  UNREAL_M2_EXECUTE,
  UNREAL_RC_PROBE,
  UNREAL_M3_EXECUTE,
  UNREAL_M4_EXECUTE,
  UNREAL_M5_EXECUTE,
  UNREAL_EDITOR_OPERATE,
  UNREAL_EDITOR_COMPILE_ONLY,
  UNREAL_FULL_BUILD,
];

export function getWorkflowPack(id: string): WorkflowPack | undefined {
  return WORKFLOW_PACK_REGISTRY.find(p => p.id === id);
}

export function listWorkflowPacks(): WorkflowPack[] {
  return WORKFLOW_PACK_REGISTRY;
}

export function getPacksByCategory(category: WorkflowPack['category']): WorkflowPack[] {
  return WORKFLOW_PACK_REGISTRY.filter(p => p.category === category);
}
