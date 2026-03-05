// ── CapabilityResolver.ts — Resolve capabilities for a given blueprint ─────────

import { CAPABILITY_MATRIX } from './CapabilityMatrix';
import type { Capability, ResolvedCapabilities } from './CapabilityTypes';

/**
 * Returns all capabilities that apply to the given blueprint ID.
 * Used by applyBlueprint() to determine which engines activate.
 */
export function resolveCapabilities(blueprintId: string): Capability[] {
  return CAPABILITY_MATRIX.filter(c => c.professions.includes(blueprintId));
}

/**
 * Returns a structured resolution result including a deduplicated engine list.
 */
export function resolveCapabilitiesFull(blueprintId: string): ResolvedCapabilities {
  const capabilities = resolveCapabilities(blueprintId);
  const engines = [...new Set(capabilities.map(c => c.engine))];
  return { blueprintId, capabilities, engines };
}

/**
 * Returns true if the given blueprint has the specified capability.
 */
export function hasCapabilityForBlueprint(blueprintId: string, capabilityId: string): boolean {
  return CAPABILITY_MATRIX.some(
    c => c.id === capabilityId && c.professions.includes(blueprintId),
  );
}

/**
 * Returns all blueprints that share the given capability.
 */
export function getBlueprintsForCapability(capabilityId: string): string[] {
  return CAPABILITY_MATRIX
    .filter(c => c.id === capabilityId)
    .flatMap(c => c.professions);
}
