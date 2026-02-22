import * as vscode from 'vscode';

export type RiskLevel = 'low' | 'medium' | 'high';

interface CommandPreview {
  token: string;
  command: string;
  cwd: string;
  explanation?: string;
  risk: RiskLevel;
  timestamp: number;
}

const activePreviews = new Map<string, CommandPreview>();

function generateToken(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function previewCommand(command: string, cwd?: string, explanation?: string, risk: RiskLevel = 'low') {
  const token = generateToken();
  const preview: CommandPreview = {
    token,
    command,
    cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    explanation: explanation || '',
    risk,
    timestamp: Date.now(),
  };

  activePreviews.set(token, preview);
  return preview;
}

function isDestructive(cmd: string): boolean {
  const destructivePatterns = [
    /git\s+push\s+--force/gi,
    /git\s+reset\s+--hard/gi,
    /rm\s+-rf/gi,
    /del\s+\/f/gi,
    /git\s+clean\s+-fd/gi,
  ];
  return destructivePatterns.some(r => r.test(cmd));
}

export async function executePreview(token: string): Promise<{ success: boolean; message?: string }> {
  const preview = activePreviews.get(token);
  if (!preview) {
    return { success: false, message: 'Invalid or expired token.' };
  }

  // Extra confirmation for destructive commands
  if (isDestructive(preview.command)) {
    const confirm = 'Run (destructive)';
    const cancel = 'Cancel';
    const result = await vscode.window.showWarningMessage(
      `The command appears destructive: "${preview.command}"\nWorking directory: ${preview.cwd}\nDo you want to proceed?`,
      { modal: true },
      confirm,
      cancel
    );
    if (result !== confirm) {
      activePreviews.delete(token);
      return { success: false, message: 'User aborted destructive command.' };
    }
  }

  try {
    const term = vscode.window.createTerminal({ name: `TriForge: ${preview.command}`, cwd: preview.cwd });
    term.show(true);
    term.sendText(preview.command, true);
    // Keep the preview token consumed
    activePreviews.delete(token);
    return { success: true };
  } catch (err: any) {
    activePreviews.delete(token);
    return { success: false, message: err.message || String(err) };
  }
}

export function getPreview(token: string) {
  return activePreviews.get(token) || null;
}

export function cancelPreview(token: string) {
  return activePreviews.delete(token);
}
