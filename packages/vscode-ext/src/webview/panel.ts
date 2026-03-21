import * as vscode from 'vscode';
import {
  ProviderManager,
  CouncilWorkflowEngine,
  type CouncilWorkflowSession,
  type ExecutionMode,
  type CouncilWorkflowAction,
} from '@triforge/engine';
import { LicenseManager, LicenseStatus } from '../core/license';
import { getReviewRuntime } from '../extension';
import type { ReviewSession } from '../reviewRuntime';
import { buildWebviewContent } from './webviewContent';
import { type LedgerState } from './ledger';
import type { PanelContext } from './panelContext';
import { runAuthorReviewRuntime } from './reviewPipeline';
import { runGovernedPipeline, subscribeWorkflowEvents } from './governedPipeline';
import { runCouncilPipeline } from './councilPipeline';
import { attachMessageRouter } from './messageRouter';
import {
  type DeadlockResolution,
  type CouncilMode, type IntensityState,
  type CouncilSession,
} from './panelTypes';

// ── TriForgeCouncilPanel ───────────────────────────────────────────────────

export class TriForgeCouncilPanel implements PanelContext {
  public static currentPanel: TriForgeCouncilPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _providerManager: ProviderManager;
  private _disposables: vscode.Disposable[] = [];

  private _abortController: AbortController | null = null;
  private _session: CouncilSession | null = null;

  private _deadlockResolve: ((r: { action: DeadlockResolution; selectedVersion?: string }) => void) | null = null;
  private _councilMode: CouncilMode = 'FULL';
  private _unavailableProviders: Set<string> = new Set();
  private _intensityState: IntensityState = { mode: 'ADAPTIVE', level: 'ANALYTICAL' };
  private _ledger: LedgerState = { enabled: null, consentShown: false };
  private _licenseManager!: LicenseManager;

  // ── Governed Workflow Pipeline ──────────────────────────────────────────
  private _workflowEngine: CouncilWorkflowEngine;
  private _workflowSession: CouncilWorkflowSession | null = null;
  private _useGovernedPipeline = true; // feature flag: true = new governed pipeline, false = legacy
  private _workflowEventUnsubscribers: Array<() => void> = [];

  // ── Review Runtime ───────────────────────────────────────────────────────
  private _reviewRuntime = getReviewRuntime();
  private _reviewSession: ReviewSession | null = null;
  private _lastActiveMode: 'council' | 'governed' | 'review' | null = null;
  // Context preserved from selection-triggered runs so it survives a null _session
  private _selectionFilePath = '';
  private _selectionFullFileContent = '';

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    providerManager: ProviderManager,
    licenseManager: LicenseManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._providerManager = providerManager;
    this._licenseManager = licenseManager;
    this._workflowEngine = new CouncilWorkflowEngine(providerManager);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._providerManager.onDidChangeStatus(() => { this.refreshProviderStatus(); });
    this._setWebviewMessageListener();
    this._workflowEventUnsubscribers = subscribeWorkflowEvents(this);
    this.updateContent();
  }

  public static createOrShow(extensionUri: vscode.Uri, providerManager: ProviderManager, licenseManager: LicenseManager) {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (TriForgeCouncilPanel.currentPanel) {
      TriForgeCouncilPanel.currentPanel._panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'triForgeCouncil',
      'Triforge AI Code Council',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableForms: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );
    TriForgeCouncilPanel.currentPanel = new TriForgeCouncilPanel(panel, extensionUri, providerManager, licenseManager);
  }

  public sendLicenseStatus(status: LicenseStatus): void {
    this._send({ type: 'license-status', status });
  }

  public dispose() {
    TriForgeCouncilPanel.currentPanel = undefined;
    this._abortController?.abort();
    for (const unsub of this._workflowEventUnsubscribers) { unsub(); }
    this._workflowEventUnsubscribers = [];
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  public updateContent() {
    this._panel.webview.html = this._getWebviewContent();
  }

  public async refreshProviderStatus(): Promise<void> {
    const providers = await this._providerManager.getStatus();
    const mode = await this._providerManager.detectMode();
    const status: Record<string, boolean> = {};
    for (const p of providers) { status[p.name] = p.connected; }
    this._send({ type: 'providers', status, mode: mode.mode });
  }

  /** Pre-fill prompt textarea from editor selection. */
  public insertPrompt(text: string): void {
    this._send({ type: 'insert-prompt', text });
  }

  /** Called by selection commands — pre-fills inputs and routes to the appropriate pipeline. */
  public runForSelection(
    prompt: string,
    code: string,
    intensity: string,
    filePath?: string,
    fullFileContent?: string,
    options?: {
      reviewRuntime?: boolean;
      governed?: boolean;
      mode?: ExecutionMode;
      action?: CouncilWorkflowAction;
    },
  ): void {
    // Always capture selection context so _runAuthorReviewRuntime can use it
    // even when no legacy _session object exists yet.
    this._selectionFilePath = filePath ?? '';
    this._selectionFullFileContent = fullFileContent ?? '';
    if (this._session) {
      this._session.filePath = filePath ?? '';
      this._session.fullFileContent = fullFileContent ?? '';
      this._session.contextFiles = {};
    }

    if (options?.reviewRuntime === true) {
      runAuthorReviewRuntime(this, prompt, code, intensity);
    } else if (options?.governed === true) {
      runGovernedPipeline(this,
        prompt,
        code,
        options?.mode ?? 'safe',
        options?.action ?? 'plan_then_code',
      );
    } else {
      this._send({ type: 'council-started', prompt, originalCode: code, intensity });
      runCouncilPipeline(this, prompt, code, intensity);
    }
  }

  /** Export the current session as a Markdown document. */
  public async exportDebate(): Promise<void> {
    if (this._lastActiveMode === 'review') {
      vscode.window.showWarningMessage(
        'TriForge AI: No council session to export. Export is only available after a council or governed pipeline run.',
      );
      return;
    }
    if (!this._session) {
      vscode.window.showWarningMessage('TriForge AI: No council session to export. Run a request first.');
      return;
    }
    const s = this._session;
    const lines: string[] = [
      '# Triforge AI Code Council Export',
      '',
      `**Prompt:** ${s.prompt}`,
      `**Phase:** ${s.phase}`,
      `**Consensus:** ${s.consensus ?? 'N/A'}`,
      `**Intensity:** ${s.intensity}`,
      '',
    ];
    if (s.draft) {
      lines.push(
        `## Fast Draft (by ${s.draft.provider})`, '',
        `**Reasoning:** ${s.draft.reasoning}`,
        `**Confidence:** ${s.draft.confidence}%`,
        `**Preliminary Risk:** ${s.draft.preliminaryRisk}`,
        '', '```', s.draft.code, '```', '',
      );
    }
    if (s.risk) {
      lines.push(
        '## Risk Analysis', '',
        `**Level:** ${s.risk.level}`,
        '**Triggers:**',
        ...s.risk.triggers.map(t => `- ${t}`), '',
      );
    }
    if (s.verdicts?.length) {
      lines.push('## Council Verdicts', '');
      for (const v of s.verdicts) {
        lines.push(
          `### ${v.provider}`,
          `**Decision:** ${v.agrees ? 'AGREE' : 'DISAGREE'} (${v.confidence}%)`,
          `**Risk:** ${v.riskLevel}`,
          v.objections.length ? `**Objections:**\n${v.objections.map(o => `- ${o}`).join('\n')}` : '',
          '',
        );
      }
    }
    if (s.debate) {
      lines.push(
        '## Debate Transcript', '',
        `**Proposal:** ${s.debate.proposal}`,
        `**Critique:** ${s.debate.critique}`,
        `**Revision:** ${s.debate.revision}`,
        `**Final:** ${s.debate.final}`,
        `**Confidence:** ${s.debate.confidenceInitial}% → ${s.debate.confidenceAfterCritique}% → ${s.debate.confidenceFinal}%`,
        '', '```', s.debate.finalCode, '```', '',
      );
    }
    if (s.finalCode) {
      lines.push('## Final Implementation', '', '```', s.finalCode, '```', '');
    }
    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
    await vscode.window.showTextDocument(doc);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private _send(payload: object): void {
    this._panel.webview.postMessage(payload);
  }

  // ── PanelContext implementation ───────────────────────────────────────────

  send(payload: object): void { this._send(payload); }

  getSession(): CouncilSession | null { return this._session; }
  setSession(s: CouncilSession | null): void { this._session = s; }

  get providerManager(): ProviderManager { return this._providerManager; }
  get licenseManager(): LicenseManager { return this._licenseManager; }
  get reviewRuntime() { return this._reviewRuntime; }
  get workflowEngine(): CouncilWorkflowEngine { return this._workflowEngine; }

  getIntensityState(): IntensityState { return this._intensityState; }
  setIntensityState(s: IntensityState): void { this._intensityState = s; }

  getAbortController(): AbortController | null { return this._abortController; }
  setAbortController(c: AbortController | null): void { this._abortController = c; }

  getDeadlockResolve(): ((r: { action: DeadlockResolution; selectedVersion?: string }) => void) | null { return this._deadlockResolve; }
  setDeadlockResolve(fn: ((r: { action: DeadlockResolution; selectedVersion?: string }) => void) | null): void { this._deadlockResolve = fn; }

  getUnavailableProviders(): Set<string> { return this._unavailableProviders; }

  getCouncilMode(): CouncilMode { return this._councilMode; }
  setCouncilMode(m: CouncilMode): void { this._councilMode = m; }

  getLastActiveMode(): 'council' | 'governed' | 'review' | null { return this._lastActiveMode; }
  setLastActiveMode(m: 'council' | 'governed' | 'review' | null): void { this._lastActiveMode = m; }

  getSelectionFilePath(): string { return this._selectionFilePath; }
  getSelectionFullFileContent(): string { return this._selectionFullFileContent; }

  getLedger(): LedgerState { return this._ledger; }

  getWorkflowSession(): CouncilWorkflowSession | null { return this._workflowSession; }
  setWorkflowSession(s: CouncilWorkflowSession | null): void { this._workflowSession = s; }

  getUseGovernedPipeline(): boolean { return this._useGovernedPipeline; }
  setUseGovernedPipeline(v: boolean): void { this._useGovernedPipeline = v; }

  getReviewSession(): ReviewSession | null { return this._reviewSession; }
  setReviewSession(s: ReviewSession | null): void { this._reviewSession = s; }

  getExtensionUri(): vscode.Uri { return this._extensionUri; }

  // ── Message router ────────────────────────────────────────────────────────

  private _setWebviewMessageListener() {
    attachMessageRouter(this, this._panel, this._disposables);
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private _getWebviewContent(): string {
    return buildWebviewContent();
  }
}
