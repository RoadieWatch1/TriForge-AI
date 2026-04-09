// ── unrealFullBuildPack.ts — End-to-End Unreal Game Builder ───────────────────
//
// ONE pack that takes a plain-English game goal and runs the complete pipeline:
//
//   1. Bootstrap check    — verify Unreal Editor is running + project found
//   2. Web research       — DuckDuckGo search for game mechanics + Unreal patterns
//   3. AI scaffold        — Claude Haiku plans the systems needed (with web context)
//   4. Milestone plan     — groups scaffold items into M1–M5 execution milestones
//   5. M1 Execute         — writes core game-mode + player character files
//   6. M2 Execute         — writes health/survival/HUD files
//   7. M3 Execute         — writes inventory/items/interaction files
//   8. M4 Execute         — writes enemy/combat files
//   9. M5 Execute         — writes progression/save-system files
//  10. Editor compile     — focuses Unreal Editor, clicks Compile, waits for result
//
// User experience: type "build me a pac-man game" in chat → click Execute →
// select this pack → TriForge builds and compiles the entire game skeleton.
//
// Requires: Screen Recording + Accessibility permissions, Unreal Editor running.

import type { WorkflowPack } from './workflowPackTypes';

export const UNREAL_FULL_BUILD: WorkflowPack = {
  id:      'pack.unreal-full-build',
  name:    'Unreal — Full Game Build',
  tagline: 'Build a complete game skeleton end-to-end: AI planning → file generation → compile.',
  description: [
    'The complete TriForge Unreal pipeline in a single command. ',
    'Tell TriForge what game you want to build and it handles everything: ',
    'researches the web for game mechanics, uses Claude AI to plan the exact systems needed, ',
    'generates all Blueprint templates and config files across 5 milestone layers, ',
    'then focuses Unreal Editor and compiles the project — all without leaving chat. ',
    '',
    'Works for any game type: platformers, shooters, RPGs, puzzle games, survival, arcade clones. ',
    'Requires Unreal Editor to be running with your project open.',
  ].join(''),
  category: 'input',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     ['focus_app', 'screenshot', 'click_at', 'type_text', 'send_key', 'get_frontmost'],
    permissions: {
      accessibility:   true,
      screenRecording: true,
    },
    targetApp:        'Unreal Editor',
    providerRequired: true,
  },
  phases: [
    {
      id:          'unreal-full-chain',
      name:        'Full Build Pipeline',
      description: 'Research → AI scaffold → generate M1–M5 files → compile in Unreal Editor.',
      kind:        'unreal_full_chain',
      requiresApproval:    true,
      approvalDescription: 'TriForge will research your game concept, plan all systems with AI, generate Blueprint files into your Unreal project, then click Compile. This modifies your project. Approve to begin.',
      onFailure:   'stop',
    },
    {
      id:          'report',
      name:        'Build Summary',
      description: 'Assemble the full build report showing what was planned, generated, and compiled.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags:                 ['unreal', 'game-dev', 'full-build', 'ai-scaffold', 'compile', 'vision'],
  estimatedDurationSec: 300,
  successCriteria:
    'All 5 milestone file sets written to project TriForge/ directory and Unreal Editor compiled without errors.',
};
