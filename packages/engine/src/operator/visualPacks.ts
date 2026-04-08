// ── operator/visualPacks.ts ───────────────────────────────────────────────────
//
// Phase 2 — Generic Visual Control Packs
//
// Two packs that work with ANY running app using the Phase 1 visual loop:
//   perceiveWithOCR (screenshot + OCR) and click_at (mouse click).
//
// These are the foundation packs for all non-Unreal app control.
// Every app-specific pack (Adobe, Blender, DAWs) can chain from these.
//
// Packs:
//   pack.visual-observe  — screenshot + OCR of the frontmost app (read-only)
//   pack.visual-click    — click at pixel coordinates (approval-gated)

import type { WorkflowPack } from './workflowPackTypes';

// ── Pack: Visual Observe ──────────────────────────────────────────────────────

export const VISUAL_OBSERVE: WorkflowPack = {
  id: 'pack.visual-observe',
  name: 'Visual Observe',
  tagline: 'Take a screenshot + OCR of the screen so the AI can read what\'s visible.',
  description:
    'Captures a full-resolution screenshot of the primary display, then runs ' +
    'OCR (optical character recognition) to extract all readable text. ' +
    'Returns a perception artifact containing the screenshot path, raw OCR text, ' +
    'and the frontmost app/window. ' +
    'Use this as the "eyes" step before any visual control action — the AI reads ' +
    'what is on screen, locates the element to interact with, then acts.',
  category: 'perception',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['screenshot'],
    permissions: {
      accessibility:   false,
      screenRecording: true,
    },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'perceive-with-ocr',
      name:        'Screenshot + OCR',
      description: 'Captures the screen and extracts all readable text via tesseract.',
      kind:        'perceive_with_ocr',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'report',
      name:        'Build Perception Artifact',
      description: 'Returns the screenshot path, OCR text, and frontmost app as a structured artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['perception', 'screenshot', 'ocr', 'visual', 'read', 'generic'],
  estimatedDurationSec: 6,
  successCriteria: 'A perception artifact is returned with screenshotPath and ocrText populated.',
};

// ── Pack: Visual Click ────────────────────────────────────────────────────────

export const VISUAL_CLICK: WorkflowPack = {
  id: 'pack.visual-click',
  name: 'Visual Click',
  tagline: 'Click at pixel coordinates on screen — approval-gated.',
  description:
    'Focuses the target app, takes a context screenshot so you can verify the ' +
    'intended click target, then queues a mouse click at specific pixel coordinates ' +
    'for human approval. Nothing is clicked until you approve. ' +
    'After approval, the click is delivered and a post-click screenshot is taken. ' +
    'Requires Accessibility permission. Use perceiveWithOCR first to determine coordinates.',
  category: 'input',
  version: '1.0.0',
  requirements: {
    platforms: ['macOS'],
    capabilities: ['screenshot', 'click_at'],
    permissions: {
      accessibility:   true,
      screenRecording: true,
    },
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'confirm-running',
      name:        'List Running Apps',
      description: 'Verifies the target app is available.',
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
      id:          'perceive-before',
      name:        'Observe Before Click',
      description: 'Screenshots + OCR the screen so the approval shows exactly what will be clicked.',
      kind:        'perceive_with_ocr',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:               'queue-click',
      name:             'Queue Click for Approval',
      description:      'Queues the mouse click and pauses for human approval.',
      kind:             'queue_click_at',
      requiresApproval: true,
      approvalDescription:
        'Review the queued mouse click. The screenshot shows what is currently on screen. ' +
        'Approve only if the target element is visible at the stated coordinates.',
      onFailure: 'stop',
    },
    {
      id:          'execute-approved',
      name:        'Execute Approved Click',
      description: 'Delivers the approved mouse click.',
      kind:        'execute_approved',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'perceive-after',
      name:        'Observe After Click',
      description: 'Screenshots + OCR the screen to confirm the click had the intended effect.',
      kind:        'perceive_with_ocr',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'report',
      name:        'Build Click Result Artifact',
      description: 'Records the click coordinates, before/after screenshots, and OCR comparison.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: ['click', 'mouse', 'visual', 'input', 'coordinates', 'approval', 'generic'],
  estimatedDurationSec: 30,
  successCriteria: 'Click was delivered without a permission error and post-click screenshot captured.',
};
