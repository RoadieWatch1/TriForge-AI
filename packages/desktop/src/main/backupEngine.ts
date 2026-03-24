/**
 * backupEngine.ts — Phase 40
 *
 * Backup / restore / snapshot for TriForge AI configuration.
 *
 * Design decisions:
 *   - Secrets (API keys, tokens, PIN hash) are NEVER included in backup files.
 *   - Backup files carry a schema version so restore can detect incompatible formats.
 *   - Snapshots are stored in the KV store (max 5, oldest pruned). They capture
 *     mutable config state immediately before a major mutation so the user can roll back.
 *   - Restore is non-destructive by default: it merges the backup over current state
 *     and writes a pre-restore snapshot so the user can undo the restore.
 */

import fs from 'fs';
import path from 'path';
import { dialog, app } from 'electron';
import type { Store } from './store';

// ── Manifest ──────────────────────────────────────────────────────────────────

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupManifest {
  _type:               'triforge-backup';
  schemaVersion:       number;
  appVersion:          string;
  createdAt:           number;
  label?:              string;
  includesSecrets:     false;          // always false — secrets never exported
  data:                BackupData;
}

/** All non-secret, non-credential data worth preserving. */
export interface BackupData {
  // Identity
  userProfile:      Record<string, string>;
  activeProfileId:  string | null;
  permissions:      Record<string, { granted: boolean; budgetLimit?: number; requireConfirm: boolean }>;
  memory:           Array<{ id: number; type: string; content: string; created_at: number; source?: string }>;

  // Workspace
  workspace:         unknown | null;
  wsIntegrations:    Record<string, unknown>;
  wsApprovalMatrix:  unknown | null;
  wsRecipeScopes:    Record<string, string>;

  // Runbooks + packs
  runbooks:          unknown[];
  runbookPacks:      unknown[];           // registry entries (no runbook content — runbooks above)
  trustedSigners:    unknown[];
  packTrustPolicy:   unknown;

  // Automation
  recipeStates:      Record<string, unknown>;
  sharedContext:     unknown;

  // Integration config (non-secret flags + metadata)
  slack: {
    enabled: boolean; allowedChannels: string[]; allowedUsers: string[];
    workspaceName: string; summaryChannel: string; summarySchedule: string;
  };
  jira: {
    enabled: boolean; workspaceUrl: string; email: string;
    userDisplayName: string; allowedProjects: string[];
  };
  linear: {
    enabled: boolean; workspaceName: string; userName: string; allowedTeams: string[];
  };
  discord: {
    enabled: boolean; allowedChannels: string[]; allowedUsers: string[];
  };
  telegram: {
    enabled: boolean; allowedChats: number[];
  };

  // Dispatch (non-secret)
  dispatch: {
    enabled: boolean; port: number; networkMode: string;
    sessionTtlMinutes: number; publicUrl: string;
  };

  // Push notifications (non-secret)
  push: {
    provider: string; ntfyTopic: string; ntfyServer: string;
    eventSettings: Record<string, unknown>;
  };

  // Background services
  backgroundLoop: { enabled: boolean };
  webhook:        { enabled: boolean; port: number };
  controlPlane:   { enabled: boolean; port: number };
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface StoreSnapshot {
  id:        string;
  label:     string;
  createdAt: number;
  trigger:   string;    // e.g. 'pack:install', 'workspace:policy:update', 'manual'
  data:      BackupData;
}

const SNAPSHOTS_KEY  = 'storeSnapshots';
const MAX_SNAPSHOTS  = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectBackupData(store: Store): BackupData {
  return {
    userProfile:     store.getUserProfile(),
    activeProfileId: store.getActiveProfileId(),
    permissions:     Object.fromEntries(
      store.getPermissions().map(p => [p.key, { granted: p.granted, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm }])
    ),
    memory:          store.getMemory(100),

    workspace:        store.getWorkspace(),
    wsIntegrations:   store.getAllWorkspaceIntegrations(),
    wsApprovalMatrix: store.getApprovalMatrix(),
    wsRecipeScopes:   store.getWorkspaceRecipeScopes(),

    runbooks:      store.getRunbooks(),
    runbookPacks:  store.getPacks(),
    trustedSigners: store.getTrustedSigners(),
    packTrustPolicy: store.getPackTrustPolicy(),

    recipeStates: store.getRecipeStates(),
    sharedContext: store.getSharedContext(),

    slack: {
      enabled:         store.getSlackEnabled(),
      allowedChannels: store.getSlackAllowedChannels(),
      allowedUsers:    store.getSlackAllowedUsers(),
      workspaceName:   store.getSlackWorkspaceName(),
      summaryChannel:  store.getSlackSummaryChannel(),
      summarySchedule: store.getSlackSummarySchedule(),
    },
    jira: {
      enabled:          store.getJiraEnabled(),
      workspaceUrl:     store.getJiraWorkspaceUrl(),
      email:            store.getJiraEmail(),
      userDisplayName:  store.getJiraUserDisplayName(),
      allowedProjects:  store.getJiraAllowedProjects(),
    },
    linear: {
      enabled:       store.getLinearEnabled(),
      workspaceName: store.getLinearWorkspaceName(),
      userName:      store.getLinearUserName(),
      allowedTeams:  store.getLinearAllowedTeams(),
    },
    discord: {
      enabled:         store.getDiscordEnabled(),
      allowedChannels: store.getDiscordAllowedChannels(),
      allowedUsers:    store.getDiscordAllowedUsers(),
    },
    telegram: {
      enabled:      store.getTelegramEnabled(),
      allowedChats: store.getTelegramAllowedChats(),
    },
    dispatch: {
      enabled:            store.getDispatchEnabled(),
      port:               store.getDispatchPort(),
      networkMode:        store.getDispatchNetworkMode(),
      sessionTtlMinutes:  store.getDispatchSessionTtlMinutes(),
      publicUrl:          store.getDispatchPublicUrl(),
    },
    push: {
      provider:      store.getPushProvider(),
      ntfyTopic:     store.getPushNtfyTopic(),
      ntfyServer:    store.getPushNtfyServer(),
      eventSettings: store.getPushEventSettings(),
    },
    backgroundLoop: { enabled: store.getBackgroundLoopEnabled() },
    webhook:        { enabled: store.getWebhookEnabled(), port: store.getWebhookPort() },
    controlPlane:   { enabled: store.getControlPlaneEnabled(), port: store.getControlPlanePort() },
  };
}

function applyBackupData(data: BackupData, store: Store): void {
  // Permissions
  for (const [key, val] of Object.entries(data.permissions ?? {})) {
    try { store.setPermission(key, val.granted, val.budgetLimit); } catch { /* unknown key — skip */ }
  }

  // User profile
  if (data.userProfile) store.setUserProfile(data.userProfile);
  if ('activeProfileId' in data) store.setActiveProfileId(data.activeProfileId);

  // Memory (merge, deduplicate by id)
  if (Array.isArray(data.memory)) {
    const existing = store.getMemory(200);
    const existingIds = new Set(existing.map((m: any) => m.id));
    for (const m of data.memory) {
      if (!existingIds.has(m.id)) {
        try { store.addMemory(m.type as any, m.content, m.source); } catch { /* ok */ }
      }
    }
  }

  // Workspace
  if ('workspace' in data) store.setWorkspace(data.workspace as any);
  if (data.wsIntegrations) {
    for (const [name, cfg] of Object.entries(data.wsIntegrations)) {
      store.setWorkspaceIntegration(name, cfg as any);
    }
  }
  if ('wsApprovalMatrix' in data && data.wsApprovalMatrix) store.setApprovalMatrix(data.wsApprovalMatrix as any);
  if (data.wsRecipeScopes) {
    for (const [id, scope] of Object.entries(data.wsRecipeScopes)) {
      store.setWorkspaceRecipeScope(id, scope as any);
    }
  }

  // Runbooks
  if (Array.isArray(data.runbooks)) {
    for (const rb of data.runbooks) { try { store.saveRunbook(rb as any); } catch { /* ok */ } }
  }

  // Packs (registry entries only — runbook content already restored above)
  if (Array.isArray(data.runbookPacks)) {
    for (const p of data.runbookPacks) { try { store.savePack(p as any); } catch { /* ok */ } }
  }

  // Trust
  if (Array.isArray(data.trustedSigners)) {
    for (const s of data.trustedSigners) { try { store.saveTrustedSigner(s as any); } catch { /* ok */ } }
  }
  if (data.packTrustPolicy) store.setPackTrustPolicy(data.packTrustPolicy as any);

  // Recipe states
  if (data.recipeStates) store.setRecipeStates(data.recipeStates as any);
  if (data.sharedContext) store.setSharedContext(data.sharedContext as any);

  // Integrations
  if (data.slack) {
    store.setSlackEnabled(data.slack.enabled);
    if (data.slack.allowedChannels) store.setSlackAllowedChannels(data.slack.allowedChannels);
    if (data.slack.allowedUsers)    store.setSlackAllowedUsers(data.slack.allowedUsers);
    if (data.slack.workspaceName)   store.setSlackWorkspaceName(data.slack.workspaceName);
    if (data.slack.summaryChannel)  store.setSlackSummaryChannel(data.slack.summaryChannel);
    if (data.slack.summarySchedule) store.setSlackSummarySchedule(data.slack.summarySchedule as any);
  }
  if (data.jira) {
    store.setJiraEnabled(data.jira.enabled);
    if (data.jira.workspaceUrl)    store.setJiraWorkspaceUrl(data.jira.workspaceUrl);
    if (data.jira.email)           store.setJiraEmail(data.jira.email);
    if (data.jira.userDisplayName) store.setJiraUserDisplayName(data.jira.userDisplayName);
    if (data.jira.allowedProjects) store.setJiraAllowedProjects(data.jira.allowedProjects);
  }
  if (data.linear) {
    store.setLinearEnabled(data.linear.enabled);
    if (data.linear.workspaceName) store.setLinearWorkspaceName(data.linear.workspaceName);
    if (data.linear.userName)      store.setLinearUserName(data.linear.userName);
    if (data.linear.allowedTeams)  store.setLinearAllowedTeams(data.linear.allowedTeams);
  }
  if (data.discord) {
    store.setDiscordEnabled(data.discord.enabled);
    if (data.discord.allowedChannels) store.setDiscordAllowedChannels(data.discord.allowedChannels);
    if (data.discord.allowedUsers)    store.setDiscordAllowedUsers(data.discord.allowedUsers);
  }
  if (data.telegram) {
    store.setTelegramEnabled(data.telegram.enabled);
    if (data.telegram.allowedChats) store.setTelegramAllowedChats(data.telegram.allowedChats);
  }
  if (data.dispatch) {
    store.setDispatchEnabled(data.dispatch.enabled);
    if (data.dispatch.port)               store.setDispatchPort(data.dispatch.port);
    if (data.dispatch.networkMode)        store.setDispatchNetworkMode(data.dispatch.networkMode as any);
    if (data.dispatch.sessionTtlMinutes)  store.setDispatchSessionTtlMinutes(data.dispatch.sessionTtlMinutes);
    if (data.dispatch.publicUrl !== undefined) store.setDispatchPublicUrl(data.dispatch.publicUrl);
  }
  if (data.push) {
    store.setPushProvider(data.push.provider as any);
    if (data.push.ntfyTopic)     store.setPushNtfyTopic(data.push.ntfyTopic);
    if (data.push.ntfyServer)    store.setPushNtfyServer(data.push.ntfyServer);
    if (data.push.eventSettings) store.setPushEventSettings(data.push.eventSettings as any);
  }
  if (data.backgroundLoop) store.setBackgroundLoopEnabled(data.backgroundLoop.enabled);
  if (data.webhook) {
    store.setWebhookEnabled(data.webhook.enabled);
    if (data.webhook.port) store.setWebhookPort(data.webhook.port);
  }
  if (data.controlPlane) {
    store.setControlPlaneEnabled(data.controlPlane.enabled);
    if (data.controlPlane.port) store.setControlPlanePort(data.controlPlane.port);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a backup file. Opens a save dialog. Returns the file path on success. */
export async function createBackupFile(store: Store, label?: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const win  = require('electron').BrowserWindow.getFocusedWindow();
  const ts   = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const opts = { title: 'Save TriForge Backup', defaultPath: `triforge-backup-${ts}.json`, filters: [{ name: 'TriForge Backup', extensions: ['json'] }] };
  const result = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts));
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };

  try {
    const manifest: BackupManifest = {
      _type:           'triforge-backup',
      schemaVersion:   BACKUP_SCHEMA_VERSION,
      appVersion:      app.getVersion(),
      createdAt:       Date.now(),
      label,
      includesSecrets: false,
      data:            collectBackupData(store),
    };
    fs.writeFileSync(result.filePath, JSON.stringify(manifest, null, 2), 'utf8');

    // Record last backup timestamp
    store.update('lastBackupAt', Date.now());

    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Restore from a backup file. Opens an open dialog. */
export async function restoreBackupFile(store: Store): Promise<{
  ok: boolean;
  label?: string;
  createdAt?: number;
  error?: string;
}> {
  const win  = require('electron').BrowserWindow.getFocusedWindow();
  const opts = { title: 'Restore TriForge Backup', filters: [{ name: 'TriForge Backup', extensions: ['json'] }], properties: ['openFile'] as const };
  const result = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
  if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Cancelled' };

  return restoreBackupFromPath(store, result.filePaths[0]);
}

export async function restoreBackupFromPath(store: Store, filePath: string): Promise<{
  ok: boolean;
  label?: string;
  createdAt?: number;
  error?: string;
}> {
  try {
    const raw      = fs.readFileSync(filePath, 'utf8');
    const manifest = JSON.parse(raw) as BackupManifest;

    if (manifest._type !== 'triforge-backup') return { ok: false, error: 'Not a TriForge backup file' };
    if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
      return { ok: false, error: `Backup was created with a newer version of TriForge (schema v${manifest.schemaVersion})` };
    }
    if (!manifest.data) return { ok: false, error: 'Backup file is missing data payload' };

    // Create pre-restore snapshot so the user can undo
    await createSnapshot(store, 'pre-restore', `Before restore from ${path.basename(filePath)}`);

    applyBackupData(manifest.data, store);

    return { ok: true, label: manifest.label, createdAt: manifest.createdAt };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Get the timestamp of the most recent successful backup. */
export function getLastBackupAt(store: Store): number | null {
  return store.get<number | null>('lastBackupAt', null);
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export function listSnapshots(store: Store): StoreSnapshot[] {
  return store.get<StoreSnapshot[]>(SNAPSHOTS_KEY, []);
}

/** Create a named restore point. Call this immediately before a major mutation. */
export async function createSnapshot(store: Store, trigger: string, label: string): Promise<StoreSnapshot> {
  const snapshot: StoreSnapshot = {
    id:        `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    createdAt: Date.now(),
    trigger,
    data:      collectBackupData(store),
  };

  const all = listSnapshots(store);
  all.unshift(snapshot);
  // Keep most recent MAX_SNAPSHOTS
  if (all.length > MAX_SNAPSHOTS) all.splice(MAX_SNAPSHOTS);
  store.update(SNAPSHOTS_KEY, all);

  return snapshot;
}

/** Restore store state from a specific snapshot. Creates a pre-rollback snapshot first. */
export async function rollbackSnapshot(store: Store, snapshotId: string): Promise<{ ok: boolean; error?: string }> {
  const all = listSnapshots(store);
  const snap = all.find(s => s.id === snapshotId);
  if (!snap) return { ok: false, error: 'Snapshot not found' };

  // Safety: snapshot the current state before overwriting
  const current: StoreSnapshot = {
    id:        `snap_${Date.now()}_prerollback`,
    label:     `Before rollback to "${snap.label}"`,
    createdAt: Date.now(),
    trigger:   'pre-rollback',
    data:      collectBackupData(store),
  };
  all.unshift(current);
  if (all.length > MAX_SNAPSHOTS) all.splice(MAX_SNAPSHOTS);
  store.update(SNAPSHOTS_KEY, all);

  applyBackupData(snap.data, store);
  return { ok: true };
}

/** Delete a snapshot by ID. */
export function deleteSnapshot(store: Store, snapshotId: string): boolean {
  const all = listSnapshots(store).filter(s => s.id !== snapshotId);
  store.update(SNAPSHOTS_KEY, all);
  return true;
}

// ── Crash guard ───────────────────────────────────────────────────────────────

export interface ServiceIncident {
  serviceId:  string;
  label:      string;
  crashCount: number;
  lastCrashAt: number;
  disabled:   boolean;
  suggestion: string;
}

const INCIDENTS_KEY = 'serviceIncidents';

export function getIncidents(store: Store): ServiceIncident[] {
  return store.get<ServiceIncident[]>(INCIDENTS_KEY, []);
}

export function recordCrash(store: Store, serviceId: string, label: string, suggestion: string): ServiceIncident {
  const incidents = getIncidents(store);
  const idx = incidents.findIndex(i => i.serviceId === serviceId);
  if (idx >= 0) {
    incidents[idx].crashCount++;
    incidents[idx].lastCrashAt = Date.now();
    if (incidents[idx].crashCount >= 3) incidents[idx].disabled = true;
    store.update(INCIDENTS_KEY, incidents);
    return incidents[idx];
  }
  const incident: ServiceIncident = {
    serviceId, label,
    crashCount:  1,
    lastCrashAt: Date.now(),
    disabled:    false,
    suggestion,
  };
  incidents.push(incident);
  store.update(INCIDENTS_KEY, incidents);
  return incident;
}

export function resetIncident(store: Store, serviceId: string): boolean {
  const incidents = getIncidents(store).filter(i => i.serviceId !== serviceId);
  store.update(INCIDENTS_KEY, incidents);
  return true;
}

export function isServiceDisabled(store: Store, serviceId: string): boolean {
  return getIncidents(store).some(i => i.serviceId === serviceId && i.disabled);
}
