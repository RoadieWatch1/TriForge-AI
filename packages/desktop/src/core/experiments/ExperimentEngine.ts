// ── ExperimentEngine.ts — Parallel council candidate sandbox runner ────────────
//
// Runs each PatchCandidate in an isolated temp workspace:
//   1. Copy real workspace → .triforge-experiments/<missionId>/<candidateId>/
//      (excludes node_modules, .git, dist, out, .triforge-experiments)
//   2. Apply candidate file patches (full content writes, relative paths)
//   3. Run VerificationRunner (lint/build/test from package.json)
//   4. Score using weighted policy (lint+40, build+40, test+20)
//   5. Cleanup sandbox in finally block
//
// Returns: full ExperimentResult[] + winner (highest score, first on tie).
// All operations are sequential (safest on Windows I/O).
//
// Cleanup policy: sandboxes are removed after each run. The base dir
// .triforge-experiments/<missionId>/ is removed on completion.
// If the base dir grows beyond MAX_EXPERIMENT_DIRS total entries, oldest are pruned.

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PatchCandidate, ExperimentResult } from './types';
import { VerificationRunner } from './VerificationRunner';
import { createLogger } from '../logging/log';

const log = createLogger('ExperimentEngine');

const COPY_IGNORE       = /(node_modules|\.git|dist|out|\.triforge-experiments)/;
const MAX_EXPERIMENT_DIRS = 10;  // max total missionId dirs in base

function _baseDir(): string {
  return path.join(os.tmpdir(), '.triforge-experiments');
}

export class ExperimentEngine {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Run all candidates sequentially in isolated sandboxes.
   * Returns all results + winner.
   */
  async runExperiments(
    missionId: string,
    candidates: PatchCandidate[],
  ): Promise<{ results: ExperimentResult[]; winner: ExperimentResult }> {
    if (candidates.length === 0) {
      const empty: ExperimentResult = {
        candidateId: 'none', approach: 'none', sandboxPath: '', score: 0,
        checks: [{ name: 'candidates', ok: false, details: 'no candidates provided' }],
      };
      return { results: [empty], winner: empty };
    }

    const missionBase = path.join(_baseDir(), missionId);
    fs.mkdirSync(missionBase, { recursive: true });
    log.info(`starting ${candidates.length} experiments for mission '${missionId}'`);

    const results: ExperimentResult[] = [];

    for (const candidate of candidates) {
      const sandboxPath = path.join(missionBase, candidate.id);
      log.info(`[${candidate.id}] approach: ${candidate.approach}`);

      try {
        // 1. Copy workspace (skip heavy dirs)
        fs.cpSync(this.workspaceRoot, sandboxPath, {
          recursive: true,
          filter: (src: string) => !COPY_IGNORE.test(src),
        });
        log.info(`[${candidate.id}] workspace copied to sandbox`);

        // 2. Apply file patches
        for (const patch of candidate.patches) {
          const dest = path.join(sandboxPath, patch.path);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, patch.content, 'utf8');
        }
        if (candidate.patches.length > 0) {
          log.info(`[${candidate.id}] applied ${candidate.patches.length} file patch(es)`);
        }

        // 3. Run verification
        const runner  = new VerificationRunner(sandboxPath);
        const summary = await runner.run();
        log.info(`[${candidate.id}] score: ${summary.score}`, summary.checks.map(c => `${c.name}:${c.ok ? 'ok' : c.skipped ? 'skip' : 'FAIL'}`).join(' '));

        results.push({
          candidateId: candidate.id,
          approach:    candidate.approach,
          sandboxPath,
          score:       summary.score,
          checks:      summary.checks,
        });

      } catch (e) {
        log.warn(`[${candidate.id}] experiment error:`, String(e).slice(0, 200));
        results.push({
          candidateId: candidate.id,
          approach:    candidate.approach,
          sandboxPath,
          score:       0,
          checks:      [{ name: 'run', ok: false, details: String(e).slice(0, 200) }],
        });
      } finally {
        // Clean up this candidate's sandbox immediately (keeps disk free)
        try { fs.rmSync(sandboxPath, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }

    // Clean up mission base dir
    try { fs.rmSync(missionBase, { recursive: true, force: true }); } catch { /* ignore */ }

    // Pick winner — highest score, first on tie
    const sorted = [...results].sort((a, b) => b.score - a.score);
    const winner = sorted[0]!;
    log.info(`winner: [${winner.candidateId}] "${winner.approach}" score=${winner.score}`);

    // Prune old experiment dirs (MAX_EXPERIMENT_DIRS)
    this._pruneOldDirs();

    return { results, winner };
  }

  private _pruneOldDirs(): void {
    const base = _baseDir();
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, mtime: fs.statSync(path.join(base, e.name)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime); // oldest first

      if (entries.length > MAX_EXPERIMENT_DIRS) {
        const toRemove = entries.slice(0, entries.length - MAX_EXPERIMENT_DIRS);
        for (const entry of toRemove) {
          fs.rmSync(path.join(base, entry.name), { recursive: true, force: true });
        }
      }
    } catch { /* ignore — base may not exist */ }
  }
}
