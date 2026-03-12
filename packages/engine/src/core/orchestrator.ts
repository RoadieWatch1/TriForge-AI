/**
 * TriForge Orchestrator — per-file unanimous consensus engine.
 *
 * Workflow:
 *  1. Planning: one provider plans which files to create/modify/delete
 *  2. Per-file debate loop:
 *     a. Builder drafts the file (rotates each round)
 *     b. Reviewers return structured JSON verdicts referencing the file hash
 *     c. If ALL reviewers APPROVE the same hash → file approved
 *     d. If REQUEST_CHANGES → feedback fed to builder, iterate
 *     e. After maxIterations → disagreement
 *  3. Result: approved file changes ready for patch preview
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from './providers/provider';
import { sha256 } from './hash';
import {
  FileChange,
  FileChangeType,
  FileDebateRound,
  FileDebateState,
  FileDebateStatus,
  ReviewResult,
  TaskPlan,
  TaskResult,
  ProgressCallback,
} from './types';

export interface OrchestratorOptions {
  maxIterations: number;
  workspacePath: string;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export class TriForgeOrchestrator {
  private providers: AIProvider[];
  private options: OrchestratorOptions;

  constructor(providers: AIProvider[], options: OrchestratorOptions) {
    this.providers = providers;
    this.options = options;
  }

  /**
   * Run the full orchestration for a user request.
   */
  async orchestrate(userRequest: string, context: string): Promise<TaskResult> {
    this.checkAborted();

    // --- Phase 1: Plan ---
    this.emitProgress({
      type: 'plan',
      message: `Planning task with ${this.providers[0].name}...`,
    });

    const plan = await this.buildPlan(userRequest, context);

    if (plan.filesToChange.length === 0) {
      return {
        plan,
        fileDebates: [],
        approvedFiles: [],
        hasDisagreements: false,
        summary: 'No file changes needed for this request.',
      };
    }

    this.emitProgress({
      type: 'plan',
      message: `Plan: ${plan.filesToChange.length} file(s) to change.`,
    });

    // --- Phase 2: Per-file debate ---
    const fileDebates: FileDebateState[] = [];
    const approvedFiles: FileChange[] = [];

    for (const fileSpec of plan.filesToChange) {
      this.checkAborted();

      const debate = await this.debateFile(
        userRequest,
        fileSpec.filePath,
        fileSpec.relativePath,
        fileSpec.action,
        context,
        fileDebates
      );

      fileDebates.push(debate);

      if (debate.status === 'approved' && debate.rounds.length > 0) {
        const lastRound = debate.rounds[debate.rounds.length - 1];
        approvedFiles.push(lastRound.fileChange);
      }
    }

    // --- Phase 3: Summary ---
    const hasDisagreements = fileDebates.some(d => d.status === 'disagreement');
    const summary = this.buildSummary(fileDebates, approvedFiles);

    this.emitProgress({ type: 'complete', message: summary });

    return {
      plan,
      fileDebates,
      approvedFiles,
      hasDisagreements,
      summary,
    };
  }

  /**
   * Simple single-provider response (for single-model mode).
   */
  async singleResponse(prompt: string, context: string): Promise<string> {
    return this.providers[0].generateResponse(prompt, context, this.options.signal);
  }

  /**
   * Pair review: one builds, one reviews, return both perspectives.
   */
  async pairReview(userRequest: string, context: string): Promise<{ builder: string; reviewer: string }> {
    const [builder, reviewer] = this.providers;

    const builderResponse = await builder.generateResponse(
      userRequest, context, this.options.signal
    );

    const reviewPrompt = `A developer asked: "${userRequest}"\n\nAnother AI responded:\n${builderResponse}\n\nPlease review this response. Point out any issues, suggest improvements, and give your own perspective.`;
    const reviewerResponse = await reviewer.generateResponse(
      reviewPrompt, context, this.options.signal
    );

    return { builder: builderResponse, reviewer: reviewerResponse };
  }

  // ─── Private: Planning ─────────────────────────────────────────────

  private async buildPlan(userRequest: string, context: string): Promise<TaskPlan> {
    const planner = this.providers[0];
    const result = await planner.planTask(userRequest, context, this.options.signal);

    const filesToChange = result.files.map(f => ({
      filePath: path.resolve(this.options.workspacePath, f.filePath),
      relativePath: f.filePath,
      action: f.action as FileChangeType,
      reason: f.reason,
    }));

    return {
      description: userRequest,
      filesToChange,
    };
  }

  // ─── Private: Per-File Debate ──────────────────────────────────────

  private async debateFile(
    userRequest: string,
    filePath: string,
    relativePath: string,
    action: FileChangeType,
    context: string,
    allDebates: FileDebateState[]
  ): Promise<FileDebateState> {
    const state: FileDebateState = {
      filePath,
      relativePath,
      status: 'pending',
      rounds: [],
      currentRound: 0,
      maxIterations: this.options.maxIterations,
      approvedHash: null,
      disagreementReport: null,
    };

    // Read original file content (empty for 'create')
    let originalContent = '';
    if (action !== 'create') {
      try {
        originalContent = fs.readFileSync(filePath, 'utf-8');
      } catch {
        // File doesn't exist — treat as create
      }
    }

    // Handle delete: no debate needed, just propose deletion
    if (action === 'delete') {
      state.status = 'approved';
      state.approvedHash = sha256('');
      state.rounds.push({
        roundNumber: 1,
        builder: this.providers[0].name,
        fileChange: {
          filePath,
          relativePath,
          type: 'delete',
          originalContent,
          proposedContent: '',
          fileHash: sha256(''),
        },
        reviews: [],
        consensus: true,
      });
      this.emitFileStatus(state, allDebates, `${relativePath}: marked for deletion`);
      return state;
    }

    // --- Debate rounds ---
    let previousFeedback: string | null = null;

    for (let round = 1; round <= this.options.maxIterations; round++) {
      this.checkAborted();
      state.currentRound = round;
      state.status = 'drafting';

      // Rotate builder: round 1 = provider[0], round 2 = provider[1], etc.
      const builderIndex = (round - 1) % this.providers.length;
      const builder = this.providers[builderIndex];
      const reviewers = this.providers.filter((_, i) => i !== builderIndex);

      this.emitFileStatus(state, allDebates,
        `${relativePath}: Round ${round}/${this.options.maxIterations} — ${builder.name} drafting...`
      );

      this.emitProgress({
        type: 'draft',
        filePath: relativePath,
        round,
        maxRounds: this.options.maxIterations,
        provider: builder.name,
        message: `${builder.name} is drafting ${relativePath}...`,
      });

      // --- Build ---
      const proposedContent = await builder.generateDraft(
        userRequest,
        relativePath,
        originalContent,
        context,
        previousFeedback,
        this.options.signal
      );

      const fileHash = sha256(proposedContent);
      const fileChange: FileChange = {
        filePath,
        relativePath,
        type: action === 'create' ? 'create' : 'modify',
        originalContent,
        proposedContent,
        fileHash,
      };

      // --- Review ---
      state.status = 'reviewing';
      this.emitFileStatus(state, allDebates,
        `${relativePath}: Round ${round}/${this.options.maxIterations} — reviewing...`
      );

      const reviews: ReviewResult[] = [];

      for (const reviewer of reviewers) {
        this.checkAborted();

        this.emitProgress({
          type: 'review',
          filePath: relativePath,
          round,
          maxRounds: this.options.maxIterations,
          provider: reviewer.name,
          message: `${reviewer.name} is reviewing ${relativePath}...`,
        });

        const review = await reviewer.reviewFile(
          userRequest,
          relativePath,
          proposedContent,
          fileHash,
          originalContent,
          context,
          this.options.signal
        );

        reviews.push(review);

        this.emitProgress({
          type: 'review',
          filePath: relativePath,
          round,
          maxRounds: this.options.maxIterations,
          provider: reviewer.name,
          message: `${reviewer.name}: ${review.verdict} — ${review.reasoning.substring(0, 100)}`,
        });
      }

      // Record the round
      const allApprove = reviews.every(r => r.verdict === 'APPROVE' && r.fileHash === fileHash);

      const debateRound: FileDebateRound = {
        roundNumber: round,
        builder: builder.name,
        fileChange,
        reviews,
        consensus: allApprove,
      };

      state.rounds.push(debateRound);

      if (allApprove) {
        state.status = 'approved';
        state.approvedHash = fileHash;

        this.emitProgress({
          type: 'file_approved',
          filePath: relativePath,
          round,
          maxRounds: this.options.maxIterations,
          message: `${relativePath}: Approved unanimously in round ${round}.`,
        });

        this.emitFileStatus(state, allDebates,
          `${relativePath}: Approved (round ${round})`
        );

        return state;
      }

      // --- Collect feedback for next round ---
      state.status = 'needs_changes';

      previousFeedback = JSON.stringify({
        round,
        reviewers: reviews
          .filter(r => r.verdict === 'REQUEST_CHANGES')
          .map(r => ({
            provider: r.provider,
            issues: r.issues,
            requiredChanges: r.requiredChanges,
            reasoning: r.reasoning,
          })),
      }, null, 2);

      this.emitProgress({
        type: 'revision',
        filePath: relativePath,
        round,
        maxRounds: this.options.maxIterations,
        message: `${relativePath}: Changes requested. ${round < this.options.maxIterations ? 'Iterating...' : 'Max rounds reached.'}`,
      });

      this.emitFileStatus(state, allDebates,
        `${relativePath}: Changes requested (round ${round})`
      );
    }

    // Max iterations exhausted — disagreement
    state.status = 'disagreement';
    state.disagreementReport = this.buildDisagreementReport(state);

    this.emitProgress({
      type: 'file_disagreement',
      filePath: relativePath,
      message: `${relativePath}: No consensus after ${this.options.maxIterations} rounds.`,
    });

    this.emitFileStatus(state, allDebates,
      `${relativePath}: Disagreement (${this.options.maxIterations} rounds)`
    );

    return state;
  }

  // ─── Private: Helpers ──────────────────────────────────────────────

  private checkAborted(): void {
    if (this.options.signal?.aborted) {
      throw new Error('Request cancelled.');
    }
  }

  private emitProgress(partial: Partial<Parameters<ProgressCallback>[0]> & { type: string; message: string }): void {
    if (this.options.onProgress) {
      this.options.onProgress(partial as Parameters<ProgressCallback>[0]);
    }
  }

  private emitFileStatus(
    current: FileDebateState,
    allDebates: FileDebateState[],
    message: string
  ): void {
    if (!this.options.onProgress) { return; }

    const fileStatuses = [...allDebates, current].map(d => ({
      filePath: d.relativePath,
      status: d.status as FileDebateStatus,
      approvals: this.countApprovals(d),
      total: this.providers.length - 1,
    }));

    this.options.onProgress({
      type: 'file_start',
      message,
      fileStatuses,
    });
  }

  private countApprovals(debate: FileDebateState): number {
    if (debate.rounds.length === 0) { return 0; }
    const lastRound = debate.rounds[debate.rounds.length - 1];
    return lastRound.reviews.filter(r => r.verdict === 'APPROVE').length;
  }

  private buildDisagreementReport(state: FileDebateState): string {
    const lines: string[] = [`Disagreement Report for ${state.relativePath}:`];
    lines.push(`No consensus after ${state.maxIterations} rounds.\n`);

    for (const round of state.rounds) {
      lines.push(`--- Round ${round.roundNumber} (builder: ${round.builder}) ---`);
      for (const review of round.reviews) {
        lines.push(`  ${review.provider}: ${review.verdict}`);
        if (review.reasoning) {
          lines.push(`    Reasoning: ${review.reasoning}`);
        }
        for (const issue of review.issues) {
          lines.push(`    [${issue.severity}] ${issue.message}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildSummary(debates: FileDebateState[], approved: FileChange[]): string {
    const total = debates.length;
    const approvedCount = debates.filter(d => d.status === 'approved').length;
    const disagreements = debates.filter(d => d.status === 'disagreement');

    const lines: string[] = [];
    lines.push(`Consensus complete: ${approvedCount}/${total} files approved.`);

    if (approved.length > 0) {
      lines.push('\nApproved files:');
      for (const f of approved) {
        lines.push(`  + ${f.relativePath} (${f.type})`);
      }
    }

    if (disagreements.length > 0) {
      lines.push('\nDisagreements:');
      for (const d of disagreements) {
        lines.push(`  ! ${d.relativePath} — no consensus after ${d.maxIterations} rounds`);
      }
    }

    return lines.join('\n');
  }
}
