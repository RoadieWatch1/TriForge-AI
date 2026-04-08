// ── operator/iosPacks.ts ──────────────────────────────────────────────────────
//
// Phase 3 — iOS Workflow Packs
//
// Four packs for iOS development automation:
//
//   pack.ios-scan          — enumerate simulators + connected devices (read-only)
//   pack.ios-build-sim     — xcodebuild → install → launch on a simulator
//   pack.ios-screenshot    — capture simulator screen (visual feedback loop)
//   pack.ios-build-device  — xcodebuild → install → launch on a real device
//
// All execution paths go through approval gates before modifying simulator/device state.
// Read-only operations (scan, screenshot) are approval-free.

import type { WorkflowPack } from './workflowPackTypes';

// ── Pack: iOS Scan ────────────────────────────────────────────────────────────

export const IOS_SCAN: WorkflowPack = {
  id: 'pack.ios-scan',
  name: 'iOS Device & Simulator Scan',
  tagline: 'List all available iOS simulators and connected real devices.',
  description:
    'Runs xcrun simctl and xcrun devicectl to enumerate: ' +
    'all iOS simulators (booted and available), ' +
    'connected real devices (USB and WiFi), ' +
    'and the active Xcode project if Xcode is running. ' +
    'Returns a structured snapshot you can use to choose a build destination ' +
    'before running ios-build-sim or ios-build-device. ' +
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
      id:          'ios-scan',
      name:        'Scan Simulators + Devices',
      description: 'Queries simctl + devicectl for the full iOS target inventory.',
      kind:        'ios_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'report',
      name:        'Build iOS Inventory Report',
      description: 'Returns structured lists of simulators and devices with state and UDID.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['ios', 'simulator', 'device', 'scan', 'xcode', 'inventory', 'diagnostic'],
  estimatedDurationSec: 5,
  successCriteria: 'iOS awareness snapshot returned with simulator and device lists.',
};

// ── Pack: iOS Build & Run (Simulator) ─────────────────────────────────────────

export const IOS_BUILD_SIMULATOR: WorkflowPack = {
  id: 'pack.ios-build-sim',
  name: 'iOS Build & Run (Simulator)',
  tagline: 'Build your app and run it on an iOS simulator — end to end.',
  description:
    'Performs the full build-to-simulator pipeline: ' +
    '1) Scans for available simulators and selects a destination. ' +
    '2) Boots the simulator if it is not already running. ' +
    '3) Runs xcodebuild to build the Debug configuration. ' +
    '4) Installs the built .app bundle onto the simulator. ' +
    '5) Launches the app and captures a screenshot to confirm it is running. ' +
    'Requires an Xcode project (.xcodeproj or .xcworkspace) and a build scheme. ' +
    'All mutating steps (boot, install, launch) are approval-gated.',
  category: 'handoff',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['screenshot'],
    permissions: { screenRecording: true },
    targetApp: null,
    providerRequired: true,
  },
  phases: [
    {
      id:          'scan',
      name:        'Scan iOS Targets',
      description: 'Enumerates simulators and selects the best available destination.',
      kind:        'ios_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:               'boot-sim',
      name:             'Boot Simulator',
      description:      'Boots the target simulator if it is not already running.',
      kind:             'ios_simctl',
      requiresApproval: true,
      approvalDescription:
        'Boot the selected iOS simulator? This starts the Simulator app and may take 15–30 seconds.',
      onFailure:        'warn_continue',
    },
    {
      id:               'build',
      name:             'Build App (xcodebuild)',
      description:      'Compiles the project for the simulator destination.',
      kind:             'ios_build_simulator',
      requiresApproval: true,
      approvalDescription:
        'Run xcodebuild to compile your app for the simulator? ' +
        'Review the scheme and project path shown below.',
      onFailure:        'stop',
    },
    {
      id:          'screenshot',
      name:        'Capture Launch Screenshot',
      description: 'Takes a screenshot of the simulator after app launch.',
      kind:        'ios_simulator_screenshot',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Simulation Report',
      description: 'Returns build output, simulator UDID, bundle ID, and launch screenshot.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['ios', 'simulator', 'build', 'xcodebuild', 'launch', 'run', 'debug'],
  estimatedDurationSec: 120,
  successCriteria: 'App built, installed, and launched on simulator with screenshot captured.',
};

// ── Pack: iOS Simulator Screenshot ────────────────────────────────────────────

export const IOS_SIMULATOR_SCREENSHOT: WorkflowPack = {
  id: 'pack.ios-screenshot',
  name: 'iOS Simulator Screenshot',
  tagline: 'Capture the current screen of a booted iOS simulator.',
  description:
    'Takes a PNG screenshot of a booted iOS simulator using xcrun simctl io screenshot. ' +
    'Returns the screenshot as an artifact — use this as the observe step in the ' +
    'iOS visual feedback loop. Requires a booted simulator. ' +
    'Entirely read-only, no approval required.',
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
      name:        'Find Booted Simulator',
      description: 'Queries simctl to find a booted simulator UDID.',
      kind:        'ios_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'screenshot',
      name:        'Capture Simulator Screen',
      description: 'Runs xcrun simctl io <UDID> screenshot to capture the current state.',
      kind:        'ios_simulator_screenshot',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'report',
      name:        'Build Screenshot Artifact',
      description: 'Returns the screenshot path and simulator info.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['ios', 'simulator', 'screenshot', 'visual', 'observe', 'perception'],
  estimatedDurationSec: 4,
  successCriteria: 'Screenshot artifact returned with path to simulator PNG.',
};

// ── Pack: iOS Build & Run (Real Device) ───────────────────────────────────────

export const IOS_BUILD_DEVICE: WorkflowPack = {
  id: 'pack.ios-build-device',
  name: 'iOS Build & Install (Real Device)',
  tagline: 'Build your app and install it on a connected iPhone or iPad.',
  description:
    'Builds the app in Debug configuration for a connected physical device, ' +
    'then installs it via xcrun devicectl. ' +
    'Requires: device connected via USB or WiFi, valid provisioning profile and signing cert, ' +
    'and the device trusted in Finder. ' +
    'All mutating steps are approval-gated. Returns build output and install confirmation.',
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
      name:        'Scan Connected Devices',
      description: 'Queries devicectl for connected real iOS devices.',
      kind:        'ios_awareness_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:               'build',
      name:             'Build App for Device',
      description:      'Runs xcodebuild for the real device destination.',
      kind:             'ios_build_device',
      requiresApproval: true,
      approvalDescription:
        'Run xcodebuild to compile your app for the connected device? ' +
        'This requires valid code signing. Review the scheme and device identifier.',
      onFailure:        'stop',
    },
    {
      id:               'install',
      name:             'Install on Device',
      description:      'Installs the built app bundle on the device via xcrun devicectl.',
      kind:             'ios_devicectl',
      requiresApproval: true,
      approvalDescription:
        'Install the built app on your connected device? This will replace any existing version.',
      onFailure:        'stop',
    },
    {
      id:          'report',
      name:        'Build Device Install Report',
      description: 'Returns build output, device identifier, and install confirmation.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['ios', 'device', 'build', 'install', 'xcodebuild', 'devicectl', 'physical'],
  estimatedDurationSec: 180,
  successCriteria: 'App built for device and installed via devicectl.',
};
