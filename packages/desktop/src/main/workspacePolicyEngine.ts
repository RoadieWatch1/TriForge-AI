/**
 * workspacePolicyEngine.ts — Phase 29
 *
 * Workspace approval matrix: per-action-category rules that define
 * who can approve what and whether desktop confirmation is required.
 *
 * Resolution order:
 *   1. Find rule matching the action category
 *   2. Fall through to 'default' rule if no exact match
 *   3. Check actor's workspace role against minApproverRole
 *   4. Desktop admin (isAdmin=true) always passes
 */

import type { Store } from './store';
import { WORKSPACE_ROLE_RANK } from './dispatchServer';
import type { WorkspaceRole } from './dispatchServer';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionCategory =
  | 'github:comment'
  | 'github:review'
  | 'github:issue'
  | 'jira:write'
  | 'jira:transition'
  | 'linear:write'
  | 'slack:send'
  | 'dispatch:remote_approve'
  | 'bundle:send'
  | 'artifact:send'
  | 'recipe:run'
  | 'destructive'
  | 'default';

export interface WorkspaceApprovalRule {
  category:              ActionCategory;
  minApproverRole:       WorkspaceRole;
  requireDesktopConfirm: boolean;
  maxRemoteRisk?:        'low' | 'medium' | 'high' | 'none';  // for remote dispatch
  enabled:               boolean;
}

export const DEFAULT_APPROVAL_MATRIX: WorkspaceApprovalRule[] = [
  { category: 'github:comment',          minApproverRole: 'reviewer',  requireDesktopConfirm: false, enabled: true },
  { category: 'github:review',           minApproverRole: 'reviewer',  requireDesktopConfirm: false, enabled: true },
  { category: 'github:issue',            minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
  { category: 'jira:write',             minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
  { category: 'jira:transition',        minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
  { category: 'linear:write',           minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
  { category: 'slack:send',             minApproverRole: 'reviewer',  requireDesktopConfirm: false, enabled: true },
  { category: 'dispatch:remote_approve',minApproverRole: 'operator',  requireDesktopConfirm: false, maxRemoteRisk: 'medium', enabled: true },
  { category: 'bundle:send',            minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
  { category: 'artifact:send',          minApproverRole: 'reviewer',  requireDesktopConfirm: false, enabled: true },
  { category: 'recipe:run',             minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
  { category: 'destructive',            minApproverRole: 'admin',     requireDesktopConfirm: true,  enabled: true },
  { category: 'default',               minApproverRole: 'operator',  requireDesktopConfirm: false, enabled: true },
];

// ── Resolution result ─────────────────────────────────────────────────────────

export interface PolicyCheckResult {
  allowed:               boolean;
  requiresDesktopConfirm:boolean;
  reason:                string;
  rule:                  WorkspaceApprovalRule;
  actorRole:             WorkspaceRole | null;
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class WorkspacePolicyEngine {
  constructor(private store: Store) {}

  /** Returns the effective matrix (stored or default). */
  getMatrix(): WorkspaceApprovalRule[] {
    return this.store.getApprovalMatrix() ?? DEFAULT_APPROVAL_MATRIX;
  }

  /** Returns the approval rule for a given action category. Falls through to 'default'. */
  getRule(category: ActionCategory): WorkspaceApprovalRule {
    const matrix = this.getMatrix();
    return (
      matrix.find(r => r.category === category && r.enabled) ??
      matrix.find(r => r.category === 'default' && r.enabled) ??
      DEFAULT_APPROVAL_MATRIX.find(r => r.category === 'default')!
    );
  }

  /** Check whether a remote device actor is allowed to perform an action in a category. */
  canApprove(deviceId: string | null, category: ActionCategory, isAdmin: boolean): PolicyCheckResult {
    const rule = this.getRule(category);
    if (isAdmin) {
      return { allowed: true, requiresDesktopConfirm: rule.requireDesktopConfirm, reason: 'Desktop admin always permitted', rule, actorRole: 'owner' };
    }
    const ws = this.store.getWorkspace();
    if (!ws) {
      return { allowed: false, requiresDesktopConfirm: false, reason: 'No workspace configured', rule, actorRole: null };
    }
    const actorRole: WorkspaceRole | null =
      ws.ownerId === deviceId ? 'owner'
      : (ws.members.find(m => m.deviceId === deviceId)?.role ?? null);

    if (!actorRole) {
      return { allowed: false, requiresDesktopConfirm: false, reason: 'Device is not a workspace member', rule, actorRole: null };
    }
    const actorRank = WORKSPACE_ROLE_RANK[actorRole];
    const minRank   = WORKSPACE_ROLE_RANK[rule.minApproverRole];
    const allowed   = actorRank >= minRank;
    return {
      allowed,
      requiresDesktopConfirm: rule.requireDesktopConfirm,
      reason: allowed
        ? `Role '${actorRole}' meets requirement '${rule.minApproverRole}'`
        : `Role '${actorRole}' insufficient — need '${rule.minApproverRole}' or above`,
      rule,
      actorRole,
    };
  }

  /** Simulate: given a hypothetical role and category, what would the outcome be? */
  simulate(role: WorkspaceRole | null, category: ActionCategory): PolicyCheckResult {
    const rule = this.getRule(category);
    if (!role) {
      return { allowed: false, requiresDesktopConfirm: false, reason: 'No role specified', rule, actorRole: null };
    }
    const actorRank = WORKSPACE_ROLE_RANK[role];
    const minRank   = WORKSPACE_ROLE_RANK[rule.minApproverRole];
    const allowed   = actorRank >= minRank;
    return {
      allowed,
      requiresDesktopConfirm: rule.requireDesktopConfirm,
      reason: allowed
        ? `Role '${role}' is sufficient (need '${rule.minApproverRole}')`
        : `Role '${role}' is insufficient — need '${rule.minApproverRole}' or above`,
      rule,
      actorRole: role,
    };
  }
}

/** Map dispatch approval source string → ActionCategory */
export function categoryForSource(source: string): ActionCategory {
  switch (source) {
    case 'jira':     return 'jira:write';
    case 'linear':   return 'linear:write';
    case 'approval': return 'dispatch:remote_approve';
    case 'github':   return 'github:comment';
    case 'slack':    return 'slack:send';
    case 'recipe':   return 'recipe:run';
    default:         return 'default';
  }
}
