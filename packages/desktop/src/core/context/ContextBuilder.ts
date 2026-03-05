// ── ContextBuilder.ts — Compressed workspace context for AI council ────────────
//
// Pipeline:
//   workspace scan → filter relevant files → extract structure → generate summary
//   → return compressed context string (~10x smaller than raw file dumps)
//
// Output fed into ThinkTankPlanner.makePlan() as the context argument,
// replacing large raw code pastes with concise structural summaries.

import fs   from 'fs';
import path from 'path';
import { createLogger } from '../logging/log';

const log = createLogger('ContextBuilder');

const IGNORED_DIRS  = new Set(['node_modules', '.git', 'dist', 'out', '.triforge-experiments', '.triforge-memory', 'coverage']);
const MAX_FILES     = 30;    // max files to include in context
const MAX_FILE_LINES = 300;  // only scan first N lines for structure extraction
const MAX_CONTEXT_CHARS = 8_000; // hard cap on total output length

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileContext {
  relativePath: string;
  purpose:      string;
  exports:      string[];  // top-level exported names
  issues:       string[];  // TODO/FIXME/HACK markers found
  lineCount:    number;
}

export interface WorkspaceContext {
  rootPath:    string;
  fileCount:   number;
  files:       FileContext[];
  buildAt:     number;
}

// ── ContextBuilder ────────────────────────────────────────────────────────────

export class ContextBuilder {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Build a compressed context string for a given goal.
   * Scans the workspace, ranks files by relevance to the goal,
   * and returns a compact summary.
   */
  async buildForGoal(goal: string): Promise<string> {
    const ctx = this._scan();
    const relevant = this._rankByRelevance(ctx.files, goal).slice(0, MAX_FILES);
    return this._format(goal, relevant, ctx.fileCount);
  }

  /** Full structured scan result (used by MissionController for richer context). */
  scan(): WorkspaceContext {
    return this._scan();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _scan(): WorkspaceContext {
    const tsFiles = this._collectFiles(this.workspaceRoot);
    const files   = tsFiles.map(f => this._extractFileContext(f)).filter(Boolean) as FileContext[];
    log.info(`scanned ${files.length} files`);
    return { rootPath: this.workspaceRoot, fileCount: files.length, files, buildAt: Date.now() };
  }

  private _collectFiles(root: string): string[] {
    const results: string[] = [];
    const walk = (dir: string, depth = 0): void => {
      if (depth > 8) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (/\.(ts|tsx)$/.test(entry.name)) results.push(full);
      }
    };
    walk(root);
    return results;
  }

  private _extractFileContext(filePath: string): FileContext | null {
    try {
      const content  = fs.readFileSync(filePath, 'utf8');
      const lines    = content.split('\n').slice(0, MAX_FILE_LINES);
      const rel      = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

      // Purpose: first JSDoc/comment block after imports
      const purposeMatch = content.match(/\/\/\s*──\s*(.+?)\s*──|\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/);
      const purpose = purposeMatch?.[1] ?? purposeMatch?.[2] ?? '';

      // Exports: top-level export names
      const exports: string[] = [];
      for (const line of lines) {
        const m = line.match(/^export\s+(?:(?:async\s+)?(?:class|function|const|interface|type|enum)\s+(\w+)|default\s+(\w+))/);
        if (m) exports.push(m[1] ?? m[2] ?? '');
      }

      // Issues: TODO/FIXME/HACK markers
      const issues: string[] = [];
      for (const line of lines) {
        if (/TODO|FIXME|HACK/i.test(line)) {
          const trimmed = line.trim().slice(0, 80);
          if (!issues.includes(trimmed)) issues.push(trimmed);
          if (issues.length >= 3) break;
        }
      }

      return { relativePath: rel, purpose, exports, issues, lineCount: content.split('\n').length };
    } catch {
      return null;
    }
  }

  private _rankByRelevance(files: FileContext[], goal: string): FileContext[] {
    const keywords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return [...files].sort((a, b) => {
      const scoreA = this._relevanceScore(a, keywords);
      const scoreB = this._relevanceScore(b, keywords);
      return scoreB - scoreA;
    });
  }

  private _relevanceScore(file: FileContext, keywords: string[]): number {
    const haystack = `${file.relativePath} ${file.purpose} ${file.exports.join(' ')}`.toLowerCase();
    return keywords.reduce((score, kw) => score + (haystack.includes(kw) ? 1 : 0), 0);
  }

  private _format(goal: string, files: FileContext[], totalCount: number): string {
    const lines: string[] = [
      `WORKSPACE CONTEXT (${files.length}/${totalCount} relevant files) for goal: ${goal}`,
      '',
    ];

    for (const f of files) {
      const exportsStr = f.exports.length > 0 ? `exports: ${f.exports.slice(0, 6).join(', ')}` : '';
      const issuesStr  = f.issues.length  > 0 ? `issues: ${f.issues.slice(0, 2).join(' | ')}` : '';
      lines.push(`${f.relativePath} (${f.lineCount} lines)${f.purpose ? ` — ${f.purpose}` : ''}`);
      if (exportsStr) lines.push(`  ${exportsStr}`);
      if (issuesStr)  lines.push(`  ${issuesStr}`);
    }

    const result = lines.join('\n');
    // Hard cap — never blow out the context window
    return result.length > MAX_CONTEXT_CHARS
      ? result.slice(0, MAX_CONTEXT_CHARS) + '\n[context truncated]'
      : result;
  }
}
