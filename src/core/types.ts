/**
 * Shared types for the TriForge per-file consensus engine.
 */

import { ProviderName } from '../webview/protocol';

// --- Verdicts & Reviews ---

export type Verdict = 'APPROVE' | 'REQUEST_CHANGES';
export type IssueSeverity = 'blocker' | 'major' | 'minor';

export interface ReviewIssue {
  severity: IssueSeverity;
  message: string;
}

export interface ReviewResult {
  provider: ProviderName;
  filePath: string;
  fileHash: string;
  verdict: Verdict;
  issues: ReviewIssue[];
  requiredChanges: string[];
  reasoning: string;
  timestamp: Date;
}

// --- File Changes ---

export type FileChangeType = 'create' | 'modify' | 'delete';

export interface FileChange {
  filePath: string;
  relativePath: string;
  type: FileChangeType;
  originalContent: string;
  proposedContent: string;
  fileHash: string;
}

// --- Per-File Debate State ---

export type FileDebateStatus =
  | 'pending'
  | 'drafting'
  | 'reviewing'
  | 'needs_changes'
  | 'approved'
  | 'disagreement';

export interface FileDebateRound {
  roundNumber: number;
  builder: ProviderName;
  fileChange: FileChange;
  reviews: ReviewResult[];
  consensus: boolean;
}

export interface FileDebateState {
  filePath: string;
  relativePath: string;
  status: FileDebateStatus;
  rounds: FileDebateRound[];
  currentRound: number;
  maxIterations: number;
  approvedHash: string | null;
  disagreementReport: string | null;
}

// --- Task-Level State ---

export interface TaskPlan {
  description: string;
  filesToChange: { filePath: string; relativePath: string; action: FileChangeType; reason: string }[];
}

export interface TaskResult {
  plan: TaskPlan;
  fileDebates: FileDebateState[];
  approvedFiles: FileChange[];
  hasDisagreements: boolean;
  summary: string;
}

// --- Progress Callback ---

export interface DebateProgress {
  type: 'plan' | 'file_start' | 'draft' | 'review' | 'revision' | 'file_approved' | 'file_disagreement' | 'complete';
  filePath?: string;
  round?: number;
  maxRounds?: number;
  provider?: ProviderName;
  message: string;
  fileStatuses?: { filePath: string; status: FileDebateStatus; approvals: number; total: number }[];
}

export type ProgressCallback = (progress: DebateProgress) => void;
