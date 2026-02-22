import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { buildContextPreview, scanWorkspace, readSafeFile } from '../core/context';
import { ProviderManager } from '../core/providerManager';
import { TriForgeOrchestrator } from '../core/orchestrator';
import { ProviderName, OperatingMode, FileStatusInfo } from './protocol';
import { createPatch, modifyPatch, deletePatch, createApprovalRequest, applyPatches, ChangePatch } from '../core/patch';
import { ProviderError } from '../core/providers/provider';
import { TaskResult, DebateProgress, FileChange } from '../core/types';
import { previewCommand, executePreview, getPreview, cancelPreview } from '../core/commands';
import { searchTextInWorkspace, listFilesInWorkspace, openFileAt } from '../core/search';
import { DebugSession } from '../core/debugSession';

/**
 * Webview Panel — TriForge AI chat UI with debate engine integration.
 */

export class TriForgeChatPanel {
  public static currentPanel: TriForgeChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _providerManager: ProviderManager;
  private _disposables: vscode.Disposable[] = [];

  private _abortController: AbortController | null = null;
  private _pendingApprovalToken: string | null = null;
  private _pendingPatches: ChangePatch[] | null = null;
  private _lastTaskResult: TaskResult | null = null;
  private _lastUserRequest: string | null = null;
  private _lastContext: string | null = null;
  private _debugSessions: Map<string, DebugSession> = new Map();

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    providerManager: ProviderManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._providerManager = providerManager;

    this._setWebviewMessageListener();

    const statusSub = this._providerManager.onDidChangeStatus(() => {
      this.refreshProviderStatus();
    });
    this._disposables.push(statusSub);

    this.updateContent();
  }

  public static createOrShow(extensionUri: vscode.Uri, providerManager: ProviderManager) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TriForgeChatPanel.currentPanel) {
      TriForgeChatPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'triForgeChat',
      'TriForge AI Chat',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableForms: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    TriForgeChatPanel.currentPanel = new TriForgeChatPanel(panel, extensionUri, providerManager);
  }

  public dispose() {
    TriForgeChatPanel.currentPanel = undefined;
    this._abortController?.abort();
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  public async refreshProviderStatus(): Promise<void> {
    const providers = await this._providerManager.getStatus();
    const mode = await this._providerManager.detectMode();
    this._post({ command: 'providerStatus', providers, mode });
  }

  public sendMessage(message: string) {
    this._post({ command: 'addMessage', text: message });
  }

  public updateContent() {
    this._panel.webview.html = this._getWebviewContent(this._panel.webview);
  }

  // ─── Message Router ────────────────────────────────────────────────

  private _setWebviewMessageListener() {
    this._panel.webview.onDidReceiveMessage(
      async (message: any) => {
        switch (message.command) {
          case 'log':
            console.log(message.text);
            break;

          case 'action':
            this._handleAction(message.action);
            break;

          case 'sendMessage':
            await this._handleSendMessage(message.text);
            break;

          case 'requestContext':
            await this._handleRequestContext();
            break;

          case 'getProviderStatus':
            await this.refreshProviderStatus();
            break;

          case 'setApiKey': {
            const name = message.provider as ProviderName;
            const key = message.key as string;
            if (name && key) {
              await this._providerManager.setKey(name, key);
              await this.refreshProviderStatus();
              this._post({ command: 'addMessage', text: `${name.charAt(0).toUpperCase() + name.slice(1)} key saved securely.` });
            }
            break;
          }

          case 'removeApiKey': {
            const providerName = message.provider as ProviderName;
            if (providerName) {
              await this._providerManager.removeKey(providerName);
              await this.refreshProviderStatus();
            }
            break;
          }

          // --- Command preview & execution ---
          case 'suggestCommand': {
            const cmd = message.cmd as string;
            const cwd = message.cwd as string | undefined;
            const explanation = message.explanation as string | undefined;
            const risk = (message.risk as 'low' | 'medium' | 'high') || 'low';
            const preview = previewCommand(cmd, cwd, explanation, risk);
            this._post({ command: 'commandPreview', token: preview.token, cmd: preview.command, cwd: preview.cwd, explanation: preview.explanation, risk: preview.risk });
            break;
          }

          case 'runCommand': {
            const token = message.token as string;
            const res = await executePreview(token);
            const p = getPreview(token);
            this._post({ command: 'commandResult', token, cmd: p?.command || '', cwd: p?.cwd || '', success: res.success, message: res.message });
            break;
          }

          case 'cancelCommandPreview': {
            cancelPreview(message.token as string);
            break;
          }

          // --- Repo search / open ---
          case 'searchRepo': {
            const query = message.query as string;
            const ws = this._getWorkspacePath();
            if (!ws) { this._post({ command: 'searchResults', results: [] }); break; }
            const results = await searchTextInWorkspace(ws, query);
            this._post({ command: 'searchResults', results });
            break;
          }

          case 'openFile': {
            const p = message.path as string;
            const line = message.line as number | undefined;
            const ws = this._getWorkspacePath();
            if (!ws) { break; }
            const ok = await openFileAt(ws, p, line || 1);
            if (!ok) { this._post({ command: 'requestError', error: `Failed to open file: ${p}` }); }
            break;
          }

          // --- Debug session ---
          case 'startDebugSession': {
            const ws = this._getWorkspacePath();
            const session = new DebugSession(ws, (u) => this._post({ command: 'debugUpdate', sessionId: session.id(), update: u }));
            this._debugSessions.set(session.id(), session);
            if (message.errorLog) { session.addErrorLog(message.errorLog); }
            this._post({ command: 'debugUpdate', sessionId: session.id(), update: session.getState() });
            break;
          }

          case 'debugAction': {
            const sid = message.sessionId as string;
            const action = message.action as string;
            const payload = message.payload;
            const session = this._debugSessions.get(sid);
            if (!session) { this._post({ command: 'requestError', error: 'Invalid debug session id.' }); break; }

            if (action === 'runTests') {
              const preview = await session.runTests(payload?.command || 'npm test');
              this._post({ command: 'debugUpdate', sessionId: sid, update: { type: 'testsSuggested', preview } });
            } else if (action === 'executePreview') {
              const result = await session.executePreview(payload.token);
              this._post({ command: 'debugUpdate', sessionId: sid, update: { type: 'testsExecuted', result } });
            }
            break;
          }

          // --- Precision line edits (preview) ---
          case 'createLineEdit': {
            const file = message.file as string;
            const startLine = message.startLine as number;
            const endLine = message.endLine as number;
            const newContent = message.newContent as string;
            const ws = this._getWorkspacePath();
            try {
              const absPath = path.resolve(ws, file);
              // read original full file to extract segment
              const original = readSafeFile(absPath) || '';
              const originalLines = original.split('\n');
              const originalSegment = originalLines.slice(Math.max(0, startLine - 1), Math.min(originalLines.length, endLine)).join('\n');
              const patch = modifyPatch(absPath, original, originalLines.slice(0, startLine - 1).concat(newContent.split('\n')).concat(originalLines.slice(endLine)).join('\n'), ws);
              const approval = createApprovalRequest([patch]);
              this._pendingApprovalToken = approval.token;
              this._pendingPatches = approval.patches;
              this._post({ command: 'lineEditPreview', preview: { relativePath: patch.relativePath, diff: patch.diff, startLine: patch.startLine, endLine: patch.endLine }, token: approval.token });
            } catch (err: any) {
              this._post({ command: 'requestError', error: `Failed to prepare line edit preview: ${err.message || err}` });
            }
            break;
          }

          case 'setMode': {
            const mode = message.mode as 'guided' | 'professional';
            const config = vscode.workspace.getConfiguration('triforgeAi');
            await config.update('mode', mode, vscode.ConfigurationTarget.Global);
            this._post({ command: 'modeChanged', mode });
            break;
          }

          case 'cancelRequest':
            this._abortController?.abort();
            this._abortController = null;
            this._post({ command: 'requestComplete' });
            this._post({ command: 'addMessage', text: 'Request cancelled.' });
            break;

          case 'approvePatches':
            await this._handleApprovePatches(message.token);
            break;

          case 'rejectPatches':
            this._handleRejectPatches();
            break;

          case 'continueDebate': {
            if (!this._lastTaskResult || !this._lastUserRequest) {
              this._post({ command: 'addMessage', text: 'No previous task to continue. Run a consensus request first.' });
              break;
            }
            const disagreed = this._lastTaskResult.fileDebates.filter(d => d.status === 'disagreement');
            if (disagreed.length === 0) {
              this._post({ command: 'addMessage', text: 'No disagreements to resolve.' });
              break;
            }
            const tiebreakerText = `${this._lastUserRequest}\n\nIMPORTANT: Previous attempt had disagreements on: ${disagreed.map(d => d.relativePath).join(', ')}. Please reach consensus this time, being flexible on minor issues.`;
            await this._handleSendMessage(tiebreakerText);
            break;
          }

          case 'acceptMajority': {
            if (!this._lastTaskResult) {
              this._post({ command: 'addMessage', text: 'No previous task result found.' });
              break;
            }
            const majorityFiles: FileChange[] = this._lastTaskResult.fileDebates
              .filter(d => {
                if (d.status === 'approved' || d.rounds.length === 0) { return false; }
                const last = d.rounds[d.rounds.length - 1];
                const approvals = last.reviews.filter(r => r.verdict === 'APPROVE').length;
                return approvals > 0 && approvals >= last.reviews.length / 2;
              })
              .map(d => d.rounds[d.rounds.length - 1].fileChange);
            if (majorityFiles.length === 0) {
              this._post({ command: 'addMessage', text: 'No files with majority approval found in disagreements.' });
              break;
            }
            const majorityResult: TaskResult = {
              ...this._lastTaskResult,
              approvedFiles: [...this._lastTaskResult.approvedFiles, ...majorityFiles],
              hasDisagreements: false,
            };
            await this._presentPatches(majorityResult);
            break;
          }

          case 'exportDebate':
            await this._exportDebateMarkdown();
            break;

          case 'openExternal': {
            const url = message.url as string;
            if (url) {
              vscode.env.openExternal(vscode.Uri.parse(url));
            }
            break;
          }
        }
      },
      undefined,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  // ─── Chat Pipeline ─────────────────────────────────────────────────

  private async _handleSendMessage(text: string): Promise<void> {
    if (this._abortController) {
      this._post({ command: 'requestError', error: 'A request is already in progress. Cancel it first.' });
      return;
    }

    const modeInfo = await this._providerManager.detectMode();

    if (modeInfo.mode === 'none') {
      this._post({ command: 'requestError', error: 'No API keys configured. Add at least one key above.' });
      return;
    }

    this._abortController = new AbortController();
    this._post({ command: 'requestStarted', mode: modeInfo.mode });

    try {
      const context = await this._buildContext();
      const providers = await this._providerManager.getActiveProviders();

      switch (modeInfo.mode) {
        case 'single':
          await this._handleSingleMode(text, context);
          break;
        case 'pair':
          await this._handlePairMode(text, context);
          break;
        case 'consensus':
          await this._handleConsensusMode(text, context);
          break;
      }
    } catch (err: any) {
      if (err.message === 'Request cancelled.') {
        // Already handled by cancelRequest
        return;
      }
      const errorMsg = err instanceof ProviderError
        ? `[${err.provider}] ${err.message}`
        : err.message || 'An unexpected error occurred.';
      this._post({
        command: 'requestError',
        error: errorMsg,
        provider: err instanceof ProviderError ? err.provider : undefined,
      });
    } finally {
      this._abortController = null;
      this._post({ command: 'requestComplete' });
    }
  }

  private async _handleSingleMode(text: string, context: string): Promise<void> {
    const providers = await this._providerManager.getActiveProviders();
    const orchestrator = new TriForgeOrchestrator(providers, {
      maxIterations: 1,
      workspacePath: this._getWorkspacePath(),
      signal: this._abortController!.signal,
    });

    const response = await orchestrator.singleResponse(text, context);
    this._post({ command: 'addMessage', text: response, provider: providers[0].name });
  }

  private async _handlePairMode(text: string, context: string): Promise<void> {
    const providers = await this._providerManager.getActiveProviders();
    const orchestrator = new TriForgeOrchestrator(providers, {
      maxIterations: 1,
      workspacePath: this._getWorkspacePath(),
      signal: this._abortController!.signal,
    });

    const result = await orchestrator.pairReview(text, context);
    this._post({ command: 'addMessage', text: result.builder, provider: providers[0].name });
    this._post({ command: 'addMessage', text: result.reviewer, provider: providers[1].name });
  }

  private async _handleConsensusMode(text: string, context: string): Promise<void> {
    const providers = await this._providerManager.getActiveProviders();
    const settings = vscode.workspace.getConfiguration('triforgeAi');
    const maxIterations = settings.get<number>('maxIterations') || 4;

    const orchestrator = new TriForgeOrchestrator(providers, {
      maxIterations,
      workspacePath: this._getWorkspacePath(),
      signal: this._abortController!.signal,
      onProgress: (progress) => this._handleProgress(progress),
    });

    const result = await orchestrator.orchestrate(text, context);
    this._lastTaskResult = result;
    this._lastUserRequest = text;
    this._lastContext = context;

    if (result.approvedFiles.length > 0) {
      await this._presentPatches(result);
    } else if (result.hasDisagreements) {
      this._post({
        command: 'addMessage',
        text: `No files reached consensus.\n\n${result.summary}`,
      });
    } else {
      this._post({
        command: 'addMessage',
        text: result.summary,
      });
    }
  }

  // ─── Consensus Progress ────────────────────────────────────────────

  private _handleProgress(progress: DebateProgress): void {
    // Convert file statuses to protocol format
    const fileStatuses: FileStatusInfo[] = (progress.fileStatuses || []).map(f => ({
      filePath: f.filePath,
      status: f.status,
      approvals: f.approvals,
      total: f.total,
      round: 0,
      maxRounds: 0,
    }));

    this._post({
      command: 'debateProgress',
      message: progress.message,
      fileStatuses,
    });

    // Send detailed log entry for professional mode
    if (progress.provider && progress.filePath) {
      this._post({
        command: 'debateLog',
        provider: progress.provider,
        role: progress.type === 'draft' ? 'builder' : 'reviewer',
        filePath: progress.filePath,
        round: progress.round || 0,
        text: progress.message,
      });
    }
  }

  // ─── Patch Preview + Approval ──────────────────────────────────────

  private async _presentPatches(result: TaskResult): Promise<void> {
    const workspacePath = this._getWorkspacePath();
    const patches: ChangePatch[] = [];

    for (const file of result.approvedFiles) {
      if (file.type === 'create') {
        patches.push(createPatch(file.filePath, file.proposedContent, workspacePath));
      } else if (file.type === 'modify') {
        patches.push(modifyPatch(file.filePath, file.originalContent, file.proposedContent, workspacePath));
      } else if (file.type === 'delete') {
        patches.push(deletePatch(file.filePath, file.originalContent, workspacePath));
      }
    }

    if (patches.length === 0 && !result.hasDisagreements) { return; }

    const approval = createApprovalRequest(patches);
    this._pendingApprovalToken = approval.token;
    this._pendingPatches = approval.patches;

    // Build disagreement report if any
    let disagreementReport: string | undefined;
    if (result.hasDisagreements) {
      const disagreements = result.fileDebates.filter(d => d.status === 'disagreement');
      disagreementReport = disagreements.map(d => d.disagreementReport).filter(Boolean).join('\n\n');
    }

    this._post({
      command: 'patchPreview',
      patches: patches.map(p => ({
        relativePath: p.relativePath,
        type: p.type,
        diff: p.diff,
      })),
      summary: result.summary,
      token: approval.token,
      hasDisagreements: result.hasDisagreements,
      disagreementReport,
    });
  }

  private async _handleApprovePatches(token: string): Promise<void> {
    if (!this._pendingPatches || token !== this._pendingApprovalToken) {
      this._post({ command: 'requestError', error: 'Invalid or expired approval token.' });
      return;
    }

    const workspacePath = this._getWorkspacePath();
    try {
      const applied = await applyPatches(this._pendingPatches, workspacePath, token);
      this._post({ command: 'patchResult', applied, rejected: false });
      this._post({
        command: 'addMessage',
        text: `Applied ${applied.length} file(s): ${applied.join(', ')}`,
      });
    } catch (err: any) {
      this._post({ command: 'requestError', error: `Failed to apply patches: ${err.message}` });
    } finally {
      this._pendingApprovalToken = null;
      this._pendingPatches = null;
    }
  }

  private _handleRejectPatches(): void {
    this._pendingApprovalToken = null;
    this._pendingPatches = null;
    this._post({ command: 'patchResult', applied: [], rejected: true });
    this._post({ command: 'addMessage', text: 'Patches rejected. No files were modified.' });
  }

  // ─── Public actions for extension commands ─────────────────────────

  public insertPrompt(prompt: string): void {
    this._post({ command: 'insertPrompt', prompt });
  }

  public exportDebate(): void {
    this._exportDebateMarkdown();
  }

  private async _exportDebateMarkdown(): Promise<void> {
    if (!this._lastTaskResult) {
      this._post({ command: 'addMessage', text: 'No debate to export. Run a consensus request first.' });
      return;
    }
    const result = this._lastTaskResult;
    const lines: string[] = [
      '# TriForge AI Debate Report',
      '',
      `**Request:** ${this._lastUserRequest || '(unknown)'}`,
      '',
      '## Summary',
      '',
      result.summary,
      '',
    ];

    for (const debate of result.fileDebates) {
      lines.push(`## \`${debate.relativePath}\` — ${debate.status.toUpperCase()}`, '');
      for (const round of debate.rounds) {
        lines.push(`### Round ${round.roundNumber} (Builder: ${round.builder})`, '');
        const preview = round.fileChange.proposedContent.substring(0, 400);
        const truncated = round.fileChange.proposedContent.length > 400 ? '\n// ...' : '';
        lines.push('```', preview + truncated, '```', '');
        for (const review of round.reviews) {
          lines.push(`**${review.provider}** — ${review.verdict}`);
          if (review.reasoning) { lines.push(`> ${review.reasoning}`); }
          for (const issue of review.issues) {
            lines.push(`- [${issue.severity}] ${issue.message}`);
          }
          lines.push('');
        }
      }
    }

    const markdown = lines.join('\n');
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('triforge-debate.md'),
      filters: { 'Markdown': ['md'] },
    });
    if (!uri) { return; }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf-8'));
    this._post({ command: 'addMessage', text: `Debate exported to ${uri.fsPath}` });
  }

  // ─── Context Builder ───────────────────────────────────────────────

  private async _buildContext(): Promise<string> {
    const workspacePath = this._getWorkspacePath();
    if (!workspacePath) { return '(no workspace open)'; }

    const files = await scanWorkspace(workspacePath);
    const maxContextChars = 80_000;
    let totalChars = 0;
    const parts: string[] = [];

    parts.push(`Project: ${path.basename(workspacePath)}`);
    parts.push(`Files: ${files.length}\n`);

    for (const file of files) {
      if (totalChars > maxContextChars) { break; }
      const content = readSafeFile(file.path);
      if (content) {
        const entry = `--- ${file.relativePath} ---\n${content}\n`;
        totalChars += entry.length;
        if (totalChars <= maxContextChars) {
          parts.push(entry);
        }
      }
    }

    return parts.join('\n');
  }

  private async _handleRequestContext(): Promise<void> {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        this._post({ command: 'contextPreview', preview: 'No workspace folder open.' });
        return;
      }
      const ctx = await buildContextPreview(folders[0].uri.fsPath, 15);
      this._post({ command: 'contextPreview', preview: ctx.preview });
    } catch (err) {
      console.error('Failed to build context preview', err);
      this._post({ command: 'contextPreview', preview: 'Failed to build context preview.' });
    }
  }

  // ─── Action Buttons ────────────────────────────────────────────────

  private _handleAction(action: string) {
    const actions: Record<string, string> = {
      audit: 'Audit my project for issues and improvements',
      functionality: 'Check functionality and test coverage',
      missing: 'Find missing features and edge cases',
      security: 'Harden security vulnerabilities',
      plan: 'Generate a full app improvement plan',
      feature: 'Build a feature end-to-end',
    };
    const prompt = actions[action] || action;
    this._post({ command: 'insertPrompt', prompt });
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private _getWorkspacePath(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : '';
  }

  private _post(message: any): void {
    this._panel.webview.postMessage(message);
  }

  private _getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
  }

  // ─── Webview HTML ──────────────────────────────────────────────────

  private _getWebviewContent(webview: vscode.Webview): string {
    const nonce = this._getNonce();
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'TriForgeAI_logo.png'));
    const currentMode = vscode.workspace.getConfiguration('triforgeAi').get<string>('mode') || 'guided';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
  <title>TriForge AI Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg-main: #0B0D10;
      --bg-surface: #171B22;
      --bg-panel: #2A2F36;
      --text-primary: #B9BCC2;
      --text-muted: #666;
      --accent-orange: #FF6A00;
      --accent-teal: #2FC0C2;
      --accent-green: #3FB950;
      --accent-red: #F85149;
      --accent-yellow: #D29922;
      --border-color: #2A2F36;
      --hover-bg: #1F242D;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
      background: var(--bg-main);
      color: var(--text-primary);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* --- Header --- */
    .header {
      background: var(--bg-surface);
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header h1 { font-size: 15px; font-weight: 600; flex: 1; }
    .logo-image { width: 90px; height:90px; object-fit: contain; border-radius: 6px; }

    /* --- Status Bar --- */
    .status-bar {
      background: var(--bg-surface);
      padding: 6px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 11px;
    }
    .provider-dot {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: default;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    .dot.connected { background: var(--accent-green); }
    @keyframes dotPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.5); opacity: 0.6; }
    }
    .dot.active { animation: dotPulse 0.9s ease-in-out infinite; background: var(--accent-orange) !important; }
    .mode-badge {
      margin-left: auto;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
    }
    .mode-badge.consensus { border-color: var(--accent-orange); color: var(--accent-orange); }
    .mode-badge.pair { border-color: var(--accent-teal); color: var(--accent-teal); }
    .mode-badge.single { border-color: var(--text-primary); color: var(--text-primary); }
    .mode-badge.none { border-color: var(--accent-red); color: var(--accent-red); }
    .mode-toggle {
      background: none; border: 1px solid var(--border-color); color: var(--text-muted);
      padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;
    }
    .mode-toggle:hover { border-color: var(--accent-teal); color: var(--accent-teal); }

    /* --- Onboarding --- */
    .onboarding {
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 16px;
      margin: 8px 0;
    }
    .onboarding h3 { font-size: 13px; margin-bottom: 8px; color: var(--accent-teal); }
    .onboarding p { font-size: 12px; margin-bottom: 12px; color: var(--text-muted); }
    .key-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
    }
    .key-row label { font-size: 12px; width: 60px; font-weight: 500; }
    .key-row input {
      flex: 1; background: var(--bg-main); border: 1px solid var(--border-color);
      color: var(--text-primary); padding: 4px 8px; border-radius: 3px; font-size: 12px;
    }
    .key-row input:focus { outline: none; border-color: var(--accent-teal); }
    .key-row button {
      padding: 4px 10px; border: none; border-radius: 3px; cursor: pointer;
      font-size: 11px; font-weight: 500;
      background: var(--accent-teal); color: #000;
    }
    .key-row button:hover { filter: brightness(1.15); }
    .key-row .status-text { font-size: 11px; width: 70px; text-align: center; }
    .key-row .status-text.connected { color: var(--accent-green); }
    .key-row .status-text.missing { color: var(--text-muted); }

    /* --- Action Buttons --- */
    .action-buttons {
      display: flex; flex-wrap: wrap; gap: 8px; padding: 12px;
      background: var(--bg-surface); border-bottom: 1px solid var(--border-color);
    }
    body[data-mode="professional"] .action-buttons { display: none; }
    .action-btn {
      padding: 8px 16px; border: 1px solid var(--border-color);
      background: var(--bg-panel); color: var(--text-primary); border-radius: 4px;
      cursor: pointer; font-size: 12px; font-weight: 500;
      transition: all 0.2s ease; white-space: nowrap;
    }
    .action-btn:hover { background: var(--hover-bg); border-color: var(--accent-orange); color: var(--accent-orange); }
    .action-btn.primary { background: var(--accent-orange); color: white; border-color: var(--accent-orange); }
    .action-btn.primary:hover { background: #ff7a1a; }
    .action-btn.secondary { border-color: var(--accent-teal); color: var(--accent-teal); }
    .action-btn.secondary:hover { background: var(--hover-bg); color: #4fd9db; }

    /* --- Main Container --- */
    .main-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

    /* --- File Status Panel (consensus mode) --- */
    .file-status-panel {
      display: none;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      padding: 8px 16px;
      max-height: 140px;
      overflow-y: auto;
    }
    .file-status-panel.visible { display: block; }
    .file-status-panel h4 {
      font-size: 11px; color: var(--accent-teal); margin-bottom: 6px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .file-status-row {
      display: flex; align-items: center; gap: 8px;
      padding: 3px 0; font-size: 12px;
    }
    .file-status-icon {
      width: 14px; text-align: center; font-size: 11px;
    }
    .file-status-icon.approved { color: var(--accent-green); }
    .file-status-icon.reviewing { color: var(--accent-yellow); }
    .file-status-icon.drafting { color: var(--accent-teal); }
    .file-status-icon.disagreement { color: var(--accent-red); }
    .file-status-icon.pending { color: var(--text-muted); }
    .file-status-name { flex: 1; font-family: monospace; font-size: 11px; }
    .file-status-detail { font-size: 10px; color: var(--text-muted); }

    /* --- Chat Messages --- */
    .messages-container {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .message {
      padding: 12px; border-radius: 6px; max-width: 90%;
      word-wrap: break-word; font-size: 13px; line-height: 1.5;
      white-space: pre-wrap;
    }
    .message.ai {
      background: var(--bg-panel); color: var(--text-primary);
      border-left: 3px solid var(--accent-teal); align-self: flex-start;
    }
    .message.ai.openai { border-left-color: #ef4444; color: #ef4444; }
    .message.ai.qwen   { border-left-color: #3b82f6; color: #3b82f6; }
    .message.ai.claude { border-left-color: #f97316; color: #f97316; }
    .message.user {
      background: var(--accent-orange); color: #fff;
      align-self: flex-end; border-radius: 6px;
    }
    .message.system {
      background: transparent; color: var(--text-muted);
      font-size: 12px; align-self: center; font-style: italic;
    }
    .message.error {
      background: rgba(248,81,73,0.1); color: var(--accent-red);
      border-left: 3px solid var(--accent-red); align-self: flex-start;
      font-size: 12px;
    }
    .message .provider-tag {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 4px; opacity: 0.7;
    }

    /* --- Loading Indicator --- */
    .loading-bar {
      display: none;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      padding: 8px 16px;
      font-size: 12px;
      color: var(--accent-teal);
    }
    .loading-bar.visible { display: flex; align-items: center; gap: 8px; }
    .spinner {
      width: 14px; height: 14px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-teal);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { flex: 1; }
    .cancel-btn {
      background: none; border: 1px solid var(--accent-red); color: var(--accent-red);
      padding: 2px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;
    }
    .cancel-btn:hover { background: rgba(248,81,73,0.15); }

    /* --- Debate Log (Professional mode only) --- */
    .debate-log {
      display: none;
      background: var(--bg-main);
      border-bottom: 1px solid var(--border-color);
      max-height: 180px;
      overflow-y: auto;
      padding: 8px 16px;
      font-family: monospace;
      font-size: 11px;
    }
    body[data-mode="professional"] .debate-log.visible { display: block; }
    .debate-entry { padding: 2px 0; color: var(--text-muted); }
    .debate-entry .de-provider { font-weight: 600; }
    .verdict-badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; margin: 0 3px; vertical-align: middle; }
    .verdict-badge.approve { background: rgba(46,160,67,0.15); color: #3fb950; border: 1px solid rgba(46,160,67,0.3); }
    .verdict-badge.changes { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
    .debate-entry .de-provider.openai { color: #ef4444; }
    .debate-entry .de-provider.qwen   { color: #3b82f6; }
    .debate-entry .de-provider.claude { color: #f97316; }
    .debate-entry .de-role { color: var(--accent-teal); font-size: 10px; }

    /* --- Patch Preview --- */
    .patch-preview {
      display: none;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      margin: 8px 16px;
      overflow: hidden;
    }
    .patch-preview.visible { display: block; }
    .patch-header {
      background: var(--bg-panel);
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      display: flex; align-items: center; justify-content: space-between;
    }
    .patch-header .patch-title { color: var(--accent-teal); }
    .patch-actions { display: flex; gap: 8px; }
    .approve-btn {
      background: var(--accent-green); color: #000; border: none;
      padding: 4px 14px; border-radius: 3px; cursor: pointer;
      font-size: 11px; font-weight: 600;
    }
    .approve-btn:hover { filter: brightness(1.15); }
    .reject-btn {
      background: none; border: 1px solid var(--accent-red); color: var(--accent-red);
      padding: 4px 14px; border-radius: 3px; cursor: pointer;
      font-size: 11px; font-weight: 500;
    }
    .reject-btn:hover { background: rgba(248,81,73,0.15); }
    .export-btn {
      background: none; border: 1px solid var(--border-color); color: var(--text-muted);
      padding: 4px 14px; border-radius: 3px; cursor: pointer;
      font-size: 11px; font-weight: 500; margin-left: 4px;
    }
    .export-btn:hover { border-color: var(--accent-teal); color: var(--accent-teal); }
    .disagreement-actions { margin-top: 8px; display: flex; gap: 8px; }
    .disagreement-actions button {
      padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: 500;
      background: none; border: 1px solid var(--accent-orange); color: var(--accent-orange);
    }
    .disagreement-actions button:hover { background: rgba(255,122,26,0.1); }
    .patch-file {
      border-top: 1px solid var(--border-color);
      padding: 8px 12px;
    }
    .patch-file-name {
      font-family: monospace; font-size: 12px; font-weight: 600;
      margin-bottom: 4px;
    }
    .patch-file-name .file-type {
      font-weight: 400; font-size: 10px; padding: 1px 6px; border-radius: 3px;
      margin-left: 6px;
    }
    .file-type.create { background: rgba(63,185,80,0.2); color: var(--accent-green); }
    .file-type.modify { background: rgba(47,192,194,0.2); color: var(--accent-teal); }
    .file-type.delete { background: rgba(248,81,73,0.2); color: var(--accent-red); }
    .patch-diff {
      background: var(--bg-main); border-radius: 4px; padding: 8px;
      font-family: monospace; font-size: 11px; line-height: 1.4;
      max-height: 200px; overflow-y: auto; white-space: pre;
    }
    .diff-add { color: var(--accent-green); }
    .diff-remove { color: var(--accent-red); }
    .diff-context { color: var(--text-muted); }
    .patch-summary {
      padding: 8px 12px; font-size: 12px; color: var(--text-muted);
      border-top: 1px solid var(--border-color);
    }
    .disagreement-warning {
      background: rgba(210,153,34,0.1);
      border-left: 3px solid var(--accent-yellow);
      padding: 8px 12px;
      font-size: 12px;
      color: var(--accent-yellow);
    }

    /* --- Context Preview --- */
    .context-preview {
      background: var(--bg-panel); border: 1px solid var(--border-color);
      border-radius: 6px; padding: 12px; margin: 8px 0;
      max-height: 200px; overflow-y: auto; font-size: 12px;
      font-family: 'Monaco', 'Courier New', monospace;
    }
    .context-preview summary {
      cursor: pointer; font-weight: 600; color: var(--accent-teal);
      margin-bottom: 8px; user-select: none;
    }
    .context-preview summary:hover { color: var(--accent-orange); }

    /* --- Input --- */
    .input-area {
      padding: 12px; background: var(--bg-surface);
      border-top: 1px solid var(--border-color); display: flex; gap: 8px;
    }
    .input-area input {
      flex: 1; background: var(--bg-panel); border: 1px solid var(--border-color);
      color: var(--text-primary); padding: 8px 12px; border-radius: 4px; font-size: 13px;
    }
    .input-area input:focus { outline: none; border-color: var(--accent-teal); box-shadow: 0 0 0 3px rgba(47,192,194,0.1); }
    .input-area input::placeholder { color: #666; }
    .send-btn {
      padding: 8px 16px; background: var(--accent-orange); color: white;
      border: none; border-radius: 4px; cursor: pointer;
      font-weight: 500; font-size: 13px; transition: all 0.2s ease;
    }
    .send-btn:hover { background: #ff7a1a; }
    .send-btn:active { transform: scale(0.98); }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* --- Scrollbar --- */
    .scrollbar { scrollbar-width: thin; scrollbar-color: #444 transparent; }
    .scrollbar::-webkit-scrollbar { width: 6px; }
    .scrollbar::-webkit-scrollbar-track { background: transparent; }
    .scrollbar::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
    .scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }

    /* --- Tab Navigation --- */
    .tab-bar {
      display: flex;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      padding: 0 16px;
      gap: 0;
    }
    .tab-btn {
      background: none; border: none; border-bottom: 2px solid transparent;
      color: var(--text-muted); padding: 8px 16px; cursor: pointer;
      font-size: 12px; font-weight: 500; transition: all 0.2s ease;
    }
    .tab-btn:hover { color: var(--text-primary); }
    .tab-btn.active {
      color: var(--accent-orange);
      border-bottom-color: var(--accent-orange);
    }
    .page { display: none; }
    .page.active { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

    /* --- Info Pages (About / Get Started) --- */
    .info-page {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px;
    }
    .info-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 16px;
    }
    .info-card h2 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 6px;
      color: #E6E8EB;
    }
    .info-card .tagline {
      font-size: 14px;
      color: var(--accent-orange);
      font-weight: 600;
      margin-bottom: 16px;
    }
    .info-card h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-teal);
      margin-top: 16px;
      margin-bottom: 8px;
    }
    .info-card p {
      font-size: 13px;
      line-height: 1.65;
      color: var(--text-primary);
      margin-bottom: 10px;
    }
    .info-card ul {
      list-style: none;
      padding: 0;
      margin-bottom: 10px;
    }
    .info-card ul li {
      font-size: 13px;
      line-height: 1.65;
      color: var(--text-primary);
      padding: 4px 0 4px 18px;
      position: relative;
    }
    .info-card ul li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 11px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-teal);
    }
    .info-card .muted {
      color: #7E8794;
    }
    .info-card .highlight {
      color: var(--accent-orange);
      font-weight: 600;
    }

    /* --- Feature Grid --- */
    .feature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 12px 0;
    }
    .feature-item {
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
    }
    .feature-item .fi-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--accent-teal);
      margin-bottom: 4px;
    }
    .feature-item .fi-desc {
      font-size: 12px;
      color: #7E8794;
      line-height: 1.5;
    }

    /* --- Mode Cards (1 / 2 / 3 keys) --- */
    .mode-cards {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 12px 0;
    }
    .mode-card {
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px 16px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .mode-card.recommended {
      border-color: var(--accent-orange);
    }
    .mode-card .mc-keys {
      font-size: 20px;
      font-weight: 700;
      color: var(--accent-orange);
      min-width: 28px;
      text-align: center;
      line-height: 1;
      padding-top: 2px;
    }
    .mode-card .mc-body { flex: 1; }
    .mode-card .mc-title {
      font-size: 13px;
      font-weight: 600;
      color: #E6E8EB;
      margin-bottom: 2px;
    }
    .mode-card .mc-desc {
      font-size: 12px;
      color: #7E8794;
      line-height: 1.4;
    }
    .mode-card .mc-badge {
      font-size: 10px;
      font-weight: 600;
      color: var(--accent-orange);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* --- API Key Link Buttons --- */
    .api-key-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 12px 0;
    }
    .api-link-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 10px 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: left;
    }
    .api-link-btn:hover {
      border-color: var(--accent-orange);
      background: var(--hover-bg);
    }
    .api-link-btn .alb-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      color: #000;
      flex-shrink: 0;
    }
    .api-link-btn .alb-icon.openai { background: #ef4444; }
    .api-link-btn .alb-icon.qwen   { background: #3b82f6; }
    .api-link-btn .alb-icon.claude { background: #f97316; }
    .api-link-btn .alb-body { flex: 1; }
    .api-link-btn .alb-title {
      font-size: 13px;
      font-weight: 600;
      color: #E6E8EB;
    }
    .api-link-btn .alb-url {
      font-size: 11px;
      color: #7E8794;
    }
    .api-link-btn .alb-arrow {
      color: var(--text-muted);
      font-size: 14px;
    }
    .api-key-helper {
      font-size: 12px;
      color: var(--accent-orange);
      font-weight: 500;
      text-align: center;
      margin-top: 6px;
    }

    /* --- Steps List --- */
    .steps-list {
      counter-reset: step;
      list-style: none;
      padding: 0;
      margin: 12px 0;
    }
    .steps-list li {
      counter-increment: step;
      font-size: 13px;
      line-height: 1.65;
      color: var(--text-primary);
      padding: 8px 0 8px 36px;
      position: relative;
      border-bottom: 1px solid var(--border-color);
    }
    .steps-list li:last-child { border-bottom: none; }
    .steps-list li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 8px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--accent-orange);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .steps-list li strong {
      color: #E6E8EB;
    }

    /* --- Comparison Table --- */
    .compare-table {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin: 14px 0;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
    }
    .compare-col {
      padding: 14px;
    }
    .compare-col.left {
      background: var(--bg-panel);
      border-right: 1px solid var(--border-color);
    }
    .compare-col.right {
      background: rgba(255,106,0,0.04);
    }
    .compare-col .cc-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border-color);
    }
    .compare-col.left .cc-title { color: var(--text-muted); }
    .compare-col.right .cc-title { color: var(--accent-orange); }
    .compare-col ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .compare-col ul li {
      font-size: 12px;
      line-height: 1.6;
      padding: 3px 0 3px 14px;
      position: relative;
    }
    .compare-col.left ul li { color: #7E8794; }
    .compare-col.right ul li { color: var(--text-primary); }
    .compare-col.left ul li::before {
      content: '\\2013';
      position: absolute;
      left: 0;
      color: #555;
    }
    .compare-col.right ul li::before {
      content: '\\2713';
      position: absolute;
      left: 0;
      color: var(--accent-green);
      font-size: 11px;
    }

    /* --- Process Flow --- */
    .process-flow {
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 14px 16px;
      margin: 14px 0;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.7;
      color: #7E8794;
    }
    .process-flow .pf-step {
      padding: 2px 0;
    }
    .process-flow .pf-highlight {
      color: var(--accent-teal);
      font-weight: 600;
    }
    .process-flow .pf-result {
      color: var(--accent-green);
      font-weight: 700;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--border-color);
    }

    /* --- Trust List --- */
    .trust-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 12px 0;
    }
    .trust-item {
      font-size: 12px;
      color: var(--text-primary);
      padding: 8px 10px 8px 26px;
      position: relative;
      background: var(--bg-panel);
      border-radius: 4px;
      line-height: 1.4;
    }
    .trust-item::before {
      content: '\\2713';
      position: absolute;
      left: 8px;
      color: var(--accent-green);
      font-size: 11px;
      font-weight: 700;
    }

    /* --- One-liner callout --- */
    .callout {
      background: rgba(255,106,0,0.06);
      border-left: 3px solid var(--accent-orange);
      padding: 14px 18px;
      margin: 16px 0 8px 0;
      border-radius: 0 6px 6px 0;
    }
    .callout p {
      font-size: 13px;
      line-height: 1.6;
      color: #E6E8EB;
      font-weight: 500;
      margin: 0;
    }
    .callout .callout-sub {
      font-size: 11px;
      color: #7E8794;
      font-weight: 400;
      margin-top: 6px;
    }

    /* Security note */
    .security-note {
      background: rgba(47,192,194,0.08);
      border: 1px solid rgba(47,192,194,0.2);
      border-radius: 6px;
      padding: 12px 16px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--accent-teal);
      line-height: 1.5;
    }
  </style>
</head>
<body class="scrollbar" data-mode="${currentMode}">

  <!-- Header -->
  <div class="header">
    <img src="${logoUri}" class="logo-image" alt="TriForge AI logo" />
    <h1>TriForge AI</h1>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <span class="provider-dot" title="OpenAI"><span class="dot" id="dotOpenai"></span> OpenAI</span>
    <span class="provider-dot" title="Qwen"><span class="dot" id="dotQwen"></span> Qwen</span>
    <span class="provider-dot" title="Claude"><span class="dot" id="dotClaude"></span> Claude</span>
    <span class="mode-badge none" id="modeBadge">No Keys</span>
    <button class="mode-toggle" id="modeToggle" onclick="toggleMode()" title="Switch between Guided and Professional mode">Guided</button>
  </div>

  <!-- Loading Bar -->
  <div class="loading-bar" id="loadingBar">
    <div class="spinner"></div>
    <span class="loading-text" id="loadingText">Processing...</span>
    <button class="cancel-btn" onclick="cancelRequest()">Cancel</button>
  </div>

  <!-- File Status Panel (consensus mode) -->
  <div class="file-status-panel scrollbar" id="fileStatusPanel">
    <h4>File Status</h4>
    <div id="fileStatusList"></div>
  </div>

  <!-- Debate Log (professional mode) -->
  <div class="debate-log scrollbar" id="debateLog"></div>

  <!-- Tab Navigation -->
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="chat" onclick="switchTab('chat')">Chat</button>
    <button class="tab-btn" data-tab="about" onclick="switchTab('about')">About</button>
    <button class="tab-btn" data-tab="getstarted" onclick="switchTab('getstarted')">Get Started</button>
  </div>

  <!-- ═══ PAGE: Chat ═══ -->
  <div class="page active" id="page-chat">

    <!-- Action Buttons (Guided mode only) -->
    <div class="action-buttons" id="actionButtons">
      <button class="action-btn primary" onclick="triggerAction('audit')">Audit Project</button>
      <button class="action-btn" onclick="triggerAction('functionality')">Check Functionality</button>
      <button class="action-btn" onclick="triggerAction('missing')">Find Gaps</button>
      <button class="action-btn" onclick="triggerAction('security')">Harden Security</button>
      <button class="action-btn" onclick="triggerAction('plan')">Full Plan</button>
      <button class="action-btn" onclick="triggerAction('feature')">Build Feature</button>
      <button class="action-btn" onclick="showRunCommandPrompt()">Run Command</button>
      <button class="action-btn" onclick="showSearchPrompt()">Search Repo</button>
      <button class="action-btn" onclick="startDebugPrompt()">Start Debug</button>
      <button class="action-btn secondary" onclick="showContextPreview()">Context Preview</button>
    </div>

    <!-- Main Chat Area -->
    <div class="main-container">
      <div class="messages-container scrollbar" id="messagesContainer">

        <!-- Welcome message -->
        <div class="message ai">
          <strong>TriForge AI</strong> — Three AIs. One solid build.<br><br>
          Your AI think tank is ready. Three models debate, refine, and agree on every file before anything touches your project. Add your API keys below to get started.
        </div>

        <!-- Onboarding -->
        <div class="onboarding" id="onboarding">
          <h3>Connect Your AI Providers</h3>
          <p>Keys are stored securely in your OS keychain. They are never sent anywhere except to the provider's own API.</p>
          <div class="key-row">
            <label>OpenAI</label>
            <input type="password" id="keyOpenai" placeholder="sk-..." />
            <button onclick="saveKey('openai')">Save</button>
            <span class="status-text missing" id="statusOpenai">missing</span>
          </div>
          <div class="key-row">
            <label>Qwen</label>
            <input type="password" id="keyQwen" placeholder="sk-..." />
            <button onclick="saveKey('qwen')">Save</button>
            <span class="status-text missing" id="statusQwen">missing</span>
          </div>
          <div class="key-row">
            <label>Claude</label>
            <input type="password" id="keyClaude" placeholder="sk-ant-..." />
            <button onclick="saveKey('claude')">Save</button>
            <span class="status-text missing" id="statusClaude">missing</span>
          </div>
        </div>

        <details class="context-preview" id="contextPreview" style="display:none;">
          <summary>Project Context Preview</summary>
          <div id="contextContent"></div>
        </details>

        <!-- Patch Preview (injected dynamically) -->
        <div class="patch-preview" id="patchPreview"></div>
      </div>

      <!-- Input Area -->
      <div class="input-area">
        <input type="text" id="messageInput" placeholder="Describe what you need..." onkeypress="handleKeyPress(event)" />
        <button class="send-btn" id="sendBtn" onclick="sendMessage()">Send</button>
      </div>
    </div>
  </div>

  <!-- ═══ PAGE: About ═══ -->
  <div class="page" id="page-about">
    <div class="info-page scrollbar">

      <!-- Hero -->
      <div class="info-card">
        <h2>A Think Tank Team for Coders</h2>
        <div class="tagline">Three AIs. One solid build.</div>
        <p>
          Think of it as having three senior engineers in the room.
          One proposes a solution. The others challenge it. They argue details,
          refine the approach, and refuse to sign off until it's solid.
        </p>
        <p>
          Only then do you see code.
        </p>
        <p class="muted">
          TriForge AI is a collaborative AI think tank for software development &mdash;
          where multiple AIs debate, refine, and agree before any code is written.
        </p>
      </div>

      <!-- How this is different -->
      <div class="info-card">
        <h3>How This Is Different</h3>
        <p>Most AI coding tools give you one voice, one perspective, and hope for the best. TriForge works the way real engineering teams do.</p>

        <div class="compare-table">
          <div class="compare-col left">
            <div class="cc-title">Normal AI Tools</div>
            <ul>
              <li>One voice</li>
              <li>One perspective</li>
              <li>Fast but risky</li>
              <li>"Here's some code, hope it works"</li>
            </ul>
          </div>
          <div class="compare-col right">
            <div class="cc-title">TriForge AI</div>
            <ul>
              <li>Multiple independent perspectives</li>
              <li>Built-in disagreement</li>
              <li>Structured debate</li>
              <li>Forced refinement</li>
              <li>Explicit agreement before action</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- What "interact" means -->
      <div class="info-card">
        <h3>Peer Review, Not Chat</h3>
        <p>The AIs don't just respond to you &mdash; they respond to <em>each other</em>. For each file:</p>

        <div class="process-flow">
          <div class="pf-step"><span class="pf-highlight">AI #1</span> writes the file</div>
          <div class="pf-step"><span class="pf-highlight">AI #2</span> critiques it</div>
          <div class="pf-step"><span class="pf-highlight">AI #3</span> challenges assumptions</div>
          <div class="pf-step"><span class="pf-highlight">AI #1</span> revises based on feedback</div>
          <div class="pf-step">Repeat until all three say:</div>
          <div class="pf-result">"Yes. This is acceptable."</div>
        </div>

        <p class="muted" style="font-size: 12px;">
          Every reviewer must approve the exact same version, verified by SHA-256 hash.
          That's not chat. That's peer review.
        </p>
      </div>

      <!-- Why trust it -->
      <div class="info-card">
        <h3>Why Coders Trust This</h3>
        <div class="trust-grid">
          <div class="trust-item">Shows its work</div>
          <div class="trust-item">Exposes disagreements</div>
          <div class="trust-item">Documents reasoning</div>
          <div class="trust-item">Doesn't hide uncertainty</div>
          <div class="trust-item">Doesn't overwrite your code</div>
          <div class="trust-item">Asks permission first</div>
        </div>
        <p class="muted" style="font-size: 12px; margin-top: 8px;">
          Every change goes through a diff preview. You approve or reject with one click.
          TriForge acts like a human teammate would &mdash; it asks before it acts.
        </p>
      </div>

      <!-- Same engine, different surface -->
      <div class="info-card">
        <h3>Same Engine. Different Surface.</h3>
        <div class="feature-grid">
          <div class="feature-item">
            <div class="fi-title">Beginners</div>
            <div class="fi-desc">The think tank explains reasoning, catches missing steps, prevents bad architecture. You learn <em>why</em> something is right.</div>
          </div>
          <div class="feature-item">
            <div class="fi-title">Professionals</div>
            <div class="fi-desc">The think tank audits decisions, stress-tests assumptions, reviews diffs like a senior peer. Saves time, reduces risk.</div>
          </div>
        </div>
        <p class="muted" style="font-size: 12px; margin-top: 8px;">
          Switch between Guided and Pro mode anytime using the toggle in the status bar.
        </p>
      </div>

      <!-- Callout -->
      <div class="callout">
        <p>TriForge AI is a collaborative AI think tank for software development &mdash; where multiple AIs debate, refine, and agree before any code is written.</p>
        <div class="callout-sub">Optimizes for correctness, trust, collaboration, and engineering discipline.</div>
      </div>

    </div>
  </div>

  <!-- ═══ PAGE: Get Started ═══ -->
  <div class="page" id="page-getstarted">
    <div class="info-page scrollbar">

      <div class="info-card">
        <h2>Get Started</h2>
        <p>Set up TriForge AI in four steps.</p>

        <ol class="steps-list">
          <li><strong>Install and open</strong> — Run <em>TriForge AI: Open Chat</em> from the command palette (Ctrl+Shift+P).</li>
          <li><strong>Add API keys</strong> — Paste your keys in the Chat tab's onboarding section, or use the buttons below to get them.</li>
          <li><strong>Choose your mode</strong> — Click the <em>Guided / Pro</em> toggle in the status bar. Guided is great for getting started. Switch to Pro when you want full debate detail.</li>
          <li><strong>Start building</strong> — Type a request or use a quick action. TriForge handles the rest.</li>
        </ol>
      </div>

      <div class="info-card">
        <h3>Get Your API Keys</h3>
        <p>Click a button below to open the provider's key page in your browser.</p>

        <div class="api-key-buttons">
          <button class="api-link-btn" onclick="openExternal('https://platform.openai.com/')">
            <div class="alb-icon openai">O</div>
            <div class="alb-body">
              <div class="alb-title">Get OpenAI API Key</div>
              <div class="alb-url">platform.openai.com</div>
            </div>
            <span class="alb-arrow">&#8599;</span>
          </button>
          <button class="api-link-btn" onclick="openExternal('https://dashscope.aliyuncs.com/apiKey')">
            <div class="alb-icon qwen">Q</div>
            <div class="alb-body">
              <div class="alb-title">Get Qwen API Key</div>
              <div class="alb-url">dashscope.aliyuncs.com</div>
            </div>
            <span class="alb-arrow">&#8599;</span>
          </button>
          <button class="api-link-btn" onclick="openExternal('https://console.anthropic.com/')">
            <div class="alb-icon claude">C</div>
            <div class="alb-body">
              <div class="alb-title">Get Claude API Key</div>
              <div class="alb-url">console.anthropic.com</div>
            </div>
            <span class="alb-arrow">&#8599;</span>
          </button>
        </div>
        <div class="api-key-helper">Add all three keys for full TriForge Consensus mode.</div>
      </div>

      <div class="info-card">
        <h3>Operating Modes</h3>
        <p>TriForge adapts automatically based on how many keys you provide.</p>

        <div class="mode-cards">
          <div class="mode-card">
            <div class="mc-keys">1</div>
            <div class="mc-body">
              <div class="mc-title">Single Model Chat</div>
              <div class="mc-desc">Direct conversation with one AI. Fast responses, no review step.</div>
            </div>
          </div>
          <div class="mode-card">
            <div class="mc-keys">2</div>
            <div class="mc-body">
              <div class="mc-title">Pair Review</div>
              <div class="mc-desc">One AI builds, the other reviews. You get two perspectives on every response.</div>
            </div>
          </div>
          <div class="mode-card recommended">
            <div class="mc-keys">3</div>
            <div class="mc-body">
              <div class="mc-title">Full Consensus</div>
              <div class="mc-desc">All three AIs debate each file. Iterates until unanimous agreement or max rounds.</div>
            </div>
            <div class="mc-badge">Recommended</div>
          </div>
        </div>
      </div>

      <div class="security-note">
        <strong>Security:</strong> API keys are stored using VS Code's built-in SecretStorage (your OS keychain).
        Keys are never written to settings files, never committed to your project, and never sent anywhere except
        to the provider's own API endpoint.
      </div>

    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentMode = '${currentMode}';
    let isRequestInProgress = false;
    let currentApprovalToken = null;

    // --- Request provider status on load ---
    vscode.postMessage({ command: 'getProviderStatus' });

    // --- Key Management ---
    function saveKey(provider) {
      var input = document.getElementById('key' + provider.charAt(0).toUpperCase() + provider.slice(1));
      var key = input.value.trim();
      if (!key) { return; }
      vscode.postMessage({ command: 'setApiKey', provider: provider, key: key });
      input.value = '';
    }

    // --- Mode Toggle ---
    function toggleMode() {
      currentMode = currentMode === 'guided' ? 'professional' : 'guided';
      document.body.dataset.mode = currentMode;
      updateModeToggleLabel();
      vscode.postMessage({ command: 'setMode', mode: currentMode });
    }

    function updateModeToggleLabel() {
      var btn = document.getElementById('modeToggle');
      btn.textContent = currentMode === 'guided' ? 'Guided' : 'Pro';
    }

    // --- Actions ---
    function triggerAction(action) {
      vscode.postMessage({ command: 'action', action: action });
    }

    function sendMessage() {
      var input = document.getElementById('messageInput');
      var text = input.value.trim();
      if (!text || isRequestInProgress) { return; }
      addMessage(text, 'user');
      vscode.postMessage({ command: 'sendMessage', text: text });
      input.value = '';
    }

    function handleKeyPress(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    }

    function cancelRequest() {
      vscode.postMessage({ command: 'cancelRequest' });
    }

    // --- Chat Display ---
    function addMessage(text, sender, provider) {
      sender = sender || 'ai';
      var container = document.getElementById('messagesContainer');
      var msg = document.createElement('div');
      msg.className = 'message ' + sender;
      if (provider && sender === 'ai') {
        msg.className += ' ' + provider;
        var tag = document.createElement('div');
        tag.className = 'provider-tag';
        tag.textContent = provider;
        msg.appendChild(tag);
      }
      var content = document.createElement('div');
      msg.appendChild(content);
      container.appendChild(msg);

      if (sender === 'ai' && text.length > 0) {
        var words = text.split(' ');
        var i = 0;
        function appendWord() {
          if (i < words.length) {
            content.textContent += (i > 0 ? ' ' : '') + words[i++];
            container.scrollTop = container.scrollHeight;
            setTimeout(appendWord, 18);
          }
        }
        appendWord();
      } else {
        content.textContent = text;
        container.scrollTop = container.scrollHeight;
      }
    }

    function addErrorMessage(text) {
      var container = document.getElementById('messagesContainer');
      var msg = document.createElement('div');
      msg.className = 'message error';
      msg.textContent = text;
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
    }

    function showContextPreview() {
      var preview = document.getElementById('contextPreview');
      preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
      vscode.postMessage({ command: 'requestContext' });
    }

    // --- Tools: run commands, search, debug ---
    function showRunCommandPrompt() {
      var cmd = prompt('Enter command to preview (TriForge will not run it automatically):', 'npm test');
      if (!cmd) return;
      var explanation = prompt('Explain what this command does (optional):', 'Run tests');
      var risk = prompt('Risk level (low|medium|high):', 'low');
      vscode.postMessage({ command: 'suggestCommand', command: cmd, explanation: explanation, risk: risk });
    }

    function runCommand(token) {
      if (!token) return;
      vscode.postMessage({ command: 'runCommand', token: token });
    }

    function showSearchPrompt() {
      var q = prompt('Search text in repository:');
      if (!q) return;
      vscode.postMessage({ command: 'searchRepo', query: q });
    }

    function startDebugPrompt() {
      var log = prompt('Paste error log or stack trace to start debugging (optional):');
      vscode.postMessage({ command: 'startDebugSession', errorLog: log });
    }

    // --- Loading State ---
    function setLoading(active, text) {
      isRequestInProgress = active;
      var bar = document.getElementById('loadingBar');
      var btn = document.getElementById('sendBtn');
      var input = document.getElementById('messageInput');
      bar.className = active ? 'loading-bar visible' : 'loading-bar';
      if (text) { document.getElementById('loadingText').textContent = text; }
      btn.disabled = active;
      input.disabled = active;
    }

    // --- File Status Panel ---
    function updateFileStatuses(statuses) {
      var panel = document.getElementById('fileStatusPanel');
      var list = document.getElementById('fileStatusList');
      if (!statuses || statuses.length === 0) {
        panel.className = 'file-status-panel';
        return;
      }
      panel.className = 'file-status-panel visible';

      var html = '';
      var statusIcons = {
        approved: { icon: '\\u2713', cls: 'approved' },
        reviewing: { icon: '\\u25CB', cls: 'reviewing' },
        drafting: { icon: '\\u270E', cls: 'drafting' },
        needs_changes: { icon: '\\u21BB', cls: 'reviewing' },
        disagreement: { icon: '\\u2717', cls: 'disagreement' },
        pending: { icon: '\\u00B7', cls: 'pending' }
      };

      for (var i = 0; i < statuses.length; i++) {
        var s = statuses[i];
        var info = statusIcons[s.status] || statusIcons.pending;
        html += '<div class="file-status-row">'
          + '<span class="file-status-icon ' + info.cls + '">' + info.icon + '</span>'
          + '<span class="file-status-name">' + escapeHtml(s.filePath) + '</span>'
          + '<span class="file-status-detail">' + escapeHtml(s.status) + (s.approvals > 0 ? ' (' + s.approvals + '/' + s.total + ')' : '') + '</span>'
          + '</div>';
      }
      list.innerHTML = html;
    }

    // --- Debate Log ---
    function addDebateEntry(provider, role, filePath, round, text) {
      var log = document.getElementById('debateLog');
      log.className = 'debate-log visible';
      var entry = document.createElement('div');
      entry.className = 'debate-entry';
      var badgeHtml = '';
      if (text.indexOf('REQUEST_CHANGES') !== -1) {
        badgeHtml = '<span class="verdict-badge changes">REQUEST_CHANGES</span>';
      } else if (text.indexOf('APPROVE') !== -1) {
        badgeHtml = '<span class="verdict-badge approve">APPROVE</span>';
      }
      entry.innerHTML = '<span class="de-provider ' + provider + '">' + escapeHtml(provider) + '</span>'
        + ' <span class="de-role">[' + escapeHtml(role) + ']</span>'
        + badgeHtml + ' '
        + escapeHtml(text);
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
      setActiveProvider(provider);
    }

    function setActiveProvider(provider) {
      ['openai', 'qwen', 'claude'].forEach(function(p) {
        var dot = document.getElementById('dot' + p.charAt(0).toUpperCase() + p.slice(1));
        if (dot) { dot.classList.remove('active'); }
      });
      if (provider) {
        var dot = document.getElementById('dot' + provider.charAt(0).toUpperCase() + provider.slice(1));
        if (dot) { dot.classList.add('active'); }
      }
    }

    function clearActiveDots() {
      ['openai', 'qwen', 'claude'].forEach(function(p) {
        var dot = document.getElementById('dot' + p.charAt(0).toUpperCase() + p.slice(1));
        if (dot) { dot.classList.remove('active'); }
      });
    }

    // --- Patch Preview ---
    function showPatchPreview(data) {
      var container = document.getElementById('patchPreview');
      var hasPatches = data.patches && data.patches.length > 0;
      var titleText = hasPatches
        ? 'Review Changes (' + data.patches.length + ' file' + (data.patches.length !== 1 ? 's' : '') + ')'
        : 'No Consensus Reached';
      var html = '<div class="patch-header">'
        + '<span class="patch-title">' + titleText + '</span>'
        + '<div class="patch-actions">'
        + (hasPatches ? '<button class="approve-btn" onclick="approvePatches()">Approve & Apply</button>' : '')
        + (hasPatches ? '<button class="reject-btn" onclick="rejectPatches()">Reject</button>' : '')
        + '<button class="export-btn" onclick="vscode.postMessage({command:\'exportDebate\'})">Export Debate</button>'
        + '</div></div>';

      if (data.hasDisagreements) {
        html += '<div class="disagreement-warning">Some files did not reach consensus.'
          + (data.disagreementReport ? '<br>' + escapeHtml(data.disagreementReport).substring(0, 400) : '')
          + '<div class="disagreement-actions">'
          + '<button onclick="vscode.postMessage({command:\'continueDebate\'})">&#8635; Continue Debate</button>'
          + '<button onclick="vscode.postMessage({command:\'acceptMajority\'})">&#10003; Accept Majority</button>'
          + '</div></div>';
      }

      for (var i = 0; i < data.patches.length; i++) {
        var p = data.patches[i];
        html += '<div class="patch-file">'
          + '<div class="patch-file-name">' + escapeHtml(p.relativePath)
          + '<span class="file-type ' + p.type + '">' + p.type.toUpperCase() + '</span></div>'
          + '<div class="patch-diff">' + formatDiff(p.diff) + '</div>'
          + '</div>';
      }

      html += '<div class="patch-summary">' + escapeHtml(data.summary) + '</div>';

      container.innerHTML = html;
      container.className = 'patch-preview visible';
      currentApprovalToken = data.token;

      var msgContainer = document.getElementById('messagesContainer');
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    function hidePatchPreview() {
      var container = document.getElementById('patchPreview');
      container.className = 'patch-preview';
      container.innerHTML = '';
      currentApprovalToken = null;
    }

    function approvePatches() {
      if (!currentApprovalToken) { return; }
      vscode.postMessage({ command: 'approvePatches', token: currentApprovalToken });
      hidePatchPreview();
    }

    function rejectPatches() {
      vscode.postMessage({ command: 'rejectPatches', token: currentApprovalToken || '' });
      hidePatchPreview();
    }

    function formatDiff(diff) {
      var lines = diff.split('\\n');
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        var line = escapeHtml(lines[i]);
        if (lines[i].startsWith('+ ') || lines[i].startsWith('+\\t')) {
          html += '<span class="diff-add">' + line + '</span>\\n';
        } else if (lines[i].startsWith('- ') || lines[i].startsWith('-\\t')) {
          html += '<span class="diff-remove">' + line + '</span>\\n';
        } else if (lines[i].startsWith('CREATE:') || lines[i].startsWith('DELETE:')) {
          html += '<span class="diff-add">' + line + '</span>\\n';
        } else {
          html += '<span class="diff-context">' + line + '</span>\\n';
        }
      }
      return html;
    }

    // --- Status Update ---
    function updateProviderStatus(providers, modeInfo) {
      for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        var dot = document.getElementById('dot' + p.name.charAt(0).toUpperCase() + p.name.slice(1));
        if (dot) { dot.className = p.connected ? 'dot connected' : 'dot'; }
        var status = document.getElementById('status' + p.name.charAt(0).toUpperCase() + p.name.slice(1));
        if (status) {
          status.textContent = p.connected ? 'connected' : 'missing';
          status.className = p.connected ? 'status-text connected' : 'status-text missing';
        }
      }

      var badge = document.getElementById('modeBadge');
      var labels = { none: 'No Keys', single: 'Single', pair: 'Pair Review', consensus: 'Consensus' };
      badge.textContent = labels[modeInfo.mode] || modeInfo.mode;
      badge.className = 'mode-badge ' + modeInfo.mode;

      var connectedCount = 0;
      for (var j = 0; j < providers.length; j++) {
        if (providers[j].connected) { connectedCount++; }
      }
      var onboarding = document.getElementById('onboarding');
      if (onboarding) {
        onboarding.style.display = connectedCount === 3 ? 'none' : 'block';
      }
    }

    // --- Utility ---
    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    // --- Tab Navigation ---
    function switchTab(tabName) {
      // Update tab buttons
      var tabs = document.querySelectorAll('.tab-btn');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].className = tabs[i].getAttribute('data-tab') === tabName ? 'tab-btn active' : 'tab-btn';
      }
      // Update page visibility
      var pages = document.querySelectorAll('.page');
      for (var j = 0; j < pages.length; j++) {
        pages[j].className = pages[j].id === ('page-' + tabName) ? 'page active' : 'page';
      }
    }

    // --- Open External URL ---
    function openExternal(url) {
      vscode.postMessage({ command: 'openExternal', url: url });
    }

    // --- Listen for messages from extension ---
    window.addEventListener('message', function(event) {
      var message = event.data;
      switch (message.command) {
        case 'addMessage':
          addMessage(message.text, 'ai', message.provider);
          break;

        case 'contextPreview':
          document.getElementById('contextContent').textContent = message.preview || '';
          document.getElementById('contextPreview').style.display = 'block';
          break;

        case 'insertPrompt':
          var input = document.getElementById('messageInput');
          if (input) { input.value = message.prompt || ''; input.focus(); }
          break;

        case 'providerStatus':
          updateProviderStatus(message.providers, message.mode);
          break;

        case 'modeChanged':
          currentMode = message.mode;
          document.body.dataset.mode = message.mode;
          updateModeToggleLabel();
          break;

        case 'requestStarted':
          setLoading(true, 'Processing (' + message.mode + ' mode)...');
          document.getElementById('debateLog').innerHTML = '';
          document.getElementById('debateLog').className = 'debate-log';
          hidePatchPreview();
          break;

        case 'requestComplete':
          setLoading(false);
          clearActiveDots();
          document.getElementById('fileStatusPanel').className = 'file-status-panel';
          break;

        case 'requestError':
          addErrorMessage((message.provider ? '[' + message.provider + '] ' : '') + message.error);
          break;

        case 'debateProgress':
          setLoading(true, message.message);
          if (message.fileStatuses) {
            updateFileStatuses(message.fileStatuses);
          }
          break;

        case 'debateLog':
          addDebateEntry(message.provider, message.role, message.filePath, message.round, message.text);
          break;

        case 'patchPreview':
          showPatchPreview(message);
          break;

        case 'patchResult':
          if (message.rejected) {
            addMessage('Changes rejected. No files modified.', 'system');
          } else {
            addMessage('Applied ' + message.applied.length + ' file(s): ' + message.applied.join(', '), 'system');
          }
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
