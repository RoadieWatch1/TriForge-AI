// ── workflowPackService.ts ────────────────────────────────────────────────────
//
// Section 9 — Workflow Packs: Desktop Execution Service
//
// Orchestrates workflow pack execution by:
//   - Evaluating readiness before starting
//   - Running phases sequentially using OperatorService
//   - Pausing at approval gates (status: 'awaiting_approval')
//   - Advancing on resume after approval
//   - Tracking all runs in memory
//   - Emitting EventBus events for audit trail
//
// TRULY IMPLEMENTED:
//   - pack.readiness-check  — full execution
//   - pack.app-context      — full execution
//   - pack.focus-capture    — full execution (needs Screen Recording)
//   - pack.supervised-input — full execution (needs Accessibility + Screen Recording)
//
// PARTIAL / SCAFFOLDED:
//   - Run persistence — in-memory only; lost on restart
//
// NOT YET:
//   - Windows/Linux execution backends
//   - Resume-from-crash for interrupted runs

import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { OperatorService } from './operatorService';
import {
  onWorkflowRunStarted,
  onWorkflowRunSettled,
} from '../workerRuntime/workflowWorkerRunBridge';
import {
  WORKFLOW_PACK_REGISTRY,
  getWorkflowPack,
  listWorkflowPacks,
  evaluateWorkflowReadiness,
  evaluateAllPackReadiness,
  evaluateUnrealBootstrapReadiness,
} from '@triforge/engine';
import type {
  WorkflowPack,
  WorkflowRun,
  WorkflowRunOptions,
  WorkflowPhaseResult,
  WorkflowArtifact,
  WorkflowReadinessResult,
  UnrealBootstrapResult,
} from '@triforge/engine';
import { buildUnrealAwarenessSnapshot }                                 from './unrealAwareness';
import { findEngineRootFromProcess, findBuildScript, findRunUATScript, launchUnrealBuild } from './executeUnrealBuild';
import { triageUnrealLog, resolveTriageLogSource }                      from './triageUnrealLog';
import { generateUnrealSystemScaffold, generateUnrealMilestones }         from '@triforge/engine';
import { applyUnrealMilestone1 }                                           from './applyUnrealMilestone1';
import { applyUnrealMilestone2 }                                           from './applyUnrealMilestone2';
import { applyUnrealMilestone3 }                                           from './applyUnrealMilestone3';
import { applyUnrealMilestone4 }                                           from './applyUnrealMilestone4';
import { applyUnrealMilestone5 }                                           from './applyUnrealMilestone5';
import { probeUnrealRemoteControl, UNREAL_RC_DEFAULT_PORT, UNREAL_RC_PROBE_TIMEOUT_MS } from './probeUnrealRemoteControl';
import { eventBus } from '@triforge/engine';

// ── Run store ─────────────────────────────────────────────────────────────────

const _runs = new Map<string, WorkflowRun>();

function makeId(): string {
  return crypto.randomUUID();
}

function nowMs(): number {
  return Date.now();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePhaseResult(
  phase: WorkflowPack['phases'][number],
  status: WorkflowPhaseResult['status'],
  outputs: Record<string, unknown> = {},
  error?: string,
  warning?: string,
): WorkflowPhaseResult {
  return {
    phaseId:     phase.id,
    phaseName:   phase.name,
    status,
    startedAt:   nowMs(),
    completedAt: status !== 'awaiting_approval' ? nowMs() : undefined,
    outputs,
    error,
    warning,
  };
}

// ── Phase executors ───────────────────────────────────────────────────────────

async function executePhase(
  pack: WorkflowPack,
  phaseIndex: number,
  run: WorkflowRun,
  opts: WorkflowRunOptions,
): Promise<{ phaseResult: WorkflowPhaseResult; shouldStop: boolean; approvalId?: string }> {
  const phase = pack.phases[phaseIndex];
  if (!phase) {
    return {
      phaseResult: {
        phaseId: 'unknown', phaseName: 'Unknown', status: 'failed',
        startedAt: nowMs(), completedAt: nowMs(), outputs: {},
        error: `Phase index ${phaseIndex} out of range`,
      },
      shouldStop: true,
    };
  }

  const fail = (error: string) => ({
    phaseResult: makePhaseResult(phase, 'failed', {}, error),
    shouldStop:  phase.onFailure === 'stop',
  });

  const warn = (warning: string, outputs: Record<string, unknown> = {}) => ({
    phaseResult: makePhaseResult(phase, phase.optional ? 'skipped' : 'completed', outputs, undefined, warning),
    shouldStop:  false,
  });

  switch (phase.kind) {

    // ── list_apps ──────────────────────────────────────────────────────────────
    case 'list_apps': {
      const apps = await OperatorService.listRunningApps();
      if (run.targetApp) {
        const targetLower = run.targetApp.toLowerCase();
        const isRunning = apps.some(a => a.toLowerCase().includes(targetLower));
        if (!isRunning) {
          const msg = `Target app "${run.targetApp}" is not in the running app list.`;
          if (phase.onFailure === 'stop') {
            return fail(msg);
          }
          return warn(msg, { apps, targetFound: false });
        }
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { apps, count: apps.length }),
        shouldStop:  false,
      };
    }

    // ── get_frontmost ──────────────────────────────────────────────────────────
    case 'get_frontmost': {
      const target = await OperatorService.getFrontmostApp();
      if (!target) {
        return warn('Could not read frontmost app.', {});
      }
      // Update the session's confirmed target
      const session = OperatorService.getSession(run.sessionId);
      if (session) {
        // Best-effort update — session.confirmedTarget is internal
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          appName:     target.appName,
          windowTitle: target.windowTitle ?? null,
          confirmed:   target.confirmed,
        }),
        shouldStop: false,
      };
    }

    // ── focus_app ──────────────────────────────────────────────────────────────
    case 'focus_app': {
      if (!run.targetApp) {
        return fail('focus_app phase requires a targetApp — none was provided.');
      }
      const session = OperatorService.getSession(run.sessionId);
      if (!session) {
        return fail('Session not found — cannot build focus action.');
      }
      const action = OperatorService.buildAction(run.sessionId, 'focus_app', {
        target: run.targetApp,
      });
      const result = await OperatorService.executeAction(action);
      if (result.outcome !== 'success') {
        const msg = result.error ?? `Focus failed: ${result.outcome}`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { outcome: result.outcome, recoveryHint: result.recoveryHint ?? null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          focusedApp:  result.executedTarget?.appName ?? run.targetApp,
          windowTitle: result.executedTarget?.windowTitle ?? null,
        }),
        shouldStop: false,
      };
    }

    // ── screenshot ─────────────────────────────────────────────────────────────
    case 'screenshot': {
      const outputPath = opts.screenshotOutputPath ??
        path.join(os.tmpdir(), `tf-wf-${run.id}-${phaseIndex}-${nowMs()}.png`);
      const res = await OperatorService.captureScreen(outputPath);
      if (!res.ok) {
        if (phase.optional) {
          return warn(`Screenshot skipped: ${res.error ?? 'failed'}. ${res.recoveryHint ?? ''}`, {
            screenshotPath: null,
          });
        }
        if (phase.onFailure === 'stop') return fail(res.error ?? 'Screenshot failed');
        return warn(res.error ?? 'Screenshot failed', { screenshotPath: null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { screenshotPath: res.path ?? null }),
        shouldStop:  false,
      };
    }

    // ── queue_input ────────────────────────────────────────────────────────────
    case 'queue_input': {
      if (!opts.inputText && !opts.inputKey) {
        return fail('queue_input phase requires inputText or inputKey in run options.');
      }
      const session = OperatorService.getSession(run.sessionId);
      if (!session) return fail('Session not found — cannot queue input action.');

      const actionType = opts.inputKey ? 'send_key' : 'type_text';
      const action = OperatorService.buildAction(run.sessionId, actionType, {
        text:      opts.inputText,
        key:       opts.inputKey,
        modifiers: opts.inputModifiers,
      });

      const result = await OperatorService.executeAction(action);
      if (result.outcome !== 'approval_pending' || !result.approvalId) {
        return fail(`Expected approval_pending, got: ${result.outcome}. ${result.error ?? ''}`);
      }

      return {
        phaseResult: {
          phaseId:     phase.id,
          phaseName:   phase.name,
          status:      'awaiting_approval',
          startedAt:   nowMs(),
          outputs:     { approvalId: result.approvalId, actionType },
        },
        shouldStop:  false,
        approvalId:  result.approvalId,
      };
    }

    // ── execute_approved ───────────────────────────────────────────────────────
    case 'execute_approved': {
      // Find the approvalId from the previous queue_input phase result
      const queueResult = run.phaseResults.find(r => r.phaseId === 'queue-input');
      const approvalId = queueResult?.outputs?.approvalId as string | undefined;
      if (!approvalId) {
        return fail('execute_approved: no approvalId found from queue_input phase.');
      }
      const result = await OperatorService.executeApprovedAction(approvalId);
      if (result.outcome !== 'success') {
        const msg = result.error ?? `Input execution failed: ${result.outcome}`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { outcome: result.outcome, recoveryHint: result.recoveryHint ?? null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          executedApp:   result.executedTarget?.appName ?? null,
          windowTitle:   result.executedTarget?.windowTitle ?? null,
          durationMs:    result.durationMs,
        }),
        shouldStop: false,
      };
    }

    // ── readiness_check ────────────────────────────────────────────────────────
    case 'readiness_check': {
      const capMap = await OperatorService.getCapabilityMap();
      const runningApps = capMap.platform === 'macOS'
        ? await OperatorService.listRunningApps()
        : [];
      const allResults: Record<string, WorkflowReadinessResult> = {};
      for (const [id, res] of evaluateAllPackReadiness(
        WORKFLOW_PACK_REGISTRY,
        capMap,
        runningApps,
      )) {
        allResults[id] = res;
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          capabilityMap: capMap,
          packReadiness: allResults,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_bootstrap_check ─────────────────────────────────────────────────
    case 'unreal_bootstrap_check': {
      // Reuse running-apps + frontmost data from prior phases if available,
      // otherwise re-fetch. Both sources are cheap read-only osascript calls.
      const priorApps      = run.phaseResults.find(r => r.phaseId === 'list-apps');
      const priorFrontmost = run.phaseResults.find(r => r.phaseId === 'get-frontmost');

      const apps           = (priorApps?.outputs?.apps as string[] | undefined)
                              ?? await OperatorService.listRunningApps();
      const frontmostName  = (priorFrontmost?.outputs?.appName as string | undefined)
                              ?? null;
      const frontmostTitle = priorFrontmost?.outputs?.windowTitle as string | undefined;

      const snapshot        = await buildUnrealAwarenessSnapshot(apps, frontmostName, frontmostTitle);
      const bootstrapResult = evaluateUnrealBootstrapReadiness(snapshot);

      const outputs = {
        unrealSnapshot:  snapshot,
        unrealBootstrap: bootstrapResult,
        readiness:       bootstrapResult.readiness,
        issueCount:      bootstrapResult.issues.length,
        blockerCount:    bootstrapResult.issues.filter(i => i.severity === 'blocker').length,
        warningCount:    bootstrapResult.issues.filter(i => i.severity === 'warning').length,
      };

      // If bootstrap is blocked AND this phase is required to stop on failure,
      // return a failed phase result so the pack halts cleanly.
      if (bootstrapResult.readiness === 'blocked' && phase.onFailure === 'stop') {
        const blockerMessages = bootstrapResult.issues
          .filter(i => i.severity === 'blocker')
          .map(i => i.message)
          .join('; ');
        return {
          phaseResult: makePhaseResult(
            phase, 'failed', outputs,
            `Unreal bootstrap blocked: ${blockerMessages}`,
          ),
          shouldStop: true,
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', outputs),
        shouldStop: false,
      };
    }

    // ── unreal_build_check ─────────────────────────────────────────────────────
    case 'unreal_build_check': {
      // Pull the bootstrap result from the preceding unreal_bootstrap_check phase
      const bootstrapPhase = run.phaseResults.find(
        r => r.phaseId === 'unreal-bootstrap-preflight',
      );
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as UnrealBootstrapResult | undefined;

      // ── 1. Project path — must have high-confidence .uproject path ──────────
      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const msg = bootstrapResult
          ? `Project path is not available (project confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
            'Open a specific project in Unreal Editor so the project file path can be confirmed.'
          : 'Bootstrap result not available — cannot validate project path.';
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'project_path_missing',
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      // ── 2. Build already in progress? ──────────────────────────────────────
      const snapshot = bootstrapPhase?.outputs?.unrealSnapshot as Record<string, unknown> | undefined;
      const buildState = snapshot?.buildState as string | undefined;
      if (buildState === 'building' || buildState === 'packaging') {
        const msg = `A ${buildState} operation is already in progress. ` +
                    'Wait for it to finish before launching a new build.';
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'build_already_in_progress',
            buildState,
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      // ── 3. Engine root from running process ─────────────────────────────────
      const engineRoot = await findEngineRootFromProcess();
      if (!engineRoot) {
        const msg = 'Could not derive the Unreal Engine install root from the running ' +
                    'UnrealEditor process. The process must be running for engine path discovery.';
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'engine_root_not_found',
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      // ── 4. Build tool exists? ────────────────────────────────────────────────
      const buildMode  = opts.buildMode ?? 'build';
      const scriptPath = buildMode === 'build'
        ? findBuildScript(engineRoot)
        : findRunUATScript(engineRoot);

      if (!scriptPath) {
        const scriptName = buildMode === 'build' ? 'Build.sh' : 'RunUAT.sh';
        const msg = `${scriptName} was not found under the engine root: ${engineRoot}. ` +
                    `Verify the Unreal Engine installation at that path is complete.`;
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'build_tool_not_found',
            engineRoot,
            buildMode,
          }, msg),
          shouldStop: phase.onFailure === 'stop',
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          projectPath,
          projectName,
          engineRoot,
          buildMode,
          buildScriptPath: scriptPath,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_build_execute ───────────────────────────────────────────────────
    case 'unreal_build_execute': {
      // Pull validated fields from the preceding build-check phase
      const checkPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-build-check');
      const projectPath  = checkPhase?.outputs?.projectPath  as string | undefined;
      const projectName  = checkPhase?.outputs?.projectName  as string | undefined;
      const engineRoot   = checkPhase?.outputs?.engineRoot   as string | undefined;
      const buildMode    = (checkPhase?.outputs?.buildMode   as 'build' | 'package' | undefined)
                            ?? opts.buildMode ?? 'build';

      if (!projectPath || !projectName || !engineRoot) {
        return {
          phaseResult: makePhaseResult(
            phase, 'failed', { issueCode: 'build_tool_not_found' },
            'Build-check phase did not produce required fields — cannot execute build.',
          ),
          shouldStop: false,
        };
      }

      const launchResult = await launchUnrealBuild(projectPath, projectName, engineRoot, buildMode);

      if (!launchResult.ok) {
        return {
          phaseResult: makePhaseResult(phase, 'failed', {
            issueCode: 'launch_failed',
            command:   launchResult.command,
            logPath:   launchResult.logPath,
            engineRoot,
            buildMode,
            projectPath,
            projectName,
          }, launchResult.error ?? 'Build subprocess launch failed.'),
          shouldStop: false,
        };
      }

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          outcome:     'started',
          pid:         launchResult.pid,
          command:     launchResult.command,
          logPath:     launchResult.logPath,
          engineRoot,
          buildMode,
          projectPath,
          projectName,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_triage_analyze ──────────────────────────────────────────────────
    case 'unreal_triage_analyze': {
      // Pull context from the bootstrap phase (recentLogPath, projectPath, projectName)
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-context');
      const snapshot        = bootstrapPhase?.outputs?.unrealSnapshot as Record<string, unknown> | undefined;
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as UnrealBootstrapResult | undefined;

      const source = resolveTriageLogSource({
        explicitLogPath:  opts.triageLogPath,
        awarenessLogPath: snapshot?.recentLogPath as string | undefined,
        projectPath:      bootstrapResult?.projectPath,
        projectName:      bootstrapResult?.projectName,
      });

      if (!source) {
        const triageResult = {
          outcome:  'blocked' as const,
          findings: [{
            code:              'no_build_artifact' as const,
            confidence:        'high' as const,
            message:           'No usable log source found.',
            remediationHints:  [
              'Run pack.unreal-build first so a build log is available.',
              'Or provide opts.triageLogPath pointing to a specific log file.',
              'Or open a project in Unreal Editor so the awareness snapshot can locate the project log.',
            ],
          }],
          summary: 'No usable log source found. Run pack.unreal-build first or provide opts.triageLogPath.',
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', { triageResult, outcome: 'blocked' }),
          shouldStop:  false,
        };
      }

      const triageResult = await triageUnrealLog(source.logPath, source.sourceKind);
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          triageResult,
          outcome:       triageResult.outcome,
          sourceLogPath: triageResult.sourceLogPath,
          sourceKind:    triageResult.sourceKind,
          findingCount:  triageResult.findings.length,
          summary:       triageResult.summary,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_scaffold_generate ───────────────────────────────────────────────
    case 'unreal_scaffold_generate': {
      // Pull project context from the preceding bootstrap preflight phase
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      // Collect bootstrap warnings to pass into the scaffold generator
      const bootstrapWarnings: string[] = bootstrapResult?.issues
        .filter(i => i.severity === 'warning')
        .map(i => i.message) ?? [];

      const goal = opts.prototypeGoal ?? '';

      const scaffoldResult = generateUnrealSystemScaffold(goal, {
        projectName:       bootstrapResult?.projectName,
        projectPath:       bootstrapResult?.projectPath,
        bootstrapWarnings,
      });

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          scaffoldResult,
          outcome:       scaffoldResult.outcome,
          itemCount:     scaffoldResult.scaffoldItems.length,
          assumptionCount: scaffoldResult.assumptions.length,
          warningCount:  scaffoldResult.warnings.length,
          prototypeGoal: scaffoldResult.prototypeGoal,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_milestone_plan ──────────────────────────────────────────────────
    case 'unreal_milestone_plan': {
      // Pull scaffold result from the preceding scaffold-generate phase
      const scaffoldPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      if (!scaffoldResult) {
        // Scaffold phase either failed or wasn't run — produce a blocked milestone result
        const blockedResult: import('@triforge/engine').UnrealMilestoneResult = {
          outcome:       'blocked',
          prototypeGoal: opts.prototypeGoal ?? '',
          milestones:    [],
          assumptions:   [],
          warnings: [
            'Scaffold result was not available from the preceding scaffold phase. ' +
            'Ensure the prototypeGoal run option is provided and the scaffold phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            milestoneResult:  blockedResult,
            outcome:          'blocked',
            milestoneCount:   0,
            prototypeGoal:    opts.prototypeGoal ?? '',
          }),
          shouldStop: false,
        };
      }

      const milestoneResult = generateUnrealMilestones(scaffoldResult);

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          milestoneResult,
          outcome:          milestoneResult.outcome,
          milestoneCount:   milestoneResult.milestones.length,
          assumptionCount:  milestoneResult.assumptions.length,
          warningCount:     milestoneResult.warnings.length,
          prototypeGoal:    milestoneResult.prototypeGoal,
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m1_execute ──────────────────────────────────────────────────────
    case 'unreal_m1_execute': {
      // ── 1. Project path gate — requires high-confidence bootstrap result ────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM1ExecutionResult = {
          outcome:  'blocked',
          projectName: bootstrapResult?.projectName,
          projectPath: bootstrapResult?.projectPath,
          actions:  [],
          warnings: [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m1ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Pull scaffold and milestone results from prior phases ────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM1ExecutionResult = {
          outcome:     'blocked',
          projectName,
          projectPath,
          actions:     [],
          warnings:    [],
          blockers:    [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m1ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Apply M1 project artifacts ──────────────────────────────────────
      const applicationResult = await applyUnrealMilestone1(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
      );

      // ── 4. Build structured execution result ────────────────────────────────
      const actions: import('@triforge/engine').UnrealM1ExecutionAction[] = [
        {
          name:         'Create TriForge directory',
          kind:         'directory_created',
          status:       'done',
          relativePath: 'TriForge/',
          detail:       `Created ${applicationResult.triforgeDir}`,
        },
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;

      let outcome: import('@triforge/engine').UnrealM1ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m1ExecutionResult: import('@triforge/engine').UnrealM1ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:    applicationResult.triforgeDir,
        milestoneTitle: milestoneResult.milestones.find(m => m.id === 'M1')?.title,
        actions,
        warnings:       applicationResult.warnings,
        blockers:       applicationResult.errors,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m1ExecutionResult,
          outcome,
          fileCount,
          triforgeDir:     applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m2_execute ──────────────────────────────────────────────────────
    case 'unreal_m2_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM2ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m2ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM2ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m2ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1 manifest presence ─────────────────────────────────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const m1ManifestPath    = join(dirname(projectPath), 'TriForge', 'M1_Manifest.json');
      const m1FoundationPresent = existsSync(m1ManifestPath);

      // ── 4. Apply M2 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone2(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM2ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM2ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m2ExecutionResult: import('@triforge/engine').UnrealM2ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m2ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m3_execute ──────────────────────────────────────────────────────
    case 'unreal_m3_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM3ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m3ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM3ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m3ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1 and M2 manifest presence (chain integrity) ────────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const triforgeBase        = join(dirname(projectPath), 'TriForge');
      const m1ManifestPath      = join(triforgeBase, 'M1_Manifest.json');
      const m2ManifestPath      = join(triforgeBase, 'M2_Manifest.json');
      const m1FoundationPresent = existsSync(m1ManifestPath);
      const m2FoundationPresent = existsSync(m2ManifestPath);

      // ── 4. Apply M3 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone3(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
        m2FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM3ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM3ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m3ExecutionResult: import('@triforge/engine').UnrealM3ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        m2FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m3ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          m2FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m4_execute ──────────────────────────────────────────────────────
    case 'unreal_m4_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM4ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m4ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM4ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m4ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1 / M2 / M3 manifest presence (chain integrity) ─────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const triforgeBase        = join(dirname(projectPath), 'TriForge');
      const m1FoundationPresent = existsSync(join(triforgeBase, 'M1_Manifest.json'));
      const m2FoundationPresent = existsSync(join(triforgeBase, 'M2_Manifest.json'));
      const m3FoundationPresent = existsSync(join(triforgeBase, 'M3_Manifest.json'));

      // ── 4. Apply M4 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone4(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM4ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM4ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m4ExecutionResult: import('@triforge/engine').UnrealM4ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m4ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          m2FoundationPresent,
          m3FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_m5_execute ──────────────────────────────────────────────────────
    case 'unreal_m5_execute': {
      // ── 1. Project path gate ──────────────────────────────────────────────
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      const projectPath = bootstrapResult?.projectPath;
      const projectName = bootstrapResult?.projectName;

      if (!projectPath || !projectName) {
        const blocked: import('@triforge/engine').UnrealM5ExecutionResult = {
          outcome:              'blocked',
          projectName:          bootstrapResult?.projectName,
          projectPath:          bootstrapResult?.projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          m4FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            bootstrapResult
              ? `Project path is not confirmed (confidence: ${bootstrapResult.projectConfidence ?? 'unknown'}). ` +
                'Open a specific project in Unreal Editor so the .uproject path can be resolved.'
              : 'Bootstrap result was not available. Ensure the bootstrap preflight phase succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m5ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 2. Scaffold and milestone context ─────────────────────────────────
      const scaffoldPhase   = run.phaseResults.find(r => r.phaseId === 'unreal-scaffold-generate');
      const scaffoldResult  = scaffoldPhase?.outputs?.scaffoldResult as
        import('@triforge/engine').UnrealScaffoldResult | undefined;

      const milestonePhase  = run.phaseResults.find(r => r.phaseId === 'unreal-milestone-plan');
      const milestoneResult = milestonePhase?.outputs?.milestoneResult as
        import('@triforge/engine').UnrealMilestoneResult | undefined;

      if (!scaffoldResult || !milestoneResult) {
        const blocked: import('@triforge/engine').UnrealM5ExecutionResult = {
          outcome:              'blocked',
          projectName,
          projectPath,
          m1FoundationPresent:  false,
          m2FoundationPresent:  false,
          m3FoundationPresent:  false,
          m4FoundationPresent:  false,
          actions:              [],
          warnings:             [],
          blockers: [
            'Scaffold or milestone result was not available from the preceding phases. ' +
            'Ensure the prototypeGoal run option is provided and planning phases succeeded.',
          ],
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            m5ExecutionResult: blocked,
            outcome:           'blocked',
            fileCount:         0,
          }),
          shouldStop: false,
        };
      }

      // ── 3. Check M1–M4 manifest presence (chain integrity) ────────────────
      const { existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const triforgeBase        = join(dirname(projectPath), 'TriForge');
      const m1FoundationPresent = existsSync(join(triforgeBase, 'M1_Manifest.json'));
      const m2FoundationPresent = existsSync(join(triforgeBase, 'M2_Manifest.json'));
      const m3FoundationPresent = existsSync(join(triforgeBase, 'M3_Manifest.json'));
      const m4FoundationPresent = existsSync(join(triforgeBase, 'M4_Manifest.json'));

      // ── 4. Apply M5 project artifacts ─────────────────────────────────────
      const applicationResult = await applyUnrealMilestone5(
        projectPath,
        projectName,
        scaffoldResult,
        milestoneResult,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
        m4FoundationPresent,
      );

      // ── 5. Build structured result ─────────────────────────────────────────
      const actions: import('@triforge/engine').UnrealM5ExecutionAction[] = [
        ...applicationResult.appliedFiles.map(f => ({
          name:         f.relativePath,
          kind:         f.relativePath.endsWith('Manifest.json')
                          ? 'manifest_written' as const
                          : 'file_generated' as const,
          status:       'done' as const,
          relativePath: f.relativePath,
          detail:       f.description,
        })),
        ...applicationResult.warnings.map(w => ({
          name:   'Write warning',
          kind:   'file_generated' as const,
          status: 'failed' as const,
          detail: w,
        })),
      ];

      const fileCount = applicationResult.appliedFiles.length;
      let outcome: import('@triforge/engine').UnrealM5ExecutionOutcome;
      if (!applicationResult.ok && fileCount === 0) {
        outcome = 'failed';
      } else if (!applicationResult.ok || applicationResult.warnings.length > 0) {
        outcome = fileCount > 0 ? 'applied_with_warnings' : 'failed';
      } else {
        outcome = 'applied';
      }

      const m5ExecutionResult: import('@triforge/engine').UnrealM5ExecutionResult = {
        outcome,
        projectName,
        projectPath,
        triforgeDir:         applicationResult.triforgeDir,
        m1FoundationPresent,
        m2FoundationPresent,
        m3FoundationPresent,
        m4FoundationPresent,
        actions,
        warnings:            applicationResult.warnings,
        blockers:            applicationResult.errors,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          m5ExecutionResult,
          outcome,
          fileCount,
          m1FoundationPresent,
          m2FoundationPresent,
          m3FoundationPresent,
          m4FoundationPresent,
          triforgeDir:      applicationResult.triforgeDir,
          appliedFilePaths: applicationResult.appliedFiles.map(f => f.absolutePath),
        }),
        shouldStop: false,
      };
    }

    // ── unreal_rc_probe ────────────────────────────────────────────────────────
    case 'unreal_rc_probe': {
      // Pull bootstrap context for project identity and editor-running signal
      const bootstrapPhase  = run.phaseResults.find(r => r.phaseId === 'unreal-bootstrap-preflight');
      const bootstrapResult = bootstrapPhase?.outputs?.unrealBootstrap as
        import('@triforge/engine').UnrealBootstrapResult | undefined;

      // If editor is not running, produce a blocked result without probing
      if (!bootstrapResult?.editorRunning) {
        const blocked: import('@triforge/engine').UnrealRCProbeResult = {
          outcome:               'blocked',
          reachable:             false,
          rcSignatureFound:      false,
          editorRunning:         false,
          projectName:           bootstrapResult?.projectName,
          projectPath:           bootstrapResult?.projectPath,
          details:               ['Unreal Editor is not running — probe not attempted.'],
          warnings:              [],
          automationImplication:
            'The editor must be running before the Remote Control endpoint can be probed. ' +
            'Launch Unreal Editor with the active project, then re-run this pack.',
        };
        return {
          phaseResult: makePhaseResult(phase, 'completed', {
            rcProbeResult: blocked,
            outcome:       'blocked',
            reachable:     false,
          }),
          shouldStop: false,
        };
      }

      // ── Perform the real HTTP probe ────────────────────────────────────────
      const raw = await probeUnrealRemoteControl(
        UNREAL_RC_DEFAULT_PORT,
        UNREAL_RC_PROBE_TIMEOUT_MS,
      );

      // ── Map probe result to structured pack result ─────────────────────────
      let outcome: import('@triforge/engine').UnrealRCProbeOutcome;
      let automationImplication: string;

      switch (raw.connectionStatus) {
        case 'available':
          outcome = 'available';
          automationImplication =
            'The Unreal Remote Control HTTP API appears active and responding. ' +
            'Future packs may send editor-side commands (object creation, property ' +
            'mutation, preset execution) via the RC API on this endpoint. ' +
            'Recommended next step: run a narrow RC action pack to verify command delivery.';
          break;

        case 'reachable_unknown':
          outcome = 'unexpected_response';
          automationImplication =
            'The port is open and responding, but the response does not match the ' +
            'expected Unreal Remote Control signature. Another service may be on this ' +
            'port, or the RC plugin is running a non-standard configuration. ' +
            'Inspect the response excerpt and verify the plugin settings before using ' +
            'the RC API for automation.';
          break;

        case 'refused':
          outcome = 'unavailable';
          automationImplication =
            'The Remote Control HTTP endpoint is not listening on the expected port. ' +
            'Possible causes: the Web Remote Control plugin is not installed, not enabled ' +
            'for this project, or the editor was launched without the RC HTTP server. ' +
            'Enable the plugin in Edit → Plugins → Web Remote Control, then restart ' +
            'the editor. Until then, remain on the file-generation execution path.';
          break;

        case 'timeout':
          outcome = 'unavailable';
          automationImplication =
            'The probe timed out — no response was received within ' +
            `${UNREAL_RC_PROBE_TIMEOUT_MS}ms. The port may be filtered or the RC ` +
            'HTTP server is not accepting connections. Try enabling the plugin and ' +
            'restarting the editor. Until then, remain on the file-generation path.';
          break;

        default: // 'error'
          outcome = 'unavailable';
          automationImplication =
            'A network error prevented the probe from completing. ' +
            `Error: ${raw.error ?? 'unknown'}. ` +
            'Verify the editor is running and try again. Remain on the ' +
            'file-generation execution path until the probe succeeds.';
      }

      const rcProbeResult: import('@triforge/engine').UnrealRCProbeResult = {
        outcome,
        endpoint:              raw.endpoint,
        httpStatus:            raw.httpStatus,
        reachable:             raw.reachable,
        rcSignatureFound:      raw.rcSignatureFound,
        editorRunning:         bootstrapResult.editorRunning,
        projectName:           bootstrapResult.projectName,
        projectPath:           bootstrapResult.projectPath,
        durationMs:            raw.durationMs,
        details:               raw.details,
        warnings:              raw.warnings,
        automationImplication,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          rcProbeResult,
          outcome,
          reachable:        raw.reachable,
          rcSignatureFound: raw.rcSignatureFound,
          endpoint:         raw.endpoint,
          httpStatus:       raw.httpStatus,
          durationMs:       raw.durationMs,
        }),
        shouldStop: false,
      };
    }

    // ── report ─────────────────────────────────────────────────────────────────
    case 'report': {
      // Assemble outputs from all previous phases into an artifact
      const allOutputs: Record<string, unknown> = {};
      for (const r of run.phaseResults) {
        Object.assign(allOutputs, r.outputs);
      }

      let artifactType: WorkflowArtifact['type'] = 'context_report';
      if (pack.category === 'input')           artifactType = 'input_delivery';
      if (pack.id === 'pack.readiness-check')  artifactType = 'readiness_report';
      if (pack.id === 'pack.unreal-bootstrap') artifactType = 'unreal_readiness_report';
      if (pack.id === 'pack.unreal-build')     artifactType = 'unreal_build_report';
      if (pack.id === 'pack.unreal-triage')    artifactType = 'unreal_triage_report';
      if (pack.id === 'pack.unreal-scaffold')   artifactType = 'unreal_scaffold_report';
      if (pack.id === 'pack.unreal-milestone')   artifactType = 'unreal_milestone_report';
      if (pack.id === 'pack.unreal-m1-execute')  artifactType = 'unreal_m1_execution_report';
      if (pack.id === 'pack.unreal-m2-execute')  artifactType = 'unreal_m2_execution_report';
      if (pack.id === 'pack.unreal-rc-probe')    artifactType = 'unreal_rc_probe_report';
      if (pack.id === 'pack.unreal-m3-execute')  artifactType = 'unreal_m3_execution_report';
      if (pack.id === 'pack.unreal-m4-execute')  artifactType = 'unreal_m4_execution_report';
      if (pack.id === 'pack.unreal-m5-execute')  artifactType = 'unreal_m5_execution_report';
      if (pack.category === 'perception')       artifactType = 'perception_snapshot';

      const artifact: WorkflowArtifact = {
        type:        artifactType,
        capturedAt:  nowMs(),
        data:        allOutputs,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', { artifactType, artifact }),
        shouldStop:  false,
      };
    }

    default:
      return fail(`Unknown phase kind: ${phase.kind}`);
  }
}

// ── WorkflowPackService ───────────────────────────────────────────────────────

export const WorkflowPackService = {

  // ── Pack discovery ────────────────────────────────────────────────────────────

  listPacks(): WorkflowPack[] {
    return listWorkflowPacks();
  },

  getPack(id: string): WorkflowPack | undefined {
    return getWorkflowPack(id);
  },

  // ── Readiness ─────────────────────────────────────────────────────────────────

  async evaluateReadiness(
    packId: string,
    targetApp?: string,
  ): Promise<WorkflowReadinessResult | null> {
    const pack = getWorkflowPack(packId);
    if (!pack) return null;

    const capMap = await OperatorService.getCapabilityMap();
    const runningApps = capMap.platform === 'macOS' && (pack.requirements.targetApp || targetApp)
      ? await OperatorService.listRunningApps()
      : undefined;

    const effectivePack: WorkflowPack = targetApp
      ? { ...pack, requirements: { ...pack.requirements, targetApp } }
      : pack;

    return evaluateWorkflowReadiness(effectivePack, capMap, runningApps);
  },

  async evaluateAllReadiness(): Promise<Record<string, WorkflowReadinessResult>> {
    const capMap = await OperatorService.getCapabilityMap();
    const runningApps = capMap.platform === 'macOS'
      ? await OperatorService.listRunningApps()
      : undefined;
    const results: Record<string, WorkflowReadinessResult> = {};
    for (const [id, res] of evaluateAllPackReadiness(
      WORKFLOW_PACK_REGISTRY,
      capMap,
      runningApps,
    )) {
      results[id] = res;
    }
    return results;
  },

  // ── Run management ────────────────────────────────────────────────────────────

  getRun(id: string): WorkflowRun | null {
    return _runs.get(id) ?? null;
  },

  listRuns(): WorkflowRun[] {
    return Array.from(_runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  },

  stopRun(id: string): boolean {
    const run = _runs.get(id);
    if (!run || run.status === 'completed' || run.status === 'failed') return false;
    const updated: WorkflowRun = { ...run, status: 'stopped', endedAt: nowMs() };
    _runs.set(id, updated);
    onWorkflowRunSettled(updated);
    OperatorService.stopSession(run.sessionId, 'workflow stopped');
    eventBus.emit({
      type:      'OPERATOR_SESSION_ENDED',
      sessionId: run.sessionId,
      status:    'stopped',
      actionCount: run.phaseResults.length,
    });
    return true;
  },

  // ── Start a workflow run ──────────────────────────────────────────────────────

  async startRun(
    packId: string,
    opts: WorkflowRunOptions = {},
  ): Promise<{ ok: boolean; run?: WorkflowRun; readinessBlockers?: WorkflowReadinessResult['blockers']; error?: string }> {
    const pack = getWorkflowPack(packId);
    if (!pack) {
      return { ok: false, error: `Workflow pack "${packId}" not found.` };
    }

    // Readiness check before starting
    const readiness = await this.evaluateReadiness(packId, opts.targetApp);
    if (!readiness) {
      return { ok: false, error: 'Could not evaluate readiness.' };
    }
    if (!readiness.ready) {
      return { ok: false, readinessBlockers: readiness.blockers };
    }

    // Create operator session
    const session = OperatorService.startSession(opts.targetApp ?? pack.requirements.targetApp);

    const run: WorkflowRun = {
      id:                makeId(),
      packId:            pack.id,
      packName:          pack.name,
      sessionId:         session.id,
      targetApp:         opts.targetApp ?? pack.requirements.targetApp,
      startedAt:         nowMs(),
      status:            'running',
      currentPhaseIndex: 0,
      phaseResults:      [],
    };
    _runs.set(run.id, run);

    eventBus.emit({
      type:            'OPERATOR_SESSION_STARTED',
      sessionId:       session.id,
      intendedTarget:  run.targetApp,
    });

    // Create durable WorkerRun — bridge is a no-op if not initialized
    onWorkflowRunStarted(run, pack);

    // Execute phases sequentially until done, approval gate, or failure
    const result = await this._executePhasesFrom(run.id, pack, opts, 0);

    // Mirror terminal/gate state into durable WorkerRun
    onWorkflowRunSettled(result);

    return { ok: true, run: result };
  },

  // ── Advance a run after an approval is granted ────────────────────────────────

  async advanceRun(
    runId: string,
    opts: WorkflowRunOptions = {},
  ): Promise<{ ok: boolean; run?: WorkflowRun; error?: string }> {
    const run = _runs.get(runId);
    if (!run) return { ok: false, error: `Run "${runId}" not found.` };
    if (run.status !== 'awaiting_approval') {
      return { ok: false, error: `Run is not awaiting approval (status: ${run.status}).` };
    }

    const pack = getWorkflowPack(run.packId);
    if (!pack) return { ok: false, error: `Pack "${run.packId}" not found.` };

    // Advance from the NEXT phase — the approval gate phase already ran and its
    // approvalId is stored in phaseResults. The execute_approved phase reads it.
    // Starting at currentPhaseIndex would re-run queue_input and queue a new action.
    const result = await this._executePhasesFrom(
      run.id, pack, opts, run.currentPhaseIndex + 1,
    );

    // Mirror post-approval terminal/gate state into durable WorkerRun
    onWorkflowRunSettled(result);

    return { ok: true, run: result };
  },

  // ── Internal: execute phases from a given index ───────────────────────────────

  async _executePhasesFrom(
    runId: string,
    pack: WorkflowPack,
    opts: WorkflowRunOptions,
    fromPhaseIndex: number,
  ): Promise<WorkflowRun> {
    let run = _runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    for (let i = fromPhaseIndex; i < pack.phases.length; i++) {
      run = _runs.get(runId)!;

      // Update current phase index
      const updatedRun: WorkflowRun = { ...run, currentPhaseIndex: i };
      _runs.set(runId, updatedRun);
      run = updatedRun;

      const { phaseResult, shouldStop, approvalId } = await executePhase(pack, i, run, opts);

      // Append phase result
      const withResult: WorkflowRun = {
        ...run,
        phaseResults: [...run.phaseResults, phaseResult],
      };
      _runs.set(runId, withResult);
      run = withResult;

      if (phaseResult.status === 'awaiting_approval' && approvalId) {
        const suspended: WorkflowRun = {
          ...run,
          status:             'awaiting_approval',
          pendingApprovalId:  approvalId,
          currentPhaseIndex:  i,  // stay at this phase for advance()
        };
        _runs.set(runId, suspended);
        return suspended;
      }

      if (shouldStop || phaseResult.status === 'failed') {
        const failed: WorkflowRun = {
          ...run,
          status:   'failed',
          endedAt:  nowMs(),
          error:    phaseResult.error ?? 'Phase failed',
        };
        _runs.set(runId, failed);
        eventBus.emit({
          type:       'OPERATOR_ACTION_FAILED',
          sessionId:  run.sessionId,
          actionId:   run.id,
          actionType: pack.phases[i]?.kind ?? 'unknown',
          error:      phaseResult.error ?? 'Phase failed',
        });
        OperatorService.stopSession(run.sessionId, phaseResult.error ?? 'Phase failed');
        return failed;
      }
    }

    // All phases done — build final artifact from the 'report' phase output
    run = _runs.get(runId)!;
    const reportPhaseResult = run.phaseResults.find(r => r.phaseId === 'report');
    const artifact = reportPhaseResult?.outputs?.artifact as WorkflowArtifact | undefined;

    const completed: WorkflowRun = {
      ...run,
      status:   'completed',
      endedAt:  nowMs(),
      artifact,
    };
    _runs.set(runId, completed);

    eventBus.emit({
      type:       'OPERATOR_SESSION_ENDED',
      sessionId:  run.sessionId,
      status:     'completed',
      actionCount: run.phaseResults.length,
    });

    return completed;
  },
};
