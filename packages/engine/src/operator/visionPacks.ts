// ── operator/visionPacks.ts ───────────────────────────────────────────────────
//
// Vision Model + OSK + Screen Watch Workflow Packs
//
//   pack.vision-describe    — take screenshot + ask Claude what's on screen
//   pack.vision-locate      — find a named element's pixel coordinates
//   pack.vision-click       — locate + click (full visual click loop)
//   pack.osk-open           — open on-screen keyboard + recommend its use
//   pack.osk-type           — type text using the on-screen keyboard via click_at
//   pack.screen-watch       — start/stop the continuous screen change monitor

import type { WorkflowPack } from './workflowPackTypes';

// ── Pack: Vision Describe ─────────────────────────────────────────────────────

export const VISION_DESCRIBE: WorkflowPack = {
  id:      'pack.vision-describe',
  name:    'Vision: Describe Screen',
  tagline: 'Ask Claude what is currently on screen.',
  description:
    'Takes a screenshot and sends it to the Claude vision model. ' +
    'Returns a structured description: active app, visible windows, ' +
    'whether an on-screen keyboard is visible, and a plain-English summary. ' +
    'Use this as the "understand before acting" step — gives the AI full ' +
    'context about the current screen state without needing pre-programmed coordinates.',
  category: 'perception',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     ['screenshot'],
    permissions:      { screenRecording: true },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'screenshot',
      name:        'Capture Screen',
      description: 'Takes a screenshot of the current display.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'vision-describe',
      name:        'Vision Analysis',
      description: 'Sends screenshot to Claude vision API for description.',
      kind:        'vision_describe',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Vision Report',
      description: 'Returns the vision description and screenshot path.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['vision', 'ai', 'describe', 'perception', 'claude', 'screen'],
  estimatedDurationSec: 10,
  successCriteria: 'Vision description returned with active app and screen summary.',
};

// ── Pack: Vision Locate ───────────────────────────────────────────────────────

export const VISION_LOCATE: WorkflowPack = {
  id:      'pack.vision-locate',
  name:    'Vision: Locate Element',
  tagline: 'Find a UI element by description and return its screen coordinates.',
  description:
    'Takes a screenshot and asks Claude to find the pixel coordinates of a named UI element. ' +
    'Describe the element in plain English: "the blue Save button", "the search box", ' +
    '"the Play button in the bottom toolbar". ' +
    'Returns (x, y) center coordinates suitable for passing directly to a click_at action. ' +
    'This eliminates the need for hard-coded coordinates in any workflow.',
  category: 'perception',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     ['screenshot'],
    permissions:      { screenRecording: true },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'screenshot',
      name:        'Capture Screen',
      description: 'Takes a screenshot to give Claude a current view.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'vision-locate',
      name:        'Vision: Locate Element',
      description: 'Asks Claude to find the pixel coordinates of the target element.',
      kind:        'vision_locate',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'report',
      name:        'Return Coordinates',
      description: 'Returns the located element coordinates.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['vision', 'locate', 'coordinates', 'element', 'find', 'ai', 'claude'],
  estimatedDurationSec: 8,
  successCriteria: 'Element found with pixel coordinates returned.',
};

// ── Pack: Vision Click ────────────────────────────────────────────────────────

export const VISION_CLICK: WorkflowPack = {
  id:      'pack.vision-click',
  name:    'Vision: Find & Click',
  tagline: 'Describe an element in plain English and click it.',
  description:
    'The full visual action loop powered by Claude vision: ' +
    '1) Screenshot the current state. ' +
    '2) Ask Claude where the target element is. ' +
    '3) Queue an approval-gated click at those coordinates. ' +
    '4) Execute the click after approval. ' +
    '5) Take an after-screenshot to confirm the result. ' +
    'Works on any app, any UI — no coordinates or selectors needed. ' +
    'Just describe what to click: "the Export button", "the X in the top corner", "row 3 in the list".',
  category: 'input',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     ['screenshot', 'click_at'],
    permissions:      { screenRecording: true, accessibility: true },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'screenshot-before',
      name:        'Capture Before State',
      description: 'Screenshots the screen before taking any action.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'vision-locate',
      name:        'Locate Target Element',
      description: 'Claude vision finds the pixel coordinates of the described element.',
      kind:        'vision_locate',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:               'click',
      name:             'Click Target',
      description:      'Approval-gated click at the vision-located coordinates.',
      kind:             'queue_click_at',
      requiresApproval: true,
      approvalDescription:
        'Click at the coordinates identified by vision analysis? ' +
        'The before-screenshot shows where Claude found the target element.',
      onFailure:        'stop',
    },
    {
      id:          'screenshot-after',
      name:        'Capture After State',
      description: 'Screenshots the screen to confirm the click had the intended effect.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'vision-verify',
      name:        'Verify Result',
      description: 'Claude vision checks whether the click produced the expected outcome.',
      kind:        'vision_describe',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Action Report',
      description: 'Returns before/after screenshots, coordinates, and vision verification.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['vision', 'click', 'ai', 'locate', 'input', 'claude', 'visual-loop'],
  estimatedDurationSec: 20,
  successCriteria: 'Element located, clicked, and after-state confirmed by vision.',
};

// ── Pack: OSK Open ────────────────────────────────────────────────────────────

export const OSK_OPEN: WorkflowPack = {
  id:      'pack.osk-open',
  name:    'Open On-Screen Keyboard',
  tagline: 'Launch the OS on-screen keyboard and recommend it as the primary input source.',
  description:
    'Opens the operating system\'s built-in on-screen keyboard: ' +
    'macOS Accessibility Keyboard or Windows On-Screen Keyboard (osk.exe). ' +
    'TriForge uses the on-screen keyboard as the primary input method — ' +
    'it lets you see every keystroke before it happens, gives full transparency ' +
    'into what the AI is typing, and works without Accessibility permission on Windows. ' +
    'Run this once at the start of any session that involves text input.',
  category: 'perception',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'osk-status',
      name:        'Check Keyboard Status',
      description: 'Checks whether the on-screen keyboard is already running.',
      kind:        'osk_status',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'osk-open',
      name:        'Open On-Screen Keyboard',
      description: 'Launches the OS on-screen keyboard if not already running.',
      kind:        'osk_open',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'screenshot',
      name:        'Confirm Keyboard Visible',
      description: 'Takes a screenshot to confirm the keyboard appeared on screen.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build OSK Report',
      description: 'Returns keyboard status and recommendation message.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['keyboard', 'osk', 'on-screen', 'input', 'accessibility', 'setup'],
  estimatedDurationSec: 5,
  successCriteria: 'On-screen keyboard is running and visible.',
};

// ── Pack: OSK Type ────────────────────────────────────────────────────────────

export const OSK_TYPE: WorkflowPack = {
  id:      'pack.osk-type',
  name:    'Type via On-Screen Keyboard',
  tagline: 'Type text by clicking keys on the on-screen keyboard — fully visible input.',
  description:
    'Types text by clicking individual keys on the on-screen keyboard. ' +
    'Each keystroke is a click_at action — fully visible, approval-gated, and reversible. ' +
    'The AI uses Claude vision to locate each key on the keyboard before clicking it. ' +
    'This is the most transparent input method: the user can see and stop every key press. ' +
    'Slower than direct keystroke injection but fully auditable and requires no Accessibility permission.',
  category: 'input',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     ['screenshot', 'click_at'],
    permissions:      { screenRecording: true },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'osk-ensure',
      name:        'Ensure Keyboard is Open',
      description: 'Opens the on-screen keyboard if not already visible.',
      kind:        'osk_open',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'screenshot',
      name:        'Capture Keyboard State',
      description: 'Screenshots the screen so Claude can see the keyboard layout.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'vision-locate-keyboard',
      name:        'Locate Keyboard on Screen',
      description: 'Claude vision finds the keyboard bounds and key positions.',
      kind:        'osk_vision_locate',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:               'type-via-osk',
      name:             'Type Text via Keyboard Clicks',
      description:      'Clicks each key on the on-screen keyboard in sequence.',
      kind:             'osk_type',
      requiresApproval: true,
      approvalDescription:
        'Type the following text by clicking keys on the on-screen keyboard? ' +
        'You will see each key click happen in real time.',
      onFailure: 'stop',
    },
    {
      id:          'report',
      name:        'Build Type Report',
      description: 'Returns the typed text and click sequence log.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['keyboard', 'osk', 'type', 'click', 'input', 'vision', 'transparent'],
  estimatedDurationSec: 30,
  successCriteria: 'Text typed via on-screen keyboard clicks.',
};

// ── Pack: Screen Watch ────────────────────────────────────────────────────────

export const SCREEN_WATCH: WorkflowPack = {
  id:      'pack.screen-watch',
  name:    'Screen Change Monitor',
  tagline: 'Watch for screen changes and alert when something significant happens.',
  description:
    'Starts a background monitor that takes a screenshot every few seconds and ' +
    'detects when the screen changes significantly. ' +
    'When a change is detected, Claude vision describes what changed. ' +
    'Use this to: watch for error dialogs, confirm an action completed, ' +
    'detect when a download finishes, or monitor a long-running process. ' +
    'The monitor runs until explicitly stopped or the session ends.',
  category: 'perception',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     ['screenshot'],
    permissions:      { screenRecording: true },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'screenshot',
      name:        'Capture Baseline',
      description: 'Takes the initial screenshot to use as the change-detection baseline.',
      kind:        'screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'screen-watch-start',
      name:        'Start Screen Monitor',
      description: 'Activates the background screen change detector.',
      kind:        'screen_watch_start',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Monitor Report',
      description: 'Returns the watcher status and baseline screenshot.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['monitor', 'watch', 'screen', 'change', 'detect', 'background', 'vision'],
  estimatedDurationSec: 5,
  successCriteria: 'Screen monitor started and baseline captured.',
};
