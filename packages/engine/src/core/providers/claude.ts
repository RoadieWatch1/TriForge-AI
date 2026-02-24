/**
 * Anthropic Claude Provider — uses Messages API via native fetch.
 */

import { AIProvider, AIProviderConfig, ProviderError, retryWithBackoff } from './provider';
import { ReviewResult } from '../types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = '2023-06-01';

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude' as const;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  private get model(): string {
    return this.config.model || DEFAULT_MODEL;
  }

  private async call(
    systemPrompt: string | null,
    messages: { role: string; content: string }[],
    signal?: AbortSignal
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: 8192,
        messages,
      };
      if (systemPrompt) {
        body.system = systemPrompt;
      }

      let res: Response;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'x-api-key': this.config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: combined,
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new ProviderError('claude', 0, 'Request cancelled or timed out.');
        }
        throw new ProviderError('claude', 0, `Network error: ${err.message}`);
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const retryAfter = res.headers.get('retry-after');
        throw new ProviderError(
          'claude',
          res.status,
          `Claude API error ${res.status}: ${errBody.substring(0, 200)}`,
          retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
        );
      }

      const json: any = await res.json();
      const text = json?.content?.[0]?.text;
      if (!text) {
        throw new ProviderError('claude', 0, 'Claude returned an empty response.');
      }
      return text;
    }, signal);
  }

  async generateResponse(prompt: string, context?: string, signal?: AbortSignal): Promise<string> {
    const system = context ? `Project context:\n${context}` : null;
    return this.call(system, [{ role: 'user', content: prompt }], signal);
  }

  private async callStream(
    systemPrompt: string | null,
    messages: { role: string; content: string }[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8192,
      messages,
      stream: true,
    };
    if (systemPrompt) { body.system = systemPrompt; }

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError('claude', 0, 'Request cancelled or timed out.');
      }
      throw new ProviderError('claude', 0, `Network error: ${err.message}`);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderError('claude', res.status, `Claude API error ${res.status}: ${errBody.substring(0, 200)}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) { continue; }
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') { return full; }
          try {
            const json = JSON.parse(data);
            if (json.type === 'message_stop') { return full; }
            if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
              const text = json.delta.text;
              if (text) { full += text; onChunk(text); }
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError('claude', 0, 'Request cancelled or timed out.');
      }
      throw err;
    }
    return full;
  }

  async generateResponseStream(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: string | undefined,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const system = context ? `Project context:\n${context}` : null;
    return this.callStream(system, history, onChunk, signal);
  }

  async generateDraft(
    userRequest: string,
    filePath: string,
    originalContent: string,
    context: string,
    previousFeedback: string | null,
    signal?: AbortSignal
  ): Promise<string> {
    const system = `You are a code builder. Output ONLY the complete file content, no markdown fences, no explanation.
If the file is new, create it from scratch. If modifying, output the full updated file.`;

    let userPrompt = `User request: ${userRequest}\nFile: ${filePath}\nProject context:\n${context}\n`;
    if (originalContent) {
      userPrompt += `\nCurrent file content:\n${originalContent}\n`;
    }
    if (previousFeedback) {
      userPrompt += `\nPrevious review feedback to address:\n${previousFeedback}\n`;
    }
    userPrompt += `\nOutput the complete file content for ${filePath}:`;

    return this.call(system, [{ role: 'user', content: userPrompt }], signal);
  }

  async reviewFile(
    userRequest: string,
    filePath: string,
    proposedContent: string,
    fileHash: string,
    originalContent: string,
    context: string,
    signal?: AbortSignal
  ): Promise<ReviewResult> {
    const system = `You are a code reviewer. Respond ONLY with valid JSON matching this schema:
{
  "verdict": "APPROVE" | "REQUEST_CHANGES",
  "issues": [{"severity": "blocker"|"major"|"minor", "message": "..."}],
  "requiredChanges": ["change description..."],
  "reasoning": "brief explanation"
}
Be strict but fair. Only REQUEST_CHANGES for real problems (bugs, security, missing requirements).`;

    const userPrompt = `User request: ${userRequest}
File: ${filePath}
File hash: ${fileHash}
Project context:
${context}

${originalContent ? `Original file:\n${originalContent}\n` : '(new file)'}

Proposed file content:
${proposedContent}

Review this file and respond with JSON:`;

    const raw = await this.call(system, [{ role: 'user', content: userPrompt }], signal);
    return this.parseReview(raw, filePath, fileHash);
  }

  async planTask(
    userRequest: string,
    context: string,
    signal?: AbortSignal
  ): Promise<{ files: { filePath: string; action: 'create' | 'modify' | 'delete'; reason: string }[] }> {
    const system = `You are a project planner. Given a user request and project context, determine which files need to be created, modified, or deleted. Respond ONLY with valid JSON:
{"files": [{"filePath": "relative/path", "action": "create"|"modify"|"delete", "reason": "why"}]}
Keep the list minimal and focused.`;

    const raw = await this.call(
      system,
      [{ role: 'user', content: `Request: ${userRequest}\n\nProject context:\n${context}` }],
      signal
    );

    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { files: [] };
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      // Send a minimal request to check authentication
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private parseReview(raw: string, filePath: string, fileHash: string): ReviewResult {
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        provider: 'claude',
        filePath,
        fileHash,
        verdict: parsed.verdict === 'APPROVE' ? 'APPROVE' : 'REQUEST_CHANGES',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        requiredChanges: Array.isArray(parsed.requiredChanges) ? parsed.requiredChanges : [],
        reasoning: parsed.reasoning || '',
        timestamp: new Date(),
      };
    } catch (err) {
      console.error('[TriForge] Claude parseReview failed — malformed JSON from provider:', err, '\nRaw (first 200 chars):', raw.substring(0, 200));
      return {
        provider: 'claude',
        filePath,
        fileHash,
        verdict: 'REQUEST_CHANGES',
        issues: [{ severity: 'major', message: 'Failed to parse review response' }],
        requiredChanges: ['Provider returned malformed review — treating as request for changes'],
        reasoning: raw.substring(0, 300),
        timestamp: new Date(),
      };
    }
  }
}
