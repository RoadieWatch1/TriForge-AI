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
import { OperatorService } from './operatorService';
import { analyzeScreen, describeScreen, locateElement } from './visionAnalyzer';

// ── Public types ──────────────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  sessionId:   string;
  goal:        string;
  maxSteps?:   number;
  onProgress?: (event: TaskProgressEvent) => void;
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
  x?:          number;
  y?:          number;
  text?:       string;
  /** e.g. "cmd+b", "return", "escape" */
  keyCombo?:   string;
  appName?:    string;
  reason?:     string;
}

// ── Planner prompt ────────────────────────────────────────────────────────────

function buildPlannerPrompt(goal: string, screenSummary: string, history: string): string {
  return `You are controlling a computer to accomplish:
"${goal}"

Current screen: ${screenSummary}

${history ? `Recent steps:\n${history}\n\n` : ''}Respond with ONLY JSON (no markdown, no explanation):
{
  "type": "click"|"type"|"key"|"focus"|"wait"|"done"|"blocked",
  "description": "one sentence of what you are doing",
  "target": "exact UI element label to click (for click)",
  "text": "text to type (for type)",
  "keyCombo": "shortcut e.g. cmd+s, return (for key)",
  "appName": "application name (for focus)",
  "reason": "goal achieved or why blocked (for done/blocked)"
}`;
}

// ── Key combo → OperatorAction key+modifiers ──────────────────────────────────

function parseKeyCombo(combo: string): { key: string; modifiers: Array<'cmd' | 'shift' | 'alt' | 'ctrl'> } {
  const parts  = combo.toLowerCase().split('+');
  const mods   = parts.slice(0, -1) as Array<'cmd' | 'shift' | 'alt' | 'ctrl'>;
  const key    = parts[parts.length - 1];
  return { key, modifiers: mods };
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

// ── Core run loop ─────────────────────────────────────────────────────────────

export async function runOperatorTask(opts: TaskRunnerOptions): Promise<TaskRunResult> {
  const { sessionId, goal, maxSteps = 15, onProgress } = opts;
  const steps: StepResult[]  = [];
  const history: string[]    = [];

  const emit = (ev: TaskProgressEvent) => { try { onProgress?.(ev); } catch { /**/ } };

  // Fix 4: track last screenshot across loop iterations for resumeState
  let lastScreenshotPath: string | undefined;

  for (let step = 1; step <= maxSteps; step++) {

    // ── 1. Observe ────────────────────────────────────────────────────────────
    emit({ step, phase: 'observe', description: 'Taking screenshot…' });
    const ss = await OperatorService.captureScreen();
    if (!ss.ok || !ss.path) {
      const err = ss.error ?? 'Screenshot failed';
      emit({ step, phase: 'error', description: err });
      return { ok: false, stepsExecuted: step - 1, outcome: 'error', summary: err, error: err, steps };
    }
    // Fix 2: use 'let' so the wait branch can update screenshotPath
    let screenshotPath = ss.path;
    lastScreenshotPath = screenshotPath;

    emit({ step, phase: 'observe', description: 'Reading screen…', screenshotPath });
    const screenDesc    = await describeScreen(screenshotPath);
    const screenSummary = screenDesc.summary || 'Screen captured.';

    // ── 2. Plan ───────────────────────────────────────────────────────────────
    emit({ step, phase: 'plan', description: 'Planning…', screenshotPath });
    const planResponse = await analyzeScreen(
      screenshotPath,
      buildPlannerPrompt(goal, screenSummary, history.slice(-8).join('\n')),
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
      planned = { type: 'done', description: planResponse.answer.slice(0, 120), reason: 'JSON parse failed — treating as complete' };
    }

    emit({ step, phase: 'act', description: planned.description, screenshotPath, action: planned });

    // Terminal states
    if (planned.type === 'done') {
      const summary = planned.reason ?? planned.description;
      steps.push({ step, action: planned, executed: true, outcome: 'done' });
      emit({ step, phase: 'done', description: summary, screenshotPath });
      return { ok: true, stepsExecuted: step, outcome: 'completed', summary, steps };
    }
    if (planned.type === 'blocked') {
      const summary = planned.reason ?? planned.description;
      steps.push({ step, action: planned, executed: false, outcome: 'blocked' });
      emit({ step, phase: 'blocked', description: summary, screenshotPath });
      return { ok: false, stepsExecuted: step - 1, outcome: 'blocked', summary, error: summary, steps };
    }

    // ── 3. Act ────────────────────────────────────────────────────────────────
    let stepResult: StepResult = { step, action: planned, executed: false };

    if (planned.type === 'wait') {
      // Fix 2: poll until stable instead of fixed 800ms
      const stablePath = await waitUntilScreenStable(5000);
      if (stablePath) screenshotPath = stablePath;
      stepResult = { step, action: planned, executed: true, outcome: 'success' };
      history.push(`${step}: wait (poll-stable)`);

    } else if (planned.type === 'focus') {
      const appTarget = planned.appName ?? planned.target ?? '';
      const action    = OperatorService.buildAction(sessionId, 'focus_app', { target: appTarget });
      const r         = await OperatorService.executeAction(action);
      stepResult      = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };
      history.push(`${step}: focus "${appTarget}" → ${r.outcome}`);

    } else if (planned.type === 'click') {
      // Fix 1 + Fix 5: cache check → 3-attempt retry with scroll
      let x = planned.x;
      let y = planned.y;

      const cacheKey = `${sessionId}:${planned.target ?? ''}`;
      if ((x === undefined || y === undefined) && planned.target) {
        const cached = _elementCache.get(cacheKey);
        if (cached && Date.now() - cached.locatedAt < 60_000) {
          x = cached.x;
          y = cached.y;
        } else {
          // Attempt 1 — direct locate
          const loc1 = await locateElement(screenshotPath, planned.target);
          if (loc1.found && loc1.x !== undefined && loc1.y !== undefined) {
            x = loc1.x; y = loc1.y;
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
              const loc2 = await locateElement(ss2.path, planned.target);
              if (loc2.found && loc2.x !== undefined && loc2.y !== undefined) {
                x = loc2.x; y = loc2.y;
                _elementCache.set(cacheKey, { x, y, locatedAt: Date.now() });
              }
            }
          }

          // Attempt 3 — fresh screenshot + locate
          if (x === undefined || y === undefined) {
            emit({ step, phase: 'act', description: `Still not found — re-capturing screen…`, screenshotPath });
            const ss3 = await OperatorService.captureScreen();
            if (ss3.ok && ss3.path) {
              const loc3 = await locateElement(ss3.path, planned.target);
              if (loc3.found && loc3.x !== undefined && loc3.y !== undefined) {
                x = loc3.x; y = loc3.y;
                _elementCache.set(cacheKey, { x, y, locatedAt: Date.now() });
              }
            }
          }
        }
      }

      if (x === undefined || y === undefined) {
        // All 3 attempts exhausted
        const err = `Could not locate "${planned.target ?? 'target'}" after 3 attempts (direct, scroll, re-capture)`;
        stepResult = { step, action: planned, executed: false, outcome: 'failed', error: err };
        history.push(`${step}: click "${planned.target}" → not found after retries`);
      } else {
        const action = OperatorService.buildAction(sessionId, 'click_at', { x, y, button: 'left' });
        const r      = await OperatorService.executeAction(action);
        if (r.outcome === 'approval_pending') {
          stepResult = { step, action: planned, executed: false, outcome: 'approval_pending', approvalId: r.approvalId };
          steps.push(stepResult);
          const summary = `Approval needed: click "${planned.target ?? `(${x},${y})`}"`;
          emit({ step, phase: 'blocked', description: summary, screenshotPath, action: planned, result: stepResult });
          return { ok: false, stepsExecuted: step - 1, outcome: 'approval_pending', summary, pendingApprovalId: r.approvalId, steps };
        }
        stepResult = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };
        history.push(`${step}: click (${x},${y}) → ${r.outcome}`);
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
        return { ok: false, stepsExecuted: step - 1, outcome: 'approval_pending', summary, pendingApprovalId: r.approvalId, steps };
      }
      stepResult = { step, action: planned, executed: r.outcome === 'success', outcome: r.outcome, error: r.error };
      history.push(`${step}: key "${planned.keyCombo}" → ${r.outcome}`);
    }

    steps.push(stepResult);

    // ── 4. Verify ─────────────────────────────────────────────────────────────
    // Fix 2: poll-until-stable instead of fixed 400ms wait
    // Fix 3: intent-aware verification instead of prefix-match
    if (stepResult.executed) {
      const stablePath = await waitUntilScreenStable(5000);
      if (stablePath) {
        const vr     = await analyzeScreen(stablePath, `Did this action succeed: "${planned.description}"? Answer YES or NO then one sentence.`);
        const passed = vr.ok && isVerificationPassed(vr.answer);
        stepResult.verifyPassed = passed;
        history.push(`  verify: ${passed ? '✓' : '✗'} ${vr.answer.slice(0, 80)}`);
      }
    }

    // Hard-stop on action failure
    if (stepResult.outcome === 'failed' || stepResult.outcome === 'permission_denied') {
      const err = stepResult.error ?? `Step ${step} failed (${stepResult.outcome})`;
      emit({ step, phase: 'error', description: err, screenshotPath, action: planned, result: stepResult });
      return { ok: false, stepsExecuted: step, outcome: 'error', summary: err, error: err, steps };
    }
  }

  // Fix 4: Summarize progress and emit continuation_prompt instead of silent max_steps return
  const doneCount   = steps.filter(s => s.outcome === 'success' || s.verifyPassed).length;
  const lastAction  = steps.at(-1)?.action.description ?? 'none';
  const contSummary = `Completed ${doneCount} of ${steps.length} actions. Last: "${lastAction}". Goal not yet finished.`;
  const resumeState = {
    lastScreenshotPath,
    completedSteps:   steps.length,
    historySnapshot:  history.slice(-10),
  };
  emit({ step: maxSteps, phase: 'continuation_prompt', description: contSummary, continuationSummary: contSummary });
  return { ok: false, stepsExecuted: maxSteps, outcome: 'max_steps_reached', summary: contSummary, steps, resumeState };
}
