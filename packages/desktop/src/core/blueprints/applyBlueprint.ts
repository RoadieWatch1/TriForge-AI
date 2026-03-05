// ── applyBlueprint.ts — Orchestrate blueprint activation/deactivation ──────────
//
// applyBlueprint() is the single entry point for making a blueprint active.
// It wires the blueprint into:
//   - ProfessionEngine  (sensors + system prompt)
//   - AutonomyEngine    (workflows + risk policy)
//   - MissionController (mission templates)
//
// It also manages the active blueprint state and exposes getActiveBlueprint()
// for other subsystems (e.g. ipc.ts system prompt injection).
//
// Safety: This file never touches the filesystem directly. All side effects
// go through the injected BlueprintApplyContext.

import type { TriForgeBlueprint, BlueprintApplyContext, ActiveBlueprintState } from './BlueprintTypes';
import { resolveCapabilitiesFull } from '../capability/CapabilityResolver';
import { missionEvolutionEngine } from '../evolution/MissionEvolutionEngine';
import { createLogger } from '../logging/log';

const log = createLogger('applyBlueprint');

// ── Module-level active state ──────────────────────────────────────────────────

let _activeState: ActiveBlueprintState | null = null;

// ── Risk policy mapping ────────────────────────────────────────────────────────
// Maps blueprint approvalStrictness to AutonomyEngine's RiskPolicy fields
// (allowAutoRunSafeFixes, allowScriptRunner, allowWriteFile, etc.)

const RISK_POLICY_MAP: Record<string, Record<string, boolean>> = {
  strict: {
    allowAutoRunSafeFixes: false,
    allowScriptRunner:     false,
    allowKillProcess:      false,
    allowRestartService:   false,
    allowWriteFile:        false,
    allowBrowserFillForm:  false,
    allowSocialPost:       false,
  },
  balanced: {
    allowAutoRunSafeFixes: true,
    allowScriptRunner:     false,
    allowKillProcess:      false,
    allowRestartService:   false,
    allowWriteFile:        true,
    allowBrowserFillForm:  false,
    allowSocialPost:       false,
  },
  relaxed: {
    allowAutoRunSafeFixes: true,
    allowScriptRunner:     true,
    allowKillProcess:      false,
    allowRestartService:   true,
    allowWriteFile:        true,
    allowBrowserFillForm:  true,
    allowSocialPost:       false,
  },
};

// ── Apply ──────────────────────────────────────────────────────────────────────

/**
 * Activates a blueprint. If another blueprint is already active, it is
 * deactivated first. Safe to call multiple times with the same blueprint.
 */
export function applyBlueprint(
  blueprint: TriForgeBlueprint,
  ctx: BlueprintApplyContext,
): void {
  // Deactivate current blueprint before switching
  if (_activeState && _activeState.blueprint.id !== blueprint.id) {
    deactivateBlueprint(ctx);
  }

  // Skip if this blueprint is already active
  if (_activeState?.blueprint.id === blueprint.id) {
    log.info(`Blueprint "${blueprint.id}" is already active — skipping`);
    return;
  }

  log.info(`Applying blueprint: ${blueprint.id} (${blueprint.name})`);

  // ── 0. Resolve capabilities + activate evolution engine ───────────────────
  const { capabilities, engines } = resolveCapabilitiesFull(blueprint.id);
  log.info(`Capabilities: [${capabilities.map(c => c.id).join(', ')}] via engines: [${engines.join(', ')}]`);
  missionEvolutionEngine.setActiveProfession(blueprint.id);

  // ── 1. Start sensors ───────────────────────────────────────────────────────
  for (const sensor of blueprint.activeSensors) {
    try {
      const result = ctx.sensorManager.startSensor(sensor);
      if (result.error) log.warn(`Sensor "${sensor}" start error: ${result.error}`);
    } catch (err) {
      log.warn(`Failed to start sensor "${sensor}":`, err);
    }
  }

  // ── 2. Register workflows ──────────────────────────────────────────────────
  const registeredWorkflowIds: string[] = [];
  for (const wf of blueprint.workflows) {
    try {
      ctx.autonomyEngine.registerWorkflow({ ...wf, createdAt: Date.now() });
      registeredWorkflowIds.push(wf.id);
    } catch (err) {
      log.warn(`Failed to register workflow "${wf.id}":`, err);
    }
  }

  // ── 3. Set risk policy ─────────────────────────────────────────────────────
  if (ctx.autonomyEngine.setRiskPolicy) {
    try {
      ctx.autonomyEngine.setRiskPolicy(RISK_POLICY_MAP[blueprint.approvalStrictness]);
    } catch (err) {
      log.warn('Failed to set risk policy:', err);
    }
  }

  // ── 4. Register mission templates ──────────────────────────────────────────
  if (blueprint.missionTemplates.length > 0) {
    try {
      ctx.missionController.registerMissionTemplates(blueprint.missionTemplates);
    } catch (err) {
      log.warn('Failed to register mission templates:', err);
    }
  }

  // ── 5. Record active state ─────────────────────────────────────────────────
  _activeState = {
    blueprint,
    activatedAt: Date.now(),
    registeredWorkflowIds,
  };

  log.info(`Blueprint "${blueprint.id}" applied — ${registeredWorkflowIds.length} workflows, ${blueprint.activeSensors.length} sensors`);
}

// ── Deactivate ─────────────────────────────────────────────────────────────────

/**
 * Deactivates the currently active blueprint: stops sensors, removes workflows.
 * No-op if no blueprint is active.
 */
export function deactivateBlueprint(ctx: BlueprintApplyContext): void {
  if (!_activeState) return;

  const { blueprint, registeredWorkflowIds } = _activeState;
  log.info(`Deactivating blueprint: ${blueprint.id}`);

  // Stop sensors
  for (const sensor of blueprint.activeSensors) {
    try { ctx.sensorManager.stopSensor(sensor); } catch { /* non-fatal */ }
  }

  // Remove workflows
  for (const id of registeredWorkflowIds) {
    try { ctx.autonomyEngine.deleteWorkflow(id); } catch { /* non-fatal */ }
  }

  _activeState = null;
}

// ── Accessors ──────────────────────────────────────────────────────────────────

/** Returns the currently active blueprint, or null. */
export function getActiveBlueprint(): TriForgeBlueprint | null {
  return _activeState?.blueprint ?? null;
}

/** Returns the active blueprint state including activation time and workflow IDs. */
export function getActiveBlueprintState(): ActiveBlueprintState | null {
  return _activeState;
}

/**
 * Returns system prompt additions for the active blueprint.
 * Called by systemPrompt.ts to inject role context into every AI call.
 */
export function getBlueprintSystemPromptAdditions(): string[] {
  return _activeState?.blueprint.systemPromptAdditions ?? [];
}

/**
 * Returns the response style preference for the active blueprint.
 * Used by ThinkTankPlanner and synthesis to adjust output style.
 */
export function getBlueprintResponseStyle(): 'technical' | 'executive' | 'conversational' {
  return _activeState?.blueprint.responseStyle ?? 'conversational';
}
