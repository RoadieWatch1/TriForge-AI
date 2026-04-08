// ── relay-server/src/auth.ts ──────────────────────────────────────────────────
//
// Device authentication and HMAC signature verification.
//
// Each TriForge desktop installation registers with:
//   - deviceId:     UUID (public, sent with every request)
//   - deviceSecret: 32-byte random hex (private, never sent — only used for HMAC)
//
// Every request signs:
//   HMAC-SHA256(deviceSecret, `${deviceId}:${timestamp}:${body}`)
//
// Headers required on all authenticated requests:
//   X-Device-Id:  <deviceId>
//   X-Timestamp:  <unix ms>
//   X-Signature:  <hex HMAC>
//
// Replay protection: timestamps older than 5 minutes are rejected.

import crypto from 'crypto';

// ── Device registry ────────────────────────────────────────────────────────────

export interface RegisteredDevice {
  deviceId:     string;
  deviceSecret: string;  // stored in plain hex (relay server stores this)
  registeredAt: number;
  label?:       string;  // friendly name, e.g. "MacBook Pro — Home"
  lastSeenAt?:  number;
}

// In-memory store — for production, swap this out for Redis or SQLite
const _devices = new Map<string, RegisteredDevice>();

export function registerDevice(
  deviceId:     string,
  deviceSecret: string,
  label?:       string,
): RegisteredDevice {
  const device: RegisteredDevice = {
    deviceId,
    deviceSecret,
    registeredAt: Date.now(),
    label,
  };
  _devices.set(deviceId, device);
  return device;
}

export function getDevice(deviceId: string): RegisteredDevice | undefined {
  return _devices.get(deviceId);
}

export function listDevices(): RegisteredDevice[] {
  return Array.from(_devices.values());
}

export function updateLastSeen(deviceId: string): void {
  const dev = _devices.get(deviceId);
  if (dev) dev.lastSeenAt = Date.now();
}

// ── HMAC helpers ───────────────────────────────────────────────────────────────

const CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

export function computeSignature(
  deviceSecret: string,
  deviceId:     string,
  timestamp:    number,
  body:         string,
): string {
  const message = `${deviceId}:${timestamp}:${body}`;
  return crypto
    .createHmac('sha256', deviceSecret)
    .update(message)
    .digest('hex');
}

export interface AuthResult {
  ok:       boolean;
  device?:  RegisteredDevice;
  error?:   string;
}

/**
 * Verify a request's HMAC signature.
 * Returns { ok: true, device } on success, { ok: false, error } on failure.
 */
export function verifyRequest(
  deviceId:  string | undefined,
  timestamp: string | undefined,
  signature: string | undefined,
  body:      string,
): AuthResult {
  if (!deviceId)  return { ok: false, error: 'Missing X-Device-Id header.' };
  if (!timestamp) return { ok: false, error: 'Missing X-Timestamp header.' };
  if (!signature) return { ok: false, error: 'Missing X-Signature header.' };

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return { ok: false, error: 'Invalid X-Timestamp.' };

  const skew = Math.abs(Date.now() - ts);
  if (skew > CLOCK_SKEW_MS) {
    return { ok: false, error: `Timestamp too old or too far in the future (skew: ${Math.round(skew / 1000)}s).` };
  }

  const device = getDevice(deviceId);
  if (!device) {
    return { ok: false, error: `Device not registered: ${deviceId}. Call POST /api/devices/register first.` };
  }

  const expected = computeSignature(device.deviceSecret, deviceId, ts, body);
  const valid    = crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature.padEnd(expected.length, '0').slice(0, expected.length), 'hex'),
  );

  if (!valid) return { ok: false, error: 'Invalid signature.' };

  updateLastSeen(deviceId);
  return { ok: true, device };
}

// ── Device secret generation ───────────────────────────────────────────────────

export function generateDeviceSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateDeviceId(): string {
  return crypto.randomUUID();
}
