// ── toolGapAnalyzer.ts ─────────────────────────────────────────────────────
//
// Compares a user's detected tool stack against each income lane's
// requirements and produces a ranked list of ToolGap recommendations.
//
// Rules:
//   - Every install recommendation is approval-gated (approvalRequired: true).
//   - On Windows, installs that touch Program Files trigger UAC elevation.
//     The IPC handler is responsible for communicating this to the user.
//   - Gaps are classified as 'required' (lane won't work without it) or
//     'recommended' (lane works but performs better with it).

import type { CapabilityScanResult, IncomeLaneId } from './store';

// ── Gap definition ─────────────────────────────────────────────────────────

export type InstallMode = 'suggest' | 'guided' | 'full';
export type GapPriority = 'required' | 'recommended';

export interface ToolGap {
  toolName: string;
  laneId: IncomeLaneId;
  priority: GapPriority;
  reason: string;                // plain-language explanation for user
  rationale: string;             // "TriForge recommends this because..."
  installMode: InstallMode;
  wingetId?: string;             // winget package ID for 'full' installs
  installUrl?: string;           // download URL for 'guided' installs
  verifyPath?: string;           // path to check after install to confirm success
  approvalRequired: true;        // always true — never install silently
  requiresUac: boolean;          // true if install touches Program Files
}

// ── Lane requirement map ───────────────────────────────────────────────────
// Each lane lists which tool names are required and which are recommended.

interface LaneRequirement {
  laneId: IncomeLaneId;
  laneName: string;
  required: string[];     // tool names from APP_DEFS that must be present
  recommended: string[];  // tool names that improve the lane
}

const LANE_REQUIREMENTS: LaneRequirement[] = [
  {
    laneId: 'digital_products',
    laneName: 'Digital Products',
    required: [],  // can start with just browser + AI
    recommended: ['Adobe Photoshop', 'Adobe Illustrator', 'Canva', 'Figma'],
  },
  {
    laneId: 'client_services',
    laneName: 'Client Services (AI Automation)',
    required: [],
    recommended: ['VS Code', 'Figma'],
  },
  {
    laneId: 'affiliate_content',
    laneName: 'Affiliate Content',
    required: [],
    recommended: ['Canva', 'Adobe Premiere Pro', 'DaVinci Resolve', 'OBS Studio'],
  },
  {
    laneId: 'faceless_youtube',
    laneName: 'Faceless YouTube',
    required: ['Adobe Premiere Pro', 'DaVinci Resolve'],  // need at least one
    recommended: ['Adobe After Effects', 'OBS Studio', 'Canva'],
  },
  {
    laneId: 'short_form_brand',
    laneName: 'Short-Form Brand (TikTok / Reels / Shorts)',
    required: [],
    recommended: ['Adobe Premiere Pro', 'DaVinci Resolve', 'Canva', 'OBS Studio'],
  },
  {
    laneId: 'ai_music',
    laneName: 'AI Music Channel',
    required: [],
    recommended: ['FL Studio', 'Reaper', 'Audacity', 'Adobe Audition'],
  },
  {
    laneId: 'mini_games',
    laneName: 'Mini-Games & Game Funnels',
    required: ['Unreal Engine', 'Unity', 'Blender'],  // need at least one engine
    recommended: ['Blender', 'Adobe Photoshop'],
  },
  {
    laneId: 'asset_packs',
    laneName: 'Digital Asset Packs',
    required: [],
    recommended: ['Blender', 'Adobe Photoshop', 'Adobe Illustrator', 'Figma'],
  },
];

// ── Gap catalog ────────────────────────────────────────────────────────────
// Provides install metadata for tools we can recommend.

interface ToolInstallDef {
  toolName: string;
  wingetId?: string;
  installUrl?: string;
  verifyPath?: string;
  requiresUac: boolean;
  installMode: InstallMode;
}

const TOOL_INSTALL_CATALOG: ToolInstallDef[] = [
  {
    toolName: 'Blender',
    wingetId: 'BlenderFoundation.Blender',
    verifyPath: 'C:\\Program Files\\Blender Foundation',
    requiresUac: true,
    installMode: 'full',
  },
  {
    toolName: 'DaVinci Resolve',
    installUrl: 'https://www.blackmagicdesign.com/products/davinciresolve',
    requiresUac: true,
    installMode: 'guided',
  },
  {
    toolName: 'OBS Studio',
    wingetId: 'OBSProject.OBSStudio',
    verifyPath: 'C:\\Program Files\\obs-studio',
    requiresUac: true,
    installMode: 'full',
  },
  {
    toolName: 'Audacity',
    wingetId: 'Audacity.Audacity',
    verifyPath: 'C:\\Program Files\\Audacity',
    requiresUac: true,
    installMode: 'full',
  },
  {
    toolName: 'VS Code',
    wingetId: 'Microsoft.VisualStudioCode',
    requiresUac: false,
    installMode: 'full',
  },
  {
    toolName: 'Figma',
    wingetId: 'Figma.Figma',
    requiresUac: false,
    installMode: 'full',
  },
  {
    toolName: 'Canva',
    installUrl: 'https://www.canva.com/download',
    requiresUac: false,
    installMode: 'guided',
  },
  {
    toolName: 'Unity',
    installUrl: 'https://unity.com/download',
    requiresUac: true,
    installMode: 'guided',
  },
  {
    toolName: 'Unreal Engine',
    installUrl: 'https://www.unrealengine.com/download',
    requiresUac: true,
    installMode: 'guided',
  },
  {
    toolName: 'FL Studio',
    installUrl: 'https://www.image-line.com/fl-studio-download',
    requiresUac: true,
    installMode: 'guided',
  },
  {
    toolName: 'Reaper',
    installUrl: 'https://www.reaper.fm/download.php',
    requiresUac: true,
    installMode: 'guided',
  },
];

// ── Gap text builders ──────────────────────────────────────────────────────

function buildReason(toolName: string, laneId: IncomeLaneId, priority: GapPriority): string {
  const laneReq = LANE_REQUIREMENTS.find(l => l.laneId === laneId);
  const laneName = laneReq?.laneName ?? laneId;

  if (priority === 'required') {
    return `${toolName} is needed to run the ${laneName} lane. Without it this lane cannot start.`;
  }
  return `${toolName} would significantly improve ${laneName} output quality and speed.`;
}

function buildRationale(toolName: string, laneId: IncomeLaneId, installedApps: string[]): string {
  const hasRelated = installedApps.some(a =>
    a.toLowerCase().includes('adobe') || a.toLowerCase().includes('canva')
  );

  switch (laneId) {
    case 'faceless_youtube':
      return `TriForge recommends ${toolName} because video editing is required to produce publishable YouTube content. ${hasRelated ? 'You already have some Adobe tools — this fills the video editing gap.' : 'This is the most widely supported free video editor for the YouTube workflow.'}`;
    case 'mini_games':
      return `TriForge recommends ${toolName} because game export requires a supported engine. Without one, TriForge cannot build or package the game.`;
    case 'digital_products':
      return `TriForge recommends ${toolName} because ${toolName} produces the highest-quality export formats for selling digital design products on Gumroad and Etsy.`;
    case 'ai_music':
      return `TriForge recommends ${toolName} because audio export requires a DAW or audio editor. This is the lowest-cost option with the formats that streaming distributors accept.`;
    case 'asset_packs':
      return `TriForge recommends ${toolName} because 3D asset packs sell best on Blender-compatible formats. ${toolName} produces GLB/FBX directly.`;
    default:
      return `TriForge recommends ${toolName} because it unlocks higher-quality output for the ${laneId.replace(/_/g, ' ')} workflow and is available at no cost.`;
  }
}

// ── Main analyzer ──────────────────────────────────────────────────────────

export function analyzeGaps(
  scan: CapabilityScanResult,
  laneId: IncomeLaneId
): ToolGap[] {
  const laneReq = LANE_REQUIREMENTS.find(l => l.laneId === laneId);
  if (!laneReq) return [];

  const installedNames = scan.installedApps.map(a => a.name);
  const gaps: ToolGap[] = [];

  // Check required tools — at least one must be present if the list is non-empty
  // For lanes where any one of a set satisfies (e.g., "Premiere OR DaVinci"),
  // we only flag a gap if NONE of the required tools are present.
  const hasAnyRequired = laneReq.required.length === 0
    || laneReq.required.some(t => installedNames.includes(t));

  if (!hasAnyRequired) {
    // Recommend the first (best/free) required tool
    const firstRequired = laneReq.required[0];
    const installDef = TOOL_INSTALL_CATALOG.find(d => d.toolName === firstRequired);

    gaps.push({
      toolName: firstRequired,
      laneId,
      priority: 'required',
      reason: buildReason(firstRequired, laneId, 'required'),
      rationale: buildRationale(firstRequired, laneId, installedNames),
      installMode: installDef?.installMode ?? 'suggest',
      wingetId: installDef?.wingetId,
      installUrl: installDef?.installUrl,
      verifyPath: installDef?.verifyPath,
      approvalRequired: true,
      requiresUac: installDef?.requiresUac ?? true,
    });
  }

  // Check recommended tools — flag missing ones, limit to 3
  let recommendedCount = 0;
  for (const toolName of laneReq.recommended) {
    if (recommendedCount >= 3) break;
    if (installedNames.includes(toolName)) continue;

    const installDef = TOOL_INSTALL_CATALOG.find(d => d.toolName === toolName);

    gaps.push({
      toolName,
      laneId,
      priority: 'recommended',
      reason: buildReason(toolName, laneId, 'recommended'),
      rationale: buildRationale(toolName, laneId, installedNames),
      installMode: installDef?.installMode ?? 'suggest',
      wingetId: installDef?.wingetId,
      installUrl: installDef?.installUrl,
      verifyPath: installDef?.verifyPath,
      approvalRequired: true,
      requiresUac: installDef?.requiresUac ?? true,
    });

    recommendedCount++;
  }

  return gaps;
}

// ── Lane scorer ────────────────────────────────────────────────────────────
// Returns a 0–100 readiness score for a lane based on installed tools.

export function scoreLaneReadiness(
  scan: CapabilityScanResult,
  laneId: IncomeLaneId
): number {
  const laneReq = LANE_REQUIREMENTS.find(l => l.laneId === laneId);
  if (!laneReq) return 0;

  const installedNames = scan.installedApps.map(a => a.name);

  // Required tools gate (if missing any → cap at 30)
  const hasAnyRequired = laneReq.required.length === 0
    || laneReq.required.some(t => installedNames.includes(t));

  if (!hasAnyRequired) return 20;

  // Score recommended tool coverage
  const total = laneReq.recommended.length;
  if (total === 0) return 80; // no recommendations = already fully capable

  const present = laneReq.recommended.filter(t => installedNames.includes(t)).length;
  const coverage = present / total;

  return Math.round(40 + coverage * 60); // range: 40–100
}

// ── Top lane recommender ───────────────────────────────────────────────────
// Returns up to 3 lanes ranked by readiness, with their gaps pre-computed.

export interface RankedLane {
  laneId: IncomeLaneId;
  laneName: string;
  readinessScore: number;
  gaps: ToolGap[];
  timeToFirstDollar: string; // human-readable estimate
  rationale: string;
}

const LANE_TIME_TO_FIRST_DOLLAR: Record<IncomeLaneId, string> = {
  digital_products:  '2–4 weeks',
  client_services:   '1–3 weeks',
  affiliate_content: '4–8 weeks',
  faceless_youtube:  '3–6 months',
  short_form_brand:  '4–8 weeks',
  ai_music:          '6–12 weeks',
  mini_games:        '2–4 months',
  asset_packs:       '3–6 weeks',
};

export function rankLanes(scan: CapabilityScanResult): RankedLane[] {
  const installedNames = scan.installedApps.map(a => a.name);

  return LANE_REQUIREMENTS
    .map(laneReq => {
      const readinessScore = scoreLaneReadiness(scan, laneReq.laneId);
      const gaps = analyzeGaps(scan, laneReq.laneId);

      // Build rationale from scan context
      const toolsUsed = laneReq.recommended
        .filter(t => installedNames.includes(t))
        .slice(0, 2)
        .join(' and ');

      const rationale = toolsUsed
        ? `TriForge recommends this because you already have ${toolsUsed}, which covers most of this lane's workflow.`
        : `TriForge recommends this because it requires minimal tools to start and has the fastest path to a first sale.`;

      return {
        laneId: laneReq.laneId,
        laneName: laneReq.laneName,
        readinessScore,
        gaps,
        timeToFirstDollar: LANE_TIME_TO_FIRST_DOLLAR[laneReq.laneId],
        rationale,
      };
    })
    .sort((a, b) => b.readinessScore - a.readinessScore)
    .slice(0, 3);
}
