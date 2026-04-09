// ── operator/workflowChainRegistry.ts ────────────────────────────────────────
//
// Phase C1 — Multi-app workflow composition.
//
// A WorkflowChain is an ordered list of workflow pack runs that share state
// across packs. The killer feature competitors cannot match: chaining
// Photoshop → Premiere → YouTube in a single user-initiated mission.
//
// Design principles (kept deliberately small):
//
//   • A chain is a static ordered list of links. Each link references an
//     existing pack ID and provides the options for that step.
//   • Each link's options can reference shared chain state via simple
//     string substitution (e.g. "{{logoPath}}"). The chain runner injects
//     state at execution time.
//   • Links can declare what they CONTRIBUTE to chain state (e.g. the
//     output file path). Contributions are computed by a small reducer
//     that runs on the prior link's WorkflowRun result.
//   • If any link enters approval-gated state, the entire chain pauses
//     and waits for the user. The user advances both the link's run AND
//     the chain.
//   • If any link fails, the chain stops with status='failed'.
//
// This file lives in the engine because it is purely declarative — the
// chain runner that actually drives execution lives in
// packages/desktop/src/main/services/workflowChainService.ts.

import type { WorkflowRunOptions } from './workflowPackTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Shared state object passed between chain links.
 *
 * Each link can read prior values and contribute new ones. Values are
 * referenced from option strings via {{key}} substitution before each
 * link runs.
 *
 * Example after a Photoshop export step:
 *   { logoPath: "/Users/x/Desktop/logo.png", logoWidth: 512, logoHeight: 512 }
 */
export type ChainState = Record<string, string | number | boolean | null | undefined>;

/**
 * A function that extracts new chain state values from a link's run result.
 * Called after each link's pack run finishes (including approval gates).
 */
export type ChainStateContributor = (priorRunArtifactJson: unknown, currentState: ChainState) => ChainState;

/**
 * One step in a chain — a single pack run with its options template.
 */
export interface WorkflowChainLink {
  /** Pack ID to run. Must exist in WORKFLOW_PACK_REGISTRY or custom packs. */
  packId: string;
  /** Human label shown in the chain UI. */
  label: string;
  /**
   * Options template. Strings inside this object that contain {{key}} markers
   * are substituted from chain state at run time. Non-string values pass
   * through unchanged.
   */
  optionsTemplate: WorkflowRunOptions;
  /**
   * Optional reducer that computes new chain state from this link's result.
   * Use to extract artifact paths, IDs, etc. for downstream links.
   */
  contributeState?: ChainStateContributor;
  /**
   * Plain-language description of what this link does — shown in the
   * chain panel and council prompt for situational awareness.
   */
  description: string;
}

/**
 * A complete multi-pack workflow chain.
 */
export interface WorkflowChain {
  id:          string;
  name:        string;
  tagline:     string;
  description: string;
  /** Required ordered list of links. Must contain at least 2 packs. */
  links:       WorkflowChainLink[];
  /** Estimated total duration across all links, in seconds. */
  estimatedDurationSec?: number;
  /** Tags for discovery / filtering. */
  tags?: string[];
}

/**
 * Runtime state for an executing chain. Persisted by the chain service.
 */
export type WorkflowChainRunStatus =
  | 'running'
  | 'waiting_link_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowChainLinkResult {
  /** Index of the link in the chain.links array. */
  linkIndex:        number;
  /** Pack ID that ran. */
  packId:           string;
  /** WorkflowRun ID created for this link. */
  workflowRunId?:   string;
  /** Final status of the link's underlying pack run. */
  status:           'completed' | 'failed' | 'awaiting_approval' | 'skipped';
  /** When the link started. */
  startedAt:        number;
  /** When the link ended (or undefined if still running). */
  endedAt?:         number;
  /** Error message if the link failed. */
  error?:           string;
}

export interface WorkflowChainRun {
  id:               string;
  chainId:          string;
  chainName:        string;
  startedAt:        number;
  endedAt?:         number;
  status:           WorkflowChainRunStatus;
  /** Index of the link that is currently running, waiting, or last completed. */
  currentLinkIndex: number;
  /** Per-link execution results. */
  linkResults:      WorkflowChainLinkResult[];
  /** The shared state object accumulated across links. */
  state:            ChainState;
  /** Error message at the chain level (e.g. if a link failed). */
  error?:           string;
}

// ── Built-in chains ──────────────────────────────────────────────────────────
//
// Below are the seed chains shipped with TriForge. Each is a real, runnable
// composition of existing packs. New chains can be added by extending this
// registry — no chain runner code changes required.

/**
 * "Logo to Launch" — the flagship demo chain.
 *
 * Step 1: Run a Photoshop ExtendScript that exports the active doc as a PNG.
 * Step 2: Drop that PNG into a Premiere Pro intro template and export an MP4.
 * Step 3: Upload the MP4 to YouTube as an unlisted draft.
 *
 * Each step's pack already exists. The chain provides the bindings between
 * them so the user can fire it as one mission instead of three.
 */
export const LOGO_TO_LAUNCH_CHAIN: WorkflowChain = {
  id:      'chain.logo-to-launch',
  name:    'Logo to Launch',
  tagline: 'Photoshop logo → Premiere intro video → YouTube upload, in one mission.',
  description:
    'Exports your current Photoshop logo as a PNG, drops it into a Premiere Pro intro template, '
    + 'renders the result, and uploads it to YouTube as an unlisted draft. '
    + 'Each step is approval-gated so you can review before TriForge moves to the next app.',
  estimatedDurationSec: 240,
  tags: ['creative', 'video', 'social', 'demo', 'logo', 'youtube'],
  links: [
    {
      packId: 'pack.adobe-photoshop',
      label:  'Export logo from Photoshop',
      description:
        'Runs an ExtendScript that exports the active Photoshop document as a PNG '
        + 'into the user\'s Desktop, then records the file path in chain state as logoPath.',
      optionsTemplate: {
        targetApp: 'Adobe Photoshop',
        goal:      'Export the active document as PNG to ~/Desktop/triforge-logo.png',
      },
      // Reducer reads the report artifact and pulls out the exported file path
      contributeState: (artifact, state) => {
        const a = artifact as { outputs?: { exportedPath?: string }; meta?: Record<string, unknown> } | undefined;
        const exported = a?.outputs?.exportedPath
          ?? (a?.meta?.exportedPath as string | undefined);
        return {
          ...state,
          logoPath: exported ?? '~/Desktop/triforge-logo.png',
        };
      },
    },
    {
      packId: 'pack.adobe-premiere',
      label:  'Drop logo into Premiere intro',
      description:
        'Runs an ExtendScript that imports {{logoPath}} into the active Premiere project, '
        + 'places it on the intro track, and exports an MP4 to ~/Desktop/triforge-intro.mp4.',
      optionsTemplate: {
        targetApp: 'Adobe Premiere Pro',
        goal:      'Import {{logoPath}} into the active Premiere project, drop it on V2, and export as ~/Desktop/triforge-intro.mp4',
      },
      contributeState: (artifact, state) => {
        const a = artifact as { outputs?: { exportedPath?: string }; meta?: Record<string, unknown> } | undefined;
        const exported = a?.outputs?.exportedPath
          ?? (a?.meta?.exportedPath as string | undefined);
        return {
          ...state,
          videoPath: exported ?? '~/Desktop/triforge-intro.mp4',
        };
      },
    },
    {
      packId: 'pack.publish-youtube',
      label:  'Upload to YouTube as unlisted',
      description:
        'Uploads {{videoPath}} to YouTube as an unlisted draft so the user can review before publishing publicly.',
      optionsTemplate: {
        socialPlatform: 'youtube',
        filePath:       '{{videoPath}}',
        isVideo:        true,
        videoTitle:     'TriForge Intro',
        videoDescription: 'Generated by TriForge from a Photoshop logo.',
        youtubePrivacy: 'unlisted',
      },
    },
  ],
};

/**
 * "Photo Batch & Backup" — a simpler 2-link chain.
 *
 * Step 1: Photoshop ExtendScript exports all open documents as PNGs.
 * Step 2: A focus-capture pack records the export folder for the user's records.
 */
export const PHOTO_BATCH_BACKUP_CHAIN: WorkflowChain = {
  id:      'chain.photo-batch-backup',
  name:    'Photo Batch + Backup',
  tagline: 'Batch-export Photoshop layers, then capture the result for your records.',
  description:
    'Runs an ExtendScript that exports every open Photoshop document, then takes a focus-capture '
    + 'screenshot of the destination folder for your audit trail. A safe two-step demo that proves '
    + 'chaining works without leaving the desktop.',
  estimatedDurationSec: 90,
  tags: ['creative', 'photoshop', 'batch', 'safe-demo'],
  links: [
    {
      packId: 'pack.adobe-photoshop',
      label:  'Batch-export open Photoshop documents',
      description:
        'Runs an ExtendScript that walks every open document and exports each as a PNG '
        + 'into ~/Desktop/triforge-batch/. Records the folder path as batchFolder.',
      optionsTemplate: {
        targetApp: 'Adobe Photoshop',
        goal:      'Export every open document to ~/Desktop/triforge-batch/ as PNG',
      },
      contributeState: (_artifact, state) => ({
        ...state,
        batchFolder: '~/Desktop/triforge-batch',
      }),
    },
    {
      packId: 'pack.focus-capture',
      label:  'Capture confirmation screenshot',
      description:
        'Focuses Finder on {{batchFolder}} and captures a screenshot for the user\'s records.',
      optionsTemplate: {
        targetApp: 'Finder',
      },
    },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const WORKFLOW_CHAIN_REGISTRY: ReadonlyArray<WorkflowChain> = [
  LOGO_TO_LAUNCH_CHAIN,
  PHOTO_BATCH_BACKUP_CHAIN,
];

export function listWorkflowChains(): WorkflowChain[] {
  return [...WORKFLOW_CHAIN_REGISTRY];
}

export function getWorkflowChain(id: string): WorkflowChain | undefined {
  return WORKFLOW_CHAIN_REGISTRY.find(c => c.id === id);
}

// ── Substitution helpers ──────────────────────────────────────────────────────

/**
 * Recursively walks a value tree and substitutes {{key}} markers in strings
 * with values from chain state. Non-string leaves pass through.
 */
export function substituteChainState<T>(value: T, state: ChainState): T {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const v = state[key];
      return v == null ? '' : String(v);
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => substituteChainState(v, state)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteChainState(v, state);
    }
    return out as T;
  }
  return value;
}
