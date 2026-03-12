import * as vscode from 'vscode';
import { scanWorkspace, readSafeFile } from '@triforge/engine';

export async function listFilesInWorkspace(workspacePath: string) {
  const files = await scanWorkspace(workspacePath);
  return files.map(f => ({ path: f.path, relativePath: f.relativePath, language: f.language }));
}

export async function searchTextInWorkspace(workspacePath: string, query: string) {
  const files = await scanWorkspace(workspacePath);
  const results: { file: string; relativePath: string; snippet: string }[] = [];

  for (const f of files) {
    const content = readSafeFile(f.path);
    if (!content) continue;
    const idx = content.indexOf(query);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const snippet = content.substring(start, Math.min(content.length, idx + query.length + 60)).replace(/\s+/g, ' ');
      results.push({ file: f.path, relativePath: f.relativePath, snippet });
    }
  }

  return results;
}

export async function openFileAt(workspacePath: string, filePath: string, line: number = 1) {
  try {
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, { preview: false });
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
    return true;
  } catch (err) {
    return false;
  }
}
