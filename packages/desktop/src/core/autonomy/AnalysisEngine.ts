// ── AnalysisEngine.ts — Workspace analysis orchestrator ──────────────────────
import fs from 'fs';
import path from 'path';
import { detectIssues, type ProposedMission } from './ProblemDetector';

export interface WorkspaceContext {
  rootPath: string;
  fileCount: number;
  tsFiles: string[];
  issues: ProposedMission[];
  scannedAt: number;
}

export async function analyzeWorkspace(root: string): Promise<WorkspaceContext> {
  const tsFiles = collectTsFiles(root);
  const issues  = detectIssues(tsFiles);
  return { rootPath: root, fileCount: tsFiles.length, tsFiles, issues, scannedAt: Date.now() };
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', '.claude', 'engine']);

  function walk(d: string, depth = 0): void {
    if (depth > 8) return; // safety cap
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory())  walk(full, depth + 1);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) results.push(full);
    }
  }

  walk(dir);
  return results;
}
