/**
 * GitWorkflowService — gated git operations.
 *
 * Commit/push only when workflow state allows.
 * All git operations use execFile (not shell composition) for safety.
 * Auto-push off by default.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { eventBus } from '../core/eventBus';
import type {
  CouncilWorkflowSession,
  GitGateState,
  CommitResult,
  PushResult,
  GitStatusInfo,
} from './councilWorkflowTypes';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT = 30_000; // 30 seconds

// ── Service ──────────────────────────────────────────────────────────────────

export class GitWorkflowService {

  /**
   * Evaluate whether git operations are allowed based on session state.
   */
  evaluateGitGate(session: CouncilWorkflowSession): GitGateState {
    const hasPlanApproval = session.planSnapshots.length > 0;
    const hasCodeApproval = session.codeSnapshots.length > 0;
    const checksGreen = session.verification?.allPassed ?? false;

    // Collect blocking risks from plan
    const blockingRisks: string[] = [];
    if (hasPlanApproval) {
      const latestPlan = session.planSnapshots[session.planSnapshots.length - 1];
      const blockerObjections = latestPlan.reviews
        .flatMap(r => r.objections)
        .filter(o => o.severity === 'blocker' && !o.resolution);
      for (const obj of blockerObjections) {
        blockingRisks.push(`Unresolved blocker: ${obj.description}`);
      }
    }

    if (hasCodeApproval) {
      const latestCode = session.codeSnapshots[session.codeSnapshots.length - 1];
      const blockerFindings = latestCode.reviews
        .flatMap(r => r.findings)
        .filter(f => f.severity === 'blocker');
      for (const finding of blockerFindings) {
        blockingRisks.push(`Unresolved code blocker: ${finding.description}`);
      }
    }

    const commitReady = hasPlanApproval && hasCodeApproval && checksGreen && blockingRisks.length === 0;
    const isCommitted = session.phase === 'committed' || session.phase === 'ready_to_push' || session.phase === 'pushed';
    const pushReady = isCommitted;

    // Build commit message
    let commitMessage: string | undefined;
    if (hasPlanApproval) {
      commitMessage = this.generateCommitMessage(session);
    }

    const gate: GitGateState = {
      planApproved: hasPlanApproval,
      codeApproved: hasCodeApproval,
      checksGreen,
      blockingRisks,
      commitReady,
      pushReady,
      commitMessage,
      autoCommit: session.mode === 'trusted',
      autoPush: false, // never auto-push
    };

    eventBus.emit({
      type: 'GIT_GATE_EVALUATED',
      sessionId: session.id,
      gate: gate as unknown as Record<string, unknown>,
    });

    return gate;
  }

  /**
   * Generate a commit message from the session's approved plan + implementation.
   */
  generateCommitMessage(session: CouncilWorkflowSession): string {
    const latestPlan = session.planSnapshots[session.planSnapshots.length - 1];
    if (!latestPlan) { return 'chore: council-governed changes'; }

    const plan = latestPlan.plan;
    const scope = plan.commitScope || plan.summary;

    // Determine commit type from plan goal
    const goal = plan.goal.toLowerCase();
    let prefix = 'feat';
    if (goal.includes('fix') || goal.includes('bug')) { prefix = 'fix'; }
    else if (goal.includes('refactor')) { prefix = 'refactor'; }
    else if (goal.includes('test')) { prefix = 'test'; }
    else if (goal.includes('doc')) { prefix = 'docs'; }
    else if (goal.includes('chore') || goal.includes('clean')) { prefix = 'chore'; }

    const filesChanged = latestPlan.plan.filesToModify.length;
    const approvedBy = latestPlan.approvedBy.join(', ');

    return [
      `${prefix}: ${scope}`,
      '',
      `Council-approved (${latestPlan.round} round${latestPlan.round > 1 ? 's' : ''})`,
      `Approved by: ${approvedBy}`,
      `Files: ${filesChanged}`,
    ].join('\n');
  }

  /**
   * Stage specific files for commit.
   */
  async stageFiles(workspacePath: string, files: string[]): Promise<void> {
    if (files.length === 0) { return; }
    await this._git(['add', ...files], workspacePath);
  }

  /**
   * Commit staged changes. Requires session to be in a commit-ready state.
   */
  async commit(
    workspacePath: string,
    message: string,
    session: CouncilWorkflowSession,
  ): Promise<CommitResult> {
    const gate = this.evaluateGitGate(session);

    if (!gate.commitReady) {
      return {
        success: false,
        message: `Cannot commit: ${gate.blockingRisks.join('; ') || 'prerequisites not met'}`,
      };
    }

    eventBus.emit({
      type: 'COMMIT_PREPARED',
      sessionId: session.id,
      message,
      fileCount: session.codeSnapshots.length > 0
        ? session.codeSnapshots[session.codeSnapshots.length - 1].snapshot.files.length
        : 0,
    });

    try {
      const output = await this._git(['commit', '-m', message], workspacePath);
      // Extract commit hash from output
      const hashMatch = output.match(/\[[\w/-]+ ([a-f0-9]+)\]/);
      const commitHash = hashMatch?.[1] || 'unknown';

      eventBus.emit({
        type: 'COMMIT_EXECUTED',
        sessionId: session.id,
        commitHash,
      });

      return { success: true, commitHash, message: output };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, message: error.message || 'Commit failed' };
    }
  }

  /**
   * Push to remote. Requires explicit user approval (never auto-push).
   */
  async push(
    workspacePath: string,
    session: CouncilWorkflowSession,
  ): Promise<PushResult> {
    const gate = this.evaluateGitGate(session);

    if (!gate.pushReady) {
      return {
        success: false,
        message: 'Cannot push: commit not yet executed or prerequisites not met',
      };
    }

    // Get current branch
    const branch = await this._git(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath);
    const remote = 'origin';

    eventBus.emit({
      type: 'PUSH_REQUESTED',
      sessionId: session.id,
      remote,
      branch,
    });

    try {
      await this._git(['push', remote, branch], workspacePath);

      eventBus.emit({
        type: 'PUSH_EXECUTED',
        sessionId: session.id,
        remote,
        branch,
      });

      return { success: true, remote, branch, message: `Pushed to ${remote}/${branch}` };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, message: error.message || 'Push failed' };
    }
  }

  /**
   * Get current git status for the workspace.
   */
  async getStatus(workspacePath: string): Promise<GitStatusInfo> {
    const [branchOutput, statusOutput] = await Promise.all([
      this._git(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath),
      this._git(['status', '--porcelain'], workspacePath),
    ]);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of statusOutput.split('\n').filter(Boolean)) {
      const x = line[0]; // staging area status
      const y = line[1]; // working tree status
      const file = line.substring(3);

      if (x === '?' && y === '?') {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') { staged.push(file); }
        if (y !== ' ' && y !== '?') { unstaged.push(file); }
      }
    }

    return {
      branch: branchOutput.trim(),
      dirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
      staged,
      unstaged,
      untracked,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _git(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        timeout: GIT_TIMEOUT,
        maxBuffer: 1024 * 1024 * 2, // 2MB
      });
      return stdout.trim();
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      throw new Error(error.stderr || error.message || 'Git command failed');
    }
  }
}
