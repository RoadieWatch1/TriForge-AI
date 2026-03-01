import * as vscode from 'vscode';
import * as https from 'https';

// ── Storage keys ──────────────────────────────────────────────────────────────
const KEY_TRIAL_START   = 'triforge.trialStartMs';
const KEY_INSTANCE_ID   = 'triforge.lsInstanceId';
const KEY_VALID_UNTIL   = 'triforge.licenseValidUntilMs';
const KEY_LICENSE_STATE = 'triforge.licenseState';
const SECRET_KEY        = 'triforge.licenseKey';

// ── Configuration ─────────────────────────────────────────────────────────────
const TRIAL_MS  = 1 * 24 * 60 * 60 * 1000;   // 1 day
const CACHE_MS  = 24 * 60 * 60 * 1000;        // 24 hours
const LS_API    = 'https://api.lemonsqueezy.com/v1/licenses';

/** TriForge AI Code Council product page — upgrade flow lands here first */
export const LS_CHECKOUT = 'https://triforgeai.com/vscode.html#pricing';

// ── Types ─────────────────────────────────────────────────────────────────────
export type LicenseState = 'trial' | 'active' | 'expired';

export interface LicenseStatus {
  state:            LicenseState;
  trialDaysLeft:    number;
  isCouncilAllowed: boolean;
  statusLabel:      string;
  licenseKey:       string | null;  // masked e.g. "ABCD-....-1234"
}

// ── LicenseManager ────────────────────────────────────────────────────────────
export class LicenseManager {
  constructor(
    private readonly _secrets: vscode.SecretStorage,
    private readonly _state:   vscode.Memento,
  ) {}

  /** Call once on extension activate. Records first-install date. */
  async initialize(): Promise<LicenseStatus> {
    if (!this._state.get<number>(KEY_TRIAL_START)) {
      await this._state.update(KEY_TRIAL_START, Date.now());
    }
    return this.getStatus();
  }

  /** Pure local read — no network call. */
  async getStatus(): Promise<LicenseStatus> {
    const trialStart  = this._state.get<number>(KEY_TRIAL_START, 0);
    const trialDaysLeft = Math.max(
      0,
      Math.ceil((trialStart + TRIAL_MS - Date.now()) / 86400000)
    );
    const storedState = this._state.get<string>(KEY_LICENSE_STATE, '');
    const validUntil  = this._state.get<number>(KEY_VALID_UNTIL, 0);

    let state: LicenseState;
    if (storedState === 'active' && validUntil > Date.now()) {
      state = 'active';
    } else if (trialDaysLeft > 0) {
      state = 'trial';
    } else {
      state = 'expired';
    }

    const labelMap: Record<LicenseState, string> = {
      trial:   `Trial \u2014 ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left`,
      active:  'Pro \u2014 Licensed',
      expired: 'Trial expired \u2014 subscribe to unlock Council',
    };

    const rawKey = await Promise.resolve(this._secrets.get(SECRET_KEY)).catch(() => undefined);
    const maskedKey = rawKey
      ? rawKey.slice(0, 4) + '-\u2026-' + rawKey.slice(-4)
      : null;

    return {
      state,
      trialDaysLeft,
      isCouncilAllowed: state !== 'expired',
      statusLabel:      labelMap[state],
      licenseKey:       maskedKey,
    };
  }

  /** Validates against LS API. Caches result for 24h. */
  async validateLicense(force = false): Promise<LicenseStatus> {
    const validUntil = this._state.get<number>(KEY_VALID_UNTIL, 0);
    if (!force && validUntil > Date.now()) {
      return this.getStatus();
    }

    const rawKey = await Promise.resolve(this._secrets.get(SECRET_KEY)).catch(() => undefined);
    if (!rawKey) { return this.getStatus(); }

    const instanceId = this._state.get<string>(KEY_INSTANCE_ID, '');
    try {
      let res: { status: number; data: any };
      if (instanceId) {
        res = await this._httpsPost(`${LS_API}/validate`, {
          license_key: rawKey,
          instance_id: instanceId,
        });
      } else {
        res = await this._httpsPost(`${LS_API}/activate`, {
          license_key:   rawKey,
          instance_name: vscode.env.machineId.slice(0, 8) || 'vscode-ext',
        });
        if (res.data?.activated && res.data?.instance?.id) {
          await this._state.update(KEY_INSTANCE_ID, res.data.instance.id);
        }
      }
      if (res.data?.valid === true) {
        await this._state.update(KEY_LICENSE_STATE, 'active');
        await this._state.update(KEY_VALID_UNTIL, Date.now() + CACHE_MS);
      } else {
        await this._state.update(KEY_LICENSE_STATE, 'expired');
        await this._state.update(KEY_VALID_UNTIL, 0);
      }
    } catch {
      // Network failure — fall back to cached state
    }
    return this.getStatus();
  }

  /** Activate a new license key. */
  async activateLicense(rawKey: string): Promise<{ success: boolean; error?: string }> {
    if (!rawKey.trim()) {
      return { success: false, error: 'License key cannot be empty.' };
    }
    try {
      const res = await this._httpsPost(`${LS_API}/activate`, {
        license_key:   rawKey.trim(),
        instance_name: vscode.env.machineId.slice(0, 8) || 'vscode-ext',
      });
      if (res.data?.activated === true || res.data?.valid === true) {
        await this._secrets.store(SECRET_KEY, rawKey.trim());
        if (res.data?.instance?.id) {
          await this._state.update(KEY_INSTANCE_ID, res.data.instance.id);
        }
        await this._state.update(KEY_LICENSE_STATE, 'active');
        await this._state.update(KEY_VALID_UNTIL, Date.now() + CACHE_MS);
        return { success: true };
      }
      const errorMsg = res.data?.error ?? res.data?.message ?? 'Activation failed. Check your key and try again.';
      return { success: false, error: errorMsg };
    } catch (e) {
      return { success: false, error: `Network error: ${String(e)}` };
    }
  }

  /** Deactivate and clear all stored license data. */
  async deactivateLicense(): Promise<void> {
    const rawKey    = await Promise.resolve(this._secrets.get(SECRET_KEY)).catch(() => undefined);
    const instanceId = this._state.get<string>(KEY_INSTANCE_ID, '');
    if (rawKey && instanceId) {
      try {
        await this._httpsPost(`${LS_API}/deactivate`, {
          license_key: rawKey,
          instance_id: instanceId,
        });
      } catch { /* best-effort */ }
    }
    await Promise.resolve(this._secrets.delete(SECRET_KEY)).catch(() => undefined);
    await this._state.update(KEY_LICENSE_STATE, undefined);
    await this._state.update(KEY_INSTANCE_ID,   undefined);
    await this._state.update(KEY_VALID_UNTIL,    undefined);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _httpsPost(
    url: string,
    body: Record<string, string>,
  ): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const json    = JSON.stringify(body);
      const parsed  = new URL(url);
      const options = {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Accept':         'application/json',
          'Content-Length': Buffer.byteLength(json),
        },
      };
      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try   { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: {} }); }
        });
      });
      const timer = setTimeout(() => req.destroy(new Error('LS API timeout')), 10000);
      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.on('close', ()  => clearTimeout(timer));
      req.write(json);
      req.end();
    });
  }
}
