/**
 * workspaceAutomationGate.ts — Phase 30
 *
 * Evaluates whether a device/actor is permitted to run, edit, or schedule
 * a workspace recipe, based on:
 *   1. The workspace-level automation policy (global defaults)
 *   2. The per-recipe policy (overrides globals where set)
 *   3. The actor's workspace role (via WORKSPACE_ROLE_RANK)
 *   4. Delegated operator assignments (fine-grained overrides per device)
 *
 * Resolution order for canRunRecipe:
 *   isAdmin → allowed unconditionally
 *   recipe not found in policy → fall through to workspace-level policy
 *   recipe disabled → blocked
 *   remote run + allowRemoteRun=false → blocked
 *   actor not in allowedRunnerDeviceIds (if non-empty) → blocked
 *   actor role rank < minRunnerRole rank → blocked
 *   delegated automation_operator / operator → always passes role check
 */

import type { Store } from './store';
import type { WorkspaceRecipePolicy, DelegatedOperator } from './store';
import { WORKSPACE_ROLE_RANK } from './dispatchServer';

// ── Result type ───────────────────────────────────────────────────────────────

export interface AutomationGateResult {
  allowed:               boolean;
  requiresDesktopConfirm:boolean;
  reason:                string;
  blockedBy?:            'policy_disabled' | 'remote_not_allowed' | 'role_insufficient' | 'device_not_listed' | 'risk_ceiling' | 'no_workspace';
  actorRole?:            string | null;
  delegationType?:       string | null;
  effectivePolicy:       'recipe' | 'workspace' | 'admin';
}

// ── Gate class ────────────────────────────────────────────────────────────────

export class WorkspaceAutomationGate {
  constructor(private store: Store) {}

  /** Resolve a delegated operator record for a device, if one exists and is not expired. */
  resolveDelegated(deviceId: string): DelegatedOperator | null {
    const now = Date.now();
    return (
      this.store.getDelegatedOperators().find(
        o => o.deviceId === deviceId && (!o.expiresAt || o.expiresAt > now),
      ) ?? null
    );
  }

  /** Check whether a device may run a specific recipe. */
  canRunRecipe(
    deviceId: string | null,
    recipeId:  string,
    isAdmin:   boolean,
    isRemote:  boolean,
  ): AutomationGateResult {
    if (isAdmin) {
      return {
        allowed: true,
        requiresDesktopConfirm: false,
        reason: 'Desktop admin always permitted',
        effectivePolicy: 'admin',
        actorRole: 'owner',
      };
    }

    const ws = this.store.getWorkspace();
    if (!ws) {
      return {
        allowed: false,
        requiresDesktopConfirm: false,
        reason: 'No workspace configured',
        blockedBy: 'no_workspace',
        effectivePolicy: 'workspace',
      };
    }

    const globalPolicy  = this.store.getWorkspaceAutomationPolicy();
    const recipePolicy  = this.store.getRecipePolicy(recipeId);
    const delegated     = deviceId ? this.resolveDelegated(deviceId) : null;

    // Resolve actor's workspace role
    const actorRole: string | null =
      ws.ownerId === deviceId
        ? 'owner'
        : (ws.members.find((m: { deviceId: string }) => m.deviceId === deviceId)?.role ?? null);

    // ── Effective per-recipe policy ───────────────────────────────────────────
    if (recipePolicy) {
      if (!recipePolicy.enabled) {
        return {
          allowed: false,
          requiresDesktopConfirm: false,
          reason: `Recipe '${recipeId}' is disabled by workspace policy`,
          blockedBy: 'policy_disabled',
          effectivePolicy: 'recipe',
          actorRole,
        };
      }

      if (isRemote && !recipePolicy.allowRemoteRun) {
        return {
          allowed: false,
          requiresDesktopConfirm: false,
          reason: `Recipe '${recipeId}' does not allow remote execution`,
          blockedBy: 'remote_not_allowed',
          effectivePolicy: 'recipe',
          actorRole,
        };
      }

      // Allowlist: if non-empty, device must be in it (delegated operator counts too)
      if (recipePolicy.allowedRunnerDeviceIds.length > 0 && deviceId) {
        const inList = recipePolicy.allowedRunnerDeviceIds.includes(deviceId);
        const delegatedForRecipe =
          delegated &&
          (delegated.delegationType === 'automation_operator' || delegated.delegationType === 'operator') &&
          (!delegated.recipeIds || delegated.recipeIds.includes(recipeId));
        if (!inList && !delegatedForRecipe) {
          return {
            allowed: false,
            requiresDesktopConfirm: false,
            reason: `Device '${deviceId}' is not in the allowed runner list for recipe '${recipeId}'`,
            blockedBy: 'device_not_listed',
            effectivePolicy: 'recipe',
            actorRole,
            delegationType: delegated?.delegationType ?? null,
          };
        }
      }

      // Role check against recipe minRunnerRole (first in allowedRunnerRoles, or fall back to workspace global)
      const minRole = recipePolicy.allowedRunnerRoles[0] ?? globalPolicy.minRunnerRole;
      const allowed = this._roleAllowed(actorRole, minRole, delegated, recipeId);
      return {
        allowed,
        requiresDesktopConfirm: recipePolicy.requireDesktopConfirm,
        reason: allowed
          ? `Actor meets recipe runner requirement '${minRole}'`
          : `Actor role '${actorRole ?? 'none'}' insufficient — need '${minRole}' for recipe '${recipeId}'`,
        blockedBy: allowed ? undefined : 'role_insufficient',
        effectivePolicy: 'recipe',
        actorRole,
        delegationType: delegated?.delegationType ?? null,
      };
    }

    // ── Workspace-level fallback ──────────────────────────────────────────────
    if (isRemote && !globalPolicy.allowRemoteRunDefault) {
      return {
        allowed: false,
        requiresDesktopConfirm: false,
        reason: 'Workspace policy does not allow remote recipe execution by default',
        blockedBy: 'remote_not_allowed',
        effectivePolicy: 'workspace',
        actorRole,
      };
    }

    const allowed = this._roleAllowed(actorRole, globalPolicy.minRunnerRole, delegated, recipeId);
    return {
      allowed,
      requiresDesktopConfirm: globalPolicy.requireDesktopConfirmDefault,
      reason: allowed
        ? `Actor meets workspace runner requirement '${globalPolicy.minRunnerRole}'`
        : `Actor role '${actorRole ?? 'none'}' insufficient — need '${globalPolicy.minRunnerRole}'`,
      blockedBy: allowed ? undefined : 'role_insufficient',
      effectivePolicy: 'workspace',
      actorRole,
      delegationType: delegated?.delegationType ?? null,
    };
  }

  /** Check whether a device may edit a recipe's policy or params. */
  canEditRecipe(deviceId: string | null, recipeId: string, isAdmin: boolean): AutomationGateResult {
    if (isAdmin) {
      return { allowed: true, requiresDesktopConfirm: false, reason: 'Desktop admin', effectivePolicy: 'admin' };
    }
    const ws = this.store.getWorkspace();
    if (!ws) {
      return { allowed: false, requiresDesktopConfirm: false, reason: 'No workspace', blockedBy: 'no_workspace', effectivePolicy: 'workspace' };
    }
    const recipePolicy = this.store.getRecipePolicy(recipeId);
    if (recipePolicy?.ownerDeviceId && recipePolicy.ownerDeviceId !== deviceId) {
      const isEditor = recipePolicy.editorDeviceIds.includes(deviceId ?? '');
      if (!isEditor) {
        // Fall through to role check — admins/owners always pass
        const actorRole: string | null =
          ws.ownerId === deviceId
            ? 'owner'
            : (ws.members.find((m: { deviceId: string }) => m.deviceId === deviceId)?.role ?? null);
        const allowed = this._roleAllowed(actorRole, 'admin', null, recipeId);
        return {
          allowed,
          requiresDesktopConfirm: false,
          reason: allowed
            ? `Role '${actorRole}' can edit recipes`
            : `Only the owner, listed editors, or admins can edit recipe '${recipeId}'`,
          blockedBy: allowed ? undefined : 'role_insufficient',
          effectivePolicy: 'recipe',
          actorRole,
        };
      }
    }
    return { allowed: true, requiresDesktopConfirm: false, reason: 'Editor or owner', effectivePolicy: 'recipe' };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private _roleAllowed(
    actorRole:  string | null,
    minRole:    string,
    delegated:  DelegatedOperator | null,
    recipeId:   string,
  ): boolean {
    // Delegated automation_operator or operator always passes
    if (delegated) {
      const dt = delegated.delegationType;
      if (dt === 'automation_operator' || dt === 'operator') {
        const scopeOk = !delegated.recipeIds || delegated.recipeIds.includes(recipeId);
        if (scopeOk) return true;
      }
    }
    if (!actorRole) return false;
    const actorRank = WORKSPACE_ROLE_RANK[actorRole as keyof typeof WORKSPACE_ROLE_RANK] ?? 0;
    const minRank   = WORKSPACE_ROLE_RANK[minRole   as keyof typeof WORKSPACE_ROLE_RANK] ?? 999;
    return actorRank >= minRank;
  }
}
