import * as vscode from 'vscode';
import * as path from 'path';
import { TriForgeCouncilPanel } from './webview/panel';
import { ProviderManager, ProviderName } from '@triforge/engine';
import { VSCodeStorageAdapter } from './platform';
import { LicenseManager, LicenseStatus } from './core/license';
import { ReviewRuntime } from './reviewRuntime';

/**
 * TriForge AI Extension — Reviewed coding runtime for VS Code.
 *
 * Current direction:
 * - keep the existing Council panel working
 * - register the new review runtime as extension infrastructure
 * - prepare a clean handoff point so panel.ts can call the runtime next
 */

let activeReviewRuntime: ReviewRuntime | undefined;
let activeProviderManager: ProviderManager | undefined;
let activeLicenseManager: LicenseManager | undefined;

export function getReviewRuntime(): ReviewRuntime {
  if (!activeReviewRuntime) {
    throw new Error('TriForge AI review runtime is not initialized.');
  }
  return activeReviewRuntime;
}

export function getProviderManager(): ProviderManager {
  if (!activeProviderManager) {
    throw new Error('TriForge AI provider manager is not initialized.');
  }
  return activeProviderManager;
}

export function getLicenseManager(): LicenseManager {
  if (!activeLicenseManager) {
    throw new Error('TriForge AI license manager is not initialized.');
  }
  return activeLicenseManager;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('TriForge AI extension activated');
  try {
    _activate(context);
  } catch (err) {
    console.error('TriForge AI failed to activate:', err);
    vscode.window.showErrorMessage(`TriForge AI failed to activate: ${err}`);
  }
}

function _activate(context: vscode.ExtensionContext) {
  const storage = new VSCodeStorageAdapter(context.secrets, context.globalState);
  const providerManager = new ProviderManager(
    storage,
    (name) =>
      vscode.workspace.getConfiguration('triforgeAi').get<string>(`${name}.model`) || undefined,
  );
  const licenseManager = new LicenseManager(context.secrets, context.globalState);
  const reviewRuntime = new ReviewRuntime();

  activeProviderManager = providerManager;
  activeLicenseManager = licenseManager;
  activeReviewRuntime = reviewRuntime;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'triforge-ai.openPanel';
  statusBar.text = '⬡ TriForge';
  statusBar.tooltip = 'TriForge AI — Click to open Council';
  statusBar.show();

  const modeLabels: Record<string, string> = {
    none: '⬡ TriForge: No Keys',
    single: '⬡ TriForge: Single',
    pair: '⬡ TriForge: Pair',
    consensus: '⬡ TriForge: Council',
  };

  let licBadge = '';

  function licenseBadge(status: LicenseStatus): string {
    if (status.state === 'active') {
      return ' ◆ Pro';
    }
    if (status.state === 'trial') {
      return ` · Trial ${status.trialDaysLeft}d`;
    }
    return ' ⚠ Expired';
  }

  function refreshStatusBarText(mode: string) {
    statusBar.text = (modeLabels[mode] ?? '⬡ TriForge') + licBadge;
  }

  licenseManager.initialize().then((status) => {
    licBadge = licenseBadge(status);
    providerManager.detectMode().then((modeInfo) => {
      refreshStatusBarText(modeInfo.mode);
    });
  });

  providerManager.onDidChangeStatus((modeInfo) => {
    refreshStatusBarText(modeInfo.mode);
  });

  providerManager.detectMode().then((modeInfo) => {
    refreshStatusBarText(modeInfo.mode);
  });

  const openPanelCommand = vscode.commands.registerCommand('triforge-ai.openPanel', () => {
    licenseManager.validateLicense().then((status) => {
      licBadge = licenseBadge(status);
      statusBar.text = statusBar.text.replace(/ [◆·⚠].*$/, '') + licBadge;
      TriForgeCouncilPanel.currentPanel?.sendLicenseStatus(status);
    });

    TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager, licenseManager);
  });

  const openChatCommand = vscode.commands.registerCommand('triforge-ai.openChat', () => {
    TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager, licenseManager);
  });

  const setKeyCommand = vscode.commands.registerCommand('triforge-ai.setApiKey', async () => {
    const provider = await vscode.window.showQuickPick(
      [
        { label: 'OpenAI', value: 'openai' as ProviderName },
        { label: 'Grok', value: 'grok' as ProviderName },
        { label: 'Claude', value: 'claude' as ProviderName },
      ],
      { placeHolder: 'Select AI provider to configure' },
    );

    if (!provider) {
      return;
    }

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.label} API key`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Paste your API key here...',
    });

    if (!key) {
      return;
    }

    await providerManager.setKey(provider.value, key);
    vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key saved securely.`);

    if (TriForgeCouncilPanel.currentPanel) {
      TriForgeCouncilPanel.currentPanel.refreshProviderStatus();
    }
  });

  const removeKeyCommand = vscode.commands.registerCommand(
    'triforge-ai.removeApiKey',
    async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', value: 'openai' as ProviderName },
          { label: 'Grok', value: 'grok' as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to disconnect' },
      );

      if (!provider) {
        return;
      }

      await providerManager.removeKey(provider.value);
      vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key removed.`);

      if (TriForgeCouncilPanel.currentPanel) {
        TriForgeCouncilPanel.currentPanel.refreshProviderStatus();
      }
    },
  );

  const checkStatusCommand = vscode.commands.registerCommand(
    'triforge-ai.checkProviderStatus',
    async () => {
      const statuses = await providerManager.getStatus();
      const modeInfo = await providerManager.detectMode();
      const lines = statuses.map(
        (status) =>
          `${status.connected ? '$(check)' : '$(close)'} ${status.name}: ${
            status.connected ? 'Connected' : 'Not configured'
          }`,
      );

      lines.push('', `Mode: ${modeInfo.recommended}`);
      vscode.window.showInformationMessage(lines.join('  |  '));
    },
  );

  const activateLicenseCommand = vscode.commands.registerCommand(
    'triforge-ai.activateLicense',
    async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your TriForge AI Code Council license key',
        ignoreFocusOut: true,
        placeHolder: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
      });

      if (!key) {
        return;
      }

      const result = await licenseManager.activateLicense(key.trim());

      if (result.success) {
        const status = await licenseManager.getStatus();
        licBadge = licenseBadge(status);
        statusBar.text = statusBar.text.replace(/ [◆·⚠].*$/, '') + licBadge;
        TriForgeCouncilPanel.currentPanel?.sendLicenseStatus(status);
        vscode.window.showInformationMessage('TriForge AI: License activated successfully.');
      } else {
        vscode.window.showErrorMessage(`TriForge AI: Activation failed — ${result.error}`);
      }
    },
  );

  const deactivateLicenseCommand = vscode.commands.registerCommand(
    'triforge-ai.deactivateLicense',
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Remove your TriForge AI license from this machine?',
        { modal: true },
        'Remove',
        'Cancel',
      );

      if (confirm !== 'Remove') {
        return;
      }

      await licenseManager.deactivateLicense();
      const status = await licenseManager.getStatus();
      licBadge = licenseBadge(status);
      statusBar.text = statusBar.text.replace(/ [◆·⚠].*$/, '') + licBadge;
      TriForgeCouncilPanel.currentPanel?.sendLicenseStatus(status);
      vscode.window.showInformationMessage('TriForge AI: License removed.');
    },
  );

  function selectionCommand(
    buildPrompt: (selection: string, lang: string, fileName: string) => string,
    intensity = 'analytical',
    options?: {
      reviewRuntime?: boolean;
      governed?: boolean;
    },
  ) {
    return () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        vscode.window.showInformationMessage('TriForge AI: Select some code first.');
        return;
      }

      TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager, licenseManager);

      if (TriForgeCouncilPanel.currentPanel) {
        const filePath = editor.document.fileName;
        const fileName = path.basename(filePath);
        const lang = editor.document.languageId;
        const fullFileContent = editor.document.getText();
        const prompt = buildPrompt(selection, lang, fileName);

        TriForgeCouncilPanel.currentPanel.runForSelection(
          prompt,
          selection,
          intensity,
          filePath,
          fullFileContent,
          options,
        );
      }
    };
  }

  const explainCommand = vscode.commands.registerCommand(
    'triforge-ai.explainSelection',
    selectionCommand(
      (_sel, lang, file) =>
        `Explain this ${lang} code from \`${file}\` clearly. Walk through what it does step by step, identify any issues, and suggest improvements.`,
    ),
  );

  const writeTestsCommand = vscode.commands.registerCommand(
    'triforge-ai.writeTests',
    selectionCommand(
      (_sel, lang, file) =>
        `Write comprehensive tests for this ${lang} code from \`${file}\`. Cover happy paths, edge cases, and error states. Use the appropriate test framework for this language.`,
    ),
  );

  const refactorCommand = vscode.commands.registerCommand(
    'triforge-ai.refactorCode',
    selectionCommand(
      (_sel, lang, file) =>
        `Refactor this ${lang} code from \`${file}\` for clarity, performance, and best practices. Show the complete improved version.`,
    ),
  );

  const findBugsCommand = vscode.commands.registerCommand(
    'triforge-ai.findBugs',
    selectionCommand(
      (_sel, lang, file) =>
        `Review this ${lang} code from \`${file}\` for bugs, security issues, and logic errors. Produce a corrected version with all issues fixed.`,
      'analytical',
      { reviewRuntime: true },
    ),
  );

  const exportDebateCommand = vscode.commands.registerCommand(
    'triforge-ai.exportDebate',
    async () => {
      if (!TriForgeCouncilPanel.currentPanel) {
        vscode.window.showWarningMessage(
          'TriForge AI: Open the Council panel first and run a request.',
        );
        return;
      }

      await TriForgeCouncilPanel.currentPanel.exportDebate();
    },
  );

  const reviewRuntimeStatusCommand = vscode.commands.registerCommand(
    'triforge-ai.reviewRuntimeStatus',
    async () => {
      const sessionCount = reviewRuntime.getSessionStore().listSessions().length;
      const modeInfo = await providerManager.detectMode();

      vscode.window.showInformationMessage(
        `TriForge AI review runtime is ready. Sessions: ${sessionCount} | Provider mode: ${modeInfo.recommended}`,
      );
    },
  );

  context.subscriptions.push(
    openPanelCommand,
    openChatCommand,
    setKeyCommand,
    removeKeyCommand,
    checkStatusCommand,
    explainCommand,
    writeTestsCommand,
    refactorCommand,
    findBugsCommand,
    exportDebateCommand,
    activateLicenseCommand,
    deactivateLicenseCommand,
    reviewRuntimeStatusCommand,
    statusBar,
  );
}

export function deactivate() {
  activeReviewRuntime = undefined;
  activeProviderManager = undefined;
  activeLicenseManager = undefined;
}