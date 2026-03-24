/**
 * packDiffEngine.ts — Phase 36
 *
 * Compute a semantic diff between the currently-installed version of a pack
 * and an incoming (new) version, so the user can review what will change
 * before confirming an update.
 *
 * The diff is purely analytical — no writes happen here.
 */

import type { RunbookDef } from './runbooks';
import type { RunbookPack, PackDiff, RunbookDiff } from './runbookPack';
import type { Store } from './store';

// Step types that represent external destinations (output side-effects)
const DEST_STEP_TYPES = new Set(['slack', 'jira', 'linear', 'notify_push', 'webhook', 'email', 'discord', 'telegram']);

// Step types that represent integration dependencies
const INTG_STEP_TYPES: Record<string, string> = {
  slack:       'slack',
  jira:        'jira',
  linear:      'linear',
  webhook:     'webhook',
  discord:     'discord',
  telegram:    'telegram',
  notify_push: 'push',
};

function _destinations(steps: RunbookDef['steps'] = []): string[] {
  const out = new Set<string>();
  for (const s of steps) if (DEST_STEP_TYPES.has(s.type)) out.add(s.type);
  return [...out];
}

function _integrations(rb: RunbookDef): string[] {
  const out = new Set<string>();
  for (const s of rb.steps ?? []) {
    const intg = INTG_STEP_TYPES[s.type];
    if (intg) out.add(intg);
  }
  // Also honour the explicit linkedIntegrations list
  for (const i of rb.linkedIntegrations ?? []) out.add(i);
  return [...out];
}

/**
 * Compute the diff between the incoming pack version and whatever is currently
 * installed in the workspace.
 *
 * If the pack is not yet installed, the diff will show every runbook as `isNew`
 * and every integration / destination as newly introduced.
 */
export function computePackDiff(incomingPack: RunbookPack, store: Store): PackDiff {
  const existing    = store.getPack(incomingPack.id);
  const allRunbooks = store.getRunbooks();
  const existingMap = new Map(allRunbooks.map(r => [r.id, r]));

  const runbookDiffs: RunbookDiff[] = [];
  let totalStepDelta = 0;
  const newDestinations = new Set<string>();

  // ── Per-runbook diffs ──────────────────────────────────────────────────────

  for (const newRb of incomingPack.runbooks) {
    const old = existingMap.get(newRb.id);
    const newSteps = newRb.steps ?? [];

    if (!old) {
      // Brand-new runbook
      const intgs = _integrations(newRb);
      runbookDiffs.push({
        id:                  newRb.id,
        title:               newRb.title,
        steps:               { added: newSteps.length, removed: 0, modified: 0 },
        integrationsAdded:   intgs,
        integrationsRemoved: [],
        incidentModeChanged: !!newRb.incidentMode,
        isNew:               true,
        isRemoved:           false,
      });
      totalStepDelta += newSteps.length;
      _destinations(newSteps).forEach(d => newDestinations.add(d));
    } else {
      // Existing runbook — compute step-level diff by ID
      const oldSteps  = old.steps ?? [];
      const oldStepMap = new Map(oldSteps.map(s => [s.id, s]));
      const newStepMap = new Map(newSteps.map(s => [s.id, s]));

      const added    = newSteps.filter(s => !oldStepMap.has(s.id)).length;
      const removed  = oldSteps.filter(s => !newStepMap.has(s.id)).length;
      const modified = newSteps.filter(s => {
        if (!oldStepMap.has(s.id)) return false;
        return JSON.stringify(s) !== JSON.stringify(oldStepMap.get(s.id));
      }).length;

      const oldIntgSet = new Set(_integrations(old));
      const newIntgs   = _integrations(newRb);
      const intgsAdded   = newIntgs.filter(i => !oldIntgSet.has(i));
      const intgsRemoved = [...oldIntgSet].filter(i => !newIntgs.includes(i));

      const oldDests = new Set(_destinations(oldSteps));
      _destinations(newSteps).filter(d => !oldDests.has(d)).forEach(d => newDestinations.add(d));

      const hasChanges =
        added > 0 || removed > 0 || modified > 0 ||
        intgsAdded.length > 0 || intgsRemoved.length > 0 ||
        newRb.incidentMode !== old.incidentMode;

      if (hasChanges) {
        runbookDiffs.push({
          id:                  newRb.id,
          title:               newRb.title,
          steps:               { added, removed, modified },
          integrationsAdded:   intgsAdded,
          integrationsRemoved: intgsRemoved,
          incidentModeChanged: newRb.incidentMode !== old.incidentMode,
          isNew:               false,
          isRemoved:           false,
        });
      }
      totalStepDelta += added - removed;
    }
  }

  // ── Runbooks removed from this version of the pack ────────────────────────

  if (existing) {
    const incomingIds = new Set(incomingPack.runbooks.map(r => r.id));
    for (const removedId of existing.runbookIds) {
      if (!incomingIds.has(removedId)) {
        const old = existingMap.get(removedId);
        if (old) {
          const oldSteps = old.steps ?? [];
          runbookDiffs.push({
            id:                  removedId,
            title:               old.title,
            steps:               { added: 0, removed: oldSteps.length, modified: 0 },
            integrationsAdded:   [],
            integrationsRemoved: _integrations(old),
            incidentModeChanged: false,
            isNew:               false,
            isRemoved:           true,
          });
          totalStepDelta -= oldSteps.length;
        }
      }
    }
  }

  // ── Pack-level integration diff ───────────────────────────────────────────

  const oldPackIntgs = new Set(existing?.requiredIntegrations ?? []);
  const newPackIntgs = incomingPack.requiredIntegrations ?? [];
  const integrationsAdded   = newPackIntgs.filter(i => !oldPackIntgs.has(i));
  const integrationsRemoved = [...oldPackIntgs].filter(i => !newPackIntgs.includes(i));

  // ── Variable diff ─────────────────────────────────────────────────────────

  const currentRunbooks = existing
    ? allRunbooks.filter(r => r.packId === incomingPack.id)
    : [];
  const oldVarNames = new Set(currentRunbooks.flatMap(r => r.variables ?? []).map(v => v.name));
  const newVarNames = new Set(incomingPack.runbooks.flatMap(r => r.variables ?? []).map(v => v.name));
  const variablesAdded   = [...newVarNames].filter(v => !oldVarNames.has(v));
  const variablesRemoved = [...oldVarNames].filter(v => !newVarNames.has(v));

  // ── Incident mode change ──────────────────────────────────────────────────

  const oldIncident = currentRunbooks.some(r => r.incidentMode);
  const newIncident = incomingPack.runbooks.some(r => r.incidentMode);

  const riskIncreased = newDestinations.size > 0 || integrationsAdded.length > 0;
  const isEmpty =
    runbookDiffs.length === 0 &&
    integrationsAdded.length === 0 &&
    variablesAdded.length === 0 &&
    variablesRemoved.length === 0;

  return {
    runbooks:            runbookDiffs,
    integrationsAdded,
    integrationsRemoved,
    variablesAdded,
    variablesRemoved,
    destinationsAdded:   [...newDestinations],
    riskIncreased,
    incidentModeChanged: newIncident !== oldIncident,
    totalStepDelta,
    isEmpty,
  };
}
