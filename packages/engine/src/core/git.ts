/**
 * Git utilities — read repo state to enrich AI context and power smart-commit/PR features.
 * All functions are async and fail silently (return '' on any error).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function git(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', cmd.split(' '), { cwd, timeout: 10_000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Short status listing modified/added/deleted files. */
export async function getGitStatus(workspacePath: string): Promise<string> {
  if (!workspacePath) { return ''; }
  return git('status --short', workspacePath);
}

/**
 * Full diff against HEAD (or staged diff if staged=true).
 * Capped at 8 000 chars to stay within AI context budgets.
 */
export async function getGitDiff(workspacePath: string, staged = false): Promise<string> {
  if (!workspacePath) { return ''; }
  const raw = await git(staged ? 'diff --cached' : 'diff HEAD', workspacePath);
  return raw.length > 8000 ? raw.substring(0, 8000) + '\n... (diff truncated)' : raw;
}

/** Current branch name. */
export async function getGitBranch(workspacePath: string): Promise<string> {
  if (!workspacePath) { return ''; }
  return git('rev-parse --abbrev-ref HEAD', workspacePath);
}

/** One-line log for the last n commits. */
export async function getRecentCommits(workspacePath: string, n = 5): Promise<string> {
  if (!workspacePath) { return ''; }
  return git(`log --oneline -${n}`, workspacePath);
}

/**
 * Compact git context string to include in AI prompts.
 * Safe to call even if the workspace has no git repo.
 */
export async function buildGitContext(workspacePath: string): Promise<string> {
  const [branch, status, commits] = await Promise.all([
    getGitBranch(workspacePath),
    getGitStatus(workspacePath),
    getRecentCommits(workspacePath, 3),
  ]);
  if (!branch && !status) { return ''; }
  const parts: string[] = ['--- Git Context ---'];
  if (branch)  { parts.push(`Branch: ${branch}`); }
  if (commits) { parts.push(`Recent commits:\n${commits}`); }
  if (status)  { parts.push(`Changed files:\n${status}`); }
  return parts.join('\n');
}
