// ── matchCommand.ts — Match text against registered command phrases ───────────
import { CouncilCommands } from './CouncilCommands';

export interface MatchedCommand {
  /** Snake_case command name, e.g. 'mission_fix', 'council_assemble' */
  command: string;
  /** Text after the matched phrase (e.g. "the login bug" from "triforge fix the login bug") */
  payload?: string;
  /** 1.0 = exact phrase match, 0.9 = phrase + trailing payload */
  confidence: number;
}

/**
 * Match raw text against CouncilCommands phrases.
 * Uses longest-phrase-wins to avoid 'council' swallowing 'council assemble'.
 */
export function matchCommand(text: string): MatchedCommand | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  let bestCmd: string | null = null;
  let bestPhrase = '';
  let longestLen = 0;

  for (const [cmd, phrases] of Object.entries(CouncilCommands)) {
    for (const phrase of phrases) {
      const idx = t.indexOf(phrase);
      if (idx !== -1 && phrase.length > longestLen) {
        bestCmd = cmd;
        bestPhrase = phrase;
        longestLen = phrase.length;
      }
    }
  }

  if (!bestCmd) return null;

  // Extract payload: text after the matched phrase (trimmed)
  const idx = t.indexOf(bestPhrase);
  const after = t.slice(idx + bestPhrase.length).trim();
  const payload = after.length > 0 ? after : undefined;
  const confidence = payload ? 0.9 : 1.0;

  return { command: bestCmd, payload, confidence };
}
