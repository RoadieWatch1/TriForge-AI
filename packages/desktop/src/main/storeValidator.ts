/**
 * storeValidator.ts — Phase 40
 *
 * Validates the integrity of the TriForge store at startup and on demand.
 * Reports issues with severity + repairability. The repair pass fixes safe
 * defaults without touching secrets or user-authored data.
 */

import type { Store } from './store';
import { DEFAULT_PERMISSIONS } from './store';

export type IssueSeverity = 'error' | 'warn' | 'info';

export interface ValidationIssue {
  severity:   IssueSeverity;
  field:      string;
  message:    string;
  repairable: boolean;
}

export interface ValidationResult {
  valid:         boolean;    // true if no 'error' severity issues
  issues:        ValidationIssue[];
  checkedAt:     number;
  repairedCount: number;     // filled after repair pass
}

// ── Validators ────────────────────────────────────────────────────────────────

type Check = (store: Store, issues: ValidationIssue[]) => void | Promise<void>;

const checks: Check[] = [

  // ── Permissions ─────────────────────────────────────────────────────────────
  (store, issues) => {
    const perms = store.getPermissions();
    const keys  = new Set(perms.map(p => p.key));
    for (const def of DEFAULT_PERMISSIONS) {
      if (!keys.has(def.key)) {
        issues.push({
          severity:   'warn',
          field:      `permissions.${def.key}`,
          message:    `Permission "${def.key}" is missing — will be added with default (denied)`,
          repairable: true,
        });
      }
    }
    for (const p of perms) {
      if (typeof p.granted !== 'boolean') {
        issues.push({
          severity:   'error',
          field:      `permissions.${p.key}.granted`,
          message:    `Permission "${p.key}" has invalid granted value: ${JSON.stringify(p.granted)}`,
          repairable: true,
        });
      }
    }
  },

  // ── Auth ─────────────────────────────────────────────────────────────────────
  (store, issues) => {
    const auth = store.getAuth();
    if (auth.pinHash && !auth.salt) {
      issues.push({
        severity:   'error',
        field:      'auth.salt',
        message:    'Auth has pinHash but no salt — session lock will be broken',
        repairable: false,
      });
    }
    if (auth.pinHash && !auth.username) {
      issues.push({
        severity:   'warn',
        field:      'auth.username',
        message:    'Auth has pinHash but no username — lock screen will show empty username',
        repairable: false,
      });
    }
  },

  // ── License ───────────────────────────────────────────────────────────────────
  async (store, issues) => {
    try {
      const lic = await store.getLicense();
      if (lic.tier && !['free', 'pro', 'business'].includes(lic.tier)) {
        issues.push({
          severity:   'error',
          field:      'license.tier',
          message:    `Unknown license tier: "${lic.tier}" — will be treated as free`,
          repairable: true,
        });
      }
    } catch { /* license check best-effort */ }
  },

  // ── Runbooks ──────────────────────────────────────────────────────────────────
  (store, issues) => {
    const runbooks = store.getRunbooks();
    const ids = new Set<string>();
    for (const rb of runbooks) {
      if (!rb.id) {
        issues.push({ severity: 'error', field: 'runbooks', message: 'Runbook without id found — will cause lookup failures', repairable: false });
      } else if (ids.has(rb.id)) {
        issues.push({ severity: 'warn', field: `runbooks.${rb.id}`, message: `Duplicate runbook id "${rb.id}"`, repairable: false });
      }
      ids.add(rb.id);
      if (!rb.title) {
        issues.push({ severity: 'info', field: `runbooks.${rb.id}`, message: `Runbook "${rb.id}" has no title`, repairable: false });
      }
    }
  },

  // ── Pack registry ─────────────────────────────────────────────────────────────
  (store, issues) => {
    const packs = store.getPacks();
    for (const p of packs) {
      if (!p.packId) {
        issues.push({ severity: 'error', field: 'packs', message: 'Pack registry entry without packId', repairable: false });
      }
      if (!p.version) {
        issues.push({ severity: 'info', field: `packs.${p.packId}`, message: `Pack "${p.packId}" has no version recorded`, repairable: false });
      }
    }
  },

  // ── Trusted signers ───────────────────────────────────────────────────────────
  (store, issues) => {
    const signers = store.getTrustedSigners();
    const keyIds  = new Set<string>();
    for (const s of signers) {
      if (!s.keyId) {
        issues.push({ severity: 'error', field: 'trustedSigners', message: 'Trusted signer without keyId', repairable: false });
      } else if (keyIds.has(s.keyId)) {
        issues.push({ severity: 'warn', field: `trustedSigners.${s.keyId}`, message: `Duplicate trusted signer keyId "${s.keyId}"`, repairable: false });
      }
      keyIds.add(s.keyId);
    }
  },

  // ── Workspace ─────────────────────────────────────────────────────────────────
  (store, issues) => {
    const ws = store.getWorkspace();
    if (ws && typeof ws !== 'object') {
      issues.push({ severity: 'error', field: 'workspace', message: 'Workspace value is not an object', repairable: true });
    }
    if (ws && !(ws as any).id) {
      issues.push({ severity: 'warn', field: 'workspace.id', message: 'Workspace record is missing an id', repairable: false });
    }
  },

  // ── Dispatch ─────────────────────────────────────────────────────────────────
  (store, issues) => {
    const port = store.getDispatchPort();
    if (port < 1024 || port > 65535) {
      issues.push({ severity: 'warn', field: 'dispatch.port', message: `Dispatch port ${port} is outside the valid range 1024-65535`, repairable: true });
    }
  },

  // ── Shared context ────────────────────────────────────────────────────────────
  (store, issues) => {
    const ctx = store.getSharedContext();
    if (ctx && typeof ctx !== 'object') {
      issues.push({ severity: 'error', field: 'sharedContext', message: 'Shared context value is not an object', repairable: true });
    }
  },

  // ── Memory ────────────────────────────────────────────────────────────────────
  (store, issues) => {
    const mem = store.getMemory(200);
    const ids  = new Set<number>();
    for (const m of mem) {
      if (typeof m.id !== 'number') {
        issues.push({ severity: 'warn', field: 'memory', message: `Memory entry has non-numeric id: ${JSON.stringify(m.id)}`, repairable: false });
      } else if (ids.has(m.id)) {
        issues.push({ severity: 'info', field: `memory.${m.id}`, message: `Duplicate memory id ${m.id}`, repairable: false });
      }
      ids.add(m.id);
    }
  },

  // ── KV store types ────────────────────────────────────────────────────────────
  (store, issues) => {
    const mode = store.getTradingOperationMode();
    if (!['shadow', 'paper', 'live'].includes(mode)) {
      issues.push({ severity: 'warn', field: 'tradingOperationMode', message: `Unknown trading mode: "${mode}"`, repairable: true });
    }
  },
];

// ── Repair ────────────────────────────────────────────────────────────────────

/** Apply safe repairs for repairable issues. Returns the number of fixes applied. */
export function repairStore(store: Store, issues: ValidationIssue[]): number {
  let fixed = 0;
  const repairable = issues.filter(i => i.repairable);

  for (const issue of repairable) {
    try {
      if (issue.field.startsWith('permissions.') && issue.message.includes('missing')) {
        const key = issue.field.replace('permissions.', '');
        const def = DEFAULT_PERMISSIONS.find(p => p.key === key);
        if (def) {
          store.setPermission(key, false, def.budgetLimit);
          fixed++;
        }
      } else if (issue.field.startsWith('permissions.') && issue.message.includes('invalid granted')) {
        const parts = issue.field.split('.');
        if (parts.length >= 2) {
          store.setPermission(parts[1], false);
          fixed++;
        }
      } else if (issue.field === 'workspace' && issue.message.includes('not an object')) {
        store.setWorkspace(null);
        fixed++;
      } else if (issue.field === 'dispatch.port') {
        store.setDispatchPort(18790);
        fixed++;
      } else if (issue.field === 'sharedContext' && issue.message.includes('not an object')) {
        const { EMPTY_SHARED_CONTEXT } = require('./sharedContext');
        store.setSharedContext(EMPTY_SHARED_CONTEXT);
        fixed++;
      } else if (issue.field === 'tradingOperationMode') {
        store.setTradingOperationMode('shadow');
        fixed++;
      } else if (issue.field === 'license.tier') {
        // Cannot repair license tier safely without re-validating the license key
        // Just log — actual repair requires a network check
      }
    } catch { /* best effort */ }
  }

  return fixed;
}

// ── Public entry point ────────────────────────────────────────────────────────

/** Run all checks against the store. Does NOT write anything. */
export async function validateStore(store: Store): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  for (const check of checks) {
    try { await (check(store, issues) ?? Promise.resolve()); } catch (e) {
      issues.push({
        severity:   'warn',
        field:      'validator',
        message:    `Validator threw unexpectedly: ${String(e)}`,
        repairable: false,
      });
    }
  }

  return {
    valid:         !issues.some(i => i.severity === 'error'),
    issues,
    checkedAt:     Date.now(),
    repairedCount: 0,
  };
}

/** Validate then apply safe repairs. Returns the full result with repairedCount set. */
export async function validateAndRepairStore(store: Store): Promise<ValidationResult> {
  const result = await validateStore(store);
  result.repairedCount = repairStore(store, result.issues);
  // Re-run to confirm repairs closed the issues
  const after = await validateStore(store);
  after.repairedCount = result.repairedCount;
  return after;
}
