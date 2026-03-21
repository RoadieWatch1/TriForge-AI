// selectionCommands.ts — Selection-based context menu commands, extracted from extension.ts.

import * as vscode from 'vscode';
import * as path from 'path';
import { TriForgeCouncilPanel } from '../webview/panel';
import type { ProviderManager } from '@triforge/engine';
import type { LicenseManager } from '../core/license';

function selectionCommand(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager,
  licenseManager: LicenseManager,
  buildPrompt: (selection: string, lang: string, fileName: string) => string,
  intensity = 'analytical',
  options?: {
    reviewRuntime?: boolean;
    governed?: boolean;
  },
) {
  return () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

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

export function registerSelectionCommands(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager,
  licenseManager: LicenseManager,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      'triforge-ai.explainSelection',
      selectionCommand(context, providerManager, licenseManager,
        (_sel, lang, file) =>
          `Explain this ${lang} code from \`${file}\` clearly. Walk through what it does step by step, identify any issues, and suggest improvements.`,
      ),
    ),
    vscode.commands.registerCommand(
      'triforge-ai.writeTests',
      selectionCommand(context, providerManager, licenseManager,
        (_sel, lang, file) =>
          `Write comprehensive tests for this ${lang} code from \`${file}\`. Cover happy paths, edge cases, and error states. Use the appropriate test framework for this language.`,
      ),
    ),
    vscode.commands.registerCommand(
      'triforge-ai.refactorCode',
      selectionCommand(context, providerManager, licenseManager,
        (_sel, lang, file) =>
          `Refactor this ${lang} code from \`${file}\` for clarity, performance, and best practices. Show the complete improved version.`,
      ),
    ),
    vscode.commands.registerCommand(
      'triforge-ai.findBugs',
      selectionCommand(context, providerManager, licenseManager,
        (_sel, lang, file) =>
          `Review this ${lang} code from \`${file}\` for bugs, security issues, and logic errors. Produce a corrected version with all issues fixed.`,
        'analytical',
        { reviewRuntime: true },
      ),
    ),
  ];
}
