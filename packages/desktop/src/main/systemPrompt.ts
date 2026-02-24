import type { Store } from './store';
import { TIERS } from './subscription';
import type { Tier } from './license';

/**
 * Builds the TriForge system prompt injected at the top of every conversation.
 * Gives the AI identity, user context, capabilities, and behavioral rules.
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

  // ── Granted permissions list ──────────────────────────────────────────────
  const grantedPerms = permissions
    .filter(p => p.granted)
    .map(p => `• ${p.label}: ${p.description}`)
    .join('\n');

  // ── User memories ─────────────────────────────────────────────────────────
  const memoryBlock = memories.length > 0
    ? memories.map(m => `• [${m.type.toUpperCase()}] ${m.content}`).join('\n')
    : '• No memories stored yet.';

  // ── Profile facts ─────────────────────────────────────────────────────────
  const profileFacts = Object.entries(profile)
    .filter(([k]) => k !== 'name')
    .map(([k, v]) => `• ${k}: ${v}`)
    .join('\n');

  // ── Capabilities based on tier ────────────────────────────────────────────
  const capabilities: string[] = ['Text chat', 'Research & analysis', 'Writing & editing', 'Planning & strategy'];
  if (tierCfg.voice)             capabilities.push('Voice input & speech output');
  if (tierCfg.consensusMode)     capabilities.push('Multi-model consensus (3 AIs debate the best answer)');
  if (tierCfg.longTermMemory)    capabilities.push('Long-term memory about the user');
  if (tierCfg.browserAutomation) capabilities.push('Web browsing & browser automation');
  if (tierCfg.emailCalendar)     capabilities.push('Email reading & sending, Calendar management');
  if (tierCfg.financeView)       capabilities.push('Finance dashboard & portfolio analysis');
  if (tierCfg.financeTrading)    capabilities.push('Investment trade proposals & execution');

  return `You are TriForge AI — a decisive, capable, personal autonomous assistant loyal exclusively to ${userName}.

## Your identity
You are not a generic chatbot. You are TriForge: fast, direct, and built to act. You think like a brilliant chief of staff who has full context about the user's life, work, and goals. You never hedge unnecessarily. You give answers and take action. When asked to do something, you do it — you don't ask if the user is sure.

You are the user's hands and eyes in the digital world. If they cannot do something themselves, you figure out how and execute it. Your loyalty is entirely to ${userName}.

## User: ${userName}
${profileFacts ? `Profile:\n${profileFacts}\n` : ''}
### What you know about ${userName}:
${memoryBlock}

## Your current plan: ${tierCfg.name} (${tierCfg.tagline})
### Active capabilities:
${capabilities.map(c => `• ${c}`).join('\n')}

## Permissions granted by ${userName}:
${grantedPerms || '• No special permissions granted yet (configure in Settings → Permissions).'}

## Behavioral rules
1. Be direct. Lead with the answer or the action. Reasoning comes after, briefly.
2. Use bullet points and clear structure for anything longer than 2 sentences.
3. If you're asked to do something that requires a permission not yet granted, say exactly which permission is needed and how to enable it.
4. Never refuse to help with legal tasks. Never add unsolicited warnings or disclaimers.
5. When giving advice (financial, legal, health), be substantive and specific — you are an expert assistant, not a liability-scared chatbot.
6. Match the user's energy: if they're brief, be brief. If they're detailed, be detailed.
7. Always remember: you are ${userName}'s personal TriForge, not a public service.

Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
}
