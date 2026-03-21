// panelContext.ts — PanelContext interface for pipeline/router modules.
// Pipelines import only this interface, not the TriForgeCouncilPanel class,
// keeping the import graph acyclic.

import * as vscode from 'vscode';
import type { ProviderManager, CouncilWorkflowEngine, CouncilWorkflowSession } from '@triforge/engine';
import type { LicenseManager } from '../core/license';
import type { ReviewRuntime } from '../reviewRuntime';
import type { ReviewSession } from '../reviewRuntime';
import type {
  CouncilSession, CouncilMode, IntensityState, DeadlockResolution,
} from './panelTypes';
import type { LedgerState } from './ledger';

export interface PanelContext {
  send(payload: object): void;

  getSession(): CouncilSession | null;
  setSession(s: CouncilSession | null): void;

  readonly providerManager: ProviderManager;
  readonly licenseManager: LicenseManager;
  readonly reviewRuntime: ReviewRuntime;
  readonly workflowEngine: CouncilWorkflowEngine;

  getIntensityState(): IntensityState;
  setIntensityState(s: IntensityState): void;

  getAbortController(): AbortController | null;
  setAbortController(c: AbortController | null): void;

  getDeadlockResolve(): ((r: { action: DeadlockResolution; selectedVersion?: string }) => void) | null;
  setDeadlockResolve(fn: ((r: { action: DeadlockResolution; selectedVersion?: string }) => void) | null): void;

  getUnavailableProviders(): Set<string>;

  getCouncilMode(): CouncilMode;
  setCouncilMode(m: CouncilMode): void;

  getLastActiveMode(): 'council' | 'governed' | 'review' | null;
  setLastActiveMode(m: 'council' | 'governed' | 'review' | null): void;

  getSelectionFilePath(): string;
  getSelectionFullFileContent(): string;

  getLedger(): LedgerState;

  getWorkflowSession(): CouncilWorkflowSession | null;
  setWorkflowSession(s: CouncilWorkflowSession | null): void;

  getUseGovernedPipeline(): boolean;
  setUseGovernedPipeline(v: boolean): void;

  getReviewSession(): ReviewSession | null;
  setReviewSession(s: ReviewSession | null): void;

  getExtensionUri(): vscode.Uri;

  refreshProviderStatus(): Promise<void>;
  exportDebate(): Promise<void>;
}
