// ── proactiveCouncil.ts ──────────────────────────────────────────────────────
//
// Lightweight engine that occasionally surfaces a helpful suggestion based on
// the user's current active task and recent conversation.
//
// Rules:
//   - 20-minute cooldown between suggestions (prevents spam)
//   - Only fires when an active task context exists
//   - Uses gpt-4o-mini for low latency + cost
//   - If the model returns "null" or nothing useful, stays silent

const COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes between suggestions
let lastSuggestionTime = 0;

/**
 * Evaluate whether a proactive suggestion is appropriate given the current
 * task context and recent conversation. Calls `onSuggestion` if one is found.
 * Fully asynchronous and non-blocking — safe to fire-and-forget.
 */
export async function evaluateProactiveOpportunity(
  task: string | null,
  recentMessages: Array<{ role: string; content: string }>,
  openaiKey: string,
  onSuggestion: (text: string) => void
): Promise<void> {
  if (!task || !openaiKey) return;

  const now = Date.now();
  if (now - lastSuggestionTime < COOLDOWN_MS) return;

  const conversationSnippet = recentMessages
    .slice(-4)
    .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an AI council assistant reviewing an ongoing project. Look at the user's active task and recent conversation. If there is ONE specific, non-obvious, and genuinely helpful suggestion that could meaningfully improve the user's outcome, provide it in a single concise sentence. Be very selective — only suggest when it adds real, specific value. If no strong suggestion is available, respond with exactly: null`,
          },
          {
            role: 'user',
            content: `Active task: ${task}\n\nRecent conversation:\n${conversationSnippet}\n\nOne helpful suggestion, or null:`,
          },
        ],
        max_tokens: 80,
        temperature: 0.4,
      }),
    });

    if (!res.ok) return;

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const suggestion = (data.choices?.[0]?.message?.content ?? '').trim();

    if (suggestion && suggestion.toLowerCase() !== 'null' && suggestion.length > 15) {
      lastSuggestionTime = now;
      onSuggestion(suggestion);
    }
  } catch { /* network error or model unavailable — stay silent */ }
}

/** Reset the cooldown timer (e.g. when active task changes). */
export function resetProactiveCooldown(): void {
  lastSuggestionTime = 0;
}
