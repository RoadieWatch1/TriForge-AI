import * as vscode from 'vscode';
import * as path from 'path';
import {
  buildContextPreview, scanWorkspace, readSafeFile,
  buildGitContext, getGitDiff, getGitStatus, getGitBranch, getRecentCommits,
  ProviderManager, TriForgeOrchestrator, IntentEngine, ActionPlanner,
  DEFAULT_POLICY, ProviderError,
  ProviderName, OperatingMode, FileStatusInfo, SessionRecord, IntentPlan,
  ActionLogEntry, ActionStep, PolicyConfig, TaskResult, DebateProgress, FileChange,
} from '@triforge/engine';
import { ActionRunner } from '../core/actionRunner';
import { createPatch, modifyPatch, deletePatch, createApprovalRequest, applyPatches, ChangePatch } from '../core/patch';
import { previewCommand, executePreview, getPreview, cancelPreview } from '../core/commands';
import { searchTextInWorkspace, openFileAt } from '../core/search';
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

  // Conversation memory & session history
  private _conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private _sessionMessages: SessionRecord['messages'] = [];
  private _currentSessionId: string = this._newSessionId();

  // Think Tank OS — action log + action steps
  private _actionLog: ActionLogEntry[] = [];
  private _actionLogCounter = 0;
  private _pendingActionSteps: ActionStep[] = [];

  private _newSessionId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  private _getCurrentPolicy(): PolicyConfig {
    const cfg = vscode.workspace.getConfiguration('triforgeAi');
    return {
      ...DEFAULT_POLICY,
      riskTolerance: cfg.get<'low' | 'medium' | 'high'>('riskTolerance') || DEFAULT_POLICY.riskTolerance,
      autoApprove: cfg.get<boolean>('autoApprove') ?? DEFAULT_POLICY.autoApprove,
    };
  }

  private _logAction(
    type: ActionLogEntry['type'],
    description: string,
    status: ActionLogEntry['status'],
    providers?: ProviderName[]
  ): void {
    this._actionLog.unshift({
      id: (++this._actionLogCounter).toString(),
      timestamp: Date.now(),
      type,
      description,
      status,
      providers,
    });
    if (this._actionLog.length > 100) { this._actionLog.pop(); }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    providerManager: ProviderManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._providerManager = providerManager;

    this._setWebviewMessageListener();

    this._providerManager.onDidChangeStatus(() => {
      this.refreshProviderStatus();
    });

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

  private static readonly _validProviders: ProviderName[] = ['openai', 'gemini', 'claude'];
  private static _isValidProvider(v: unknown): v is ProviderName {
    return typeof v === 'string' && TriForgeChatPanel._validProviders.includes(v as ProviderName);
  }

  private _setWebviewMessageListener() {
    this._panel.webview.onDidReceiveMessage(
      async (message: any) => {
        switch (message.command) {
          case 'log':
            console.log(message.text);
            break;

          case 'action':
            await this._handleAction(message.action);
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
            const name = message.provider;
            const key = message.key as string;
            console.log(`[TriForge] setApiKey received for provider: ${name}`);
            if (TriForgeChatPanel._isValidProvider(name) && key) {
              try {
                await this._providerManager.setKey(name, key);
                console.log(`[TriForge] Key stored for ${name}`);
                await this.refreshProviderStatus();
                console.log(`[TriForge] Status refreshed after key save`);
                const label = name.charAt(0).toUpperCase() + name.slice(1);
                vscode.window.showInformationMessage(`TriForge AI: ${label} key saved.`);
                this._post({ command: 'addMessage', text: `${label} key saved securely.` });
              } catch (err: any) {
                console.error(`[TriForge] Failed to save key for ${name}:`, err);
                this._post({ command: 'addMessage', text: `Error saving ${name} key: ${err?.message ?? err}` });
              }
            }
            break;
          }

          case 'removeApiKey': {
            const providerName = message.provider;
            if (TriForgeChatPanel._isValidProvider(providerName)) {
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
            if (!ws) {
              this._post({ command: 'requestError', error: 'No workspace folder open.' });
              break;
            }
            try {
              const absPath = path.resolve(ws, file);
              // read original full file to extract segment
              const original = readSafeFile(absPath) || '';
              const originalLines = original.split('\n');
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

          case 'newChat':
            this._conversationHistory = [];
            this._sessionMessages = [];
            this._currentSessionId = this._newSessionId();
            this._lastTaskResult = null;
            this._post({ command: 'clearMessages' });
            break;

          case 'insertToEditor': {
            const code = message.code as string;
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              vscode.window.showWarningMessage('TriForge AI: No active editor to insert code into.');
              break;
            }
            await editor.edit(b => {
              const sel = editor.selection;
              if (sel.isEmpty) {
                b.insert(sel.active, code);
              } else {
                b.replace(sel, code);
              }
            });
            this._logAction('insert', `Inserted ${code.split('\n').length} lines into ${editor.document.fileName.split(/[\\/]/).pop() || 'editor'}`, 'completed');
            break;
          }

          case 'getSessionList': {
            const sessions = this._providerManager.loadSessions();
            this._post({ command: 'sessionList', sessions: sessions.map(s => ({ id: s.id, title: s.title, date: s.date })) });
            break;
          }

          case 'loadSession': {
            const sessions = this._providerManager.loadSessions();
            const session = sessions.find(s => s.id === (message.id as string));
            if (session) { this._post({ command: 'sessionLoaded', session }); }
            break;
          }

          case 'deleteSession': {
            let sessions = this._providerManager.loadSessions().filter(s => s.id !== (message.id as string));
            this._providerManager.saveSessions(sessions);
            this._post({ command: 'sessionList', sessions: sessions.map(s => ({ id: s.id, title: s.title, date: s.date })) });
            break;
          }

          // --- Think Tank OS ---

          case 'decomposeGoal': {
            const goal = message.goal as string;
            const providers = await this._providerManager.getActiveProviders();
            if (providers.length === 0) {
              this._post({ command: 'intentPlanError', error: 'No API keys configured. Add at least one key in the Chat tab to use Think Tank.' });
              break;
            }
            this._post({ command: 'intentPlanStart' });
            this._abortController = new AbortController();
            try {
              const engine = new IntentEngine(providers);
              const plan: IntentPlan = await engine.decompose(goal, this._abortController.signal);
              this._post({ command: 'intentPlanResult', plan, goal });

              // Build structured action steps from the intent plan
              const planner = new ActionPlanner(this._getCurrentPolicy());
              this._pendingActionSteps = planner.plan(plan);
              this._post({ command: 'actionPlan', steps: this._pendingActionSteps, goal });

              this._logAction('think', goal.substring(0, 80), 'completed', providers.map(p => p.name));
            } catch (err: any) {
              this._post({ command: 'intentPlanError', error: err.message || 'Think Tank analysis failed.' });
              this._logAction('think', goal.substring(0, 80), 'error');
            } finally {
              this._abortController = null;
            }
            break;
          }

          case 'getActionLog':
            this._post({ command: 'actionLog', entries: this._actionLog });
            break;

          case 'setPermissions': {
            const riskTolerance = message.riskTolerance as 'low' | 'medium' | 'high';
            const autoApprove = message.autoApprove as boolean;
            const config = vscode.workspace.getConfiguration('triforgeAi');
            await config.update('riskTolerance', riskTolerance, vscode.ConfigurationTarget.Global);
            await config.update('autoApprove', autoApprove, vscode.ConfigurationTarget.Global);
            this._post({ command: 'permissionsUpdated', riskTolerance, autoApprove });
            break;
          }

          // --- Action Steps (Think Tank OS) ---

          case 'executeActionStep': {
            const stepId = message.stepId as string;
            const step = this._pendingActionSteps.find(s => s.id === stepId);
            if (!step) {
              this._post({ command: 'requestError', error: `Action step not found: ${stepId}` });
              break;
            }
            step.status = 'running';
            this._post({ command: 'actionStepUpdate', stepId: step.id, status: 'running', output: 'Running…' });

            const ws = this._getWorkspacePath();
            const runner = new ActionRunner(
              ws,
              this._getCurrentPolicy(),
              (token, cmd, cwd, risk) => this._post({ command: 'commandPreview', token, cmd, cwd, explanation: cmd, risk })
            );

            this._abortController = new AbortController();
            try {
              const result = await runner.run(step, this._abortController.signal);
              step.status = result.success ? 'done' : 'error';
              this._post({
                command: 'actionStepUpdate',
                stepId: step.id,
                status: step.status,
                output: result.output,
                artifacts: result.artifacts,
              });
              this._logAction('think', step.description.substring(0, 80), result.success ? 'completed' : 'error');
            } catch (err: any) {
              step.status = 'error';
              this._post({ command: 'actionStepUpdate', stepId: step.id, status: 'error', output: err?.message ?? String(err) });
            } finally {
              this._abortController = null;
            }
            break;
          }

          case 'skipActionStep': {
            const stepId = message.stepId as string;
            const step = this._pendingActionSteps.find(s => s.id === stepId);
            if (step) {
              step.status = 'skipped';
              this._post({ command: 'actionStepUpdate', stepId: step.id, status: 'skipped', output: 'Skipped by user.' });
            }
            break;
          }

          case 'cancelActionStep': {
            if (this._abortController) {
              this._abortController.abort();
            }
            break;
          }

          // --- Decision Log ---

          case 'getDecisionLog': {
            const log = this._providerManager.getDecisionLog();
            const n = (message.limit as number) || 20;
            this._post({ command: 'decisionLog', entries: log.getRecent(n) });
            break;
          }

          // --- Memory / Conventions ---

          case 'getConventions': {
            const mem = this._providerManager.getMemory();
            this._post({ command: 'conventions', conventions: mem.getConventions() });
            break;
          }

          case 'addConvention': {
            const mem = this._providerManager.getMemory();
            mem.addConvention(message.key as string, message.value as string, 'manual');
            this._post({ command: 'conventions', conventions: mem.getConventions() });
            break;
          }

          case 'removeConvention': {
            const mem = this._providerManager.getMemory();
            mem.removeConvention(message.key as string);
            this._post({ command: 'conventions', conventions: mem.getConventions() });
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
    // Cancel any in-flight request before starting a new one
    if (this._abortController) {
      this._abortController.abort();
    }

    const modeInfo = await this._providerManager.detectMode();

    if (modeInfo.mode === 'none') {
      this._post({ command: 'requestError', error: 'No API keys configured. Add at least one key above.' });
      return;
    }

    this._abortController = new AbortController();
    this._post({ command: 'requestStarted', mode: modeInfo.mode });

    // Append user turn to conversation memory
    this._conversationHistory.push({ role: 'user', content: text });
    this._sessionMessages.push({ role: 'user', content: text });

    let _logStatus: ActionLogEntry['status'] = 'completed';
    try {
      const context = await this._buildContext();

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
      if (err.name === 'AbortError' || err.message === 'Request cancelled.') {
        _logStatus = 'cancelled';
      } else {
        _logStatus = 'error';
        const errorMsg = err instanceof ProviderError
          ? `[${err.provider}] ${err.message}`
          : err.message || 'An unexpected error occurred.';
        this._post({
          command: 'requestError',
          error: errorMsg,
          provider: err instanceof ProviderError ? err.provider : undefined,
        });
      }
    } finally {
      this._abortController = null;
      this._post({ command: 'requestComplete' });
      this._saveCurrentSession();
      const logType = modeInfo.mode === 'consensus' ? 'consensus' : 'chat';
      const logProviders = await this._providerManager.getActiveProviders();
      this._logAction(logType, text.substring(0, 80), _logStatus, logProviders.map(p => p.name));
    }
  }

  private async _handleSingleMode(_text: string, context: string): Promise<void> {
    const providers = await this._providerManager.getActiveProviders();
    const provider = providers[0];
    this._post({ command: 'messageStreamStart', provider: provider.name });
    const fullText = await provider.generateResponseStream(
      this._conversationHistory.slice(-20),
      context,
      (chunk) => this._post({ command: 'messageChunk', provider: provider.name, chunk }),
      this._abortController!.signal
    );
    this._post({ command: 'messageStreamEnd', provider: provider.name, fullText });
    this._conversationHistory.push({ role: 'assistant', content: fullText });
    this._sessionMessages.push({ role: 'assistant', content: fullText, provider: provider.name });
  }

  private async _handlePairMode(_text: string, context: string): Promise<void> {
    const providers = await this._providerManager.getActiveProviders();
    const [builder, reviewer] = providers;

    // Builder streams
    this._post({ command: 'messageStreamStart', provider: builder.name });
    const builderText = await builder.generateResponseStream(
      this._conversationHistory.slice(-20),
      context,
      (chunk) => this._post({ command: 'messageChunk', provider: builder.name, chunk }),
      this._abortController!.signal
    );
    this._post({ command: 'messageStreamEnd', provider: builder.name, fullText: builderText });
    this._conversationHistory.push({ role: 'assistant', content: builderText });
    this._sessionMessages.push({ role: 'assistant', content: builderText, provider: builder.name });

    // Reviewer streams with full context of what builder said
    const reviewHistory = [
      ...this._conversationHistory.slice(-20),
      { role: 'user' as const, content: 'Review the above response and give your own perspective.' },
    ];
    this._post({ command: 'messageStreamStart', provider: reviewer.name });
    const reviewerText = await reviewer.generateResponseStream(
      reviewHistory,
      context,
      (chunk) => this._post({ command: 'messageChunk', provider: reviewer.name, chunk }),
      this._abortController!.signal
    );
    this._post({ command: 'messageStreamEnd', provider: reviewer.name, fullText: reviewerText });
    this._conversationHistory.push({ role: 'assistant', content: reviewerText });
    this._sessionMessages.push({ role: 'assistant', content: reviewerText, provider: reviewer.name });
  }

  private async _handleConsensusMode(text: string, context: string): Promise<void> {
    const providers = await this._providerManager.getActiveProviders();
    const settings = vscode.workspace.getConfiguration('triforgeAi');
    const maxIterations = settings.get<number>('maxIterations') || 4;

    // Inject recent conversation history as context prefix (keep internal debate calls lean)
    const recentHistory = this._conversationHistory.slice(-10);
    const historyCtx = recentHistory.length > 1 // >1 because user turn was just appended
      ? 'Prior conversation:\n' +
        recentHistory.slice(0, -1)
          .map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 500)}`)
          .join('\n') +
        '\n\n---\n\n'
      : '';
    const enrichedContext = historyCtx + context;

    const orchestrator = new TriForgeOrchestrator(providers, {
      maxIterations,
      workspacePath: this._getWorkspacePath(),
      signal: this._abortController!.signal,
      onProgress: (progress) => this._handleProgress(progress),
    });

    const result = await orchestrator.orchestrate(text, enrichedContext);
    this._lastTaskResult = result;
    this._lastUserRequest = text;
    this._lastContext = context;

    if (result.approvedFiles.length > 0) {
      await this._presentPatches(result);
    } else if (result.hasDisagreements) {
      this._post({ command: 'addMessage', text: `No files reached consensus.\n\n${result.summary}` });
    } else {
      this._post({ command: 'addMessage', text: result.summary });
    }

    // Always show debate summary (visible in both guided + professional mode)
    this._post({
      command: 'debateSummary',
      filesDebated: result.fileDebates.length,
      roundsMax: result.fileDebates.reduce((max, d) => Math.max(max, d.currentRound), 0),
      providers: providers.map(p => p.name) as ProviderName[],
      results: result.fileDebates.map(d => ({
        file: d.relativePath,
        status: d.status === 'approved' ? 'approved' : 'disagreement',
        rounds: d.currentRound,
      })),
    });
  }

  private _saveCurrentSession(): void {
    if (this._sessionMessages.length === 0) { return; }
    const firstUser = this._sessionMessages.find(m => m.role === 'user');
    const title = firstUser ? firstUser.content.substring(0, 60) : 'Session';
    const record: SessionRecord = {
      id: this._currentSessionId,
      title,
      date: Date.now(),
      messages: this._sessionMessages.map(m => ({
        ...m,
        content: m.content.substring(0, 8000),
      })),
    };
    let sessions = this._providerManager.loadSessions();
    const idx = sessions.findIndex(s => s.id === record.id);
    if (idx >= 0) {
      sessions[idx] = record;
    } else {
      sessions.unshift(record);
    }
    if (sessions.length > 20) { sessions = sessions.slice(0, 20); }
    this._providerManager.saveSessions(sessions);
  }

  // ─── Consensus Progress ────────────────────────────────────────────

  private _handleProgress(progress: DebateProgress): void {
    // Convert file statuses to protocol format
    const fileStatuses: FileStatusInfo[] = (progress.fileStatuses || []).map(f => ({
      filePath: f.filePath,
      status: f.status,
      approvals: f.approvals,
      total: f.total,
      round: progress.round ?? 0,
      maxRounds: progress.maxRounds ?? 0,
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
    const patchCount = this._pendingPatches.length;
    try {
      const applied = await applyPatches(this._pendingPatches, workspacePath, token);
      this._post({ command: 'patchResult', applied, rejected: false });
      this._post({
        command: 'addMessage',
        text: `Applied ${applied.length} file(s): ${applied.join(', ')}`,
      });
      this._logAction('patch', `Applied ${applied.length} of ${patchCount} file(s): ${applied.slice(0, 3).join(', ')}`, 'completed');
    } catch (err: any) {
      this._post({ command: 'requestError', error: `Failed to apply patches: ${err.message}` });
      this._logAction('patch', `Failed to apply ${patchCount} file(s)`, 'error');
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

    const gitCtx = await buildGitContext(workspacePath);
    if (gitCtx) { parts.push(gitCtx); }

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

  private async _handleAction(action: string): Promise<void> {
    const ws = this._getWorkspacePath();

    // ── Git-aware actions: read diff then pre-fill the prompt ──────────
    if (action === 'smart-commit') {
      const [diff, status, branch] = await Promise.all([getGitDiff(ws), getGitStatus(ws), getGitBranch(ws)]);
      if (!diff && !status) {
        this._post({ command: 'addMessage', text: 'No git changes detected. Make or stage some changes first.' });
        return;
      }
      const prompt =
        `Generate a conventional commit message for these changes.\n\n` +
        `Branch: ${branch}\n\nFiles changed:\n${status}\n\nDiff:\n${diff.substring(0, 3000)}\n\n` +
        `Format: <type>(<scope>): <description>\n` +
        `Types: feat, fix, docs, style, refactor, test, chore\n` +
        `Keep it under 72 characters. Output ONLY the commit message, no explanation.`;
      this._post({ command: 'insertPrompt', prompt });
      return;
    }

    if (action === 'pr-description') {
      const [diff, branch, commits] = await Promise.all([getGitDiff(ws), getGitBranch(ws), getRecentCommits(ws, 5)]);
      const prompt =
        `Generate a GitHub Pull Request description for these changes.\n\n` +
        `Branch: ${branch}\nRecent commits:\n${commits || '(none)'}\n\nDiff:\n${diff.substring(0, 3000)}\n\n` +
        `Format:\n## Summary\n(bullet points)\n\n## Test Plan\n(checklist)\n\nBe concise and professional.`;
      this._post({ command: 'insertPrompt', prompt });
      return;
    }

    // ── Standard prompts ──────────────────────────────────────────────
    const actions: Record<string, string> = {
      // ANALYZE
      audit:         'Audit my project for bugs, code quality issues, and improvements. Give me a prioritized list with specific file references.',
      functionality: 'Check the functionality and test coverage of my project. What is working, what is broken, and what needs tests?',
      missing:       'Find missing features, edge cases, error handling gaps, and incomplete flows in my project.',
      security:      'Audit my project for security vulnerabilities (OWASP Top 10, auth flaws, injection, secrets exposure). Prioritize by severity.',
      // BUILD
      plan:     'Generate a full plan for my app: architecture, database schema, API design, folder structure, and step-by-step implementation order.',
      feature:  'Help me build a new feature end-to-end: backend logic, API endpoint, frontend component, and tests. Ask me what the feature is.',
      tests:    'Write comprehensive tests for the key files in my project. Cover happy paths, edge cases, and error states. Use the appropriate test framework.',
      document: 'Generate documentation for my project: write or update README.md with setup instructions, usage examples, architecture overview, and API reference for any public functions.',
      // LAUNCH
      supabase:   'Set up Supabase for my project. Step-by-step: (1) create a project at https://supabase.com/dashboard, (2) design the database schema with RLS policies, (3) configure auth, (4) set up storage buckets, (5) add environment variables. Show the exact SQL and config.',
      vercel:     'Deploy this project to Vercel. Step-by-step: (1) connect my repo at https://vercel.com/new, (2) set environment variables, (3) configure build settings, (4) set up a custom domain, (5) enable preview deployments. Flag any build issues first.',
      stripe:     'Integrate Stripe payments. Step-by-step: (1) create products at https://dashboard.stripe.com/products, (2) implement Checkout, (3) handle webhooks, (4) add billing portal, (5) test with test keys. Show the exact code.',
      revenuecat: 'Set up RevenueCat. Step-by-step: (1) create a project at https://app.revenuecat.com, (2) configure products and entitlements, (3) integrate the SDK, (4) implement purchase and restore flows, (5) set up webhooks. Show the exact code.',
      ios:        'Prepare for iOS App Store launch. Checklist: (1) Xcode setup + bundle ID at https://developer.apple.com, (2) certificates and provisioning profiles, (3) App Store Connect at https://appstoreconnect.apple.com, (4) metadata and screenshots, (5) review guidelines, (6) TestFlight, (7) submission. Flag any issues in my code.',
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


  // ─── Webview HTML ──────────────────────────────────────────────────

  private _getWebviewContent(webview: vscode.Webview): string {
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'TriForgeAI_logo.png'));
    const currentMode = vscode.workspace.getConfiguration('triforgeAi').get<string>('mode') || 'guided';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${webview.cspSource} data:;">
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
    .key-row .remove-btn { background: none; border: 1px solid var(--accent-red); color: var(--accent-red); }
    .key-row .update-btn { background: none; border: 1px solid var(--accent-teal); color: var(--accent-teal); }
    .key-row .status-text { font-size: 11px; width: 70px; text-align: center; }
    .key-row .status-text.connected { color: var(--accent-green); }
    .key-row .status-text.missing { color: var(--text-muted); }
    .update-input-row {
      display: flex; align-items: center; gap: 8px; margin-top: 6px; padding-left: 68px;
    }

    /* --- Action Buttons --- */
    .action-buttons {
      display: flex; flex-direction: column; gap: 5px; padding: 8px 12px;
      background: var(--bg-surface); border-bottom: 1px solid var(--border-color);
    }
    body[data-mode="professional"] .action-buttons { display: none; }
    .action-group { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .action-group-label {
      font-size: 9px; font-weight: 700; letter-spacing: 0.8px; color: var(--text-muted);
      text-transform: uppercase; min-width: 50px; flex-shrink: 0;
    }
    .action-btn {
      padding: 5px 11px; border: 1px solid var(--border-color);
      background: var(--bg-panel); color: var(--text-primary); border-radius: 4px;
      cursor: pointer; font-size: 11px; font-weight: 500;
      transition: all 0.2s ease; white-space: nowrap;
    }
    .action-btn:hover { background: var(--hover-bg); border-color: var(--accent-orange); color: var(--accent-orange); }
    .action-btn.primary { background: var(--accent-orange); color: white; border-color: var(--accent-orange); }
    .action-btn.primary:hover { background: #ff7a1a; }
    .action-btn.secondary { border-color: var(--accent-teal); color: var(--accent-teal); }
    .action-btn.secondary:hover { background: var(--hover-bg); color: #4fd9db; }
    .action-btn.launch { border-color: #a855f7; color: #a855f7; }
    .action-btn.launch:hover { background: rgba(168,85,247,0.1); color: #c084fc; border-color: #c084fc; }

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
    .message.ai.gemini { border-left-color: #4285f4; color: #4285f4; }
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

    /* --- Debate Log (Professional mode only — speech bubbles) --- */
    .debate-log {
      display: none;
      background: var(--bg-main);
      border-bottom: 1px solid var(--border-color);
      max-height: 240px;
      overflow-y: auto;
      padding: 8px 12px;
      flex-direction: column;
      gap: 4px;
    }
    body[data-mode="professional"] .debate-log.visible { display: flex; }
    .debate-round-sep {
      font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase; color: var(--text-muted);
      text-align: center; padding: 5px 0 3px 0;
      border-bottom: 1px solid var(--border-color); margin-bottom: 2px;
    }
    .debate-bubble {
      border-radius: 6px; padding: 6px 10px;
      border: 1px solid var(--border-color);
      background: var(--bg-surface); margin-bottom: 3px;
    }
    .debate-bubble.db-openai { border-left: 3px solid #ef4444; }
    .debate-bubble.db-gemini { border-left: 3px solid #4285f4; }
    .debate-bubble.db-claude { border-left: 3px solid #f97316; }
    .debate-bubble-header {
      display: flex; align-items: center; gap: 6px; margin-bottom: 3px;
    }
    .db-provider { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .db-role {
      font-size: 9px; color: var(--text-muted); background: var(--bg-panel);
      padding: 1px 5px; border-radius: 3px; text-transform: uppercase;
    }
    .debate-bubble-body { font-size: 11px; color: var(--text-primary); line-height: 1.4; }
    .verdict-badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; margin-left: auto; }
    .verdict-badge.approve { background: rgba(46,160,67,0.15); color: #3fb950; border: 1px solid rgba(46,160,67,0.3); }
    .verdict-badge.changes { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

    /* --- Provider name colors (reused across status bar, labels, bubbles) --- */
    .pn-openai { color: #ef4444; font-weight: 600; }
    .pn-gemini { color: #4285f4; font-weight: 600; }
    .pn-claude { color: #f97316; font-weight: 600; }

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
    .api-link-btn .alb-icon.gemini { background: #4285f4; }
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

    /* --- Message Fade-in --- */
    @keyframes msgFadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
    .message { animation: msgFadeIn 0.18s ease; }

    /* --- Markdown rendered content inside AI messages --- */
    .message.ai { white-space: normal; }
    .message.ai p { margin: 0 0 8px 0; font-size: 13px; line-height: 1.6; }
    .message.ai p:last-child { margin-bottom: 0; }
    .message.ai h1 { font-size: 16px; font-weight: 700; color: #E6E8EB; margin: 10px 0 5px 0; }
    .message.ai h2 { font-size: 14px; font-weight: 700; color: #E6E8EB; margin: 8px 0 4px 0; padding-bottom: 4px; border-bottom: 1px solid var(--border-color); }
    .message.ai h3 { font-size: 13px; font-weight: 600; color: var(--accent-teal); margin: 8px 0 3px 0; }
    .message.ai ul { padding-left: 18px; margin: 5px 0 8px 0; }
    .message.ai ol { padding-left: 18px; margin: 5px 0 8px 0; }
    .message.ai li { font-size: 13px; line-height: 1.6; margin: 2px 0; }
    .message.ai hr { border: none; border-top: 1px solid var(--border-color); margin: 10px 0; }
    .message.ai a { color: var(--accent-teal); text-decoration: underline; cursor: pointer; }
    .message.ai a:hover { color: var(--accent-orange); }
    .message.ai strong { color: #E6E8EB; font-weight: 600; }
    .message.ai em { font-style: italic; color: #ccc; }
    .message.ai table { border-collapse: collapse; margin: 8px 0; font-size: 12px; width: 100%; }
    .message.ai th { background: var(--bg-panel); padding: 6px 10px; border: 1px solid var(--border-color); font-weight: 600; text-align: left; color: var(--accent-teal); }
    .message.ai td { padding: 5px 10px; border: 1px solid var(--border-color); font-size: 12px; }
    .message.ai blockquote { border-left: 3px solid var(--accent-teal); padding: 4px 12px; margin: 6px 0; color: var(--text-muted); font-style: italic; }

    /* --- Code blocks --- */
    .code-wrapper { position: relative; margin: 8px 0; }
    .code-wrapper pre {
      background: #0d1117; border: 1px solid var(--border-color); border-radius: 6px;
      padding: 12px; overflow-x: auto; margin: 0;
    }
    .code-wrapper code {
      font-family: 'Menlo', 'Monaco', 'Cascadia Code', 'Courier New', monospace;
      font-size: 12px; line-height: 1.6; color: #e6edf3; white-space: pre;
    }
    .md-inline-code {
      background: rgba(110,118,129,0.15); border: 1px solid rgba(110,118,129,0.3);
      border-radius: 4px; padding: 1px 6px;
      font-family: 'Menlo', 'Monaco', 'Cascadia Code', 'Courier New', monospace;
      font-size: 11.5px; color: #e6edf3;
    }
    /* code block button group (copy + insert) */
    .code-btn-group {
      position: absolute; top: 7px; right: 7px;
      display: flex; gap: 4px;
      opacity: 0; transition: opacity 0.15s;
    }
    .code-wrapper:hover .code-btn-group { opacity: 1; }
    .copy-btn, .insert-btn {
      background: var(--bg-panel); border: 1px solid var(--border-color);
      color: var(--text-muted); padding: 2px 8px; border-radius: 3px;
      cursor: pointer; font-size: 10px; font-weight: 500;
    }
    .copy-btn:hover { color: var(--accent-teal); border-color: var(--accent-teal); }
    .insert-btn { border-color: var(--accent-teal); color: var(--accent-teal); }
    .insert-btn:hover { background: rgba(47,192,194,0.15); }

    /* --- Syntax highlighting (Dracula-inspired) --- */
    .hl-kw  { color: #ff79c6; }
    .hl-str { color: #f1fa8c; }
    .hl-cmt { color: #6272a4; font-style: italic; }
    .hl-num { color: #bd93f9; }
    .hl-dec { color: #ffb86c; }

    /* --- Debate summary (shown in both guided + professional mode) --- */
    .debate-summary-card {
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-left: 3px solid var(--accent-orange);
      border-radius: 6px; padding: 10px 12px;
      margin: 4px 0; align-self: flex-start;
      max-width: 90%; font-size: 12px;
    }
    .debate-summary-card summary {
      cursor: pointer; font-weight: 600;
      color: var(--accent-orange); user-select: none;
      list-style: none;
    }
    .debate-summary-card summary::-webkit-details-marker { display: none; }
    .ds-row { display: flex; gap: 8px; align-items: center; padding: 2px 0; font-size: 11px; margin-top: 6px; }
    .ds-file { font-family: monospace; flex: 1; color: var(--text-muted); }
    .ds-approved { color: #3fb950; }
    .ds-disagreement { color: #ef4444; }

    /* --- Session history tab --- */
    .session-item {
      background: var(--bg-panel); border: 1px solid var(--border-color);
      border-radius: 6px; padding: 10px 14px; margin-bottom: 8px;
      display: flex; align-items: flex-start; gap: 10px;
      cursor: pointer; transition: border-color 0.15s;
    }
    .session-item:hover { border-color: var(--accent-teal); }
    .session-body { flex: 1; min-width: 0; }
    .session-title {
      font-size: 12px; font-weight: 500; color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .session-date { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
    .session-del-btn {
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 14px; line-height: 1;
    }
    .session-del-btn:hover { color: #ef4444; background: rgba(239,68,68,0.1); }

    /* --- New Chat button --- */
    .new-chat-btn {
      background: none; border: 1px solid var(--border-color);
      color: var(--text-muted); padding: 6px 10px; border-radius: 6px;
      cursor: pointer; font-size: 11px; white-space: nowrap;
      transition: all 0.15s;
    }
    .new-chat-btn:hover { border-color: var(--accent-teal); color: var(--accent-teal); }

    /* ================================================================
       THINK TANK OS
       ================================================================ */

    /* --- Think Tank page layout --- */
    #page-think {
      display: none; flex-direction: column; height: 100%;
      background: var(--bg-main);
    }
    #page-think.active { display: flex; }
    .think-header {
      padding: 14px 16px; border-bottom: 1px solid var(--border-color);
      background: var(--bg-surface); flex-shrink: 0;
    }
    .think-title {
      font-size: 14px; font-weight: 700; color: var(--accent-orange); margin-bottom: 3px;
    }
    .think-subtitle { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
    .think-loading {
      display: none; align-items: center; gap: 8px; padding: 8px 16px;
      font-size: 12px; color: var(--accent-teal);
      background: var(--bg-surface); border-bottom: 1px solid var(--border-color); flex-shrink: 0;
    }
    .think-loading.visible { display: flex; }
    .think-plan-area {
      flex: 1; overflow-y: auto; padding: 12px; display: flex;
      flex-direction: column; gap: 10px;
    }
    .think-input-area {
      padding: 10px 12px; border-top: 1px solid var(--border-color);
      background: var(--bg-surface); display: flex; gap: 8px; flex-shrink: 0;
    }
    #thinkGoalInput {
      flex: 1; background: var(--bg-panel); border: 1px solid var(--border-color);
      color: var(--text-primary); border-radius: 6px; padding: 8px 10px;
      font-size: 13px; resize: none; font-family: inherit; line-height: 1.4;
    }
    #thinkGoalInput:focus { outline: none; border-color: var(--accent-orange); }
    #thinkAnalyzeBtn {
      background: var(--accent-orange); color: #fff; border: none; border-radius: 6px;
      padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 600;
      white-space: nowrap; align-self: flex-end;
    }
    #thinkAnalyzeBtn:hover { filter: brightness(1.1); }
    #thinkAnalyzeBtn:disabled { opacity: 0.5; cursor: default; filter: none; }

    /* --- Plan cards --- */
    .plan-card {
      background: var(--bg-surface); border: 1px solid var(--border-color);
      border-radius: 8px; overflow: hidden;
    }
    .plan-card-header {
      background: var(--bg-panel); padding: 7px 12px;
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.6px; color: var(--text-muted);
    }
    .plan-card-body { padding: 12px; }
    .plan-goal-text { font-size: 14px; font-weight: 600; color: var(--accent-orange); line-height: 1.4; }
    .plan-list { list-style: none; display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; }
    .plan-list li {
      font-size: 12px; color: var(--text-primary); padding-left: 14px;
      position: relative; line-height: 1.5;
    }
    .plan-list li::before { content: '•'; position: absolute; left: 0; color: var(--accent-teal); }

    /* --- Strategy grid (one column per AI) --- */
    .plan-strategy-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;
    }
    .plan-strategy-col { background: var(--bg-panel); border-radius: 6px; padding: 10px; }
    .plan-strategy-provider {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 3px;
    }
    .plan-strategy-focus { font-size: 11px; color: var(--text-muted); margin-bottom: 7px; font-style: italic; }
    .plan-strategy-steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .plan-strategy-steps li {
      font-size: 11px; color: var(--text-primary); padding-left: 12px;
      position: relative; line-height: 1.4;
    }
    .plan-strategy-steps li::before { content: '\u2192'; position: absolute; left: 0; color: var(--accent-teal); font-size: 10px; }

    /* --- Action plan numbered list --- */
    .plan-action-items { display: flex; flex-direction: column; gap: 6px; }
    .plan-action-item {
      display: flex; align-items: flex-start; gap: 10px;
      background: var(--bg-panel); padding: 8px 10px; border-radius: 5px;
    }
    .plan-action-num { font-size: 11px; font-weight: 700; color: var(--accent-orange); min-width: 16px; line-height: 1.5; }
    .plan-action-text { font-size: 12px; color: var(--text-primary); line-height: 1.5; }

    /* --- Permissions panel (bottom of Think Tank tab) --- */
    .permissions-panel {
      padding: 10px 14px; border-top: 1px solid var(--border-color);
      background: var(--bg-surface); flex-shrink: 0;
    }
    .permissions-title {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px;
    }
    .perm-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
    .perm-row:last-child { margin-bottom: 0; }
    .perm-label { font-size: 12px; color: var(--text-primary); }
    .perm-options { display: flex; gap: 4px; }
    .perm-btn {
      background: var(--bg-panel); border: 1px solid var(--border-color);
      color: var(--text-muted); padding: 3px 10px; border-radius: 3px;
      cursor: pointer; font-size: 11px; transition: all 0.12s;
    }
    .perm-btn.active { border-color: var(--accent-teal); color: var(--accent-teal); background: rgba(47,192,194,0.08); }
    .perm-btn:hover:not(.active) { border-color: var(--text-muted); color: var(--text-primary); }
    /* Toggle switch */
    .toggle-switch { position: relative; display: inline-block; width: 36px; height: 20px; }
    .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle-slider {
      position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
      background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 20px; transition: 0.2s;
    }
    .toggle-slider:before {
      position: absolute; content: ''; height: 14px; width: 14px; left: 2px; bottom: 2px;
      background: var(--text-muted); border-radius: 50%; transition: 0.2s;
    }
    .toggle-switch input:checked + .toggle-slider { background: rgba(47,192,194,0.15); border-color: var(--accent-teal); }
    .toggle-switch input:checked + .toggle-slider:before { transform: translateX(16px); background: var(--accent-teal); }

    /* --- Action Log page --- */
    #page-log { display: none; flex-direction: column; height: 100%; }
    #page-log.active { display: flex; }
    .action-log-list { flex: 1; overflow-y: auto; padding: 12px; }
    .action-log-entry {
      background: var(--bg-surface); border: 1px solid var(--border-color);
      border-radius: 6px; padding: 9px 12px; margin-bottom: 6px;
    }
    .ale-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .ale-type {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      padding: 1px 6px; border-radius: 3px; letter-spacing: 0.3px;
    }
    .ale-type.think  { background: rgba(255,106,0,0.15); color: var(--accent-orange); }
    .ale-type.chat   { background: rgba(47,192,194,0.15); color: var(--accent-teal); }
    .ale-type.consensus { background: rgba(63,185,80,0.15); color: var(--accent-green); }
    .ale-type.insert { background: rgba(210,153,34,0.15); color: var(--accent-yellow); }
    .ale-type.patch  { background: rgba(63,185,80,0.15); color: var(--accent-green); }
    .ale-time { font-size: 10px; color: var(--text-muted); }
    .ale-status { font-size: 10px; margin-left: auto; font-weight: 600; }
    .ale-status.completed { color: var(--accent-green); }
    .ale-status.error     { color: var(--accent-red); }
    .ale-status.cancelled { color: var(--text-muted); }
    .ale-desc { font-size: 12px; color: var(--text-primary); line-height: 1.4; }
    .ale-providers { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    /* --- Action Step Cards --- */
    .action-steps-container { display: flex; flex-direction: column; gap: 6px; }
    .action-steps-title {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.6px; color: var(--accent-teal); margin: 4px 0 2px 0;
    }
    .action-step-card {
      background: var(--bg-surface); border: 1px solid var(--border-color);
      border-radius: 6px; overflow: hidden;
      transition: border-color 0.15s;
    }
    .action-step-card.as-running { border-color: var(--accent-teal); }
    .action-step-card.as-done    { border-color: var(--accent-green); }
    .action-step-card.as-error   { border-color: var(--accent-red); }
    .action-step-card.as-skipped { opacity: 0.55; }
    .as-card-header {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 10px; background: var(--bg-panel);
    }
    .as-type-badge {
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.4px; padding: 1px 6px; border-radius: 3px;
      background: rgba(47,192,194,0.12); color: var(--accent-teal);
    }
    .as-risk-badge {
      font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px;
    }
    .as-risk-badge.low    { background: rgba(63,185,80,0.12);  color: var(--accent-green); }
    .as-risk-badge.medium { background: rgba(210,153,34,0.12); color: var(--accent-yellow); }
    .as-risk-badge.high   { background: rgba(248,81,73,0.12);  color: var(--accent-red); }
    .as-status-badge {
      font-size: 9px; font-weight: 700; margin-left: auto;
      text-transform: uppercase; letter-spacing: 0.3px;
    }
    .as-status-badge.planned   { color: var(--text-muted); }
    .as-status-badge.running   { color: var(--accent-teal); }
    .as-status-badge.done      { color: var(--accent-green); }
    .as-status-badge.error     { color: var(--accent-red); }
    .as-status-badge.skipped   { color: var(--text-muted); }
    .as-card-body { padding: 8px 10px; }
    .as-desc { font-size: 12px; color: var(--text-primary); line-height: 1.4; margin-bottom: 4px; }
    .as-outcome { font-size: 11px; color: var(--text-muted); font-style: italic; }
    .as-card-footer {
      display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-top: 1px solid var(--border-color);
    }
    .as-run-btn {
      background: var(--accent-teal); color: #000; border: none;
      padding: 3px 12px; border-radius: 3px; cursor: pointer;
      font-size: 11px; font-weight: 600;
    }
    .as-run-btn:hover { filter: brightness(1.1); }
    .as-run-btn:disabled { opacity: 0.4; cursor: default; }
    .as-skip-btn {
      background: none; border: 1px solid var(--border-color);
      color: var(--text-muted); padding: 3px 10px; border-radius: 3px;
      cursor: pointer; font-size: 11px;
    }
    .as-skip-btn:hover { border-color: var(--accent-red); color: var(--accent-red); }
    .as-output {
      margin: 0 10px 8px 10px; font-size: 11px; color: var(--text-muted);
      background: var(--bg-main); border-radius: 4px; padding: 6px 8px;
      display: none; white-space: pre-wrap; word-break: break-word;
    }
    .as-output.visible { display: block; }

    /* --- Conventions panel --- */
    .conventions-card {
      background: var(--bg-surface); border: 1px solid var(--border-color);
      border-radius: 8px; overflow: hidden; margin-top: 8px;
    }
    .conventions-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 12px; background: var(--bg-panel);
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.6px; color: var(--text-muted);
    }
    .convention-row {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 6px 12px; border-top: 1px solid var(--border-color); font-size: 12px;
    }
    .conv-key   { color: var(--accent-teal); font-weight: 600; min-width: 100px; word-break: break-word; }
    .conv-value { flex: 1; color: var(--text-primary); word-break: break-word; }
    .conv-del   {
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; font-size: 14px; line-height: 1; padding: 0 4px;
    }
    .conv-del:hover { color: var(--accent-red); }
    .conv-add-row {
      display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border-color);
    }
    .conv-add-row input {
      background: var(--bg-main); border: 1px solid var(--border-color);
      color: var(--text-primary); border-radius: 3px; padding: 4px 8px; font-size: 11px;
    }
    .conv-add-row input:focus { outline: none; border-color: var(--accent-teal); }
    .conv-add-btn {
      background: var(--accent-teal); color: #000; border: none;
      padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: 600;
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
    <span class="provider-dot" title="OpenAI"><span class="dot" id="dotOpenai"></span> <span class="pn-openai">OpenAI</span></span>
    <span class="provider-dot" title="Gemini"><span class="dot" id="dotGemini"></span> <span class="pn-gemini">Gemini</span></span>
    <span class="provider-dot" title="Claude"><span class="dot" id="dotClaude"></span> <span class="pn-claude">Claude</span></span>
    <span class="mode-badge none" id="modeBadge">No Keys</span>
    <button class="mode-toggle" id="modeToggle" title="Switch between Guided and Professional mode">Guided</button>
  </div>

  <!-- Loading Bar -->
  <div class="loading-bar" id="loadingBar">
    <div class="spinner"></div>
    <span class="loading-text" id="loadingText">Processing...</span>
    <button class="cancel-btn" id="cancelBtn">Cancel</button>
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
    <button class="tab-btn active" data-tab="chat">Chat</button>
    <button class="tab-btn" data-tab="think">Think Tank</button>
    <button class="tab-btn" data-tab="history">History</button>
    <button class="tab-btn" data-tab="log">Action Log</button>
    <button class="tab-btn" data-tab="about">About</button>
    <button class="tab-btn" data-tab="getstarted">Get Started</button>
  </div>

  <!-- ═══ PAGE: Chat ═══ -->
  <div class="page active" id="page-chat">

    <!-- Action Buttons (Guided mode only) -->
    <div class="action-buttons" id="actionButtons">
      <div class="action-group">
        <span class="action-group-label">ANALYZE</span>
        <button class="action-btn primary" data-action="audit">Audit Code</button>
        <button class="action-btn" data-action="functionality">Check Features</button>
        <button class="action-btn" data-action="missing">Find Gaps</button>
        <button class="action-btn" data-action="security">Security</button>
      </div>
      <div class="action-group">
        <span class="action-group-label">BUILD</span>
        <button class="action-btn" data-action="plan">Plan App</button>
        <button class="action-btn" data-action="feature">Build Feature</button>
        <button class="action-btn" data-action="tests">Write Tests</button>
        <button class="action-btn" data-action="document">Document</button>
      </div>
      <div class="action-group">
        <span class="action-group-label">LAUNCH</span>
        <button class="action-btn launch" data-action="supabase">Supabase</button>
        <button class="action-btn launch" data-action="vercel">Vercel</button>
        <button class="action-btn launch" data-action="stripe">Stripe</button>
        <button class="action-btn launch" data-action="revenuecat">RevenueCat</button>
        <button class="action-btn launch" data-action="ios">iOS Launch</button>
      </div>
      <div class="action-group">
        <span class="action-group-label">TOOLS</span>
        <button class="action-btn" data-action="run-command">Run Command</button>
        <button class="action-btn" data-action="search-repo">Search Code</button>
        <button class="action-btn" data-action="debug">Debug Error</button>
        <button class="action-btn" data-action="smart-commit">Smart Commit</button>
        <button class="action-btn" data-action="pr-description">PR Description</button>
        <button class="action-btn secondary" data-action="context">Context Preview</button>
      </div>
    </div>

    <!-- Main Chat Area -->
    <div class="main-container">
      <div class="messages-container scrollbar" id="messagesContainer">

        <!-- Welcome message -->
        <div class="message ai">
          <strong>TriForge AI</strong> — Three AIs. One solid build.<br><br>
          Your AI think tank is ready. Three models debate, refine, and agree on every file before anything touches your project. Add your API keys below to get started.
        </div>

        <!-- API Key Management (always visible) -->
        <div class="onboarding" id="onboarding">
          <h3>API Keys</h3>
          <p>Keys are stored securely in your OS keychain and never shared.</p>
          <div class="key-row" id="keyRow-openai">
            <label class="pn-openai">OpenAI</label>
            <input type="password" id="keyOpenai" placeholder="sk-..." />
            <button data-save="openai">Save</button>
            <span class="status-text missing" id="statusOpenai">missing</span>
          </div>
          <div class="key-row" id="keyRow-gemini">
            <label class="pn-gemini">Gemini</label>
            <input type="password" id="keyGemini" placeholder="AIza..." />
            <button data-save="gemini">Save</button>
            <span class="status-text missing" id="statusGemini">missing</span>
          </div>
          <div class="key-row" id="keyRow-claude">
            <label class="pn-claude">Claude</label>
            <input type="password" id="keyClaude" placeholder="sk-ant-..." />
            <button data-save="claude">Save</button>
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
        <button class="new-chat-btn" id="newChatBtn">+ New</button>
        <input type="text" id="messageInput" placeholder="Describe what you need..." />
        <button class="send-btn" id="sendBtn">Send</button>
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
          <button class="api-link-btn" data-url="https://platform.openai.com/">
            <div class="alb-icon openai">O</div>
            <div class="alb-body">
              <div class="alb-title">Get OpenAI API Key</div>
              <div class="alb-url">platform.openai.com</div>
            </div>
            <span class="alb-arrow">&#8599;</span>
          </button>
          <button class="api-link-btn" data-url="https://aistudio.google.com/apikey">
            <div class="alb-icon gemini">G</div>
            <div class="alb-body">
              <div class="alb-title">Get Gemini API Key</div>
              <div class="alb-url">aistudio.google.com</div>
            </div>
            <span class="alb-arrow">&#8599;</span>
          </button>
          <button class="api-link-btn" data-url="https://console.anthropic.com/">
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

  <!-- ═══ PAGE: History ═══ -->
  <div class="page" id="page-history">
    <div class="info-page scrollbar" id="sessionList" style="padding:12px">
      <p style="color:var(--text-muted);font-size:12px">Loading sessions...</p>
    </div>
  </div>

  <!-- ═══ PAGE: Think Tank ═══ -->
  <div id="page-think">
    <div class="think-header">
      <div class="think-title">&#9670; Think Tank</div>
      <div class="think-subtitle">Describe any goal, challenge, or decision. The TriForge council analyzes it from every angle and builds you an action plan.</div>
    </div>

    <!-- Loading bar -->
    <div class="think-loading" id="thinkLoadingBar">
      <div class="spinner"></div>
      <span>Council is analyzing your goal&hellip;</span>
    </div>

    <!-- Plan output area -->
    <div class="think-plan-area" id="thinkPlanArea"></div>

    <!-- Goal input -->
    <div class="think-input-area">
      <textarea id="thinkGoalInput" rows="3" placeholder="I want to increase revenue by 50%... / Should I quit my job to start a business... / How do I get out of debt..."></textarea>
      <button id="thinkAnalyzeBtn">Analyze</button>
    </div>

    <!-- Permissions / Council Limits -->
    <div class="permissions-panel">
      <div class="permissions-title">Council Limits</div>
      <div class="perm-row">
        <span class="perm-label">Risk Tolerance</span>
        <div class="perm-options">
          <button class="perm-btn" data-risk="low">Low</button>
          <button class="perm-btn active" data-risk="medium">Medium</button>
          <button class="perm-btn" data-risk="high">High</button>
        </div>
      </div>
      <div class="perm-row">
        <span class="perm-label">Auto-approve low-risk patches</span>
        <label class="toggle-switch">
          <input type="checkbox" id="autoApproveToggle">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </div>

  <!-- ═══ PAGE: Action Log ═══ -->
  <div id="page-log" style="display:none;flex-direction:column;height:100%;">
    <div class="action-log-list scrollbar" id="actionLogList">
      <p style="color:var(--text-muted);font-size:12px">No actions logged this session.</p>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentMode = '${currentMode}';
    let isRequestInProgress = false;
    let currentApprovalToken = null;

    // --- Request provider status on load ---
    vscode.postMessage({ command: 'getProviderStatus' });

    // --- Key Management ---
    function saveKey(provider) {
      var input = document.getElementById('key' + provider.charAt(0).toUpperCase() + provider.slice(1));
      if (!input) { console.error('[TriForge] saveKey: input element not found for ' + provider); return; }
      var key = input.value.trim();
      console.log('[TriForge] saveKey:', provider, 'key empty:', !key);
      if (!key) {
        input.style.outline = '2px solid var(--accent-red)';
        setTimeout(function() { input.style.outline = ''; }, 2000);
        return;
      }
      var btn = input.nextElementSibling;
      if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; setTimeout(function() { btn.textContent = 'Save'; btn.disabled = false; }, 3000); }
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

    // --- Markdown Renderer ---
    function highlightCode(escaped, lang) {
      var r = escaped;
      var l = (lang || '').toLowerCase();
      // Comments
      r = r.replace(/(\/\/[^\n]*)/g, '<span class="hl-cmt">$1</span>');
      r = r.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-cmt">$1</span>');
      if (l === 'python' || l === 'py' || l === 'bash' || l === 'sh') {
        r = r.replace(/(#[^\n]*)/g, '<span class="hl-cmt">$1</span>');
      }
      // Keywords — safe because they contain no HTML special chars
      var kws = 'function|const|let|var|return|if|else|elif|for|while|do|switch|case|break|continue|class|import|export|default|async|await|new|this|typeof|instanceof|try|catch|finally|throw|null|undefined|None|True|False|true|false|type|interface|extends|implements|void|string|number|boolean|from|of|in|as|def|with|pass|raise|yield|lambda|self|super|static|public|private|protected';
      r = r.replace(new RegExp('\\b(' + kws + ')\\b', 'g'), '<span class="hl-kw">$1</span>');
      // Decorators / annotations (@something)
      r = r.replace(/(@\w+)/g, '<span class="hl-dec">$1</span>');
      // Numbers
      r = r.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');
      return r;
    }

    function renderMarkdown(text) {
      var blocks = [];
      // 1. Extract fenced code blocks to placeholders
      var withPlaceholders = text.replace(/\`\`\`(\w+)?\n?([\s\S]*?)\`\`\`/g, function(_, lang, code) {
        var idx = blocks.length;
        blocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
        return '\x00BLK' + idx + '\x00';
      });
      // 2. Escape remaining HTML
      var div = document.createElement('div');
      div.textContent = withPlaceholders;
      var safe = div.innerHTML;
      // 3. Process block-level elements line by line
      var lines = safe.split('\n');
      var out = [];
      var inUl = false, inOl = false;
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var h3 = ln.match(/^### (.+)$/);
        var h2 = ln.match(/^## (.+)$/);
        var h1 = ln.match(/^# (.+)$/);
        var ul = ln.match(/^[*-] (.+)$/);
        var ol = ln.match(/^\d+\. (.+)$/);
        var hr = ln.match(/^---+$/);
        var bq = ln.match(/^&gt; (.+)$/);
        var closeList = function() {
          if (inUl) { out.push('</ul>'); inUl = false; }
          if (inOl) { out.push('</ol>'); inOl = false; }
        };
        if (h3) { closeList(); out.push('<h3>' + h3[1] + '</h3>'); }
        else if (h2) { closeList(); out.push('<h2>' + h2[1] + '</h2>'); }
        else if (h1) { closeList(); out.push('<h1>' + h1[1] + '</h1>'); }
        else if (hr) { closeList(); out.push('<hr>'); }
        else if (bq) { closeList(); out.push('<blockquote>' + bq[1] + '</blockquote>'); }
        else if (ul) {
          if (inOl) { out.push('</ol>'); inOl = false; }
          if (!inUl) { out.push('<ul>'); inUl = true; }
          out.push('<li>' + ul[1] + '</li>');
        } else if (ol) {
          if (inUl) { out.push('</ul>'); inUl = false; }
          if (!inOl) { out.push('<ol>'); inOl = true; }
          out.push('<li>' + ol[1] + '</li>');
        } else {
          closeList();
          out.push(ln);
        }
      }
      if (inUl) { out.push('</ul>'); }
      if (inOl) { out.push('</ol>'); }
      var result = out.join('\n');
      // 4. Inline patterns (bold, italic, inline code, links)
      result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
      result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
      result = result.replace(/\`([^\`]+)\`/g, '<code class="md-inline-code">$1</code>');
      result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, txt, url) {
        var safeUrl = /^https?:\/\//i.test(url) ? url : '#';
        return '<a href="' + safeUrl + '" data-ext-url="' + safeUrl + '">' + txt + '</a>';
      });
      // 5. Paragraphs from double newlines
      result = result.replace(/\n\n+/g, '</p><p>');
      result = '<p>' + result + '</p>';
      result = result.replace(/\n/g, '<br>');
      // Clean up empty <p>
      result = result.replace(/<p>\s*<\/p>/g, '');
      result = result.replace(/<p>(<[huo])/g, '$1');
      result = result.replace(/(<\/[huo][l1-6]>)<\/p>/g, '$1');
      // 6. Restore code blocks with highlighting
      result = result.replace(/\x00BLK(\d+)\x00/g, function(_, idx) {
        var b = blocks[parseInt(idx)];
        var escaped2 = document.createElement('div');
        escaped2.textContent = b.code;
        var esc = escaped2.innerHTML;
        var highlighted = highlightCode(esc, b.lang);
        var langLabel = b.lang ? '<span style="position:absolute;top:7px;left:10px;font-size:9px;color:#555;font-family:monospace;letter-spacing:0.5px;text-transform:uppercase;">' + escapeHtml(b.lang) + '</span>' : '';
        var encodedCode = encodeURIComponent(b.code);
        return '<div class="code-wrapper">'
          + langLabel
          + '<div class="code-btn-group">'
          + '<button class="copy-btn">Copy</button>'
          + '<button class="insert-btn" data-code="' + encodedCode + '">Insert</button>'
          + '</div>'
          + '<pre style="' + (b.lang ? 'padding-top:24px;' : '') + '"><code>' + highlighted + '</code></pre>'
          + '</div>';
      });
      return result;
    }

    // --- Streaming helpers ---
    var streamingBubbles = {};

    function startStreamingMessage(provider) {
      var container = document.getElementById('messagesContainer');
      var msg = document.createElement('div');
      msg.className = 'message ai ' + provider;
      var tag = document.createElement('div');
      tag.className = 'provider-tag';
      tag.textContent = provider.toUpperCase();
      msg.appendChild(tag);
      var content = document.createElement('div');
      content.className = 'stream-content';
      msg.appendChild(content);
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
      streamingBubbles[provider] = { msg: msg, content: content, raw: '' };
    }

    function appendChunk(provider, chunk) {
      var bubble = streamingBubbles[provider];
      if (!bubble) { return; }
      bubble.raw += chunk;
      bubble.content.textContent = bubble.raw;
      var container = document.getElementById('messagesContainer');
      container.scrollTop = container.scrollHeight;
    }

    function finalizeStream(provider, fullText) {
      var bubble = streamingBubbles[provider];
      if (!bubble) { return; }
      bubble.content.innerHTML = renderMarkdown(fullText);
      bubble.content.querySelectorAll('a[data-ext-url]').forEach(function(a) {
        a.addEventListener('click', function(e) {
          e.preventDefault();
          openExternal(a.getAttribute('data-ext-url'));
        });
      });
      delete streamingBubbles[provider];
      var container = document.getElementById('messagesContainer');
      container.scrollTop = container.scrollHeight;
    }

    // --- Debate summary ---
    function showDebateSummary(data) {
      var container = document.getElementById('messagesContainer');
      var allApproved = data.results.every(function(r) { return r.status === 'approved'; });
      var headline = data.providers.join(' + ') + (allApproved ? ' reached consensus' : ' partially agreed')
        + ' in up to ' + data.roundsMax + ' round(s) across ' + data.filesDebated + ' file(s)';
      var rows = data.results.map(function(r) {
        return '<div class="ds-row">'
          + '<span class="' + (r.status === 'approved' ? 'ds-approved' : 'ds-disagreement') + '">'
          + (r.status === 'approved' ? '\u2713' : '\u2717') + '</span>'
          + '<span class="ds-file">' + escapeHtml(r.file) + '</span>'
          + '<span style="color:var(--text-muted);font-size:10px">' + r.rounds + ' rnd(s)</span>'
          + '</div>';
      }).join('');
      var details = document.createElement('details');
      details.className = 'debate-summary-card';
      details.innerHTML = '<summary>' + escapeHtml(headline) + '</summary>' + rows;
      container.appendChild(details);
      container.scrollTop = container.scrollHeight;
    }

    // --- Session history ---
    function renderSessionList(sessions) {
      var el = document.getElementById('sessionList');
      if (!sessions || sessions.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">No past sessions yet. Start a conversation to save it here.</p>';
        return;
      }
      var html = '';
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var d = new Date(s.date);
        var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += '<div class="session-item" data-session-id="' + escapeHtml(s.id) + '">'
          + '<div class="session-body">'
          + '<div class="session-title">' + escapeHtml(s.title) + '</div>'
          + '<div class="session-date">' + dateStr + '</div>'
          + '</div>'
          + '<button class="session-del-btn" data-del-session="' + escapeHtml(s.id) + '" title="Delete">\u00D7</button>'
          + '</div>';
      }
      el.innerHTML = html;
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
        tag.textContent = provider.toUpperCase();
        msg.appendChild(tag);
      }
      var content = document.createElement('div');
      msg.appendChild(content);
      container.appendChild(msg);

      if (sender === 'ai') {
        content.innerHTML = renderMarkdown(text);
        // Wire markdown links to open externally
        content.querySelectorAll('a[data-ext-url]').forEach(function(a) {
          a.addEventListener('click', function(e) {
            e.preventDefault();
            openExternal(a.getAttribute('data-ext-url'));
          });
        });
      } else {
        content.textContent = text;
      }
      container.scrollTop = container.scrollHeight;
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
      vscode.postMessage({ command: 'suggestCommand', cmd: cmd, cwd: undefined, explanation: explanation, risk: risk });
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

    // --- Debate Log (speech bubbles) ---
    function addDebateEntry(provider, role, filePath, round, text) {
      var log = document.getElementById('debateLog');
      log.className = 'debate-log visible scrollbar';

      // Insert round/file separator when context changes
      var lastKey = log.getAttribute('data-debate-key');
      var thisKey = round + ':' + filePath;
      if (lastKey !== thisKey) {
        var sep = document.createElement('div');
        sep.className = 'debate-round-sep';
        sep.textContent = 'Round ' + round + (filePath ? '  \u2022  ' + filePath : '');
        log.appendChild(sep);
        log.setAttribute('data-debate-key', thisKey);
      }

      // Verdict detection
      var verdict = '';
      if (text.indexOf('REQUEST_CHANGES') !== -1) { verdict = 'changes'; }
      else if (text.indexOf('APPROVE') !== -1) { verdict = 'approve'; }

      var bubble = document.createElement('div');
      bubble.className = 'debate-bubble db-' + provider;

      var truncated = text.length > 200 ? text.substring(0, 200) + '\u2026' : text;
      bubble.innerHTML =
        '<div class="debate-bubble-header">'
        + '<span class="db-provider pn-' + provider + '">' + escapeHtml(provider.toUpperCase()) + '</span>'
        + '<span class="db-role">' + escapeHtml(role) + '</span>'
        + (verdict ? '<span class="verdict-badge ' + verdict + '">' + (verdict === 'approve' ? '\u2713 APPROVE' : '\u21BB CHANGES') + '</span>' : '')
        + '</div>'
        + '<div class="debate-bubble-body">' + escapeHtml(truncated) + '</div>';

      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
      setActiveProvider(provider);
    }

    function setActiveProvider(provider) {
      ['openai', 'gemini', 'claude'].forEach(function(p) {
        var dot = document.getElementById('dot' + p.charAt(0).toUpperCase() + p.slice(1));
        if (dot) { dot.classList.remove('active'); }
      });
      if (provider) {
        var dot = document.getElementById('dot' + provider.charAt(0).toUpperCase() + provider.slice(1));
        if (dot) { dot.classList.add('active'); }
      }
    }

    function clearActiveDots() {
      ['openai', 'gemini', 'claude'].forEach(function(p) {
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
        + (hasPatches ? '<button class="approve-btn" data-patch-action="approve">Approve & Apply</button>' : '')
        + (hasPatches ? '<button class="reject-btn" data-patch-action="reject">Reject</button>' : '')
        + '<button class="export-btn" data-patch-action="export">Export Debate</button>'
        + '</div></div>';

      if (data.hasDisagreements) {
        html += '<div class="disagreement-warning">Some files did not reach consensus.'
          + (data.disagreementReport ? '<br>' + escapeHtml(data.disagreementReport).substring(0, 400) : '')
          + '<div class="disagreement-actions">'
          + '<button data-patch-action="continue">&#8635; Continue Debate</button>'
          + '<button data-patch-action="majority">&#10003; Accept Majority</button>'
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
    var KEY_PLACEHOLDERS = { openai: 'sk-...', gemini: 'AIza...', claude: 'sk-ant-...' };

    function updateProviderStatus(providers, modeInfo) {
      for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        var caps = p.name.charAt(0).toUpperCase() + p.name.slice(1);

        // Update status bar dot
        var dot = document.getElementById('dot' + caps);
        if (dot) { dot.className = p.connected ? 'dot connected' : 'dot'; }

        // Rebuild the key-row to show connected or disconnected UI
        var row = document.getElementById('keyRow-' + p.name);
        if (row) {
          if (p.connected) {
            row.innerHTML =
              '<label class="pn-' + p.name + '">' + caps + '</label>' +
              '<span class="status-text connected">&#10003; connected</span>' +
              '<button class="update-btn" data-update="' + p.name + '">Update</button>' +
              '<button class="remove-btn" data-remove="' + p.name + '">Remove</button>';
          } else {
            row.innerHTML =
              '<label class="pn-' + p.name + '">' + caps + '</label>' +
              '<input type="password" id="key' + caps + '" placeholder="' + (KEY_PLACEHOLDERS[p.name] || '') + '" />' +
              '<button data-save="' + p.name + '">Save</button>' +
              '<span class="status-text missing">missing</span>';
          }
        }
      }

      var badge = document.getElementById('modeBadge');
      var labels = { none: 'No Keys', single: 'Single', pair: 'Pair Review', consensus: 'Consensus' };
      badge.textContent = labels[modeInfo.mode] || modeInfo.mode;
      badge.className = 'mode-badge ' + modeInfo.mode;
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
      // Update standard .page elements (chat, history, about, getstarted)
      var pages = document.querySelectorAll('.page');
      for (var j = 0; j < pages.length; j++) {
        pages[j].className = pages[j].id === ('page-' + tabName) ? 'page active' : 'page';
      }
      // Update custom pages that don't use the .page class (think, log)
      ['think', 'log'].forEach(function(id) {
        var el = document.getElementById('page-' + id);
        if (el) { el.className = id === tabName ? 'active' : ''; }
      });
    }

    // ================================================================
    // THINK TANK OS
    // ================================================================

    var currentRiskTolerance = 'medium';
    var autoApproveEnabled = false;

    function setRiskTolerance(level) {
      currentRiskTolerance = level;
      document.querySelectorAll('.perm-btn[data-risk]').forEach(function(btn) {
        btn.className = btn.getAttribute('data-risk') === level ? 'perm-btn active' : 'perm-btn';
      });
      savePermissions();
    }

    function savePermissions() {
      vscode.postMessage({ command: 'setPermissions', riskTolerance: currentRiskTolerance, autoApprove: autoApproveEnabled });
    }

    function decomposeGoal() {
      var input = document.getElementById('thinkGoalInput');
      var goal = input.value.trim();
      if (!goal) { return; }
      document.getElementById('thinkPlanArea').innerHTML = '';
      document.getElementById('thinkLoadingBar').className = 'think-loading visible';
      document.getElementById('thinkAnalyzeBtn').disabled = true;
      vscode.postMessage({ command: 'decomposeGoal', goal: goal });
    }

    function renderIntentPlan(plan) {
      document.getElementById('thinkLoadingBar').className = 'think-loading';
      document.getElementById('thinkAnalyzeBtn').disabled = false;

      var area = document.getElementById('thinkPlanArea');
      var html = '';

      // Goal Statement
      html += '<div class="plan-card">'
        + '<div class="plan-card-header">Your Goal</div>'
        + '<div class="plan-card-body"><div class="plan-goal-text">' + escapeHtml(plan.goalStatement) + '</div></div>'
        + '</div>';

      // Obstacles
      if (plan.obstacles && plan.obstacles.length > 0) {
        html += '<div class="plan-card"><div class="plan-card-header">Key Obstacles</div><div class="plan-card-body"><ul class="plan-list">';
        plan.obstacles.forEach(function(obs) { html += '<li>' + escapeHtml(obs) + '</li>'; });
        html += '</ul></div></div>';
      }

      // Council Strategies
      if (plan.strategies && plan.strategies.length > 0) {
        html += '<div class="plan-card"><div class="plan-card-header">Council Strategies</div><div class="plan-card-body"><div class="plan-strategy-grid">';
        plan.strategies.forEach(function(strat) {
          html += '<div class="plan-strategy-col">'
            + '<div class="plan-strategy-provider pn-' + strat.provider + '">' + strat.provider.toUpperCase() + '</div>'
            + '<div class="plan-strategy-focus">' + escapeHtml(strat.focus) + '</div>'
            + '<ul class="plan-strategy-steps">';
          (strat.steps || []).forEach(function(step) { html += '<li>' + escapeHtml(step) + '</li>'; });
          html += '</ul></div>';
        });
        html += '</div></div></div>';
      }

      // Consensus Action Plan
      if (plan.actionPlan && plan.actionPlan.length > 0) {
        html += '<div class="plan-card"><div class="plan-card-header">Consensus Action Plan</div><div class="plan-card-body"><div class="plan-action-items">';
        plan.actionPlan.forEach(function(step, i) {
          html += '<div class="plan-action-item">'
            + '<span class="plan-action-num">' + (i + 1) + '</span>'
            + '<span class="plan-action-text">' + escapeHtml(step) + '</span>'
            + '</div>';
        });
        html += '</div></div></div>';
      }

      // Success Metrics
      if (plan.metrics && plan.metrics.length > 0) {
        html += '<div class="plan-card"><div class="plan-card-header">How to Measure Success</div><div class="plan-card-body"><ul class="plan-list">';
        plan.metrics.forEach(function(m) { html += '<li>' + escapeHtml(m) + '</li>'; });
        html += '</ul></div></div>';
      }

      area.innerHTML = html;
    }

    function renderActionLog(entries) {
      var list = document.getElementById('actionLogList');
      if (!entries || entries.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:12px">No actions logged this session.</p>';
        return;
      }
      var html = '';
      entries.forEach(function(e) {
        var d = new Date(e.timestamp);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += '<div class="action-log-entry">'
          + '<div class="ale-header">'
          + '<span class="ale-type ' + e.type + '">' + e.type + '</span>'
          + '<span class="ale-time">' + timeStr + '</span>'
          + '<span class="ale-status ' + e.status + '">' + e.status + '</span>'
          + '</div>'
          + '<div class="ale-desc">' + escapeHtml(e.description) + '</div>';
        if (e.providers && e.providers.length > 0) {
          html += '<div class="ale-providers">via ' + e.providers.join(', ') + '</div>';
        }
        html += '</div>';
      });
      list.innerHTML = html;
    }

    // --- Action Plan (ActionStep[] from ActionPlanner) ---
    function _buildActionStepHtml(step) {
      var risk = step.riskLevel || 'low';
      var status = step.status || 'planned';
      return '<div class="action-step-card as-' + status + '" id="step-' + escapeHtml(step.id) + '">'
        + '<div class="as-card-header">'
        + '<span class="as-type-badge">' + escapeHtml(step.type) + '</span>'
        + '<span class="as-risk-badge ' + risk + '">' + risk + '</span>'
        + '<span class="as-status-badge ' + status + '">' + status + '</span>'
        + '</div>'
        + '<div class="as-card-body">'
        + '<div class="as-desc">' + escapeHtml(step.description) + '</div>'
        + '</div>'
        + (status === 'planned'
          ? '<div class="as-card-footer">'
            + '<button class="as-run-btn" data-step-run="' + escapeHtml(step.id) + '">Run</button>'
            + '<button class="as-skip-btn" data-step-skip="' + escapeHtml(step.id) + '">Skip</button>'
            + '</div>'
          : '')
        + '<div class="as-output" id="step-out-' + escapeHtml(step.id) + '"></div>'
        + '</div>';
    }

    function renderActionPlan(steps) {
      var area = document.getElementById('thinkPlanArea');
      var existing = document.getElementById('actionPlanSection');
      if (existing) { existing.remove(); }
      if (!steps || steps.length === 0) { return; }
      var section = document.createElement('div');
      section.id = 'actionPlanSection';
      section.className = 'plan-card';
      var html = '<div class="plan-card-header">Action Steps</div>'
        + '<div class="plan-card-body"><div class="action-steps-container">';
      steps.forEach(function(step) { html += _buildActionStepHtml(step); });
      html += '</div></div>';
      section.innerHTML = html;
      area.appendChild(section);
    }

    function updateActionStep(stepId, status, output) {
      var card = document.getElementById('step-' + stepId);
      if (!card) { return; }
      // Update card class
      card.className = 'action-step-card as-' + status;
      // Update status badge
      var badge = card.querySelector('.as-status-badge');
      if (badge) { badge.className = 'as-status-badge ' + status; badge.textContent = status; }
      // Remove run/skip footer when no longer planned
      if (status !== 'planned') {
        var footer = card.querySelector('.as-card-footer');
        if (footer) { footer.remove(); }
      }
      // Show output if provided
      if (output) {
        var outEl = document.getElementById('step-out-' + stepId);
        if (outEl) { outEl.textContent = output; outEl.className = 'as-output visible'; }
      }
    }

    // --- Conventions ---
    function renderConventions(conventions) {
      var area = document.getElementById('conventionsArea');
      if (!area) {
        area = document.createElement('div');
        area.id = 'conventionsArea';
        area.style.marginTop = '8px';
        var permPanel = document.querySelector('#page-think .permissions-panel');
        if (permPanel) { permPanel.parentNode.insertBefore(area, permPanel.nextSibling); }
      }
      var html = '<div class="conventions-card">'
        + '<div class="conventions-header"><span>Project Conventions</span></div>';
      if (!conventions || conventions.length === 0) {
        html += '<div style="padding:10px 12px;color:var(--text-muted);font-size:12px">No conventions saved yet.</div>';
      } else {
        conventions.forEach(function(c) {
          html += '<div class="convention-row">'
            + '<span class="conv-key">' + escapeHtml(c.key) + '</span>'
            + '<span class="conv-value">' + escapeHtml(c.value) + '</span>'
            + '<button class="conv-del" data-conv-del="' + escapeHtml(c.key) + '" title="Remove">&#215;</button>'
            + '</div>';
        });
      }
      html += '<div class="conv-add-row">'
        + '<input id="convKeyInput" placeholder="Key" style="width:90px" />'
        + '<input id="convValInput" placeholder="Value" style="flex:1" />'
        + '<button class="conv-add-btn" id="convAddBtn">Add</button>'
        + '</div></div>';
      area.innerHTML = html;
      // Delete delegation
      area.querySelectorAll('[data-conv-del]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          vscode.postMessage({ command: 'removeConvention', key: btn.getAttribute('data-conv-del') });
        });
      });
      // Add button
      var addBtn = document.getElementById('convAddBtn');
      if (addBtn) {
        addBtn.addEventListener('click', function() {
          var key = (document.getElementById('convKeyInput') || {}).value || '';
          var val = (document.getElementById('convValInput') || {}).value || '';
          key = key.trim(); val = val.trim();
          if (key && val) { vscode.postMessage({ command: 'addConvention', key: key, value: val }); }
        });
      }
    }

    // --- Decision Log ---
    function renderDecisionLog(entries) {
      var list = document.getElementById('actionLogList');
      if (!entries || entries.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:12px">No council decisions recorded yet.</p>';
        return;
      }
      var html = '';
      entries.forEach(function(e) {
        var d = new Date(e.timestamp);
        var timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
          + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += '<div class="action-log-entry">'
          + '<div class="ale-header">'
          + '<span class="ale-type think">decision</span>'
          + '<span class="ale-time">' + timeStr + '</span>'
          + '<span class="ale-status done">done</span>'
          + '</div>'
          + '<div class="ale-desc">' + escapeHtml((e.goalStatement || e.request || '').substring(0, 120)) + '</div>';
        if (e.finalDecision) {
          html += '<div class="ale-providers">' + escapeHtml(e.finalDecision.substring(0, 100)) + '</div>';
        }
        html += '</div>';
      });
      list.innerHTML = html;
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

        case 'requestStarted': {
          setLoading(true, 'Processing (' + message.mode + ' mode)...');
          var dl = document.getElementById('debateLog');
          dl.innerHTML = '';
          dl.className = 'debate-log';
          dl.removeAttribute('data-debate-key');
          hidePatchPreview();
          break;
        }

        case 'messageStreamStart':
          startStreamingMessage(message.provider);
          break;

        case 'messageChunk':
          appendChunk(message.provider, message.chunk);
          break;

        case 'messageStreamEnd':
          finalizeStream(message.provider, message.fullText);
          break;

        case 'clearMessages': {
          var mc = document.getElementById('messagesContainer');
          mc.innerHTML = '';
          var notice = document.createElement('div');
          notice.className = 'message ai';
          notice.textContent = 'New conversation started.';
          mc.appendChild(notice);
          break;
        }

        case 'debateSummary':
          showDebateSummary(message);
          break;

        case 'sessionList':
          renderSessionList(message.sessions);
          break;

        case 'sessionLoaded':
          if (message.session && message.session.messages) {
            var smContainer = document.getElementById('messagesContainer');
            smContainer.innerHTML = '';
            for (var si = 0; si < message.session.messages.length; si++) {
              var sm = message.session.messages[si];
              addMessage(sm.content, sm.role === 'user' ? 'user' : (sm.role === 'system' ? 'system' : 'ai'), sm.provider);
            }
          }
          switchTab('chat');
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

        // --- Think Tank OS ---
        case 'intentPlanStart':
          document.getElementById('thinkLoadingBar').className = 'think-loading visible';
          document.getElementById('thinkAnalyzeBtn').disabled = true;
          document.getElementById('thinkPlanArea').innerHTML = '';
          break;

        case 'intentPlanResult':
          renderIntentPlan(message.plan);
          break;

        case 'intentPlanError': {
          document.getElementById('thinkLoadingBar').className = 'think-loading';
          document.getElementById('thinkAnalyzeBtn').disabled = false;
          var errDiv = document.createElement('div');
          errDiv.className = 'message error';
          errDiv.textContent = message.error;
          document.getElementById('thinkPlanArea').appendChild(errDiv);
          break;
        }

        case 'actionLog':
          renderActionLog(message.entries);
          break;

        case 'actionPlan':
          renderActionPlan(message.steps);
          break;

        case 'actionStepUpdate':
          updateActionStep(message.stepId, message.status, message.output);
          break;

        case 'decisionLog':
          renderDecisionLog(message.entries);
          break;

        case 'conventions':
          renderConventions(message.conventions);
          break;

        case 'permissionsUpdated':
          currentRiskTolerance = message.riskTolerance;
          autoApproveEnabled = message.autoApprove;
          document.querySelectorAll('.perm-btn[data-risk]').forEach(function(b) {
            b.className = b.getAttribute('data-risk') === message.riskTolerance ? 'perm-btn active' : 'perm-btn';
          });
          var tog = document.getElementById('autoApproveToggle');
          if (tog) { tog.checked = message.autoApprove; }
          break;
      }
    });

    // ─── Wire all buttons via addEventListener (no inline onclick needed) ───

    // Mode toggle
    document.getElementById('modeToggle').addEventListener('click', toggleMode);

    // Cancel
    document.getElementById('cancelBtn').addEventListener('click', cancelRequest);

    // Tabs
    document.querySelectorAll('.tab-btn[data-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tabName = btn.getAttribute('data-tab');
        switchTab(tabName);
        if (tabName === 'history') {
          vscode.postMessage({ command: 'getSessionList' });
        } else if (tabName === 'log') {
          vscode.postMessage({ command: 'getActionLog' });
        }
      });
    });

    // Think Tank
    document.getElementById('thinkAnalyzeBtn').addEventListener('click', decomposeGoal);
    document.getElementById('thinkGoalInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.ctrlKey) { decomposeGoal(); }
    });

    // Permissions
    document.querySelectorAll('.perm-btn[data-risk]').forEach(function(btn) {
      btn.addEventListener('click', function() { setRiskTolerance(btn.getAttribute('data-risk')); });
    });
    var aaToggle = document.getElementById('autoApproveToggle');
    if (aaToggle) {
      aaToggle.addEventListener('change', function() {
        autoApproveEnabled = this.checked;
        savePermissions();
      });
    }

    document.getElementById('newChatBtn').addEventListener('click', function() {
      vscode.postMessage({ command: 'newChat' });
    });

    document.getElementById('sessionList').addEventListener('click', function(e) {
      var delBtn = e.target.closest('[data-del-session]');
      if (delBtn) {
        e.stopPropagation();
        vscode.postMessage({ command: 'deleteSession', id: delBtn.getAttribute('data-del-session') });
        return;
      }
      var item = e.target.closest('[data-session-id]');
      if (item) {
        vscode.postMessage({ command: 'loadSession', id: item.getAttribute('data-session-id') });
      }
    });

    // Action buttons (guided mode quick actions)
    document.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var a = btn.getAttribute('data-action');
        if (a === 'run-command') { showRunCommandPrompt(); }
        else if (a === 'search-repo') { showSearchPrompt(); }
        else if (a === 'debug') { startDebugPrompt(); }
        else if (a === 'context') { showContextPreview(); }
        else { triggerAction(a); }
      });
    });

    // API key management — delegated so it works after dynamic row rebuilds
    document.getElementById('onboarding').addEventListener('click', function(e) {
      var btn = e.target.closest('button');
      if (!btn) { return; }

      // Save key
      if (btn.hasAttribute('data-save')) {
        saveKey(btn.getAttribute('data-save'));
        return;
      }

      // Update: inject an inline input row beneath the connected row
      if (btn.hasAttribute('data-update')) {
        var provider = btn.getAttribute('data-update');
        var caps = provider.charAt(0).toUpperCase() + provider.slice(1);
        var existing = document.getElementById('updateRow-' + provider);
        if (existing) { existing.remove(); return; } // toggle off
        var row = document.getElementById('keyRow-' + provider);
        if (!row) { return; }
        var inputRow = document.createElement('div');
        inputRow.className = 'update-input-row';
        inputRow.id = 'updateRow-' + provider;
        inputRow.innerHTML =
          '<input type="password" id="key' + caps + '" placeholder="Paste new key..." style="flex:1" />' +
          '<button data-save="' + provider + '">Confirm</button>';
        row.insertAdjacentElement('afterend', inputRow);
        document.getElementById('key' + caps).focus();
        return;
      }

      // Remove key
      if (btn.hasAttribute('data-remove')) {
        vscode.postMessage({ command: 'removeApiKey', provider: btn.getAttribute('data-remove') });
      }
    });

    // Send button + Enter key
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', handleKeyPress);

    // External API key links
    document.querySelectorAll('[data-url]').forEach(function(btn) {
      btn.addEventListener('click', function() { openExternal(btn.getAttribute('data-url')); });
    });

    // Event delegation for action step Run/Skip buttons (rendered into #thinkPlanArea)
    document.getElementById('thinkPlanArea').addEventListener('click', function(e) {
      var runBtn = e.target.closest('[data-step-run]');
      if (runBtn) {
        vscode.postMessage({ command: 'executeActionStep', stepId: runBtn.getAttribute('data-step-run') });
        return;
      }
      var skipBtn = e.target.closest('[data-step-skip]');
      if (skipBtn) {
        vscode.postMessage({ command: 'skipActionStep', stepId: skipBtn.getAttribute('data-step-skip') });
      }
    });

    // Event delegation for dynamically injected patch preview buttons
    document.getElementById('patchPreview').addEventListener('click', function(e) {
      var btn = e.target.closest('[data-patch-action]');
      if (!btn) { return; }
      var a = btn.getAttribute('data-patch-action');
      if (a === 'approve') { approvePatches(); }
      else if (a === 'reject') { rejectPatches(); }
      else if (a === 'export') { vscode.postMessage({ command: 'exportDebate' }); }
      else if (a === 'continue') { vscode.postMessage({ command: 'continueDebate' }); }
      else if (a === 'majority') { vscode.postMessage({ command: 'acceptMajority' }); }
    });

    // Copy button delegation — works for all code blocks rendered via markdown
    document.getElementById('messagesContainer').addEventListener('click', function(e) {
      // Insert button
      var insertBtn = e.target.closest('.insert-btn');
      if (insertBtn) {
        var encoded = insertBtn.getAttribute('data-code');
        if (encoded) {
          vscode.postMessage({ command: 'insertToEditor', code: decodeURIComponent(encoded) });
          insertBtn.textContent = 'Inserted!';
          setTimeout(function() { insertBtn.textContent = 'Insert'; }, 2000);
        }
        return;
      }

      // Copy button
      var btn = e.target.closest('.copy-btn');
      if (!btn) { return; }
      var codeEl = btn.closest('.code-wrapper') && btn.closest('.code-wrapper').querySelector('code');
      if (!codeEl) { return; }
      var text = codeEl.textContent || '';
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      }).catch(function() {
        var range = document.createRange();
        range.selectNodeContents(codeEl);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        btn.textContent = 'Selected';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      });
    });

  </script>
</body>
</html>`;
  }
}
