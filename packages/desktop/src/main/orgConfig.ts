/**
 * orgConfig.ts — Phase 38
 *
 * Organization-level configuration and policy inheritance model.
 *
 * The org layer sits above the workspace layer.  An org defines defaults
 * for every governed domain (pack trust, integrations, dispatch, automation,
 * signers, audit).  Each domain has an `enforced` flag:
 *
 *   enforced = false → workspaces inherit by default; can override
 *   enforced = true  → workspaces inherit; cannot override
 *
 * In Phase 38, a single desktop installation represents one org.  The org
 * record is future-proofed for multi-workspace federation (control plane
 * sync) but works standalone in the desktop app.
 *
 * Store keys:
 *   'orgConfig'  → OrgConfig
 *   'orgPolicy'  → OrgPolicy
 */

import crypto from 'crypto';

export function makeOrgId(): string {
  return 'org_' + crypto.randomBytes(6).toString('hex');
}

// ── Org identity ──────────────────────────────────────────────────────────────

export interface OrgConfig {
  id:          string;
  name:        string;
  plan:        'team' | 'enterprise';
  adminEmail?: string;
  description?: string;
  createdAt:   number;
  updatedAt:   number;
}

// ── Per-domain policy defaults ────────────────────────────────────────────────

/** Pack trust defaults for the org.  Mirrors PackTrustPolicy + enforced flag. */
export interface OrgPackTrustDefaults {
  allowUnsigned:                  boolean;
  allowUnknownSigners:            boolean;
  requireAdminApprovalForInstall: boolean;
  requireConfirmOnRiskIncrease:   boolean;
  blockNewDestinations:           boolean;
  enforced:                       boolean;  // true = workspaces cannot override
}

/** An org-level trusted signer that all workspaces inherit automatically. */
export interface OrgSignerEntry {
  keyId:        string;
  name:         string;
  email?:       string;
  publicKeyPem: string;
  addedAt:      number;
  addedBy?:     string;
  revoked:      boolean;
}

export interface OrgSignerPolicy {
  globalSigners:        OrgSignerEntry[];  // available to all workspaces
  allowWorkspaceSigners:boolean;           // can workspaces add local signers
  enforced:             boolean;           // if true: workspaces cannot add signers
}

export interface OrgIntegrationPolicy {
  allowedIntegrations: string[];  // [] = all allowed
  blockedIntegrations: string[];  // blocked for all workspaces
  enforced:            boolean;
}

export interface OrgDispatchPolicy {
  maxRemoteRiskLevel:  'low' | 'medium' | 'high';
  requireMFA:          boolean;
  allowPublicDispatch: boolean;
  enforced:            boolean;
}

export interface OrgAutomationPolicy {
  allowRemoteRunDefault:     boolean;
  requireConfirmForHighRisk: boolean;
  enforced:                  boolean;
}

export interface OrgAuditPolicy {
  retentionDays:     number;   // 30 | 90 | 365 | 0 = unlimited
  requireExportAuth: boolean;
}

/** Full org policy — one object per governed domain. */
export interface OrgPolicy {
  packTrust:    OrgPackTrustDefaults;
  signers:      OrgSignerPolicy;
  integrations: OrgIntegrationPolicy;
  dispatch:     OrgDispatchPolicy;
  automation:   OrgAutomationPolicy;
  audit:        OrgAuditPolicy;
}

export const DEFAULT_ORG_POLICY: OrgPolicy = {
  packTrust: {
    allowUnsigned:                  true,
    allowUnknownSigners:            true,
    requireAdminApprovalForInstall: false,
    requireConfirmOnRiskIncrease:   false,
    blockNewDestinations:           false,
    enforced:                       false,
  },
  signers: {
    globalSigners:         [],
    allowWorkspaceSigners: true,
    enforced:              false,
  },
  integrations: {
    allowedIntegrations: [],
    blockedIntegrations: [],
    enforced:            false,
  },
  dispatch: {
    maxRemoteRiskLevel:  'high',
    requireMFA:          false,
    allowPublicDispatch: true,
    enforced:            false,
  },
  automation: {
    allowRemoteRunDefault:     true,
    requireConfirmForHighRisk: false,
    enforced:                  false,
  },
  audit: {
    retentionDays:     90,
    requireExportAuth: false,
  },
};
