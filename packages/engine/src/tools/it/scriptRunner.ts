// it/scriptRunner.ts — Runs allowlisted safe-fix scripts ONLY
// Always requires requiresApproval: true in workflow action before execution
// Built-in scripts: dns_flush, winsock_reset, clear_temp, restart_spooler, disk_cleanup

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itScriptRunnerDef: ToolDefinition = {
  name: 'it_script_runner',
  description: 'Runs a pre-approved safe-fix script from the allowlist. Never executes arbitrary code. Use action=list to see available scripts. Requires approval before run.',
  category: 'general',
  riskLevel: 'high',
  estimatedCostCents: 0,
  inputSchema: {
    action:   { type: 'string', description: '"list" | "run"' },
    scriptId: { type: 'string', description: 'Script ID from the allowlist (required for run)' },
  },
};

interface ScriptDef {
  id: string; name: string; description: string;
  platform: 'win32' | 'darwin' | 'linux' | 'all';
  command: string; riskNote: string;
}

const BUILT_IN_SCRIPTS: ScriptDef[] = [
  { id: 'dns_flush',        name: 'Flush DNS Cache',         description: 'Clears local DNS resolver cache.',             platform: 'win32',  command: 'ipconfig /flushdns',                          riskNote: 'No data loss.' },
  { id: 'dns_flush',        name: 'Flush DNS Cache',         description: 'Clears local DNS resolver cache (macOS).',     platform: 'darwin', command: 'sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder', riskNote: 'No data loss.' },
  { id: 'dns_flush',        name: 'Flush DNS Cache',         description: 'Clears local DNS resolver cache (Linux).',     platform: 'linux',  command: 'sudo systemd-resolve --flush-caches',         riskNote: 'No data loss.' },
  { id: 'winsock_reset',    name: 'Reset Winsock',           description: 'Resets TCP/IP stack. Requires reboot.',        platform: 'win32',  command: 'netsh winsock reset && netsh int ip reset',   riskNote: 'Requires reboot. No data loss.' },
  { id: 'clear_temp',       name: 'Clear Temp Files',        description: 'Deletes user temp files. Frees disk space.',   platform: 'win32',  command: 'del /q /s "%TEMP%\*" 2>nul & echo Done',     riskNote: 'Temp files only.' },
  { id: 'clear_temp',       name: 'Clear Temp Files',        description: 'Clears /tmp (Linux/macOS).',                   platform: 'linux',  command: 'rm -rf /tmp/* 2>/dev/null; echo Done',        riskNote: 'Temp files only.' },
  { id: 'restart_spooler',  name: 'Restart Print Spooler',   description: 'Restarts Windows Print Spooler. Fixes printers.', platform: 'win32', command: 'net stop spooler && net start spooler',     riskNote: 'Cancels queued print jobs.' },
  { id: 'disk_cleanup',     name: 'Disk Cleanup (analyze)',  description: 'Reports reclaimable space only. Does not delete.', platform: 'win32', command: 'echo Analyzing... && vssadmin list shadowstorage 2>nul', riskNote: 'Read-only.' },
];

function getAvailableScripts(): ScriptDef[] {
  const plat = process.platform as string;
  return BUILT_IN_SCRIPTS.filter(s => s.platform === plat || s.platform === 'all');
}

export interface ScriptRunnerResult {
  action: string; scriptId?: string;
  scripts?: Array<{ id: string; name: string; description: string; riskNote: string }>;
  output?: string; ok: boolean; error?: string; capturedAt: number;
}

export async function runItScriptRunner(args: Record<string, unknown>, ctx: ToolContext): Promise<ScriptRunnerResult> {
  const action   = String(args.action ?? 'list').toLowerCase();
  const scriptId = String(args.scriptId ?? '');

  if (action === 'list') {
    const scripts = getAvailableScripts().map(s => ({ id: s.id, name: s.name, description: s.description, riskNote: s.riskNote }));
    return { action, scripts, ok: true, capturedAt: Date.now() };
  }

  const script = getAvailableScripts().find(s => s.id === scriptId);
  if (!script) {
    return { action, scriptId, ok: false, error: `Script "${scriptId}" not in allowlist. Available: ${getAvailableScripts().map(s => s.id).join(', ')}`, capturedAt: Date.now() };
  }

  try {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const output = execSync(script.command, { timeout: 30_000, shell }).toString().trim();

    const execResult: ExecutionResult = {
      id: crypto.randomUUID(), taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_script_runner',
      timestamp: Date.now(), success: true, paperMode: false, data: { scriptId, output },
    };
    serviceLocator.logResult(execResult);
    eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_script_runner', success: true });
    return { action, scriptId, output: output.slice(0, 2000), ok: true, capturedAt: Date.now() };
  } catch (e) {
    const execResult: ExecutionResult = {
      id: crypto.randomUUID(), taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_script_runner',
      timestamp: Date.now(), success: false, paperMode: false, data: { scriptId, error: (e as Error).message },
    };
    serviceLocator.logResult(execResult);
    eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_script_runner', success: false });
    return { action, scriptId, ok: false, error: (e as Error).message, capturedAt: Date.now() };
  }
}

/** Load user-added scripts from dataDir (optional extension point) */
export function loadCustomScripts(dataDir: string): ScriptDef[] {
  try {
    const p = path.join(dataDir, 'triforge-safe-scripts.json');
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ScriptDef[];
  } catch { return []; }
}
