/**
 * packSigner.ts — Phase 36
 *
 * Ed25519 signing and verification for RunbookPacks.
 *
 * Key management:
 *   - Each desktop installation has a local ed25519 key pair stored in userData.
 *   - The private key file is mode 0o600 (owner-read-only).
 *   - The public key PEM is the shareable identity that recipients add to their
 *     trusted signers list.
 *
 * Signing:
 *   - The pack is canonicalized (deterministic JSON, `signature` field excluded).
 *   - The canonical bytes are signed with crypto.sign(null, data, ed25519Key).
 *   - The resulting signature block is embedded in the pack JSON.
 *
 * Verification:
 *   - Receiver canonicalizes the incoming pack (same `signature`-excluded JSON).
 *   - Looks up the keyId in their trusted signers list.
 *   - Calls crypto.verify(null, data, pubKey, sigBytes).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { RunbookPack, PackSignature, TrustedSigner, PackTrustVerification } from './runbookPack';

const PRIV_KEY_FILE = 'triforge-signing-key.pem';
const PUB_KEY_FILE  = 'triforge-signing-pub.pem';

// ── Canonical JSON ────────────────────────────────────────────────────────────

/**
 * Produce a deterministic JSON representation of `obj`.
 * Object keys are sorted; the `signature` key is excluded at every depth level
 * so that stripping / adding the signature block does not invalidate it.
 */
function _canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + (obj as unknown[]).map(_canonicalize).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).filter(k => k !== 'signature').sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalize(record[k])).join(',') + '}';
}

export function packCanonicalBytes(pack: RunbookPack): Buffer {
  return Buffer.from(_canonicalize(pack));
}

// ── Key fingerprint ───────────────────────────────────────────────────────────

/**
 * Compute the 16-hex-character key ID from an SPKI PEM public key.
 * This is the first 16 hex digits of SHA-256 over the DER-encoded key.
 */
export function computeKeyId(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const der  = key.export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

// ── Local key pair ────────────────────────────────────────────────────────────

export interface LocalSigningKey {
  privateKeyPem: string;
  publicKeyPem:  string;
  keyId:         string;
}

/**
 * Load the local signing key pair from userData, generating one if absent.
 * Safe to call multiple times — returns the cached key on subsequent calls.
 */
export function getOrCreateLocalKey(dataDir: string): LocalSigningKey {
  const privPath = path.join(dataDir, PRIV_KEY_FILE);
  const pubPath  = path.join(dataDir, PUB_KEY_FILE);

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    const privateKeyPem = fs.readFileSync(privPath, 'utf8');
    const publicKeyPem  = fs.readFileSync(pubPath,  'utf8');
    return { privateKeyPem, publicKeyPem, keyId: computeKeyId(publicKeyPem) };
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  });

  fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(pubPath,  publicKey);
  return { privateKeyPem: privateKey, publicKeyPem: publicKey, keyId: computeKeyId(publicKey) };
}

// ── Sign ──────────────────────────────────────────────────────────────────────

/**
 * Attach a signature block to a pack.  Returns a new pack object — does not
 * mutate the input.
 */
export function signPack(
  pack:           RunbookPack,
  privateKeyPem:  string,
  publicKeyPem:   string,
  signerName:     string,
  signerEmail?:   string,
): RunbookPack {
  // Remove any existing signature before signing so we sign over the same
  // canonical bytes that the verifier will see after stripping.
  const { signature: _old, ...packWithout } = pack;
  const canonical  = packCanonicalBytes(packWithout as RunbookPack);
  const privKey    = crypto.createPrivateKey(privateKeyPem);
  const sigBytes   = crypto.sign(null, canonical, privKey);

  const signature: PackSignature = {
    algorithm:  'ed25519',
    keyId:      computeKeyId(publicKeyPem),
    signerName,
    signerEmail,
    signedAt:   Date.now(),
    signature:  sigBytes.toString('base64'),
  };
  return { ...packWithout, signature } as RunbookPack;
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verify the pack signature against the workspace trusted signers list.
 * Returns a typed trust verdict.
 */
export function verifyPackSignature(
  pack:           RunbookPack,
  trustedSigners: TrustedSigner[],
): PackTrustVerification {
  if (!pack.signature) {
    return { status: 'unsigned' };
  }

  const sig = pack.signature;

  const signer = trustedSigners.find(s => s.keyId === sig.keyId);
  if (!signer) {
    return { status: 'unknown_signer', keyId: sig.keyId, signerName: sig.signerName };
  }
  if (signer.revoked) {
    return { status: 'revoked', keyId: sig.keyId, signerName: sig.signerName };
  }

  try {
    const { signature: _sig, ...packWithout } = pack;
    const canonical = packCanonicalBytes(packWithout as RunbookPack);
    const pubKey    = crypto.createPublicKey(signer.publicKeyPem);
    const sigBytes  = Buffer.from(sig.signature, 'base64');
    const valid     = crypto.verify(null, canonical, pubKey, sigBytes);

    if (valid) {
      return {
        status:     'trusted',
        keyId:      sig.keyId,
        signerName: sig.signerName,
        signedAt:   sig.signedAt,
      };
    } else {
      return {
        status:     'invalid',
        keyId:      sig.keyId,
        signerName: sig.signerName,
        error:      'Signature did not match pack content — pack may have been tampered with',
      };
    }
  } catch (e) {
    return {
      status: 'invalid',
      keyId:  sig.keyId,
      error:  e instanceof Error ? e.message : 'Verification error',
    };
  }
}
