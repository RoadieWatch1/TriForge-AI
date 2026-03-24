/**
 * runbookPack.ts — Phase 35 / 36
 *
 * Runbook Pack — portable bundle format for import/export/versioning/trust.
 *
 * A RunbookPack is a self-contained JSON document that can be exported from
 * any workspace and installed into another.  The pack registry (wsPacks) is
 * the per-workspace record of what has been installed and from which version,
 * enabling update detection and rollback.
 *
 * Pack lifecycle:
 *   1. Author builds pack from local runbooks (buildPack in serializer)
 *   2. JSON is shared externally (copy/paste, file, URL)
 *   3. Recipient previews (previewPack)  →  sees runbooks, integrations, risk
 *   4. Recipient confirms  →  installPack writes runbooks + registry entry
 *   5. New pack version arrives  →  installPack again (upsert + snapshot old)
 *   6. Rollback restores from PackVersionSnapshot
 *
 * Store key: 'wsPacks'  →  PackRegistryEntry[]
 */

import * as crypto from 'crypto';
import type { RunbookDef } from './runbooks';

// ── Identifier helper ─────────────────────────────────────────────────────────

export function makePackId(): string {
  return 'pack_' + crypto.randomBytes(8).toString('hex');
}

// ── Pack wire format ──────────────────────────────────────────────────────────

/** Metadata present on both the wire format and the registry entry. */
export interface RunbookPackMeta {
  id:                   string;   // pack_xxxxxxxxxxxxxxxx
  name:                 string;
  version:              string;   // semver: '1.0.0'
  description:          string;
  author?:              string;
  source?:              string;   // URL or 'local'
  tags?:                string[];
  requiredIntegrations: string[]; // 'slack'|'jira'|'linear'|'github'|'push'
  requiredVariables:    Array<{ name: string; description?: string; required: boolean }>;
  incidentSupport:      boolean;  // any contained runbook has incidentMode === true
  createdAt:            number;
  updatedAt:            number;
  changelog?:           string;   // plain-text release notes for this version
}

/** Fully serialisable pack ready for JSON export / import. */
export interface RunbookPack extends RunbookPackMeta {
  runbooks:      RunbookDef[];
  schemaVersion: '35';            // sentinel — reject packs from unknown versions
  signature?:    PackSignature;   // Phase 36 — optional ed25519 signature block
}

// ── Phase 36: Signing ─────────────────────────────────────────────────────────

/** Ed25519 signature block attached to a RunbookPack. */
export interface PackSignature {
  algorithm:   'ed25519';
  keyId:       string;        // first-16-hex of SHA-256 over SPKI DER public key
  signerName:  string;
  signerEmail?: string;
  signedAt:    number;
  signature:   string;        // base64-encoded signature over canonical pack JSON
}

/** A signer key trusted by this workspace. */
export interface TrustedSigner {
  keyId:        string;
  name:         string;
  email?:       string;
  publicKeyPem: string;       // SPKI PEM format
  addedAt:      number;
  addedBy?:     string;       // actorId
  revoked:      boolean;
}

/** Workspace-level pack trust policy. */
export interface PackTrustPolicy {
  allowUnsigned:              boolean;  // default true — set false to block unsigned packs
  allowUnknownSigners:        boolean;  // default true — set false to block unknown signers
  requireAdminApprovalForInstall: boolean;  // block all installs until admin approves
  requireConfirmOnRiskIncrease:   boolean;  // show confirm dialog when risk increases
  blockNewDestinations:       boolean;  // block updates that add new output destinations
}

export const DEFAULT_PACK_TRUST_POLICY: PackTrustPolicy = {
  allowUnsigned:                  true,
  allowUnknownSigners:            true,
  requireAdminApprovalForInstall: false,
  requireConfirmOnRiskIncrease:   false,
  blockNewDestinations:           false,
};

/** Overall trust verdict for a pack at import/update time. */
export type PackTrustStatus =
  | 'unsigned'        // no signature block present
  | 'trusted'         // valid sig from a trusted, non-revoked signer
  | 'unknown_signer'  // sig present but keyId not in trusted list
  | 'revoked'         // signer key has been revoked
  | 'invalid';        // signature present but verification failed

export interface PackTrustVerification {
  status:      PackTrustStatus;
  keyId?:      string;
  signerName?: string;
  signedAt?:   number;
  error?:      string;
}

// ── Phase 36: Diff model ──────────────────────────────────────────────────────

export interface RunbookStepDiff {
  added:    number;
  removed:  number;
  modified: number;
}

export interface RunbookDiff {
  id:                  string;
  title:               string;
  steps:               RunbookStepDiff;
  integrationsAdded:   string[];
  integrationsRemoved: string[];
  incidentModeChanged: boolean;
  isNew:               boolean;   // runbook not previously installed
  isRemoved:           boolean;   // runbook in current pack but not in incoming version
}

export interface PackDiff {
  runbooks:            RunbookDiff[];
  integrationsAdded:   string[];
  integrationsRemoved: string[];
  variablesAdded:      string[];
  variablesRemoved:    string[];
  destinationsAdded:   string[];  // step types newly introduced (slack / jira / etc.)
  riskIncreased:       boolean;
  incidentModeChanged: boolean;
  totalStepDelta:      number;
  isEmpty:             boolean;   // no material changes detected
}

// ── Registry (per-workspace, stored in wsPacks) ───────────────────────────────

/** Point-in-time snapshot of a pack version, stored for rollback. */
export interface PackVersionSnapshot {
  version:     string;
  installedAt: number;
  runbooks:    RunbookDef[];  // full runbook defs at that version
}

/** One installed pack in the workspace pack registry. */
export interface PackRegistryEntry {
  packId:               string;
  name:                 string;
  version:              string;
  description:          string;
  installedAt:          number;
  installedBy?:         string;           // actorId
  runbookIds:           string[];         // workspace runbook IDs owned by this pack
  source?:              string;
  enabled:              boolean;
  requiredIntegrations: string[];
  changelog?:           string;
  previousVersions:     PackVersionSnapshot[];  // last 3 versions kept for rollback
  // Phase 36 — trust provenance
  trustStatus:          PackTrustStatus;
  signer?:              string;           // keyId of verified signer
  signerName?:          string;
  verifiedAt?:          number;
  importSource?:        string;           // 'local' | 'url' | 'dispatch'
}

// ── Preview model (shown before install) ─────────────────────────────────────

/** Per-runbook summary shown in the install preview. */
export interface PackRunbookPreview {
  id:                 string;
  title:              string;
  stepCount:          number;
  isUpdate:           boolean;   // existing runbook with same id found in workspace
  currentVersion?:    string;    // version on the existing runbook
  hasIncidentMode:    boolean;
  linkedIntegrations: string[];
}

/** Full preview object returned by previewPack — shown to user before commit. */
export interface PackInstallPreview {
  pack:                 RunbookPackMeta;
  runbooks:             PackRunbookPreview[];
  requiredIntegrations: string[];
  missingIntegrations:  string[];
  requiredVariables:    Array<{ name: string; required: boolean; description?: string }>;
  riskSummary:          string;
  isUpdate:             boolean;        // pack already installed in this workspace
  existingVersion?:     string;
  canRollback:          boolean;        // previous version snapshot available
  // Phase 36 — trust + diff
  trust:                PackTrustVerification;
  diff?:                PackDiff;       // only present when isUpdate === true
  policyBlocked:        boolean;
  policyBlockReason?:   string;
  confirmReasons:       string[];       // soft warnings requiring user acknowledgement
}
