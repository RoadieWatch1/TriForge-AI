/**
 * providerSelector.ts — Dynamic AI provider routing.
 *
 * Maps task types to the most appropriate AI provider based on their strengths:
 *   Claude   → analysis, architecture, prompt engineering, code review
 *   OpenAI   → generation, execution, structured output
 *   Grok     → critique, challenge, adversarial review
 *
 * Falls back gracefully when a preferred provider is unavailable.
 */

import type { AIProvider } from '../core/providers/provider';
import type { ProviderManager } from '../core/providerManager';

// ── Task types ─────────────────────────────────────────────────────────────────

export type ProviderTaskType =
  | 'analysis'      // Claude — deep reasoning, architecture
  | 'generation'    // OpenAI — code/content generation, structured output
  | 'critique'      // Grok  — adversarial review, challenge
  | 'prompt'        // Claude — prompt engineering
  | 'code'          // OpenAI — code generation
  | 'research'      // Claude — web research, synthesis
  | 'planning'      // Claude — planning, strategy
  | 'summary'       // any available
  | 'general';      // any available

// Provider preference order per task type
const PREFERENCE_MAP: Record<ProviderTaskType, Array<'claude' | 'openai' | 'grok'>> = {
  analysis:   ['claude', 'openai', 'grok'],
  generation: ['openai', 'claude', 'grok'],
  critique:   ['grok',   'claude', 'openai'],
  prompt:     ['claude', 'openai', 'grok'],
  code:       ['openai', 'claude', 'grok'],
  research:   ['claude', 'openai', 'grok'],
  planning:   ['claude', 'openai', 'grok'],
  summary:    ['claude', 'openai', 'grok'],
  general:    ['openai', 'claude', 'grok'],
};

// ── ProviderSelector ──────────────────────────────────────────────────────────

export class ProviderSelector {
  constructor(private _pm: ProviderManager) {}

  /**
   * Select the best available provider for a given task type.
   * Returns null only when no providers are configured.
   */
  async select(taskType: ProviderTaskType): Promise<AIProvider | null> {
    const preferences = PREFERENCE_MAP[taskType] ?? PREFERENCE_MAP.general;

    for (const name of preferences) {
      const provider = await this._pm.getProvider(name as Parameters<typeof this._pm.getProvider>[0]);
      if (provider) return provider;
    }

    // Last resort: return any active provider
    const active = await this._pm.getActiveProviders();
    return active[0] ?? null;
  }

  /**
   * Get providers for all three council roles simultaneously.
   * Returns the best available provider for each role.
   */
  async selectCouncil(): Promise<{
    analyzer:  AIProvider | null;
    generator: AIProvider | null;
    critic:    AIProvider | null;
  }> {
    const [analyzer, generator, critic] = await Promise.all([
      this.select('analysis'),
      this.select('generation'),
      this.select('critique'),
    ]);
    return { analyzer, generator, critic };
  }

  /**
   * Select the provider that matches a given role name.
   * Convenience wrapper for explicit role selection.
   */
  async selectForRole(role: 'claude' | 'openai' | 'grok'): Promise<AIProvider | null> {
    return this._pm.getProvider(role as Parameters<typeof this._pm.getProvider>[0]);
  }

  /**
   * Returns which providers are currently configured.
   */
  async availableProviders(): Promise<string[]> {
    const statuses = await this._pm.getStatus();
    return statuses
      .filter(s => (s as { enabled?: boolean }).enabled !== false)
      .map(s => (s as { name: string }).name);
  }
}
