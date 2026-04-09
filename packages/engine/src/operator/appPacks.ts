// ── operator/appPacks.ts ──────────────────────────────────────────────────────
//
// Phase 2 — App-Specific Workflow Packs
//
// One pack per registered app. Each pack uses the best available control path:
//   - ExtendScript (Adobe) — most powerful for CC apps
//   - Python CLI (Blender) — direct Python in Blender context
//   - AppleScript (Logic Pro, Xcode) — macOS-native
//   - ADB (Android Studio) — command-line device control
//   - Visual (Ableton, Pro Tools) — click+OCR fallback for apps without scripting
//
// All packs build on the visual-observe/visual-click foundation from visualPacks.ts.
// App-specific packs add a scripting phase that uses the app's native API
// before falling back to visual control.

import type { WorkflowPack } from './workflowPackTypes';

// ── Shared phase building blocks ──────────────────────────────────────────────

const STANDARD_PERCEIVE_PHASES = [
  {
    id:          'confirm-running',
    name:        'Confirm App Is Running',
    description: 'Verifies the target app is in the running-apps list.',
    kind:        'list_apps' as const,
    requiresApproval: false,
    onFailure:   'stop' as const,
  },
  {
    id:          'focus-target',
    name:        'Focus App',
    description: 'Brings the app to the foreground.',
    kind:        'focus_app' as const,
    requiresApproval: false,
    onFailure:   'stop' as const,
  },
  {
    id:          'observe',
    name:        'Observe Screen',
    description: 'Screenshots + OCR to read the current app state.',
    kind:        'perceive_with_ocr' as const,
    requiresApproval: false,
    onFailure:   'warn_continue' as const,
    optional:    true,
  },
];

// ── Adobe Photoshop ───────────────────────────────────────────────────────────

export const ADOBE_PHOTOSHOP_PACK: WorkflowPack = {
  id: 'pack.adobe-photoshop',
  name: 'Adobe Photoshop',
  tagline: 'Run Photoshop actions, export layers, or batch-process files via ExtendScript.',
  description:
    'Detects Photoshop, reads the active document via ExtendScript, and can: ' +
    'apply actions, export layers to PNG/JPEG, run batch scripts, and take ' +
    'a visual screenshot of the canvas. ' +
    'ExtendScript runs natively inside Photoshop without any plugin — just Accessibility permission.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Adobe Photoshop',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'extendscript',
      name:        'Run ExtendScript',
      description: 'Executes a JavaScript snippet inside Photoshop via the scripting bridge.',
      kind:        'adobe_extendscript' as const,
      requiresApproval: true,
      approvalDescription: 'Review the ExtendScript that will run inside Photoshop. Scripts can modify or export your document.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns script output, modified document info, and screenshot.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['adobe', 'photoshop', 'creative', 'extendscript', 'export', 'layers'],
  estimatedDurationSec: 20,
  successCriteria: 'ExtendScript executed and result artifact returned.',
};

// ── Adobe Premiere Pro ────────────────────────────────────────────────────────

export const ADOBE_PREMIERE_PACK: WorkflowPack = {
  id: 'pack.adobe-premiere',
  name: 'Adobe Premiere Pro',
  tagline: 'Export sequences, run project actions, or apply presets via ExtendScript.',
  description:
    'Detects Premiere Pro and drives it via ExtendScript: get active sequence info, ' +
    'export to various formats, apply color presets, or batch-process clips. ' +
    'Visual control (click+OCR) available as fallback for UI-driven tasks.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Adobe Premiere Pro',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'extendscript',
      name:        'Run ExtendScript',
      description: 'Executes JavaScript inside Premiere Pro to automate sequences and exports.',
      kind:        'adobe_extendscript' as const,
      requiresApproval: true,
      approvalDescription: 'Review the ExtendScript that will run inside Premiere Pro.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns script output and screenshot.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['adobe', 'premiere', 'video', 'export', 'sequence', 'creative'],
  estimatedDurationSec: 20,
  successCriteria: 'ExtendScript executed and result artifact returned.',
};

// ── Adobe After Effects ───────────────────────────────────────────────────────

export const ADOBE_AFTEREFFECTS_PACK: WorkflowPack = {
  id: 'pack.adobe-aftereffects',
  name: 'Adobe After Effects',
  tagline: 'Render compositions, apply effects, or export via ExtendScript.',
  description:
    'Detects After Effects and drives it via ExtendScript: render active composition, ' +
    'add effects to layers, export to various formats, or manage project items. ' +
    'The ExtendScript API gives full access to the AE object model.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Adobe After Effects',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'extendscript',
      name:        'Run ExtendScript',
      description: 'Executes JavaScript inside After Effects to control compositions and renders.',
      kind:        'adobe_extendscript' as const,
      requiresApproval: true,
      approvalDescription: 'Review the ExtendScript that will run inside After Effects.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns render output, script result, and screenshot.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['adobe', 'after-effects', 'motion', 'render', 'composition', 'creative'],
  estimatedDurationSec: 25,
  successCriteria: 'ExtendScript executed and result artifact returned.',
};

// ── Adobe Illustrator ─────────────────────────────────────────────────────────

export const ADOBE_ILLUSTRATOR_PACK: WorkflowPack = {
  id: 'pack.adobe-illustrator',
  name: 'Adobe Illustrator',
  tagline: 'Export artwork, run scripts, or batch-process vectors via ExtendScript.',
  description:
    'Detects Illustrator and drives it via ExtendScript: export artboards to SVG/PNG/PDF, ' +
    'apply transformations, recolor artwork, or run batch operations across documents.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Adobe Illustrator',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'extendscript',
      name:        'Run ExtendScript',
      description: 'Executes JavaScript inside Illustrator to automate vector artwork tasks.',
      kind:        'adobe_extendscript' as const,
      requiresApproval: true,
      approvalDescription: 'Review the ExtendScript that will run inside Illustrator.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns script result and screenshot.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['adobe', 'illustrator', 'vector', 'export', 'svg', 'creative'],
  estimatedDurationSec: 15,
  successCriteria: 'ExtendScript executed and result artifact returned.',
};

// ── Blender ───────────────────────────────────────────────────────────────────

export const BLENDER_PACK: WorkflowPack = {
  id: 'pack.blender',
  name: 'Blender',
  tagline: 'Run Python in Blender: import meshes, apply modifiers, render, or export.',
  description:
    'Detects Blender and sends a Python script through the Blender --python-expr CLI. ' +
    'Can import/export 3D files, apply modifiers, trigger renders, and export to ' +
    'glTF, FBX, OBJ, or any Blender-supported format. ' +
    'Blender must be running before execution. Visual control via click+OCR available as fallback.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Blender',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'blender-python',
      name:        'Run Python Script',
      description: 'Executes a Python script inside Blender\'s embedded Python environment.',
      kind:        'blender_python' as const,
      requiresApproval: true,
      approvalDescription: 'Review the Python script that will run inside Blender. Scripts can modify your scene or trigger renders.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns script output, any exported file paths, and screenshot.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['blender', '3d', 'python', 'render', 'export', 'mesh', 'gltf'],
  estimatedDurationSec: 30,
  successCriteria: 'Python script ran inside Blender and result artifact returned.',
};

// ── Logic Pro ─────────────────────────────────────────────────────────────────

export const LOGIC_PRO_PACK: WorkflowPack = {
  id: 'pack.logic-pro',
  name: 'Logic Pro',
  tagline: 'Open projects, control transport, or export audio via AppleScript.',
  description:
    'Detects Logic Pro and drives it via AppleScript: open/close projects, ' +
    'control transport (play, stop, record), export tracks to audio files, ' +
    'or adjust tempo/key. Logic Pro has a rich AppleScript dictionary. ' +
    'Visual control available as fallback for tasks not covered by the script API.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['focus_app', 'screenshot', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Logic Pro',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'applescript',
      name:        'Run AppleScript',
      description: 'Executes an AppleScript against Logic Pro to control the session.',
      kind:        'app_applescript' as const,
      requiresApproval: true,
      approvalDescription: 'Review the AppleScript that will run against Logic Pro.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns script output and screenshot.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['logic-pro', 'daw', 'audio', 'applescript', 'export', 'midi'],
  estimatedDurationSec: 20,
  successCriteria: 'AppleScript executed and result artifact returned.',
};

// ── Ableton Live ──────────────────────────────────────────────────────────────

export const ABLETON_LIVE_PACK: WorkflowPack = {
  id: 'pack.ableton-live',
  name: 'Ableton Live',
  tagline: 'AI reads your Ableton screen and determines the exact action to take.',
  description:
    'Detects Ableton Live, takes a screenshot, and uses Claude Vision to determine the ' +
    'best click or keyboard shortcut to achieve your goal — no AppleScript required. ' +
    'The AI shows you its reasoning and the planned action before executing. ' +
    'Common tasks: record arm, export audio, scene launch, tempo change.',
  category: 'input',
  version: '2.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at', 'send_key'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Ableton Live',
    providerRequired: true,
  },
  phases: [
    {
      id:          'confirm-running',
      name:        'Confirm App Is Running',
      description: 'Verifies Ableton Live is in the running-apps list.',
      kind:        'list_apps' as const,
      requiresApproval: false,
      onFailure:   'stop' as const,
    },
    {
      id:          'focus-target',
      name:        'Focus Ableton Live',
      description: 'Brings Ableton Live to the foreground.',
      kind:        'focus_app' as const,
      requiresApproval: false,
      onFailure:   'stop' as const,
    },
    {
      id:               'vision-plan-act',
      name:             'AI Plans Action',
      description:      'Screenshots Ableton, asks Claude Vision what action achieves the goal, and queues it for your approval.',
      kind:             'vision_plan_act' as const,
      requiresApproval: true,
      approvalDescription: 'Review the AI-planned action before it is sent to Ableton Live.',
      onFailure:        'stop' as const,
    },
    {
      id:          'execute-approved',
      name:        'Execute Approved Action',
      description: 'Delivers the AI-planned, user-approved action to Ableton.',
      kind:        'execute_approved' as const,
      requiresApproval: false,
      onFailure:   'stop' as const,
    },
    {
      id:          'perceive-after',
      name:        'Observe Result',
      description: 'Screenshots + OCR to confirm the action had the intended effect.',
      kind:        'perceive_with_ocr' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns before/after screenshots, AI reasoning, and action delivery confirmation.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['ableton', 'daw', 'audio', 'vision', 'ai-planned'],
  estimatedDurationSec: 20,
  successCriteria: 'AI-planned action delivered and post-action screen captured.',
};

// ── Pro Tools ─────────────────────────────────────────────────────────────────

export const PRO_TOOLS_PACK: WorkflowPack = {
  id: 'pack.pro-tools',
  name: 'Pro Tools',
  tagline: 'AI reads your Pro Tools screen and determines the exact action to take.',
  description:
    'Detects Pro Tools, takes a screenshot, and uses Claude Vision to determine the ' +
    'best click or keyboard shortcut to achieve your goal — no AppleScript required. ' +
    'The AI shows you its reasoning and the planned action before executing. ' +
    'Common tasks: record arm/disarm, bounce to disk, import audio, playlist operations.',
  category: 'input',
  version: '2.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'click_at', 'send_key'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Pro Tools',
    providerRequired: true,
  },
  phases: [
    {
      id:          'confirm-running',
      name:        'Confirm App Is Running',
      description: 'Verifies Pro Tools is in the running-apps list.',
      kind:        'list_apps' as const,
      requiresApproval: false,
      onFailure:   'stop' as const,
    },
    {
      id:          'focus-target',
      name:        'Focus Pro Tools',
      description: 'Brings Pro Tools to the foreground.',
      kind:        'focus_app' as const,
      requiresApproval: false,
      onFailure:   'stop' as const,
    },
    {
      id:               'vision-plan-act',
      name:             'AI Plans Action',
      description:      'Screenshots Pro Tools, asks Claude Vision what action achieves the goal, and queues it for your approval.',
      kind:             'vision_plan_act' as const,
      requiresApproval: true,
      approvalDescription: 'Review the AI-planned action before it is sent to Pro Tools.',
      onFailure:        'stop' as const,
    },
    {
      id:          'execute-approved',
      name:        'Execute Approved Action',
      description: 'Delivers the AI-planned, user-approved action to Pro Tools.',
      kind:        'execute_approved' as const,
      requiresApproval: false,
      onFailure:   'stop' as const,
    },
    {
      id:          'perceive-after',
      name:        'Observe Result',
      kind:        'perceive_with_ocr' as const,
      description: 'Screenshots + OCR to confirm the intended state.',
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      kind:        'report' as const,
      description: 'Returns before/after screenshots, AI reasoning, and action delivery confirmation.',
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['pro-tools', 'daw', 'audio', 'vision', 'ai-planned'],
  estimatedDurationSec: 20,
  successCriteria: 'AI-planned action delivered and post-action screen captured.',
};

// ── Xcode ─────────────────────────────────────────────────────────────────────

export const XCODE_PACK: WorkflowPack = {
  id: 'pack.xcode',
  name: 'Xcode',
  tagline: 'Build, run, or test iOS/macOS apps via xcodebuild and AppleScript.',
  description:
    'Detects Xcode and drives builds via xcodebuild CLI plus AppleScript for UI control. ' +
    'Can build schemes, run unit tests, launch simulators, and install to connected devices. ' +
    'xcodebuild output is captured as a structured artifact.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['focus_app', 'screenshot'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Xcode',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'xcodebuild',
      name:        'Run xcodebuild',
      description: 'Executes an xcodebuild command (build, test, archive, etc.).',
      kind:        'xcodebuild' as const,
      requiresApproval: true,
      approvalDescription: 'Review the xcodebuild command that will run against your project.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns build output, success/failure status, and any error messages.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['xcode', 'ios', 'macos', 'swift', 'build', 'mobile-dev', 'test'],
  estimatedDurationSec: 60,
  successCriteria: 'xcodebuild completed and build result artifact returned.',
};

// ── Android Studio ────────────────────────────────────────────────────────────

export const ANDROID_STUDIO_PACK: WorkflowPack = {
  id: 'pack.android-studio',
  name: 'Android Studio',
  tagline: 'Build APKs, install to devices, or capture device screens via ADB.',
  description:
    'Detects Android Studio and connected Android devices via ADB. ' +
    'Can build APKs via Gradle CLI, install to devices, launch activities, ' +
    'capture device screenshots, and deliver touch input via adb shell. ' +
    'All ADB commands run in the approval-gated execution path.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot'],
    permissions: { accessibility: false, screenRecording: true },
    targetApp: 'Android Studio',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'adb-command',
      name:        'Run ADB Command',
      description: 'Executes an ADB command against connected Android device/emulator.',
      kind:        'adb_command' as const,
      requiresApproval: true,
      approvalDescription: 'Review the ADB command that will run against your Android device.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'report',
      name:        'Build Result Artifact',
      description: 'Returns ADB output, device state, and screenshots.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['android', 'adb', 'mobile-dev', 'build', 'install', 'device'],
  estimatedDurationSec: 45,
  successCriteria: 'ADB command completed and result artifact returned.',
};

// ── DaVinci Resolve ───────────────────────────────────────────────────────────

export const DAVINCI_RESOLVE_PACK: WorkflowPack = {
  id: 'pack.davinci-resolve',
  name: 'DaVinci Resolve',
  tagline: 'Color grade, cut timelines, and export deliverables via keyboard automation.',
  description:
    'Detects DaVinci Resolve and operates it through keyboard shortcuts and visual observation. ' +
    'Can switch pages (Cut/Color/Fairlight/Deliver), trigger exports via Cmd+Shift+E, ' +
    'apply grade presets, and capture the current state as a screenshot artifact. ' +
    'DaVinci has no public scripting API — all control is visual+keyboard (click_at + send_key).',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS', 'Windows'],
    capabilities: ['focus_app', 'screenshot', 'send_key', 'click_at'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'DaVinci Resolve',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'navigate-page',
      name:        'Navigate to Page',
      description: 'Uses keyboard shortcut (Shift+4 = Color, Shift+6 = Deliver, etc.) to switch to the target page.',
      kind:        'queue_input' as const,
      requiresApproval: true,
      approvalDescription: 'Review the keyboard shortcut that will switch the active DaVinci Resolve page.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'execute-approved-nav',
      name:        'Execute Page Switch',
      description: 'Executes the approved page navigation keystroke.',
      kind:        'execute_approved' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'execute-action',
      name:        'Execute Action',
      description: 'Queues the requested action via keyboard shortcut (export, grade, timeline operation).',
      kind:        'queue_input' as const,
      requiresApproval: true,
      approvalDescription: 'Review the keyboard shortcut that will execute the requested action in DaVinci Resolve.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'execute-approved-action',
      name:        'Execute Approved Action',
      description: 'Executes the approved keystroke inside DaVinci Resolve.',
      kind:        'execute_approved' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'observe-result',
      name:        'Observe Result',
      description: 'Screenshots the active panel to confirm the operation completed.',
      kind:        'perceive_with_ocr' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
      optional:    true,
    },
    {
      id:          'report',
      name:        'Operation Report',
      description: 'Returns the result screenshot and a description of what was executed.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['davinci', 'resolve', 'video', 'color-grade', 'export', 'timeline', 'creative'],
  estimatedDurationSec: 30,
  successCriteria: 'Requested DaVinci Resolve action executed and result screenshot captured.',
};

// ── Final Cut Pro ─────────────────────────────────────────────────────────────

export const FINAL_CUT_PRO_PACK: WorkflowPack = {
  id: 'pack.finalcut-pro',
  name: 'Final Cut Pro',
  tagline: 'Export timelines, organize libraries, and control playback via AppleScript and keyboard.',
  description:
    'Detects Final Cut Pro and controls it through AppleScript (for open/export triggers) ' +
    'and keyboard shortcuts for timeline operations. ' +
    'Can open projects, trigger Share/Export via Cmd+E, set in/out points, ' +
    'and capture a screenshot artifact of the current timeline state. ' +
    'Full scripting is limited — complex timeline edits use visual click+key.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['focus_app', 'screenshot', 'send_key'],
    permissions: { accessibility: true, screenRecording: true },
    targetApp: 'Final Cut Pro',
    providerRequired: true,
  },
  phases: [
    ...STANDARD_PERCEIVE_PHASES,
    {
      id:          'applescript-trigger',
      name:        'AppleScript Trigger',
      description: 'Uses AppleScript to open a project or trigger a menu action (Share, Export, etc.).',
      kind:        'app_applescript' as const,
      requiresApproval: true,
      approvalDescription: 'Review the AppleScript that will trigger an action in Final Cut Pro.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'keyboard-action',
      name:        'Keyboard Action',
      description: 'Queues a keyboard shortcut for the requested timeline operation.',
      kind:        'queue_input' as const,
      requiresApproval: true,
      approvalDescription: 'Review the keyboard shortcut that will be sent to Final Cut Pro.',
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'execute-approved-key',
      name:        'Execute Approved Key',
      description: 'Executes the approved keyboard shortcut inside Final Cut Pro.',
      kind:        'execute_approved' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
    {
      id:          'observe-result',
      name:        'Observe Result',
      description: 'Screenshots the timeline to confirm the operation completed.',
      kind:        'perceive_with_ocr' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
      optional:    true,
    },
    {
      id:          'report',
      name:        'Operation Report',
      description: 'Returns the result screenshot and execution summary.',
      kind:        'report' as const,
      requiresApproval: false,
      onFailure:   'warn_continue' as const,
    },
  ],
  tags: ['final-cut', 'fcp', 'video', 'export', 'timeline', 'apple', 'creative'],
  estimatedDurationSec: 25,
  successCriteria: 'Requested Final Cut Pro action executed and result screenshot captured.',
};
