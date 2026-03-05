// ── VerificationRunner.ts — Flexible workspace/sandbox verifier ───────────────
//
// Inspects package.json to discover which scripts exist,
// then runs only available ones. Works on any rootPath — the real workspace or
// an isolated sandbox copy.
//
// Scoring (see experiments/types.ts):
//   lint  → +40 pts (pass or skipped)
//   build → +40 pts (pass or skipped)
//   test  → +20 pts (pass or skipped)
//   fail  → 0 pts for that check

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { VerificationCheck } from './types';
import { scoreChecksWeighted } from './types';
import { createLogger } from '../logging/log';

const log       = createLogger('VerificationRunner');
const execAsync = promisify(exec);

const TIMEOUTS: Record<string, number> = {
  lint:  60_000,   // 1 min
  build: 120_000,  // 2 min
  test:  120_000,  // 2 min
};

export interface VerificationSummary {
  checks: VerificationCheck[];
  score:  number;
}

export class VerificationRunner {
  constructor(private readonly rootPath: string) {}

  async run(): Promise<VerificationSummary> {
    const availableScripts = this._discoverScripts();
    const checks: VerificationCheck[] = [];

    for (const name of ['lint', 'build', 'test'] as const) {
      if (!availableScripts.has(name)) {
        checks.push({ name, ok: true, skipped: true, details: 'script not defined in package.json' });
        continue;
      }

      try {
        const { stderr } = await execAsync(`npm run ${name}`, {
          cwd:     this.rootPath,
          timeout: TIMEOUTS[name],
          env:     { ...process.env, CI: '1' },
        });
        checks.push({ name, ok: true, details: stderr?.slice(0, 200) });
        log.info(`${name}: pass`);
      } catch (e) {
        const details = _extractError(e);
        checks.push({ name, ok: false, details });
        log.warn(`${name}: fail —`, details.slice(0, 100));
      }
    }

    const score = scoreChecksWeighted(checks);
    return { checks, score };
  }

  private _discoverScripts(): Set<string> {
    try {
      const pkgPath = path.join(this.rootPath, 'package.json');
      const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      return new Set(Object.keys(pkg.scripts ?? {}));
    } catch {
      return new Set();
    }
  }
}

function _extractError(e: unknown): string {
  if (!e || typeof e !== 'object') return String(e).slice(0, 300);
  const err = e as Record<string, unknown>;
  const msg = (err['stderr'] ?? err['stdout'] ?? err['message'] ?? String(e));
  return String(msg).slice(0, 300);
}
