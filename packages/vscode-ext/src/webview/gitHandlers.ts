// gitHandlers.ts — Git utility functions and message handler, extracted from panel.ts.
// Utilities depend only on vscode, path, execSync. No panel state needed.

import * as vscode from 'vscode';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ProviderManager } from '@triforge/engine';

// ── Git Utilities ─────────────────────────────────────────────────────────

export function runGit(args: string[]): string {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) { throw new Error('No workspace folder open.'); }
  return execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf8', timeout: 10000 });
}

export function getGitStatus(): { staged: string[], modified: string[], untracked: string[], branch: string } {
  const output = runGit(['status', '--porcelain']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const staged: string[] = [], modified: string[] = [], untracked: string[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) { continue; }
    const x = line[0], y = line[1], file = line.slice(3).trim();
    if (x !== ' ' && x !== '?') { staged.push(file); }
    if (y === 'M' || (x === ' ' && y !== ' ')) { modified.push(file); }
    if (x === '?') { untracked.push(file); }
  }
  return { staged, modified, untracked, branch };
}

export function getBranches(): { current: string; all: string[] } {
  const raw = runGit(['branch']);
  const all: string[] = [];
  let current = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) { continue; }
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s*/, '').trim();
    if (isCurrent) { current = name; }
    all.push(name);
  }
  return { current, all };
}

export function getRelPath(absPath: string): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return ws ? path.relative(ws, absPath).replace(/\\/g, '/') : path.basename(absPath);
}

export async function getWorkspaceTree(): Promise<{rel: string, lang: string}[]> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) { return []; }
  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,cpp,c,h,json,yaml,yml,md,html,css,scss,vue,svelte}',
    '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/coverage/**,**/.vscode-test/**}'
  );
  return files.slice(0, 800)
    .map(f => ({ fsPath: f.fsPath, rel: path.relative(ws.uri.fsPath, f.fsPath).replace(/\\/g, '/'), lang: path.extname(f.fsPath).slice(1) }))
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(f => ({ rel: f.rel, lang: f.lang }));
}

export async function readWorkspaceFile(relPath: string): Promise<string> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) { return ''; }
  try {
    const uri = vscode.Uri.joinPath(ws.uri, relPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8').split('\n').slice(0, 300).join('\n');
  } catch { return ''; }
}

// ── Git Message Handler ───────────────────────────────────────────────────
// Returns true if the message was handled, false if it should fall through.

export async function handleGitMessage(
  send: (payload: object) => void,
  providerManager: ProviderManager,
  message: any,
): Promise<boolean> {
  switch (message.command) {
    case 'workspace:getTree': {
      const files = await getWorkspaceTree();
      send({ type: 'workspace-tree', files });
      return true;
    }
    case 'git:status': {
      try { send({ type: 'git-status', ...getGitStatus() }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:stageAll': {
      try { runGit(['add', '-A']); send({ type: 'git-status', ...getGitStatus() }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:stage': {
      try { runGit(['add', '--', message.file as string]); send({ type: 'git-status', ...getGitStatus() }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:unstage': {
      try { runGit(['restore', '--staged', '--', message.file as string]); send({ type: 'git-status', ...getGitStatus() }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:unstageAll': {
      try { runGit(['restore', '--staged', '.']); send({ type: 'git-status', ...getGitStatus() }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:commit': {
      try {
        const msg = (message.message as string)?.trim();
        if (!msg) { send({ type: 'git-error', message: 'Commit message required.' }); return true; }
        runGit(['commit', '-m', JSON.stringify(msg)]);
        send({ type: 'git-committed', status: getGitStatus() });
      } catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:push': {
      try {
        const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
        const confirm = await vscode.window.showWarningMessage(
          `Push branch "${branch}" to remote origin?`, { modal: true }, 'Push', 'Cancel'
        );
        if (confirm !== 'Push') { return true; }
        runGit(['push']);
        send({ type: 'git-pushed' });
        vscode.window.showInformationMessage('TriForge AI: Pushed successfully.');
      } catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:generateMessage': {
      try {
        const diff = runGit(['diff', '--staged']);
        if (!diff.trim()) { send({ type: 'git-error', message: 'No staged changes to generate message from.' }); return true; }
        const providers = await providerManager.getActiveProviders();
        const provider = providers[0];
        if (!provider) { send({ type: 'git-error', message: 'No AI provider configured.' }); return true; }
        send({ type: 'git-generating' });
        const ctrl = new AbortController();
        const msg = await provider.chat([
          { role: 'system', content: 'Write a concise git commit message (imperative mood, max 72 chars first line, optional body after blank line). Return ONLY the commit message text — no JSON, no markdown fences, no explanation.' },
          { role: 'user', content: `Generate a commit message for this diff:\n\n${diff.slice(0, 8000)}` },
        ], ctrl.signal);
        send({ type: 'git-message-ready', message: msg.trim() });
      } catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:branches': {
      try { send({ type: 'git-branches', ...getBranches() }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:diff': {
      try { send({ type: 'git-diff', diff: runGit(['diff', '--staged']) }); }
      catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:log': {
      try {
        const raw = runGit(['log', '--oneline', '-10']);
        const commits = raw.split('\n').filter(l => l.trim()).map(l => ({
          hash: l.slice(0, 7),
          message: l.slice(8).trim(),
        }));
        send({ type: 'git-log', commits });
      } catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:createBranch': {
      try {
        const name = (message.name as string)?.trim();
        if (!name) { send({ type: 'git-error', message: 'Branch name required.' }); return true; }
        runGit(['checkout', '-b', name]);
        send({ type: 'git-branches', ...getBranches() });
        send({ type: 'git-status', ...getGitStatus() });
      } catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    case 'git:switchBranch': {
      try {
        const name = (message.name as string)?.trim();
        if (!name) { return true; }
        runGit(['checkout', name]);
        send({ type: 'git-branches', ...getBranches() });
        send({ type: 'git-status', ...getGitStatus() });
      } catch(e) { send({ type: 'git-error', message: String(e) }); }
      return true;
    }
    default:
      return false;
  }
}
