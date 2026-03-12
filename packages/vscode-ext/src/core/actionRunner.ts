/**
 * ActionRunner — executes safe ActionSteps produced by ActionPlanner.
 *
 * Rules:
 *  • Steps marked requiresApproval=true are never auto-executed.
 *  • All file writes go through the existing patch system (create_patch type).
 *  • Terminal commands always go through the command preview/approve flow.
 *  • High-risk steps are blocked and returned with an informative message.
 */

import { ActionStep, PolicyConfig } from '@triforge/engine';
import { previewCommand } from './commands';
import { searchTextInWorkspace, openFileAt } from './search';

export interface ActionStepResult {
  stepId: string;
  success: boolean;
  output: string;
  artifacts?: Array<{
    type: 'file' | 'command_preview' | 'text';
    label: string;
    content: string;
  }>;
}

export class ActionRunner {
  constructor(
    private _workspacePath: string,
    private _policy: PolicyConfig,
    /** Called when a command preview is generated (so panel.ts can forward it to the webview). */
    private _onCommandPreview: (
      token: string,
      cmd: string,
      cwd: string,
      risk: 'low' | 'medium' | 'high'
    ) => void
  ) {}

  async run(step: ActionStep, signal?: AbortSignal): Promise<ActionStepResult> {
    if (step.requiresApproval) {
      return {
        stepId: step.id,
        success: false,
        output: `Step requires your approval before it can run: "${step.description}"`,
      };
    }

    try {
      switch (step.type) {
        case 'research':
          return await this._runResearch(step);
        case 'open_file':
          return await this._runOpenFile(step);
        case 'run_command':
          return this._runCommand(step);
        case 'remind':
          return {
            stepId: step.id,
            success: true,
            output: `Reminder captured: ${step.description}`,
            artifacts: [{ type: 'text', label: 'Reminder', content: step.description }],
          };
        case 'write':
        case 'code':
        case 'create_patch':
        case 'patch_preview':
        case 'draft':
          return {
            stepId: step.id,
            success: true,
            output: 'Queued for code/patch generation. Use the Chat tab to build the changes.',
          };
        case 'think':
          return {
            stepId: step.id,
            success: true,
            output: `Reasoning step logged: ${step.description}`,
            artifacts: [{ type: 'text', label: 'Reasoning', content: step.description }],
          };
        case 'reminder':
          return {
            stepId: step.id,
            success: true,
            output: `Reminder captured: ${step.description}`,
            artifacts: [{ type: 'text', label: 'Reminder', content: step.description }],
          };
        case 'apply_patch':
          return {
            stepId: step.id,
            success: true,
            output: 'Patch application queued. Approve the patch preview in the Chat tab to apply.',
          };
        case 'stage_changes':
        case 'commit':
        case 'pr_draft':
          return {
            stepId: step.id,
            success: false,
            output: `Step type "${step.type}" requires manual git action. Use the terminal or the Git panel in VS Code.`,
          };
        case 'health_scan':
          return {
            stepId: step.id,
            success: false,
            output: 'Health scan is not yet implemented. Coming in a future update.',
          };
        default:
          return { stepId: step.id, success: false, output: `Unknown step type: ${(step as any).type}` };
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { stepId: step.id, success: false, output: 'Step cancelled.' };
      }
      return { stepId: step.id, success: false, output: `Error: ${err?.message ?? String(err)}` };
    }
  }

  private async _runResearch(step: ActionStep): Promise<ActionStepResult> {
    const query = ((step.inputs?.['goal'] as string) || step.description).substring(0, 80);
    const results = await searchTextInWorkspace(this._workspacePath, query);
    if (results.length === 0) {
      return {
        stepId: step.id,
        success: true,
        output: 'No matching files found in workspace. May require external research.',
      };
    }
    const summary = results
      .slice(0, 5)
      .map(r => `${r.relativePath}: ${r.snippet.substring(0, 100)}`)
      .join('\n');
    return {
      stepId: step.id,
      success: true,
      output: `Found ${results.length} relevant file(s):\n${summary}`,
      artifacts: results.slice(0, 5).map(r => ({
        type: 'file' as const,
        label: r.relativePath,
        content: r.snippet,
      })),
    };
  }

  private async _runOpenFile(step: ActionStep): Promise<ActionStepResult> {
    const filePath = (step.inputs?.['path'] as string) || '';
    const line = (step.inputs?.['line'] as number) || 1;
    if (!filePath) {
      return { stepId: step.id, success: false, output: 'No file path specified.' };
    }
    const ok = await openFileAt(this._workspacePath, filePath, line);
    return {
      stepId: step.id,
      success: ok,
      output: ok ? `Opened ${filePath} at line ${line}` : `Could not open ${filePath}`,
    };
  }

  private _runCommand(step: ActionStep): ActionStepResult {
    const cmd = (step.inputs?.['command'] as string) || step.description;
    const allowed = this._policy.allowedCommandPrefixes.some(
      prefix => cmd.trim().toLowerCase().startsWith(prefix.toLowerCase())
    );
    if (!allowed) {
      return {
        stepId: step.id,
        success: false,
        output: `Blocked by policy: "${cmd}" is not in the allowed prefix list (${this._policy.allowedCommandPrefixes.join(', ')}).`,
      };
    }
    // Always preview — never auto-execute
    const preview = previewCommand(cmd, this._workspacePath, step.description, step.riskLevel);
    this._onCommandPreview(preview.token, preview.command, preview.cwd, preview.risk);
    return {
      stepId: step.id,
      success: true,
      output: `Command queued for your review: ${cmd}`,
      artifacts: [{ type: 'command_preview', label: 'Command Preview', content: cmd }],
    };
  }
}
