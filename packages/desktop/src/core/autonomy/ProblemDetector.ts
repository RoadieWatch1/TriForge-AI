// ── ProblemDetector.ts — Static analysis to detect improvement opportunities ──
import fs from 'fs';
import crypto from 'crypto';

export interface ProposedMission {
  id: string;
  intent: 'fix' | 'refactor' | 'audit';
  title: string;
  reason: string;
  /** File paths or specific finding descriptions */
  evidence: string[];
  /** true if severity warrants immediate attention */
  recommended: boolean;
  createdAt: number;
}

const LARGE_FILE_THRESHOLD  = 1500;   // lines — soft threshold
const HUGE_FILE_THRESHOLD   = 3000;   // lines — recommended immediately
const TODO_CLUSTER_SIZE     = 3;      // consecutive TODO/FIXME/HACK lines to trigger

export function detectIssues(files: string[]): ProposedMission[] {
  const proposals: ProposedMission[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines   = content.split('\n');

      // ── Large file ────────────────────────────────────────────────────────
      if (lines.length > LARGE_FILE_THRESHOLD) {
        proposals.push({
          id:          crypto.randomUUID(),
          intent:      'refactor',
          title:       `Split large file (${lines.length} lines)`,
          reason:      `Files over ${LARGE_FILE_THRESHOLD} lines are harder to maintain and review.`,
          evidence:    [file],
          recommended: lines.length > HUGE_FILE_THRESHOLD,
          createdAt:   Date.now(),
        });
      }

      // ── TODO cluster — 3+ consecutive TODO/FIXME/HACK lines ──────────────
      let clusterStart = -1;
      let clusterLen   = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/TODO|FIXME|HACK/i.test(lines[i])) {
          if (clusterLen === 0) clusterStart = i;
          clusterLen++;
        } else {
          if (clusterLen >= TODO_CLUSTER_SIZE) {
            proposals.push({
              id:          crypto.randomUUID(),
              intent:      'fix',
              title:       `Resolve TODO cluster (${clusterLen} consecutive markers)`,
              reason:      `${clusterLen} consecutive deferred-work markers at line ${clusterStart + 1} may indicate a known problem area.`,
              evidence:    [file, ...lines.slice(clusterStart, clusterStart + 3).map(l => l.trim())].slice(0, 3),
              recommended: false,
              createdAt:   Date.now(),
            });
          }
          clusterLen = 0;
        }
      }
      // flush trailing cluster
      if (clusterLen >= TODO_CLUSTER_SIZE) {
        proposals.push({
          id:          crypto.randomUUID(),
          intent:      'fix',
          title:       `Resolve TODO cluster (${clusterLen} consecutive markers)`,
          reason:      `${clusterLen} consecutive deferred-work markers at line ${clusterStart + 1} may indicate a known problem area.`,
          evidence:    [file, ...lines.slice(clusterStart, clusterStart + 3).map(l => l.trim())].slice(0, 3),
          recommended: false,
          createdAt:   Date.now(),
        });
      }

      // ── Duplicate function / const declarations ───────────────────────────
      const funcNames: string[] = [];
      for (const line of lines) {
        const m = line.match(/(?:^|\s)(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()/);
        if (m) funcNames.push(m[1] ?? m[2] ?? '');
      }
      const counts: Record<string, number> = {};
      for (const n of funcNames) if (n) counts[n] = (counts[n] ?? 0) + 1;
      const dups = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);
      if (dups.length > 0) {
        proposals.push({
          id:          crypto.randomUUID(),
          intent:      'refactor',
          title:       `Duplicate declarations: ${dups.slice(0, 3).join(', ')}`,
          reason:      `${dups.length} identifier(s) declared more than once — may cause shadowing bugs.`,
          evidence:    [file, ...dups.slice(0, 2)].slice(0, 3),
          recommended: dups.length > 2,
          createdAt:   Date.now(),
        });
      }

      // ── Unused named imports (best-effort regex) ──────────────────────────
      const importLines = lines.filter(l => /^import\s*\{/.test(l));
      const unusedImports: string[] = [];
      for (const importLine of importLines) {
        const namesMatch = importLine.match(/\{([^}]+)\}/);
        if (!namesMatch) continue;
        const names = namesMatch[1].split(',').map(n => n.trim().replace(/\s+as\s+\w+/, '').trim()).filter(Boolean);
        for (const name of names) {
          // Check if name appears outside the import line
          const usages = lines.filter(l => l !== importLine && new RegExp(`\\b${name}\\b`).test(l));
          if (usages.length === 0) unusedImports.push(name);
        }
      }
      if (unusedImports.length > 0) {
        proposals.push({
          id:          crypto.randomUUID(),
          intent:      'audit',
          title:       `Potentially unused imports: ${unusedImports.slice(0, 3).join(', ')}`,
          reason:      `${unusedImports.length} imported name(s) not found elsewhere in file — may be dead code.`,
          evidence:    [file, ...unusedImports.slice(0, 2)].slice(0, 3),
          recommended: false,
          createdAt:   Date.now(),
        });
      }

      // ── Dead code after return statement ─────────────────────────────────
      const deadCodeLines: number[] = [];
      let inBlock = 0;
      let sawReturn = false;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (/[{(]/.test(l)) inBlock += (l.match(/[{(]/g)?.length ?? 0);
        if (/[})]/.test(l)) inBlock -= (l.match(/[})]/g)?.length ?? 0);
        if (sawReturn && l && !l.startsWith('//') && !l.startsWith('*') && l !== '}' && l !== ')') {
          deadCodeLines.push(i + 1);
          sawReturn = false;
        }
        if (/^\s*return\b/.test(lines[i]) && inBlock <= 1) sawReturn = true;
        else if (l === '{' || l === '}' || l === '') sawReturn = false;
      }
      if (deadCodeLines.length > 0) {
        proposals.push({
          id:          crypto.randomUUID(),
          intent:      'audit',
          title:       `Possible dead code after return (${deadCodeLines.length} instance(s))`,
          reason:      `Code found after return statement at line(s) ${deadCodeLines.slice(0, 3).join(', ')} — may be unreachable.`,
          evidence:    [file, ...deadCodeLines.slice(0, 2).map(n => `line ${n}`)].slice(0, 3),
          recommended: false,
          createdAt:   Date.now(),
        });
      }

    } catch { /* skip unreadable / binary files */ }
  }

  return proposals;
}
