/**
 * Tool Registry — capability-based access control for everything TriForge can do.
 *
 * Every action type is registered here with its risk level and default enabled state.
 * Before executing any tool, call canRun() to check against the active PolicyConfig.
 * requiresApproval() tells the runner whether to prompt the user first.
 */

import { PolicyConfig } from '../protocol';

export type ToolId =
  | 'git.read'
  | 'git.stage'
  | 'git.push'
  | 'fs.read'
  | 'fs.write'
  | 'terminal.preview'
  | 'terminal.execute'
  | 'search.text'
  | 'search.files'
  | 'analysis.lint'
  | 'analysis.typecheck'
  | 'analysis.test'
  | 'web.fetch'
  | 'web.automate';

interface ToolDefinition {
  id: ToolId;
  label: string;
  riskLevel: 'low' | 'medium' | 'high';
  /** Human approval always required regardless of autoApprove policy */
  alwaysReviewRequired: boolean;
  enabledByDefault: boolean;
}

const TOOLS: ToolDefinition[] = [
  { id: 'git.read',           label: 'Read git status/diff',    riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'git.stage',          label: 'Stage files',              riskLevel: 'medium', alwaysReviewRequired: true,  enabledByDefault: true  },
  { id: 'git.push',           label: 'Push to remote',           riskLevel: 'high',   alwaysReviewRequired: true,  enabledByDefault: false },
  { id: 'fs.read',            label: 'Read files',               riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'fs.write',           label: 'Write files (via patch)',  riskLevel: 'medium', alwaysReviewRequired: true,  enabledByDefault: true  },
  { id: 'terminal.preview',   label: 'Preview command',          riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'terminal.execute',   label: 'Execute command',          riskLevel: 'medium', alwaysReviewRequired: true,  enabledByDefault: true  },
  { id: 'search.text',        label: 'Search workspace text',    riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'search.files',       label: 'List workspace files',     riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'analysis.lint',      label: 'Run linter',               riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'analysis.typecheck', label: 'Run type check',           riskLevel: 'low',    alwaysReviewRequired: false, enabledByDefault: true  },
  { id: 'analysis.test',      label: 'Run tests',                riskLevel: 'medium', alwaysReviewRequired: true,  enabledByDefault: true  },
  { id: 'web.fetch',          label: 'Fetch web content',        riskLevel: 'medium', alwaysReviewRequired: false, enabledByDefault: false },
  { id: 'web.automate',       label: 'Browser automation',       riskLevel: 'high',   alwaysReviewRequired: true,  enabledByDefault: false },
];

const TOOL_MAP = new Map<ToolId, ToolDefinition>(TOOLS.map(t => [t.id, t]));

function riskRank(level: 'low' | 'medium' | 'high'): number {
  return { low: 0, medium: 1, high: 2 }[level];
}

export class ToolRegistry {
  constructor(private _policy: PolicyConfig) {}

  updatePolicy(policy: PolicyConfig): void {
    this._policy = policy;
  }

  /** True if the tool is permitted under the current policy. */
  canRun(toolId: ToolId): boolean {
    const tool = TOOL_MAP.get(toolId);
    if (!tool || !tool.enabledByDefault) { return false; }

    if ((toolId === 'web.fetch' || toolId === 'web.automate') &&
        !this._policy.allowNetworkAutomation) { return false; }

    if (toolId === 'git.push' && !this._policy.allowDirectPush) { return false; }

    return riskRank(tool.riskLevel) <= riskRank(this._policy.riskTolerance);
  }

  /** True if the user must explicitly approve before execution. */
  requiresApproval(toolId: ToolId): boolean {
    const tool = TOOL_MAP.get(toolId);
    if (!tool) { return true; }
    if (tool.alwaysReviewRequired) { return true; }
    if (this._policy.autoApprove && tool.riskLevel === 'low') { return false; }
    return true;
  }

  getAllowedTools(): ToolId[] {
    return TOOLS.filter(t => this.canRun(t.id)).map(t => t.id);
  }

  describe(toolId: ToolId): ToolDefinition | undefined {
    return TOOL_MAP.get(toolId);
  }
}

export const DEFAULT_POLICY: PolicyConfig = {
  riskTolerance: 'medium',
  autoApprove: false,
  maxCommandsPerSession: 20,
  allowedCommandPrefixes: ['npm', 'npx', 'tsc', 'git', 'node', 'python', 'pip', 'cargo', 'go', 'make'],
  allowNetworkAutomation: false,
  allowDirectPush: false,
};
