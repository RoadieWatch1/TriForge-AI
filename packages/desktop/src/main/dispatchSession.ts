/**
 * dispatchSession.ts — TriForge Dispatch Session & Pairing Layer (Phase 18)
 *
 * Pure module: no side effects, no imports from ipc.ts.
 * Handles device identity, session tokens, pairing codes, and approve policy.
 *
 * Auth model:
 *   Pairing code (6-digit, 10 min TTL, single-use)
 *     → POST /dispatch/pair → session token (per-device, short-lived)
 *   Master token (admin only, never transmitted in normal use)
 *     → still accepted on all endpoints for backward-compat / quick testing
 */

import * as crypto from 'crypto';

// ── Types ───────────────────────────────────────────────────────────────────────

/** A device that has been paired with the Dispatch server. */
export interface PairedDevice {
  id:              string;   // 12-char random ID
  label:           string;   // user-supplied name, e.g. "John's iPhone"
  pairedAt:        number;
  lastSeenAt:      number | null;
  lastSeenIp:      string | null;
  sessionToken:    string;   // current active session token
  sessionExpiresAt: number;  // unix ms
}

/** A one-time pairing code shown on the desktop. */
export interface PairingCode {
  code:      string;   // 6 digits
  expiresAt: number;   // unix ms (10 min TTL)
  used:      boolean;
}

/** Which networks can reach the Dispatch server. */
export type NetworkMode = 'local' | 'lan' | 'remote';

/** Risk levels (aligned with ActionItem.severity). */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Governs what remote clients may approve. */
export interface RemoteApprovePolicy {
  enabled:              boolean;
  maxRisk:              RiskLevel;  // won't approve above this level
  requireDesktopConfirm: boolean;   // route every remote approve through desktop confirm
}

export const DEFAULT_APPROVE_POLICY: RemoteApprovePolicy = {
  enabled:              false,
  maxRisk:              'medium',
  requireDesktopConfirm: false,
};

/** Ordered risk levels for comparison. */
export const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

// ── Auth result ─────────────────────────────────────────────────────────────────

export interface AuthResult {
  ok:       boolean;
  isAdmin:  boolean;
  device:   PairedDevice | null;
  reason?:  string;
}

// ── Generators ──────────────────────────────────────────────────────────────────

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generatePairingCode(): PairingCode {
  const code = String(Math.floor(100000 + crypto.randomInt(900001))).slice(0, 6);
  return { code, expiresAt: Date.now() + 10 * 60 * 1000, used: false };
}

export function generateDeviceId(): string {
  return crypto.randomBytes(6).toString('hex'); // 12 hex chars
}

// ── Validators ──────────────────────────────────────────────────────────────────

export function isPairingCodeValid(pc: PairingCode | null, input: string): boolean {
  if (!pc || pc.used) return false;
  if (Date.now() > pc.expiresAt) return false;
  return pc.code === input.trim();
}

export function isSessionExpired(device: PairedDevice): boolean {
  return Date.now() > device.sessionExpiresAt;
}

/** Check whether an action's risk level is within the approved policy window. */
export function isRiskAllowed(actionRisk: RiskLevel, policy: RemoteApprovePolicy): boolean {
  if (!policy.enabled) return false;
  const actionIdx = RISK_ORDER.indexOf(actionRisk);
  const maxIdx    = RISK_ORDER.indexOf(policy.maxRisk);
  return actionIdx >= 0 && actionIdx <= maxIdx;
}

// ── Network mode helpers ────────────────────────────────────────────────────────

export function isLocalIp(addr: string): boolean {
  const ip = addr.replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

export function isLanIp(addr: string): boolean {
  if (isLocalIp(addr)) return true;
  const ip = addr.replace(/^::ffff:/, '');
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip)  // link-local
  );
}

export function isNetworkAllowed(clientIp: string, mode: NetworkMode): boolean {
  if (mode === 'remote') return true;
  if (mode === 'lan')    return isLanIp(clientIp);
  return isLocalIp(clientIp);  // 'local'
}

// ── Session auth ────────────────────────────────────────────────────────────────

/**
 * Validates a bearer token against the master token and the list of paired devices.
 * - Master token match → isAdmin, no device
 * - Session token match (non-expired device) → device, not admin
 * - No match → unauthorized
 */
export function validateAuth(
  token: string,
  masterToken: string,
  devices: PairedDevice[],
  clientIp: string,
): AuthResult {
  if (!token) return { ok: false, isAdmin: false, device: null, reason: 'No token provided' };

  // Admin master token
  if (masterToken && token === masterToken) {
    return { ok: true, isAdmin: true, device: null };
  }

  // Device session token
  const device = devices.find(d => d.sessionToken === token);
  if (!device) return { ok: false, isAdmin: false, device: null, reason: 'Invalid token' };
  if (isSessionExpired(device)) {
    return { ok: false, isAdmin: false, device: null, reason: 'Session expired' };
  }

  // Touch lastSeen
  device.lastSeenAt = Date.now();
  device.lastSeenIp = clientIp;
  return { ok: true, isAdmin: false, device };
}

// ── Device management ───────────────────────────────────────────────────────────

export function createDevice(
  label: string,
  clientIp: string,
  ttlMinutes: number,
): PairedDevice {
  return {
    id:              generateDeviceId(),
    label:           label.slice(0, 60) || 'Unknown device',
    pairedAt:        Date.now(),
    lastSeenAt:      Date.now(),
    lastSeenIp:      clientIp,
    sessionToken:    generateSessionToken(),
    sessionExpiresAt: Date.now() + ttlMinutes * 60 * 1000,
  };
}

export function rotateSessionToken(device: PairedDevice, ttlMinutes: number): PairedDevice {
  return {
    ...device,
    sessionToken:    generateSessionToken(),
    sessionExpiresAt: Date.now() + ttlMinutes * 60 * 1000,
    lastSeenAt:      Date.now(),
  };
}

/** Device view safe for sending to the renderer (no session token). */
export interface DeviceView {
  id:          string;
  label:       string;
  pairedAt:    number;
  lastSeenAt:  number | null;
  lastSeenIp:  string | null;
  expired:     boolean;
}

export function toDeviceView(device: PairedDevice): DeviceView {
  return {
    id:         device.id,
    label:      device.label,
    pairedAt:   device.pairedAt,
    lastSeenAt: device.lastSeenAt,
    lastSeenIp: device.lastSeenIp,
    expired:    isSessionExpired(device),
  };
}

// ── Desktop confirmation queue ──────────────────────────────────────────────────

export interface PendingConfirmation {
  id:          string;
  action:      string;  // human-readable description
  itemId:      string;  // original action item ID
  verb:        'approve' | 'dismiss' | 'retry';
  deviceId:    string;
  deviceLabel: string;
  clientIp:    string;
  createdAt:   number;
  status:      'pending' | 'approved' | 'denied';
  resolvedAt?: number;
}

export function generateConfirmationId(): string {
  return 'conf_' + crypto.randomBytes(6).toString('hex');
}
