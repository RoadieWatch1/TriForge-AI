/**
 * migrationEngine.ts — Phase 40
 *
 * Versioned schema migrations for the TriForge store.
 *
 * Each migration is identified by a monotonically-increasing integer version.
 * The current schema version is persisted in store.kv under 'schemaVersion'.
 * On startup, runMigrations() runs any pending migrations in order, logging
 * each result to 'migrationHistory' in the kv store.
 *
 * Migrations are designed to be additive and safe. Destructive changes should
 * be preceded by a snapshot (backupEngine.createSnapshot).
 */

import type { Store } from './store';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MigrationDef {
  version:     number;     // must be unique and monotonically increasing
  name:        string;     // short identifier, e.g. 'add_dispatch_public_url'
  description: string;
  reversible:  boolean;
  up:   (store: Store) => void | Promise<void>;
  down?: (store: Store) => void | Promise<void>;
}

export interface MigrationRecord {
  version:   number;
  name:      string;
  appliedAt: number;
  success:   boolean;
  error?:    string;
}

const SCHEMA_VERSION_KEY  = 'schemaVersion';
const MIGRATION_HIST_KEY  = 'migrationHistory';

// ── Migration registry ────────────────────────────────────────────────────────
// Add new migrations at the end. Never change existing version numbers.

const MIGRATIONS: MigrationDef[] = [

  // v1 — Ensure all DEFAULT_PERMISSIONS keys exist (previously done inline in init())
  {
    version:     1,
    name:        'seed_default_permissions',
    description: 'Ensure all default permission keys are present with correct defaults',
    reversible:  false,
    up: (store) => {
      const { DEFAULT_PERMISSIONS } = require('./store');
      const existing = store.getPermissions();
      const existingKeys = new Set(existing.map((p: any) => p.key));
      for (const def of DEFAULT_PERMISSIONS) {
        if (!existingKeys.has(def.key)) {
          store.setPermission(def.key, false, def.budgetLimit);
        }
      }
    },
  },

  // v2 — Initialize dispatch network mode if unset
  {
    version:     2,
    name:        'init_dispatch_network_mode',
    description: 'Set dispatch network mode default to "lan" if not yet configured',
    reversible:  false,
    up: (store) => {
      const current = store.getDispatchNetworkMode();
      if (!current || !['local', 'lan', 'remote'].includes(current)) {
        store.setDispatchNetworkMode('lan');
      }
    },
  },

  // v3 — Initialize dispatch session TTL if unset
  {
    version:     3,
    name:        'init_dispatch_session_ttl',
    description: 'Set dispatch session TTL to 7-day default if not configured',
    reversible:  false,
    up: (store) => {
      const current = store.getDispatchSessionTtlMinutes();
      if (!current || current <= 0) {
        store.setDispatchSessionTtlMinutes(10080); // 7 days
      }
    },
  },

  // v4 — Ensure pack trust policy exists
  {
    version:     4,
    name:        'init_pack_trust_policy',
    description: 'Set default pack trust policy if none exists',
    reversible:  false,
    up: (store) => {
      const policy = store.getPackTrustPolicy();
      if (!policy || typeof policy !== 'object') {
        store.setPackTrustPolicy({
          allowUnsigned:                  true,
          allowUnknownSigners:            true,
          requireAdminApprovalForInstall: false,
          requireConfirmOnRiskIncrease:   false,
          blockNewDestinations:           false,
        });
      }
    },
  },

  // v5 — Ensure shared context object exists with correct shape
  {
    version:     5,
    name:        'init_shared_context',
    description: 'Initialize shared context with empty object if missing',
    reversible:  false,
    up: (store) => {
      const ctx = store.getSharedContext();
      if (!ctx || typeof ctx !== 'object') {
        const { EMPTY_SHARED_CONTEXT } = require('./sharedContext');
        store.setSharedContext(EMPTY_SHARED_CONTEXT);
      }
    },
  },

  // v6 — Ensure trading operation mode is a valid value
  {
    version:     6,
    name:        'normalize_trading_mode',
    description: 'Reset trading operation mode to "shadow" if set to an invalid value',
    reversible:  false,
    up: (store) => {
      const mode = store.getTradingOperationMode();
      if (!['shadow', 'paper', 'live'].includes(mode)) {
        store.setTradingOperationMode('shadow');
      }
    },
  },

  // v7 — Prune runbook executions over the cap of 200
  {
    version:     7,
    name:        'prune_runbook_executions',
    description: 'Trim runbook execution history to 200 entries to reclaim store space',
    reversible:  false,
    up: (store) => {
      // store.getRunbookExecutions already caps at given limit — just re-save
      const all = store.getRunbookExecutions(200);
      store.update('wsRunbookExecutions', all);
    },
  },

  // v8 — Add wizard:role default if missing (Phase 39 compat)
  {
    version:     8,
    name:        'init_wizard_role',
    description: 'Initialize wizard role to "solo" for existing users who skipped setup wizard',
    reversible:  false,
    up: (store) => {
      const current = store.get<string>('wizard:role', '');
      if (!current) store.update('wizard:role', 'solo');
    },
  },

];

// ── Engine ────────────────────────────────────────────────────────────────────

export function getCurrentSchemaVersion(store: Store): number {
  return store.get<number>(SCHEMA_VERSION_KEY, 0);
}

export function getMigrationHistory(store: Store): MigrationRecord[] {
  return store.get<MigrationRecord[]>(MIGRATION_HIST_KEY, []);
}

/** Run all pending migrations in version order. Called once at startup. */
export async function runMigrations(store: Store): Promise<{
  ran:    number;
  errors: string[];
}> {
  const current = getCurrentSchemaVersion(store);
  const target  = Math.max(...MIGRATIONS.map(m => m.version));

  if (current >= target) return { ran: 0, errors: [] };

  const pending = MIGRATIONS
    .filter(m => m.version > current)
    .sort((a, b) => a.version - b.version);

  const history  = getMigrationHistory(store);
  let   newVersion = current;
  const errors: string[] = [];

  for (const migration of pending) {
    const record: MigrationRecord = {
      version:   migration.version,
      name:      migration.name,
      appliedAt: Date.now(),
      success:   false,
    };

    try {
      await migration.up(store);
      record.success = true;
      newVersion     = migration.version;
      console.log(`[Migration] v${migration.version} "${migration.name}" applied`);
    } catch (e) {
      record.error = String(e);
      errors.push(`v${migration.version} "${migration.name}": ${String(e)}`);
      console.error(`[Migration] v${migration.version} "${migration.name}" failed:`, e);
      // Abort remaining migrations on failure
      history.unshift(record);
      store.update(MIGRATION_HIST_KEY, history.slice(0, 50));
      store.update(SCHEMA_VERSION_KEY, newVersion);
      return { ran: pending.indexOf(migration), errors };
    }

    history.unshift(record);
  }

  // Cap history at 50 entries
  store.update(MIGRATION_HIST_KEY, history.slice(0, 50));
  store.update(SCHEMA_VERSION_KEY, newVersion);

  return { ran: pending.length, errors };
}

/** Reverse a specific migration. Only possible if migration.reversible = true and has .down(). */
export async function revertMigration(store: Store, version: number): Promise<{ ok: boolean; error?: string }> {
  const migration = MIGRATIONS.find(m => m.version === version);
  if (!migration)        return { ok: false, error: `Migration v${version} not found` };
  if (!migration.reversible || !migration.down) {
    return { ok: false, error: `Migration v${version} is not reversible` };
  }
  try {
    await migration.down(store);
    const history = getMigrationHistory(store);
    history.unshift({
      version:   migration.version,
      name:      `revert:${migration.name}`,
      appliedAt: Date.now(),
      success:   true,
    });
    store.update(MIGRATION_HIST_KEY, history.slice(0, 50));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
