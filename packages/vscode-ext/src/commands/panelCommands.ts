// panelCommands.ts — Panel-level VS Code commands, extracted from extension.ts.

import * as vscode from 'vscode';
import { TriForgeCouncilPanel } from '../webview/panel';
import type { ProviderManager, ProviderName } from '@triforge/engine';
import type { LicenseManager, LicenseStatus } from '../core/license';
import type { ReviewRuntime } from '../reviewRuntime';

export function registerPanelCommands(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager,
  licenseManager: LicenseManager,
  reviewRuntime: ReviewRuntime,
  onLicenseUpdate: (status: LicenseStatus) => void,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('triforge-ai.openPanel', () => {
      licenseManager.validateLicense().then((status) => { onLicenseUpdate(status); });
      TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager, licenseManager);
    }),

    vscode.commands.registerCommand('triforge-ai.openChat', () => {
      TriForgeCouncilPanel.createOrShow(context.extensionUri, providerManager, licenseManager);
    }),

    vscode.commands.registerCommand('triforge-ai.setApiKey', async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', value: 'openai' as ProviderName },
          { label: 'Grok', value: 'grok' as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to configure' },
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
      TriForgeCouncilPanel.currentPanel?.refreshProviderStatus();
    }),

    vscode.commands.registerCommand('triforge-ai.removeApiKey', async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', value: 'openai' as ProviderName },
          { label: 'Grok', value: 'grok' as ProviderName },
          { label: 'Claude', value: 'claude' as ProviderName },
        ],
        { placeHolder: 'Select AI provider to disconnect' },
      );
      if (!provider) { return; }
      await providerManager.removeKey(provider.value);
      vscode.window.showInformationMessage(`TriForge AI: ${provider.label} key removed.`);
      TriForgeCouncilPanel.currentPanel?.refreshProviderStatus();
    }),

    vscode.commands.registerCommand('triforge-ai.checkProviderStatus', async () => {
      const statuses = await providerManager.getStatus();
      const modeInfo = await providerManager.detectMode();
      const lines = statuses.map(
        (s) => `${s.connected ? '$(check)' : '$(close)'} ${s.name}: ${s.connected ? 'Connected' : 'Not configured'}`,
      );
      lines.push('', `Mode: ${modeInfo.recommended}`);
      vscode.window.showInformationMessage(lines.join('  |  '));
    }),

    vscode.commands.registerCommand('triforge-ai.activateLicense', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your TriForge AI Code Council license key',
        ignoreFocusOut: true,
        placeHolder: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
      });
      if (!key) { return; }
      const result = await licenseManager.activateLicense(key.trim());
      if (result.success) {
        const status = await licenseManager.getStatus();
        onLicenseUpdate(status);
        vscode.window.showInformationMessage('TriForge AI: License activated successfully.');
      } else {
        vscode.window.showErrorMessage(`TriForge AI: Activation failed — ${result.error}`);
      }
    }),

    vscode.commands.registerCommand('triforge-ai.deactivateLicense', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Remove your TriForge AI license from this machine?',
        { modal: true },
        'Remove',
        'Cancel',
      );
      if (confirm !== 'Remove') { return; }
      await licenseManager.deactivateLicense();
      const status = await licenseManager.getStatus();
      onLicenseUpdate(status);
      vscode.window.showInformationMessage('TriForge AI: License removed.');
    }),

    vscode.commands.registerCommand('triforge-ai.exportDebate', async () => {
      if (!TriForgeCouncilPanel.currentPanel) {
        vscode.window.showWarningMessage('TriForge AI: Open the Council panel first and run a request.');
        return;
      }
      await TriForgeCouncilPanel.currentPanel.exportDebate();
    }),

    vscode.commands.registerCommand('triforge-ai.reviewRuntimeStatus', async () => {
      const sessionCount = reviewRuntime.getSessionStore().listSessions().length;
      const modeInfo = await providerManager.detectMode();
      vscode.window.showInformationMessage(
        `TriForge AI review runtime is ready. Sessions: ${sessionCount} | Provider mode: ${modeInfo.recommended}`,
      );
    }),
  ];
}
