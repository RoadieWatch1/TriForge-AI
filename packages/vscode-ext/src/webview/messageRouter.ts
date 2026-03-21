// messageRouter.ts — Webview message router, extracted from panel.ts.
// Attaches the onDidReceiveMessage handler to the webview and routes
// all inbound commands to the appropriate pipeline or helper.

import * as vscode from 'vscode';
import { type ExecutionMode, type CouncilWorkflowAction, type ProviderName } from '@triforge/engine';
import { handleGitMessage, readWorkspaceFile } from './gitHandlers';
import { runAuthorReviewRuntime, toReviewSummaryPayload } from './reviewPipeline';
import { runGovernedPipeline } from './governedPipeline';
import {
  runCouncilPipeline, applyFinalCode, applyDraftCode, applyCode,
  escalateIntensity, generateAlternative, voteOnAlternative, adoptAlternative,
} from './councilPipeline';
import type { PanelContext } from './panelContext';
import type { IntensityLevel } from './panelTypes';

const VALID_PROVIDERS: ProviderName[] = ['openai', 'grok', 'claude'];
function isValidProvider(v: unknown): v is ProviderName {
  return typeof v === 'string' && VALID_PROVIDERS.includes(v as ProviderName);
}

export function attachMessageRouter(
  ctx: PanelContext,
  webviewPanel: vscode.WebviewPanel,
  disposables: vscode.Disposable[],
): void {
  webviewPanel.webview.onDidReceiveMessage(
    async (message: any) => {
      if (await handleGitMessage(ctx.send.bind(ctx), ctx.providerManager, message)) { return; }
      switch (message.command) {
        case 'council:run':
          if (message.reviewRuntime === true) {
            await runAuthorReviewRuntime(ctx,
              message.prompt as string,
              (message.context as string) ?? '',
              (message.intensity as string) ?? 'analytical'
            );
          } else if (ctx.getUseGovernedPipeline()) {
            await runGovernedPipeline(ctx,
              message.prompt as string,
              (message.context as string) ?? '',
              (message.mode as ExecutionMode) ?? 'safe',
              (message.action as CouncilWorkflowAction) ?? 'plan_then_code'
            );
          } else {
            await runCouncilPipeline(ctx,
              message.prompt as string,
              (message.context as string) ?? '',
              (message.intensity as string) ?? 'adaptive'
            );
          }
          break;
        case 'review:run':
          await runAuthorReviewRuntime(ctx,
            message.prompt as string,
            (message.context as string) ?? '',
            (message.intensity as string) ?? 'analytical'
          );
          break;
        case 'review:getLatest': {
          const rs = ctx.getReviewSession();
          if (rs) { ctx.send({ type: 'review-runtime-result', session: toReviewSummaryPayload(rs) }); }
          break;
        }
        case 'council:apply':
          await applyFinalCode(ctx);
          break;
        case 'council:export':
          await ctx.exportDebate();
          break;
        case 'council:applyDraft':
          await applyDraftCode(ctx);
          break;
        case 'council:escalate':
          escalateIntensity(ctx);
          break;
        case 'council:requestAlt':
          await generateAlternative(ctx, message.provider as string);
          break;
        case 'council:runVoteOnAlt':
          await voteOnAlternative(ctx);
          break;
        case 'council:adoptAlt':
          await adoptAlternative(ctx);
          break;
        case 'council:abort': {
          const dr = ctx.getDeadlockResolve();
          if (dr) { dr({ action: 'ESCALATE' }); ctx.setDeadlockResolve(null); }
          ctx.getAbortController()?.abort();
          ctx.setAbortController(null);
          ctx.send({ type: 'phase', phase: 'IDLE', message: 'Aborted.' });
          break;
        }
        case 'council:deadlock:escalate': {
          const dr = ctx.getDeadlockResolve();
          if (dr) { dr({ action: 'ESCALATE' }); ctx.setDeadlockResolve(null); }
          break;
        }
        case 'council:deadlock:synthesis': {
          const dr = ctx.getDeadlockResolve();
          if (dr) { dr({ action: 'SYNTHESIS' }); ctx.setDeadlockResolve(null); }
          break;
        }
        case 'council:deadlock:extended': {
          const dr = ctx.getDeadlockResolve();
          if (dr) { dr({ action: 'EXTENDED_DEBATE' }); ctx.setDeadlockResolve(null); }
          break;
        }
        case 'council:deadlock:user': {
          const dr = ctx.getDeadlockResolve();
          if (dr) { dr({ action: 'USER_DECIDES' }); ctx.setDeadlockResolve(null); }
          break;
        }
        case 'council:selectVersion': {
          const dr = ctx.getDeadlockResolve();
          if (dr) { dr({ action: 'USER_DECIDES', selectedVersion: message.provider as string }); ctx.setDeadlockResolve(null); }
          break;
        }
        case 'council:override:apply': {
          const fc = ctx.getSession()?.finalCode;
          if (fc) { await applyCode(ctx, fc); }
          break;
        }
        case 'council:setIntensity':
          if (message.lock) {
            ctx.setIntensityState({ mode: 'LOCKED', level: (message.level as IntensityLevel) ?? 'ANALYTICAL' });
          } else {
            ctx.setIntensityState({ mode: 'ADAPTIVE', level: ctx.getIntensityState().level });
          }
          break;
        case 'setApiKey': {
          const name = message.provider;
          const key = message.key as string;
          if (isValidProvider(name) && key) {
            try {
              await ctx.providerManager.setKey(name, key);
              await ctx.refreshProviderStatus();
              vscode.window.showInformationMessage(`TriForge AI: ${name} key saved.`);
            } catch (err: any) {
              vscode.window.showErrorMessage(`TriForge AI: Failed to save ${name} key — ${err?.message ?? err}`);
              ctx.send({ type: 'error', message: `Failed to save ${name} key: ${err?.message ?? err}` });
            }
          } else {
            vscode.window.showWarningMessage(`TriForge AI: Invalid provider or empty key.`);
          }
          break;
        }
        case 'removeApiKey': {
          const providerName = message.provider;
          if (isValidProvider(providerName)) {
            try {
              await ctx.providerManager.removeKey(providerName);
              await ctx.refreshProviderStatus();
            } catch (err: any) {
              vscode.window.showErrorMessage(`TriForge AI: Failed to remove ${providerName} key — ${err?.message ?? err}`);
            }
          }
          break;
        }
        case 'getProviders':
          await ctx.refreshProviderStatus();
          break;
        case 'openExternal': {
          const url = message.url as string;
          if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
          break;
        }
        case 'workspace:addContext': {
          const session = ctx.getSession();
          if (!session) { break; }
          if (!session.contextFiles) { session.contextFiles = {}; }
          const content = await readWorkspaceFile(message.relPath as string);
          session.contextFiles[message.relPath as string] = content;
          ctx.send({ type: 'context-updated', contextFiles: Object.keys(session.contextFiles) });
          break;
        }
        case 'workspace:removeContext': {
          const session = ctx.getSession();
          if (!session?.contextFiles) { break; }
          delete session.contextFiles[message.relPath as string];
          ctx.send({ type: 'context-updated', contextFiles: Object.keys(session.contextFiles) });
          break;
        }
        case 'workspace:clearContext': {
          const session = ctx.getSession();
          if (session) { session.contextFiles = {}; }
          ctx.send({ type: 'context-updated', contextFiles: [] });
          break;
        }
        case 'config:getModels': {
          const cfg = vscode.workspace.getConfiguration('triforgeAi');
          ctx.send({
            type: 'config-models',
            openai: cfg.get<string>('openai.model') || '',
            claude: cfg.get<string>('claude.model') || '',
            grok:   cfg.get<string>('grok.model')   || '',
          });
          break;
        }
        case 'config:setModel': {
          const provider = message.provider as string;
          const model    = (message.model as string)?.trim() || undefined;
          await vscode.workspace.getConfiguration('triforgeAi').update(
            `${provider}.model`, model, vscode.ConfigurationTarget.Global
          );
          ctx.send({ type: 'config-model-saved', provider, model: model || '' });
          break;
        }
        case 'license:getStatus': {
          const s = await ctx.licenseManager.getStatus();
          ctx.send({ type: 'license-status', status: s });
          break;
        }
        case 'license:activate': {
          ctx.send({ type: 'license-activating' });
          const result = await ctx.licenseManager.activateLicense((message.key as string)?.trim() ?? '');
          if (result.success) {
            const s = await ctx.licenseManager.getStatus();
            ctx.send({ type: 'license-status', status: s });
            vscode.window.showInformationMessage('TriForge AI: License activated.');
          } else {
            ctx.send({ type: 'license-error', error: result.error ?? 'Activation failed.' });
          }
          break;
        }
        case 'license:deactivate': {
          await ctx.licenseManager.deactivateLicense();
          const s = await ctx.licenseManager.getStatus();
          ctx.send({ type: 'license-status', status: s });
          vscode.window.showInformationMessage('TriForge AI: License removed.');
          break;
        }

        // ── Governed Workflow Pipeline ──────────────────────────────────
        case 'workflow:approvePlan': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'approve_plan' })); }
          break;
        }
        case 'workflow:rejectPlan': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'reject_plan', reason: (message.reason as string) || 'Rejected by user' })); }
          break;
        }
        case 'workflow:narrowPlan': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'narrow_plan', instructions: (message.instructions as string) || '' })); }
          break;
        }
        case 'workflow:approveCommit': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'approve_commit' })); }
          break;
        }
        case 'workflow:rejectCommit': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'reject_commit' })); }
          break;
        }
        case 'workflow:approvePush': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'approve_push' })); }
          break;
        }
        case 'workflow:rejectPush': {
          const ws = ctx.getWorkflowSession();
          if (ws) { ctx.setWorkflowSession(await ctx.workflowEngine.advancePhase(ws.id, { type: 'reject_push' })); }
          break;
        }
        case 'workflow:abort': {
          const ws = ctx.getWorkflowSession();
          if (ws) {
            ctx.workflowEngine.abortSession(ws.id);
            ctx.setWorkflowSession(null);
            ctx.send({ type: 'workflow-phase', phase: 'blocked', message: 'Aborted by user.' });
          }
          break;
        }
        case 'workflow:setMode':
          ctx.setUseGovernedPipeline(message.governed !== false);
          break;

        default:
          console.warn(`[TriForge] Unknown webview command: ${message.command}`);
      }
    },
    undefined,
    disposables
  );
}
