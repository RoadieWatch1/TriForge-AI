// reviewPipeline.ts — Author Review Runtime pipeline, extracted from panel.ts.

import * as vscode from 'vscode';
import * as path from 'path';
import type { ReviewSession } from '../reviewRuntime';
import type { PanelContext } from './panelContext';

export async function runAuthorReviewRuntime(
  ctx: PanelContext,
  prompt: string,
  context: string,
  intensity: string,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const activeFile =
    ctx.getSelectionFilePath() ||
    ctx.getSession()?.filePath ||
    vscode.window.activeTextEditor?.document.fileName ||
    '';

  const rawDiagnostics = vscode.languages.getDiagnostics();
  const diagnostics = rawDiagnostics.flatMap(([uri, diags]) =>
    diags.slice(0, 10).map(d => ({
      filePath: uri.fsPath,
      severity: (['error', 'warning', 'information', 'hint'] as const)[d.severity] ?? 'information',
      message: d.message,
      source: d.source,
      code: typeof d.code === 'object' ? String(d.code.value) : d.code != null ? String(d.code) : undefined,
      line: d.range.start.line,
      endLine: d.range.end.line,
    }))
  ).slice(0, 50);

  const relevantFiles = [
    ...(activeFile ? [{ path: activeFile, reason: 'active file', confidence: 0.9 }] : []),
    ...Object.keys(ctx.getSession()?.contextFiles ?? {}).map(p => ({
      path: p, reason: 'user-added context', confidence: 0.8,
    })),
  ];

  const lp = prompt.toLowerCase();
  const verificationIntents: Array<'lint' | 'typecheck' | 'test' | 'build'> = ['lint', 'typecheck', 'test'];
  if (/build|bundle|compil|webpack|esbuild/.test(lp)) { verificationIntents.push('build'); }

  const isSelectionTrigger = context.length > 0;
  const notes: string[] = [];
  if (activeFile) { notes.push(`Active file: ${activeFile}`); }
  if (isSelectionTrigger) {
    notes.push(`This review was triggered from a code selection. The selected code is provided as context below.`);
    notes.push(`Selected code:\n${context.slice(0, 2000)}`);
  } else if (context) {
    notes.push(`User context:\n${context.slice(0, 1000)}`);
  }
  const fullFileContent = ctx.getSelectionFullFileContent() || ctx.getSession()?.fullFileContent;
  if (fullFileContent && activeFile) {
    notes.push(`Full file content of ${path.basename(activeFile)}:\n${fullFileContent.slice(0, 3000)}`);
  }

  const repoContext = {
    workspaceRoot,
    taskLabel: prompt.slice(0, 80),
    userRequest: prompt,
    relevantFiles,
    diagnostics,
    verificationIntents,
    changedFilesBeforeTask: [],
    notes,
    capturedAtIso: new Date().toISOString(),
  };

  ctx.setLastActiveMode('review');
  ctx.send({ type: 'review-runtime-started', prompt });

  try {
    const task = ctx.reviewRuntime.createTaskDraft({
      userRequest: prompt,
      objective: prompt,
      acceptanceCriteria: [],
      constraints: intensity === 'ruthless' ? ['maximum scrutiny'] : [],
      repoContext,
    });

    const result = ctx.reviewRuntime.runTask(task);
    ctx.setReviewSession(result.session);

    ctx.send({
      type: 'review-runtime-result',
      session: toReviewSummaryPayload(result.session),
      gate: {
        allowed: result.gate.allowed,
        status: result.gate.status,
        reasons: result.gate.reasons,
        commitMessage: result.gate.artifact?.commitMessageDraft,
      },
    });
  } catch (err: any) {
    ctx.send({ type: 'review-runtime-error', message: err?.message ?? 'Review runtime failed.' });
  }
}

export function toReviewSummaryPayload(session: ReviewSession) {
  return {
    id: session.id,
    phase: session.phase,
    status: session.status,
    objective: session.task.objective,
    authorPlanSummary: session.authorPlan?.summary ?? '',
    implementationSummary: session.implementationDraft?.summary ?? '',
    planReviewDecisions: session.planReviewDecisions.map(d => ({
      reviewer: d.reviewer,
      scope: d.scope,
      verdict: d.verdict,
      summary: d.summary,
      findingCount: d.findings.length,
      mustFixCount: d.mustFixIds.length,
    })),
    codeReviewDecisions: session.codeReviewDecisions.map(d => ({
      reviewer: d.reviewer,
      scope: d.scope,
      verdict: d.verdict,
      summary: d.summary,
      findingCount: d.findings.length,
      mustFixCount: d.mustFixIds.length,
    })),
    reconciliation: session.reconciliation ? {
      winningAlignment: session.reconciliation.winningAlignment,
      alignedActors: session.reconciliation.alignedActors,
      summary: session.reconciliation.summary,
      mustDoCount: session.reconciliation.mustDoBeforeSubmit.length,
      unresolvedRiskCount: session.reconciliation.unresolvedRisks.length,
    } : null,
    verification: session.verification ? {
      status: session.verification.status,
      checks: session.verification.checks.map(c => ({
        intent: c.intent,
        status: c.status,
        summary: c.summary,
      })),
    } : null,
    submission: session.submission ? {
      status: session.submission.status,
      commitMessageDraft: session.submission.commitMessageDraft,
      remainingRisks: session.submission.remainingRisks,
    } : null,
    blockedReason: session.blockedReason,
  };
}
