import * as vscode from 'vscode';
import * as path from 'path';
import { TriForgeCouncilPanel } from './webview/panel';
import { ProviderManager, ProviderName } from '@triforge/engine';
import { VSCodeStorageAdapter } from './platform';

/**
 * TriForge AI Extension — Structured Council deliberation engine.
 */

export function activate(context: vscode.ExtensionContext) {
  console.log('TriForge AI extension activated');
  try { _activate(context); } catch (err) { console.error('TriForge AI failed to activate:', err); vscode.window.showErrorMessage(`TriForge AI failed to activate: ${err}`); }
}

function _activate(context: vscode.ExtensionContext) {

  const storage = new VSCodeStorageAdapter(context.secrets, context.globalState);
  const providerManager = new ProviderManager(storage, (name) =>
    vscode.workspace.getConfiguration('triforgeAi').get<string>(`${name}.model`) || undefined
  );

  // Open Council panel
  const openPanelCommand = vscode.commands.registerCommand(
    'triforge-ai.openPanel',
    () => { TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager); }
  );

  // Keep openChat as an alias so any saved keybindings still work
  const openChatCommand = vscode.commands.registerCommand(
    'triforge-ai.openChat',
    () => { TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager); }
  );

  // Add/Update API Key via command palette
  const setKeyCommand = vscode.commands.registerCommand(
    'triforge-ai.setApiKey',
    async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', value: 'openai' as ProviderName },
          { label: 'Grok',   value: 'grok'   as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to configure' }
      );
      if (!provider) { return; }
      const key = await vscode.window.showInputBox({
        prompt: `Enter your ${provider.label} API key`,
        password: true, ignoreFocusOut: true,
        placeHolder: 'Paste your API key here...',
      });
      if (!key) { return; }
      await providerManager.setKey(provider.value, key);
      vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key saved securely.`);
      if (TriForgeCouncilPanel.currentPanel) {
        TriForgeCouncilPanel.currentPanel.refreshProviderStatus();
      }
    }
  );

  // Remove API Key via command palette
  const removeKeyCommand = vscode.commands.registerCommand(
    'triforge-ai.removeApiKey',
    async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', value: 'openai' as ProviderName },
          { label: 'Grok',   value: 'grok'   as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to disconnect' }
      );
      if (!provider) { return; }
      await providerManager.removeKey(provider.value);
      vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key removed.`);
      if (TriForgeCouncilPanel.currentPanel) {
        TriForgeCouncilPanel.currentPanel.refreshProviderStatus();
      }
    }
  );

  // Check provider status
  const checkStatusCommand = vscode.commands.registerCommand(
    'triforge-ai.checkProviderStatus',
    async () => {
      const statuses = await providerManager.getStatus();
      const modeInfo = await providerManager.detectMode();
      const lines = statuses.map(
        s => `${s.connected ? '$(check)' : '$(close)'} ${s.name}: ${s.connected ? 'Connected' : 'Not configured'}`
      );
      lines.push('', `Mode: ${modeInfo.recommended}`);
      vscode.window.showInformationMessage(lines.join('  |  '));
    }
  );

  // ─── Helper: open panel + run council for editor selection ──────────────────
  function selectionCommand(
    buildPrompt: (selection: string, lang: string, fileName: string) => string,
    intensity: string = 'analytical'
  ) {
    return () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        vscode.window.showInformationMessage('TriForge AI: Select some code first.');
        return;
      }
      TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager);
      if (TriForgeCouncilPanel.currentPanel) {
        const fileName = path.basename(editor.document.fileName);
        const lang = editor.document.languageId;
        const prompt = buildPrompt(selection, lang, fileName);
        TriForgeCouncilPanel.currentPanel.runForSelection(prompt, selection, intensity);
      }
    };
  }

  // Explain selected code
  const explainCommand = vscode.commands.registerCommand(
    'triforge-ai.explainSelection',
    selectionCommand((sel, lang, file) =>
      `Explain this ${lang} code from \`${file}\` clearly. Walk through what it does step by step, identify any issues, and suggest improvements.`
    )
  );

  // Write tests for selection
  const writeTestsCommand = vscode.commands.registerCommand(
    'triforge-ai.writeTests',
    selectionCommand((sel, lang, file) =>
      `Write comprehensive tests for this ${lang} code from \`${file}\`. Cover happy paths, edge cases, and error states. Use the appropriate test framework for this language.`
    )
  );

  // Refactor selection
  const refactorCommand = vscode.commands.registerCommand(
    'triforge-ai.refactorCode',
    selectionCommand((sel, lang, file) =>
      `Refactor this ${lang} code from \`${file}\` for clarity, performance, and best practices. Show the complete improved version.`
    )
  );

  // Find bugs in selection
  const findBugsCommand = vscode.commands.registerCommand(
    'triforge-ai.findBugs',
    selectionCommand((sel, lang, file) =>
      `Review this ${lang} code from \`${file}\` for bugs, security issues, and logic errors. Produce a corrected version with all issues fixed.`
    )
  );

  // Export last debate as markdown
  const exportDebateCommand = vscode.commands.registerCommand(
    'triforge-ai.exportDebate',
    async () => {
      if (!TriForgeCouncilPanel.currentPanel) {
        vscode.window.showWarningMessage('TriForge AI: Open the Council panel first and run a request.');
        return;
      }
      await TriForgeCouncilPanel.currentPanel.exportDebate();
    }
  );

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'triforge-ai.openPanel';
  statusBar.text = '\u2B21 TriForge';
  statusBar.tooltip = 'TriForge AI — Click to open Council';
  statusBar.show();

  const modeLabels: Record<string, string> = {
    none:      '\u2B21 TriForge: No Keys',
    single:    '\u2B21 TriForge: Single',
    pair:      '\u2B21 TriForge: Pair',
    consensus: '\u2B21 TriForge: Council',
  };
  providerManager.onDidChangeStatus((modeInfo) => {
    statusBar.text = modeLabels[modeInfo.mode] ?? '\u2B21 TriForge';
  });
  providerManager.detectMode().then(m => { statusBar.text = modeLabels[m.mode] ?? '\u2B21 TriForge'; });

  context.subscriptions.push(
    openPanelCommand, openChatCommand, setKeyCommand, removeKeyCommand, checkStatusCommand,
    explainCommand, writeTestsCommand, refactorCommand, findBugsCommand,
    exportDebateCommand, statusBar
  );
}

export function deactivate() {}
