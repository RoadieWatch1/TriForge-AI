import { execSync } from 'child_process';
import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const runCommandDef: ToolDefinition = {
  name: 'run_command',
  description: 'Execute a shell command on the local system. High-risk: always requires human approval.',
  category: 'general',
  riskLevel: 'high',
  estimatedCostCents: 0,
  inputSchema: {
    command:   { type: 'string', description: 'Shell command to execute' },
    cwd:       { type: 'string', description: 'Working directory (optional, defaults to user home)' },
    timeoutMs: { type: 'number', description: 'Execution timeout in ms (default 30000, max 120000)' },
  },
};

export async function runRunCommand(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const { command, cwd, timeoutMs = 30_000 } = args as {
    command:    string;
    cwd?:       string;
    timeoutMs?: number;
  };

  if (!command?.trim()) throw new Error('run_command: "command" is required');

  const safeTimeout = Math.min(Number(timeoutMs) || 30_000, 120_000);

  let stdout = '';
  let stderr = '';

  try {
    const out = execSync(command, {
      cwd:      cwd || process.env.HOME || process.env.USERPROFILE,
      timeout:  safeTimeout,
      encoding: 'utf8',
      stdio:    ['pipe', 'pipe', 'pipe'],
    });
    stdout = out ?? '';
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? e.message ?? String(err);
  }

  return {
    command,
    stdout: stdout.slice(0, 20_000),
    stderr: stderr.slice(0, 5_000),
    exitCode: stderr ? 1 : 0,
  };
}
