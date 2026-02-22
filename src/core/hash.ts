import * as crypto from 'crypto';

/**
 * Compute SHA-256 hash of file content. Used to verify reviewers
 * are reviewing the exact version the builder produced.
 */
export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}
