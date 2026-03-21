// governedPipeline.ts — Governed Workflow Pipeline, extracted from panel.ts.

import * as vscode from 'vscode';
import { eventBus, type ExecutionMode, type CouncilWorkflowAction } from '@triforge/engine';
import { LS_CHECKOUT } from '../core/license';
import type { PanelContext } from './panelContext';

export async function runGovernedPipeline(
  ctx: PanelContext,
  prompt: string,
  context: string,
  mode: ExecutionMode,
  action: CouncilWorkflowAction,
): Promise<void> {
  const allProviders = await ctx.providerManager.getActiveProviders();
  if (allProviders.length >= 2) {
    const lic = await ctx.licenseManager.getStatus();
    if (!lic.isCouncilAllowed) {
      ctx.send({
        type: 'license-gate',
        message: 'Your 1-day trial has ended. Subscribe to TriForge AI Code Council to unlock full multi-model deliberation.',
        checkoutUrl: LS_CHECKOUT,
      });
      return;
    }
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

  let fullContext = context;
  if (ctx.getSession()?.fullFileContent) {
    fullContext += `\n\n--- Active File ---\n${ctx.getSession()!.fullFileContent}`;
  }
  if (ctx.getSession()?.contextFiles) {
    for (const [relPath, content] of Object.entries(ctx.getSession()!.contextFiles)) {
      fullContext += `\n\n--- ${relPath} ---\n${content}`;
    }
  }

  ctx.setLastActiveMode('governed');

  try {
    const session = await ctx.workflowEngine.startSession(
      {
        request: prompt,
        context: fullContext,
        selectedFiles: ctx.getSession()?.filePath ? [ctx.getSession()!.filePath!] : [],
        workspacePath,
      },
      mode,
      action,
    );
    ctx.setWorkflowSession(session);

    ctx.send({
      type: 'workflow-started',
      sessionId: session.id,
      mode,
      action,
      roles: session.roles,
    });

    const advanced = await ctx.workflowEngine.advancePhase(session.id);
    ctx.setWorkflowSession(advanced);
  } catch (err: unknown) {
    const error = err as Error;
    ctx.send({ type: 'workflow-error', error: error.message || 'Workflow failed' });
  }
}

export function subscribeWorkflowEvents(ctx: PanelContext): Array<() => void> {
  const unsubs: Array<() => void> = [];

  unsubs.push(eventBus.on('PHASE_CHANGED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-phase', sessionId: ev.sessionId, from: ev.from, phase: ev.to, message: `Phase: ${ev.from} → ${ev.to}` });
  }));

  unsubs.push(eventBus.on('PLAN_DRAFT_STARTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-stage', stage: 'plan_draft', round: ev.round });
  }));

  unsubs.push(eventBus.on('PLAN_REVIEW_SUBMITTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-review', stage: 'plan_review', provider: ev.provider, role: ev.role, approved: ev.approved });
  }));

  unsubs.push(eventBus.on('PLAN_APPROVED' as any, (ev: any) => {
    const session = ctx.workflowEngine.getSession(ev.sessionId);
    const latestPlan = session?.planSnapshots[session.planSnapshots.length - 1];
    ctx.send({ type: 'workflow-plan-approved', planHash: ev.planHash, approvedBy: ev.approvedBy, plan: latestPlan?.plan, reviews: latestPlan?.reviews, round: latestPlan?.round });
  }));

  unsubs.push(eventBus.on('CODE_DRAFT_STARTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-stage', stage: 'code_draft', round: ev.round, fileCount: ev.fileCount });
  }));

  unsubs.push(eventBus.on('CODE_REVIEW_SUBMITTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-review', stage: 'code_review', provider: ev.provider, role: ev.role, approved: ev.approved });
  }));

  unsubs.push(eventBus.on('CODE_APPROVED' as any, (ev: any) => {
    const session = ctx.workflowEngine.getSession(ev.sessionId);
    const latestCode = session?.codeSnapshots[session.codeSnapshots.length - 1];
    ctx.send({ type: 'workflow-code-approved', codeHash: ev.codeHash, approvedBy: ev.approvedBy, files: latestCode?.snapshot.files.map(f => ({ filePath: f.filePath, explanation: f.explanation })), round: latestCode?.round });
  }));

  unsubs.push(eventBus.on('SCOPE_DRIFT_DETECTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-scope-drift', extraFiles: ev.extraFiles });
  }));

  unsubs.push(eventBus.on('VERIFICATION_STARTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-stage', stage: 'verifying', checkCount: ev.checkCount });
  }));

  unsubs.push(eventBus.on('CHECK_PASSED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-check', checkType: ev.checkType, passed: true, duration: ev.duration });
  }));

  unsubs.push(eventBus.on('CHECK_FAILED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-check', checkType: ev.checkType, passed: false, output: ev.output });
  }));

  unsubs.push(eventBus.on('VERIFICATION_COMPLETE' as any, (ev: any) => {
    ctx.send({ type: 'workflow-verify-complete', allPassed: ev.allPassed });
  }));

  unsubs.push(eventBus.on('GIT_GATE_EVALUATED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-git-gate', gate: ev.gate });
  }));

  unsubs.push(eventBus.on('COMMIT_EXECUTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-committed', commitHash: ev.commitHash });
  }));

  unsubs.push(eventBus.on('PUSH_EXECUTED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-pushed', remote: ev.remote, branch: ev.branch });
  }));

  unsubs.push(eventBus.on('USER_INPUT_REQUIRED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-input-required', sessionId: ev.sessionId, prompt: ev.prompt, options: ev.options });
  }));

  unsubs.push(eventBus.on('WORKFLOW_COMPLETE' as any, (ev: any) => {
    ctx.send({ type: 'workflow-complete', sessionId: ev.sessionId, summary: ev.summary });
  }));

  unsubs.push(eventBus.on('WORKFLOW_BLOCKED' as any, (ev: any) => {
    ctx.send({ type: 'workflow-blocked', sessionId: ev.sessionId, reason: ev.reason });
  }));

  return unsubs;
}
