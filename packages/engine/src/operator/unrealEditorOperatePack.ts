// ── unrealEditorOperatePack.ts ────────────────────────────────────────────────
//
// Unreal Editor Operate Pack — operates the Unreal Editor UI directly.
//
// This pack executes AFTER the Milestone file-generation packs (M1–M5) have
// written Blueprint templates into the project's TriForge/ directory.
// It focuses the running Unreal Editor, triggers Compile, and waits for the
// result — so TriForge closes the loop from "files written" to "code compiled
// inside the editor."
//
// Vision-first: every UI element is located via Claude Vision screenshot
// analysis, not hard-coded pixel positions. Works across UE4/UE5 window sizes.

import type { WorkflowPack } from './workflowPackTypes';

export const UNREAL_EDITOR_OPERATE: WorkflowPack = {
  id:      'pack.unreal-editor-operate',
  name:    'Unreal Editor — Operate',
  tagline: 'Operate Unreal Editor UI: compile, play, navigate — like a human at the keyboard.',
  description: [
    'Operates the user\'s running Unreal Editor directly via screen vision and mouse/keyboard control — ',
    'exactly as a skilled human with remote desktop access would. ',
    '',
    'After TriForge generates Blueprint and config files into the project\'s TriForge/ directory, ',
    'this pack picks up by: focusing the editor window, clicking the Compile button, ',
    'waiting for compile success, and optionally launching Play In Editor so the user can ',
    'immediately test the generated game systems.',
    '',
    'All UI element locations are determined by Claude Vision — no hard-coded pixel coordinates.',
  ].join(''),
  category: 'input',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS'],
    capabilities:     ['focus_app', 'screenshot', 'click_at', 'send_key'],
    permissions: {
      accessibility:   true,
      screenRecording: true,
    },
    targetApp:        'Unreal Editor',
    providerRequired: true,   // needs Claude Vision to locate UI elements
  },
  phases: [
    {
      id:          'unreal-editor-status-check',
      name:        'Check Editor Status',
      description: 'Verify Unreal Editor is running and detect its current state.',
      kind:        'unreal_editor_status',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'unreal-editor-focus',
      name:        'Focus Unreal Editor',
      description: 'Bring the Unreal Editor window to the foreground.',
      kind:        'unreal_editor_focus',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:                  'unreal-editor-compile',
      name:                'Compile Project',
      description:         'Vision-locate the Compile button in the toolbar and click it, then wait for compilation to complete.',
      kind:                'unreal_editor_compile',
      requiresApproval:    true,
      approvalDescription: 'TriForge will click the Compile button in Unreal Editor and wait for the build result. Approve to proceed.',
      onFailure:           'warn_continue',
    },
    {
      id:                  'unreal-editor-play',
      name:                'Play In Editor',
      description:         'Vision-locate the Play button and click it to launch Play In Editor so you can test the generated game systems.',
      kind:                'unreal_editor_play',
      requiresApproval:    true,
      approvalDescription: 'TriForge will click Play In Editor. Approve to launch the game session.',
      onFailure:           'warn_continue',
      optional:            true,
    },
    {
      id:          'report',
      name:        'Build Operate Report',
      description: 'Assemble compile result and screenshots into a structured artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags:                 ['unreal', 'compile', 'play', 'ui-operate', 'vision', 'game-dev'],
  estimatedDurationSec: 120,
  successCriteria:
    'Unreal Editor compile triggered and completed without errors; Play In Editor launched if approved.',
};

// ── Compile-only variant ───────────────────────────────────────────────────────
// Used after M1–M5 file generation when the user just needs files compiled.

export const UNREAL_EDITOR_COMPILE_ONLY: WorkflowPack = {
  id:      'pack.unreal-editor-compile',
  name:    'Unreal Editor — Compile',
  tagline: 'Click Compile in Unreal Editor and wait for the result.',
  description:
    'Focuses the running Unreal Editor, vision-locates the Compile button, ' +
    'clicks it, and waits up to 2 minutes for compilation to complete. ' +
    'Reports success, errors, or timeout. Designed to run automatically after ' +
    'TriForge writes new Blueprint files into your project.',
  category: 'input',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS'],
    capabilities:     ['focus_app', 'screenshot', 'click_at'],
    permissions: {
      accessibility:   true,
      screenRecording: true,
    },
    targetApp:        'Unreal Editor',
    providerRequired: true,
  },
  phases: [
    {
      id:          'unreal-editor-status-check',
      name:        'Check Editor Is Running',
      description: 'Confirm Unreal Editor is running before attempting compile.',
      kind:        'unreal_editor_status',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'unreal-editor-focus',
      name:        'Focus Unreal Editor',
      description: 'Bring Unreal Editor to front.',
      kind:        'unreal_editor_focus',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:                  'unreal-editor-compile',
      name:                'Compile',
      description:         'Click Compile and wait for the result.',
      kind:                'unreal_editor_compile',
      requiresApproval:    true,
      approvalDescription: 'TriForge will click Compile in Unreal Editor. Approve to proceed.',
      onFailure:           'warn_continue',
    },
    {
      id:          'report',
      name:        'Compile Report',
      description: 'Return compile outcome artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags:                 ['unreal', 'compile', 'vision', 'game-dev'],
  estimatedDurationSec: 90,
  successCriteria:      'Unreal Editor compiled without errors.',
};
