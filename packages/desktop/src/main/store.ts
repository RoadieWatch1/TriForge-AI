import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import type { StorageAdapter, ShadowStrategyConfig, TradingOperationMode } from '@triforge/engine';
import type { SharedContextData } from './sharedContext';
import { EMPTY_SHARED_CONTEXT } from './sharedContext';
import type { PairedDevice, PairingCode, NetworkMode, RemoteApprovePolicy } from './dispatchSession';
import { DEFAULT_APPROVE_POLICY } from './dispatchSession';

export interface Permission {
  key: string;
  label: string;
  description: string;
  category: 'system' | 'communication' | 'finance' | 'business';
  granted: boolean;
  budgetLimit?: number;
  requireConfirm: boolean;
}

export const DEFAULT_PERMISSIONS: Permission[] = [
  { key: 'files',     label: 'Files & Folders',      description: 'Read and write files on your computer',       category: 'system',        granted: false, requireConfirm: false },
  { key: 'terminal',  label: 'Terminal / Commands',   description: 'Run commands and scripts on your behalf',      category: 'system',        granted: false, requireConfirm: true  },
  { key: 'browser',   label: 'Browser Automation',    description: 'Open and control web browsers for you',        category: 'system',        granted: false, requireConfirm: true  },
  { key: 'printer',   label: 'Printer',               description: 'Print documents on your behalf',               category: 'system',        granted: false, requireConfirm: true  },
  { key: 'email_r',   label: 'Email — Read',          description: 'Read your emails to provide context',          category: 'communication', granted: false, requireConfirm: false },
  { key: 'email_s',   label: 'Email — Send',          description: 'Draft and send emails on your behalf',         category: 'communication', granted: false, requireConfirm: true  },
  { key: 'calendar',  label: 'Calendar',              description: 'Read and create calendar events',              category: 'communication', granted: false, requireConfirm: true  },
  { key: 'contacts',  label: 'Contacts',              description: 'Access and update your contacts',              category: 'communication', granted: false, requireConfirm: false },
  { key: 'crm',       label: 'CRM / Lead Management', description: 'Create leads, contacts, and business records', category: 'business',      granted: false, requireConfirm: false },
  { key: 'finance_r', label: 'Finance — View',        description: 'Read your portfolio and account balances',     category: 'finance',       granted: false, requireConfirm: false },
  { key: 'finance_t', label: 'Finance — Trade',       description: 'Propose and execute investment trades',        category: 'finance',       granted: false, requireConfirm: true, budgetLimit: 0 },
];

export interface StoredLicense {
  key: string | null;
  tier: string;
  valid: boolean;
  email: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  lastChecked: string | null;
}

export interface StoredAuth {
  username: string | null;
  pinHash: string | null;
  salt: string | null;
}

interface StoreData {
  kv: Record<string, string>;
  secrets: Record<string, string>;
  permissions: Record<string, { granted: boolean; budgetLimit?: number; requireConfirm: boolean }>;
  memory: Array<{ id: number; type: string; content: string; created_at: number; source?: string }>;
  firstRunDone: boolean;
  activeProfileId: string | null;
  userProfile: Record<string, string>;
  nextMemoryId: number;
  license: StoredLicense;
  // message usage: key = "YYYY-MM" → count
  messageUsage: Record<string, number>;
  // operator workflow runs: key = "YYYY-MM-DD" → count (used to enforce free-tier daily quota)
  operatorRunsDaily?: Record<string, number>;
  auth: StoredAuth;
  ledger: LedgerEntry[];
  shadowStrategyConfig?: ShadowStrategyConfig;
  tradingOperationMode?: TradingOperationMode;
  promotionGuardrails?: Record<string, unknown>;
  // Venture Discovery
  ventureProposals?: Array<Record<string, unknown>>;
  ventureTrialStart?: number;
  founderProfile?: Record<string, unknown>;
  // ── Income Operator ────────────────────────────────────────────────────────
  lastCapabilityScan?: CapabilityScanResult;
  lastCapabilityScanAt?: number;
  incomeLanes?: IncomeLaneConfig[];
  incomeExperiments?: IncomeExperiment[];
  incomeBudget?: BudgetState;
  // ── Phase D1: cross-session pattern learning ──────────────────────────────
  // Counters keyed by feature name. When a counter crosses a threshold, the
  // pattern memory service flushes a 'pattern' memory entry that the council
  // can read in subsequent sessions.
  patternCounters?: Record<string, { count: number; lastSeenAt: number; meta?: Record<string, string> }>;
}

// ── Income Operator types ──────────────────────────────────────────────────

export interface DetectedApp {
  name: string;
  version?: string;
  path: string;
  exportFormats: string[];
  incomeRelevant: string[]; // which income lane IDs this app enables
}

export interface CapabilityScanResult {
  scannedAt: number;
  installedApps: DetectedApp[];
  gpuName?: string;
  gpuVramMB?: number;
  storageGB: number;
  connectedPlatforms: string[];   // inferred from saved credentials
  browserProfiles: string[];      // detected browser profile dirs
}

export type IncomeLaneId =
  | 'digital_products'
  | 'client_services'
  | 'affiliate_content'
  | 'faceless_youtube'
  | 'short_form_brand'
  | 'ai_music'
  | 'mini_games'
  | 'asset_packs';

export interface IncomeLaneConfig {
  laneId: IncomeLaneId;
  name: string;
  selectedAt: number;
  active: boolean;
}

export type ExperimentStatus =
  | 'proposed'
  | 'approved'
  | 'building'
  | 'launched'
  | 'measuring'
  | 'scaling'
  | 'killed'
  | 'completed';

export interface ExperimentMetrics {
  views: number;
  clicks: number;
  followers: number;
  watchTimeHours: number;
  conversions: number;
  revenue: number;
  adSpend: number;
  lastUpdatedAt: number;
}

export interface IncomeExperiment {
  id: string;
  laneId: IncomeLaneId;
  name: string;
  rationale: string;            // "TriForge picked this because..."
  status: ExperimentStatus;
  createdAt: number;
  launchedAt?: number;
  endedAt?: number;
  budgetAllocated: number;
  budgetSpent: number;
  revenueEarned: number;
  runbookIds: string[];
  contentJobIds: string[];
  platformLinks: Record<string, string>;  // platform → published URL
  metrics: ExperimentMetrics;
  decision?: 'continue' | 'kill' | 'scale';
  decisionReason?: string;
  // Auto-kill: if budgetPctSpent % of budget is gone with $0 revenue after afterDays → suggest kill
  autoKillRule?: { budgetPctSpent: number; afterDays: number };
}

export interface BudgetState {
  totalBudget: number;
  maxPerExperiment: number;
  dailyLimit: number;                      // emergency stop — hard cap per day
  reservePct: number;                      // % held for scaling winners (default 20)
  allocated: Record<string, number>;       // experimentId → allocated $
  spent: Record<string, number>;           // experimentId → spent $
  dailySpentToday: number;
  dailySpentDate: string;                  // "YYYY-MM-DD" — resets when date changes
  setAt: number;
}

function emptyData(): StoreData {
  const perms: StoreData['permissions'] = {};
  for (const p of DEFAULT_PERMISSIONS) {
    perms[p.key] = { granted: false, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm };
  }
  return {
    kv: {}, secrets: {}, permissions: perms, memory: [],
    firstRunDone: false, userProfile: {}, nextMemoryId: 1,
    license: { key: null, tier: 'free', valid: false, email: null, expiresAt: null, activatedAt: null, lastChecked: null },
    messageUsage: {},
    operatorRunsDaily: {},
    auth: { username: null, pinHash: null, salt: null },
    ledger: [],
    activeProfileId: null,
  };
}

export interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
  // Council debate metadata
  initialConfidence?: number;  // average self-assessed confidence before synthesis
  intensity?: string;          // debate intensity level that produced this score
  escalatedFrom?: string;      // set if auto-escalation overrode user's chosen intensity
}

export interface LedgerEntry {
  id: string;
  timestamp: number;
  request: string;
  synthesis: string;
  forgeScore?: ForgeScore;
  responses?: Array<{ provider: string; text: string }>;
  workflow?: string;
  starred: boolean;
}

// ── Basic schema validation ───────────────────────────────────────────────────
// Guards against corrupted JSON loading invalid types into critical fields.
function isValidStoreData(d: unknown): d is Partial<StoreData> {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (o.kv !== undefined && typeof o.kv !== 'object') return false;
  if (o.secrets !== undefined && typeof o.secrets !== 'object') return false;
  if (o.memory !== undefined && !Array.isArray(o.memory)) return false;
  if (o.ledger !== undefined && !Array.isArray(o.ledger)) return false;
  if (o.license !== undefined && typeof o.license !== 'object') return false;
  if (o.auth !== undefined && typeof o.auth !== 'object') return false;
  if (o.firstRunDone !== undefined && typeof o.firstRunDone !== 'boolean') return false;
  if (o.shadowStrategyConfig !== undefined && typeof o.shadowStrategyConfig !== 'object') return false;
  if (o.tradingOperationMode !== undefined && typeof o.tradingOperationMode !== 'string') return false;
  if (o.promotionGuardrails !== undefined && typeof o.promotionGuardrails !== 'object') return false;
  return true;
}

// ── Phase 30 — Workspace automation governance types ──────────────────────────

export type AutomationDestination = 'slack' | 'jira' | 'linear' | 'github' | 'push' | 'any';
export type DelegationType = 'operator' | 'automation_operator' | 'approval_operator' | 'dispatch_only';

export interface WorkspaceRecipePolicy {
  recipeId:              string;
  maxRisk:               'low' | 'medium' | 'high';
  allowRemoteRun:        boolean;
  requireDesktopConfirm: boolean;
  allowedDestinations:   AutomationDestination[];
  allowedRunnerRoles:    string[];          // WorkspaceRole values
  allowedRunnerDeviceIds:string[];
  ownerDeviceId?:        string;
  editorDeviceIds:       string[];
  enabled:               boolean;
}

export interface DelegatedOperator {
  deviceId:       string;
  label:          string;
  delegationType: DelegationType;
  assignedBy:     string;
  assignedAt:     number;
  recipeIds?:     string[];  // scoped to specific recipes; undefined = all
  expiresAt?:     number;
}

export interface WorkspaceAutomationPolicy {
  allowRemoteRunDefault:        boolean;
  requireDesktopConfirmDefault: boolean;
  maxRiskDefault:               'low' | 'medium' | 'high';
  allowBundleSendFromRecipe:    boolean;
  minRunnerRole:                string;  // WorkspaceRole
}

export const DEFAULT_AUTOMATION_POLICY: WorkspaceAutomationPolicy = {
  allowRemoteRunDefault:        false,
  requireDesktopConfirmDefault: false,
  maxRiskDefault:               'medium',
  allowBundleSendFromRecipe:    true,
  minRunnerRole:                'operator',
};

// ── Phase 28 — Workspace integration config ───────────────────────────────────
export interface WorkspaceIntegrationConfig {
  configured: boolean;
  useWorkspaceByDefault: boolean;
  allowPersonalFallback: boolean;
  lastTestAt?: number;
  lastTestOk?: boolean;
  connectedLabel?: string;
  // Jira-specific config (stored clear; token is in credentials)
  url?: string;
  email?: string;
  // Push-specific config
  pushProvider?: 'ntfy' | 'pushover' | 'disabled';
  pushTopic?: string;
  pushServer?: string;
  pushoverUser?: string;
}

export class Store implements StorageAdapter {
  private filePath: string;
  private data: StoreData;
  // Serialise all writes through a promise chain to prevent concurrent clobber
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'triforge-store.json');
    this.data = emptyData();
  }

  async init(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!isValidStoreData(parsed)) {
          throw new Error('Store schema validation failed');
        }
        const loaded = parsed as Partial<StoreData>;
        this.data = { ...emptyData(), ...loaded };
        // Merge any new default permissions added in updates
        for (const p of DEFAULT_PERMISSIONS) {
          if (!this.data.permissions[p.key]) {
            this.data.permissions[p.key] = { granted: false, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm };
          }
        }
        // Migrate any plaintext secrets to safeStorage encryption
        if (safeStorage.isEncryptionAvailable()) {
          let migrated = false;
          for (const [k, v] of Object.entries(this.data.secrets)) {
            if (!v.startsWith('enc:')) {
              this.data.secrets[k] = this.encryptSecret(v);
              migrated = true;
            }
          }
          if (migrated) this.save();
        }
      }
    } catch (e) {
      console.error('[Store] init failed, resetting to defaults:', e);
      // Back up the corrupted file before resetting
      try {
        if (fs.existsSync(this.filePath)) {
          const stamp = Date.now();
          fs.copyFileSync(this.filePath, this.filePath + `.bak.${stamp}`);
        }
      } catch { /* best effort */ }
      this.data = emptyData();
    }
  }

  private save(): void {
    // Enqueue the write so concurrent callers never interleave
    this.writeQueue = this.writeQueue.then(() => {
      try {
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        // Atomic write: write to .tmp then rename so a crash mid-save never corrupts the store
        const tmp = this.filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
      } catch (e) {
        console.error('[Store] save error:', e);
      }
    });
  }

  // Encrypt a value with the OS keychain (safeStorage). Falls back to plaintext
  // on platforms where encryption is unavailable. Encrypted values are prefixed
  // with 'enc:' so we can detect them on read and handle migration gracefully.
  private encryptSecret(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      try { return 'enc:' + safeStorage.encryptString(value).toString('base64'); } catch { /* fall through */ }
    }
    return value;
  }

  private decryptSecret(raw: string): string {
    if (raw.startsWith('enc:')) {
      try { return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64')); } catch { return ''; }
    }
    return raw; // plaintext (pre-encryption or safeStorage unavailable)
  }

  // StorageAdapter interface
  async getSecret(key: string): Promise<string | undefined> {
    const raw = this.data.secrets[key];
    if (raw === undefined) return undefined;
    return this.decryptSecret(raw);
  }
  async setSecret(key: string, value: string): Promise<void> { this.data.secrets[key] = this.encryptSecret(value); this.save(); }
  async storeSecret(key: string, value: string): Promise<void> { return this.setSecret(key, value); }
  async deleteSecret(key: string): Promise<void> { delete this.data.secrets[key]; this.save(); }
  // Sync generic get with default — used by ProviderManager for session history
  get<T>(key: string, defaultValue: T): T {
    const raw = this.data.kv[key];
    if (raw === undefined) return defaultValue;
    try { return JSON.parse(raw) as T; } catch { return defaultValue; }
  }
  // Sync update — used by ProviderManager.saveSessions()
  update(key: string, value: unknown): void { this.data.kv[key] = JSON.stringify(value); this.save(); }
  // Raw string KV accessors — used by ExperimentManager, capability scan, etc.
  getKv(key: string): string | undefined { return this.data.kv[key]; }
  setKv(key: string, value: string): void { this.data.kv[key] = value; this.save(); }

  getPermissions(): Permission[] {
    return DEFAULT_PERMISSIONS.map(p => ({ ...p, ...this.data.permissions[p.key] }));
  }

  setPermission(key: string, granted: boolean, budgetLimit?: number): void {
    if (!this.data.permissions[key]) return;
    this.data.permissions[key].granted = granted;
    if (budgetLimit !== undefined) this.data.permissions[key].budgetLimit = budgetLimit;
    this.save();
  }

  isFirstRun(): boolean { return !this.data.firstRunDone; }
  markFirstRunDone(): void { this.data.firstRunDone = true; this.save(); }

  getUserProfile(): Record<string, string> { return this.data.userProfile; }
  setUserProfile(profile: Record<string, string>): void { this.data.userProfile = profile; this.save(); }

  // License
  async getLicense(): Promise<StoredLicense> {
    return this.data.license ?? { key: null, tier: 'free', valid: false, email: null, expiresAt: null, activatedAt: null, lastChecked: null };
  }

  async setLicense(license: StoredLicense): Promise<void> {
    this.data.license = license;
    this.save();
  }

  async clearLicense(): Promise<void> {
    this.data.license = { key: null, tier: 'free', valid: false, email: null, expiresAt: null, activatedAt: null, lastChecked: null };
    this.save();
  }

  // Session auth (PIN lock)
  getAuth(): StoredAuth {
    return this.data.auth ?? { username: null, pinHash: null, salt: null };
  }

  hasAuth(): boolean {
    const a = this.getAuth();
    return !!(a.pinHash && a.salt && a.username);
  }

  setAuth(username: string, pinHash: string, salt: string): void {
    this.data.auth = { username, pinHash, salt };
    this.save();
  }

  clearAuth(): void {
    this.data.auth = { username: null, pinHash: null, salt: null };
    this.save();
  }

  // Message usage (resets each calendar month)
  private monthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private dayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  getMonthlyMessageCount(): number {
    return this.data.messageUsage[this.monthKey()] ?? 0;
  }

  incrementMessageCount(): number {
    const k = this.monthKey();
    this.data.messageUsage[k] = (this.data.messageUsage[k] ?? 0) + 1;
    // Prune old months (keep last 3)
    const keys = Object.keys(this.data.messageUsage).sort();
    while (keys.length > 3) { delete this.data.messageUsage[keys.shift()!]; }
    this.save();
    return this.data.messageUsage[k];
  }

  /** Returns operator workflow runs counted for today (used by the free-tier daily quota gate). */
  getDailyOperatorRunCount(): number {
    return this.data.operatorRunsDaily?.[this.dayKey()] ?? 0;
  }

  /** Increment today's operator-run counter. Mirrors incrementMessageCount; prunes to last 7 days. */
  incrementDailyOperatorRunCount(): number {
    if (!this.data.operatorRunsDaily) this.data.operatorRunsDaily = {};
    const k = this.dayKey();
    this.data.operatorRunsDaily[k] = (this.data.operatorRunsDaily[k] ?? 0) + 1;
    // Prune old days (keep last 7)
    const keys = Object.keys(this.data.operatorRunsDaily).sort();
    while (keys.length > 7) { delete this.data.operatorRunsDaily[keys.shift()!]; }
    this.save();
    return this.data.operatorRunsDaily[k];
  }

  addMemory(type: 'fact' | 'goal' | 'preference' | 'business' | 'pattern', content: string, source?: string): void {
    this.data.memory.unshift({ id: this.data.nextMemoryId++, type, content, created_at: Date.now(), source });
    if (this.data.memory.length > 200) this.data.memory = this.data.memory.slice(0, 200);
    this.save();
  }

  // ── Phase D1: pattern counters ─────────────────────────────────────────────

  /**
   * Increment a named pattern counter and update its lastSeenAt timestamp.
   * Returns the new counter value. Used by the pattern memory service to
   * decide when to flush a high-frequency observation into a pattern memory.
   */
  incrementPatternCounter(key: string, meta?: Record<string, string>): number {
    if (!this.data.patternCounters) this.data.patternCounters = {};
    const existing = this.data.patternCounters[key];
    const next = (existing?.count ?? 0) + 1;
    this.data.patternCounters[key] = {
      count:      next,
      lastSeenAt: Date.now(),
      meta:       { ...(existing?.meta ?? {}), ...(meta ?? {}) },
    };
    this.save();
    return next;
  }

  /**
   * Read a single pattern counter, or all counters if no key is supplied.
   */
  getPatternCounters(): Record<string, { count: number; lastSeenAt: number; meta?: Record<string, string> }> {
    return this.data.patternCounters ?? {};
  }

  /**
   * Reset (clear) all pattern counters. Used by the user to forget the
   * inferred patterns and start fresh.
   */
  clearPatternCounters(): void {
    this.data.patternCounters = {};
    this.save();
  }

  /**
   * Returns true if a pattern memory with this exact content already exists.
   * Prevents the pattern service from flushing duplicate entries on every run.
   */
  hasPatternMemory(content: string): boolean {
    return this.data.memory.some(m => m.type === 'pattern' && m.content === content);
  }

  getMemory(limit = 50): Array<{ id: number; type: string; content: string; created_at: number; source?: string }> {
    return this.data.memory.slice(0, limit);
  }

  deleteMemory(id: number): void {
    this.data.memory = this.data.memory.filter(m => m.id !== id);
    this.save();
  }

  // ── Forge Profile persistence ─────────────────────────────────────────────

  getActiveProfileId(): string | null {
    return this.data.activeProfileId ?? null;
  }

  setActiveProfileId(id: string | null): void {
    this.data.activeProfileId = id;
    this.save();
  }

  /**
   * Remove all memory entries injected by a specific profile.
   * Guardrail: only removes entries where source === `profile:${profileId}`.
   * Entries without a source tag (user-authored memories) are never touched.
   */
  removeProfileMemories(profileId: string): void {
    const tag = `profile:${profileId}`;
    this.data.memory = this.data.memory.filter(m => m.source !== tag);
    this.save();
  }

  /** Returns true if memory entries for this profile are already present (idempotency check). */
  hasProfileMemories(profileId: string): boolean {
    const tag = `profile:${profileId}`;
    return this.data.memory.some(m => m.source === tag);
  }

  // Decision Ledger
  addLedger(entry: LedgerEntry): void {
    if (!this.data.ledger) this.data.ledger = [];
    this.data.ledger.unshift(entry);
    if (this.data.ledger.length > 500) this.data.ledger = this.data.ledger.slice(0, 500);
    this.save();
  }

  getLedger(limit = 100, search = ''): LedgerEntry[] {
    const all = this.data.ledger ?? [];
    const filtered = search
      ? all.filter(e =>
          e.request.toLowerCase().includes(search.toLowerCase()) ||
          e.synthesis.toLowerCase().includes(search.toLowerCase()) ||
          (e.workflow ?? '').toLowerCase().includes(search.toLowerCase()))
      : all;
    return filtered.slice(0, limit);
  }

  getLedgerEntry(id: string): LedgerEntry | undefined {
    return (this.data.ledger ?? []).find(e => e.id === id);
  }

  starLedger(id: string, starred: boolean): void {
    const e = (this.data.ledger ?? []).find(e => e.id === id);
    if (e) { e.starred = starred; this.save(); }
  }

  deleteLedger(id: string): void {
    this.data.ledger = (this.data.ledger ?? []).filter(e => e.id !== id);
    this.save();
  }

  // ── Shadow Strategy Config (Phase 4) ───────────────────────────────────────

  getShadowStrategyConfig(): ShadowStrategyConfig {
    return this.data.shadowStrategyConfig ?? {};
  }

  setShadowStrategyConfig(config: ShadowStrategyConfig): void {
    this.data.shadowStrategyConfig = config;
    this.save();
  }

  // ── Trading Operation Mode & Guardrails (Phase 6) ───────────────────────

  getTradingOperationMode(): TradingOperationMode {
    return this.data.tradingOperationMode ?? 'shadow';
  }
  setTradingOperationMode(mode: TradingOperationMode): void {
    this.data.tradingOperationMode = mode;
    this.save();
  }
  getPromotionGuardrails(): Record<string, unknown> | undefined {
    return this.data.promotionGuardrails;
  }
  setPromotionGuardrails(guardrails: Record<string, unknown>): void {
    this.data.promotionGuardrails = guardrails;
    this.save();
  }

  // ── Venture Discovery ──────────────────────────────────────────────────────

  addVentureProposal(proposal: Record<string, unknown>): void {
    if (!this.data.ventureProposals) this.data.ventureProposals = [];
    this.data.ventureProposals.push(proposal);
    this.save();
  }

  getVentureProposals(): Array<Record<string, unknown>> {
    return this.data.ventureProposals ?? [];
  }

  getVentureProposal(id: string): Record<string, unknown> | undefined {
    return (this.data.ventureProposals ?? []).find(p => p.id === id);
  }

  updateVentureStatus(id: string, status: string): void {
    const p = (this.data.ventureProposals ?? []).find(p => p.id === id);
    if (p) { p.status = status; this.save(); }
  }

  updateVentureProposal(id: string, updates: Record<string, unknown>): void {
    const p = (this.data.ventureProposals ?? []).find(p => p.id === id);
    if (p) { Object.assign(p, updates); this.save(); }
  }

  getVentureTrialStart(): number | undefined {
    return this.data.ventureTrialStart;
  }

  setVentureTrialStart(timestamp: number): void {
    this.data.ventureTrialStart = timestamp;
    this.save();
  }

  getFounderProfile(): Record<string, unknown> | undefined {
    return this.data.founderProfile;
  }

  setFounderProfile(profile: Record<string, unknown>): void {
    this.data.founderProfile = profile;
    this.save();
  }

  // ── Background Agent + Webhook (Phase 1.5) ───────────────────────────────

  getBackgroundLoopEnabled(): boolean {
    return this.get<boolean>('backgroundLoopEnabled', false);
  }
  setBackgroundLoopEnabled(v: boolean): void { this.update('backgroundLoopEnabled', v); }

  getWebhookEnabled(): boolean {
    return this.get<boolean>('webhookEnabled', false);
  }
  setWebhookEnabled(v: boolean): void { this.update('webhookEnabled', v); }

  getWebhookPort(): number {
    return this.get<number>('webhookPort', 3748);
  }
  setWebhookPort(v: number): void { this.update('webhookPort', v); }

  getWebhookToken(): string {
    return this.get<string>('webhookToken', '');
  }
  setWebhookToken(v: string): void { this.update('webhookToken', v); }

  getLastFiredMission(): { id: string; name: string; firedAt: number } | null {
    return this.get<{ id: string; name: string; firedAt: number } | null>('lastFiredMission', null);
  }
  setLastFiredMission(v: { id: string; name: string; firedAt: number }): void {
    this.update('lastFiredMission', v);
  }

  // ── Control Plane (Phase 2) ──────────────────────────────────────────────────

  getControlPlaneEnabled(): boolean {
    return this.get<boolean>('controlPlaneEnabled', false);
  }
  setControlPlaneEnabled(v: boolean): void { this.update('controlPlaneEnabled', v); }

  getControlPlanePort(): number {
    return this.get<number>('controlPlanePort', 18789);
  }
  setControlPlanePort(v: number): void { this.update('controlPlanePort', v); }

  getControlPlaneToken(): string {
    return this.get<string>('controlPlaneToken', '');
  }
  setControlPlaneToken(v: string): void { this.update('controlPlaneToken', v); }

  getControlPlaneLastStartedAt(): number | null {
    return this.get<number | null>('controlPlaneLastStartedAt', null);
  }
  setControlPlaneLastStartedAt(v: number): void { this.update('controlPlaneLastStartedAt', v); }

  // ── Local Model Pipeline (Phase 4) ──────────────────────────────────────────

  getLocalModelEnabled(): boolean { return this.get<boolean>('localModelEnabled', false); }
  setLocalModelEnabled(v: boolean): void { this.update('localModelEnabled', v); }

  getLocalModelBaseUrl(): string { return this.get<string>('localModelBaseUrl', 'http://localhost:11434'); }
  setLocalModelBaseUrl(v: string): void { this.update('localModelBaseUrl', v); }

  getLocalModelName(): string { return this.get<string>('localModelName', ''); }
  setLocalModelName(v: string): void { this.update('localModelName', v); }

  getLocalModelFallback(): boolean { return this.get<boolean>('localModelFallback', true); }
  setLocalModelFallback(v: boolean): void { this.update('localModelFallback', v); }

  // ── Telegram Messaging (Phase 6) ─────────────────────────────────────────────

  getTelegramEnabled(): boolean { return this.get<boolean>('telegramEnabled', false); }
  setTelegramEnabled(v: boolean): void { this.update('telegramEnabled', v); }

  getTelegramAllowedChats(): number[] { return this.get<number[]>('telegramAllowedChats', []); }
  setTelegramAllowedChats(v: number[]): void { this.update('telegramAllowedChats', v); }

  getTelegramBotUsername(): string { return this.get<string>('telegramBotUsername', ''); }
  setTelegramBotUsername(v: string): void { this.update('telegramBotUsername', v); }

  getTelegramLastMessageAt(): number | null { return this.get<number | null>('telegramLastMessageAt', null); }
  setTelegramLastMessageAt(v: number): void { this.update('telegramLastMessageAt', v); }

  // ── Phase 8 — Slack ──────────────────────────────────────────────────────────

  getSlackEnabled(): boolean { return this.get<boolean>('slackEnabled', false); }
  setSlackEnabled(v: boolean): void { this.update('slackEnabled', v); }

  getSlackAllowedChannels(): string[] { return this.get<string[]>('slackAllowedChannels', []); }
  setSlackAllowedChannels(v: string[]): void { this.update('slackAllowedChannels', v); }

  getSlackAllowedUsers(): string[] { return this.get<string[]>('slackAllowedUsers', []); }
  setSlackAllowedUsers(v: string[]): void { this.update('slackAllowedUsers', v); }

  getSlackWorkspaceName(): string { return this.get<string>('slackWorkspaceName', ''); }
  setSlackWorkspaceName(v: string): void { this.update('slackWorkspaceName', v); }

  getSlackBotUserId(): string { return this.get<string>('slackBotUserId', ''); }
  setSlackBotUserId(v: string): void { this.update('slackBotUserId', v); }

  getSlackBotUserName(): string { return this.get<string>('slackBotUserName', ''); }
  setSlackBotUserName(v: string): void { this.update('slackBotUserName', v); }

  getSlackSummaryChannel(): string { return this.get<string>('slackSummaryChannel', ''); }
  setSlackSummaryChannel(v: string): void { this.update('slackSummaryChannel', v); }

  getSlackSummarySchedule(): 'disabled' | 'daily' | 'weekly' {
    return this.get<'disabled' | 'daily' | 'weekly'>('slackSummarySchedule', 'disabled');
  }
  setSlackSummarySchedule(v: 'disabled' | 'daily' | 'weekly'): void { this.update('slackSummarySchedule', v); }

  getSlackLastMessageAt(): number | null { return this.get<number | null>('slackLastMessageAt', null); }
  setSlackLastMessageAt(v: number): void { this.update('slackLastMessageAt', v); }

  // ── Phase 9 — Jira ──────────────────────────────────────────────────────────

  getJiraEnabled(): boolean { return this.get<boolean>('jiraEnabled', false); }
  setJiraEnabled(v: boolean): void { this.update('jiraEnabled', v); }

  getJiraWorkspaceUrl(): string { return this.get<string>('jiraWorkspaceUrl', ''); }
  setJiraWorkspaceUrl(v: string): void { this.update('jiraWorkspaceUrl', v); }

  getJiraEmail(): string { return this.get<string>('jiraEmail', ''); }
  setJiraEmail(v: string): void { this.update('jiraEmail', v); }

  getJiraUserDisplayName(): string { return this.get<string>('jiraUserDisplayName', ''); }
  setJiraUserDisplayName(v: string): void { this.update('jiraUserDisplayName', v); }

  getJiraAllowedProjects(): string[] { return this.get<string[]>('jiraAllowedProjects', []); }
  setJiraAllowedProjects(v: string[]): void { this.update('jiraAllowedProjects', v); }

  getJiraSummarySlackChannel(): string { return this.get<string>('jiraSummarySlackChannel', ''); }
  setJiraSummarySlackChannel(v: string): void { this.update('jiraSummarySlackChannel', v); }

  // ── Phase 10 — Push Notifications ───────────────────────────────────────────

  getPushProvider(): 'ntfy' | 'pushover' | 'disabled' {
    return this.get<'ntfy' | 'pushover' | 'disabled'>('pushProvider', 'disabled');
  }
  setPushProvider(v: 'ntfy' | 'pushover' | 'disabled'): void { this.update('pushProvider', v); }

  getPushNtfyTopic(): string { return this.get<string>('pushNtfyTopic', ''); }
  setPushNtfyTopic(v: string): void { this.update('pushNtfyTopic', v); }

  getPushNtfyServer(): string { return this.get<string>('pushNtfyServer', 'https://ntfy.sh'); }
  setPushNtfyServer(v: string): void { this.update('pushNtfyServer', v); }

  getPushoverUserKey(): string { return this.get<string>('pushoverUserKey', ''); }
  setPushoverUserKey(v: string): void { this.update('pushoverUserKey', v); }

  getPushEventSettings(): Record<string, { enabled: boolean; priority: string }> {
    return this.get<Record<string, { enabled: boolean; priority: string }>>('pushEventSettings', {});
  }
  setPushEventSettings(v: Record<string, { enabled: boolean; priority: string }>): void {
    this.update('pushEventSettings', v);
  }

  // ── Phase 11 — Linear ────────────────────────────────────────────────────────

  getLinearEnabled(): boolean { return this.get<boolean>('linearEnabled', false); }
  setLinearEnabled(v: boolean): void { this.update('linearEnabled', v); }

  getLinearWorkspaceName(): string { return this.get<string>('linearWorkspaceName', ''); }
  setLinearWorkspaceName(v: string): void { this.update('linearWorkspaceName', v); }

  getLinearUserName(): string { return this.get<string>('linearUserName', ''); }
  setLinearUserName(v: string): void { this.update('linearUserName', v); }

  getLinearAllowedTeams(): string[] { return this.get<string[]>('linearAllowedTeams', []); }
  setLinearAllowedTeams(v: string[]): void { this.update('linearAllowedTeams', v); }

  getLinearSummarySlackChannel(): string { return this.get<string>('linearSummarySlackChannel', ''); }
  setLinearSummarySlackChannel(v: string): void { this.update('linearSummarySlackChannel', v); }

  // ── Phase 12 — Discord ───────────────────────────────────────────────────────

  getDiscordEnabled(): boolean { return this.get<boolean>('discordEnabled', false); }
  setDiscordEnabled(v: boolean): void { this.update('discordEnabled', v); }

  getDiscordBotUserId(): string { return this.get<string>('discordBotUserId', ''); }
  setDiscordBotUserId(v: string): void { this.update('discordBotUserId', v); }

  getDiscordBotUserName(): string { return this.get<string>('discordBotUserName', ''); }
  setDiscordBotUserName(v: string): void { this.update('discordBotUserName', v); }

  getDiscordAllowedChannels(): string[] { return this.get<string[]>('discordAllowedChannels', []); }
  setDiscordAllowedChannels(v: string[]): void { this.update('discordAllowedChannels', v); }

  getDiscordAllowedUsers(): string[] { return this.get<string[]>('discordAllowedUsers', []); }
  setDiscordAllowedUsers(v: string[]): void { this.update('discordAllowedUsers', v); }

  getDiscordLastMessageAt(): number | null { return this.get<number | null>('discordLastMessageAt', null); }
  setDiscordLastMessageAt(v: number): void { this.update('discordLastMessageAt', v); }

  // Phase 13 — Automation Recipes
  getRecipeStates(): Record<string, { enabled: boolean; params: Record<string, string>; lastRunAt?: number; lastRunStatus?: 'success' | 'failed' | 'skipped'; lastRunResult?: string }> {
    return this.get('recipeStates', {});
  }
  setRecipeStates(v: Record<string, { enabled: boolean; params: Record<string, string>; lastRunAt?: number; lastRunStatus?: 'success' | 'failed' | 'skipped'; lastRunResult?: string }>): void {
    this.update('recipeStates', v);
  }

  // Phase 16 — Shared Context (Team Memory)
  getSharedContext(): SharedContextData {
    return this.get<SharedContextData>('sharedContext', EMPTY_SHARED_CONTEXT);
  }
  setSharedContext(v: SharedContextData): void {
    this.update('sharedContext', v);
  }

  // ── Phase 17 — TriForge Dispatch (core) ──────────────────────────────────────

  getDispatchEnabled(): boolean { return this.get<boolean>('dispatchEnabled', false); }
  setDispatchEnabled(v: boolean): void { this.update('dispatchEnabled', v); }

  getDispatchPort(): number { return this.get<number>('dispatchPort', 18790); }
  setDispatchPort(v: number): void { this.update('dispatchPort', v); }

  // Kept for backward compat — superseded by RemoteApprovePolicy in Phase 18
  getDispatchAllowRemoteApprove(): boolean { return this.getRemoteApprovePolicy().enabled; }
  setDispatchAllowRemoteApprove(v: boolean): void {
    const p = this.getRemoteApprovePolicy();
    this.setRemoteApprovePolicy({ ...p, enabled: v });
  }

  // ── Phase 18 — Dispatch Security Hardening ────────────────────────────────────

  // Paired devices (session tokens stored here, never exposed to renderer)
  getPairedDevices(): PairedDevice[] {
    return this.get<PairedDevice[]>('dispatchPairedDevices', []);
  }
  setPairedDevices(v: PairedDevice[]): void { this.update('dispatchPairedDevices', v); }

  // Active pairing code (single, replaced on each generate)
  getActivePairingCode(): PairingCode | null {
    return this.get<PairingCode | null>('dispatchPairingCode', null);
  }
  setActivePairingCode(v: PairingCode | null): void { this.update('dispatchPairingCode', v); }

  // Network mode: 'local' | 'lan' | 'remote'
  getDispatchNetworkMode(): NetworkMode {
    return this.get<NetworkMode>('dispatchNetworkMode', 'lan');
  }
  setDispatchNetworkMode(v: NetworkMode): void { this.update('dispatchNetworkMode', v); }

  // Granular remote-approve policy
  getRemoteApprovePolicy(): RemoteApprovePolicy {
    return this.get<RemoteApprovePolicy>('dispatchRemoteApprovePolicy', DEFAULT_APPROVE_POLICY);
  }
  setRemoteApprovePolicy(v: RemoteApprovePolicy): void { this.update('dispatchRemoteApprovePolicy', v); }

  // Session lifetime in minutes (default 7 days)
  getDispatchSessionTtlMinutes(): number {
    return this.get<number>('dispatchSessionTtlMinutes', 10080);
  }
  setDispatchSessionTtlMinutes(v: number): void { this.update('dispatchSessionTtlMinutes', v); }

  // ── Phase 19 — Dispatch Reachability ─────────────────────────────────────────

  /** User-configured public URL for Dispatch (e.g. https://example.trycloudflare.com).
   *  Used in X-Click ntfy headers and shown in AgentHQ for easy copying. */
  getDispatchPublicUrl(): string { return this.get<string>('dispatchPublicUrl', ''); }
  setDispatchPublicUrl(v: string): void { this.update('dispatchPublicUrl', v); }

  /** Phase 21 — remote task workbench. Tasks are capped at 50; oldest pruned on overflow. */
  getDispatchTasks(): import('./dispatchServer').DispatchTask[] {
    return this.get<import('./dispatchServer').DispatchTask[]>('dispatchTasks', []);
  }
  setDispatchTasks(tasks: import('./dispatchServer').DispatchTask[]): void {
    const capped = tasks.length > 50 ? tasks.slice(tasks.length - 50) : tasks;
    this.update('dispatchTasks', capped);
  }

  /** Phase 25 — dispatch threads/inbox. Capped at 30; oldest pruned on overflow. */
  getDispatchThreads(): import('./dispatchServer').DispatchThread[] {
    return this.get<import('./dispatchServer').DispatchThread[]>('dispatchThreads', []);
  }
  setDispatchThreads(threads: import('./dispatchServer').DispatchThread[]): void {
    const capped = threads.length > 30 ? threads.slice(threads.length - 30) : threads;
    this.update('dispatchThreads', capped);
  }

  /** Phase 24 — dispatch bundles. Capped at 100; oldest pruned on overflow. */
  getDispatchBundles(): import('./dispatchServer').DispatchArtifactBundle[] {
    return this.get<import('./dispatchServer').DispatchArtifactBundle[]>('dispatchBundles', []);
  }
  setDispatchBundles(bundles: import('./dispatchServer').DispatchArtifactBundle[]): void {
    const capped = bundles.length > 100 ? bundles.slice(bundles.length - 100) : bundles;
    this.update('dispatchBundles', capped);
  }

  /** Phase 23 — dispatch artifacts. Capped at 200; oldest pruned on overflow. */
  getDispatchArtifacts(): import('./dispatchServer').DispatchArtifact[] {
    return this.get<import('./dispatchServer').DispatchArtifact[]>('dispatchArtifacts', []);
  }
  setDispatchArtifacts(arts: import('./dispatchServer').DispatchArtifact[]): void {
    const capped = arts.length > 200 ? arts.slice(arts.length - 200) : arts;
    this.update('dispatchArtifacts', capped);
  }

  // ── Phase 28 — Workspace integration configs ──────────────────────────────────

  getWorkspaceIntegration(name: string): WorkspaceIntegrationConfig | null {
    const all = this.get<Record<string, WorkspaceIntegrationConfig>>('wsIntegrations', {});
    return all[name] ?? null;
  }
  setWorkspaceIntegration(name: string, config: WorkspaceIntegrationConfig): void {
    const all = this.get<Record<string, WorkspaceIntegrationConfig>>('wsIntegrations', {});
    all[name] = config;
    this.update('wsIntegrations', all);
  }
  deleteWorkspaceIntegration(name: string): void {
    const all = this.get<Record<string, WorkspaceIntegrationConfig>>('wsIntegrations', {});
    delete all[name];
    this.update('wsIntegrations', all);
  }
  getAllWorkspaceIntegrations(): Record<string, WorkspaceIntegrationConfig> {
    return this.get<Record<string, WorkspaceIntegrationConfig>>('wsIntegrations', {});
  }

  // ── Phase 29 — Workspace approval matrix (stored as raw array; engine provides defaults) ──

  getApprovalMatrix(): import('./workspacePolicyEngine').WorkspaceApprovalRule[] | null {
    return this.get<import('./workspacePolicyEngine').WorkspaceApprovalRule[] | null>('wsApprovalMatrix', null);
  }
  setApprovalMatrix(rules: import('./workspacePolicyEngine').WorkspaceApprovalRule[]): void {
    this.update('wsApprovalMatrix', rules);
  }
  resetApprovalMatrix(): void {
    this.update('wsApprovalMatrix', null);
  }

  // ── Phase 28 — Workspace recipe scope ─────────────────────────────────────────

  getWorkspaceRecipeScopes(): Record<string, 'personal' | 'workspace'> {
    return this.get<Record<string, 'personal' | 'workspace'>>('wsRecipeScopes', {});
  }
  setWorkspaceRecipeScope(recipeId: string, scope: 'personal' | 'workspace'): void {
    const all = this.getWorkspaceRecipeScopes();
    all[recipeId] = scope;
    this.update('wsRecipeScopes', all);
  }

  /** Phase 27 — workspace. Singleton object; null if not yet created. */
  getWorkspace(): import('./dispatchServer').Workspace | null {
    return this.get<import('./dispatchServer').Workspace | null>('workspace', null);
  }
  setWorkspace(ws: import('./dispatchServer').Workspace | null): void {
    this.update('workspace', ws);
  }

  // ── Phase 31 — Runbooks + Incident mode ──────────────────────────────────────

  getRunbooks(): import('./runbooks').RunbookDef[] {
    return this.get<import('./runbooks').RunbookDef[]>('wsRunbooks', []);
  }
  getRunbook(id: string): import('./runbooks').RunbookDef | null {
    return this.getRunbooks().find(r => r.id === id) ?? null;
  }
  saveRunbook(def: import('./runbooks').RunbookDef): void {
    const all = this.getRunbooks();
    const idx = all.findIndex(r => r.id === def.id);
    if (idx >= 0) all[idx] = def; else all.push(def);
    this.update('wsRunbooks', all);
  }
  deleteRunbook(id: string): boolean {
    const all = this.getRunbooks();
    const idx = all.findIndex(r => r.id === id);
    if (idx < 0) return false;
    all.splice(idx, 1);
    this.update('wsRunbooks', all);
    return true;
  }

  getRunbookExecutions(limit = 50): import('./runbooks').RunbookExecution[] {
    return this.get<import('./runbooks').RunbookExecution[]>('wsRunbookExecutions', []).slice(-limit);
  }
  saveRunbookExecution(exec: import('./runbooks').RunbookExecution): void {
    const all = this.get<import('./runbooks').RunbookExecution[]>('wsRunbookExecutions', []);
    const idx = all.findIndex(e => e.id === exec.id);
    if (idx >= 0) all[idx] = exec; else all.push(exec);
    // Keep last 200 executions
    if (all.length > 200) all.splice(0, all.length - 200);
    this.update('wsRunbookExecutions', all);
  }

  getIncidentMode(): import('./runbooks').IncidentModeState {
    return this.get<import('./runbooks').IncidentModeState>('wsIncidentMode', { active: false });
  }
  setIncidentMode(state: import('./runbooks').IncidentModeState): void {
    this.update('wsIncidentMode', state);
  }

  // ── Phase 32 — Human handoff queue ───────────────────────────────────────────

  getHandoffQueue(): import('./runbooks').HandoffQueueItem[] {
    return this.get<import('./runbooks').HandoffQueueItem[]>('wsHandoffQueue', []);
  }
  addHandoffItem(item: import('./runbooks').HandoffQueueItem): void {
    const all = this.getHandoffQueue();
    all.push(item);
    // Keep last 500 items
    if (all.length > 500) all.splice(0, all.length - 500);
    this.update('wsHandoffQueue', all);
  }
  resolveHandoffItem(id: string, resolution: string, resolvedBy?: string): boolean {
    const all = this.getHandoffQueue();
    const item = all.find(h => h.id === id);
    if (!item) return false;
    item.status     = 'resolved';
    item.resolution = resolution;
    item.resolvedAt = Date.now();
    if (resolvedBy) item.resolvedBy = resolvedBy;
    this.update('wsHandoffQueue', all);
    return true;
  }
  patchHandoffItem(id: string, patch: Partial<import('./runbooks').HandoffQueueItem>): boolean {
    const all  = this.getHandoffQueue();
    const item = all.find(h => h.id === id);
    if (!item) return false;
    Object.assign(item, patch);
    this.update('wsHandoffQueue', all);
    return true;
  }

  removeHandoffItem(id: string): boolean {
    const all = this.getHandoffQueue();
    const idx = all.findIndex(h => h.id === id);
    if (idx < 0) return false;
    all.splice(idx, 1);
    this.update('wsHandoffQueue', all);
    return true;
  }

  // ── Phase 35 — Runbook pack registry ─────────────────────────────────────────

  getPacks(): import('./runbookPack').PackRegistryEntry[] {
    return this.get<import('./runbookPack').PackRegistryEntry[]>('wsPacks', []);
  }
  getPack(packId: string): import('./runbookPack').PackRegistryEntry | null {
    return this.getPacks().find(p => p.packId === packId) ?? null;
  }
  savePack(entry: import('./runbookPack').PackRegistryEntry): void {
    const all = this.getPacks();
    const idx = all.findIndex(p => p.packId === entry.packId);
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    this.update('wsPacks', all);
  }
  deletePack(packId: string): boolean {
    const all = this.getPacks();
    const idx = all.findIndex(p => p.packId === packId);
    if (idx < 0) return false;
    all.splice(idx, 1);
    this.update('wsPacks', all);
    return true;
  }

  // ── Phase 36 — Pack trust: signers + policy ───────────────────────────────────

  getTrustedSigners(): import('./runbookPack').TrustedSigner[] {
    return this.get<import('./runbookPack').TrustedSigner[]>('packTrustedSigners', []);
  }
  saveTrustedSigner(signer: import('./runbookPack').TrustedSigner): void {
    const all = this.getTrustedSigners();
    const idx = all.findIndex(s => s.keyId === signer.keyId);
    if (idx >= 0) all[idx] = signer; else all.push(signer);
    this.update('packTrustedSigners', all);
  }
  removeTrustedSigner(keyId: string): boolean {
    const all = this.getTrustedSigners();
    const idx = all.findIndex(s => s.keyId === keyId);
    if (idx < 0) return false;
    all.splice(idx, 1);
    this.update('packTrustedSigners', all);
    return true;
  }
  revokeTrustedSigner(keyId: string): boolean {
    const all = this.getTrustedSigners();
    const s = all.find(x => x.keyId === keyId);
    if (!s) return false;
    s.revoked = true;
    this.update('packTrustedSigners', all);
    return true;
  }
  getPackTrustPolicy(): import('./runbookPack').PackTrustPolicy {
    return this.get<import('./runbookPack').PackTrustPolicy>('packTrustPolicy', {
      allowUnsigned: true,
      allowUnknownSigners: true,
      requireAdminApprovalForInstall: false,
      requireConfirmOnRiskIncrease: false,
      blockNewDestinations: false,
    });
  }
  setPackTrustPolicy(policy: import('./runbookPack').PackTrustPolicy): void {
    this.update('packTrustPolicy', policy);
  }

  // ── Phase 38 — Org config + policy ───────────────────────────────────────────

  getOrgConfig(): import('./orgConfig').OrgConfig | null {
    return this.get<import('./orgConfig').OrgConfig | null>('orgConfig', null);
  }
  setOrgConfig(config: import('./orgConfig').OrgConfig): void {
    this.update('orgConfig', config);
  }
  getOrgPolicy(): import('./orgConfig').OrgPolicy {
    return this.get<import('./orgConfig').OrgPolicy>('orgPolicy', { ...require('./orgConfig').DEFAULT_ORG_POLICY });
  }
  setOrgPolicy(policy: import('./orgConfig').OrgPolicy): void {
    this.update('orgPolicy', policy);
  }

  // ── Phase 30 — Workspace automation governance ───────────────────────────────

  getRecipePolicy(recipeId: string): WorkspaceRecipePolicy | null {
    const all = this.get<Record<string, WorkspaceRecipePolicy>>('wsRecipePolicies', {});
    return all[recipeId] ?? null;
  }
  setRecipePolicy(recipeId: string, policy: WorkspaceRecipePolicy): void {
    const all = this.get<Record<string, WorkspaceRecipePolicy>>('wsRecipePolicies', {});
    all[recipeId] = policy;
    this.update('wsRecipePolicies', all);
  }
  deleteRecipePolicy(recipeId: string): void {
    const all = this.get<Record<string, WorkspaceRecipePolicy>>('wsRecipePolicies', {});
    delete all[recipeId];
    this.update('wsRecipePolicies', all);
  }
  getAllRecipePolicies(): Record<string, WorkspaceRecipePolicy> {
    return this.get<Record<string, WorkspaceRecipePolicy>>('wsRecipePolicies', {});
  }

  getDelegatedOperators(): DelegatedOperator[] {
    return this.get<DelegatedOperator[]>('wsDelegatedOperators', []);
  }
  setDelegatedOperator(op: DelegatedOperator): void {
    const all = this.getDelegatedOperators();
    const idx = all.findIndex(o => o.deviceId === op.deviceId);
    if (idx >= 0) all[idx] = op; else all.push(op);
    this.update('wsDelegatedOperators', all);
  }
  revokeDelegatedOperator(deviceId: string): boolean {
    const all = this.getDelegatedOperators();
    const idx = all.findIndex(o => o.deviceId === deviceId);
    if (idx < 0) return false;
    all.splice(idx, 1);
    this.update('wsDelegatedOperators', all);
    return true;
  }

  getWorkspaceAutomationPolicy(): WorkspaceAutomationPolicy {
    return this.get<WorkspaceAutomationPolicy>('wsAutomationPolicy', DEFAULT_AUTOMATION_POLICY);
  }
  setWorkspaceAutomationPolicy(policy: WorkspaceAutomationPolicy): void {
    this.update('wsAutomationPolicy', policy);
  }

  close(): void { /* no-op for file store */ }
}
