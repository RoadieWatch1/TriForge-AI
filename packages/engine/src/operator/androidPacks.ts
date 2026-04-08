// ── operator/androidPacks.ts ──────────────────────────────────────────────────
//
// Phase 3 — Android Workflow Packs
//
// Five packs for Android development automation:
//
//   pack.android-scan        — enumerate connected devices + AVDs (read-only)
//   pack.android-build       — Gradle assembleDebug + adb install + am start
//   pack.android-screenshot  — capture device/emulator screen via adb screencap
//   pack.android-input       — tap, swipe, type, or send keyevents (approval-gated)
//   pack.android-launch-avd  — launch an AVD emulator from the list
//
// The visual feedback loop for Android:
//   android-screenshot → AI reads OCR → android-input (tap/type) → android-screenshot

import type { WorkflowPack } from './workflowPackTypes';

// ── Pack: Android Scan ────────────────────────────────────────────────────────

export const ANDROID_SCAN: WorkflowPack = {
  id: 'pack.android-scan',
  name: 'Android Device & AVD Scan',
  tagline: 'List all connected Android devices and available emulator AVDs.',
  description:
    'Finds the ADB binary, runs adb devices -l to enumerate connected real devices ' +
    'and running emulators with model names and Android versions, ' +
    'then lists available AVDs via emulator -list-avds. ' +
    'Returns a structured snapshot used by build and screenshot packs. ' +
    'Entirely read-only — no approval required.',
  category: 'perception',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: [],
    permissions: {},
    targetApp: null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'scan',
      name:        'Scan Android Targets',
      description: 'Probes ADB, lists connected devices, and enumerates available AVDs.',
      kind:        'android_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'report',
      name:        'Build Android Inventory Report',
      description: 'Returns devices, emulators, AVD list, and Gradle project info.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['android', 'adb', 'device', 'emulator', 'avd', 'scan', 'diagnostic'],
  estimatedDurationSec: 8,
  successCriteria: 'Android awareness snapshot returned with device and AVD lists.',
};

// ── Pack: Android Build & Install ─────────────────────────────────────────────

export const ANDROID_BUILD: WorkflowPack = {
  id: 'pack.android-build',
  name: 'Android Build & Install',
  tagline: 'Build your app with Gradle and install it on a connected device or emulator.',
  description:
    'Full Android build pipeline: ' +
    '1) Scan for connected devices and AVDs. ' +
    '2) Run ./gradlew assembleDebug to build the debug APK. ' +
    '3) Install the APK via adb install. ' +
    '4) Launch the app via adb shell am start. ' +
    '5) Capture a screenshot to confirm the app launched. ' +
    'Requires: a Gradle project with ./gradlew and a connected device or running emulator. ' +
    'All mutating steps are approval-gated.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: [],
    permissions: {},
    targetApp: null,
    providerRequired: true,
  },
  phases: [
    {
      id:          'scan',
      name:        'Scan Android Targets',
      description: 'Finds ADB and enumerates devices + AVDs.',
      kind:        'android_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:               'build',
      name:             'Gradle Build (assembleDebug)',
      description:      'Runs ./gradlew assembleDebug to produce a debug APK.',
      kind:             'android_gradle_build',
      requiresApproval: true,
      approvalDescription:
        'Run ./gradlew assembleDebug in your project root? ' +
        'This compiles your Android app and produces app-debug.apk.',
      onFailure:        'stop',
    },
    {
      id:               'install-launch',
      name:             'Install & Launch',
      description:      'Installs the APK and launches the app on the target device.',
      kind:             'android_install_launch',
      requiresApproval: true,
      approvalDescription:
        'Install the built APK and launch the app on the connected device/emulator?',
      onFailure:        'stop',
    },
    {
      id:          'screenshot',
      name:        'Capture Launch Screenshot',
      description: 'Takes a device screenshot to confirm the app launched successfully.',
      kind:        'android_screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Android Report',
      description: 'Returns build output, APK path, install result, and launch screenshot.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['android', 'gradle', 'build', 'install', 'launch', 'apk', 'debug'],
  estimatedDurationSec: 120,
  successCriteria: 'App built, installed, launched, and launch screenshot captured.',
};

// ── Pack: Android Screenshot ──────────────────────────────────────────────────

export const ANDROID_SCREENSHOT: WorkflowPack = {
  id: 'pack.android-screenshot',
  name: 'Android Screenshot',
  tagline: 'Capture the current screen of a connected Android device or emulator.',
  description:
    'Uses adb exec-out screencap -p to stream a PNG screenshot from the device ' +
    'directly to a local file. Optionally runs OCR on the captured image ' +
    'so the AI can read the screen text. ' +
    'Use this as the "eyes" step in the Android visual feedback loop. ' +
    'Entirely read-only — no approval required.',
  category: 'perception',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: [],
    permissions: {},
    targetApp: null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'scan',
      name:        'Find Target Device',
      description: 'Locates a connected device or running emulator to screenshot.',
      kind:        'android_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'screenshot',
      name:        'Capture Device Screen',
      description: 'Runs adb screencap and streams PNG to a local file.',
      kind:        'android_screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'ocr',
      name:        'OCR Screenshot',
      description: 'Runs tesseract on the captured screenshot to extract readable text.',
      kind:        'perceive_with_ocr',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Screenshot Artifact',
      description: 'Returns screenshot path, OCR text, and device info.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['android', 'screenshot', 'visual', 'observe', 'adb', 'screencap', 'ocr'],
  estimatedDurationSec: 5,
  successCriteria: 'Screenshot artifact returned with path and OCR text.',
};

// ── Pack: Android Input ───────────────────────────────────────────────────────

export const ANDROID_INPUT: WorkflowPack = {
  id: 'pack.android-input',
  name: 'Android Visual Input',
  tagline: 'Tap, swipe, type, or send key events to a device — approval-gated.',
  description:
    'The action step of the Android visual loop. ' +
    'Takes a before-screenshot so you can see exactly what will be tapped, ' +
    'queues the input for approval, executes it, then takes an after-screenshot ' +
    'to confirm the result. ' +
    'Supports: tap at (x, y), swipe, text input, and Android keycodes. ' +
    'Requires a connected device or running emulator.',
  category: 'input',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: [],
    permissions: {},
    targetApp: null,
    providerRequired: true,
  },
  phases: [
    {
      id:          'scan',
      name:        'Find Target Device',
      description: 'Locates the target Android device or emulator.',
      kind:        'android_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'screenshot-before',
      name:        'Capture Before Screenshot',
      description: 'Shows what is on screen so you can verify the tap target.',
      kind:        'android_screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:               'input',
      name:             'Queue Input for Approval',
      description:      'Queues the tap/swipe/type action and waits for approval.',
      kind:             'android_input',
      requiresApproval: true,
      approvalDescription:
        'Review the input action that will be sent to the Android device. ' +
        'The before-screenshot shows the current screen state.',
      onFailure:        'stop',
    },
    {
      id:          'screenshot-after',
      name:        'Capture After Screenshot',
      description: 'Confirms the input had the intended effect.',
      kind:        'android_screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Input Result Artifact',
      description: 'Returns before/after screenshots and input delivery confirmation.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['android', 'tap', 'input', 'touch', 'type', 'keyevent', 'visual', 'adb'],
  estimatedDurationSec: 20,
  successCriteria: 'Input delivered and after-screenshot captured.',
};

// ── Pack: Launch Android AVD ──────────────────────────────────────────────────

export const ANDROID_LAUNCH_AVD: WorkflowPack = {
  id: 'pack.android-launch-avd',
  name: 'Launch Android Emulator',
  tagline: 'Boot an Android Virtual Device (AVD) from the available list.',
  description:
    'Scans available AVDs, selects one (or uses opts.avdName), ' +
    'and launches it in the background via the emulator binary. ' +
    'Waits for the emulator to appear in adb devices before continuing. ' +
    'Once booted, subsequent android-build or android-screenshot packs ' +
    'will automatically target the running emulator.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: [],
    permissions: {},
    targetApp: null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'scan',
      name:        'Scan AVDs',
      description: 'Lists available Android Virtual Devices.',
      kind:        'android_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:               'launch-avd',
      name:             'Launch Emulator',
      description:      'Starts the selected AVD in the background.',
      kind:             'android_launch_avd',
      requiresApproval: true,
      approvalDescription:
        'Launch the selected Android emulator? This will start a Simulator window ' +
        'and may take 30–60 seconds to fully boot.',
      onFailure:        'stop',
    },
    {
      id:          'report',
      name:        'Build Launch Report',
      description: 'Returns the emulator serial and boot confirmation.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['android', 'emulator', 'avd', 'launch', 'boot', 'simulator'],
  estimatedDurationSec: 60,
  successCriteria: 'Emulator launched and visible in adb devices.',
};
