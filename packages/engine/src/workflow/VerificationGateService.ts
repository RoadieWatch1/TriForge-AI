/**
 * VerificationGateService — machine verification gate.
 *
 * Runs configured checks (lint, typecheck, test, build) via safe child_process.
 * Returns structured pass/fail per check.
 * Failed checks block commit and feed structured output back into CodeCouncilService.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { eventBus } from '../core/eventBus';
import type {
  VerificationCheckType,
  CheckConfig,
  VerificationCheck,
  VerificationResult,
  ExecutionMode,
  WorkflowModeConfig,
} from './councilWorkflowTypes';
import { MODE_CONFIGS } from './councilWorkflowTypes';

const execFileAsync = promisify(execFile);

// ── Default Check Commands ──────────────────────────────────────────────────

const DEFAULT_CHECK_COMMANDS: Record<VerificationCheckType, { command: string; args: string[] }> = {
  lint:      { command: 'npx', args: ['eslint', '.'] },
  typecheck: { command: 'npx', args: ['tsc', '--noEmit'] },
  test:      { command: 'npm', args: ['test'] },
  build:     { command: 'npm', args: ['run', 'build'] },
};

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

// ── Config ───────────────────────────────────────────────────────────────────

export interface VerificationConfig {
  sessionId: string;
  /** Override default commands per check type. */
  customCommands?: Partial<Record<VerificationCheckType, { command: string; args: string[] }>>;
  /** Override timeout per check. */
  timeoutMs?: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class VerificationGateService {

  /**
   * Get the default checks for a given execution mode.
   */
  getDefaultChecks(mode: ExecutionMode): CheckConfig[] {
    const modeConfig: WorkflowModeConfig = MODE_CONFIGS[mode];
    return modeConfig.verificationChecks.map(type => {
      const defaults = DEFAULT_CHECK_COMMANDS[type];
      return {
        type,
        command: defaults.command,
        args: [...defaults.args],
        timeoutMs: DEFAULT_TIMEOUT_MS,
      };
    });
  }

  /**
   * Run all checks against the workspace.
   */
  async runChecks(
    workspacePath: string,
    checks: VerificationCheckType[],
    config: VerificationConfig,
  ): Promise<VerificationResult> {
    const results: VerificationCheck[] = [];

    eventBus.emit({
      type: 'VERIFICATION_STARTED',
      sessionId: config.sessionId,
      checkCount: checks.length,
    });

    for (const checkType of checks) {
      const result = await this._runSingleCheck(workspacePath, checkType, config);
      results.push(result);

      if (result.passed) {
        eventBus.emit({
          type: 'CHECK_PASSED',
          sessionId: config.sessionId,
          checkType,
          duration: result.duration,
        });
      } else {
        eventBus.emit({
          type: 'CHECK_FAILED',
          sessionId: config.sessionId,
          checkType,
          output: result.output.substring(0, 2000),
        });
      }
    }

    const allPassed = results.every(r => r.passed);

    const verification: VerificationResult = {
      checks: results,
      allPassed,
      timestamp: Date.now(),
    };

    eventBus.emit({
      type: 'VERIFICATION_COMPLETE',
      sessionId: config.sessionId,
      allPassed,
    });

    return verification;
  }

  /**
   * Format verification failures into structured feedback for the code council.
   */
  formatFailuresForCouncil(result: VerificationResult): string {
    const failed = result.checks.filter(c => !c.passed);
    if (failed.length === 0) { return 'All checks passed.'; }

    const lines = ['Verification failures:', ''];
    for (const check of failed) {
      lines.push(`## ${check.type.toUpperCase()} — FAILED (${check.duration}ms)`);
      lines.push(check.output.substring(0, 1500));
      lines.push('');
    }
    return lines.join('\n');
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _runSingleCheck(
    workspacePath: string,
    checkType: VerificationCheckType,
    config: VerificationConfig,
  ): Promise<VerificationCheck> {
    const custom = config.customCommands?.[checkType];
    const defaults = DEFAULT_CHECK_COMMANDS[checkType];
    const cmd = custom?.command ?? defaults.command;
    const args = custom?.args ?? [...defaults.args];
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const start = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: workspacePath,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 5, // 5MB
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      });

      return {
        type: checkType,
        passed: true,
        output: (stdout + '\n' + stderr).trim(),
        duration: Date.now() - start,
      };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = [
        error.stdout || '',
        error.stderr || '',
        error.message || 'Unknown error',
      ].join('\n').trim();

      return {
        type: checkType,
        passed: false,
        output,
        duration: Date.now() - start,
      };
    }
  }
}
