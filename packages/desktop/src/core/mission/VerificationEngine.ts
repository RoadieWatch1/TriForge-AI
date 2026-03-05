// ── VerificationEngine.ts — Post-patch lint + build verification ──────────────
//
// Runs `npm run lint` and `npm run build` in a given workspace directory.
// Used by MissionController after patch application and by ExperimentEngine
// to score candidate patches.
//
// Scoring: 50 points per passing check (lint + build) = 0–100.
//
// Note: This runs child processes with cwd set to the workspace root.
// Both commands are given generous timeouts to handle large projects.

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const LINT_TIMEOUT_MS  =  60_000;   // 1 minute
const BUILD_TIMEOUT_MS = 120_000;   // 2 minutes

export interface VerificationResult {
  lint:   boolean;
  build:  boolean;
  /** 0–100: 50 pts per passing check */
  score:  number;
  errors: string[];
}

export class VerificationEngine {
  constructor(private readonly workspaceRoot: string) {}

  async verify(): Promise<VerificationResult> {
    const errors: string[] = [];
    let lint  = false;
    let build = false;

    try {
      await execAsync('npm run lint', { cwd: this.workspaceRoot, timeout: LINT_TIMEOUT_MS });
      lint = true;
    } catch (e) {
      errors.push(`lint: ${_errorMessage(e)}`);
    }

    try {
      await execAsync('npm run build', { cwd: this.workspaceRoot, timeout: BUILD_TIMEOUT_MS });
      build = true;
    } catch (e) {
      errors.push(`build: ${_errorMessage(e)}`);
    }

    return {
      lint,
      build,
      score:  (lint ? 50 : 0) + (build ? 50 : 0),
      errors,
    };
  }
}

function _errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'stderr' in e) return String((e as { stderr: unknown }).stderr).slice(0, 300);
  return String(e).slice(0, 300);
}
