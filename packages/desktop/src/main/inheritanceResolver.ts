/**
 * inheritanceResolver.ts — Phase 38
 *
 * Resolves the effective policy for a workspace given the org defaults and the
 * workspace's own settings.
 *
 * Each field carries a `source` tag ('org' | 'workspace') so the UI can show
 * which fields are inherited vs locally overridden.  When a domain is enforced
 * by the org, all fields in that domain are locked and tagged 'org'.
 */

import type { OrgPolicy, OrgPackTrustDefaults, OrgIntegrationPolicy } from './orgConfig';
import type { PackTrustPolicy } from './runbookPack';

// ── Resolved types ────────────────────────────────────────────────────────────

export interface FieldResolution<T> {
  value:  T;
  source: 'org' | 'workspace';
  locked: boolean;  // true if org enforces this domain
}

export type ResolvedPackTrustPolicy = {
  [K in keyof PackTrustPolicy]: FieldResolution<boolean>;
} & { orgEnforced: boolean };

export interface ResolvedIntegrationPolicy {
  effectiveAllowed: string[];   // [] = all allowed
  effectiveBlocked: string[];
  orgEnforced:      boolean;
}

export interface ResolvedDispatchPolicy {
  maxRemoteRiskLevel:  FieldResolution<'low' | 'medium' | 'high'>;
  requireMFA:          FieldResolution<boolean>;
  allowPublicDispatch: FieldResolution<boolean>;
  orgEnforced:         boolean;
}

export interface ResolvedAutomationPolicy {
  allowRemoteRunDefault:     FieldResolution<boolean>;
  requireConfirmForHighRisk: FieldResolution<boolean>;
  orgEnforced:               boolean;
}

/** Full effective policy summary for the current workspace. */
export interface OrgEffectiveSummary {
  packTrust:            ResolvedPackTrustPolicy;
  integrations:         ResolvedIntegrationPolicy;
  dispatch:             ResolvedDispatchPolicy;
  automation:           ResolvedAutomationPolicy;
  canAddSigners:        boolean;  // false if org signers are enforced & WS signers blocked
  orgSignerCount:       number;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

/** Resolve pack trust policy — workspace can override unless org enforces. */
export function resolvePackTrustPolicy(
  org: OrgPackTrustDefaults,
  ws:  PackTrustPolicy,
): ResolvedPackTrustPolicy {
  const lock = org.enforced;
  const field = <T>(orgVal: T, wsVal: T): FieldResolution<T> => ({
    value:  lock ? orgVal : wsVal,
    source: lock ? 'org' : 'workspace',
    locked: lock,
  });

  return {
    allowUnsigned:                  field(org.allowUnsigned,                  ws.allowUnsigned),
    allowUnknownSigners:            field(org.allowUnknownSigners,            ws.allowUnknownSigners),
    requireAdminApprovalForInstall: field(org.requireAdminApprovalForInstall, ws.requireAdminApprovalForInstall),
    requireConfirmOnRiskIncrease:   field(org.requireConfirmOnRiskIncrease,   ws.requireConfirmOnRiskIncrease),
    blockNewDestinations:           field(org.blockNewDestinations,           ws.blockNewDestinations),
    orgEnforced: lock,
  };
}

/** Resolve integration policy — blocked list always applies when enforced. */
export function resolveIntegrationPolicy(org: OrgIntegrationPolicy): ResolvedIntegrationPolicy {
  if (!org.enforced) {
    return { effectiveAllowed: [], effectiveBlocked: [], orgEnforced: false };
  }
  const blocked = org.blockedIntegrations;
  const allowed = org.allowedIntegrations.length > 0
    ? org.allowedIntegrations.filter(i => !blocked.includes(i))
    : [];
  return { effectiveAllowed: allowed, effectiveBlocked: blocked, orgEnforced: true };
}

/** Build the complete effective summary for a workspace. */
export function resolveOrgEffective(
  orgPolicy: OrgPolicy,
  wsPackPolicy: PackTrustPolicy,
): OrgEffectiveSummary {
  const dLock = orgPolicy.dispatch.enforced;
  const aLock = orgPolicy.automation.enforced;

  const dField = <T>(orgVal: T, wsDefault: T): FieldResolution<T> => ({
    value: dLock ? orgVal : wsDefault, source: dLock ? 'org' : 'workspace', locked: dLock,
  });
  const aField = <T>(orgVal: T, wsDefault: T): FieldResolution<T> => ({
    value: aLock ? orgVal : wsDefault, source: aLock ? 'org' : 'workspace', locked: aLock,
  });

  return {
    packTrust:    resolvePackTrustPolicy(orgPolicy.packTrust, wsPackPolicy),
    integrations: resolveIntegrationPolicy(orgPolicy.integrations),
    dispatch: {
      maxRemoteRiskLevel:  dField(orgPolicy.dispatch.maxRemoteRiskLevel, orgPolicy.dispatch.maxRemoteRiskLevel),
      requireMFA:          dField(orgPolicy.dispatch.requireMFA, false),
      allowPublicDispatch: dField(orgPolicy.dispatch.allowPublicDispatch, true),
      orgEnforced:         dLock,
    },
    automation: {
      allowRemoteRunDefault:     aField(orgPolicy.automation.allowRemoteRunDefault, true),
      requireConfirmForHighRisk: aField(orgPolicy.automation.requireConfirmForHighRisk, false),
      orgEnforced: aLock,
    },
    canAddSigners:  orgPolicy.signers.enforced ? orgPolicy.signers.allowWorkspaceSigners : true,
    orgSignerCount: orgPolicy.signers.globalSigners.filter(s => !s.revoked).length,
  };
}
