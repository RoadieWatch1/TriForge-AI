// ── credentialStore.ts ────────────────────────────────────────────────────────
//
// Phase 5 — Social Media Publishing: Secure Token Store
//
// Uses Electron's safeStorage (OS-level AES-256 via Keychain/DPAPI/libsecret)
// to store OAuth access tokens for social media platforms.
//
// Tokens are stored as encrypted blobs in a plain JSON file alongside the app's
// userData dir — the blob is unreadable without the OS session key.
//
// Supported platforms: youtube, facebook, instagram, tiktok

import { safeStorage, app } from 'electron';
import fs   from 'fs';
import path from 'path';

export type SocialPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';

export interface OAuthTokens {
  accessToken:   string;
  refreshToken?: string;
  /** Unix timestamp (ms) when the access token expires. Undefined = non-expiring. */
  expiresAt?:    number;
  /** Platform-specific extras (e.g. pageId, igUserId) */
  meta?: Record<string, string>;
}

// ── Storage path ──────────────────────────────────────────────────────────────

function storePath(): string {
  return path.join(app.getPath('userData'), 'social-tokens.json');
}

function loadRaw(): Record<string, string> {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveRaw(data: Record<string, string>): void {
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Store OAuth tokens for a platform (encrypted with safeStorage). */
export function saveTokens(platform: SocialPlatform, tokens: OAuthTokens): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system.');
  }
  const json    = JSON.stringify(tokens);
  const encrypted = safeStorage.encryptString(json);
  const existing  = loadRaw();
  existing[platform] = encrypted.toString('base64');
  saveRaw(existing);
}

/** Load and decrypt tokens for a platform. Returns null if not stored. */
export function loadTokens(platform: SocialPlatform): OAuthTokens | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const existing = loadRaw();
  const blob     = existing[platform];
  if (!blob) return null;
  try {
    const buf  = Buffer.from(blob, 'base64');
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as OAuthTokens;
  } catch {
    return null;
  }
}

/** Check if tokens are stored and not expired. */
export function hasValidTokens(platform: SocialPlatform): boolean {
  const tokens = loadTokens(platform);
  if (!tokens) return false;
  if (tokens.expiresAt && tokens.expiresAt < Date.now()) return false;
  return true;
}

/** Remove stored tokens for a platform (logout). */
export function clearTokens(platform: SocialPlatform): void {
  const existing = loadRaw();
  delete existing[platform];
  saveRaw(existing);
}

/** Check which platforms are currently authenticated. */
export function getAuthStatus(): Record<SocialPlatform, boolean> {
  return {
    youtube:   hasValidTokens('youtube'),
    facebook:  hasValidTokens('facebook'),
    instagram: hasValidTokens('instagram'),
    tiktok:    hasValidTokens('tiktok'),
  };
}
