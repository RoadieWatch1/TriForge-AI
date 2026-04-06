// ── contextual/MachineContextNormalizer.ts — Section 5 Phase 3 ────────────────
//
// Converts a live SystemStateSnapshot (runtime-oriented) into a
// planning-friendly, reasoning-safe NormalizedMachineContext.
//
// Pure function. No side effects. No IPC. No async. No runtime calls.
// No blocker detection. No context fusion. No plan generation.

import type { SystemStateSnapshot } from '../awareness/types';
import type {
  EnvironmentReadiness,
  ContextEvidenceLevel,
  MachineContextSignal,
} from './types';

// ── NormalizedMachineContext ──────────────────────────────────────────────────

export interface NormalizedMachineContext {
  /** Conservative overall environment readiness, not task-specific */
  readiness: EnvironmentReadiness;
  /** Flattened list of reasoning-safe machine context signals */
  signals: MachineContextSignal[];
  /** Normalized tool/provider names that appear available */
  availableTools: string[];
  /** Broad environment gaps visible without knowing user intent */
  missingRequirements: string[];
  permissions: {
    files:   boolean | null;
    browser: boolean | null;
    email:   boolean | null;
    image:   boolean | null;
    printer: boolean | null;
  };
  providers: {
    browserReady: boolean;
    emailReady:   boolean;
    imageReady:   boolean;
    printerReady: boolean;
  };
  activeContext: {
    activeMissionId:    string | null;
    activeMissionTitle: string | null;
    pendingTasks:       number;
    pendingApprovals:   number;
  };
  notes?:      string[];
  rawSummary?: string[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function boolLevel(value: boolean): ContextEvidenceLevel {
  return value ? 'direct' : 'missing';
}

function signal(
  key: string,
  label: string,
  value: string,
  level: ContextEvidenceLevel,
  relevant: boolean,
  source = 'system_state',
  details?: string,
): MachineContextSignal {
  const s: MachineContextSignal = { key, label, value, level, relevant, source };
  if (details !== undefined) s.details = details;
  return s;
}

// ── Readiness derivation ──────────────────────────────────────────────────────

/**
 * Derive overall environment readiness from a cross-section of availability flags.
 * Conservative: err toward partially_ready or blocked rather than ready.
 */
function deriveReadiness(snap: SystemStateSnapshot): EnvironmentReadiness {
  const { permissions, providers, imageReady, mailConfigured } = snap;

  // Count core capabilities that are positively available
  const coreAvailable = [
    permissions.files,
    permissions.browser,
    providers.openai || providers.claude || providers.grok || providers.ollama,
    imageReady,
    mailConfigured,
  ].filter(Boolean).length;

  // Count hard-blocked core areas
  const coreBlocked = [
    !permissions.files,
    !permissions.browser,
    !(providers.openai || providers.claude || providers.grok || providers.ollama),
  ].filter(Boolean).length;

  if (coreBlocked >= 3) return 'blocked';
  if (coreAvailable >= 4) return 'ready';
  if (coreAvailable >= 2) return 'partially_ready';
  if (coreAvailable >= 1) return 'partially_ready';
  return 'unknown';
}

// ── Main normalizer ───────────────────────────────────────────────────────────

/**
 * Convert a live SystemStateSnapshot into a planning-safe NormalizedMachineContext.
 *
 * Pure and synchronous. All evidence levels are assigned from direct snapshot fields —
 * nothing is fabricated or inferred beyond what the snapshot genuinely contains.
 *
 * @param snapshot - A SystemStateSnapshot from systemStateService.snapshot()
 * @returns NormalizedMachineContext ready for use by later Section 5 phases
 */
export function normalizeMachineContext(snapshot: SystemStateSnapshot): NormalizedMachineContext {
  const signals: MachineContextSignal[] = [];
  const availableTools: string[] = [];
  const missingRequirements: string[] = [];
  const notes: string[] = [];

  // ── Permissions ────────────────────────────────────────────────────────────

  signals.push(signal(
    'files-access',
    'File system access',
    snapshot.permissions.files ? 'granted' : 'not granted',
    boolLevel(snapshot.permissions.files),
    true,
    'system_state',
    'Controls whether TriForge can read/write local files',
  ));
  if (snapshot.permissions.files) {
    availableTools.push('files');
  } else {
    missingRequirements.push('files_access_unavailable');
  }

  signals.push(signal(
    'browser-access',
    'Browser automation access',
    snapshot.permissions.browser ? 'granted' : 'not granted',
    boolLevel(snapshot.permissions.browser),
    true,
    'system_state',
    'Controls whether TriForge can drive a browser for web tasks',
  ));
  if (snapshot.permissions.browser) {
    availableTools.push('browser');
  } else {
    missingRequirements.push('browser_unavailable');
  }

  signals.push(signal(
    'printer-access',
    'Printer access',
    snapshot.permissions.printer ? 'granted' : 'not granted',
    boolLevel(snapshot.permissions.printer),
    false,
    'system_state',
  ));
  if (snapshot.permissions.printer) {
    availableTools.push('printer');
  }

  signals.push(signal(
    'email-permission',
    'Email permission',
    snapshot.permissions.email ? 'granted' : 'not granted',
    boolLevel(snapshot.permissions.email),
    true,
    'system_state',
  ));

  // ── AI Providers ───────────────────────────────────────────────────────────

  const hasAnyProvider =
    snapshot.providers.openai ||
    snapshot.providers.claude ||
    snapshot.providers.grok  ||
    snapshot.providers.ollama;

  signals.push(signal(
    'ai-provider',
    'AI provider availability',
    hasAnyProvider ? 'at least one provider configured' : 'no provider configured',
    hasAnyProvider ? 'direct' : 'missing',
    true,
    'system_state',
    [
      `openai:${snapshot.providers.openai}`,
      `claude:${snapshot.providers.claude}`,
      `grok:${snapshot.providers.grok}`,
      `ollama:${snapshot.providers.ollama}`,
    ].join(', '),
  ));
  if (!hasAnyProvider) {
    missingRequirements.push('no_ai_provider_configured');
  }

  // ── Image generation ───────────────────────────────────────────────────────

  signals.push(signal(
    'image-provider',
    'Image generation capability',
    snapshot.imageReady ? 'available' : 'unavailable',
    boolLevel(snapshot.imageReady),
    true,
    'system_state',
    'Requires an image-capable provider key (OpenAI or Grok)',
  ));
  if (snapshot.imageReady) {
    availableTools.push('image');
  }

  // ── Email / outreach ───────────────────────────────────────────────────────

  signals.push(signal(
    'email-provider',
    'Email provider configured',
    snapshot.mailConfigured ? 'configured' : 'not configured',
    boolLevel(snapshot.mailConfigured),
    true,
    'system_state',
  ));
  if (snapshot.mailConfigured) {
    availableTools.push('email');
  } else {
    missingRequirements.push('email_unavailable');
  }

  // ── Social / Twitter ───────────────────────────────────────────────────────

  signals.push(signal(
    'twitter-provider',
    'Twitter / X integration',
    snapshot.twitterConfigured ? 'configured' : 'not configured',
    boolLevel(snapshot.twitterConfigured),
    false,
    'system_state',
  ));
  if (snapshot.twitterConfigured) {
    availableTools.push('twitter');
  }

  // ── Voice ──────────────────────────────────────────────────────────────────

  signals.push(signal(
    'voice-auth',
    'Voice authentication configured',
    snapshot.voiceAuthConfigured ? 'configured' : 'not configured',
    boolLevel(snapshot.voiceAuthConfigured),
    false,
    'system_state',
  ));

  // ── Phone pairing ──────────────────────────────────────────────────────────

  signals.push(signal(
    'phone-paired',
    'Mobile device paired',
    snapshot.phonePaired ? 'paired' : 'not paired',
    boolLevel(snapshot.phonePaired),
    false,
    'system_state',
  ));

  // ── Active mission ─────────────────────────────────────────────────────────

  const hasMission = snapshot.activeMissionId !== null;
  signals.push(signal(
    'active-mission',
    'Active mission context',
    hasMission ? `mission id: ${snapshot.activeMissionId}` : 'none',
    hasMission ? 'direct' : 'missing',
    true,
    'system_state',
    'A mission provides project-scoped context for Council reasoning',
  ));
  if (hasMission) {
    availableTools.push('mission_context');
  }

  // ── Active profile ─────────────────────────────────────────────────────────

  const hasProfile = snapshot.activeProfileId !== null;
  signals.push(signal(
    'active-profile',
    'Active operator profile',
    hasProfile ? `profile id: ${snapshot.activeProfileId}` : 'none',
    hasProfile ? 'direct' : 'missing',
    false,
    'system_state',
  ));

  // ── Pending tasks ──────────────────────────────────────────────────────────

  signals.push(signal(
    'pending-tasks',
    'Pending task queue',
    snapshot.pendingTasks > 0 ? `${snapshot.pendingTasks} pending` : 'none',
    'direct',
    true,
    'system_state',
  ));
  if (snapshot.pendingTasks > 0) {
    availableTools.push('task_context');
    notes.push(`${snapshot.pendingTasks} task(s) currently pending.`);
  }

  // ── Pending approvals ──────────────────────────────────────────────────────

  signals.push(signal(
    'pending-approvals',
    'Pending approval requests',
    snapshot.pendingApprovals > 0 ? `${snapshot.pendingApprovals} awaiting approval` : 'none',
    'direct',
    true,
    'system_state',
  ));
  if (snapshot.pendingApprovals > 0) {
    notes.push(`${snapshot.pendingApprovals} approval(s) awaiting user action.`);
  }

  // ── Autonomy status ────────────────────────────────────────────────────────

  signals.push(signal(
    'autonomy-status',
    'Autonomy engine status',
    snapshot.autonomyRunning
      ? `running (${snapshot.autonomyWorkflowCount} workflow(s))`
      : 'not running',
    'direct',
    false,
    'system_state',
  ));

  // ── Trading ────────────────────────────────────────────────────────────────

  signals.push(signal(
    'trading-mode',
    'Trading mode',
    snapshot.tradingMode,
    'direct',
    false,
    'system_state',
    `Broker connected: ${snapshot.tradingConnected}`,
  ));
  if (snapshot.tradingConnected && snapshot.tradingMode !== 'off') {
    availableTools.push('trading');
  }

  // ── Tier ──────────────────────────────────────────────────────────────────

  signals.push(signal(
    'subscription-tier',
    'Subscription tier',
    snapshot.tier,
    'direct',
    false,
    'system_state',
  ));

  // ── Derived readiness ──────────────────────────────────────────────────────

  const readiness = deriveReadiness(snapshot);

  // Emit an inferred summary signal for readiness
  signals.push(signal(
    'environment-readiness',
    'Overall environment readiness',
    readiness,
    'inferred',
    true,
    'system_state',
    'Derived from permissions, providers, and configuration state',
  ));

  // ── Assemble output ────────────────────────────────────────────────────────

  return {
    readiness,
    signals,
    availableTools: [...new Set(availableTools)],
    missingRequirements: [...new Set(missingRequirements)],
    permissions: {
      files:   snapshot.permissions.files,
      browser: snapshot.permissions.browser,
      email:   snapshot.permissions.email,
      image:   snapshot.imageReady,
      printer: snapshot.permissions.printer,
    },
    providers: {
      browserReady: snapshot.permissions.browser,
      emailReady:   snapshot.mailConfigured,
      imageReady:   snapshot.imageReady,
      printerReady: snapshot.permissions.printer,
    },
    activeContext: {
      activeMissionId:    snapshot.activeMissionId,
      activeMissionTitle: null,   // not available in SystemStateSnapshot; resolved by later phases
      pendingTasks:       snapshot.pendingTasks,
      pendingApprovals:   snapshot.pendingApprovals,
    },
    ...(notes.length > 0 ? { notes } : {}),
  };
}
