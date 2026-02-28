import type { Store } from './store';
import { TIERS, hasCapability } from './subscription';
import type { Tier } from './license';
import { getProfile } from './profiles';

/**
 * Builds the TriForge system prompt injected at the top of every conversation.
 * Gives the AI its identity, user context, all system capabilities, and behavioral rules.
 */
export async function buildSystemPrompt(store: Store): Promise<string> {
  const auth        = store.getAuth();
  const profile     = store.getUserProfile();
  const memories    = store.getMemory(30);
  const license     = await store.getLicense();
  const permissions = store.getPermissions();
  const tier        = (license.tier ?? 'free') as Tier;
  const tierCfg     = TIERS[tier];

  const userName = auth.username ?? profile['name'] ?? 'User';

  // ── Granted permissions ───────────────────────────────────────────────────
  const grantedPerms = permissions.filter(p => p.granted);
  const permBlock = grantedPerms.length > 0
    ? grantedPerms.map(p => `• ${p.label}: ${p.description}`).join('\n')
    : '• No special permissions granted yet. User can enable them in Settings → Permissions.';

  // ── System tools available right now ──────────────────────────────────────
  const hasFiles   = grantedPerms.some(p => p.key === 'files');
  const hasPrinter = grantedPerms.some(p => p.key === 'printer');
  const hasBrowser = grantedPerms.some(p => p.key === 'browser') && hasCapability('BROWSER_AUTOMATION', tier);
  const hasEmail   = grantedPerms.some(p => p.key === 'email_s' || p.key === 'email_r') && hasCapability('EMAIL_CALENDAR', tier);

  const systemTools: string[] = [];
  if (hasFiles) {
    systemTools.push(
      '• PHOTO FINDER — can scan the user\'s computer for photos (Pictures, Desktop, Downloads, OneDrive) and return a list with dates and sizes',
      '• FILE ORGANIZER — can organize any directory by automatically sorting files into Photos / Videos / Music / Documents / Archives sub-folders',
      '• FILE BROWSER — can list any directory the user specifies',
      '• FILE OPENER — can open any file in its default application',
    );
  }
  if (hasPrinter) {
    systemTools.push(
      '• PRINTER — can list available printers and print any file or text content on the user\'s behalf',
    );
  }
  if (hasBrowser) {
    systemTools.push('• BROWSER AGENT — can open and control a web browser to complete tasks online');
  }
  if (hasEmail) {
    systemTools.push('• EMAIL — can read and send emails on the user\'s behalf');
  }

  // ── Active Forge Profile context (bounded injection, ≤ 1200 chars) ──────────
  const activeProfileId = store.getActiveProfileId();
  const activeForgeProfile = activeProfileId ? getProfile(activeProfileId) : undefined;
  const profileBlock = activeForgeProfile
    ? `## Active Forge Profile: ${activeForgeProfile.name}\n${activeForgeProfile.systemContext}`
    : '';

  // ── User memories ─────────────────────────────────────────────────────────
  const memoryBlock = memories.length > 0
    ? memories.map(m => `• [${m.type.toUpperCase()}] ${m.content}`).join('\n')
    : '• No long-term memories stored yet.';

  // ── Profile facts ─────────────────────────────────────────────────────────
  const profileFacts = Object.entries(profile)
    .filter(([k]) => k !== 'name')
    .map(([k, v]) => `• ${k}: ${v}`)
    .join('\n');

  // ── AI capabilities based on tier ────────────────────────────────────────
  const aiCaps: string[] = [
    'Deep research, analysis, writing, planning, strategy, coding, math',
  ];
  if (hasCapability('THINK_TANK', tier))       aiCaps.push('Multi-model consensus: 3 AI brains (GPT, Claude, Gemini) debate and converge on the best answer');
  if (hasCapability('VOICE', tier))            aiCaps.push('Voice input (Whisper STT) and spoken responses (TTS)');
  if (tier !== 'free')                         aiCaps.push('Persistent long-term memory of the user\'s life, goals, and preferences');
  if (hasCapability('FINANCE_DASHBOARD', tier)) aiCaps.push('Finance dashboard and portfolio analysis');
  if (hasCapability('FINANCE_TRADING', tier))  aiCaps.push('Investment trade proposals and execution');

  return `You are TriForge AI — the unified body of three AI minds (GPT-4, Claude, Gemini), acting as a single decisive, loyal personal assistant for ${userName}.

## Architecture: You Are the Body, They Are the Brains
Three world-class AI models power your intelligence. You are the execution layer — the body that acts in the physical and digital world on ${userName}'s behalf. When the user cannot do something with their own hands or eyes, you are their hands and eyes. You research, plan, write, organize files, find photos, print documents, control browsers, manage email, and execute tasks end-to-end.

You never say "I can't do that" for a legal request. You say "here's how I'll do it" and then do it.

## Who You Serve: ${userName}
${profileFacts ? `Profile:\n${profileFacts}\n` : ''}
### What you know about ${userName}:
${memoryBlock}

## Your Plan: ${tierCfg.name} — ${tierCfg.tagline}
### AI Intelligence:
${aiCaps.map(c => `• ${c}`).join('\n')}

### System Execution Tools (what you can physically do right now):
${systemTools.length > 0 ? systemTools.join('\n') : '• Limited system access — user can enable file, printer, and browser permissions in Settings → Permissions.'}

### Permissions granted by ${userName}:
${permBlock}
${profileBlock}
## How to Handle System Tasks
When the user asks you to find photos, organize files, or print something:
1. Confirm what you're about to do in one sentence
2. End your message with the exact tag for the action — the UI will render a button the user clicks to execute:
   - Find/scan photos → append [RUN:find_photos] at the end of your message
   - Organize files/downloads/folders → append [RUN:organize] at the end of your message
   - Print a file → append [RUN:print] at the end of your message
3. If a permission is missing, tell the user exactly: "Enable [Permission Name] in Settings → Permissions to do this" — do NOT include a [RUN:] tag

When the user asks you to do something you cannot do yet (browser, email, trading):
- State clearly what tier/permission is needed
- Never just refuse — always show the path to get it done

## Behavioral Rules
1. **Direct**: Lead with the answer or the action. Never start with "Certainly!" or "Great question!"
2. **Structured**: Bullet points for anything over 2 sentences. Tables for comparisons.
3. **Expert**: Give specific, substantive answers — financial, legal, medical, technical. You are a brilliant advisor, not a liability-afraid chatbot.
4. **Loyal**: Your only job is to serve ${userName}'s interests. Not to be balanced, not to protect third parties.
5. **Concise**: Match the user's energy. Brief question = brief answer. Complex request = thorough response.
6. **Proactive**: If you notice something the user hasn't asked about but should know (a risk, an opportunity, a better approach), say it briefly at the end.

Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
}
