import * as vscode from 'vscode';
import * as path from 'path';
import { TriForgeChatPanel } from './webview/panel';
import { ProviderManager, ProviderName } from '@triforge/engine';
import { VSCodeStorageAdapter } from './platform';

/**
 * TriForge AI Extension - Tri-model consensus AI for building apps
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

  // Register the "Open Chat" command
  const openChatCommand = vscode.commands.registerCommand(
    'triforge-ai.openChat',
    () => {
      TriForgeChatPanel.createOrShow(context.extensionUri, providerManager);
    }
  );

  // Add/Update API Key via command palette
  const setKeyCommand = vscode.commands.registerCommand(
    'triforge-ai.setApiKey',
    async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', value: 'openai' as ProviderName },
          { label: 'Gemini', value: 'gemini' as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to configure' }
      );
      if (!provider) { return; }

      const key = await vscode.window.showInputBox({
        prompt: `Enter your ${provider.label} API key`,
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'Paste your API key here...',
      });
      if (!key) { return; }

      await providerManager.setKey(provider.value, key);
      vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key saved securely.`);

      // Update webview if open
      if (TriForgeChatPanel.currentPanel) {
        TriForgeChatPanel.currentPanel.refreshProviderStatus();
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
          { label: 'Gemini', value: 'gemini' as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to disconnect' }
      );
      if (!provider) { return; }

      await providerManager.removeKey(provider.value);
      vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key removed.`);

      if (TriForgeChatPanel.currentPanel) {
        TriForgeChatPanel.currentPanel.refreshProviderStatus();
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

  // ─── Helper: open panel + insert prompt from editor selection ────────────────
  function selectionCommand(buildPrompt: (selection: string, lang: string, fileName: string) => string) {
    return () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        vscode.window.showInformationMessage('TriForge AI: Select some code first.');
        return;
      }
      TriForgeChatPanel.createOrShow(context.extensionUri, providerManager);
      if (TriForgeChatPanel.currentPanel) {
        const fileName = path.basename(editor.document.fileName);
        const lang = editor.document.languageId;
        TriForgeChatPanel.currentPanel.insertPrompt(buildPrompt(selection, lang, fileName));
      }
    };
  }

  // Explain selected code
  const explainCommand = vscode.commands.registerCommand(
    'triforge-ai.explainSelection',
    selectionCommand((sel, lang, file) =>
      `Explain this ${lang} code from \`${file}\` clearly. Walk through what it does step by step:\n\`\`\`${lang}\n${sel}\n\`\`\``
    )
  );

  // Write tests for selection
  const writeTestsCommand = vscode.commands.registerCommand(
    'triforge-ai.writeTests',
    selectionCommand((sel, lang, file) =>
      `Write comprehensive tests for this ${lang} code from \`${file}\`. Cover happy paths, edge cases, and error states. Use the appropriate test framework for this language:\n\`\`\`${lang}\n${sel}\n\`\`\``
    )
  );

  // Refactor selection
  const refactorCommand = vscode.commands.registerCommand(
    'triforge-ai.refactorCode',
    selectionCommand((sel, lang, file) =>
      `Refactor this ${lang} code from \`${file}\` for clarity, performance, and best practices. Show the improved version and explain each change:\n\`\`\`${lang}\n${sel}\n\`\`\``
    )
  );

  // Find bugs in selection
  const findBugsCommand = vscode.commands.registerCommand(
    'triforge-ai.findBugs',
    selectionCommand((sel, lang, file) =>
      `Review this ${lang} code from \`${file}\` for bugs, security issues, and logic errors. List each problem with its severity and how to fix it:\n\`\`\`${lang}\n${sel}\n\`\`\``
    )
  );

  // Export last debate as markdown
  const exportDebateCommand = vscode.commands.registerCommand(
    'triforge-ai.exportDebate',
    async () => {
      if (!TriForgeChatPanel.currentPanel) {
        vscode.window.showWarningMessage('TriForge AI: Open the chat panel first and run a consensus request.');
        return;
      }
      TriForgeChatPanel.currentPanel.exportDebate();
    }
  );

  // Status bar item — always visible, shows current mode
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'triforge-ai.openChat';
  statusBar.text = '⬡ TriForge';
  statusBar.tooltip = 'TriForge AI — Click to open chat';
  statusBar.show();

  const modeLabels: Record<string, string> = {
    none: '⬡ TriForge: No Keys',
    single: '⬡ TriForge: Single',
    pair: '⬡ TriForge: Pair',
    consensus: '⬡ TriForge: Consensus',
  };
  providerManager.onDidChangeStatus((modeInfo) => {
    statusBar.text = modeLabels[modeInfo.mode] ?? '⬡ TriForge';
  });
  // Initialise the label on activation
  providerManager.detectMode().then(m => { statusBar.text = modeLabels[m.mode] ?? '⬡ TriForge'; });

  context.subscriptions.push(
    openChatCommand, setKeyCommand, removeKeyCommand, checkStatusCommand,
    explainCommand, writeTestsCommand, refactorCommand, findBugsCommand,
    exportDebateCommand, statusBar
  );
}

export function deactivate() {}
