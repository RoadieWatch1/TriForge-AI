// ledger.ts — Council Decision Ledger helpers, extracted from panel.ts.
// Manages per-workspace consent and JSON ledger file.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CouncilRecord } from './panelTypes';

export interface LedgerState {
  enabled: boolean | null;
  consentShown: boolean;
}

export function checkLedgerConsent(state: LedgerState): void {
  if (state.consentShown) { return; }
  state.consentShown = true;
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) { return; }
  const dir = path.join(wsFolder, '.triforge');
  const consentPath = path.join(dir, 'consent.json');
  try {
    if (fs.existsSync(consentPath)) {
      const data = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
      state.enabled = data.enabled === true;
      return;
    }
  } catch { /* ignore */ }
  // Show one-time consent prompt (fire-and-forget)
  vscode.window.showInformationMessage(
    'TriForge AI: Enable a local Council Decision Ledger for this workspace?',
    'Enable for this workspace', 'Disable'
  ).then(choice => {
    const enabled = choice === 'Enable for this workspace';
    state.enabled = enabled;
    try {
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      fs.writeFileSync(consentPath, JSON.stringify({ enabled, ts: Date.now() }));
    } catch { /* ignore */ }
  });
}

export function saveLedgerRecord(state: LedgerState, record: CouncilRecord): void {
  if (!state.enabled) { return; }
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
