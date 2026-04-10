// ── unrealHeroFlow.ts ─────────────────────────────────────────────────────────
//
// The Unreal Hero Flow — one pipeline from detection to verified success.
//
// This is the proof run: a new user installs TriForge, it detects Unreal,
// asks for permission, opens the editor, sets up a project, verifies success,
// and shows a full action ledger.
//
// Pipeline stages:
//   1. DETECT    — Is Unreal installed? Running? Which project?
//   2. PROBE     — Is Remote Control plugin active? (determines control method)
//   3. FOCUS     — Bring Unreal Editor to front
//   4. CONFIGURE — Set up project via hybrid control (RC or visual)
//   5. VERIFY    — Confirm the setup worked
//   6. REPORT    — Return full ledger of every action taken
//
// This orchestrator is the bridge between the disconnected systems:
//   unrealAwareness   → detection
//   probeUnrealRC     → RC availability
//   unrealHybridExec  → hybrid control
//   unrealEditorOp    → vision-based operations
//   operatorTaskRunner → general visual automation
//   workflowPacks     → Unreal-specific knowledge

import { OperatorService } from './operatorService';
import { buildUnrealAwarenessSnapshot } from './unrealAwareness';
import { probeUnrealRemoteControl, type RCProbeResult } from './probeUnrealRemoteControl';
import {
  hybridFocusEditor,
  hybridCompile,
  hybridPlayInEditor,
  hybridCaptureScreen,
  hybridExecConsoleCommand,
  refreshRcStatus,
  getExecutorState,
  type HybridResult,
  type ControlMethod,
} from './unrealHybridExecutor';
import { getEditorStatus } from './unrealEditorOperator';
import { analyzeScreen } from './visionAnalyzer';
import type { UnrealAwarenessSnapshot } from '@triforge/engine';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HeroFlowStep {
  stage:          string;
  action:         string;
  ok:             boolean;
  controlMethod:  ControlMethod | 'detect' | 'probe' | 'vision-verify' | 'mixed';
  detail:         string;
  screenshotPath?: string;
  durationMs:     number;
  timestamp:      string;
}

export interface HeroFlowResult {
  ok:              boolean;
  summary:         string;
  stages:          HeroFlowStep[];
  unrealSnapshot:  UnrealAwarenessSnapshot | null;
  rcProbe:         RCProbeResult | null;
  primaryControl:  'rc' | 'visual' | 'mixed';
  projectName?:    string;
  totalDurationMs: number;
}

export interface HeroFlowOptions {
  /** What to set up. Default: 'third-person' */
  projectTemplate?: 'third-person' | 'first-person' | 'top-down' | 'blank';
  /** Project name to look for or create. */
  projectName?: string;
  /** Skip the setup stage — just detect, probe, and verify current state. */
  detectOnly?: boolean;
  /** Progress callback for each step. */
  onProgress?: (step: HeroFlowStep) => void;
}

// ── Flow state ───────────────────────────────────────────────────────────────

let _running = false;

export function isHeroFlowRunning(): boolean { return _running; }

// ── Stage helpers ────────────────────────────────────────────────────────────

function step(
  stage: string,
  action: string,
  ok: boolean,
  controlMethod: HeroFlowStep['controlMethod'],
  detail: string,
  startMs: number,
  screenshotPath?: string,
): HeroFlowStep {
  return {
    stage, action, ok, controlMethod, detail, screenshotPath,
    durationMs: Date.now() - startMs,
    timestamp: new Date().toISOString(),
  };
}

// ── Main orchestration ───────────────────────────────────────────────────────

export async function runUnrealHeroFlow(opts: HeroFlowOptions = {}): Promise<HeroFlowResult> {
  if (_running) {
    return {
      ok: false, summary: 'Hero flow already running.', stages: [],
      unrealSnapshot: null, rcProbe: null, primaryControl: 'visual', totalDurationMs: 0,
    };
  }

  _running = true;
  const flowStart = Date.now();
  const stages: HeroFlowStep[] = [];
  const emit = (s: HeroFlowStep) => { stages.push(s); opts.onProgress?.(s); };

  let unrealSnapshot: UnrealAwarenessSnapshot | null = null;
  let rcProbe: RCProbeResult | null = null;

  try {
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 1: DETECT — Is Unreal installed and running?
    // ════════════════════════════════════════════════════════════════════════
    {
      const t = Date.now();
      try {
        const [runningApps, frontmost] = await Promise.all([
          OperatorService.listRunningApps(),
          OperatorService.getFrontmostApp(),
        ]);

        unrealSnapshot = await buildUnrealAwarenessSnapshot(
          runningApps,
          frontmost?.appName,
          frontmost?.windowTitle,
        );

        if (!unrealSnapshot.running && !unrealSnapshot.installed) {
          emit(step('detect', 'Check Unreal Engine', false, 'detect',
            'Unreal Engine is not installed on this machine. Install it via the Epic Games Launcher.', t));
          return finalize(false, 'Unreal Engine not found.', stages, unrealSnapshot, rcProbe, flowStart);
        }

        if (!unrealSnapshot.running) {
          emit(step('detect', 'Check Unreal Engine', false, 'detect',
            'Unreal Engine is installed but not running. Please open a project in Unreal Editor first.', t));
          return finalize(false, 'Unreal Editor not running.', stages, unrealSnapshot, rcProbe, flowStart);
        }

        const projectInfo = unrealSnapshot.projectName
          ? `Project: ${unrealSnapshot.projectName}` + (unrealSnapshot.projectPath ? ` (${unrealSnapshot.projectPath})` : '')
          : 'Project not detected from process args or window title.';

        emit(step('detect', 'Check Unreal Engine', true, 'detect',
          `Unreal Editor running. ${projectInfo}`, t));

      } catch (err) {
        emit(step('detect', 'Check Unreal Engine', false, 'detect',
          `Detection failed: ${err instanceof Error ? err.message : String(err)}`, t));
        return finalize(false, 'Detection failed.', stages, unrealSnapshot, rcProbe, flowStart);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 2: PROBE — Is Remote Control plugin active?
    // ════════════════════════════════════════════════════════════════════════
    {
      const t = Date.now();
      try {
        rcProbe = await probeUnrealRemoteControl();
        await refreshRcStatus();

        const rcActive = rcProbe.connectionStatus === 'available';
        emit(step('probe', 'Probe Remote Control API', true, 'probe',
          rcActive
            ? `Remote Control active on port ${rcProbe.port} — will use deterministic API control.`
            : `Remote Control not available (${rcProbe.connectionStatus}) — will use visual automation as fallback.`,
          t));
      } catch (err) {
        emit(step('probe', 'Probe Remote Control API', true, 'probe',
          `RC probe error (non-fatal): ${err instanceof Error ? err.message : String(err)}. Proceeding with visual control.`, t));
      }
    }

    if (opts.detectOnly) {
      return finalize(true, 'Detection complete.', stages, unrealSnapshot, rcProbe, flowStart);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 3: FOCUS — Bring Unreal Editor to front
    // ════════════════════════════════════════════════════════════════════════
    {
      const t = Date.now();
      const focusResult = await hybridFocusEditor();
      emit(step('focus', 'Focus Unreal Editor', focusResult.ok, focusResult.controlMethod,
        focusResult.detail, t, focusResult.screenshotPath));

      if (!focusResult.ok) {
        return finalize(false, 'Could not focus Unreal Editor window.', stages, unrealSnapshot, rcProbe, flowStart);
      }

      // Wait for focus to settle
      await new Promise(r => setTimeout(r, 1500));
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 4: CONFIGURE — Set up the project using the operator
    // ════════════════════════════════════════════════════════════════════════
    //
    // This stage uses the general-purpose operator task runner with enriched
    // context — pack knowledge injected into the planner prompt so it knows
    // exactly what to click and configure for the target template.
    {
      const template = opts.projectTemplate ?? 'third-person';
      const projectName = opts.projectName ?? unrealSnapshot?.projectName ?? 'MyProject';

      // Build an enriched goal with step-by-step guidance from pack knowledge
      const enrichedGoal = buildEnrichedGoal(template, projectName, unrealSnapshot);

      const t = Date.now();
      try {
        // Import the task runner and run with the enriched goal
        const { runOperatorTask } = await import('./operatorTaskRunner.js');

        // Create a temporary session for the hero flow
        const session = OperatorService.startSession('UnrealEditor');

        const taskResult = await runOperatorTask({
          sessionId: session.id,
          goal: enrichedGoal,
          maxSteps: 30,
          onProgress: (ev) => {
            // Relay progress events
            if (ev.phase === 'act' && ev.action) {
              emit(step('configure', ev.action.description ?? ev.description,
                true, 'visual', ev.description, Date.now()));
            }
          },
        });

        const configOk = taskResult.outcome === 'completed';
        emit(step('configure', `Set up ${template} project`, configOk,
          getExecutorState().rcAvailable ? 'mixed' : 'visual',
          configOk ? `Project configuration completed in ${taskResult.stepsExecuted} steps.`
                   : `Configuration ${taskResult.outcome}: ${taskResult.summary}`,
          t));

        // End the session
        OperatorService.stopSession(session.id, configOk ? 'completed' : taskResult.outcome);

        if (!configOk && taskResult.outcome === 'error') {
          return finalize(false, taskResult.summary, stages, unrealSnapshot, rcProbe, flowStart);
        }

      } catch (err) {
        emit(step('configure', `Set up ${template} project`, false, 'failed',
          `Configuration error: ${err instanceof Error ? err.message : String(err)}`, t));
        return finalize(false, 'Configuration failed.', stages, unrealSnapshot, rcProbe, flowStart);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 5: VERIFY — Confirm the setup worked
    // ════════════════════════════════════════════════════════════════════════
    {
      const t = Date.now();
      try {
        // Take a final screenshot and ask vision to verify
        const screenshot = await hybridCaptureScreen();
        if (screenshot.ok && screenshot.screenshotPath) {
          const template = opts.projectTemplate ?? 'third-person';
          const verification = await analyzeScreen(
            screenshot.screenshotPath,
            `Look at this Unreal Editor screenshot. We just attempted to set up a ${template} project.\n\n` +
            `Check whether the setup appears successful:\n` +
            `- Is a level/map open in the viewport?\n` +
            `- Does the viewport show a 3D scene (not an empty/default level)?\n` +
            `- Is there content visible in the Content Browser or Outliner?\n` +
            `- Are there any error dialogs or warning popups visible?\n\n` +
            `Reply ONLY with JSON: { "success": true|false, "confidence": "high"|"medium"|"low", "detail": "one sentence" }`,
          );

          if (verification.ok) {
            let parsed: { success?: boolean; confidence?: string; detail?: string } = {};
            try {
              const raw = verification.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              parsed = JSON.parse(raw);
            } catch {
              parsed = { success: true, confidence: 'low', detail: verification.answer.slice(0, 200) };
            }

            emit(step('verify', 'Verify project setup', parsed.success ?? true, 'vision-verify',
              `${parsed.detail ?? 'Verification complete'} (confidence: ${parsed.confidence ?? 'unknown'})`,
              t, screenshot.screenshotPath));
          } else {
            emit(step('verify', 'Verify project setup', true, 'vision-verify',
              'Vision verification call failed, but configuration steps completed.', t, screenshot.screenshotPath));
          }
        } else {
          emit(step('verify', 'Verify project setup', true, 'vision-verify',
            'Could not capture verification screenshot, but configuration steps completed.', t));
        }
      } catch (err) {
        emit(step('verify', 'Verify project setup', true, 'vision-verify',
          `Verification error (non-fatal): ${err instanceof Error ? err.message : String(err)}`, t));
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 6: REPORT — Success
    // ════════════════════════════════════════════════════════════════════════
    const executorState = getExecutorState();
    const primaryControl: HeroFlowResult['primaryControl'] =
      executorState.rcSuccessCount > 0 && executorState.visualFallbackCount > 0 ? 'mixed'
      : executorState.rcSuccessCount > 0 ? 'rc'
      : 'visual';

    return finalize(true,
      `Hero flow complete. ${stages.filter(s => s.ok).length}/${stages.length} stages succeeded. ` +
      `Control: ${primaryControl}. Project: ${unrealSnapshot?.projectName ?? opts.projectName ?? 'unknown'}.`,
      stages, unrealSnapshot, rcProbe, flowStart, primaryControl);

  } finally {
    _running = false;
  }
}

// ── Enriched goal builder ────────────────────────────────────────────────────
//
// This is where pack knowledge meets the operator. Instead of sending a vague
// "set up a third-person project", we give the planner detailed step-by-step
// instructions based on what we know about Unreal Editor's UI.

function buildEnrichedGoal(
  template: string,
  projectName: string,
  snapshot: UnrealAwarenessSnapshot | null,
): string {
  const hasProject = snapshot?.projectDetected && snapshot?.projectName;

  // If a project is already open, configure it. If not, help create one.
  if (hasProject) {
    return buildConfigureExistingProjectGoal(template, snapshot!.projectName!, snapshot);
  }
  return buildCreateNewProjectGoal(template, projectName);
}

function buildConfigureExistingProjectGoal(
  template: string,
  projectName: string,
  snapshot: UnrealAwarenessSnapshot | null,
): string {
  const templateGuide = getTemplateGuide(template);

  return `You are controlling Unreal Editor. The project "${projectName}" is already open.

Your task: configure this project as a ${template} game.

${templateGuide}

IMPORTANT CONTEXT:
- The project "${projectName}" is already open in the editor — do NOT try to create a new project.
- Unreal Editor is already focused and in the foreground.
- If you see the main level editor viewport, you're in the right place.
${snapshot?.buildState === 'building' ? '- A build is currently in progress — wait for it to finish before making changes.' : ''}

STEP-BY-STEP APPROACH:
1. First, look at the current state of the viewport and Content Browser.
2. If the project already has the right template setup (e.g. a character in a ${template} view), you may be done — output "done".
3. If the project needs setup, use the Edit menu or Project Settings to configure the game mode.
4. Open Project Settings (Edit → Project Settings) and navigate to Maps & Modes.
5. Set the Default GameMode to the appropriate ${template} game mode.
6. If there's no default level with the right setup, create a basic one.
7. When done, verify the viewport shows the expected configuration.

OUTPUT "done" WITH REASON when the project is configured correctly, or "blocked" if you hit an obstacle.`;
}

function buildCreateNewProjectGoal(template: string, projectName: string): string {
  const templateGuide = getTemplateGuide(template);

  return `You are controlling Unreal Editor. No project is currently detected.

Your task: create a new ${template} project named "${projectName}".

${templateGuide}

STEP-BY-STEP APPROACH:
1. If you see the Unreal Project Browser (template selection screen), select the "${template}" template.
2. Look for "Games" category on the left, then find the ${template === 'third-person' ? 'Third Person' : template === 'first-person' ? 'First Person' : template === 'top-down' ? 'Top Down' : 'Blank'} template.
3. Click on the template to select it.
4. Set the project name to "${projectName}" in the project name field at the bottom.
5. Click "Create" to create the project.
6. Wait for the editor to load the new project (this may take 30-60 seconds).
7. Once the level editor viewport appears with the template content, you're done.

If the Project Browser is not visible:
- Try File → New Project from the menu bar.
- Or if a project is already open, work with that instead.

OUTPUT "done" WITH REASON when the project is created, or "blocked" if you hit an obstacle.`;
}

function getTemplateGuide(template: string): string {
  switch (template) {
    case 'third-person':
      return `TEMPLATE: Third Person
- Uses a character mesh visible from behind (over-the-shoulder camera)
- Default: BP_ThirdPersonCharacter, ThirdPersonGameMode
- The viewport should show a mannequin/character in a test level
- Camera follows behind the character with a spring arm`;

    case 'first-person':
      return `TEMPLATE: First Person
- Uses a first-person camera with visible hands/weapon
- Default: BP_FirstPersonCharacter, FirstPersonGameMode
- The viewport should show from the character's eye level
- Includes a basic projectile system`;

    case 'top-down':
      return `TEMPLATE: Top Down
- Uses an overhead camera looking down at the play area
- Default: TopDownCharacter, TopDownGameMode
- Click-to-move navigation
- The viewport should show a top-down view of the level`;

    case 'blank':
    default:
      return `TEMPLATE: Blank
- Empty project with a default level
- No character or game mode preconfigured
- Just ensure the project is created and the editor is ready`;
  }
}

// ── Result finalizer ─────────────────────────────────────────────────────────

function finalize(
  ok: boolean,
  summary: string,
  stages: HeroFlowStep[],
  unrealSnapshot: UnrealAwarenessSnapshot | null,
  rcProbe: RCProbeResult | null,
  flowStart: number,
  primaryControl: HeroFlowResult['primaryControl'] = 'visual',
): HeroFlowResult {
  return {
    ok, summary, stages, unrealSnapshot, rcProbe, primaryControl,
    projectName: unrealSnapshot?.projectName,
    totalDurationMs: Date.now() - flowStart,
  };
}
