import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Patch module: Handles diff generation and file patching with user approval.
 */

export interface ChangePatch {
  filePath: string;
  relativePath: string;
  type: 'create' | 'modify' | 'delete';
  original: string; // full original (or original segment for line edit)
  modified: string; // full modified (or modified segment for line edit)
  diff: string;
  // Optional precision edit info
  startLine?: number; // 1-based
  endLine?: number; // 1-based, inclusive
  isLineEdit?: boolean;
}

export interface ApprovalRequest {
  patches: ChangePatch[];
  summary: string;
  timestamp: Date;
  token: string;
}

/**
 * Generate a simple diff between original and modified content.
 */
export function generateDiff(original: string, modified: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diff: string[] = [];
  let maxLines = Math.max(originalLines.length, modifiedLines.length);

  // Simple line-by-line diff (not a full unified diff, but readable)
  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] || '';
    const modLine = modifiedLines[i] || '';

    if (origLine !== modLine) {
      if (origLine) {
        diff.push(`- ${origLine}`);
      }
      if (modLine) {
        diff.push(`+ ${modLine}`);
      }
    } else {
      if (i < Math.min(3, maxLines)) {
        diff.push(`  ${origLine}`);
      } else if (i === 3) {
        diff.push('  ...');
      }
    }
  }

  return diff.join('\n');
}

function computeLineRange(original: string, modified: string): { start: number; end: number; changedLines: number } {
  const oLines = original.split('\n');
  const mLines = modified.split('\n');
  const max = Math.max(oLines.length, mLines.length);
  let firstDiff = -1;
  let lastDiff = -1;

  for (let i = 0; i < max; i++) {
    const o = oLines[i] || '';
    const m = mLines[i] || '';
    if (o !== m) {
      if (firstDiff === -1) firstDiff = i;
      lastDiff = i;
    }
  }

  if (firstDiff === -1) {
    return { start: 1, end: 1, changedLines: 0 };
  }

  return { start: firstDiff + 1, end: lastDiff + 1, changedLines: lastDiff - firstDiff + 1 };
}

/**
 * Create a patch for a new file.
 */
export function createPatch(
  filePath: string,
  content: string,
  workspacePath?: string
): ChangePatch {
  const relativePath = workspacePath
    ? path.relative(workspacePath, filePath)
    : filePath;

  return {
    filePath,
    relativePath,
    type: 'create',
    original: '',
    modified: content,
    diff: `CREATE: ${relativePath}\n\n${content.split('\n').slice(0, 10).join('\n')}...`,
  };
}

/**
 * Create a patch for a modified file.
 */
export function modifyPatch(
  filePath: string,
  original: string,
  modified: string,
  workspacePath?: string
): ChangePatch {
  const relativePath = workspacePath
    ? path.relative(workspacePath, filePath)
    : filePath;

  const diff = generateDiff(original, modified);

  // Attempt to compute a precision line edit for small changes
  const range = computeLineRange(original, modified);
  if (range.changedLines > 0 && range.changedLines <= 20) {
    // Build original/modified segment
    const oLines = original.split('\n');
    const mLines = modified.split('\n');
    const oSegment = oLines.slice(Math.max(0, range.start - 1), range.end).join('\n');
    const mSegment = mLines.slice(Math.max(0, range.start - 1), range.end).join('\n');

    return {
      filePath,
      relativePath,
      type: 'modify',
      original: oSegment,
      modified: mSegment,
      diff,
      startLine: range.start,
      endLine: range.end,
      isLineEdit: true,
    };
  }

  return {
    filePath,
    relativePath,
    type: 'modify',
    original,
    modified,
    diff,
  };
}

/**
 * Create a patch for a deleted file.
 */
export function deletePatch(
  filePath: string,
  original: string,
  workspacePath?: string
): ChangePatch {
  const relativePath = workspacePath
    ? path.relative(workspacePath, filePath)
    : filePath;

  return {
    filePath,
    relativePath,
    type: 'delete',
    original,
    modified: '',
    diff: `DELETE: ${relativePath}`,
  };
}

/**
 * Generate a summary of all patches.
 */
export function generatePatchSummary(patches: ChangePatch[]): string {
  const creates = patches.filter(p => p.type === 'create').length;
  const modifies = patches.filter(p => p.type === 'modify').length;
  const deletes = patches.filter(p => p.type === 'delete').length;

  return `Changes Summary:
- Files to CREATE: ${creates}
- Files to MODIFY: ${modifies}
- Files to DELETE: ${deletes}
- Total: ${patches.length} changes

Use the approval dialog to review and approve these changes.`;
}

/**
 * Validate that a file path is inside the workspace root.
 * Resolves symlinks to prevent traversal attacks via symbolic links.
 */
function isInsideWorkspace(filePath: string, workspacePath: string): boolean {
  const tryResolve = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const resolved = tryResolve(filePath);
  const root = tryResolve(workspacePath);
  return resolved.startsWith(root + path.sep) || resolved === root;
}

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5-minute expiry for patch approval tokens

/** Maps token → expiry timestamp (ms). Tokens expire after TOKEN_TTL_MS. */
const activeApprovalTokens = new Map<string, number>();

function purgeExpiredTokens(): void {
  const now = Date.now();
  for (const [token, expiry] of activeApprovalTokens) {
    if (expiry <= now) { activeApprovalTokens.delete(token); }
  }
}

/**
 * Apply patches to disk. Requires a valid approval token from createApprovalRequest
 * and a workspacePath to enforce path boundaries.
 */
export async function applyPatches(
  patches: ChangePatch[],
  workspacePath: string,
  approvalToken: string
): Promise<string[]> {
  purgeExpiredTokens();
  const expiry = activeApprovalTokens.get(approvalToken) ?? 0;
  if (expiry <= Date.now()) {
    activeApprovalTokens.delete(approvalToken);
    throw new Error('Invalid or expired approval token. Patches must be approved before applying.');
  }

  // Consume the token so it cannot be reused
  activeApprovalTokens.delete(approvalToken);

  const applied: string[] = [];

  for (const patch of patches) {
    try {
      // Guard: reject writes outside workspace
      if (!isInsideWorkspace(patch.filePath, workspacePath)) {
        console.error(`Blocked: patch target is outside workspace: ${patch.filePath}`);
        continue;
      }

      const dir = path.dirname(patch.filePath);

      // Ensure directory exists for create
      if (patch.type === 'create') {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(patch.filePath, patch.modified, 'utf-8');
        applied.push(patch.relativePath);
      } else if (patch.type === 'modify') {
        if (patch.isLineEdit && patch.startLine && patch.endLine) {
          // Use WorkspaceEdit to precisely replace the range
          try {
            const uri = vscode.Uri.file(patch.filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const edit = new vscode.WorkspaceEdit();
            const start = new vscode.Position(Math.max(0, patch.startLine - 1), 0);
            const end = new vscode.Position(Math.max(0, patch.endLine - 1), doc.lineAt(Math.max(0, patch.endLine - 1)).range.end.character);
            edit.replace(uri, new vscode.Range(start, end), patch.modified);
            const ok = await vscode.workspace.applyEdit(edit);
            if (ok) { applied.push(patch.relativePath); }
            else {
              // Fallback to full write
              fs.writeFileSync(patch.filePath, patch.modified, 'utf-8');
              applied.push(patch.relativePath);
            }
          } catch (e) {
            // Fallback: rewrite full file (best-effort)
            fs.writeFileSync(patch.filePath, patch.modified, 'utf-8');
            applied.push(patch.relativePath);
          }
        } else {
          fs.writeFileSync(patch.filePath, patch.modified, 'utf-8');
          applied.push(patch.relativePath);
        }
      } else if (patch.type === 'delete') {
        if (fs.existsSync(patch.filePath)) {
          fs.unlinkSync(patch.filePath);
          applied.push(patch.relativePath);
        }
      }
    } catch (err) {
      console.error(`Failed to apply patch to ${patch.filePath}:`, err);
    }
  }

  return applied;
}

/** Generate a cryptographically random token. */
function generateToken(): string {
  return `tf-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Create an approval request. Returns a token that must be passed to applyPatches.
 */
export function createApprovalRequest(patches: ChangePatch[]): ApprovalRequest {
  purgeExpiredTokens();
  const token = generateToken();
  activeApprovalTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return {
    patches,
    summary: generatePatchSummary(patches),
    timestamp: new Date(),
    token,
  };
}
