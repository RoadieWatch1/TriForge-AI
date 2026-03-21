import * as vscode from 'vscode';
import { TriForgeCouncilPanel } from './webview/panel';
import { ProviderManager } from '@triforge/engine';
import { VSCodeStorageAdapter } from './platform';
import { LicenseManager, LicenseStatus } from './core/license';
import { ReviewRuntime } from './reviewRuntime';
import { registerPanelCommands } from './commands/panelCommands';
import { registerSelectionCommands } from './commands/selectionCommands';

let activeReviewRuntime: ReviewRuntime | undefined;
let activeProviderManager: ProviderManager | undefined;
let activeLicenseManager: LicenseManager | undefined;

export function getReviewRuntime(): ReviewRuntime {
  if (!activeReviewRuntime) { throw new Error('TriForge AI review runtime is not initialized.'); }
  return activeReviewRuntime;
}

export function getProviderManager(): ProviderManager {
  if (!activeProviderManager) { throw new Error('TriForge AI provider manager is not initialized.'); }
  return activeProviderManager;
}

export function getLicenseManager(): LicenseManager {
  if (!activeLicenseManager) { throw new Error('TriForge AI license manager is not initialized.'); }
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
    (name) => vscode.workspace.getConfiguration('triforgeAi').get<string>(`${name}.model`) || undefined,
  );
  const licenseManager = new LicenseManager(context.secrets, context.globalState);
  const reviewRuntime = new ReviewRuntime();

  activeProviderManager = providerManager;
  activeLicenseManager = licenseManager;
  activeReviewRuntime = reviewRuntime;

  // ── Status bar ────────────────────────────────────────────────────────────
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
    if (status.state === 'active') { return ' ◆ Pro'; }
    if (status.state === 'trial') { return ` · Trial ${status.trialDaysLeft}d`; }
    return ' ⚠ Expired';
  }

  function refreshStatusBarText(mode: string) {
    statusBar.text = (modeLabels[mode] ?? '⬡ TriForge') + licBadge;
  }

  function onLicenseUpdate(status: LicenseStatus) {
    licBadge = licenseBadge(status);
    statusBar.text = statusBar.text.replace(/ [◆·⚠].*$/, '') + licBadge;
    TriForgeCouncilPanel.currentPanel?.sendLicenseStatus(status);
  }

  licenseManager.initialize().then((status) => {
    licBadge = licenseBadge(status);
    providerManager.detectMode().then((modeInfo) => { refreshStatusBarText(modeInfo.mode); });
  });

  providerManager.onDidChangeStatus((modeInfo) => { refreshStatusBarText(modeInfo.mode); });
  providerManager.detectMode().then((modeInfo) => { refreshStatusBarText(modeInfo.mode); });

  // ── Command registration ──────────────────────────────────────────────────
  context.subscriptions.push(
    ...registerPanelCommands(context, providerManager, licenseManager, reviewRuntime, onLicenseUpdate),
    ...registerSelectionCommands(context, providerManager, licenseManager),
    statusBar,
  );
}

export function deactivate() {
  activeReviewRuntime = undefined;
  activeProviderManager = undefined;
  activeLicenseManager = undefined;
}
