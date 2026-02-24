import crypto from 'crypto';

/** Hash a PIN using scrypt (memory-hard, resistant to brute-force). */
export function hashPin(pin: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return { hash, salt };
}

/** Verify a PIN against a stored hash + salt. */
export function verifyPin(pin: string, storedHash: string, salt: string): boolean {
  try {
    const { hash } = hashPin(pin, salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

/** Validate that a PIN is exactly 7 numeric digits. */
export function isValidPin(pin: string): boolean {
  return /^\d{7}$/.test(pin);
}
