// ── awareness/CouncilAwarenessService.ts — Council Context Pack Builder ────────
//
// Pure function layer — no singletons, no side effects.
// Takes the static CapabilityRegistry and a live SystemStateSnapshot,
// produces a compact text addendum injected into every Council system prompt.
//
// Design goals:
//   • < 500 tokens — appended to an already-large system prompt
//   • Truthful — reflects actual live state, never cached assumptions
//   • Actionable — tells Council how to invoke each capability
//   • Self-maintaining — adding a new registry entry automatically surfaces here

import { CAPABILITY_REGISTRY }      from './CapabilityRegistry';
import type { CapabilityDescriptor, SystemStateSnapshot } from './types';

// ── Tier helpers ──────────────────────────────────────────────────────────────

function tierRank(tier: 'free' | 'pro' | 'business'): number {
  return tier === 'free' ? 0 : tier === 'pro' ? 1 : 2;
}

function meetsTier(cap: CapabilityDescriptor, tier: SystemStateSnapshot['tier']): boolean {
  if (!cap.requiresTier) return true;
  return tierRank(tier) >= tierRank(cap.requiresTier);
}

function hasPermission(
  cap: CapabilityDescriptor,
  perms: SystemStateSnapshot['permissions'],
): boolean {
  switch (cap.id) {
    case 'files.organize':
    case 'files.search':
    case 'files.auditFolder': return perms.files;
    case 'files.browser':  return perms.browser;
    case 'files.print':    return perms.printer;
    case 'files.email':    return perms.email;
    default:               return true;
  }
}

function isConfigured(cap: CapabilityDescriptor, s: SystemStateSnapshot): boolean {
  const anyProvider    = Object.values(s.providers).some(Boolean);
  const providerCount  = Object.values(s.providers).filter(Boolean).length;

  switch (cap.id) {
    case 'provider.openai':          return s.providers.openai;
    case 'provider.claude':          return s.providers.claude;
    case 'provider.grok':            return s.providers.grok;
    case 'provider.ollama':          return s.providers.ollama;
    case 'council.consensus':
    case 'council.deliberate':       return providerCount >= 2;
    case 'web.search':               return true;  // always available (DuckDuckGo, no key needed)
    case 'image.generate':           return s.imageReady;
    case 'voice.tts':
    case 'voice.wake':
    case 'voice.chat':               return true;
    case 'mission.engineering':
    case 'mission.context':          return anyProvider;
    case 'autonomy.loop':
    case 'autonomy.workflows':       return true;
    case 'files.organize':
    case 'files.search':
    case 'files.auditFolder':        return s.permissions.files;
    case 'files.browser':            return s.permissions.browser;
    case 'files.print':              return s.permissions.printer;
    case 'files.email':              return s.permissions.email;
    case 'phone.link':               return s.phonePaired;
    case 'memory.user':
    case 'memory.council':           return true;
    case 'forge.profiles':
    case 'forge.blueprint':          return anyProvider;
    case 'tasks.schedule':
    case 'tasks.approval':           return true;
    case 'tasks.agent':              return anyProvider;
    case 'insight.proactive':
    case 'insight.event':            return anyProvider;
    case 'social.twitter':           return s.twitterConfigured;
    case 'trading.tradeDesk':
    case 'trading.liveAdvisor':      return anyProvider;
    case 'trading.shadow':
    case 'trading.analytics':
    case 'trading.refinement':
    case 'trading.explainability':   return s.tradingConnected;
    case 'trading.promotion':        return s.tradingConnected && s.tradingMode !== 'off';
    default:                         return true;
  }
}

function configuredReason(cap: CapabilityDescriptor, s: SystemStateSnapshot): string {
  const count = Object.values(s.providers).filter(Boolean).length;
  switch (cap.id) {
    case 'council.consensus':
    case 'council.deliberate':
      return `${cap.name} (needs 2+ providers — only ${count} configured)`;
    case 'image.generate':
      return `${cap.name} (needs OpenAI or Grok key)`;
    case 'files.auditFolder':
      return `${cap.name} (Files permission not granted — enable in Settings → Permissions)`;
    case 'phone.link':
      return `${cap.name} (not paired — open Phone Link to pair)`;
    case 'social.twitter':
      return `${cap.name} (Twitter credentials not set in Settings)`;
    case 'trading.shadow':
    case 'trading.analytics':
    case 'trading.refinement':
    case 'trading.explainability':
      return `${cap.name} (Tradovate not connected — open Live Trade Advisor to connect)`;
    case 'trading.promotion':
      return `${cap.name} (shadow trading not active — enable shadow trading first)`;
    case 'forge.profiles':
    case 'forge.blueprint':
    case 'mission.engineering':
    case 'mission.context':
    case 'tasks.agent':
    case 'insight.proactive':
    case 'insight.event':
      return `${cap.name} (needs at least one AI provider key)`;
    default:
      return `${cap.name} (not configured)`;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the Council awareness addendum injected into every system prompt.
 *
 * Sections:
 *   1. Live state header — tier, providers, image, phone, autonomy, queues, permissions
 *   2. Available now — ready and not requiring approval
 *   3. Requires approval — available but gated by the approval store
 *   4. Not available — blocked by tier / permission / missing config (with reason)
 *   5. Behavioral rule — prevents hallucination on capability questions
 */
export function buildCouncilAwarenessAddendum(snapshot: SystemStateSnapshot): string {
  const { tier, providers, permissions, autonomyRunning, autonomyWorkflowCount, tradingConnected, tradingMode } = snapshot;

  const activeNames = (Object.entries(providers) as [string, boolean][])
    .filter(([, v]) => v)
    .map(([k]) =>
      k === 'openai' ? 'GPT-4o' :
      k === 'claude' ? 'Claude' :
      k === 'grok'   ? 'Grok'   : 'Ollama',
    );

  const ready:         string[] = [];
  const needsApproval: string[] = [];
  const notAvailable:  string[] = [];

  for (const cap of CAPABILITY_REGISTRY) {
    if (cap.category === 'provider') continue; // summarised in the header line

    if (!meetsTier(cap, tier)) {
      notAvailable.push(`${cap.name} (requires ${cap.requiresTier} tier)`);
    } else if (!hasPermission(cap, permissions)) {
      notAvailable.push(`${cap.name} (permission not granted)`);
    } else if (!isConfigured(cap, snapshot)) {
      notAvailable.push(configuredReason(cap, snapshot));
    } else if (cap.approvalRequired) {
      needsApproval.push(cap.name);
    } else {
      ready.push(cap.name);
    }
  }

  const lines: string[] = [
    '## TriForge Live System State [refreshed every turn — use this, not assumptions]',
    `Tier: ${tier} | Providers: ${activeNames.length > 0 ? activeNames.join(', ') : 'NONE — user must add an API key in Settings'}`,
    `Image: ${snapshot.imageReady ? 'DALL-E 3 ready' : 'not configured'} | ` +
      `Phone: ${snapshot.phonePaired ? 'paired' : 'not paired'} | ` +
      `Voice auth: ${snapshot.voiceAuthConfigured ? 'configured' : 'not set'}`,
    `Autonomy: ${autonomyRunning ? `running (${autonomyWorkflowCount} workflows)` : 'disabled'} | ` +
      `Pending approvals: ${snapshot.pendingApprovals} | Pending tasks: ${snapshot.pendingTasks}`,
    `Trading: ${tradingConnected ? `connected (mode: ${tradingMode})` : 'not connected'} | ` +
      `Shadow: ${tradingMode !== 'off' ? tradingMode : 'disabled'}`,
    `Permissions: Files=${permissions.files ? '✓' : '✗'} ` +
      `Browser=${permissions.browser ? '✓' : '✗'} ` +
      `Printer=${permissions.printer ? '✓' : '✗'} ` +
      `Email=${permissions.email ? '✓' : '✗'}`,
    '',
    `Available now: ${ready.length > 0 ? ready.join(' | ') : 'none'}`,
  ];

  if (needsApproval.length > 0) {
    lines.push(`Requires approval: ${needsApproval.join(' | ')}`);
  }
  if (notAvailable.length > 0) {
    lines.push(`Not available: ${notAvailable.join(' | ')}`);
  }

  lines.push('');
  lines.push(
    'Council rule: answer all capability and status questions from the live state above. ' +
    'Never guess or assume. If something is not available, state the reason shown above.',
  );

  return lines.join('\n');
}
