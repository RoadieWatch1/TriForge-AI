import { Store } from './store';

export const LEMONSQUEEZY = {
  STORE_ID: 'triforgeai',

  // Pro — monthly and annual variant IDs both map to the pro tier
  PRO_VARIANT_IDS:  ['1351666', '1351679'],   // [monthly, annual]
  PRO_VARIANT_ID:   '1351666',                // primary (monthly) — used for single-ID checks

  // Business — monthly and annual variant IDs both map to the business tier
  BIZ_VARIANT_IDS:  ['1351723', '1351726'],   // [monthly, annual]
  BIZ_VARIANT_ID:   '1351723',                // primary (monthly)

  PRO_CHECKOUT:    'https://triforgeai.lemonsqueezy.com/checkout/buy/2f513f94-7aa4-48ca-96e7-afad2f36cbad',
  BIZ_CHECKOUT:    'https://triforgeai.lemonsqueezy.com/checkout/buy/46dbcdfd-50fc-435d-bd09-9ecef6edb783',
  CUSTOMER_PORTAL: 'https://app.lemonsqueezy.com/my-orders',
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
    let tier: Tier = 'pro'; // any valid LS key → at least pro
    if (LEMONSQUEEZY.BIZ_VARIANT_IDS.includes(variantId))       tier = 'business';
    else if (LEMONSQUEEZY.PRO_VARIANT_IDS.includes(variantId))  tier = 'pro';

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
