import * as fs from 'fs';
import * as path from 'path';
import { isPathExcluded, getSafeExtensions, sanitizeContent } from './safety';

/**
 * Context module: Scans workspace and builds safe context for AI analysis.
 */

export interface FileInfo {
  path: string;
  relativePath: string;
  language: string;
  size: number;
}

export interface ProjectContext {
  workspaceName: string;
  workspacePath: string;
  files: FileInfo[];
  totalSize: number;
  fileCount: number;
  preview: string;
}

/**
 * Scan workspace for files matching safe criteria.
 */
export async function scanWorkspace(workspacePath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const safeExtensions = getSafeExtensions();

  try {
    const scan = (dir: string, depth: number = 0) => {
      if (depth > 10) return; // Prevent deep recursion

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(workspacePath, fullPath);

          // Skip excluded paths
          if (isPathExcluded(fullPath)) {
            continue;
          }

          if (entry.isDirectory()) {
            scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (safeExtensions.includes(ext)) {
              const stats = fs.statSync(fullPath);
              files.push({
                path: fullPath,
                relativePath,
                language: getLanguage(ext),
                size: stats.size,
              });
            }
          }
        }
      } catch (_err) {
        // Skip directories we can't read
      }
    };

    scan(workspacePath);
  } catch (_err) {
    // Return empty array if scan fails
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Get language identifier from file extension.
 */
function getLanguage(ext: string): string {
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.xml': 'xml',
    '.md': 'markdown',
    '.txt': 'plaintext',
  };
  return langMap[ext] || 'plaintext';
}

/**
 * Build full project context preview.
 */
export async function buildContextPreview(
  workspacePath: string,
  fileCount: number = 10
): Promise<ProjectContext> {
  const workspaceName = path.basename(workspacePath);
  const files = await scanWorkspace(workspacePath);

  const limitedFiles = files.slice(0, fileCount);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const preview = `
**Project:** ${workspaceName}
**Location:** ${workspacePath}
**Total Files:** ${files.length}
**Preview Files:** ${limitedFiles.length}
**Estimated Context Size:** ${(totalSize / 1024).toFixed(2)} KB

**Files to be shared:**
${limitedFiles.map(f => `- ${f.relativePath} (${f.language})`).join('\n')}
${files.length > fileCount ? `- ... and ${files.length - fileCount} more files` : ''}
`;

  return {
    workspaceName,
    workspacePath,
    files: limitedFiles,
    totalSize,
    fileCount: files.length,
    preview: preview.trim(),
  };
}

/**
 * Read and sanitize a file for safe transmission.
 */
export function readSafeFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return sanitizeContent(content);
  } catch (_err) {
    return null;
  }
}
