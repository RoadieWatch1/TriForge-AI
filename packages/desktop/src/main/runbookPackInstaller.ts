/**
 * runbookPackInstaller.ts — Phase 35 / 36
 *
 * Install, update, uninstall, and rollback runbook packs in a workspace.
 *
 * Identity contract:
 *   Pack runbooks use their own stable IDs as workspace runbook IDs.
 *   This enables accurate update detection (find by id) and rollback
 *   (restore by id).  Two workspaces installing the same pack will have
 *   runbooks with the same IDs — this is intentional and enables diff/compare.
 *
 * Rollback:
 *   Before each install/update, the current runbook content is snapshotted
 *   into entry.previousVersions (capped at 3).  rollbackPack() swaps the
 *   most recent snapshot back in and pushes the current state as a new head.
 */

import type { Store } from './store';
import type { RunbookDef } from './runbooks';
import {
  type RunbookPack,
  type PackRegistryEntry,
  type PackInstallPreview,
  type PackVersionSnapshot,
  type PackRunbookPreview,
  type PackTrustVerification,
  DEFAULT_PACK_TRUST_POLICY,
} from './runbookPack';
import { verifyPackSignature } from './packSigner';
import { computePackDiff } from './packDiffEngine';
import { evaluateTrustPolicy } from './packTrustPolicy';

// ── Preview ───────────────────────────────────────────────────────────────────

/**
 * Build a preview of what will happen if this pack is installed.
 * Does not write anything — safe to call multiple times.
 */
export function previewPack(pack: RunbookPack, store: Store): PackInstallPreview {
  const existing    = store.getPack(pack.id);
  const ws          = store.getWorkspace();
  const configured: string[] = (ws as any)?.linkedIntegrations ?? [];

  const runbooks: PackRunbookPreview[] = pack.runbooks.map(rb => {
    const current = store.getRunbook(rb.id);
    return {
      id:                 rb.id,
      title:              rb.title,
      stepCount:          rb.steps?.length ?? 0,
      isUpdate:           !!current,
      currentVersion:     current?.version,
      hasIncidentMode:    rb.incidentMode ?? false,
      linkedIntegrations: rb.linkedIntegrations ?? [],
    };
  });

  const missingIntegrations = pack.requiredIntegrations.filter(
    i => !configured.includes(i),
  );

  // Plain-English risk summary
  const installCount = runbooks.filter(r => !r.isUpdate).length;
  const updateCount  = runbooks.filter(r =>  r.isUpdate).length;
  const parts: string[] = [];
  if (installCount > 0) parts.push(`install ${installCount} new runbook${installCount > 1 ? 's' : ''}`);
  if (updateCount  > 0) parts.push(`update ${updateCount} existing runbook${updateCount > 1 ? 's' : ''}`);
  if (missingIntegrations.length > 0) parts.push(`missing integrations: ${missingIntegrations.join(', ')}`);
  if (pack.incidentSupport)           parts.push('includes incident-mode runbooks');
  if (pack.requiredVariables.filter(v => v.required).length > 0) {
    parts.push(`${pack.requiredVariables.filter(v => v.required).length} required variable(s)`);
  }
  const riskSummary = parts.length ? parts.join('; ') : 'No changes required';

  // ── Phase 36 — Trust verification + diff + policy ────────────────────────
  const trustedSigners = store.getTrustedSigners();
  const trust: PackTrustVerification = verifyPackSignature(pack, trustedSigners);

  const isUpdate = !!existing;
  const diff = isUpdate ? computePackDiff(pack, store) : undefined;

  const policy       = store.getPackTrustPolicy();
  const policyResult = evaluateTrustPolicy(trust, diff, policy, isUpdate);

  return {
    pack,
    runbooks,
    requiredIntegrations: pack.requiredIntegrations,
    missingIntegrations,
    requiredVariables:    pack.requiredVariables,
    riskSummary,
    isUpdate,
    existingVersion:      existing?.version,
    canRollback:          !!(existing?.previousVersions?.length),
    trust,
    diff,
    policyBlocked:        policyResult.blocked,
    policyBlockReason:    policyResult.blockReason,
    confirmReasons:       policyResult.confirmReasons,
  };
}

// ── Install / Update ──────────────────────────────────────────────────────────

/**
 * Install or update a pack in the workspace.
 * - New runbooks are created.
 * - Existing runbooks (same id) are overwritten, preserving `enabled` state.
 * - A snapshot of previous versions is stored for rollback.
 * Returns the ids of all runbooks touched.
 */
export function installPack(
  pack:    RunbookPack,
  store:   Store,
  actorId?: string,
): { installedIds: string[]; updatedIds: string[] } {
  const now         = Date.now();
  const existing    = store.getPack(pack.id);
  const installedIds: string[] = [];
  const updatedIds:   string[] = [];

  // ── Snapshot the current version for rollback ──────────────────────────────
  let previousVersions: PackVersionSnapshot[] = existing?.previousVersions ?? [];
  if (existing) {
    const snap: PackVersionSnapshot = {
      version:     existing.version,
      installedAt: existing.installedAt,
      runbooks:    existing.runbookIds
        .map(id => store.getRunbook(id))
        .filter((r): r is RunbookDef => r !== null),
    };
    previousVersions = [snap, ...previousVersions].slice(0, 3);
  }

  // ── Write each runbook ────────────────────────────────────────────────────
  for (const packRb of pack.runbooks) {
    const currentRb = store.getRunbook(packRb.id);
    const def: RunbookDef = {
      ...packRb,
      scope:                 'workspace',
      // Preserve operator's enabled/disabled choice across updates
      enabled:               currentRb?.enabled ?? packRb.enabled ?? true,
      // Phase 35 provenance fields
      version:               pack.version,
      packId:                pack.id,
      packVersion:           pack.version,
      changelog:             pack.changelog,
      updatedAt:             now,
      createdAt:             currentRb?.createdAt ?? now,
    };
    store.saveRunbook(def);
    if (currentRb) updatedIds.push(def.id);
    else            installedIds.push(def.id);
  }

  const allIds = [...installedIds, ...updatedIds];

  // ── Update registry ───────────────────────────────────────────────────────
  // ── Phase 36 — Record trust provenance ────────────────────────────────────
  const trustedSigners = store.getTrustedSigners();
  const trust = verifyPackSignature(pack, trustedSigners);

  const entry: PackRegistryEntry = {
    packId:               pack.id,
    name:                 pack.name,
    version:              pack.version,
    description:          pack.description,
    installedAt:          now,
    installedBy:          actorId,
    runbookIds:           allIds,
    source:               pack.source,
    enabled:              true,
    requiredIntegrations: pack.requiredIntegrations,
    changelog:            pack.changelog,
    previousVersions,
    // Phase 36 trust fields
    trustStatus:          trust.status,
    signer:               trust.keyId,
    signerName:           trust.signerName,
    verifiedAt:           trust.status === 'trusted' ? now : undefined,
    importSource:         'local',
  };
  store.savePack(entry);

  return { installedIds, updatedIds };
}

// ── Uninstall ─────────────────────────────────────────────────────────────────

/**
 * Remove all runbooks owned by this pack and delete the registry entry.
 * Runbooks that have been locally modified (version !== pack.version) are
 * preserved to avoid destroying operator work — they become unmanaged.
 */
export function uninstallPack(
  packId: string,
  store:  Store,
): { removedIds: string[]; preservedIds: string[]; error?: string } {
  const entry = store.getPack(packId);
  if (!entry) return { removedIds: [], preservedIds: [], error: 'Pack not found' };

  const removedIds:   string[] = [];
  const preservedIds: string[] = [];

  for (const id of entry.runbookIds) {
    const rb = store.getRunbook(id);
    // Preserve runbooks that the operator modified locally (version mismatch)
    if (rb && rb.version !== entry.version && rb.packId === packId) {
      // Detach from pack but keep the runbook
      store.saveRunbook({ ...rb, packId: undefined, packVersion: undefined });
      preservedIds.push(id);
    } else {
      if (store.deleteRunbook(id)) removedIds.push(id);
    }
  }

  store.deletePack(packId);
  return { removedIds, preservedIds };
}

// ── Rollback ──────────────────────────────────────────────────────────────────

/**
 * Restore the most recent previous version snapshot.
 * The current state is pushed onto previousVersions so re-rollback is possible.
 */
export function rollbackPack(
  packId:   string,
  store:    Store,
  actorId?: string,
): { restoredIds: string[]; version: string; error?: string } {
  const entry = store.getPack(packId);
  if (!entry) return { restoredIds: [], version: '', error: 'Pack not found' };

  const snap = entry.previousVersions?.[0];
  if (!snap) return { restoredIds: [], version: '', error: 'No rollback snapshot available' };

  const now = Date.now();
  const restoredIds: string[] = [];

  // ── Snapshot current state before overwriting ──────────────────────────────
  const currentSnap: PackVersionSnapshot = {
    version:     entry.version,
    installedAt: entry.installedAt,
    runbooks:    entry.runbookIds
      .map(id => store.getRunbook(id))
      .filter((r): r is RunbookDef => r !== null),
  };

  // ── Restore snapshot runbooks ─────────────────────────────────────────────
  for (const rb of snap.runbooks) {
    store.saveRunbook({
      ...rb,
      packVersion: snap.version,
      updatedAt:   now,
    });
    restoredIds.push(rb.id);
  }

  // ── Update registry ───────────────────────────────────────────────────────
  const updatedEntry: PackRegistryEntry = {
    ...entry,
    version:          snap.version,
    installedAt:      now,
    installedBy:      actorId,
    changelog:        `Rolled back from ${entry.version} to ${snap.version}`,
    previousVersions: [currentSnap, ...(entry.previousVersions ?? []).slice(1)].slice(0, 3),
  };
  store.savePack(updatedEntry);

  return { restoredIds, version: snap.version };
}
