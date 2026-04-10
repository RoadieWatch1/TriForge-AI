// ── operatorTaskRunner.ts ─────────────────────────────────────────────────────
//
// The heart of TriForge's remote-access loop.
//
// Works exactly like a person with remote desktop access:
//   1. Take a screenshot — see what's on screen
//   2. Ask Claude Vision to describe the current state
//   3. Ask Claude Vision to plan the next action toward the goal
//   4. Execute that step (focus, click, type, key) via OperatorService
//   5. Verify result with a fresh screenshot + vision check
//   6. Repeat until done, blocked, or max steps reached
//
// Input actions (click_at, type_text, send_key) are gated by the normal
// OperatorService approval queue. When an approval is pending the run
// suspends and returns outcome='approval_pending' — the caller re-emits
// progress and the user approves via the Operate panel.

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { OperatorService, getDisplayScaleFactor } from './operatorService';
import { analyzeScreen, describeScreen, locateElement } from './visionAnalyzer';
import { buildAppAwarenessSnapshot, formatAppAwarenessSummary } from './appAwareness';
import { imageSize } from './imageSize';

// ── Public types ──────────────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  sessionId:   string;
  goal:        string;
  maxSteps?:   number;
  onProgress?: (event: TaskProgressEvent) => void;
  /**
   * B4: Optional persistence hooks. When provided, the runner notifies the
   * caller at every meaningful boundary so it can mirror the run as a
   * durable WorkerRun + per-step WorkerStep transcript. The runner remains
   * decoupled from WorkerRunQueue — the caller (ipc.ts) wires the hooks.
   */
  workerHooks?: WorkerRunHooks;
  /**
   * Seeded history line. Use when resuming a run after a paused
   * approval — the caller passes a description of the action that was
   * just approved so the planner does NOT re-issue the same action and
   * trigger another approval prompt. The line is injected into the
   * planner history before the first iteration.
   */
  priorApprovedAction?: string;
  /**
   * When true, the runner captures a screenshot and returns a description
   * without entering the action loop. Observe-only tasks never attempt
   * clicks, typing, or any input action.
   */
  observeOnly?: boolean;
  /**
   * Restrict the planner to only interact with this app. If the frontmost
   * app is not the target, the runner will focus it first. Actions that
   * would target other apps are rejected by the planner prompt constraint.
   */
  targetApp?: string;
}

// ── B4: Worker-run lifecycle hooks ───────────────────────────────────────────
//
// The runner calls these at well-defined boundaries so the caller can persist
// a step-level transcript without the runner having to know anything about
// WorkerRunQueue. All hook implementations MUST be exception-safe — the
// runner wraps every call in try/catch, but hooks should still be defensive.

export interface WorkerRunHooks {
  /**
   * Called once per step after the plan is decided and before execution.
   * Should return an opaque step id used to correlate the matching
   * onStepEnd call. May return undefined if the caller doesn't care about
   * correlation.
   */
  onStepBegin?(info: {
    index:  number;            // 0-based step index
    title:  string;            // short human-readable label
    action: PlannedAction;
  }): string | undefined;

  /**
   * Called when a step finishes — successfully, with failure, blocked, or
   * suspended waiting for approval. The runner emits this exactly once per
   * step that began (paired with onStepBegin).
   */
  onStepEnd?(info: {
    stepId?:        string;
    index:          number;
    status:         'completed' | 'failed' | 'blocked' | 'waiting_approval';
    output?:        Record<string, unknown>;
    error?:         string;
    screenshotPath?: string;
  }): void;

  /**
   * Called exactly once when the entire run reaches a terminal state, from
   * the public-entry try/finally so it always fires even on early exits.
   */
  onRunEnd?(info: {
    outcome: TaskRunResult['outcome'];
    summary: string;
    error?:  string;
  }): void;
}

export interface TaskProgressEvent {
  step:                 number;
  phase:                'observe' | 'plan' | 'act' | 'verify' | 'done' | 'blocked' | 'error' | 'continuation_prompt';
  description:          string;
  screenshotPath?:      string;
  action?:              PlannedAction;
  result?:              StepResult;
  /** Set when phase=continuation_prompt */
  continuationSummary?: string;
}

export interface TaskRunResult {
  ok:                 boolean;
  stepsExecuted:      number;
  outcome:            'completed' | 'max_steps_reached' | 'blocked' | 'error' | 'approval_pending';
  summary:            string;
  error?:             string;
  /** Set when outcome=approval_pending; pass to OperatorService.executeApprovedAction() */
  pendingApprovalId?: string;
  steps:              StepResult[];
  /** Set when outcome=max_steps_reached so the caller can offer to resume */
  resumeState?: {
    lastScreenshotPath: string | undefined;
    completedSteps:     number;
    historySnapshot:    string[];
  };
  /** Before/after visual proof — paths to screenshots captured before and after the run */
  beforeScreenshotPath?: string;
  afterScreenshotPath?:  string;
}

export interface StepResult {
  step:          number;
  action:        PlannedAction;
  executed:      boolean;
  outcome?:      string;
  verifyPassed?: boolean;
  approvalId?:   string;
  error?:        string;
}

export interface PlannedAction {
  type:        'click' | 'type' | 'key' | 'focus' | 'wait' | 'done' | 'blocked';
  description: string;
  /** UI element description for vision-based coordinate lookup (click) */
  target?:     string;
  /** Mouse button for click actions: left (default), right, or double-click */
  button?:     'left' | 'right' | 'double';
  x?:          number;
  y?:          number;
  text?:       string;
  /** e.g. "cmd+b", "return", "escape" */
  keyCombo?:   string;
  appName?:    string;
  reason?:     string;
}

// ── Planner prompt ────────────────────────────────────────────────────────────

function buildPlannerPrompt(goal: string, screenSummary: string, history: string, appContext?: string, targetApp?: string): string {
  const appSection = appContext
    ? `\nAPP AWARENESS — what is currently running on this computer:\n${appContext}\nUse this information to decide which app to focus and interact with.\n`
    : '';

  const scopeSection = targetApp
    ? `\nAPP SCOPE CONSTRAINT:\nYou are ONLY allowed to interact with "${targetApp}". ` +
      `Do NOT focus, click, type, or send keys to any other application. ` +
      `If the goal requires a different app, output "blocked" with reason "Goal requires app outside scope: only ${targetApp} is allowed".\n`
    : '';

  return `You are a desktop automation agent that physically controls a computer's mouse and keyboard.
YOU are the one performing every action — there is no other program or assistant doing work for you.

Goal: "${goal}"

Current screen: ${screenSummary}
${appSection}${scopeSection}
CRITICAL RULES:
- YOU control the mouse and keyboard. Do NOT "wait" for something to happen on its own.
- If you see the TriForge AI window, that is YOUR own interface — ignore it and focus/click on the TARGET app.
- Every step must make concrete progress: open an app, click a button, type text, press a key.
- NEVER output a "wait" action unless you just triggered a loading/compiling operation and need the screen to settle.
- If the screen hasn't changed after your last action, try a DIFFERENT approach — do not repeat the same action.

HOW TO OPEN APPLICATIONS:
- "focus" activates an app by name. It works whether the app is already running or not (macOS will launch it).
- If "focus" fails with "not found", the app name may differ from what you expect. Common examples:
    Unreal Engine → "UnrealEditor" or use Spotlight
    Visual Studio Code → "Code" or "Visual Studio Code"
- Spotlight fallback: use "key" with keyCombo "cmd+space", then "type" the app name, then "key" with keyCombo "return".
- To open a folder or file on the Desktop: use "click" with button "double" on it.

HOW TO INTERACT WITH THE DESKTOP:
- To open a folder/file on the desktop, double-click it: use "click" with button="double" targeting the item.
- To right-click for a context menu: use "click" with button="right".
- To navigate Finder: focus "Finder", then click sidebar items or use cmd+shift+g for Go To Folder.

SYSTEM DIALOGS — BLOCKED CONDITIONS:
- If you see a macOS password prompt, authentication dialog, or "wants to control your computer" dialog, output "blocked" with reason "macOS authentication dialog requires user input — cannot proceed until user dismisses it".
- If you see a "Memory Pressure Warning" or similar system alert, try pressing Escape or Return first. If that fails, try clicking the visible button (Dismiss/OK/Close). If both fail, output "blocked".
- NEVER type into a macOS password field — you must not handle system credentials.

${history ? `Recent steps:\n${history}\n\n` : ''}Respond with ONLY JSON (no markdown, no explanation):
{
  "type": "click"|"type"|"key"|"focus"|"wait"|"done"|"blocked",
  "description": "one sentence of what you are doing RIGHT NOW",
  "target": "exact UI element label to click (for click)",
  "button": "left (default) | right | double (for click only)",
  "text": "text to type (for type)",
  "keyCombo": "shortcut e.g. cmd+s, return (for key)",
  "appName": "application name (for focus)",
  "reason": "goal achieved or why blocked (for done/blocked)"
}`;
}

// ── Key combo → OperatorAction key+modifiers ──────────────────────────────────

// Canonical modifier aliases → the 4 types OperatorAction accepts
const MOD_ALIASES: Record<string, 'cmd' | 'shift' | 'alt' | 'ctrl'> = {
  cmd:     'cmd',
  command: 'cmd',
  meta:    'cmd',
  super:   'cmd',
  win:     'cmd',
  windows: 'cmd',
  shift:   'shift',
  alt:     'alt',
  option:  'alt',
  opt:     'alt',
  ctrl:    'ctrl',
  control: 'ctrl',
};

function parseKeyCombo(combo: string): { key: string; modifiers: Array<'cmd' | 'shift' | 'alt' | 'ctrl'> } {
  if (!combo) return { key: '', modifiers: [] };
  const parts = combo.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return { key: '', modifiers: [] };
  // Last part is always the key; everything before it is a modifier
  const keyPart = parts[parts.length - 1];
  const modifiers: Array<'cmd' | 'shift' | 'alt' | 'ctrl'> = [];
  for (const part of parts.slice(0, -1)) {
    const canonical = MOD_ALIASES[part];
    if (canonical && !modifiers.includes(canonical)) modifiers.push(canonical);
    // Unknown modifier words are silently ignored rather than crashing
  }
  return { key: keyPart, modifiers };
}

// ── Fix 3: Intent-aware verification ─────────────────────────────────────────
//
// Passes if answer contains 'yes' but is NOT immediately qualified by a negating
// word. Handles "Yes, but...", "YES however...", "YES — error occurred" etc.

function isVerificationPassed(answer: string): boolean {
  const lower = answer.toLowerCase().trim();
  if (!lower.includes('yes')) return false;
  const NEGATING = /\b(but|however|although|except|unless|failed|error|not|didn't|did not|unable|couldn't|could not)\b/;
  return !NEGATING.test(lower.slice(lower.indexOf('yes')));
}

// ── Priority 3: Observe-only goal detection ─────────────────────────────────
//
// Heuristic: if the goal is clearly asking for observation only (describe,
// inspect, read, what's visible, etc.) and does NOT contain action verbs
// (click, open, close, type, dismiss, enter, press, navigate, set up), route
// it through the observe-only fast path instead of the action loop.

function isObserveOnlyGoal(goal: string): boolean {
  const lower = goal.toLowerCase().trim();
  const OBSERVE_PATTERNS = /^(describe|what.?s on|what do you see|what is|observe|look at|inspect|read|show me|tell me what|list what|identify|check what|report what|summarize what)/;
  const ACTION_VERBS = /\b(click|open|close|dismiss|type|enter|press|navigate|set up|configure|create|delete|remove|install|build|run|execute|start|stop|save|submit|move|drag|select|change|modify|activate|launch|switch to)\b/;

  if (OBSERVE_PATTERNS.test(lower) && !ACTION_VERBS.test(lower)) return true;
  return false;
}

// ── Fix 2: Poll-until-stable ──────────────────────────────────────────────────
//
// Takes screenshots every 500ms, hashes each frame. When two consecutive frames
// match (screen is stable) OR maxWaitMs elapses, returns the last screenshot path.

async function waitUntilScreenStable(maxWaitMs = 5000): Promise<string | null> {
  let prevHash: string | null = null;
  let lastPath: string | null = null;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const ss = await OperatorService.captureScreen();
    if (!ss.ok || !ss.path) break;
    lastPath = ss.path;

    const hash = createHash('md5').update(readFileSync(ss.path)).digest('hex');
    if (prevHash !== null && hash === prevHash) return lastPath; // stable
    prevHash = hash;

    await new Promise(r => setTimeout(r, 500));
  }
  return lastPath;
}

// ── Fix 5: Element coordinate cache ──────────────────────────────────────────
//
// Caches the (x, y) of successfully located elements for the lifetime of the
// process, with a 60-second TTL per entry. Key = sessionId + ':' + elementDesc.

interface CachedElement { x: number; y: number; locatedAt: number; }
const _elementCache = new Map<string, CachedElement>();

// ── B3: Live-run state holder ────────────────────────────────────────────────
//
// Module-level state that the desktopOperator snapshot getter (in ipc.ts)
// reads on every Council turn. Updated on every progress emit so the council
// always sees fresh telemetry. The shape mirrors DesktopOperatorSnapshot.liveRun
// in packages/engine/src/awareness/types.ts but is kept local here to avoid a
// cross-package import in this hot-path module.

export interface LiveRunState {
  sessionId:                 string;
  goal:                      string;
  currentStep:               number;
  maxSteps:                  number;
  phase:                     TaskProgressEvent['phase'];
  lastDescription:           string;
  lastActionType?:           PlannedAction['type'];
  lastVerifyPassed?:         boolean;
  lastVerifyError?:          string;
  consecutiveVerifyFailures: number;
  /** How many consecutive "wait" actions the planner has output. Non-zero means the operator may be stuck. */
  consecutiveWaits:          number;
  lastEmitAt:                number;
}

let _liveRunState: LiveRunState | null = null;

/** Read the most recent live-run state, or null if no run is in flight. */
export function getLiveRunState(): LiveRunState | null {
  if (!_liveRunState) return null;
  // Stale results (> 2 minutes) are treated as "no run" — the runner finished
  // or crashed without clearing state. The council should not see stale data.
  if (Date.now() - _liveRunState.lastEmitAt > 120_000) {
    _liveRunState = null;
    return null;
  }
  return _liveRunState;
}

/** Clear the live-run state — called when a run finishes, errors, or aborts. */
function clearLiveRunState() {
  _liveRunState = null;
}

// ── Core run loop ─────────────────────────────────────────────────────────────

/**
 * Public entry point — wraps the core loop in try/finally so:
 *   • the live-run state holder is always cleared on exit (B3), and
 *   • the worker-run onRunEnd hook always fires exactly once (B4),
 * even when the loop throws or an early return path is taken.
 */
export async function runOperatorTask(opts: TaskRunnerOptions): Promise<TaskRunResult> {
  let result: TaskRunResult | undefined;
  let thrown: unknown;
  try {
    result = await _runOperatorTaskCore(opts);
    return result;
  } catch (e) {
    thrown = e;
    throw e;
  } finally {
    clearLiveRunState();
    // B4: Notify the worker-run bridge that the run finished. This must
    // never throw — hook errors are swallowed to keep the runner robust.
    if (opts.workerHooks?.onRunEnd) {
      try {
        if (result) {
          opts.workerHooks.onRunEnd({
            outcome: result.outcome,
            summary: result.summary,
            error:   result.error,
          });
        } else {
          const msg = thrown instanceof Error ? thrown.message : String(thrown ?? 'unknown error');
          opts.workerHooks.onRunEnd({
            outcome: 'error',
            summary: msg,
            error:   msg,
          });
        }
      } catch { /* hook must not crash the runner */ }
    }
  }
}

async function _runOperatorTaskCore(opts: TaskRunnerOptions): Promise<TaskRunResult> {
  const { sessionId, goal, maxSteps = 50, onProgress, priorApprovedAction } = opts;
  const steps: StepResult[]  = [];
  const history: string[]    = [];

  // ── Preflight: check permissions before burning API calls ────────────────
  // A fresh capability probe catches revoked/missing permissions up front,
  // rather than discovering them 3 steps into a run.
  const caps = await OperatorService.getCapabilityMap();
  if (!caps.canCaptureScreen) {
    const err =
      'Screen Recording permission is not granted. ' +
      'Grant TriForge AI access in: System Settings → Privacy & Security → Screen Recording. ' +
      'You may need to restart TriForge AI after granting permission.';
    return { ok: false, stepsExecuted: 0, outcome: 'blocked', summary: err, error: err, steps };
  }
  if (!caps.accessibilityGranted && !opts.observeOnly) {
    const err =
      'Accessibility permission is not granted — the operator cannot type, press keys, or click. ' +
      'Grant TriForge AI access in: System Settings → Privacy & Security → Accessibility. ' +
      'You may need to restart TriForge AI after granting permission.';
    return { ok: false, stepsExecuted: 0, outcome: 'blocked', summary: err, error: err, steps };
  }

  // ── Priority 3: Observe-only fast path ──────────────────────────────────────
  // When the caller (or heuristic) marks the task as observe-only, we capture
  // a screenshot, describe it via Vision, and return immediately — no action
  // loop, no JSON parsing, no input injection. This eliminates the entire
  // class of bugs where observation prompts leak into the action pipeline.
  if (opts.observeOnly || isObserveOnlyGoal(goal)) {
    const ss = await OperatorService.captureScreen();
    if (!ss.ok || !ss.path) {
      const err = ss.error ?? 'Screenshot failed';
      return { ok: false, stepsExecuted: 0, outcome: 'error', summary: err, error: err, steps };
    }

    // Use the goal as the freeform question, or fall back to a general describe
    const isGenericObserve = /^(describe|what.?s on|what do you see|observe|look at|inspect|read|show me)/i.test(goal);
    const observePrompt = isGenericObserve
      ? 'Describe everything visible on this screen in detail. Include: the active application, visible windows/dialogs, buttons, text fields, and any notable UI state. Be specific about what is readable vs. unclear.'
      : goal;

    const result = await analyzeScreen(ss.path, observePrompt);
    const summary = result.ok ? result.answer : (result.error ?? 'Observation failed');
    return {
      ok: result.ok,
      stepsExecuted: 0,
      outcome: result.ok ? 'completed' : 'error',
      summary,
      error: result.ok ? undefined : summary,
      steps,
      beforeScreenshotPath: ss.path,
      afterScreenshotPath: ss.path,
    };
  }

  // ── Detect display scale factor for Retina coordinate correction ──────────
  const displayScale = await getDisplayScaleFactor();

  // ── B1 follow-up: Seed history with the just-approved action so the planner
  // does NOT re-issue it after a resume. Without this hint the next iteration
  // observes a fresh screen and may re-plan the same action, triggering another
  // approval prompt the user has to repeat.
  if (priorApprovedAction) {
    history.push(
      `0: previously approved by user — "${priorApprovedAction.slice(0, 120)}". ` +
      `Do NOT re-issue this action. Observe the new screen state and plan the next step toward the goal.`,
    );
  }

  // ── B3: Initialize the live-run state holder so the council snapshot
  // getter can surface fresh telemetry on every turn while the run is active.
  _liveRunState = {
    sessionId,
    goal,
    currentStep:               0,
    maxSteps,
    phase:                     'observe',
    lastDescription:           'Starting run…',
    consecutiveVerifyFailures: 0,
    consecutiveWaits:          0,
    lastEmitAt:                Date.now(),
  };

  const emit = (ev: TaskProgressEvent) => {
    // B3: Update live-run state on every emit so the council sees fresh data.
    if (_liveRunState) {
      _liveRunState.currentStep     = ev.step;
      _liveRunState.phase           = ev.phase;
      _liveRunState.lastDescription = ev.description;
      _liveRunState.lastEmitAt      = Date.now();
      if (ev.action?.type) _liveRunState.lastActionType = ev.action.type;
      if (ev.result && 'verifyPassed' in ev.result) {
        _liveRunState.lastVerifyPassed = ev.result.verifyPassed;
        if (ev.result.verifyPassed === false) {
          _liveRunState.lastVerifyError = ev.description;
        }
      }
    }
    try { onProgress?.(ev); } catch { /**/ }
  };

  let beforeScreenshotPath: string | undefined;
  try {
    const preSS = await OperatorService.captureScreen();
    if (preSS.ok && preSS.path) beforeScreenshotPath = preSS.path;
  } catch { /* non-fatal */ }

  const captureAfter = async (): Promise<string | undefined> => {
    try {
      const ss = await OperatorService.captureScreen();
      return ss.ok && ss.path ? ss.path : undefined;
    } catch { return undefined; }
  };

  let lastScreenshotPath: string | undefined;

  // ── App awareness: gather running apps + frontmost for planner context ──────
  // Refreshed once before the loop. The frontmost app may change mid-run, but
  // we refresh it at each step to keep the planner grounded.
  let appContext: string | undefined;
  try {
    const [runningApps, frontmostTarget] = await Promise.all([
      OperatorService.listRunningApps(),
      OperatorService.getFrontmostApp(),
    ]);
    const snapshot = buildAppAwarenessSnapshot(
      runningApps,
      frontmostTarget?.appName,
      frontmostTarget?.windowTitle,
    );
    const summary = formatAppAwarenessSummary(snapshot);
    if (summary && summary !== 'No known apps currently running.') {
      appContext = summary;
    }
  } catch { /* non-fatal — planner works without it */ }

  // ── Stuck-detection: consecutive "wait" actions ──────────────────────────────
  // If the planner keeps outputting "wait" it means it's confused and thinks
  // something else is doing the work. After the 1st wait, a post-wait history
  // nudge discourages another wait. On the 2nd consecutive wait, we force a
  // re-plan with an aggressive prompt that excludes "wait" as an option.
  let consecutiveWaits = 0;

  // ── B1: Load-bearing verification ────────────────────────────────────────────
  // Tracks how many steps in a row have failed visual verification. Two
  // consecutive verification failures abort the run — preventing the silent
  // failure mode where an action reports outcome=success but landed on the
  // wrong UI element and the workflow keeps marching forward into garbage.
  let consecutiveVerifyFailures = 0;

  for (let step = 1; step <= maxSteps; step++) {

    // ── 1. Observe ────────────────────────────────────────────────────────────
    emit({ step, phase: 'observe', description: 'Taking screenshot…' });
    const ss = await OperatorService.captureScreen();
    if (!ss.ok || !ss.path) {
      const err = ss.error ?? 'Screenshot failed';
      emit({ step, phase: 'error', description: err });
      return { ok: false, stepsExecuted: step - 1, outcome: 'error', summary: err, error: err, steps };
    }
    let screenshotPath = ss.path;
    lastScreenshotPath = screenshotPath;

    emit({ step, phase: 'observe', description: 'Reading screen…', screenshotPath });
    const screenDesc    = await describeScreen(screenshotPath);
    const screenSummary = screenDesc.summary || 'Screen captured.';

    // Refresh app awareness each step — frontmost app may change as we work
    try {
      const [ra, ft] = await Promise.all([
        OperatorService.listRunningApps(),
        OperatorService.getFrontmostApp(),
      ]);
      const snap = buildAppAwarenessSnapshot(ra, ft?.appName, ft?.windowTitle);
      const sum  = formatAppAwarenessSummary(snap);
      appContext = (sum && sum !== 'No known apps currently running.') ? sum : appContext;
    } catch { /* keep previous appContext */ }

    // ── 2. Plan ───────────────────────────────────────────────────────────────
    emit({ step, phase: 'plan', description: 'Planning…', screenshotPath });
    const planResponse = await analyzeScreen(
      screenshotPath,
      buildPlannerPrompt(goal, screenSummary, history.slice(-8).join('\n'), appContext, opts.targetApp),
    );
    if (!planResponse.ok) {
      const err = planResponse.error ?? 'Planning call failed';
      emit({ step, phase: 'error', description: err });
      return { ok: false, stepsExecuted: step - 1, outcome: 'error', summary: err, error: err, steps };
    }

    let planned: PlannedAction;
    try {
      const raw = planResponse.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      planned = JSON.parse(raw) as PlannedAction;
    } catch {
      // ── FIX: JSON parse failure must NOT be treated as success ───────
      // Previously this manufactured type:'done', causing silent fake
      // completion. Now we inject an error into history and force a
      // re-plan. After 2 consecutive parse failures we abort the run.
      const rawSnippet = planResponse.answer.slice(0, 200);
      history.push(
        `${step}: ⚠ PLANNER OUTPUT WAS NOT VALID JSON. Raw: "${rawSnippet}". ` +
        `You MUST respond with ONLY a raw JSON object — no markdown, no code fences, no explanation.`,
      );
      // Re-plan once with an explicit reminder
      const retryPlan = await analyzeScreen(
        screenshotPath,
        `Your previous response was NOT valid JSON. You MUST respond with ONLY a raw JSON object.\n\n` +
        buildPlannerPrompt(goal, screenSummary, history.slice(-8).join('\n'), appContext, opts.targetApp),
      );
      if (retryPlan.ok) {
        try {
          const raw2 = retryPlan.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          planned = JSON.parse(raw2) as PlannedAction;
        } catch {
          // Two consecutive parse failures — abort with a real error
          const err = `Planner produced invalid JSON twice. Last raw output: "${retryPlan.answer.slice(0, 120)}"`;
          emit({ step, phase: 'error', description: err, screenshotPath });
          return { ok: false, stepsExecuted: step - 1, outcome: 'error', summary: err, error: err, steps };
        }
      } else {
        const err = `Planner re-plan call failed: ${retryPlan.error ?? 'unknown'}`;
        emit({ step, phase: 'error', description: err, screenshotPath });
        return { ok: false, stepsExecuted: step - 1, outcome: 'error', summary: err, error: err, steps };
      }
    }

    // ── Stuck-detection: reject consecutive "wait" actions ─────────────────
    // When the planner keeps outputting "wait" it thinks something else is
    // doing the work. After 1 wait, force a re-plan with explicit instructions.
    if (planned.type === 'wait') {
      consecutiveWaits++;
      if (_liveRunState) _liveRunState.consecutiveWaits = consecutiveWaits;
      // Hard cap: 4+ consecutive waits means the operator is hopelessly stuck
      // even after multiple force re-plans. Abort rather than burn the budget.
      if (consecutiveWaits >= 4) {
        const err = `Operator stuck: ${consecutiveWaits} consecutive "wait" actions. The planner cannot determine how to make progress toward: "${goal}".`;
        emit({ step, phase: 'error', description: err, screenshotPath, action: planned });
        steps.push({ step, action: planned, executed: false, outcome: 'blocked', error: err });
        const afterScreenshotPath = await captureAfter();
        return { ok: false, stepsExecuted: step, outcome: 'blocked', summary: err, error: err, steps, beforeScreenshotPath, afterScreenshotPath };
      }

      if (consecutiveWaits >= 2) {
        const forcePlanResponse = await analyzeScreen(
          screenshotPath,
          `You are a desktop automation agent controlling mouse and keyboard. ` +
          `You have outputted "wait" ${consecutiveWaits} times in a row — you are STUCK. ` +
          `Nothing will happen unless YOU take action. There is no other program doing work for you.\n\n` +
          `Goal: "${goal}"\nScreen: ${screenSummary}\n\n` +
          `You MUST take a concrete action NOW — "focus", "click", "type", or "key". Do NOT output "wait". ` +
          `To open an app: use "focus" with its name, or open Spotlight with cmd+space and type the app name.\n\n` +
          `Respond with ONLY JSON:\n` +
          `{"type":"focus"|"click"|"type"|"key"|"done"|"blocked","description":"...","target":"...","text":"...","keyCombo":"...","appName":"...","reason":"..."}`,
        );
        if (forcePlanResponse.ok) {
          try {
            const raw2 = forcePlanResponse.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const forced = JSON.parse(raw2) as PlannedAction;
            if (forced.type !== 'wait') {
              planned = forced;
              consecutiveWaits = 0;
              if (_liveRunState) _liveRunState.consecutiveWaits = 0;
              history.push(`${step}: ⚠ stuck-detection — forced re-plan from "wait" to "${planned.type}"`);
            } else {
              history.push(`${step}: ⚠ stuck-detection — force re-plan still returned "wait" (${consecutiveWaits} in a row). Will execute wait but planner must act next step.`);
            }
          } catch {
            history.push(`${step}: ⚠ stuck-detection — force re-plan response was not valid JSON. Falling back to original wait action.`);
          }
        }
      }
    } else {
      consecutiveWaits = 0;
      if (_liveRunState) _liveRunState.consecutiveWaits = 0;
    }

    // ── B4: Begin a worker-run step record for this iteration ──────────────
    // Called after planning, before action execution. The hook owner (ipc.ts)
    // creates a WorkerStep and returns its id; we hold it in iteration scope
    // so the matching endStep call can correlate.
    let currentStepId: string | undefined;
    try {
      currentStepId = opts.workerHooks?.onStepBegin?.({
        index:  step - 1,
        title:  planned.description.slice(0, 80) || `Step ${step}`,
        action: planned,
      });
    } catch { /* hook errors are swallowed */ }

    /**
     * Notify the worker-run bridge that this iteration's step has finished.
     * Safe to call multiple times — only the first call after a beginStep
     * fires the hook (subsequent calls are no-ops because currentStepId is
     * cleared). Defensive against hook exceptions.
     */
    const endStep = (
      status:  'completed' | 'failed' | 'blocked' | 'waiting_approval',
      output?: Record<string, unknown>,
      error?:  string,
      shotPath?: string,
    ): void => {
      if (currentStepId === undefined && !opts.workerHooks?.onStepEnd) return;
      try {
        opts.workerHooks?.onStepEnd?.({
          stepId:         currentStepId,
          index:          step - 1,
          status,
          output,
          error,
          screenshotPath: shotPath,
        });
      } catch { /* hook errors are swallowed */ }
      currentStepId = undefined;
    };

    emit({ step, phase: 'act', description: planned.description, screenshotPath, action: planned });

    // Terminal states
    if (planned.type === 'done') {
      const summary = planned.reason ?? planned.description;
      steps.push({ step, action: planned, executed: true, outcome: 'done' });
      emit({ step, phase: 'done', description: summary, screenshotPath });
      endStep('completed', { actionType: 'done', reason: summary }, undefined, screenshotPath);
      const afterScreenshotPath = await captureAfter();
      return { ok: true, stepsExecuted: step, outcome: 'completed', summary, steps, beforeScreenshotPath, afterScreenshotPath };
    }
    if (planned.type === 'blocked') {
      const summary = planned.reason ?? planned.description;
      steps.push({ step, action: planned, executed: false, outcome: 'blocked' });
      emit({ step, phase: 'blocked', description: summary, screenshotPath });
      endStep('blocked', { actionType: 'blocked', reason: summary }, summary, screenshotPath);
      const afterScreenshotPath = await captureAfter();
      return { ok: false, stepsExecuted: step - 1, outcome: 'blocked', summary, error: summary, steps, beforeScreenshotPath, afterScreenshotPath };
    }

    // ── 3. Act ────────────────────────────────────────────────────────────────
    let stepResult: StepResult = { step, action: planned, executed: false };

    if (planned.type === 'wait') {
      const stablePath = await waitUntilScreenStable(5000);
      if (stablePath) screenshotPath = stablePath;
      stepResult = { step, action: planned, executed: true, outcome: 'success' };
      history.push(`${step}: wait (poll-stable) — screen settled. You MUST take a concrete action next (focus/click/type/key). Do NOT wait again.`);

    } else if (planned.type === 'focus') {
      const appTarget = planned.appName ?? planned.target ?? '';
      const action    = OperatorService.buildAction(sessionId, 'focus_app', { target: appTarget });
      const r         = await OperatorService.executeAction(action);
      stepResult      = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };

      // ── Smart recovery hints for focus failures ────────────────────────
      // When focus fails, inject actionable guidance so the planner doesn't
      // just retry the same broken app name or give up.
      if (r.outcome === 'target_not_found' || r.outcome === 'wrong_target') {
        const hint = r.outcome === 'target_not_found'
          ? `"${appTarget}" was NOT FOUND. The app name may differ from what you expect. ` +
            `Try these recovery steps IN ORDER: ` +
            `1) Try common name variants (e.g. "UnrealEditor" instead of "Unreal Engine", "Code" instead of "VS Code"). ` +
            `2) Use Spotlight: key cmd+space → type the app name → key return. ` +
            `3) Look for the app icon in the Dock and click it.`
          : `Focus landed on the wrong app (got "${(r as unknown as Record<string, unknown>).executedTarget ?? 'unknown'}"). ` +
            `Try Spotlight instead: key cmd+space → type "${appTarget}" → key return.`;
        history.push(`${step}: focus "${appTarget}" → ${r.outcome}. ${hint}`);
      } else {
        history.push(`${step}: focus "${appTarget}" → ${r.outcome}`);
      }

    } else if (planned.type === 'click') {
      let x = planned.x;
      let y = planned.y;
      let locConfidence: 'high' | 'medium' | 'low' | undefined;

      const cacheKey = `${sessionId}:${planned.target ?? ''}`;
      if ((x === undefined || y === undefined) && planned.target) {
        const cached = _elementCache.get(cacheKey);
        if (cached && Date.now() - cached.locatedAt < 60_000) {
          x = cached.x;
          y = cached.y;
        } else {
          /**
           * Locate helper: wraps locateElement with Retina scaling and
           * coordinate validation. Returns scaled logical-point coords.
           */
          const locateAndScale = async (imgPath: string, target: string) => {
            const loc = await locateElement(imgPath, target);
            if (!loc.found || loc.x === undefined || loc.y === undefined) return loc;

            // ── Priority 1: Retina coordinate scaling ─────────────────
            // Vision reports coordinates in image-pixel space. On Retina
            // displays the image is 2x (or Nx) the logical screen size.
            // CGEvent clicks use logical points → divide by scale factor.
            if (displayScale > 1) {
              loc.x = Math.round(loc.x / displayScale);
              loc.y = Math.round(loc.y / displayScale);
              if (loc.width)  loc.width  = Math.round(loc.width / displayScale);
              if (loc.height) loc.height = Math.round(loc.height / displayScale);
            }

            // Sanity check: reject obviously out-of-bounds coordinates
            // (negative or > 10000 logical points — no display is that big)
            if (loc.x < 0 || loc.y < 0 || loc.x > 10000 || loc.y > 10000) {
              return { ...loc, found: false, description: `Coordinates (${loc.x}, ${loc.y}) out of valid screen range after scaling` };
            }

            return loc;
          };

          // Attempt 1 — direct locate
          const loc1 = await locateAndScale(screenshotPath, planned.target);
          if (loc1.found && loc1.x !== undefined && loc1.y !== undefined) {
            x = loc1.x; y = loc1.y; locConfidence = loc1.confidence;
            _elementCache.set(cacheKey, { x, y, locatedAt: Date.now() });
          }

          // Attempt 2 — scroll down and retry
          if (x === undefined || y === undefined) {
            emit({ step, phase: 'act', description: `"${planned.target}" not found — scrolling to search…`, screenshotPath });
            const scrollAction = OperatorService.buildAction(sessionId, 'send_key', { key: 'page_down', modifiers: [] });
            await OperatorService.executeAction(scrollAction);
            await new Promise(r => setTimeout(r, 600));
            const ss2 = await OperatorService.captureScreen();
            if (ss2.ok && ss2.path) {
              const loc2 = await locateAndScale(ss2.path, planned.target);
              if (loc2.found && loc2.x !== undefined && loc2.y !== undefined) {
                x = loc2.x; y = loc2.y; locConfidence = loc2.confidence;
                _elementCache.set(cacheKey, { x, y, locatedAt: Date.now() });
              }
            }
          }

          // Attempt 3 — fresh screenshot + locate
          if (x === undefined || y === undefined) {
            emit({ step, phase: 'act', description: `Still not found — re-capturing screen…`, screenshotPath });
            const ss3 = await OperatorService.captureScreen();
            if (ss3.ok && ss3.path) {
              const loc3 = await locateAndScale(ss3.path, planned.target);
              if (loc3.found && loc3.x !== undefined && loc3.y !== undefined) {
                x = loc3.x; y = loc3.y; locConfidence = loc3.confidence;
                _elementCache.set(cacheKey, { x, y, locatedAt: Date.now() });
              }
            }
          }
        }
      }

      // ── Priority 1: Scale planner-supplied coordinates too ──────────────
      // If the planner itself supplied x/y (from a previous locate or its
      // own estimate), those are also in image-pixel space and need scaling.
      if (planned.x !== undefined && planned.y !== undefined && displayScale > 1) {
        x = Math.round((planned.x) / displayScale);
        y = Math.round((planned.y) / displayScale);
      }

      // ── Priority 5: Reject low-confidence clicks ───────────────────────
      // When the element was located with low confidence, do not click
      // blindly. Instead, inject an error into history so the planner can
      // try a different approach (keyboard shortcut, scroll to reveal, etc.)
      if (x !== undefined && y !== undefined && locConfidence === 'low') {
        const err = `"${planned.target}" was located at (${x},${y}) but with LOW confidence — the element may be ambiguous, partially visible, or misidentified. Skipping click to avoid misfire.`;
        stepResult = { step, action: planned, executed: false, outcome: 'failed', error: err };
        history.push(
          `${step}: click "${planned.target}" → SKIPPED (low confidence). ` +
          `Try a keyboard shortcut instead (Escape to dismiss, Return to confirm), or scroll to reveal the element more clearly.`,
        );
        // Clear cached low-confidence coords so a re-locate can try fresh
        _elementCache.delete(cacheKey);
      } else if (x === undefined || y === undefined) {
        // All 3 attempts exhausted
        const err = `Could not locate "${planned.target ?? 'target'}" after 3 attempts (direct, scroll, re-capture)`;
        stepResult = { step, action: planned, executed: false, outcome: 'failed', error: err };
        history.push(`${step}: click "${planned.target}" → not found after retries`);
      } else {
        const action = OperatorService.buildAction(sessionId, 'click_at', { x, y, button: planned.button ?? 'left' });
        const r      = await OperatorService.executeAction(action);
        if (r.outcome === 'approval_pending') {
          stepResult = { step, action: planned, executed: false, outcome: 'approval_pending', approvalId: r.approvalId };
          steps.push(stepResult);
          const summary = `Approval needed: click "${planned.target ?? `(${x},${y})`}"`;
          emit({ step, phase: 'blocked', description: summary, screenshotPath, action: planned, result: stepResult });
          endStep('waiting_approval', { actionType: 'click', x, y, target: planned.target, approvalId: r.approvalId }, summary, screenshotPath);
          return { ok: false, stepsExecuted: step - 1, outcome: 'approval_pending', summary, pendingApprovalId: r.approvalId, steps };
        }
        stepResult = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };
        history.push(`${step}: click (${x},${y}) [scale=${displayScale}, conf=${locConfidence ?? 'n/a'}] → ${r.outcome}`);
      }

    } else if (planned.type === 'type') {
      const text   = planned.text ?? '';
      const action = OperatorService.buildAction(sessionId, 'type_text', { text });
      const r      = await OperatorService.executeAction(action);
      if (r.outcome === 'approval_pending') {
        stepResult = { step, action: planned, executed: false, outcome: 'approval_pending', approvalId: r.approvalId };
        steps.push(stepResult);
        const summary = `Approval needed: type "${text.slice(0, 40)}"`;
        emit({ step, phase: 'blocked', description: summary, screenshotPath, action: planned, result: stepResult });
        endStep('waiting_approval', { actionType: 'type', text: text.slice(0, 100), approvalId: r.approvalId }, summary, screenshotPath);
        return { ok: false, stepsExecuted: step - 1, outcome: 'approval_pending', summary, pendingApprovalId: r.approvalId, steps };
      }
      stepResult = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };
      history.push(`${step}: type "${text.slice(0, 30)}" → ${r.outcome}`);

    } else if (planned.type === 'key') {
      const { key, modifiers } = parseKeyCombo(planned.keyCombo ?? '');
      const action             = OperatorService.buildAction(sessionId, 'send_key', { key, modifiers });
      const r                  = await OperatorService.executeAction(action);
      if (r.outcome === 'approval_pending') {
        stepResult = { step, action: planned, executed: false, outcome: 'approval_pending', approvalId: r.approvalId };
        steps.push(stepResult);
        const summary = `Approval needed: key "${planned.keyCombo}"`;
        emit({ step, phase: 'blocked', description: summary, screenshotPath, action: planned, result: stepResult });
        endStep('waiting_approval', { actionType: 'key', keyCombo: planned.keyCombo, approvalId: r.approvalId }, summary, screenshotPath);
        return { ok: false, stepsExecuted: step - 1, outcome: 'approval_pending', summary, pendingApprovalId: r.approvalId, steps };
      }
      stepResult = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };
      history.push(`${step}: key "${planned.keyCombo}" → ${r.outcome}`);
    }

    steps.push(stepResult);

    // ── 4. Verify ─────────────────────────────────────────────────────────────
    // B1: verification is now load-bearing.
    //   • Skip verify for `wait` actions (implicitly successful — no UI change to verify)
    //   • Emit a 'verify' phase event so the UI/council see the verdict live
    //   • On failure: increment a consecutive-failure counter, inject a
    //     prescriptive line into the planner history (so the next iteration
    //     re-plans with a different approach), and surface the failure
    //   • Two consecutive verify failures abort the run with a clear outcome
    //     instead of silently marching the workflow into garbage state
    if (stepResult.executed && planned.type !== 'wait') {
      const stablePath = await waitUntilScreenStable(5000);
      const verifyShot = stablePath ?? screenshotPath;
      const vr         = await analyzeScreen(
        verifyShot,
        `Did this action succeed: "${planned.description}"? Answer YES or NO then one sentence explaining what you see.`,
      );
      const passed = vr.ok && isVerificationPassed(vr.answer);
      stepResult.verifyPassed = passed;

      const verifyDesc = passed
        ? `Verified: ${vr.answer.slice(0, 100)}`
        : `Verification FAILED: ${vr.answer.slice(0, 120)}`;
      emit({
        step,
        phase:          'verify',
        description:    verifyDesc,
        screenshotPath: verifyShot,
        action:         planned,
        result:         stepResult,
      });

      if (passed) {
        consecutiveVerifyFailures = 0;
        if (_liveRunState) _liveRunState.consecutiveVerifyFailures = 0;
        history.push(`  verify: ✓ ${vr.answer.slice(0, 80)}`);
      } else {
        consecutiveVerifyFailures += 1;
        if (_liveRunState) _liveRunState.consecutiveVerifyFailures = consecutiveVerifyFailures;
        // ── B2: Retry-with-strategy ────────────────────────────────────────
        // The planner reads the last 8 history entries each iteration, so
        // the line we inject here is the steering signal for the next
        // re-plan. We escalate the directive based on the failure count:
        //
        //   1st failure → "re-plan with different element / approach"
        //   2nd failure → "FORCE a different action type entirely"
        //                 (click → keyboard shortcut, type → key combo, etc.)
        //   3rd failure → abort (handled in the hard-stop below)
        //
        // The total step budget is unchanged — each retry burns one step.
        if (consecutiveVerifyFailures === 1) {
          history.push(
            `  ⚠ verify FAILED (1/3): "${planned.description}" did not appear to take effect. ` +
            `Vision says: ${vr.answer.slice(0, 100)}. ` +
            `Re-plan with a different approach (different element label, scroll to find, or fresh focus).`,
          );
        } else if (consecutiveVerifyFailures === 2) {
          // Force escalation: name the failed action type so the planner
          // knows to switch to a fundamentally different mechanism.
          const escalationHint =
            planned.type === 'click' ? 'use a KEYBOARD SHORTCUT (key action) instead of clicking — try Return/Enter to confirm dialogs, Escape to dismiss, or the app-specific hotkey for menu items'
            : planned.type === 'type' ? 'try a DIFFERENT INPUT METHOD — focus the field first, then send_key per character or paste via keyboard shortcut'
            : planned.type === 'key'  ? 'try a CLICK on the menu item or button directly instead of the keyboard shortcut'
            : planned.type === 'focus' ? 'try Spotlight (cmd+space → type app name → return) or click the app icon in the Dock'
            : 'switch to a completely different action type';
          history.push(
            `  ⚠ verify FAILED (2/3): "${planned.description}" failed twice. ` +
            `Vision says: ${vr.answer.slice(0, 100)}. ` +
            `ESCALATE: do NOT retry the same ${planned.type} action — instead, ${escalationHint}. ` +
            `If escalation also fails the run will abort.`,
          );
        }
      }
    }

    // Hard-stop on action failure
    if (stepResult.outcome === 'permission_denied') {
      const actionLabel = planned.type === 'key' ? 'keyboard input' : planned.type === 'type' ? 'text input' : planned.type === 'click' ? 'mouse click' : planned.type;
      const err =
        `Accessibility permission denied for ${actionLabel}. ` +
        `Grant TriForge AI access in: System Settings → Privacy & Security → Accessibility. ` +
        `You may need to restart TriForge AI after granting permission.`;
      emit({ step, phase: 'error', description: err, screenshotPath, action: planned, result: stepResult });
      endStep('failed', { actionType: planned.type, outcome: 'permission_denied' }, err, screenshotPath);
      const afterScreenshotPath = await captureAfter();
      return { ok: false, stepsExecuted: step, outcome: 'blocked', summary: err, error: err, steps, beforeScreenshotPath, afterScreenshotPath };
    }
    if (stepResult.outcome === 'failed') {
      const err = stepResult.error ?? `Step ${step} failed (${stepResult.outcome})`;
      emit({ step, phase: 'error', description: err, screenshotPath, action: planned, result: stepResult });
      endStep('failed', { actionType: planned.type, outcome: stepResult.outcome }, err, screenshotPath);
      return { ok: false, stepsExecuted: step, outcome: 'error', summary: err, error: err, steps };
    }

    // B1+B2: Hard-stop after 3 consecutive verification failures.
    // The planner now gets two chances to self-correct via the prescriptive
    // history lines above (re-plan, then escalate to a different action type).
    // If the third attempt still fails verification we abort with a clear
    // outcome instead of silently marching the workflow into garbage state.
    if (consecutiveVerifyFailures >= 3) {
      const lastMsg = stepResult.action.description;
      const err = `Three consecutive steps failed visual verification — last action "${lastMsg}" did not produce the expected screen change after re-plan and action-type escalation. Aborting to prevent silent corruption of the workflow state.`;
      emit({ step, phase: 'error', description: err, screenshotPath, action: planned, result: stepResult });
      endStep('failed', { actionType: planned.type, verifyFailures: consecutiveVerifyFailures }, err, screenshotPath);
      return { ok: false, stepsExecuted: step, outcome: 'error', summary: err, error: err, steps, beforeScreenshotPath, afterScreenshotPath: await captureAfter() };
    }

    // ── B4: Natural end of iteration ─────────────────────────────────────────
    // No early-return path was taken, so this step is "settled" in its
    // own right. Persist its outcome — completed if verify passed (or wait
    // action), failed if verify failed but we haven't yet tripped the
    // 3-failure abort. The runner's next iteration will continue with
    // re-plan/escalation as steered by the history lines.
    if (stepResult.verifyPassed === false) {
      endStep('failed', { actionType: planned.type, outcome: stepResult.outcome, verifyPassed: false }, 'Visual verification did not confirm the action took effect', screenshotPath);
    } else {
      endStep('completed', { actionType: planned.type, outcome: stepResult.outcome, verifyPassed: stepResult.verifyPassed ?? null }, undefined, screenshotPath);
    }
  }

  const doneCount   = steps.filter(s => s.outcome === 'success' || s.verifyPassed).length;
  const lastAction  = steps.at(-1)?.action.description ?? 'none';
  const contSummary = `Completed ${doneCount} of ${steps.length} actions. Last: "${lastAction}". Goal not yet finished.`;
  const resumeState = {
    lastScreenshotPath,
    completedSteps:   steps.length,
    historySnapshot:  history.slice(-10),
  };
  emit({ step: maxSteps, phase: 'continuation_prompt', description: contSummary, continuationSummary: contSummary });
  const afterScreenshotPath = await captureAfter();
  return { ok: false, stepsExecuted: maxSteps, outcome: 'max_steps_reached', summary: contSummary, steps, resumeState, beforeScreenshotPath, afterScreenshotPath };
}
