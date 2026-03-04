import fs from 'fs';
import path from 'path';
import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const searchWorkspaceDef: ToolDefinition = {
  name: 'search_workspace',
  description: 'Recursively search a directory for files matching a name pattern or containing a text query.',
  category: 'files',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    dir:        { type: 'string', description: 'Directory to search in' },
    pattern:    { type: 'string', description: 'File name pattern to match (e.g. "*.ts", "report*")' },
    query:      { type: 'string', description: 'Text content to search for inside files (optional)' },
    maxDepth:   { type: 'number', description: 'Max directory depth to recurse (default 5)' },
    maxResults: { type: 'number', description: 'Max number of results to return (default 50)' },
  },
};

interface SearchResult {
  path:    string;
  name:    string;
  size:    number;
  match?:  string; // snippet when query was provided
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function searchDir(
  dir: string,
  nameRe: RegExp | null,
  query: string | undefined,
  maxDepth: number,
  maxResults: number,
  results: SearchResult[],
  depth = 0,
): void {
  if (depth > maxDepth || results.length >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission denied or not a dir
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        searchDir(fullPath, nameRe, query, maxDepth, maxResults, results, depth + 1);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const nameMatches = !nameRe || nameRe.test(entry.name);
    if (!nameMatches) continue;

    let match: string | undefined;
    if (query) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const idx = content.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) continue;
        const start = Math.max(0, idx - 60);
        const end   = Math.min(content.length, idx + query.length + 60);
        match = '...' + content.slice(start, end).replace(/\n/g, ' ') + '...';
      } catch {
        continue; // binary or unreadable
      }
    }

    let size = 0;
    try { size = fs.statSync(fullPath).size; } catch { /* ignore */ }

    results.push({ path: fullPath, name: entry.name, size, match });
  }
}

export async function runSearchWorkspace(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const { dir, pattern, query, maxDepth = 5, maxResults = 50 } = args as {
    dir:         string;
    pattern?:    string;
    query?:      string;
    maxDepth?:   number;
    maxResults?: number;
  };

  if (!dir?.trim()) throw new Error('search_workspace: "dir" is required');
  if (!pattern && !query) throw new Error('search_workspace: at least one of "pattern" or "query" is required');

  const nameRe = pattern ? patternToRegex(pattern) : null;
  const results: SearchResult[] = [];

  searchDir(dir, nameRe, query?.trim() || undefined, Number(maxDepth) || 5, Number(maxResults) || 50, results);

  return {
    dir,
    pattern:      pattern || null,
    query:        query   || null,
    resultCount:  results.length,
    results,
  };
}
