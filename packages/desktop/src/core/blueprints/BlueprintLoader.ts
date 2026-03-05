// ── BlueprintLoader.ts — Load and validate blueprint definitions ───────────────
//
// Blueprints are stored as JSON files in core/blueprints/definitions/.
// esbuild bundles require() calls at compile time, so JSON files are included
// in the final bundle without any fs.readFileSync calls (which break in packaged
// Electron when paths change).
//
// Usage:
//   const blueprint = BlueprintLoader.load('developer');
//   const all = BlueprintLoader.loadAll();

import type { TriForgeBlueprint, BlueprintId } from './BlueprintTypes';
import { isValidBlueprintId, BLUEPRINT_IDS } from './BlueprintRegistry';
import { DEFAULT_BLUEPRINT } from './defaultBlueprint';
import { createLogger } from '../logging/log';

const log = createLogger('BlueprintLoader');

// ── Required fields for validation ────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof TriForgeBlueprint)[] = [
  'id', 'name', 'description', 'version',
  'systemPromptAdditions', 'approvalStrictness',
  'activeSensors', 'workflows', 'enabledTools',
  'missionTemplates', 'memoryTags',
];

// ── Dynamic require map — esbuild resolves these at bundle time ────────────────
// Each entry is a lazy require so only the requested blueprint is loaded.

type BlueprintRequireFn = () => TriForgeBlueprint;

const DEFINITION_MAP: Partial<Record<BlueprintId, BlueprintRequireFn>> = {
  developer:         () => require('./definitions/developer.blueprint.json')         as TriForgeBlueprint,
  founder:           () => require('./definitions/founder.blueprint.json')           as TriForgeBlueprint,
  marketing:         () => require('./definitions/marketing.blueprint.json')         as TriForgeBlueprint,
  it:                () => require('./definitions/it.blueprint.json')                as TriForgeBlueprint,
  research:          () => require('./definitions/research.blueprint.json')          as TriForgeBlueprint,
  business:          () => require('./definitions/business.blueprint.json')          as TriForgeBlueprint,
  business_operator: () => require('./definitions/business_operator.blueprint.json') as TriForgeBlueprint,
  consultant:        () => require('./definitions/consultant.blueprint.json')        as TriForgeBlueprint,
  trader:            () => require('./definitions/trader.blueprint.json')            as TriForgeBlueprint,
  sales:             () => require('./definitions/sales.blueprint.json')             as TriForgeBlueprint,
  voice:             () => require('./definitions/voice.blueprint.json')             as TriForgeBlueprint,
  filmmaker:         () => require('./definitions/filmmaker.blueprint.json')         as TriForgeBlueprint,
  real_estate:       () => require('./definitions/real_estate.blueprint.json')       as TriForgeBlueprint,
  legal:             () => require('./definitions/legal.blueprint.json')             as TriForgeBlueprint,
  healthcare_admin:  () => require('./definitions/healthcare_admin.blueprint.json')  as TriForgeBlueprint,
  cybersecurity:     () => require('./definitions/cybersecurity.blueprint.json')     as TriForgeBlueprint,
  data_science:      () => require('./definitions/data_science.blueprint.json')      as TriForgeBlueprint,
  product_manager:   () => require('./definitions/product_manager.blueprint.json')   as TriForgeBlueprint,
  educator:          () => require('./definitions/educator.blueprint.json')          as TriForgeBlueprint,
  logistics:         () => require('./definitions/logistics.blueprint.json')         as TriForgeBlueprint,
  power_user:        () => require('./definitions/power_user.blueprint.json')        as TriForgeBlueprint,
};

// ── Cache — blueprints are immutable at runtime ────────────────────────────────

const cache = new Map<BlueprintId, TriForgeBlueprint>();

// ── Validation ─────────────────────────────────────────────────────────────────

function validate(raw: unknown, id: BlueprintId): TriForgeBlueprint | null {
  if (!raw || typeof raw !== 'object') {
    log.warn(`Blueprint "${id}" is not an object`);
    return null;
  }
  const obj = raw as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      log.warn(`Blueprint "${id}" missing required field: ${field}`);
      return null;
    }
  }

  if (!isValidBlueprintId(String(obj.id))) {
    log.warn(`Blueprint "${id}" has unrecognized id: ${String(obj.id)}`);
    return null;
  }

  if (obj.id !== id) {
    log.warn(`Blueprint file id "${String(obj.id)}" does not match requested id "${id}"`);
    // Allow it — id in file takes precedence, but log the mismatch.
  }

  return obj as unknown as TriForgeBlueprint;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const BlueprintLoader = {
  /**
   * Load a single blueprint by ID.
   * Falls back to DEFAULT_BLUEPRINT if the definition is missing or invalid.
   */
  load(id: BlueprintId): TriForgeBlueprint {
    if (cache.has(id)) return cache.get(id)!;

    const requireFn = DEFINITION_MAP[id];
    if (!requireFn) {
      log.warn(`No definition file registered for blueprint "${id}" — using default`);
      return DEFAULT_BLUEPRINT;
    }

    let raw: unknown;
    try {
      raw = requireFn();
    } catch (err) {
      log.warn(`Failed to load blueprint "${id}":`, err);
      return DEFAULT_BLUEPRINT;
    }

    const validated = validate(raw, id);
    if (!validated) {
      log.warn(`Blueprint "${id}" failed validation — using default`);
      return DEFAULT_BLUEPRINT;
    }

    cache.set(id, validated);
    return validated;
  },

  /**
   * Load all registered blueprints.
   * Blueprints that fail to load are omitted (no fallback in loadAll).
   */
  loadAll(): TriForgeBlueprint[] {
    return BLUEPRINT_IDS.flatMap(id => {
      try {
        const bp = BlueprintLoader.load(id);
        return bp === DEFAULT_BLUEPRINT ? [] : [bp];
      } catch {
        return [];
      }
    });
  },

  /** Clear the cache — useful in tests. */
  clearCache(): void {
    cache.clear();
  },
};
