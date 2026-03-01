import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ProviderManager, ProviderName } from '@triforge/engine';
import { ChangePatch } from '../core/patch';
import { LicenseManager, LicenseStatus, LS_CHECKOUT } from '../core/license';

// ── Data Contracts ─────────────────────────────────────────────────────────

type RiskLevel         = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type SessionPhase      = 'IDLE' | 'DRAFTING' | 'RISK_CHECK' | 'CRITIQUE' | 'DEBATE' | 'COMPLETE' | 'BYPASSED';
type ConsensusState    = 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'BLOCKED';
type DeadlockResolution = 'ESCALATE' | 'USER_DECIDES' | 'SYNTHESIS' | 'EXTENDED_DEBATE';
type CouncilMode       = 'FULL' | 'PARTIAL' | 'SOLO';
type IntensityLevel    = 'COOPERATIVE' | 'ANALYTICAL' | 'CRITICAL' | 'RUTHLESS';

interface IntensityState  { mode: 'ADAPTIVE' | 'LOCKED'; level: IntensityLevel; }
interface VersionCandidate { provider: string; code: string; reasoning: string; }
interface CouncilRecord {
  timestamp:         number;
  prompt:            string;
  draftAuthor:       string;
  councilMode:       CouncilMode;
  riskLevel:         RiskLevel;
  confidenceInitial: number;
  confidenceFinal:   number;
  consensus:         ConsensusState;
  intensity:         string;
  deadlockResolution?: DeadlockResolution;
  userOverride?:     boolean;
}

interface DraftResult {
  code:            string;
  reasoning:       string;
  provider:        string;
  confidence:      number;
  preliminaryRisk: RiskLevel;
}

interface RiskAnalysis {
  level:    RiskLevel;
  triggers: string[];
}

interface SeatVerdict {
  provider:         string;
  agrees:           boolean;
  riskLevel:        RiskLevel;
  confidence:       number;
  objections:       string[];
  suggestedChanges: string[];
}

interface CouncilDebate {
  proposal:                string;
  critique:                string;
  revision:                string;
  final:                   string;
  finalCode:               string;
  confidenceInitial:       number;
  confidenceAfterCritique: number;
  confidenceFinal:         number;
}

interface AlternativeProposal {
  provider:       string;
  reasoning:      string;
  implementation: string;
  riskLevel:      RiskLevel;
  confidence:     number;
}

interface CouncilSession {
  id:               string;
  prompt:           string;
  originalCode:     string;
  phase:            SessionPhase;
  draft?:           DraftResult;
  risk?:            RiskAnalysis;
  verdicts?:        SeatVerdict[];
  debate?:          CouncilDebate;
  consensus?:       ConsensusState;
  finalCode?:       string;
  alternative?:     AlternativeProposal;
  intensity:        string;
  viewMode:         'SUMMARY' | 'DEBATE';
  filePath?:        string;
  fullFileContent?: string;
  contextFiles:     Record<string, string>;
}

// ── Intensity Policy ──────────────────────────────────────────────────────

interface IntensityPolicy {
  critiquePasses:             number;
  requireVote:                boolean;
  requireUnanimousForLowRisk: boolean;
  forceAlternativeOnDissent:  boolean;
  applyDoubleConfirm:         boolean;
  confidenceThreshold:        number;
}

const INTENSITY_POLICY: Record<IntensityLevel, IntensityPolicy> = {
  COOPERATIVE: { critiquePasses: 0, requireVote: false, requireUnanimousForLowRisk: false,
                 forceAlternativeOnDissent: false, applyDoubleConfirm: false, confidenceThreshold: 0  },
  ANALYTICAL:  { critiquePasses: 1, requireVote: true,  requireUnanimousForLowRisk: false,
                 forceAlternativeOnDissent: false, applyDoubleConfirm: false, confidenceThreshold: 60 },
  CRITICAL:    { critiquePasses: 2, requireVote: true,  requireUnanimousForLowRisk: false,
                 forceAlternativeOnDissent: true,  applyDoubleConfirm: false, confidenceThreshold: 70 },
  RUTHLESS:    { critiquePasses: 2, requireVote: true,  requireUnanimousForLowRisk: true,
                 forceAlternativeOnDissent: true,  applyDoubleConfirm: true,  confidenceThreshold: 80 },
};

// ── TriForgeCouncilPanel ───────────────────────────────────────────────────

export class TriForgeCouncilPanel {
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
  private _ledgerEnabled: boolean | null = null;
  private _ledgerConsentShown = false;
  private _licenseManager!: LicenseManager;

  private static readonly _validProviders: ProviderName[] = ['openai', 'grok', 'claude'];
  private static _isValidProvider(v: unknown): v is ProviderName {
    return typeof v === 'string' && TriForgeCouncilPanel._validProviders.includes(v as ProviderName);
  }

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

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._providerManager.onDidChangeStatus(() => { this.refreshProviderStatus(); });
    this._setWebviewMessageListener();
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

  /** Called by selection commands — pre-fills inputs and auto-starts the pipeline. */
  public runForSelection(prompt: string, code: string, intensity: string, filePath?: string, fullFileContent?: string): void {
    if (this._session) {
      this._session.filePath = filePath ?? '';
      this._session.fullFileContent = fullFileContent ?? '';
      this._session.contextFiles = {};
    }
    this._send({ type: 'council-started', prompt, originalCode: code, intensity });
    this._runCouncilPipeline(prompt, code, intensity);
  }

  /** Export the current session as a Markdown document. */
  public async exportDebate(): Promise<void> {
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

  // ── Message router ────────────────────────────────────────────────────────

  private _setWebviewMessageListener() {
    this._panel.webview.onDidReceiveMessage(
      async (message: any) => {
        switch (message.command) {
          case 'council:run':
            await this._runCouncilPipeline(
              message.prompt as string,
              (message.context as string) ?? '',
              (message.intensity as string) ?? 'adaptive'
            );
            break;
          case 'council:apply':
            await this._applyFinalCode();
            break;
          case 'council:applyDraft':
            await this._applyDraftCode();
            break;
          case 'council:escalate':
            this._escalateIntensity();
            break;
          case 'council:requestAlt':
            await this._generateAlternative(message.provider as string);
            break;
          case 'council:runVoteOnAlt':
            await this._voteOnAlternative();
            break;
          case 'council:adoptAlt':
            await this._adoptAlternative();
            break;
          case 'council:abort':
            if (this._deadlockResolve) {
              this._deadlockResolve({ action: 'ESCALATE' }); // unblock pipeline
              this._deadlockResolve = null;
            }
            this._abortController?.abort();
            this._abortController = null;
            this._send({ type: 'phase', phase: 'IDLE', message: 'Aborted.' });
            break;
          case 'council:deadlock:escalate':
            if (this._deadlockResolve) {
              this._deadlockResolve({ action: 'ESCALATE' });
              this._deadlockResolve = null;
            }
            break;
          case 'council:deadlock:synthesis':
            if (this._deadlockResolve) {
              this._deadlockResolve({ action: 'SYNTHESIS' });
              this._deadlockResolve = null;
            }
            break;
          case 'council:deadlock:extended':
            if (this._deadlockResolve) {
              this._deadlockResolve({ action: 'EXTENDED_DEBATE' });
              this._deadlockResolve = null;
            }
            break;
          case 'council:deadlock:user':
            if (this._deadlockResolve) {
              this._deadlockResolve({ action: 'USER_DECIDES' });
              this._deadlockResolve = null;
            }
            break;
          case 'council:selectVersion':
            if (this._deadlockResolve) {
              this._deadlockResolve({ action: 'USER_DECIDES', selectedVersion: message.provider as string });
              this._deadlockResolve = null;
            }
            break;
          case 'council:override:apply':
            if (this._session?.finalCode) { await this._applyCode(this._session.finalCode); }
            break;
          case 'council:setIntensity':
            if (message.lock) {
              this._intensityState = { mode: 'LOCKED', level: (message.level as IntensityLevel) ?? 'ANALYTICAL' };
            } else {
              this._intensityState = { mode: 'ADAPTIVE', level: this._intensityState.level };
            }
            break;
          case 'setApiKey': {
            const name = message.provider;
            const key = message.key as string;
            if (TriForgeCouncilPanel._isValidProvider(name) && key) {
              await this._providerManager.setKey(name, key);
              await this.refreshProviderStatus();
              vscode.window.showInformationMessage(`TriForge AI: ${name} key saved.`);
            }
            break;
          }
          case 'removeApiKey': {
            const providerName = message.provider;
            if (TriForgeCouncilPanel._isValidProvider(providerName)) {
              await this._providerManager.removeKey(providerName);
              await this.refreshProviderStatus();
            }
            break;
          }
          case 'getProviders':
            await this.refreshProviderStatus();
            break;
          case 'openExternal': {
            const url = message.url as string;
            if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
            break;
          }
          case 'workspace:getTree': {
            const files = await this._getWorkspaceTree();
            this._send({ type: 'workspace-tree', files });
            break;
          }
          case 'workspace:addContext': {
            if (!this._session) { break; }
            if (!this._session.contextFiles) { this._session.contextFiles = {}; }
            const content = await this._readWorkspaceFile(message.relPath as string);
            this._session.contextFiles[message.relPath as string] = content;
            this._send({ type: 'context-updated', contextFiles: Object.keys(this._session.contextFiles) });
            break;
          }
          case 'workspace:removeContext': {
            if (!this._session?.contextFiles) { break; }
            delete this._session.contextFiles[message.relPath as string];
            this._send({ type: 'context-updated', contextFiles: Object.keys(this._session.contextFiles) });
            break;
          }
          case 'workspace:clearContext': {
            if (this._session) { this._session.contextFiles = {}; }
            this._send({ type: 'context-updated', contextFiles: [] });
            break;
          }
          case 'git:status': {
            try { this._send({ type: 'git-status', ...this._getGitStatus() }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:stageAll': {
            try { this._runGit(['add', '-A']); this._send({ type: 'git-status', ...this._getGitStatus() }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:stage': {
            try { this._runGit(['add', '--', message.file as string]); this._send({ type: 'git-status', ...this._getGitStatus() }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:unstage': {
            try { this._runGit(['restore', '--staged', '--', message.file as string]); this._send({ type: 'git-status', ...this._getGitStatus() }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:unstageAll': {
            try { this._runGit(['restore', '--staged', '.']); this._send({ type: 'git-status', ...this._getGitStatus() }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:commit': {
            try {
              const msg = (message.message as string)?.trim();
              if (!msg) { this._send({ type: 'git-error', message: 'Commit message required.' }); break; }
              this._runGit(['commit', '-m', JSON.stringify(msg)]);
              this._send({ type: 'git-committed', status: this._getGitStatus() });
            } catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:push': {
            try {
              const branch = this._runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
              const confirm = await vscode.window.showWarningMessage(
                `Push branch "${branch}" to remote origin?`, { modal: true }, 'Push', 'Cancel'
              );
              if (confirm !== 'Push') { break; }
              this._runGit(['push']);
              this._send({ type: 'git-pushed' });
              vscode.window.showInformationMessage('TriForge AI: Pushed successfully.');
            } catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:generateMessage': {
            try {
              const diff = this._runGit(['diff', '--staged']);
              if (!diff.trim()) { this._send({ type: 'git-error', message: 'No staged changes to generate message from.' }); break; }
              const providers = await this._providerManager.getActiveProviders();
              const provider = providers[0];
              if (!provider) { this._send({ type: 'git-error', message: 'No AI provider configured.' }); break; }
              this._send({ type: 'git-generating' });
              const ctrl = new AbortController();
              const msg = await provider.chat([
                { role: 'system', content: 'Write a concise git commit message (imperative mood, max 72 chars first line, optional body after blank line). Return ONLY the commit message text — no JSON, no markdown fences, no explanation.' },
                { role: 'user', content: `Generate a commit message for this diff:\n\n${diff.slice(0, 8000)}` },
              ], ctrl.signal);
              this._send({ type: 'git-message-ready', message: msg.trim() });
            } catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:branches': {
            try { this._send({ type: 'git-branches', ...this._getBranches() }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:diff': {
            try { this._send({ type: 'git-diff', diff: this._runGit(['diff', '--staged']) }); }
            catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:log': {
            try {
              const raw = this._runGit(['log', '--oneline', '-10']);
              const commits = raw.split('\n').filter(l => l.trim()).map(l => ({
                hash: l.slice(0, 7),
                message: l.slice(8).trim(),
              }));
              this._send({ type: 'git-log', commits });
            } catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:createBranch': {
            try {
              const name = (message.name as string)?.trim();
              if (!name) { this._send({ type: 'git-error', message: 'Branch name required.' }); break; }
              this._runGit(['checkout', '-b', name]);
              this._send({ type: 'git-branches', ...this._getBranches() });
              this._send({ type: 'git-status', ...this._getGitStatus() });
            } catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'git:switchBranch': {
            try {
              const name = (message.name as string)?.trim();
              if (!name) { break; }
              this._runGit(['checkout', name]);
              this._send({ type: 'git-branches', ...this._getBranches() });
              this._send({ type: 'git-status', ...this._getGitStatus() });
            } catch(e) { this._send({ type: 'git-error', message: String(e) }); }
            break;
          }
          case 'config:getModels': {
            const cfg = vscode.workspace.getConfiguration('triforgeAi');
            this._send({
              type: 'config-models',
              openai: cfg.get<string>('openai.model') || '',
              claude: cfg.get<string>('claude.model') || '',
              grok:   cfg.get<string>('grok.model')   || '',
            });
            break;
          }
          case 'config:setModel': {
            const provider = message.provider as string;
            const model    = (message.model as string)?.trim() || undefined;
            await vscode.workspace.getConfiguration('triforgeAi').update(
              `${provider}.model`, model, vscode.ConfigurationTarget.Global
            );
            this._send({ type: 'config-model-saved', provider, model: model || '' });
            break;
          }
          case 'license:getStatus': {
            const s = await this._licenseManager.getStatus();
            this._send({ type: 'license-status', status: s });
            break;
          }
          case 'license:activate': {
            this._send({ type: 'license-activating' });
            const result = await this._licenseManager.activateLicense((message.key as string)?.trim() ?? '');
            if (result.success) {
              const s = await this._licenseManager.getStatus();
              this._send({ type: 'license-status', status: s });
              vscode.window.showInformationMessage('TriForge AI: License activated.');
            } else {
              this._send({ type: 'license-error', error: result.error ?? 'Activation failed.' });
            }
            break;
          }
          case 'license:deactivate': {
            await this._licenseManager.deactivateLicense();
            const s = await this._licenseManager.getStatus();
            this._send({ type: 'license-status', status: s });
            vscode.window.showInformationMessage('TriForge AI: License removed.');
            break;
          }
          case 'openExternal': {
            vscode.env.openExternal(vscode.Uri.parse(message.url as string));
            break;
          }
        }
      },
      undefined,
      this._disposables
    );
  }

  // ── Council pipeline ──────────────────────────────────────────────────────

  private async _runCouncilPipeline(
    prompt: string, originalCode: string, intensity: string
  ): Promise<void> {
    // License gate: council mode (2+ providers) requires trial or active license
    const allProviders = await this._providerManager.getActiveProviders();
    if (allProviders.length >= 2) {
      const lic = await this._licenseManager.getStatus();
      if (!lic.isCouncilAllowed) {
        this._send({
          type: 'license-gate',
          message: 'Your 1-day trial has ended. Subscribe to TriForge AI Code Council to unlock full multi-model deliberation. Solo mode (1 provider) is always free.',
          checkoutUrl: LS_CHECKOUT,
        });
        return;
      }
    }

    this._abortController?.abort();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // Apply intensity from UI if not already locked
    if (this._intensityState.mode === 'ADAPTIVE') {
      // keep current adaptive level; will be resolved after risk
    }

    this._session = {
      id: Date.now().toString(36), prompt,
      originalCode: originalCode ?? '',
      phase: 'DRAFTING', intensity: this._intensityState.level.toLowerCase(), viewMode: 'SUMMARY',
      contextFiles: this._session?.contextFiles ?? {},
      filePath: this._session?.filePath,
      fullFileContent: this._session?.fullFileContent,
    };

    // Quorum detection
    this._unavailableProviders.clear();
    const activeProviders = await this._providerManager.getActiveProviders();
    this._councilMode =
      activeProviders.length >= 3 ? 'FULL' :
      activeProviders.length === 2 ? 'PARTIAL' : 'SOLO';
    this._send({ type: 'council-mode', mode: this._councilMode });

    try {
      // Phase 1: Fast Draft
      this._send({ type: 'phase', phase: 'DRAFTING', message: 'Generating fast draft\u2026' });
      const draft = await this._generateFastDraft(prompt, originalCode, signal);
      if (signal.aborted) { return; }
      this._session.draft = draft;
      this._send({ type: 'draft-ready', draft });

      // Phase 2: Local Risk Analysis
      this._send({ type: 'phase', phase: 'RISK_CHECK', message: 'Analysing risk\u2026' });
      const risk = this._analyzeRisk(draft.code);
      this._session.risk = risk;
      this._send({ type: 'risk-result', risk });

      // Adaptive intensity resolution (after risk, before critique)
      if (this._intensityState.mode === 'ADAPTIVE') {
        const fp = vscode.window.activeTextEditor?.document.fileName ?? '';
        this._intensityState.level = this._determineIntensity(fp, risk);
        this._send({
          type: 'intensity-resolved',
          level: this._intensityState.level,
          reason: this._buildIntensityReason(fp, risk),
        });
        if (this._session) { this._session.intensity = this._intensityState.level.toLowerCase(); }
      }
      const effectiveIntensity = this._intensityState.level.toLowerCase();
      const policy = INTENSITY_POLICY[this._intensityState.level];

      // SOLO mode: skip critique (no cross-review possible)
      if (this._councilMode === 'SOLO') {
        this._session.phase = 'COMPLETE';
        this._session.consensus = 'UNANIMOUS';
        this._session.finalCode = draft.code;
        this._send({ type: 'session-complete', consensus: 'UNANIMOUS', finalCode: draft.code, verdicts: [] });
        this._checkLedgerConsent();
        this._saveLedgerRecord({
          timestamp: Date.now(), prompt, draftAuthor: draft.provider,
          councilMode: 'SOLO', riskLevel: risk.level,
          confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
          consensus: 'UNANIMOUS', intensity: effectiveIntensity,
        });
        return;
      }

      // Policy-driven fast path: no vote required + low risk
      if (!policy.requireVote && risk.level === 'LOW') {
        this._session.phase = 'COMPLETE';
        this._session.consensus = 'UNANIMOUS';
        this._session.finalCode = draft.code;
        this._send({ type: 'session-complete', consensus: 'UNANIMOUS', finalCode: draft.code, verdicts: [] });
        this._checkLedgerConsent();
        this._saveLedgerRecord({
          timestamp: Date.now(), prompt, draftAuthor: draft.provider,
          councilMode: this._councilMode, riskLevel: risk.level,
          confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
          consensus: 'UNANIMOUS', intensity: effectiveIntensity,
        });
        return;
      }

      // Phase 3: Cross-Critique
      this._send({ type: 'phase', phase: 'CRITIQUE', message: 'Council review initiated\u2026' });
      let verdicts = await this._runCrossCritique(prompt, draft, originalCode, signal);
      if (signal.aborted) { return; }

      // Second critique pass (CRITICAL/RUTHLESS)
      if (policy.critiquePasses >= 2 && verdicts.length > 0 && !signal.aborted) {
        this._send({ type: 'phase', phase: 'CRITIQUE', message: 'Second critique pass\u2026' });
        verdicts = await this._runSecondCritiquePass(prompt, draft, verdicts, originalCode, signal);
        if (signal.aborted) { return; }
      }
      this._session.verdicts = verdicts;

      let interimConsensus = this._computeConsensus(verdicts);

      // RUTHLESS: critical objection takes priority over deadlock
      if (this._intensityState.level === 'RUTHLESS' && this._hasCriticalObjection(verdicts)) {
        await this._handleCriticalObjection(prompt, draft, verdicts, originalCode, signal);
        return;
      }

      // Deadlock resolution (SPLIT or BLOCKED — SOLO already returned above)
      let deadlockResolution: DeadlockResolution | undefined;
      let userOverride = false;
      if (interimConsensus === 'SPLIT' || interimConsensus === 'BLOCKED') {
        // Collect alternative versions from disagreeing critics
        const versions: VersionCandidate[] = [{ provider: draft.provider, code: draft.code, reasoning: draft.reasoning }];
        for (const v of verdicts.filter(v2 => !v2.agrees)) {
          const alt = await this._generateAlternativeQuiet(v.provider, prompt, draft.code, originalCode, signal);
          if (alt) { versions.push(alt); }
        }
        if (signal.aborted) { return; }
        this._send({ type: 'deadlock', versions });

        const resolution = await this._waitForDeadlockResolution(signal);
        if (signal.aborted) { return; }
        deadlockResolution = resolution.action;

        let finalCode = draft.code;
        if (resolution.action === 'ESCALATE') {
          // Bump intensity one step and re-run critique
          const lvls: IntensityLevel[] = ['COOPERATIVE', 'ANALYTICAL', 'CRITICAL', 'RUTHLESS'];
          const ci = lvls.indexOf(this._intensityState.level);
          if (ci < lvls.length - 1) { this._intensityState.level = lvls[ci + 1]; }
          this._send({ type: 'phase', phase: 'CRITIQUE', message: 'Escalated intensity. Re-reviewing\u2026' });
          verdicts = await this._runCrossCritique(prompt, draft, originalCode, signal);
          if (signal.aborted) { return; }
          this._session.verdicts = verdicts;
          interimConsensus = this._computeConsensus(verdicts);
          finalCode = draft.code;
        } else if (resolution.action === 'USER_DECIDES') {
          const chosen = versions.find(v => v.provider === resolution.selectedVersion);
          finalCode = chosen?.code ?? draft.code;
          userOverride = true;
          interimConsensus = 'MAJORITY';
        } else if (resolution.action === 'SYNTHESIS') {
          finalCode = await this._runForceSynthesis(prompt, versions, signal);
          if (signal.aborted) { return; }
          interimConsensus = 'MAJORITY';
        } else if (resolution.action === 'EXTENDED_DEBATE') {
          finalCode = await this._runExtendedDebate(prompt, versions, signal);
          if (signal.aborted) { return; }
          interimConsensus = 'MAJORITY';
        }

        this._session.phase = 'COMPLETE';
        this._session.finalCode = finalCode;
        this._session.consensus = interimConsensus;
        this._send({ type: 'session-complete', consensus: interimConsensus, finalCode, verdicts });
        this._checkLedgerConsent();
        this._saveLedgerRecord({
          timestamp: Date.now(), prompt, draftAuthor: draft.provider,
          councilMode: this._councilMode, riskLevel: risk.level,
          confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
          consensus: interimConsensus, intensity: effectiveIntensity,
          deadlockResolution, userOverride,
        });
        return;
      }

      // Phase 4: Debate — trigger on majority dissent OR high intensity OR low confidence
      const avgConf = verdicts.length
        ? verdicts.reduce((s, v) => s + v.confidence, 0) / verdicts.length : 100;
      let finalCode = draft.code;
      if (
        verdicts.length >= 2 &&
        (interimConsensus === 'MAJORITY' ||
         effectiveIntensity === 'critical' || effectiveIntensity === 'ruthless' ||
         (policy.confidenceThreshold > 0 && avgConf < policy.confidenceThreshold))
      ) {
        this._send({ type: 'phase', phase: 'DEBATE', message: 'Strategist revising implementation\u2026' });
        const debate = await this._runDebatePipeline(prompt, draft, verdicts, originalCode, signal);
        if (!signal.aborted && debate) {
          this._session.debate = debate;
          this._send({ type: 'debate-complete', debate });
          finalCode = debate.finalCode || draft.code;
        }
      }

      if (signal.aborted) { return; }

      // Phase 5: Complete
      this._session.phase = 'COMPLETE';
      this._session.finalCode = finalCode;
      const finalConsensus = this._computeConsensus(verdicts);
      this._session.consensus = finalConsensus;
      this._send({ type: 'session-complete', consensus: finalConsensus, finalCode, verdicts });
      this._checkLedgerConsent();
      this._saveLedgerRecord({
        timestamp: Date.now(), prompt, draftAuthor: draft.provider,
        councilMode: this._councilMode, riskLevel: risk.level,
        confidenceInitial: draft.confidence,
        confidenceFinal: this._session.debate?.confidenceFinal ?? draft.confidence,
        consensus: finalConsensus, intensity: effectiveIntensity,
        deadlockResolution, userOverride,
      });

    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted) { return; }
      this._send({ type: 'error', message: err?.message ?? 'Council pipeline failed.' });
    } finally {
      this._abortController = null;
    }
  }

  private async _generateFastDraft(
    prompt: string, originalCode: string, signal: AbortSignal
  ): Promise<DraftResult> {
    const providers = await this._providerManager.getActiveProviders();
    if (providers.length === 0) {
      throw new Error('No API keys configured. Add at least one provider key in Settings.');
    }
    const primary =
      providers.find(p => p.name === 'grok') ??
      providers.find(p => p.name === 'openai') ??
      providers[0];

    const systemPrompt =
      'You are the Strategist. Generate a production-ready implementation.\n' +
      'Return ONLY valid JSON \u2014 no markdown fences, no text outside the JSON object:\n' +
      '{"code":"...","reasoning":"2-3 sentences","confidence":0-100,' +
      '"preliminaryRisk":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"}';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Task: ${prompt}\n\nOriginal context:\n${originalCode || '(empty \u2014 new implementation)'}${this._buildContextBlock()}` },
    ];

    // Try providers in order, skipping timed-out ones
    const ordered = [
      providers.find(p => p.name === 'grok'),
      providers.find(p => p.name === 'openai'),
      providers.find(p => p.name === 'claude'),
      ...providers,
    ].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i) as typeof providers;

    let raw: string | null = null;
    let chosenProvider = primary;
    for (const p of ordered) {
      if (this._unavailableProviders.has(p.name)) { continue; }
      raw = await this._withTimeout(() => p.chat(messages as any, signal), p.name, signal);
      if (raw !== null) { chosenProvider = p; break; }
    }
    if (raw === null) {
      throw new Error('All providers timed out. Check your connection and API keys.');
    }

    const parsed = this._parseJson<{
      code: string; reasoning: string; confidence: number; preliminaryRisk: string;
    }>(raw);
    return {
      code:            parsed.code ?? '',
      reasoning:       parsed.reasoning ?? '',
      provider:        chosenProvider.name,
      confidence:      typeof parsed.confidence === 'number' ? parsed.confidence : 75,
      preliminaryRisk: (parsed.preliminaryRisk as RiskLevel) ?? 'MEDIUM',
    };
  }

  private _analyzeRisk(code: string): RiskAnalysis {
    const triggers: string[] = [];
    if (/eval\(|execSync|child_process/.test(code))
      triggers.push('Security: code execution pattern');
    if (/password|apiKey|secret|privateKey/i.test(code) && /=\s*['"]/.test(code))
      triggers.push('Security: potential secret hardcoding');
    if (/SELECT|INSERT|UPDATE|DELETE/i.test(code) && /\+/.test(code))
      triggers.push('Security: SQL concatenation risk');
    if (/export\s+(default\s+)?(class|function|const|interface)/.test(code))
      triggers.push('Public API surface change');
    if (/rm\s+-rf|DROP\s+TABLE|delete\s+\w+\s*\(/i.test(code))
      triggers.push('Destructive operation');
    if (code.split('\n').length > 120)
      triggers.push(`High complexity: ${code.split('\n').length} lines`);
    if (/\.then\(.*\.then\(/s.test(code))
      triggers.push('Async: nested promise chains');
    const level: RiskLevel =
      triggers.length === 0 ? 'LOW' :
      triggers.length <= 2  ? 'MEDIUM' :
      triggers.length <= 4  ? 'HIGH' : 'CRITICAL';
    return { level, triggers };
  }

  private async _runCrossCritique(
    prompt: string, draft: DraftResult, originalCode: string, signal: AbortSignal
  ): Promise<SeatVerdict[]> {
    const providers = await this._providerManager.getActiveProviders();
    let critics = providers.filter(p => p.name !== draft.provider);
    if (critics.length === 0) { critics = [...providers]; }

    const systemPromptBase =
      'You are reviewing code proposed by another AI. Return ONLY valid JSON \u2014 no markdown fences:\n' +
      '{"agrees":true|false,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100,' +
      '"objections":["..."],"suggestedChanges":["..."]}\n' +
      'Be concise. Only set "agrees":false for genuine problems.';

    const userMessage =
      `Original task: ${prompt}\n\nProposed implementation:\n\`\`\`\n${draft.code}\n\`\`\`\n\n` +
      `Original code:\n${originalCode || '(new implementation)'}${this._buildContextBlock()}`;

    const results = await Promise.all(critics.map(async (critic): Promise<SeatVerdict | null> => {
      if (this._unavailableProviders.has(critic.name)) { return null; }
      const systemPrompt = systemPromptBase + this._getProviderDirective(critic.name, this._intensityState.level);
      try {
        const raw = await this._withTimeout(() => critic.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ] as any, signal), critic.name, signal);
        if (raw === null) { return null; } // timed out
        const parsed = this._parseJson<{
          agrees: boolean; riskLevel: string; confidence: number;
          objections: string[]; suggestedChanges: string[];
        }>(raw);
        const verdict: SeatVerdict = {
          provider:         critic.name,
          agrees:           typeof parsed.agrees === 'boolean' ? parsed.agrees : true,
          riskLevel:        (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
          confidence:       typeof parsed.confidence === 'number' ? parsed.confidence : 70,
          objections:       Array.isArray(parsed.objections)       ? parsed.objections       : [],
          suggestedChanges: Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [],
        };
        this._send({ type: 'verdict', verdict });
        return verdict;
      } catch (err: any) {
        if (signal.aborted) { throw err; }
        const fallback: SeatVerdict = {
          provider: critic.name, agrees: true, riskLevel: 'LOW',
          confidence: 60, objections: [], suggestedChanges: [],
        };
        this._send({ type: 'verdict', verdict: fallback });
        return fallback;
      }
    }));
    return results.filter((v): v is SeatVerdict => v !== null);
  }

  private async _runDebatePipeline(
    prompt: string, draft: DraftResult, verdicts: SeatVerdict[], originalCode: string, signal: AbortSignal
  ): Promise<CouncilDebate | null> {
    const providers = await this._providerManager.getActiveProviders();
    if (providers.length === 0) { return null; }

    const disagreeing = verdicts.filter(v => !v.agrees);
    const critiqueText = disagreeing.length > 0
      ? disagreeing.map(v => `${v.provider}: ${v.objections.join('; ')}`).join('\n')
      : verdicts.map(v => `${v.provider} (suggestions): ${v.suggestedChanges.join('; ')}`).join('\n');

    const strategist = providers.find(p => p.name === draft.provider) ?? providers[0];

    const strategistDirective = this._getProviderDirective(strategist.name, this._intensityState.level)
      .replace('challenger', 'strategist').replace('architect', 'strategist');
    const systemPrompt =
      'You are the Strategist revising your implementation based on council feedback.\n' +
      'Return ONLY valid JSON \u2014 no markdown fences:\n' +
      '{"proposal":"...","critique":"...","revision":"...","final":"...",'+
      '"finalCode":"...full revised code...","confidenceInitial":0-100,' +
      '"confidenceAfterCritique":0-100,"confidenceFinal":0-100}' +
      strategistDirective;

    try {
      const raw = await strategist.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content:
          `Original task: ${prompt}\n\nYour original implementation:\n\`\`\`\n${draft.code}\n\`\`\`\n\n` +
          `Council critique:\n${critiqueText}\n\nRevise addressing the concerns. ` +
          `If objections are invalid, explain why and keep original.${this._buildContextBlock()}` },
      ], signal);
      const parsed = this._parseJson<CouncilDebate>(raw);
      return {
        proposal:                parsed.proposal                ?? '',
        critique:                parsed.critique                ?? '',
        revision:                parsed.revision                ?? '',
        final:                   parsed.final                   ?? '',
        finalCode:               parsed.finalCode               ?? draft.code,
        confidenceInitial:       typeof parsed.confidenceInitial       === 'number' ? parsed.confidenceInitial       : draft.confidence,
        confidenceAfterCritique: typeof parsed.confidenceAfterCritique === 'number' ? parsed.confidenceAfterCritique : draft.confidence - 5,
        confidenceFinal:         typeof parsed.confidenceFinal         === 'number' ? parsed.confidenceFinal         : draft.confidence + 5,
      };
    } catch (err: any) {
      if (signal.aborted) { throw err; }
      return null;
    }
  }

  private _computeConsensus(verdicts: SeatVerdict[]): ConsensusState {
    if (verdicts.length === 0) { return 'UNANIMOUS'; }
    const agrees   = verdicts.filter(v => v.agrees).length;
    const disagrees = verdicts.length - agrees;
    if (disagrees === 0)      { return 'UNANIMOUS'; }
    if (agrees > disagrees)   { return 'MAJORITY';  }
    if (agrees === disagrees) { return 'SPLIT';     }
    return 'BLOCKED';
  }

  // ── Code application ──────────────────────────────────────────────────────

  private async _applyFinalCode(): Promise<void> {
    if (!this._session?.finalCode) {
      this._send({ type: 'error', message: 'No final code to apply.' });
      return;
    }
    await this._applyCode(this._session.finalCode);
  }

  private async _applyDraftCode(): Promise<void> {
    if (!this._session?.draft?.code) {
      this._send({ type: 'error', message: 'No draft code to apply.' });
      return;
    }
    this._abortController?.abort();
    this._abortController = null;
    if (this._session) { this._session.phase = 'BYPASSED'; }
    this._send({ type: 'phase', phase: 'BYPASSED', message: 'Draft applied \u2014 council bypassed.' });
    await this._applyCode(this._session!.draft!.code);
  }

  private async _applyCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('TriForge AI: Open a file in the editor to apply code.');
      return;
    }

    // Open VS Code diff editor so the user can preview proposed changes
    const newDoc = await vscode.workspace.openTextDocument({
      content: code,
      language: editor.document.languageId,
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      editor.document.uri,
      newDoc.uri,
      'TriForge AI \u2014 Proposed Changes'
    );

    const risk      = this._session?.risk?.level ?? '\u2014';
    const consensus = this._session?.consensus ?? '\u2014';
    const conf      = this._session?.draft?.confidence ?? '\u2014';
    const choice = await vscode.window.showInformationMessage(
      `Apply TriForge patch?\n\nRisk: ${risk}  |  Consensus: ${consensus}  |  Confidence: ${conf}%  |  Council: ${this._councilMode}`,
      { modal: true }, 'Apply', 'Cancel'
    );
    if (choice !== 'Apply') {
      this._send({ type: 'apply-cancelled' });
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      return;
    }

    // RUTHLESS: second confirmation modal
    if (this._intensityState.level === 'RUTHLESS') {
      const second = await vscode.window.showWarningMessage(
        `RUTHLESS mode \u2014 final confirmation.\n\nRisk: ${risk}  |  Council: ${this._councilMode}\nThis code passed adversarial scrutiny. Apply anyway?`,
        { modal: true }, 'Confirm Apply', 'Cancel'
      );
      if (second !== 'Confirm Apply') {
        this._send({ type: 'apply-cancelled' });
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        return;
      }
    }

    // Refocus original file, apply, close diff tab
    await vscode.window.showTextDocument(editor.document);
    await editor.edit(b => {
      const doc = editor.document;
      b.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), code);
    });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const fp = path.basename(editor.document.fileName);
    this._send({ type: 'apply-done', filePath: fp });
    vscode.window.showInformationMessage(`TriForge AI: Code applied to ${fp}`);
  }

  private _escalateIntensity(): void {
    if (!this._session) { return; }
    const levels = ['analytical', 'combative', 'ruthless'];
    const idx = levels.indexOf(this._session.intensity);
    if (idx < levels.length - 1) {
      this._session.intensity = levels[idx + 1];
      this._send({ type: 'escalated', intensity: this._session.intensity });
    } else {
      this._send({ type: 'error', message: 'Already at maximum intensity (ruthless).' });
    }
  }

  private async _generateAlternative(provider: string): Promise<void> {
    if (!this._session || !TriForgeCouncilPanel._isValidProvider(provider)) { return; }
    const p = await this._providerManager.getProvider(provider as ProviderName);
    if (!p) {
      this._send({ type: 'error', message: `${provider} is not configured.` });
      return;
    }
    const dissenting = this._session.verdicts?.find(v => v.provider === provider && !v.agrees);
    const objectionText = dissenting
      ? dissenting.objections.join('; ')
      : 'General dissent with proposed implementation';

    try {
      this._abortController = new AbortController();
      const raw = await p.chat([
        { role: 'system', content:
          'You raised objections to the proposed implementation. Now provide your alternative.\n' +
          'Return ONLY valid JSON \u2014 no markdown fences:\n' +
          '{"reasoning":"why your approach is better (2-3 sentences)","implementation":"...complete code...",' +
          '"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100}' },
        { role: 'user', content:
          `Task: ${this._session.prompt}\n\nRejected implementation:\n\`\`\`\n${this._session.draft?.code ?? ''}\n\`\`\`\n\n` +
          `Your objections: ${objectionText}\n\nNow provide your complete alternative implementation.` },
      ], this._abortController.signal);

      const parsed = this._parseJson<{
        reasoning: string; implementation: string; riskLevel: string; confidence: number;
      }>(raw);
      const alt: AlternativeProposal = {
        provider,
        reasoning:      parsed.reasoning      ?? '',
        implementation: parsed.implementation ?? '',
        riskLevel:      (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
        confidence:     typeof parsed.confidence === 'number' ? parsed.confidence : 70,
      };
      if (this._session) { this._session.alternative = alt; }
      this._send({ type: 'alternative-ready', alternative: alt });
    } catch (err: any) {
      if (!this._abortController?.signal.aborted) {
        this._send({ type: 'error', message: err?.message ?? 'Failed to generate alternative.' });
      }
    } finally {
      this._abortController = null;
    }
  }

  private async _voteOnAlternative(): Promise<void> {
    if (!this._session?.alternative) { return; }
    const alt = this._session.alternative;
    const altDraft: DraftResult = {
      code: alt.implementation, reasoning: alt.reasoning,
      provider: alt.provider, confidence: alt.confidence,
      preliminaryRisk: alt.riskLevel,
    };
    if (this._session) { this._session.draft = altDraft; this._session.alternative = undefined; }
    this._send({ type: 'draft-ready', draft: altDraft });

    this._abortController = new AbortController();
    try {
      const verdicts = await this._runCrossCritique(
        this._session!.prompt, altDraft, this._session!.originalCode, this._abortController.signal
      );
      if (this._session) { this._session.verdicts = verdicts; }
      const consensus = this._computeConsensus(verdicts);
      if (this._session) { this._session.consensus = consensus; this._session.finalCode = alt.implementation; }
      this._send({ type: 'session-complete', consensus, finalCode: alt.implementation, verdicts });
    } catch (err: any) {
      if (!this._abortController?.signal.aborted) {
        this._send({ type: 'error', message: err?.message ?? 'Vote on alternative failed.' });
      }
    } finally {
      this._abortController = null;
    }
  }

  private async _adoptAlternative(): Promise<void> {
    if (!this._session?.alternative) { return; }
    const code = this._session.alternative.implementation;
    if (this._session) { this._session.finalCode = code; }
    await this._applyCode(code);
  }

  // ── JSON parsing ──────────────────────────────────────────────────────────

  private _parseJson<T>(raw: string): Partial<T> {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { text = fence[1].trim(); }
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) { text = text.slice(start, end + 1); }
    try { return JSON.parse(text) as T; } catch { return {} as Partial<T>; }
  }

  // ── Provider timeout wrapper ───────────────────────────────────────────────

  private async _withTimeout<T>(fn: () => Promise<T>, provider: string, signal: AbortSignal, ms = 8000): Promise<T | null> {
    if (this._unavailableProviders.has(provider)) { return null; }
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => {
        this._unavailableProviders.add(provider);
        this._send({ type: 'provider-offline', provider });
        resolve(null);
      }, ms);
      fn().then(v => { clearTimeout(timer); resolve(v); })
         .catch(err => {
           clearTimeout(timer);
           if (err?.name === 'AbortError' || signal.aborted) { resolve(null); }
           else { resolve(null); } // treat errors as unavailable for this call
         });
    });
  }

  // ── Adaptive intensity ────────────────────────────────────────────────────

  private _determineIntensity(filePath: string, risk: RiskAnalysis): IntensityLevel {
    if (risk.level === 'CRITICAL') { return 'RUTHLESS'; }
    if (/auth|token|jwt|payment|secret|vault/i.test(filePath)) { return 'CRITICAL'; }
    if (risk.level === 'HIGH') { return 'CRITICAL'; }
    if (/\.test\.|\.spec\.|__tests__|\.stories\.|\.md$|\.txt$/i.test(filePath)) { return 'COOPERATIVE'; }
    return 'ANALYTICAL';
  }

  private _buildIntensityReason(filePath: string, risk: RiskAnalysis): string {
    if (risk.level === 'CRITICAL') { return 'Risk level is CRITICAL \u2014 maximum scrutiny required.'; }
    if (/auth|token|jwt|payment|secret|vault/i.test(filePath)) { return 'Security-sensitive file detected in path.'; }
    if (risk.level === 'HIGH') { return 'Risk level is HIGH \u2014 elevated scrutiny applied.'; }
    if (/\.test\.|\.spec\.|__tests__|\.stories\./i.test(filePath)) { return 'Test/story file \u2014 cooperative review.'; }
    if (/\.md$|\.txt$/i.test(filePath)) { return 'Documentation file \u2014 cooperative review.'; }
    return 'Standard analytical review.';
  }

  // ── Git Integration ───────────────────────────────────────────────────────

  private _runGit(args: string[]): string {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) { throw new Error('No workspace folder open.'); }
    return execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf8', timeout: 10000 });
  }

  private _getGitStatus(): { staged: string[], modified: string[], untracked: string[], branch: string } {
    const output = this._runGit(['status', '--porcelain']);
    const branch = this._runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
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

  private _getBranches(): { current: string; all: string[] } {
    const raw = this._runGit(['branch']);
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

  // ── Workspace File Awareness ─────────────────────────────────────────────

  private _getRelPath(absPath: string): string {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return ws ? path.relative(ws, absPath).replace(/\\/g, '/') : path.basename(absPath);
  }

  private async _getWorkspaceTree(): Promise<{rel: string, lang: string}[]> {
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

  private async _readWorkspaceFile(relPath: string): Promise<string> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { return ''; }
    try {
      const uri = vscode.Uri.joinPath(ws.uri, relPath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf8').split('\n').slice(0, 300).join('\n');
    } catch { return ''; }
  }

  private _buildContextBlock(): string {
    const parts: string[] = [];
    if (this._session?.fullFileContent && this._session.filePath) {
      const rel = this._getRelPath(this._session.filePath);
      const lines = this._session.fullFileContent.split('\n').slice(0, 200).join('\n');
      parts.push(`### Current File: ${rel}\n\`\`\`\n${lines}\n\`\`\``);
    }
    for (const [rel, content] of Object.entries(this._session?.contextFiles ?? {})) {
      parts.push(`### Context: ${rel}\n\`\`\`\n${content}\n\`\`\``);
    }
    return parts.length ? '\n\n## Workspace Context\n' + parts.join('\n\n') : '';
  }

  // ── Provider Directives ───────────────────────────────────────────────────

  private _getProviderDirective(provider: string, intensity: IntensityLevel): string {
    if (provider === 'grok') {
      const m: Record<IntensityLevel, string> = {
        COOPERATIVE: 'Light edge-case suggestions only. Do not reject.',
        ANALYTICAL:  'Moderate skepticism. Identify structural weaknesses and flag performance issues.',
        CRITICAL:    'Actively search for failure cases. Challenge assumptions. Identify scaling risks. Question architectural decisions.',
        RUTHLESS:    'Assume adversarial conditions. Attempt to break this implementation. Simulate misuse scenarios. Reject if fundamental flaws exist. Provide concrete fixes for every objection.',
      };
      return `\nIntensity directive for your role as challenger: ${m[intensity]}`;
    }
    if (provider === 'claude') {
      const m: Record<IntensityLevel, string> = {
        COOPERATIVE: 'Minimal critique. Accept if generally sound.',
        ANALYTICAL:  'Moderate architectural depth. Flag structural concerns and maintainability issues.',
        CRITICAL:    'Deep multi-layer structural and scalability analysis. Long-term maintainability focus.',
        RUTHLESS:    'Maximum reasoning depth. Model long-term scaling and systemic risk. Remain calm and precise.',
      };
      return `\nIntensity directive for your role as architect: ${m[intensity]}`;
    }
    return '\nProvide balanced, structured engineering review.';
  }

  // ── Second Critique Pass ──────────────────────────────────────────────────

  private async _runSecondCritiquePass(
    prompt: string, draft: DraftResult, firstVerdicts: SeatVerdict[], originalCode: string, signal: AbortSignal
  ): Promise<SeatVerdict[]> {
    const providers = await this._providerManager.getActiveProviders();
    let critics = providers.filter(p => p.name !== draft.provider);
    if (critics.length === 0) { critics = [...providers]; }

    const firstVerdictSummary = firstVerdicts.map(v =>
      `${v.provider}: ${v.agrees ? 'AGREE' : 'DISAGREE'} (${v.confidence}%)${v.objections.length ? ' — ' + v.objections.slice(0, 2).join('; ') : ''}`
    ).join('\n');

    const systemPrompt =
      'You are reviewing code in a second critique pass. The council has already provided first-pass verdicts.\n' +
      'Return ONLY valid JSON \u2014 no markdown fences:\n' +
      '{"agrees":true|false,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100,' +
      '"objections":["..."],"suggestedChanges":["..."]}\n' +
      'Refine your analysis based on the collective first-pass findings.';

    const userMessage =
      `Original task: ${prompt}\n\nProposed implementation:\n\`\`\`\n${draft.code}\n\`\`\`\n\n` +
      `Original code:\n${originalCode || '(new implementation)'}\n\n` +
      `First-pass council verdicts:\n${firstVerdictSummary}\n\n` +
      `Provide your final verdict accounting for the council's prior analysis.${this._buildContextBlock()}`;

    const results = await Promise.all(critics.map(async (critic): Promise<SeatVerdict | null> => {
      if (this._unavailableProviders.has(critic.name)) { return null; }
      const directive = this._getProviderDirective(critic.name, this._intensityState.level);
      const sp = systemPrompt + directive;
      try {
        const raw = await this._withTimeout(() => critic.chat([
          { role: 'system', content: sp },
          { role: 'user', content: userMessage },
        ] as any, signal), critic.name, signal);
        if (raw === null) { return null; }
        const parsed = this._parseJson<{
          agrees: boolean; riskLevel: string; confidence: number;
          objections: string[]; suggestedChanges: string[];
        }>(raw);
        const verdict: SeatVerdict = {
          provider:         critic.name,
          agrees:           typeof parsed.agrees === 'boolean' ? parsed.agrees : true,
          riskLevel:        (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
          confidence:       typeof parsed.confidence === 'number' ? parsed.confidence : 70,
          objections:       Array.isArray(parsed.objections) ? parsed.objections : [],
          suggestedChanges: Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [],
        };
        this._send({ type: 'verdict', verdict });
        return verdict;
      } catch (err: any) {
        if (signal.aborted) { throw err; }
        return null;
      }
    }));
    const filtered = results.filter((v): v is SeatVerdict => v !== null);
    return filtered.length > 0 ? filtered : firstVerdicts;
  }

  // ── Critical Objection (RUTHLESS) ─────────────────────────────────────────

  private _hasCriticalObjection(verdicts: SeatVerdict[]): boolean {
    return verdicts.some(v => !v.agrees || v.riskLevel === 'CRITICAL');
  }

  private async _handleCriticalObjection(
    prompt: string, draft: DraftResult, verdicts: SeatVerdict[], originalCode: string, signal: AbortSignal
  ): Promise<void> {
    const objector = verdicts.find(v => !v.agrees || v.riskLevel === 'CRITICAL');
    const objectionSummary = objector?.objections?.slice(0, 3).join('; ') ?? 'Critical risk detected in implementation.';
    const versions: VersionCandidate[] = [{ provider: draft.provider, code: draft.code, reasoning: draft.reasoning }];
    for (const v of verdicts.filter(v2 => !v2.agrees)) {
      const alt = await this._generateAlternativeQuiet(v.provider, prompt, draft.code, originalCode, signal);
      if (alt) { versions.push(alt); }
    }
    if (signal.aborted) { return; }
    this._send({ type: 'critical-objection', objector: objector?.provider ?? '', objectionSummary, versions });
    const resolution = await this._waitForDeadlockResolution(signal);
    if (signal.aborted) { return; }
    let finalCode = draft.code;
    const userOverride = resolution.action === 'USER_DECIDES';
    if (resolution.action === 'USER_DECIDES') {
      finalCode = versions.find(v => v.provider === resolution.selectedVersion)?.code ?? draft.code;
    } else if (resolution.action === 'SYNTHESIS') {
      finalCode = await this._runForceSynthesis(prompt, versions, signal);
    } else if (resolution.action === 'EXTENDED_DEBATE') {
      finalCode = await this._runExtendedDebate(prompt, versions, signal);
    }
    if (signal.aborted) { return; }
    if (this._session) { this._session.finalCode = finalCode; this._session.consensus = 'MAJORITY'; }
    this._send({ type: 'session-complete', consensus: 'MAJORITY', finalCode, verdicts });
    this._checkLedgerConsent();
    this._saveLedgerRecord({
      timestamp: Date.now(), prompt, draftAuthor: draft.provider,
      councilMode: this._councilMode, riskLevel: this._session?.risk?.level ?? 'HIGH',
      confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
      consensus: 'MAJORITY', intensity: this._intensityState.level.toLowerCase(),
      deadlockResolution: resolution.action, userOverride,
    });
  }

  // ── Deadlock resolution ───────────────────────────────────────────────────

  private _waitForDeadlockResolution(signal: AbortSignal): Promise<{ action: DeadlockResolution; selectedVersion?: string }> {
    return new Promise((resolve) => {
      this._deadlockResolve = resolve;
      signal.addEventListener('abort', () => {
        this._deadlockResolve = null;
        resolve({ action: 'ESCALATE' });
      }, { once: true });
    });
  }

  /** Silent alternative generator for deadlock version collection. */
  private async _generateAlternativeQuiet(
    provider: string, prompt: string, draftCode: string, originalCode: string, signal: AbortSignal
  ): Promise<VersionCandidate | null> {
    if (!TriForgeCouncilPanel._isValidProvider(provider)) { return null; }
    const p = await this._providerManager.getProvider(provider as ProviderName);
    if (!p || this._unavailableProviders.has(provider)) { return null; }
    try {
      const raw = await this._withTimeout(() => p.chat([
        { role: 'system', content:
          'You objected to the proposed implementation. Now provide your alternative.\n' +
          'Return ONLY valid JSON \u2014 no markdown fences:\n' +
          '{"reasoning":"why better (1-2 sentences)","code":"...complete implementation..."}' },
        { role: 'user', content:
          `Task: ${prompt}\n\nRejected:\n\`\`\`\n${draftCode}\n\`\`\`\n\nOriginal:\n${originalCode || '(new)'}\n\nYour alternative:` },
      ] as any, signal), provider, signal);
      if (!raw) { return null; }
      const parsed = this._parseJson<{ reasoning: string; code: string }>(raw);
      return { provider, code: parsed.code ?? draftCode, reasoning: parsed.reasoning ?? '' };
    } catch { return null; }
  }

  // ── Force Synthesis ───────────────────────────────────────────────────────

  private async _runForceSynthesis(
    prompt: string, versions: VersionCandidate[], signal: AbortSignal
  ): Promise<string> {
    const providers = await this._providerManager.getActiveProviders();
    const synthesizer = providers.find(p => !this._unavailableProviders.has(p.name));
    if (!synthesizer) { return versions[0]?.code ?? ''; }

    const versionList = versions.map((v, i) =>
      `Version ${String.fromCharCode(65 + i)} (${v.provider}):\n\`\`\`\n${v.code}\n\`\`\`\nReasoning: ${v.reasoning}`
    ).join('\n\n');

    const raw = await this._withTimeout(() => synthesizer.chat([
      { role: 'system', content:
        'You are synthesizing competing implementations. Identify the strengths of each version.\n' +
        'Merge the best structural elements into a unified implementation.\n' +
        'Return ONLY valid JSON \u2014 no markdown fences:\n' +
        '{"finalCode":"...complete merged implementation...","rationale":"what was merged and why"}' },
      { role: 'user', content: `Task: ${prompt}\n\n${versionList}\n\nProduce a unified best-of-all implementation.` },
    ] as any, signal), synthesizer.name, signal, 12000);

    if (!raw) { return versions[0]?.code ?? ''; }
    const parsed = this._parseJson<{ finalCode: string; rationale: string }>(raw);
    if (parsed.rationale) { this._send({ type: 'synthesis-ready', rationale: parsed.rationale }); }
    return parsed.finalCode ?? versions[0]?.code ?? '';
  }

  // ── Extended Debate Round ─────────────────────────────────────────────────

  private async _runExtendedDebate(
    prompt: string, versions: VersionCandidate[], signal: AbortSignal
  ): Promise<string> {
    const providers = await this._providerManager.getActiveProviders();
    const available = providers.filter(p => !this._unavailableProviders.has(p.name));
    if (available.length === 0) { return versions[0]?.code ?? ''; }

    const versionList = versions.map((v, i) =>
      `Version ${String.fromCharCode(65 + i)} (${v.provider}):\n\`\`\`\n${v.code}\n\`\`\`\nReasoning: ${v.reasoning}`
    ).join('\n\n');

    // Each AI directly addresses and refutes other proposals
    const updatedVerdicts = await Promise.all(available.map(async (p): Promise<SeatVerdict | null> => {
      const raw = await this._withTimeout(() => p.chat([
        { role: 'system', content:
          'You are reviewing competing implementations in an extended debate. ' +
          'You must directly address and refute the weaknesses of other proposals. Justify why yours is superior.\n' +
          'Return ONLY valid JSON \u2014 no markdown fences:\n' +
          '{"agrees":true|false,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100,' +
          '"objections":["..."],"suggestedChanges":["..."]}' },
        { role: 'user', content: `Task: ${prompt}\n\n${versionList}\n\nAnalyse all versions. Identify the best approach and justify it.` },
      ] as any, signal), p.name, signal, 12000);
      if (!raw) { return null; }
      const parsed = this._parseJson<{
        agrees: boolean; riskLevel: string; confidence: number;
        objections: string[]; suggestedChanges: string[];
      }>(raw);
      const verdict: SeatVerdict = {
        provider:         p.name,
        agrees:           typeof parsed.agrees === 'boolean' ? parsed.agrees : true,
        riskLevel:        (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
        confidence:       typeof parsed.confidence === 'number' ? parsed.confidence : 70,
        objections:       Array.isArray(parsed.objections) ? parsed.objections : [],
        suggestedChanges: Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [],
      };
      this._send({ type: 'verdict', verdict });
      return verdict;
    }));
    const filteredVerdicts = updatedVerdicts.filter((v): v is SeatVerdict => v !== null);
    if (this._session) { this._session.verdicts = filteredVerdicts; }

    // Then force-synthesize from the full version set
    return this._runForceSynthesis(prompt, versions, signal);
  }

  // ── Council Ledger ────────────────────────────────────────────────────────

  private _checkLedgerConsent(): void {
    if (this._ledgerConsentShown) { return; }
    this._ledgerConsentShown = true;
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsFolder) { return; }
    const dir = path.join(wsFolder, '.triforge');
    const consentPath = path.join(dir, 'consent.json');
    try {
      if (fs.existsSync(consentPath)) {
        const data = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
        this._ledgerEnabled = data.enabled === true;
        return;
      }
    } catch { /* ignore */ }
    // Show one-time consent prompt (fire-and-forget)
    vscode.window.showInformationMessage(
      'TriForge AI: Enable a local Council Decision Ledger for this workspace?',
      'Enable for this workspace', 'Disable'
    ).then(choice => {
      const enabled = choice === 'Enable for this workspace';
      this._ledgerEnabled = enabled;
      try {
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(consentPath, JSON.stringify({ enabled, ts: Date.now() }));
      } catch { /* ignore */ }
    });
  }

  private _saveLedgerRecord(record: CouncilRecord): void {
    if (!this._ledgerEnabled) { return; }
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsFolder) { return; }
    try {
      const dir = path.join(wsFolder, '.triforge');
      const ledgerPath = path.join(dir, 'ledger.json');
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      let entries: CouncilRecord[] = [];
      if (fs.existsSync(ledgerPath)) {
        try { entries = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch { entries = []; }
      }
      entries.push(record);
      if (entries.length > 100) { entries = entries.slice(-100); }
      fs.writeFileSync(ledgerPath, JSON.stringify(entries, null, 2));
    } catch { /* silent */ }
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private _getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return text;
  }

  private _getWebviewContent(): string {
    const nonce = this._getNonce();
    const lsCheckout = LS_CHECKOUT;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Triforge AI Code Council</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
    font-size: 13px;
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    overflow-x: hidden;
    overflow-y: auto;
  }
  :root {
    --c-gpt:    #10b981; --c-claude: #f97316; --c-grok: #818cf8; --c-forge: #6366f1;
    --risk-low: #10b981; --risk-med: #f59e0b; --risk-high: #ef4444; --risk-crit: #7c3aed;
    --border:    var(--vscode-editorWidget-border, rgba(255,255,255,0.1));
    --sec-bg:    var(--vscode-sideBar-background, rgba(255,255,255,0.025));
    --btn-bg:    var(--vscode-button-background, #0e639c);
    --btn-fg:    var(--vscode-button-foreground, #fff);
    --btn-hov:   var(--vscode-button-hoverBackground, #1177bb);
    --in-bg:     var(--vscode-input-background, rgba(255,255,255,0.05));
    --in-brd:    var(--vscode-input-border, rgba(255,255,255,0.15));
  }
  #app { display: flex; flex-direction: column; min-height: 100vh; }

  /* Header */
  header {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 12px;
    background: var(--vscode-titleBar-activeBackground, rgba(0,0,0,0.3));
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
  }
  .logo { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: rgba(255,255,255,0.5); flex-shrink: 0; }
  .pdots { display: flex; gap: 5px; flex: 1; }
  .pdot {
    font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px;
    background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.25);
    border: 1px solid rgba(255,255,255,0.07); transition: all 0.2s;
  }
  .pdot.on { color: #fff; border-color: rgba(255,255,255,0.2); }
  .pdot[data-p="openai"].on  { background: rgba(16,185,129,0.12); border-color: #10b981; color: #10b981; }
  .pdot[data-p="claude"].on  { background: rgba(249,115,22,0.12); border-color: #f97316; color: #f97316; }
  .pdot[data-p="grok"].on    { background: rgba(129,140,248,0.12); border-color: #818cf8; color: #818cf8; }
  .icon-btn { background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.4); font-size: 14px; padding: 2px 5px; border-radius: 3px; transition: color 0.15s; }
  .icon-btn:hover { color: rgba(255,255,255,0.85); }
  .icon-btn.active { color: var(--c-forge); }

  /* Layout */
  main { flex: 1; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .sec { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--sec-bg); }
  .sec.hidden { display: none !important; }
  /* File explorer */
  .fitem { display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:3px;cursor:pointer;font-size:11px;font-family:monospace;color:rgba(255,255,255,0.6);transition:background 0.12s; }
  .fitem:hover { background:rgba(255,255,255,0.06); }
  .fitem.ctx-on { background:rgba(99,102,241,0.12);color:#a5b4fc; }
  .fitem .fext { font-size:9px;color:rgba(255,255,255,0.3);flex-shrink:0;width:28px;text-align:right; }
  .fitem .fname { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left; }
  .ctx-tag { display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:3px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);font-size:10px;color:#a5b4fc;font-family:monospace; }
  .ctx-tag span { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .ctx-rm { background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:13px;padding:0 2px;line-height:1; }
  .ctx-rm:hover { color:#ef4444; }
  .gfile { display:flex;align-items:center;gap:5px;padding:2px 4px;border-radius:3px;font-size:11px;font-family:monospace; }
  .gfile .gname { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .gfile .gbtn { background:none;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);cursor:pointer;font-size:10px;padding:1px 5px;border-radius:2px;flex-shrink:0; }
  .gfile .gbtn:hover { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.8); }
  .gfile-staged .gname { color:#10b981; }
  .gfile-changed .gname { color:#f59e0b; }
  .gfile-untracked .gname { color:rgba(255,255,255,0.4); }
  .diff-add  { color:#10b981; }
  .diff-rm   { color:#ef4444; }
  .diff-hunk { color:#818cf8; }
  .diff-file { color:rgba(255,255,255,0.55);font-weight:700; }
  .gcommit       { display:flex;gap:6px;font-size:10px;font-family:monospace;padding:2px 3px;border-radius:2px; }
  .gcommit:hover { background:rgba(255,255,255,0.04); }
  .gcommit .ghash { color:#818cf8;flex-shrink:0; }
  .gcommit .gmsg  { color:rgba(255,255,255,0.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .hitem { font-size:10px;padding:3px 6px;border-radius:3px;cursor:pointer;color:rgba(255,255,255,0.38);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .hitem:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7); }
  #lic-badge.lic-trial   { background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc; }
  #lic-badge.lic-active  { background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981; }
  #lic-badge.lic-expired { background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25);color:#f87171; }
  .sh {
    display: flex; align-items: center; gap: 6px; padding: 6px 11px;
    background: rgba(255,255,255,0.025); border-bottom: 1px solid var(--border);
    font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
    color: rgba(255,255,255,0.4);
  }
  .sh .meta { margin-left: auto; display: flex; gap: 5px; align-items: center; }
  .sc { padding: 9px 11px; }

  /* Badges */
  .badge {
    font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
    padding: 2px 7px; border-radius: 9px;
    background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.5);
    border: 1px solid rgba(255,255,255,0.1); text-transform: uppercase;
  }
  .r-low   { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .r-med   { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .r-high  { background: rgba(239,68,68,0.12);  color: #ef4444; border-color: rgba(239,68,68,0.35); }
  .r-crit  { background: rgba(124,58,237,0.12); color: #7c3aed; border-color: rgba(124,58,237,0.35); }
  .c-unani { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .c-major { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .c-split { background: rgba(239,68,68,0.12);  color: #ef4444; border-color: rgba(239,68,68,0.35); }
  .c-block { background: rgba(124,58,237,0.12); color: #7c3aed; border-color: rgba(124,58,237,0.35); }
  .p-gpt   { background: rgba(16,185,129,0.1);  color: #10b981; border-color: rgba(16,185,129,0.3); }
  .p-cld   { background: rgba(249,115,22,0.1);  color: #f97316; border-color: rgba(249,115,22,0.3); }
  .p-grk   { background: rgba(129,140,248,0.1); color: #818cf8; border-color: rgba(129,140,248,0.3); }

  /* Buttons */
  button { cursor: pointer; border: none; border-radius: 4px; font-size: 12px; font-family: inherit; transition: background 0.15s; }
  .btn-p  { background: var(--btn-bg); color: var(--btn-fg); padding: 6px 14px; font-weight: 600; }
  .btn-p:hover { background: var(--btn-hov); }
  .btn-s  { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65); padding: 5px 11px; border: 1px solid rgba(255,255,255,0.12); }
  .btn-s:hover { background: rgba(255,255,255,0.1); }
  .btn-d  { background: rgba(239,68,68,0.1); color: #ef4444; padding: 5px 11px; border: 1px solid rgba(239,68,68,0.3); }
  .btn-d:hover { background: rgba(239,68,68,0.18); }
  .btn-g  { background: none; color: rgba(255,255,255,0.35); padding: 4px 8px; font-size: 11px; }
  .btn-g:hover { color: rgba(255,255,255,0.7); }
  .arow { display: flex; gap: 7px; flex-wrap: wrap; padding: 8px 11px 11px; }

  /* Input */
  #s-input .sc { display: flex; flex-direction: column; gap: 9px; }
  label { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; color: rgba(255,255,255,0.35); display: block; margin-bottom: 3px; text-transform: uppercase; }
  textarea, input[type="password"] {
    width: 100%; padding: 6px 9px;
    background: var(--in-bg); border: 1px solid var(--in-brd); border-radius: 4px;
    color: var(--vscode-editor-foreground, #ccc); font-family: inherit; font-size: 12px;
    resize: vertical; outline: none; transition: border-color 0.15s;
  }
  textarea:focus, input:focus { border-color: var(--c-forge); }
  #task-input { min-height: 68px; }
  #ctx-input { min-height: 52px; font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 11px; }
  .irow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .irow span { font-size: 10px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.3px; }
  .ibtn {
    font-size: 11px; padding: 3px 9px; border-radius: 10px;
    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.45); border: 1px solid rgba(255,255,255,0.1);
    transition: all 0.15s;
  }
  .ibtn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75); }
  .ibtn.on { background: rgba(99,102,241,0.18); color: #818cf8; border-color: rgba(99,102,241,0.5); }
  #btn-run { margin-left: auto; }

  /* Council visualization */
  #s-viz { background: rgba(0,0,0,0.18); }
  #cviz { display: block; width: 100%; max-height: 124px; }
  .vn-halo { fill-opacity: 0; stroke-opacity: 0; transition: all 0.4s; transform-box: fill-box; transform-origin: center; }
  .vn-core { fill: rgba(255,255,255,0.04); stroke: rgba(255,255,255,0.12); stroke-width: 1.5; transition: all 0.35s; }
  .vn-lbl  { font-size: 7.5px; font-weight: 800; fill: rgba(255,255,255,0.28); letter-spacing: 1px; transition: fill 0.35s; }
  .vbeam   { stroke: rgba(255,255,255,0.07); stroke-width: 1; stroke-dasharray: 4 9; transition: stroke 0.35s; }
  .vbeam.fl { stroke-dashoffset: 13; animation: bflow 1s linear infinite; }
  .vfo { fill: none; stroke: rgba(99,102,241,0.14); stroke-width: 1; }
  .vfi { fill: rgba(99,102,241,0.08); stroke: #6366f1; stroke-width: 1.5; transition: all 0.35s; }

  /* Node states */
  .vnode.drafting .vn-halo { fill-opacity: 0.14; stroke-opacity: 0.55; animation: hp 0.9s ease-in-out infinite; }
  .vnode.drafting .vn-core { fill: rgba(249,115,22,0.14); stroke: #f97316; }
  .vnode.drafting .vn-lbl  { fill: #fb923c; }
  .vnode.reviewing .vn-halo { fill-opacity: 0.1; stroke-opacity: 0.4; animation: hp 1.5s ease-in-out infinite; }
  .vnode.reviewing .vn-core { fill: rgba(99,102,241,0.1); stroke: #818cf8; }
  .vnode.reviewing .vn-lbl  { fill: #818cf8; }
  .vnode.agreed .vn-core   { fill: rgba(16,185,129,0.14); stroke: #10b981; stroke-width: 2; }
  .vnode.agreed .vn-lbl    { fill: #10b981; }
  .vnode.disagreed .vn-core { fill: rgba(239,68,68,0.14); stroke: #ef4444; stroke-width: 2; }
  .vnode.disagreed .vn-lbl  { fill: #ef4444; }
  .vnode.disagreed           { animation: shake 0.4s ease-in-out; }
  .forge-pulse .vfi { animation: fp 0.9s ease-in-out infinite; }
  .forge-unani .vfi { stroke: #10b981; fill: rgba(16,185,129,0.1); }
  .forge-split .vfi { stroke: #ef4444; fill: rgba(239,68,68,0.08); }

  @keyframes bflow { from { stroke-dashoffset: 13; } to { stroke-dashoffset: 0; } }
  @keyframes hp { 0%,100% { transform: scale(1); opacity: 0.4; } 50% { transform: scale(1.25); opacity: 0.75; } }
  @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
  @keyframes fp { 0%,100% { opacity: 0.65; } 50% { opacity: 1; } }

  /* Phase bar */
  #s-phase .sc { display: flex; align-items: center; gap: 7px; padding: 7px 11px; flex-wrap: wrap; }
  .psteps { display: flex; gap: 4px; }
  .ps {
    font-size: 9.5px; font-weight: 700; padding: 2px 8px; border-radius: 9px; letter-spacing: 0.3px;
    background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.22); border: 1px solid rgba(255,255,255,0.06);
    transition: all 0.25s;
  }
  .ps.active { background: rgba(99,102,241,0.18); color: #818cf8; border-color: rgba(99,102,241,0.45); animation: sp 1.1s ease-in-out infinite; }
  .ps.done   { background: rgba(16,185,129,0.1);  color: #10b981; border-color: rgba(16,185,129,0.28); }
  @keyframes sp { 0%,100% { opacity: 0.75; } 50% { opacity: 1; } }
  #pmsg { font-size: 11px; color: rgba(255,255,255,0.38); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Code blocks */
  .cb {
    background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.07); border-radius: 4px;
    padding: 9px 11px; margin: 0 11px 9px;
    font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 11px; line-height: 1.5;
    color: rgba(255,255,255,0.82); white-space: pre-wrap; word-break: break-word;
    overflow-x: auto; max-height: 300px; overflow-y: auto;
  }
  .rea { padding: 7px 11px 5px; font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.5); font-style: italic; }

  /* Risk */
  .tlist { padding: 4px 11px 9px; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .tlist li { font-size: 11px; padding: 3px 8px; background: rgba(239,68,68,0.05); border-left: 2px solid rgba(239,68,68,0.4); color: rgba(255,255,255,0.6); border-radius: 0 3px 3px 0; }
  .tlist li.ok { border-left-color: rgba(16,185,129,0.4); color: #10b981; background: rgba(16,185,129,0.05); }

  /* Verdict cards */
  #vcards { display: flex; flex-direction: column; gap: 5px; padding: 5px 11px 9px; }
  .vcard { padding: 7px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.02); }
  .vcard.ag { border-color: rgba(16,185,129,0.28); background: rgba(16,185,129,0.035); }
  .vcard.dis { border-color: rgba(239,68,68,0.28);  background: rgba(239,68,68,0.035); }
  .vrow { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
  .vicon { font-size: 13px; }
  .vpro  { font-size: 11px; font-weight: 700; }
  .vcon  { font-size: 10px; color: rgba(255,255,255,0.36); }
  .vobjl { list-style: none; margin-top: 3px; }
  .vobjl li { font-size: 11px; color: rgba(255,255,255,0.52); padding: 1px 0; }
  .vobjl li::before { content: "\\2022 "; color: #ef4444; }
  .vsugl li { font-size: 11px; color: rgba(255,255,255,0.42); padding: 1px 0; }
  .vsugl li::before { content: "\\2192 "; color: #818cf8; }

  /* Confidence track */
  .ctrack { display: flex; align-items: center; gap: 7px; padding: 5px 11px 7px; font-size: 12px; }
  .cv { font-weight: 700; }
  .ca { color: rgba(255,255,255,0.28); }
  .cd { font-size: 11px; padding: 2px 6px; border-radius: 9px; }
  .cd.up   { background: rgba(16,185,129,0.14); color: #10b981; }
  .cd.down { background: rgba(239,68,68,0.14);  color: #ef4444; }

  /* Debate section */
  .dstage { padding: 7px 11px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .dstage:last-child { border-bottom: none; }
  .dstage h4 { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.3); margin-bottom: 3px; }
  .dstage p  { font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.45; }
  .cbtn {
    width: 100%; text-align: left; background: rgba(255,255,255,0.025);
    border: none; border-bottom: 1px solid var(--border); cursor: pointer;
    color: rgba(255,255,255,0.45); display: flex; align-items: center; gap: 6px;
    padding: 7px 11px; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
    transition: background 0.15s;
  }
  .cbtn:hover { background: rgba(255,255,255,0.05); }
  .cbtn .tarr { margin-left: auto; font-size: 9px; }
  #dbody { display: none; }
  #dbody.open { display: block; }

  /* Settings */
  .krow { display: flex; align-items: center; gap: 7px; padding: 5px 11px; }
  .krow label { min-width: 50px; margin-bottom: 0; }
  .krow input { flex: 1; resize: none; }

  /* Error toast */
  #etst {
    position: fixed; bottom: 14px; right: 14px; left: 14px;
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.35);
    color: #ef4444; border-radius: 5px; padding: 8px 12px;
    font-size: 12px; display: none; z-index: 100;
    animation: fi 0.2s ease;
  }
  .toast-ok { background: rgba(16,185,129,0.1) !important; border-color: rgba(16,185,129,0.35) !important; color: #10b981 !important; }
  @keyframes fi { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
  #bypass-b { background: rgba(245,158,11,0.09); border: 1px solid rgba(245,158,11,0.3); color: #f59e0b; padding: 7px 12px; font-size: 12px; border-radius: 5px; display: none; }

  /* Offline node state */
  .vnode.offline .vn-core { stroke-dasharray: 4 3; fill: rgba(255,255,255,0.01); stroke: rgba(255,255,255,0.15); opacity: 0.3; }
  .vnode.offline .vn-lbl  { fill: rgba(255,255,255,0.2); opacity: 0.3; }

  /* New node states */
  .vnode.analyzing .vn-halo { fill-opacity:0.15; stroke-opacity:0.6; animation:hp 0.6s ease-in-out infinite; }
  .vnode.analyzing .vn-core { fill:rgba(99,102,241,0.18); stroke:#818cf8; }
  .vnode.analyzing .vn-lbl  { fill:#c4b5fd; }
  .vnode.challenging .vn-halo { fill-opacity:0.2; stroke-opacity:0.7; animation:hp 0.4s ease-in-out infinite; }
  .vnode.challenging .vn-core { fill:rgba(245,158,11,0.18); stroke:#f59e0b; }
  .vnode.challenging .vn-lbl  { fill:#fbbf24; }
  .vnode.voting .vn-halo { fill-opacity:0.12; stroke-opacity:0.5; animation:hp 1.2s ease-in-out infinite; }
  .vnode.voting .vn-core { fill:rgba(59,130,246,0.14); stroke:#3b82f6; }
  .vnode.voting .vn-lbl  { fill:#60a5fa; }
  .vnode.synthesizing .vn-halo { fill-opacity:0.18; stroke-opacity:0.65; animation:hp 0.8s ease-in-out infinite; }
  .vnode.synthesizing .vn-core { fill:rgba(234,179,8,0.14); stroke:#eab308; }
  .vnode.synthesizing .vn-lbl  { fill:#facc15; }

  /* Depth activation */
  #s-viz { transition: box-shadow 220ms cubic-bezier(0.4,0,0.2,1); }
  #s-viz.depth-active { box-shadow: 0 6px 28px rgba(0,0,0,0.4), 0 2px 8px rgba(99,102,241,0.12); }
  .vnode { transition: transform 220ms cubic-bezier(0.4,0,0.2,1), filter 220ms cubic-bezier(0.4,0,0.2,1); }
  .vnode.depth-on { transform: translateY(-4px) scale(1.02); filter: drop-shadow(0 4px 10px rgba(0,0,0,0.45)); }
  body.ruthless-active .vnode.depth-on { transform: translateY(-6px) scale(1.03); }

  /* Critical objection section */
  .cobj-who { font-size:12px; font-weight:700; color:#ef4444; margin-bottom:5px; }
  .cobj-summary {
    font-size:12px; color:rgba(255,255,255,0.55); background:rgba(239,68,68,0.05);
    border-left:2px solid rgba(239,68,68,0.4); padding:6px 10px; border-radius:0 4px 4px 0; margin-bottom:8px;
  }
  .dopt-danger:hover { background:rgba(239,68,68,0.1) !important; border-color:rgba(239,68,68,0.4) !important; }
  #s-critical-obj .sh { color:#ef4444; }

  /* Council mode badge */
  .badge.cm-full    { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .badge.cm-partial { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .badge.cm-solo    { background: rgba(239,68,68,0.12);  color: #ef4444; border-color: rgba(239,68,68,0.35); }

  /* Intensity auto label */
  .i-auto-lbl { font-size: 10px; color: rgba(255,255,255,0.38); font-style: italic; }

  /* Deadlock section */
  .deadlock-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .dopt-btn {
    display: flex; align-items: center; gap: 10px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 10px 12px; cursor: pointer; text-align: left;
    transition: background 0.15s, border-color 0.15s; color: var(--vscode-editor-foreground, #ccc);
    font-family: inherit;
  }
  .dopt-btn:hover { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.4); }
  .dopt-icon { font-size: 18px; flex-shrink: 0; }
  .dopt-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.85); }
  .dopt-desc  { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; }

  /* Forge deadlock state (amber tension) */
  .forge-deadlock .vfi { stroke: #f59e0b; fill: rgba(245,158,11,0.08); animation: fp 0.7s ease-in-out infinite; }

  /* Version cards */
  .vc-card {
    border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;
    background: rgba(255,255,255,0.02); padding: 8px 10px;
  }
  .vc-header { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
  .vc-code { font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 10px; color: rgba(255,255,255,0.55); white-space: pre-wrap; max-height: 80px; overflow: hidden; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 5px 7px; margin-bottom: 5px; }
</style>
</head>
<body>
<div id="app">

  <header>
    <div class="logo">&#x2B21; Triforge AI Code Council</div>
    <div class="pdots">
      <span class="pdot" id="d-openai" data-p="openai">GPT</span>
      <span class="pdot" id="d-claude" data-p="claude">Claude</span>
      <span class="pdot" id="d-grok"   data-p="grok">Grok</span>
      <span id="cm-badge" class="badge hidden">FULL</span>
    </div>
    <button class="icon-btn" id="btn-cfg" title="Settings">&#x2699;</button>
  </header>

  <main>
    <div id="etst"></div>
    <div id="bypass-b">Draft applied immediately &#x2014; council review bypassed.</div>

    <!-- License gate overlay -->
    <div id="lic-gate" style="display:none;padding:12px;border:1px solid rgba(99,102,241,0.3);border-radius:6px;background:rgba(99,102,241,0.06);margin:4px 0;flex-direction:column;gap:8px;">
      <p id="lic-gate-msg" style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5;margin:0;"></p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn-s" id="btn-gate-upgrade" style="font-size:11px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;color:#fff;padding:4px 12px;border-radius:4px;font-weight:600;cursor:pointer;">Subscribe &#x2014; $15/mo</button>
        <button class="btn-s" id="btn-gate-key" style="font-size:11px;">I have a license key</button>
      </div>
    </div>

    <!-- Settings -->
    <div class="sec" id="s-cfg">
      <div class="sh" id="cfg-sh" style="cursor:pointer;user-select:none;">API Keys
        <span id="cfg-chevron" style="margin-left:auto;font-size:11px;color:rgba(255,255,255,0.35);transition:transform 0.15s;">&#x25BE;</span>
      </div>
      <div class="sc" id="cfg-body" style="display:flex;flex-direction:column;gap:8px;padding-bottom:14px;">
        <div class="krow"><label>OpenAI</label><input type="password" id="k-openai" placeholder="sk-..."/><button class="btn-s" id="ks-openai">Save</button><button class="btn-d" id="kr-openai">Remove</button></div>
        <div class="krow"><label>Claude</label><input type="password" id="k-claude" placeholder="sk-ant-..."/><button class="btn-s" id="ks-claude">Save</button><button class="btn-d" id="kr-claude">Remove</button></div>
        <div class="krow"><label>Grok</label><input type="password" id="k-grok" placeholder="xai-..."/><button class="btn-s" id="ks-grok">Save</button><button class="btn-d" id="kr-grok">Remove</button></div>
        <div style="border-top:1px solid var(--border);margin:2px 0;padding-top:6px;display:flex;flex-direction:column;gap:6px;">
          <datalist id="dl-openai-models"><option value="gpt-4o"/><option value="gpt-4o-mini"/><option value="o1"/><option value="o3-mini"/></datalist>
          <datalist id="dl-claude-models"><option value="claude-opus-4-6"/><option value="claude-sonnet-4-6"/><option value="claude-haiku-4-5-20251001"/></datalist>
          <datalist id="dl-grok-models"><option value="grok-3"/><option value="grok-2"/></datalist>
          <div class="krow"><label>OpenAI Model</label><input type="text" id="m-openai" list="dl-openai-models" placeholder="gpt-4o"/><button class="btn-s" id="ms-openai">Save</button></div>
          <div class="krow"><label>Claude Model</label><input type="text" id="m-claude" list="dl-claude-models" placeholder="claude-sonnet-4-6"/><button class="btn-s" id="ms-claude">Save</button></div>
          <div class="krow"><label>Grok Model</label><input type="text" id="m-grok" list="dl-grok-models" placeholder="grok-3"/><button class="btn-s" id="ms-grok">Save</button></div>
        </div>
        <div class="krow"><label>Audio</label><button class="ibtn on" id="btn-audio">On</button></div>
        <!-- License section -->
        <div style="border-top:1px solid var(--border);margin:4px 0;padding-top:8px;display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:10px;font-weight:700;letter-spacing:0.6px;color:rgba(255,255,255,0.45);">LICENSE</span>
            <span id="lic-badge" style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:9px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);">Loading&#x2026;</span>
          </div>
          <div id="lic-msg" style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.4;"></div>
          <!-- Trial countdown bar -->
          <div id="lic-trial-bar" style="display:none;">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:10px;color:rgba(255,255,255,0.4);">Trial expires in</span>
              <span id="lic-days" style="font-size:10px;font-weight:700;color:#10b981;"></span>
            </div>
            <div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
              <div id="lic-prog" style="height:100%;border-radius:2px;transition:width 0.4s;"></div>
            </div>
          </div>
          <!-- Key input (expired / no key) -->
          <div id="lic-key-row" style="display:none;flex-direction:column;gap:4px;">
            <div style="display:flex;gap:4px;">
              <input type="text" id="lic-key-inp" placeholder="Enter license key&#x2026;" style="flex:1;font-size:11px;font-family:monospace;"/>
              <button class="btn-s" id="btn-lic-activate" style="font-size:11px;padding:3px 9px;">Activate</button>
            </div>
            <div id="lic-err" style="font-size:10px;color:#ef4444;display:none;"></div>
            <button id="btn-lic-upgrade" style="width:100%;font-size:11px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;padding:5px 0;border-radius:4px;color:#fff;font-weight:600;cursor:pointer;margin-top:2px;">Subscribe &#x2014; $15/month &#x2197;</button>
          </div>
          <!-- Active key display -->
          <div id="lic-active-row" style="display:none;align-items:center;justify-content:space-between;">
            <span id="lic-key-disp" style="font-size:10px;font-family:monospace;color:rgba(255,255,255,0.4);"></span>
            <button class="btn-d" id="btn-lic-remove" style="font-size:10px;padding:2px 7px;">Remove</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Workspace File Explorer -->
    <div class="sec" id="s-explorer">
      <div class="sh">Workspace Files
        <div class="meta">
          <span id="ctx-count" class="badge hidden"></span>
          <button class="btn-d" id="btn-ctx-clear" style="display:none;font-size:10px;padding:2px 6px;">Clear</button>
        </div>
      </div>
      <div class="sc" style="padding-bottom:8px;">
        <input id="file-search" type="text" placeholder="Search files&#x2026;" style="width:100%;margin-bottom:6px;"/>
        <div id="file-list" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;"></div>
        <div id="ctx-files" style="margin-top:6px;display:flex;flex-direction:column;gap:2px;"></div>
      </div>
    </div>

    <!-- Git -->
    <div class="sec" id="s-git">
      <div class="sh">Git
        <div class="meta">
          <span id="git-branch" class="badge" style="display:none;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;"></span>
          <button class="btn-s" id="btn-git-refresh" style="font-size:10px;padding:2px 7px;">&#x21bb;</button>
        </div>
      </div>
      <div class="sc" style="padding-bottom:10px;">
        <div id="git-branch-mgr" style="margin-bottom:8px;display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;gap:4px;align-items:center;">
            <select id="git-branch-select" style="flex:1;font-size:11px;background:var(--in-bg);border:1px solid var(--in-brd);color:inherit;border-radius:3px;padding:2px 4px;"></select>
            <button class="btn-s" id="btn-git-switch" style="font-size:10px;padding:2px 6px;">Switch</button>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <input id="git-new-branch" type="text" placeholder="new-branch-name" style="flex:1;font-size:11px;"/>
            <button class="btn-s" id="btn-git-create" style="font-size:10px;padding:2px 6px;">Create</button>
          </div>
        </div>
        <div id="git-msg-area" style="font-size:11px;color:rgba(255,255,255,0.35);padding:2px 0 6px;">Loading&#x2026;</div>

        <div id="git-staged-sec" style="display:none;margin-bottom:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:10px;font-weight:700;color:#10b981;letter-spacing:0.5px;">STAGED</span>
            <button class="btn-d" id="btn-unstage-all" style="font-size:10px;padding:1px 6px;">Unstage All</button>
          </div>
          <div id="git-staged" style="display:flex;flex-direction:column;gap:2px;"></div>
        </div>

        <div id="git-diff-wrap" style="display:none;margin-bottom:6px;">
          <pre id="git-diff-view" style="font-size:10px;font-family:monospace;max-height:160px;overflow-y:auto;background:rgba(0,0,0,0.25);border-radius:3px;padding:6px;white-space:pre;margin:0;line-height:1.5;"></pre>
        </div>
        <div style="margin-bottom:6px;">
          <button class="btn-s" id="btn-git-diff" style="width:100%;font-size:10px;padding:2px;">View Staged Diff</button>
        </div>

        <div id="git-changes-sec" style="display:none;margin-bottom:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:0.5px;">CHANGES</span>
            <button class="btn-s" id="btn-stage-all" style="font-size:10px;padding:1px 6px;">Stage All</button>
          </div>
          <div id="git-changes" style="display:flex;flex-direction:column;gap:2px;"></div>
        </div>

        <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
          <textarea id="git-commit-msg" placeholder="Commit message&#x2026;" style="width:100%;height:54px;resize:vertical;"></textarea>
          <div style="display:flex;gap:5px;">
            <button class="btn-s" id="btn-git-ai-msg" style="flex:1;">AI Message</button>
            <button class="btn-p" id="btn-git-commit" style="flex:1;">Commit</button>
            <button class="btn-s" id="btn-git-push" style="flex:1;background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.3);color:#a5b4fc;">Push</button>
          </div>
        </div>

        <div id="git-log-sec" style="margin-top:8px;">
          <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:0.5px;margin-bottom:3px;">RECENT COMMITS</div>
          <div id="git-log-list" style="display:flex;flex-direction:column;gap:1px;max-height:100px;overflow-y:auto;"></div>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="sec" id="s-input">
      <div class="sh">Council Request</div>
      <div class="sc">
        <div>
          <label for="task-input">Task Description</label>
          <textarea id="task-input" placeholder="Describe what you need implemented or improved&#x2026;"></textarea>
        </div>
        <div>
          <label for="ctx-input">Code Context (optional)</label>
          <textarea id="ctx-input" placeholder="Paste the current implementation here&#x2026;"></textarea>
        </div>
        <div class="irow">
          <span>Intensity:</span>
          <button class="ibtn on" data-i="adaptive">Adaptive</button>
          <button class="ibtn"    data-i="cooperative">Cooperative</button>
          <button class="ibtn"    data-i="analytical">Analytical</button>
          <button class="ibtn"    data-i="critical">Critical</button>
          <button class="ibtn"    data-i="ruthless">Ruthless</button>
          <span id="i-auto-lbl" class="i-auto-lbl hidden"></span>
          <button class="btn-p" id="btn-run">Run Council &#x25B6;</button>
        </div>
        <div id="s-history" style="margin-top:4px;display:none;">
          <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.2);letter-spacing:0.5px;margin-bottom:3px;">RECENT PROMPTS</div>
          <div id="hist-list" style="display:flex;flex-direction:column;gap:1px;max-height:110px;overflow-y:auto;"></div>
        </div>
      </div>
    </div>

    <!-- Visualization -->
    <div class="sec hidden" id="s-viz">
      <svg id="cviz" viewBox="0 0 300 124" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="fo" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="ft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="fi2" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <!-- Beams to center (150,72) -->
        <line id="bm-claude" class="vbeam" x1="150" y1="30" x2="150" y2="59"/>
        <line id="bm-gpt"    class="vbeam" x1="71"  y1="99" x2="139" y2="77"/>
        <line id="bm-grok"   class="vbeam" x1="229" y1="99" x2="161" y2="77"/>
        <!-- Claude top (150,18) -->
        <g class="vnode" id="vn-claude">
          <circle class="vn-halo" cx="150" cy="18" r="20" fill="#f97316" stroke="#f97316"/>
          <circle class="vn-core" cx="150" cy="18" r="13" filter="url(#fo)"/>
          <text x="150" y="23" text-anchor="middle" font-size="10" font-weight="800" fill="#f97316" filter="url(#fo)">C</text>
          <text x="150" y="6"  text-anchor="middle" class="vn-lbl">CLAUDE</text>
        </g>
        <!-- GPT bottom-left (60,108) -->
        <g class="vnode" id="vn-gpt">
          <circle class="vn-halo" cx="60" cy="108" r="20" fill="#10b981" stroke="#10b981"/>
          <circle class="vn-core" cx="60" cy="108" r="13" filter="url(#ft)"/>
          <text x="60" y="113" text-anchor="middle" font-size="10" font-weight="800" fill="#10b981" filter="url(#ft)">G</text>
          <text x="22" y="122"  text-anchor="middle" class="vn-lbl">GPT</text>
        </g>
        <!-- Grok bottom-right (240,108) -->
        <g class="vnode" id="vn-grok">
          <circle class="vn-halo" cx="240" cy="108" r="20" fill="#818cf8" stroke="#818cf8"/>
          <circle class="vn-core" cx="240" cy="108" r="13" filter="url(#fi2)"/>
          <text x="240" y="113" text-anchor="middle" font-size="10" font-weight="800" fill="#818cf8" filter="url(#fi2)">X</text>
          <text x="278" y="122"  text-anchor="middle" class="vn-lbl">GROK</text>
        </g>
        <!-- Center forge (150,72) -->
        <g id="vn-forge">
          <circle class="vfo" cx="150" cy="72" r="30"/>
          <circle class="vfi" cx="150" cy="72" r="20" filter="url(#fi2)"/>
          <text x="150" y="80" text-anchor="middle" font-size="17"
                filter="url(#fi2)" style="filter:drop-shadow(0 0 5px rgba(255,210,60,.8))">&#x26A1;</text>
        </g>
      </svg>
    </div>

    <!-- Phase bar -->
    <div class="sec hidden" id="s-phase">
      <div class="sc">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
          <div class="psteps">
            <span class="ps" data-ph="DRAFTING">Draft</span>
            <span class="ps" data-ph="RISK_CHECK">Risk</span>
            <span class="ps" data-ph="CRITIQUE">Critique</span>
            <span class="ps" data-ph="DEBATE">Debate</span>
            <span class="ps" data-ph="COMPLETE">&#x2713; Done</span>
          </div>
          <span id="pmsg"></span>
          <button class="btn-d" id="btn-abort" style="padding:3px 9px;font-size:11px;">Abort</button>
        </div>
      </div>
    </div>

    <!-- Draft -->
    <div class="sec hidden" id="s-draft">
      <div class="sh">Fast Draft<div class="meta"><span id="dp-badge" class="badge">&#x2014;</span><span id="dr-badge" class="badge">&#x2014;</span><span id="dc-badge" class="badge">&#x2014;</span></div></div>
      <p id="d-reason" class="rea"></p>
      <pre id="d-code" class="cb"></pre>
      <div class="arow"><button class="btn-s" id="btn-bypass">Apply Draft Immediately</button></div>
    </div>

    <!-- Risk -->
    <div class="sec hidden" id="s-risk">
      <div class="sh">Risk Analysis<div class="meta"><span id="rl-badge" class="badge">&#x2014;</span></div></div>
      <ul id="rtlist" class="tlist"></ul>
    </div>

    <!-- Verdicts -->
    <div class="sec hidden" id="s-agree">
      <div class="sh">Council Verdicts<div class="meta"><span id="cs-badge" class="badge">&#x2014;</span></div></div>
      <div id="vcards"></div>
    </div>

    <!-- Final result -->
    <div class="sec hidden" id="s-result">
      <div class="sh">Final Implementation<div class="meta"><span id="rc-badge" class="badge">&#x2014;</span></div></div>
      <pre id="r-code" class="cb"></pre>
      <div class="arow">
        <button class="btn-p"   id="btn-apply">Apply Patch</button>
        <button class="btn-s"   id="btn-debate">View Debate</button>
        <button class="btn-s"   id="btn-esc">Escalate Intensity</button>
        <button class="btn-s"   id="btn-export">Export Report</button>
        <button class="btn-g"   id="btn-reset">&#x21BA; New Request</button>
      </div>
    </div>

    <!-- Debate (collapsible) -->
    <div class="sec hidden" id="s-debate">
      <button class="cbtn" id="dtoggle">Debate Transcript<span class="tarr" id="darr">&#x25BC;</span></button>
      <div id="dbody">
        <div class="dstage"><h4>Proposal</h4><p id="db-prop"></p></div>
        <div class="dstage"><h4>Critique</h4><p id="db-crit"></p></div>
        <div class="dstage"><h4>Revision</h4><p id="db-rev"></p></div>
        <div class="dstage"><h4>Final Decision</h4><p id="db-fin"></p></div>
        <div class="ctrack">
          <span class="cv" id="db-c1">&#x2014;</span>
          <span class="ca">&#x2192;</span>
          <span class="cv" id="db-c2">&#x2014;</span>
          <span class="ca">&#x2192;</span>
          <span class="cv" id="db-c3">&#x2014;</span>
          <span id="db-dt" class="cd"></span>
        </div>
        <pre id="db-fcode" class="cb" style="display:none;"></pre>
      </div>
    </div>

    <!-- Alternative -->
    <div class="sec hidden" id="s-alt">
      <div class="sh">Alternative Proposal<div class="meta"><span id="ap-badge" class="badge">&#x2014;</span><span id="ac-badge" class="badge">&#x2014;</span><span id="ar-badge" class="badge">&#x2014;</span></div></div>
      <p id="a-reason" class="rea"></p>
      <pre id="a-code" class="cb"></pre>
      <div class="arow">
        <button class="btn-p" id="btn-adopt">Adopt This</button>
        <button class="btn-s" id="btn-vote">Run Council on This</button>
        <button class="btn-g" id="btn-discard">Discard</button>
      </div>
    </div>

    <!-- Deadlock -->
    <div class="sec hidden" id="s-deadlock">
      <div class="sh">&#x2696; Council Deadlock Detected<div class="meta"><span class="badge r-high">DEADLOCK</span></div></div>
      <div class="sc">
        <p style="font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:8px;">The council is divided. Choose how to resolve the impasse:</p>
        <div class="deadlock-opts">
          <button class="dopt-btn" id="btn-dl-escalate">
            <span class="dopt-icon">&#x26A1;</span>
            <div class="dopt-text"><div class="dopt-title">Escalate Intensity</div><div class="dopt-desc">Increase critique depth and re-vote</div></div>
          </button>
          <button class="dopt-btn" id="btn-dl-user">
            <span class="dopt-icon">&#x1F9D1;</span>
            <div class="dopt-text"><div class="dopt-title">User Breaks Tie</div><div class="dopt-desc">Choose from the competing versions</div></div>
          </button>
          <button class="dopt-btn" id="btn-dl-synthesis">
            <span class="dopt-icon">&#x1F9EC;</span>
            <div class="dopt-text"><div class="dopt-title">Force Synthesis</div><div class="dopt-desc">AI merges the best elements of all versions</div></div>
          </button>
          <button class="dopt-btn" id="btn-dl-extended">
            <span class="dopt-icon">&#x1F525;</span>
            <div class="dopt-text"><div class="dopt-title">Extended Debate Round</div><div class="dopt-desc">Each AI directly challenges competing proposals</div></div>
          </button>
        </div>
        <div id="version-cards" class="hidden" style="margin-top:10px;display:flex;flex-direction:column;gap:6px;"></div>
      </div>
    </div>

    <!-- Critical Objection (RUTHLESS) -->
    <div class="sec hidden" id="s-critical-obj">
      <div class="sh">&#x1F6A8; Critical Objection Raised<div class="meta"><span class="badge r-crit">CRITICAL</span></div></div>
      <div class="sc">
        <div id="cobj-who" class="cobj-who"></div>
        <div id="cobj-summary" class="cobj-summary"></div>
        <div class="deadlock-opts">
          <button class="dopt-btn" id="btn-co-alt">
            <span class="dopt-icon">&#x1F504;</span>
            <div class="dopt-text"><div class="dopt-title">Require Alternative</div><div class="dopt-desc">Request new implementation from dissenting AI</div></div>
          </button>
          <button class="dopt-btn dopt-danger" id="btn-co-override">
            <span class="dopt-icon">&#x26A0;</span>
            <div class="dopt-text"><div class="dopt-title">Override &amp; Apply</div><div class="dopt-desc">Double confirmation required. Logged as override.</div></div>
          </button>
          <button class="dopt-btn" id="btn-co-debate">
            <span class="dopt-icon">&#x1F525;</span>
            <div class="dopt-text"><div class="dopt-title">Extended Debate</div><div class="dopt-desc">All AIs must address dissent explicitly</div></div>
          </button>
          <button class="dopt-btn" id="btn-co-synth">
            <span class="dopt-icon">&#x1F9EC;</span>
            <div class="dopt-text"><div class="dopt-title">Force Synthesis</div><div class="dopt-desc">Merge best elements of competing implementations</div></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Synthesis note -->
    <div class="sec hidden" id="s-synth-note">
      <div class="sh">Synthesis Rationale</div>
      <p id="synth-rationale" class="rea"></p>
    </div>

  </main>
</div>

<script nonce="${nonce}">
(function(){
'use strict';
try {
const vs = acquireVsCodeApi();
function send(cmd, d){ vs.postMessage(Object.assign({command:cmd}, d||{})); }

// State
var LS_CHECKOUT='${lsCheckout}';
const S = { phase:'IDLE', intensity:'adaptive', providers:{}, debOpen:false, running:false, councilMode:'FULL', dlVersions:[], audioEnabled:true, wsFiles:[], ctxFiles:[], promptHistory:[], upgradeUrl:'' };
const PH_ORD = ['DRAFTING','RISK_CHECK','CRITIQUE','DEBATE','COMPLETE'];

// DOM
function $(i){ return document.getElementById(i); }
function show(i){ const e=$(i); if(e){ e.classList.remove('hidden'); } }
function hide(i){ const e=$(i); if(e){ e.classList.add('hidden'); } }
function txt(i,t){ const e=$(i); if(e){ e.textContent=t; } }
function cod(i,t){ const e=$(i); if(e){ e.textContent=t||''; } }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function pLbl(n){ return n==='openai'?'GPT':n==='claude'?'Claude':'Grok'; }
function pCls(n){ return n==='openai'?'p-gpt':n==='claude'?'p-cld':'p-grk'; }
function rCls(r){ return 'r-'+(r||'low').toLowerCase().slice(0,4); }
function cCls(c){ return 'c-'+(c||'unani').toLowerCase().slice(0,5); }

// Provider dots
function updDots(st){
  ['openai','claude','grok'].forEach(function(p){
    const e=$('d-'+p);
    if(!e){ return; }
    st[p]? e.classList.add('on'): e.classList.remove('on');
  });
  S.providers=st;
}

// Phase steps
function updSteps(ph){
  const idx=PH_ORD.indexOf(ph);
  document.querySelectorAll('.ps').forEach(function(el){
    const pi=PH_ORD.indexOf(el.dataset.ph);
    el.classList.remove('active','done');
    if(el.dataset.ph===ph){ el.classList.add('active'); }
    else if(pi<idx){ el.classList.add('done'); }
  });
}

// Node states
function setNode(prov, state){
  const nid='vn-'+(prov==='openai'?'gpt':prov);
  const bid='bm-'+(prov==='openai'?'gpt':prov);
  const n=$(nid), b=$(bid);
  if(n){ n.classList.remove('drafting','reviewing','agreed','disagreed','offline','analyzing','challenging','voting','synthesizing'); if(state){ n.classList.add(state); } }
  if(b){ b.classList.remove('fl'); if(state==='drafting'||state==='reviewing'||state==='analyzing'||state==='voting'){ b.classList.add('fl'); } }
}
function setForge(st){
  const f=$('vn-forge');
  if(!f){ return; }
  f.classList.remove('forge-pulse','forge-unani','forge-split','forge-deadlock');
  if(st){ f.classList.add(st); }
}
function resetNodes(){
  ['claude','gpt','grok'].forEach(function(p){
    const n=$('vn-'+p), b=$('bm-'+p);
    if(n){ n.classList.remove('drafting','reviewing','agreed','disagreed','offline','analyzing','challenging','voting','synthesizing'); }
    if(b){ b.classList.remove('fl'); }
  });
  setForge(null);
}

// Phase handler
function onPhase(d){
  S.phase=d.phase;
  if(d.message){ txt('pmsg', d.message); }

  if(d.phase==='IDLE'||d.phase==='BYPASSED'||d.phase==='COMPLETE'){
    S.running=false;
    const viz=$('s-viz'); if(viz){ viz.classList.remove('depth-active'); }
    ['claude','gpt','grok'].forEach(function(p){ const n=$('vn-'+p); if(n){ n.classList.remove('depth-on'); } });
    document.body.classList.remove('ruthless-active');
    if(d.phase!=='COMPLETE'){
      show('s-input'); hide('s-phase');
      resetNodes();
    }
    if(d.phase==='BYPASSED'){ const b=$('bypass-b'); if(b){ b.style.display='block'; } }
    return;
  }

  S.running=true;
  hide('s-input');
  show('s-viz'); show('s-phase');
  updSteps(d.phase);

  // Depth activation during cognition
  const viz=$('s-viz'); if(viz){ viz.classList.add('depth-active'); }
  ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ const nid='vn-'+(p==='openai'?'gpt':p); const n=$(nid); if(n){ n.classList.add('depth-on'); } } });
  if(S.intensity==='ruthless'){ document.body.classList.add('ruthless-active'); }

  if(d.phase==='DRAFTING'){
    resetNodes();
    const prim=S.providers['grok']?'grok':S.providers['openai']?'openai':'claude';
    setNode(prim,'drafting');
    // Re-apply depth after reset
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ const nid='vn-'+(p==='openai'?'gpt':p); const n=$(nid); if(n){ n.classList.add('depth-on'); } } });
  } else if(d.phase==='CRITIQUE'){
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'analyzing'); } });
  } else if(d.phase==='DEBATE'){
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'voting'); } });
    setForge('forge-pulse');
  }
}

// Draft handler
function onDraft(dr){
  const pb=$('dp-badge');
  if(pb){ pb.textContent=pLbl(dr.provider); pb.className='badge '+pCls(dr.provider); }
  const rb=$('dr-badge');
  if(rb){ rb.textContent=dr.preliminaryRisk; rb.className='badge '+rCls(dr.preliminaryRisk); }
  const cb=$('dc-badge');
  if(cb){ cb.textContent=dr.confidence+'%'; }
  txt('d-reason', dr.reasoning);
  cod('d-code', dr.code);
  show('s-draft');
  setNode(dr.provider, 'drafting');
}

// Risk handler
function onRisk(r){
  const rb=$('rl-badge');
  if(rb){ rb.textContent=r.level; rb.className='badge '+rCls(r.level); }
  const ul=$('rtlist'); if(!ul){ return; }
  ul.innerHTML='';
  const tgs=r.triggers||[];
  if(tgs.length===0){
    const li=document.createElement('li'); li.textContent='No risk factors detected.'; li.className='ok'; ul.appendChild(li);
  } else {
    tgs.forEach(function(t){ const li=document.createElement('li'); li.textContent=t; ul.appendChild(li); });
  }
  show('s-risk');
}

// Verdict handler
function onVerdict(v){
  show('s-agree');
  if(!v.agrees){
    setNode(v.provider,'challenging');
    setTimeout(function(){ setNode(v.provider,'disagreed'); }, 400);
  } else {
    setNode(v.provider,'agreed');
  }
  const vc=$('vcards'); if(!vc){ return; }
  const card=document.createElement('div');
  card.className='vcard '+(v.agrees?'ag':'dis');
  const objH=(v.agrees||!v.objections||!v.objections.length)?'':
    '<ul class="vobjl">' + v.objections.slice(0,3).map(function(o){ return '<li>'+esc(o)+'</li>'; }).join('') + '</ul>';
  const sugH=(v.agrees&&v.suggestedChanges&&v.suggestedChanges.length)?
    '<ul class="vsugl">' + v.suggestedChanges.slice(0,2).map(function(c){ return '<li>'+esc(c)+'</li>'; }).join('') + '</ul>':'';
  const altH=(!v.agrees)?
    '<button class="btn-s" style="font-size:11px;padding:3px 8px;margin-top:5px;" data-action="reqAlt" data-provider="'+esc(v.provider)+'">Ask '+esc(pLbl(v.provider))+' for Alternative</button>':'';
  card.innerHTML=
    '<div class="vrow">'+
      '<span class="vicon">'+(v.agrees?'&#x2713;':'&#x2717;')+'</span>'+
      '<span class="vpro '+pCls(v.provider)+'">'+esc(pLbl(v.provider))+'</span>'+
      '<span class="vcon">'+v.confidence+'% confidence</span>'+
      '<span class="badge '+rCls(v.riskLevel)+'" style="margin-left:auto;">'+esc(v.riskLevel)+'</span>'+
    '</div>'+objH+sugH+altH;
  vc.appendChild(card);
}

// Debate handler
function onDebate(db){
  txt('db-prop', db.proposal); txt('db-crit', db.critique);
  txt('db-rev',  db.revision); txt('db-fin',  db.final);
  txt('db-c1', db.confidenceInitial+'%');
  txt('db-c2', db.confidenceAfterCritique+'%');
  txt('db-c3', db.confidenceFinal+'%');
  const delta=db.confidenceFinal-db.confidenceInitial;
  const dt=$('db-dt');
  if(dt){ dt.textContent=(delta>=0?'+':'')+delta+'%'; dt.className='cd '+(delta>=0?'up':'down'); }
  if(db.finalCode){ cod('db-fcode', db.finalCode); const fc=$('db-fcode'); if(fc){ fc.style.display='block'; } }
  show('s-debate');
  setForge(null);
}

// Complete handler
function onComplete(d){
  S.running=false; S.phase='COMPLETE';
  updSteps('COMPLETE');
  const viz=$('s-viz'); if(viz){ viz.classList.remove('depth-active'); }
  ['claude','gpt','grok'].forEach(function(p){ const n=$('vn-'+p); if(n){ n.classList.remove('depth-on'); } });
  document.body.classList.remove('ruthless-active');
  if(d.consensus==='UNANIMOUS'){
    setForge('forge-unani');
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'agreed'); } });
    playConsensusTone();
  } else if(d.consensus==='SPLIT'||d.consensus==='BLOCKED'){
    setForge('forge-split');
  } else { setForge(null); }
  const cb=$('cs-badge');
  if(cb){ cb.textContent=d.consensus; cb.className='badge '+cCls(d.consensus); }
  cod('r-code', d.finalCode);
  const rc=$('rc-badge');
  if(rc){ rc.textContent=d.consensus; rc.className='badge '+cCls(d.consensus); }
  show('s-result');
}

// Alternative handler
function onAlt(a){
  const pb=$('ap-badge'); if(pb){ pb.textContent=pLbl(a.provider); pb.className='badge '+pCls(a.provider); }
  const cb=$('ac-badge'); if(cb){ cb.textContent=a.confidence+'%'; }
  const rb=$('ar-badge'); if(rb){ rb.textContent=a.riskLevel; rb.className='badge '+rCls(a.riskLevel); }
  txt('a-reason', a.reasoning);
  cod('a-code', a.implementation);
  show('s-alt');
}

// Council mode handler
function onCouncilMode(d){
  S.councilMode=d.mode;
  const b=$('cm-badge');
  if(!b){ return; }
  b.textContent=d.mode;
  b.className='badge cm-'+d.mode.toLowerCase();
  b.classList.remove('hidden');
}

// Provider offline handler
function onProviderOffline(d){
  setNode(d.provider, 'offline');
}

// Intensity resolved (adaptive auto-detection)
function onIntensityResolved(d){
  const lvl=d.level.toLowerCase();
  document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.remove('on'); });
  const ab=document.querySelector('.ibtn[data-i="'+lvl+'"]');
  if(ab){ ab.classList.add('on'); }
  const al=$('i-auto-lbl');
  if(al){ al.textContent='(Auto: '+d.level+')'; al.classList.remove('hidden'); }
  S.intensity=lvl;
}

// Deadlock handler
function onDeadlock(d){
  S.dlVersions=d.versions||[];
  hide('s-phase');
  show('s-deadlock');
  setForge('forge-deadlock');
  // Pre-populate version cards (hidden until user picks "User Breaks Tie")
  const vc=$('version-cards');
  if(vc){
    vc.innerHTML='';
    S.dlVersions.forEach(function(v,i){
      const lbl=String.fromCharCode(65+i);
      const card=document.createElement('div');
      card.className='vc-card';
      card.innerHTML=
        '<div class="vc-header">'+
          '<span class="badge '+pCls(v.provider)+'">'+esc(pLbl(v.provider))+'</span>'+
          '<span style="font-size:11px;color:rgba(255,255,255,0.4);">Version '+esc(lbl)+'</span>'+
          '<span style="font-size:11px;color:rgba(255,255,255,0.45);flex:1;">'+esc(v.reasoning)+'</span>'+
          '<button class="btn-s" style="font-size:11px;padding:3px 9px;" data-action="selectVersion" data-provider="'+esc(v.provider)+'">Select</button>'+
        '</div>'+
        '<div class="vc-code">'+esc((v.code||'').slice(0,200))+'</div>';
      vc.appendChild(card);
    });
  }
}

// Synthesis rationale
function onSynthesisReady(d){
  txt('synth-rationale', d.rationale||'');
  show('s-synth-note');
  ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'synthesizing'); } });
  setTimeout(function(){ ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'reviewing'); } }); }, 1500);
  playConsensusTone();
}

// File explorer
function renderFileList(q){
  var fl=$('file-list'); if(!fl){ return; }
  var list=S.wsFiles;
  if(q){ list=list.filter(function(f){ return f.rel.toLowerCase().indexOf(q.toLowerCase())>=0; }); }
  fl.innerHTML='';
  list.slice(0,120).forEach(function(f){
    var on=S.ctxFiles.indexOf(f.rel)>=0;
    var div=document.createElement('div');
    div.className='fitem'+(on?' ctx-on':'');
    div.title=f.rel;
    div.innerHTML='<span class="fext">'+esc(f.lang||'')+'</span><span class="fname">'+esc(f.rel)+'</span>';
    div.addEventListener('click',function(){ send(on?'workspace:removeContext':'workspace:addContext',{relPath:f.rel}); });
    fl.appendChild(div);
  });
  if(list.length===0){ fl.innerHTML='<div style="font-size:11px;color:rgba(255,255,255,0.3);padding:4px 6px;">No files found.</div>'; }
}
function onWorkspaceTree(d){
  S.wsFiles=d.files||[];
  renderFileList(($('file-search')||{}).value||'');
}
function onContextUpdated(d){
  S.ctxFiles=d.contextFiles||[];
  var cc=$('ctx-count'), cb=$('btn-ctx-clear');
  if(cc){ if(S.ctxFiles.length){ cc.textContent=S.ctxFiles.length+' file'+(S.ctxFiles.length!==1?'s':''); cc.classList.remove('hidden'); } else { cc.classList.add('hidden'); } }
  if(cb){ cb.style.display=S.ctxFiles.length?'inline-block':'none'; }
  var cf=$('ctx-files'); if(!cf){ return; }
  cf.innerHTML='';
  S.ctxFiles.forEach(function(rel){
    var tag=document.createElement('div'); tag.className='ctx-tag';
    var lbl=document.createElement('span'); lbl.title=rel; lbl.textContent=rel;
    var rm=document.createElement('button'); rm.className='ctx-rm'; rm.title='Remove'; rm.textContent='\u00d7';
    rm.addEventListener('click',function(){ send('workspace:removeContext',{relPath:rel}); });
    tag.appendChild(lbl); tag.appendChild(rm);
    cf.appendChild(tag);
  });
  renderFileList(($('file-search')||{}).value||'');
}

// Git helpers
function mkGFile(f,type){
  var div=document.createElement('div'); div.className='gfile gfile-'+type;
  var btn=document.createElement('button'); btn.className='gbtn';
  if(type==='staged'){
    btn.textContent='Unstage';
    btn.addEventListener('click',function(){ send('git:unstage',{file:f}); });
  } else {
    btn.textContent='Stage';
    btn.addEventListener('click',function(){ send('git:stage',{file:f}); });
  }
  var nm=document.createElement('span'); nm.className='gname'; nm.title=f; nm.textContent=f;
  div.appendChild(btn); div.appendChild(nm);
  return div;
}
function onGitStatus(d){
  var bb=$('git-branch');
  if(bb){ if(d.branch){ bb.textContent=d.branch; bb.style.display='inline'; } else { bb.style.display='none'; } }
  var stgS=$('git-staged-sec'), stg=$('git-staged');
  if(d.staged&&d.staged.length){
    if(stgS){ stgS.style.display='block'; }
    if(stg){ stg.innerHTML=''; d.staged.forEach(function(f){ stg.appendChild(mkGFile(f,'staged')); }); }
  } else { if(stgS){ stgS.style.display='none'; } }
  var chS=$('git-changes-sec'), ch=$('git-changes');
  var allCh=(d.modified||[]).concat(d.untracked||[]);
  if(allCh.length){
    if(chS){ chS.style.display='block'; }
    if(ch){
      ch.innerHTML='';
      (d.modified||[]).forEach(function(f){ ch.appendChild(mkGFile(f,'changed')); });
      (d.untracked||[]).forEach(function(f){ ch.appendChild(mkGFile(f,'untracked')); });
    }
  } else { if(chS){ chS.style.display='none'; } }
  var ma=$('git-msg-area');
  var total=(d.staged||[]).length+allCh.length;
  if(ma){ ma.textContent=total?'':'Working tree clean.'; ma.style.display=total?'none':'block'; }
}

function onLicenseStatus(s){
  if(!s){ return; }
  var badge=$('lic-badge'),msg=$('lic-msg'),trialBar=$('lic-trial-bar'),
      keyRow=$('lic-key-row'),activeRow=$('lic-active-row'),keyDisp=$('lic-key-disp'),
      daysEl=$('lic-days'),prog=$('lic-prog'),lg=$('lic-gate');
  [trialBar,keyRow,activeRow].forEach(function(el){ if(el){ el.style.display='none'; } });
  if(badge){ badge.className=''; }
  if(lg){ lg.style.display='none'; }
  if(s.state==='active'){
    if(badge){ badge.classList.add('lic-active'); badge.textContent='PRO'; }
    if(msg){ msg.textContent=s.statusLabel||''; }
    if(activeRow){ activeRow.style.display='flex'; }
    if(keyDisp){ keyDisp.textContent=s.licenseKey||''; }
  } else if(s.state==='trial'){
    if(badge){ badge.classList.add('lic-trial'); badge.textContent='TRIAL'; }
    if(msg){ msg.textContent=s.statusLabel||''; }
    if(trialBar){ trialBar.style.display='block'; }
    if(daysEl){ daysEl.textContent=(s.trialDaysLeft||0)+' days'; }
    var pct=Math.max(0,Math.min(100,((s.trialDaysLeft||0)/1)*100));
    if(prog){ prog.style.width=pct+'%'; prog.style.background=pct<30?'#ef4444':pct<60?'#f59e0b':'linear-gradient(90deg,#6366f1,#10b981)'; }
  } else {
    if(badge){ badge.classList.add('lic-expired'); badge.textContent='EXPIRED'; }
    if(msg){ msg.textContent=s.statusLabel||''; }
    if(keyRow){ keyRow.style.display='flex'; }
  }
}
function onBranches(d){
  var sel=$('git-branch-select'); if(!sel){ return; }
  sel.innerHTML='';
  (d.all||[]).forEach(function(b){
    var o=document.createElement('option'); o.value=b; o.textContent=b;
    if(b===d.current){ o.selected=true; }
    sel.appendChild(o);
  });
}
function onGitDiff(d){
  var pre=$('git-diff-view'), wrap=$('git-diff-wrap');
  if(!pre||!wrap){ return; }
  if(!d.diff||!d.diff.trim()){ pre.textContent='No staged changes.'; wrap.style.display='block'; return; }
  pre.innerHTML='';
  d.diff.split('\n').forEach(function(line){
    var span=document.createElement('span');
    if(line.startsWith('+')&&!line.startsWith('+++'))      { span.className='diff-add'; }
    else if(line.startsWith('-')&&!line.startsWith('---')) { span.className='diff-rm'; }
    else if(line.startsWith('@@'))                         { span.className='diff-hunk'; }
    else if(/^(diff |index |--- |\+\+\+ )/.test(line))    { span.className='diff-file'; }
    span.textContent=line+'\n';
    pre.appendChild(span);
  });
  wrap.style.display='block';
}
function onGitLog(d){
  var ll=$('git-log-list'); if(!ll){ return; }
  ll.innerHTML='';
  if(!d.commits||!d.commits.length){ ll.innerHTML='<span style="font-size:10px;color:rgba(255,255,255,0.2);">No commits yet.</span>'; return; }
  d.commits.forEach(function(c){
    var row=document.createElement('div'); row.className='gcommit';
    var h=document.createElement('span'); h.className='ghash'; h.textContent=c.hash;
    var m=document.createElement('span'); m.className='gmsg'; m.title=c.message; m.textContent=c.message;
    row.appendChild(h); row.appendChild(m); ll.appendChild(row);
  });
}
function onConfigModels(d){
  var mo=$('m-openai'); if(mo){ mo.value=d.openai||''; }
  var mc=$('m-claude'); if(mc){ mc.value=d.claude||''; }
  var mg=$('m-grok');   if(mg){ mg.value=d.grok||''; }
}
function renderPromptHistory(){
  var hl=$('hist-list'), hw=$('s-history'); if(!hl||!hw){ return; }
  if(!S.promptHistory.length){ hw.style.display='none'; return; }
  hw.style.display='block'; hl.innerHTML='';
  S.promptHistory.forEach(function(p){
    var el=document.createElement('div'); el.className='hitem'; el.title=p; el.textContent=p;
    el.addEventListener('click',function(){ var ti=$('task-input'); if(ti){ ti.value=p; ti.focus(); } });
    hl.appendChild(el);
  });
}
function addToHistory(text){
  if(!text||!text.trim()){ return; }
  S.promptHistory=S.promptHistory.filter(function(p){ return p!==text; });
  S.promptHistory.unshift(text);
  if(S.promptHistory.length>20){ S.promptHistory.length=20; }
  renderPromptHistory();
}

// Apply cancelled
function onApplyCancelled(){
  toast('Patch not applied.', false);
}

// Critical objection handler
function onCriticalObjection(d){
  txt('cobj-who', pLbl(d.objector)+' has raised a critical objection.');
  txt('cobj-summary', d.objectionSummary||'Implementation rejected due to critical risk.');
  S.dlVersions=d.versions||[];
  hide('s-phase'); show('s-critical-obj');
  setForge('forge-split');
}

// Web Audio API — consensus tone (no external file)
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _audioCtx = null, _lastToneAt = 0;
const TONE_PARAMS = {
  adaptive:   {freq:740, detune:0,  gain:0.10, dur:0.28},
  cooperative:{freq:880, detune:-5, gain:0.07, dur:0.22},
  analytical: {freq:740, detune:-3, gain:0.10, dur:0.28},
  critical:   {freq:622, detune:0,  gain:0.12, dur:0.30},
  ruthless:   {freq:523, detune:5,  gain:0.13, dur:0.32},
};
function playConsensusTone(){
  if(!S.audioEnabled){ return; }
  const now=Date.now(); if(now-_lastToneAt<1500){ return; } _lastToneAt=now;
  try{
    if(!_audioCtx){ _audioCtx=new AudioCtx(); }
    if(_audioCtx.state==='suspended'){ _audioCtx.resume(); }
    const p=TONE_PARAMS[S.intensity]||TONE_PARAMS.analytical;
    const osc=_audioCtx.createOscillator(), gain=_audioCtx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(p.freq,_audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(p.freq+p.detune,_audioCtx.currentTime+p.dur);
    gain.gain.setValueAtTime(0,_audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(p.gain,_audioCtx.currentTime+0.04);
    gain.gain.exponentialRampToValueAtTime(0.001,_audioCtx.currentTime+p.dur);
    osc.connect(gain); gain.connect(_audioCtx.destination);
    osc.start(); osc.stop(_audioCtx.currentTime+p.dur+0.05);
  }catch(e){}
}

// Toast
function toast(msg, ok){
  const t=$('etst'); if(!t){ return; }
  t.textContent=msg;
  t.className=ok?'toast-ok':'';
  t.style.display='block';
  setTimeout(function(){ t.style.display='none'; }, 4500);
}

// Reset
function reset(){
  S.phase='IDLE'; S.running=false; S.debOpen=false; S.dlVersions=[];
  ['s-viz','s-phase','s-draft','s-risk','s-agree','s-result','s-debate','s-alt','s-deadlock','s-synth-note','s-critical-obj'].forEach(hide);
  show('s-input');
  resetNodes();
  const vc=$('vcards'); if(vc){ vc.innerHTML=''; }
  const dlvc=$('version-cards'); if(dlvc){ dlvc.innerHTML=''; dlvc.classList.add('hidden'); }
  document.querySelectorAll('.ps').forEach(function(el){ el.classList.remove('active','done'); });
  const bb=$('bypass-b'); if(bb){ bb.style.display='none'; }
  const al=$('i-auto-lbl'); if(al){ al.textContent=''; al.classList.add('hidden'); }
  const cmb=$('cm-badge'); if(cmb){ cmb.classList.add('hidden'); }
  // Reset deadlock buttons
  const dlub=$('btn-dl-user'); if(dlub){ dlub.textContent='\u{1F9D1} User Breaks Tie\u2026'; dlub.disabled=false; }
  // Reset depth classes
  const rviz=$('s-viz'); if(rviz){ rviz.classList.remove('depth-active'); }
  document.body.classList.remove('ruthless-active');
  ['claude','gpt','grok'].forEach(function(p){ const n=$('vn-'+p); if(n){ n.classList.remove('depth-on'); } });
  // Reset context files (keep file tree loaded)
  send('workspace:clearContext');
}

// Message listener
window.addEventListener('message', function(e){
  const d=e.data;
  switch(d.type){
    case 'providers':    updDots(d.status||{}); break;
    case 'phase':        onPhase(d); break;
    case 'draft-ready':  onDraft(d.draft); break;
    case 'risk-result':  onRisk(d.risk); break;
    case 'verdict':      onVerdict(d.verdict); break;
    case 'debate-complete': onDebate(d.debate); break;
    case 'session-complete': onComplete(d); break;
    case 'alternative-ready': onAlt(d.alternative); break;
    case 'apply-done':        toast('\\u2713 Applied to '+d.filePath, true); break;
    case 'apply-cancelled':   onApplyCancelled(); break;
    case 'error':             toast(d.message||'An error occurred.', false); if(S.running){ S.running=false; show('s-input'); } break;
    case 'council-mode':      onCouncilMode(d); break;
    case 'provider-offline':  onProviderOffline(d); break;
    case 'intensity-resolved': onIntensityResolved(d); break;
    case 'deadlock':          onDeadlock(d); break;
    case 'synthesis-ready':   onSynthesisReady(d); break;
    case 'critical-objection': onCriticalObjection(d); break;
    case 'workspace-tree':  onWorkspaceTree(d); break;
    case 'context-updated': onContextUpdated(d); break;
    case 'git-status':        onGitStatus(d); break;
    case 'git-error':         toast(d.message||'Git error.',false); break;
    case 'git-committed':
      toast('\u2713 Committed.',true);
      onGitStatus(d.status||{});
      var gm=$('git-commit-msg'); if(gm){ gm.value=''; }
      send('git:log'); send('git:branches');
      break;
    case 'git-pushed':        toast('\u2713 Pushed.',true); send('git:status'); send('git:log'); break;
    case 'git-generating':
      var b=$('btn-git-ai-msg'); if(b){ b.textContent='Generating\u2026'; b.disabled=true; }
      break;
    case 'git-message-ready':
      var b=$('btn-git-ai-msg'); if(b){ b.textContent='AI Message'; b.disabled=false; }
      var gm=$('git-commit-msg'); if(gm){ gm.value=d.message||''; }
      break;
    case 'git-branches':       onBranches(d); break;
    case 'git-diff':           onGitDiff(d); break;
    case 'git-log':            onGitLog(d); break;
    case 'config-models':      onConfigModels(d); break;
    case 'config-model-saved': toast('\u2713 Model saved.',true); break;
    case 'license-status':     onLicenseStatus(d.status); break;
    case 'license-activating':
      var ab=$('btn-lic-activate'); if(ab){ ab.textContent='Activating\u2026'; ab.disabled=true; }
      var er=$('lic-err'); if(er){ er.style.display='none'; }
      break;
    case 'license-error':
      var ab=$('btn-lic-activate'); if(ab){ ab.textContent='Activate'; ab.disabled=false; }
      var er=$('lic-err'); if(er){ er.textContent=d.error||'Activation failed.'; er.style.display='block'; }
      break;
    case 'license-gate':
      S.upgradeUrl=d.checkoutUrl||LS_CHECKOUT;
      var lg=$('lic-gate'),lgm=$('lic-gate-msg');
      if(lg){ lg.style.display='flex'; }
      if(lgm){ lgm.textContent=d.message||'Council mode requires an active license.'; }
      break;
    case 'escalated':
      S.intensity=d.intensity;
      document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.toggle('on', b.dataset.i===d.intensity); });
      toast('Intensity escalated to '+d.intensity.toUpperCase()+'. Re-run to apply.', false);
      break;
    case 'council-started':
      if(d.prompt){ const ti=$('task-input'); if(ti){ ti.value=d.prompt; } }
      if(d.originalCode){ const ci=$('ctx-input'); if(ci){ ci.value=d.originalCode; } }
      if(d.intensity){
        S.intensity=d.intensity;
        document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.toggle('on', b.dataset.i===d.intensity); });
      }
      break;
    case 'insert-prompt':
      if(d.text){ const ti=$('task-input'); if(ti){ ti.value=d.text; } }
      show('s-input');
      const fi=$('task-input'); if(fi){ fi.focus(); }
      break;
  }
});

// Button bindings
$('btn-run')&&$('btn-run').addEventListener('click',function(){
  const p=($('task-input')||{}).value||'', c=($('ctx-input')||{}).value||'';
  if(!p.trim()){ toast('Please describe your task before running the council.'); return; }
  addToHistory(p.trim());
  const al=$('i-auto-lbl'); if(al){ al.textContent=''; al.classList.add('hidden'); }
  send('council:run',{prompt:p.trim(),context:c.trim(),intensity:S.intensity});
});
$('btn-abort')&&$('btn-abort').addEventListener('click',function(){ send('council:abort'); });
$('btn-bypass')&&$('btn-bypass').addEventListener('click',function(){ send('council:applyDraft'); });
$('btn-apply')&&$('btn-apply').addEventListener('click',function(){ send('council:apply'); });
$('btn-esc')&&$('btn-esc').addEventListener('click',function(){ send('council:escalate'); });
$('btn-export')&&$('btn-export').addEventListener('click',function(){ send('council:export'); });
$('btn-reset')&&$('btn-reset').addEventListener('click',reset);
$('file-search')&&$('file-search').addEventListener('input',function(){ renderFileList(this.value); });
$('btn-ctx-clear')&&$('btn-ctx-clear').addEventListener('click',function(){ send('workspace:clearContext'); });
$('btn-git-refresh')&&$('btn-git-refresh').addEventListener('click',function(){ send('git:status'); });
$('btn-stage-all')&&$('btn-stage-all').addEventListener('click',function(){ send('git:stageAll'); });
$('btn-unstage-all')&&$('btn-unstage-all').addEventListener('click',function(){ send('git:unstageAll'); });
$('btn-git-commit')&&$('btn-git-commit').addEventListener('click',function(){
  var msg=($('git-commit-msg')||{}).value||'';
  if(!msg.trim()){ toast('Enter a commit message first.'); return; }
  send('git:commit',{message:msg.trim()});
});
$('btn-git-push')&&$('btn-git-push').addEventListener('click',function(){ send('git:push'); });
$('btn-git-ai-msg')&&$('btn-git-ai-msg').addEventListener('click',function(){ send('git:generateMessage'); });
$('btn-git-switch')&&$('btn-git-switch').addEventListener('click',function(){
  var sel=$('git-branch-select'); if(!sel||!sel.value){ return; }
  send('git:switchBranch',{name:sel.value});
});
$('btn-git-create')&&$('btn-git-create').addEventListener('click',function(){
  var inp=$('git-new-branch'); if(!inp||!inp.value.trim()){ return; }
  send('git:createBranch',{name:inp.value.trim()}); inp.value='';
});
$('btn-git-diff')&&$('btn-git-diff').addEventListener('click',function(){
  var wrap=$('git-diff-wrap');
  if(wrap&&wrap.style.display!=='none'){ wrap.style.display='none'; this.textContent='View Staged Diff'; return; }
  this.textContent='Hide Diff'; send('git:diff');
});
$('ms-openai')&&$('ms-openai').addEventListener('click',function(){ send('config:setModel',{provider:'openai',model:($('m-openai')||{}).value||''}); });
$('ms-claude')&&$('ms-claude').addEventListener('click',function(){ send('config:setModel',{provider:'claude',model:($('m-claude')||{}).value||''}); });
$('ms-grok')&&$('ms-grok').addEventListener('click',function(){   send('config:setModel',{provider:'grok',  model:($('m-grok')||{}).value||''}); });
$('btn-debate')&&$('btn-debate').addEventListener('click',function(){
  const ds=$('s-debate');
  if(!ds){ return; }
  if(ds.classList.contains('hidden')){
    show('s-debate');
    const db=$('dbody'); if(db){ db.classList.add('open'); S.debOpen=true; }
    this.textContent='Hide Debate';
  } else {
    hide('s-debate');
    this.textContent='View Debate';
  }
});
$('btn-adopt')&&$('btn-adopt').addEventListener('click',function(){ send('council:adoptAlt'); });
$('btn-vote')&&$('btn-vote').addEventListener('click',function(){ send('council:runVoteOnAlt'); hide('s-alt'); });
$('btn-discard')&&$('btn-discard').addEventListener('click',function(){ hide('s-alt'); });
$('dtoggle')&&$('dtoggle').addEventListener('click',function(){
  const db=$('dbody'); if(!db){ return; }
  S.debOpen=!S.debOpen;
  db.classList.toggle('open', S.debOpen);
  txt('darr', S.debOpen?'\\u25B2':'\\u25BC');
});
$('btn-cfg')&&$('btn-cfg').addEventListener('click',function(){
  const sc=$('s-cfg'); if(!sc){ return; }
  if(sc.classList.contains('hidden')){ show('s-cfg'); this.classList.add('active'); }
  else { hide('s-cfg'); this.classList.remove('active'); }
});
// Settings open by default — mark gear active on load
(function(){ var b=$('btn-cfg'); if(b){ b.classList.add('active'); } })();
// Collapsible settings section
$('cfg-sh')&&$('cfg-sh').addEventListener('click',function(){
  var body=$('cfg-body'), chev=$('cfg-chevron'); if(!body){ return; }
  var collapsed=body.style.display==='none';
  body.style.display=collapsed?'flex':'none';
  if(chev){ chev.style.transform=collapsed?'':'rotate(-90deg)'; }
});
document.querySelectorAll('.ibtn').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.remove('on'); });
    btn.classList.add('on');
    S.intensity=btn.dataset.i;
    const al=$('i-auto-lbl'); if(al){ al.textContent=''; al.classList.add('hidden'); }
    if(btn.dataset.i==='adaptive'){
      send('council:setIntensity',{lock:false});
    } else {
      send('council:setIntensity',{lock:true,level:(btn.dataset.i||'analytical').toUpperCase()});
    }
  });
});

// Deadlock button bindings
$('btn-dl-escalate')&&$('btn-dl-escalate').addEventListener('click',function(){
  hide('s-deadlock'); show('s-phase'); send('council:deadlock:escalate');
});
$('btn-dl-user')&&$('btn-dl-user').addEventListener('click',function(){
  const vc=$('version-cards');
  if(vc){ vc.classList.remove('hidden'); vc.style.display='flex'; }
  this.textContent='Select a version below\u2026'; this.disabled=true;
  send('council:deadlock:user');
});
$('btn-dl-synthesis')&&$('btn-dl-synthesis').addEventListener('click',function(){
  hide('s-deadlock'); show('s-phase'); send('council:deadlock:synthesis');
});
$('btn-dl-extended')&&$('btn-dl-extended').addEventListener('click',function(){
  hide('s-deadlock'); show('s-phase'); send('council:deadlock:extended');
});

// Critical objection button bindings
$('btn-co-alt')&&$('btn-co-alt').addEventListener('click',function(){
  hide('s-critical-obj');
  // Populate deadlock version cards from stored versions
  const vc=$('version-cards');
  if(vc && S.dlVersions.length){
    vc.innerHTML='';
    S.dlVersions.forEach(function(v,i){
      const lbl=String.fromCharCode(65+i);
      const card=document.createElement('div'); card.className='vc-card';
      card.innerHTML='<div class="vc-header">'+
        '<span class="badge '+pCls(v.provider)+'">'+esc(pLbl(v.provider))+'</span>'+
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);">Version '+esc(lbl)+'</span>'+
        '<span style="font-size:11px;color:rgba(255,255,255,0.45);flex:1;">'+esc(v.reasoning)+'</span>'+
        '<button class="btn-s" style="font-size:11px;padding:3px 9px;" data-action="selectVersion" data-provider="'+esc(v.provider)+'">Select</button>'+
        '</div><div class="vc-code">'+esc((v.code||'').slice(0,200))+'</div>';
      vc.appendChild(card);
    });
    vc.classList.remove('hidden'); vc.style.display='flex';
  }
  const dlub=$('btn-dl-user'); if(dlub){ dlub.textContent='Select a version below\u2026'; dlub.disabled=true; }
  show('s-deadlock');
  send('council:deadlock:user');
});
$('btn-co-override')&&$('btn-co-override').addEventListener('click',function(){ hide('s-critical-obj'); send('council:override:apply'); });
$('btn-co-debate')&&$('btn-co-debate').addEventListener('click',function(){ hide('s-critical-obj'); show('s-phase'); send('council:deadlock:extended'); });
$('btn-co-synth')&&$('btn-co-synth').addEventListener('click',function(){ hide('s-critical-obj'); show('s-phase'); send('council:deadlock:synthesis'); });

// API key buttons (no inline onclick — CSP safe)
['openai','claude','grok'].forEach(function(p){
  var sb=$('ks-'+p), rb=$('kr-'+p);
  if(sb){ sb.addEventListener('click',function(){ var inp=$('k-'+p); if(!inp||!inp.value.trim()){ return; } send('setApiKey',{provider:p,key:inp.value.trim()}); inp.value=''; toast('\u2713 '+pLbl(p)+' key saved.', true); }); }
  if(rb){ rb.addEventListener('click',function(){ send('removeApiKey',{provider:p}); }); }
});
$('btn-audio')&&$('btn-audio').addEventListener('click',function(){ S.audioEnabled=!S.audioEnabled; this.textContent=S.audioEnabled?'On':'Off'; this.classList.toggle('on',S.audioEnabled); });

// License button bindings
$('btn-lic-activate')&&$('btn-lic-activate').addEventListener('click',function(){
  var k=($('lic-key-inp')||{}).value||''; if(!k.trim()){ return; }
  send('license:activate',{key:k.trim()}); $('lic-key-inp').value='';
});
$('btn-lic-remove')&&$('btn-lic-remove').addEventListener('click',function(){ send('license:deactivate'); });
$('btn-lic-upgrade')&&$('btn-lic-upgrade').addEventListener('click',function(){ send('openExternal',{url:S.upgradeUrl||LS_CHECKOUT}); });
$('btn-gate-upgrade')&&$('btn-gate-upgrade').addEventListener('click',function(){ send('openExternal',{url:S.upgradeUrl||LS_CHECKOUT}); });
$('btn-gate-key')&&$('btn-gate-key').addEventListener('click',function(){
  var lg=$('lic-gate'); if(lg){ lg.style.display='none'; }
  var kr=$('lic-key-row'); if(kr){ kr.style.display='flex'; }
  var inp=$('lic-key-inp'); if(inp){ inp.focus(); }
});

// Event delegation for dynamic card buttons (CSP-safe, no inline onclick)
document.addEventListener('click',function(e){
  var t=e.target; if(!t){ return; }
  var action=t.dataset&&t.dataset.action;
  var prov=t.dataset&&t.dataset.provider;
  if(action==='reqAlt'){ send('council:requestAlt',{provider:prov}); }
  if(action==='selectVersion'){ hide('s-deadlock'); show('s-phase'); send('council:selectVersion',{provider:prov}); }
});

// Init
send('getProviders');
send('config:getModels');
send('workspace:getTree');
send('git:status');
send('git:branches');
send('git:log');
send('license:getStatus');
} catch(e) {
  var t=document.getElementById('etst');
  if(t){ t.textContent='JS Error: '+(e&&e.message||String(e)); t.className=''; t.style.display='block'; t.style.color='#ef4444'; t.style.padding='8px'; t.style.fontSize='11px'; }
}
})();
</script>
</body>
</html>`;
  }
}
