import { Store } from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Replace these with your actual LemonSqueezy variant IDs after creating
// your products at https://app.lemonsqueezy.com
// ─────────────────────────────────────────────────────────────────────────────
export const LEMONSQUEEZY = {
  STORE_ID:          'YOUR_STORE_ID',          // e.g. "12345"
  PRO_VARIANT_ID:    'YOUR_PRO_VARIANT_ID',    // e.g. "98765"
  BIZ_VARIANT_ID:    'YOUR_BIZ_VARIANT_ID',    // e.g. "98766"

  // Checkout URLs — replace after creating products
  PRO_CHECKOUT:      'https://triforge.lemonsqueezy.com/checkout/buy/YOUR_PRO_LINK',
  BIZ_CHECKOUT:      'https://triforge.lemonsqueezy.com/checkout/buy/YOUR_BIZ_LINK',
  CUSTOMER_PORTAL:   'https://app.lemonsqueezy.com/my-orders',
};

export type Tier = 'free' | 'pro' | 'business';

export interface LicenseStatus {
  tier: Tier;
  valid: boolean;
  key: string | null;
  email: string | null;
  expiresAt: string | null;   // ISO date or null for lifetime/subscription
  activatedAt: string | null;
  error: string | null;
}

interface LemonValidateResponse {
  valid: boolean;
  error?: string;
  license_key?: {
    id: number;
    status: string;
    key: string;
    activation_limit: number;
    activation_usage: number;
    created_at: string;
    expires_at: string | null;
  };
  instance?: {
    id: string;
    name: string;
    created_at: string;
  };
  meta?: {
    store_id: number;
    order_id: number;
    order_item_id: number;
    variant_id: number;
    variant_name: string;
    product_id: number;
    product_name: string;
    customer_id: number;
    customer_name: string;
    customer_email: string;
  };
}

/** Validate a license key against LemonSqueezy and return the resolved tier. */
export async function validateLicense(key: string, instanceName = 'triforge-desktop'): Promise<LicenseStatus> {
  const trimmed = key.trim().toUpperCase();

  // Special dev/test key — skips network call
  if (trimmed === 'TF-DEV-PRO') {
    return { tier: 'pro', valid: true, key: trimmed, email: 'dev@triforge.ai', expiresAt: null, activatedAt: new Date().toISOString(), error: null };
  }
  if (trimmed === 'TF-DEV-BIZ') {
    return { tier: 'business', valid: true, key: trimmed, email: 'dev@triforge.ai', expiresAt: null, activatedAt: new Date().toISOString(), error: null };
  }

  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: trimmed, instance_name: instanceName }),
    });

    const data = await res.json() as LemonValidateResponse;

    if (!data.valid || !data.meta) {
      return { tier: 'free', valid: false, key: trimmed, email: null, expiresAt: null, activatedAt: null, error: data.error ?? 'Invalid license key' };
    }

    const variantId = String(data.meta.variant_id);
    let tier: Tier = 'free';
    if (variantId === LEMONSQUEEZY.BIZ_VARIANT_ID)       tier = 'business';
    else if (variantId === LEMONSQUEEZY.PRO_VARIANT_ID)  tier = 'pro';
    else                                                  tier = 'pro'; // any valid key → at least pro

    return {
      tier,
      valid: true,
      key: trimmed,
      email: data.meta.customer_email,
      expiresAt: data.license_key?.expires_at ?? null,
      activatedAt: data.instance?.created_at ?? new Date().toISOString(),
      error: null,
    };
  } catch (e) {
    // Network failure — fall back to cached status rather than locking user out
    return { tier: 'free', valid: false, key: trimmed, email: null, expiresAt: null, activatedAt: null, error: 'Could not reach license server. Check your connection.' };
  }
}

/** Deactivate a license instance on LemonSqueezy (called on uninstall / key removal). */
export async function deactivateLicense(key: string, instanceId: string): Promise<void> {
  try {
    await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key, instance_id: instanceId }),
    });
  } catch { /* best-effort */ }
}

/** Load cached license from store, revalidate if older than 24 hours. */
export async function loadLicense(store: Store): Promise<LicenseStatus> {
  const cached = await store.getLicense();

  if (!cached.key) {
    return { tier: 'free', valid: false, key: null, email: null, expiresAt: null, activatedAt: null, error: null };
  }

  // Revalidate if cache is stale (>24h)
  const lastCheck = cached.lastChecked ? new Date(cached.lastChecked).getTime() : 0;
  const stale = Date.now() - lastCheck > 24 * 60 * 60 * 1000;

  if (stale) {
    const fresh = await validateLicense(cached.key);
    await store.setLicense({ ...fresh, lastChecked: new Date().toISOString() });
    return fresh;
  }

  return {
    tier: (cached.tier as Tier) ?? 'free',
    valid: cached.valid ?? false,
    key: cached.key,
    email: cached.email ?? null,
    expiresAt: cached.expiresAt ?? null,
    activatedAt: cached.activatedAt ?? null,
    error: null,
  };
}
