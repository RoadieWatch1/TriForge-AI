/**
 * runbookPackSerializer.ts — Phase 35
 *
 * Build, serialize, and deserialize RunbookPacks for import/export.
 *
 * The serialization format is plain JSON so packs can be shared as files,
 * pasted into chat, or stored in a version control system.
 */

import type { RunbookDef } from './runbooks';
import {
  makePackId,
  type RunbookPack,
  type RunbookPackMeta,
} from './runbookPack';

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build a RunbookPack from one or more workspace runbook definitions.
 * Derived fields (requiredIntegrations, requiredVariables, incidentSupport)
 * are computed from the contained runbooks so the metadata stays accurate.
 */
export function buildPack(
  runbooks: RunbookDef[],
  meta:     Partial<RunbookPackMeta> & { name: string },
): RunbookPack {
  const now = Date.now();

  // Aggregate integrations across all runbooks, deduplicated
  const requiredIntegrations = Array.from(
    new Set(runbooks.flatMap(r => r.linkedIntegrations ?? [])),
  );

  // Aggregate declared variables across all runbooks, deduplicated by name
  const seenVarNames = new Set<string>();
  const requiredVariables: RunbookPackMeta['requiredVariables'] = [];
  for (const rb of runbooks) {
    for (const v of rb.variables ?? []) {
      if (!seenVarNames.has(v.name)) {
        seenVarNames.add(v.name);
        requiredVariables.push({
          name:        v.name,
          description: v.description,
          required:    v.required,
        });
      }
    }
  }

  // Strip workspace-local fields that should not travel with the pack
  const portableRunbooks: RunbookDef[] = runbooks.map(rb => ({
    ...rb,
    ownerDeviceId:          undefined,
    allowedRunnerDeviceIds: [],
  }));

  return {
    schemaVersion:        '35',
    id:                   meta.id            ?? makePackId(),
    name:                 meta.name,
    version:              meta.version        ?? '1.0.0',
    description:          meta.description    ?? '',
    author:               meta.author,
    source:               meta.source         ?? 'local',
    tags:                 meta.tags           ?? [],
    requiredIntegrations,
    requiredVariables,
    incidentSupport:      runbooks.some(r => r.incidentMode),
    createdAt:            meta.createdAt      ?? now,
    updatedAt:            now,
    changelog:            meta.changelog,
    runbooks:             portableRunbooks,
  };
}

// ── Serializer ────────────────────────────────────────────────────────────────

/** Serialise a pack to a pretty-printed JSON string for export / file download. */
export function serializePack(pack: RunbookPack): string {
  return JSON.stringify(pack, null, 2);
}

// ── Deserializer ──────────────────────────────────────────────────────────────

type DeserializeOk  = { pack: RunbookPack; error?: undefined };
type DeserializeFail = { pack?: undefined; error: string };

/**
 * Parse and validate a pack JSON string.
 * Returns the parsed pack on success, or a descriptive error string on failure.
 * Does NOT install anything — call installPack() after user confirmation.
 */
export function deserializePack(json: string): DeserializeOk | DeserializeFail {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e: unknown) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Pack must be a JSON object' };
  }

  const p = parsed as Record<string, unknown>;

  if (p.schemaVersion !== '35') {
    return {
      error: `Unsupported pack schema version: "${p.schemaVersion ?? 'missing'}". ` +
             'This workspace requires schemaVersion "35".',
    };
  }
  if (typeof p.id !== 'string' || !p.id.startsWith('pack_')) {
    return { error: 'Pack is missing a valid id field (expected "pack_…")' };
  }
  if (typeof p.name !== 'string' || !p.name.trim()) {
    return { error: 'Pack is missing a name' };
  }
  if (typeof p.version !== 'string' || !p.version.trim()) {
    return { error: 'Pack is missing a version' };
  }
  if (!Array.isArray(p.runbooks) || p.runbooks.length === 0) {
    return { error: 'Pack must contain at least one runbook' };
  }

  // Validate each runbook has the minimum required fields
  for (const rb of p.runbooks as Record<string, unknown>[]) {
    if (typeof rb.id !== 'string' || !rb.id) {
      return { error: 'A runbook inside the pack is missing an id' };
    }
    if (typeof rb.title !== 'string' || !rb.title) {
      return { error: `Runbook "${rb.id}" is missing a title` };
    }
    if (!Array.isArray(rb.steps)) {
      return { error: `Runbook "${rb.id}" is missing a steps array` };
    }
  }

  return { pack: parsed as RunbookPack };
}
