/**
 * Grok Provider — uses xAI's OpenAI-compatible API via native fetch.
 */

import { AIProvider, AIProviderConfig, ProviderError, retryWithBackoff } from './provider';
import { ReviewResult } from '../types';

const DEFAULT_MODEL = 'grok-3';
const API_URL = 'https://api.x.ai/v1/chat/completions';
const VALIDATE_URL = 'https://api.x.ai/v1/models';
const TIMEOUT_MS = 120_000;

export class GrokProvider implements AIProvider {
  readonly name = 'grok' as const;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  private get model(): string {
    return this.config.model || DEFAULT_MODEL;
  }

  private async call(messages: { role: string; content: string }[], signal?: AbortSignal): Promise<string> {
    return retryWithBackoff(async () => {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const combined = signal
        ? AbortSignal.any([signal, timeout])
        : timeout;

      let res: Response;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: 0.3,
          }),
          signal: combined,
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new ProviderError('grok', 0, 'Request cancelled or timed out.');
        }
        throw new ProviderError('grok', 0, `Network error: ${err.message}`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const retryAfter = res.headers.get('retry-after');
        throw new ProviderError(
          'grok',
          res.status,
          `Grok API error ${res.status}: ${body.substring(0, 200)}`,
          retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
        );
      }

      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        throw new ProviderError('grok', 0, 'Grok returned an empty response.');
      }
      return content;
    }, signal);
  }

  async generateResponse(prompt: string, context?: string, signal?: AbortSignal): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (context) {
      messages.push({ role: 'system', content: `Project context:\n${context}` });
    }
    messages.push({ role: 'user', content: prompt });
    return this.call(messages, signal);
  }

  async chat(messages: { role: string; content: string }[], signal?: AbortSignal): Promise<string> {
    return this.call(messages, signal);
  }

  async chatStream(messages: { role: string; content: string }[], onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<string> {
    return this.callStream(messages, onChunk, signal);
  }

  private async callStream(
    messages: { role: string; content: string }[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, messages, temperature: 0.3, stream: true }),
        signal: combined,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError('grok', 0, 'Request cancelled or timed out.');
      }
      throw new ProviderError('grok', 0, `Network error: ${err.message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderError('grok', res.status, `Grok API error ${res.status}: ${body.substring(0, 200)}`);
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
          const data = trimmed.slice(6);
          if (data === '[DONE]') { return full; }
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) { full += delta; onChunk(delta); }
          } catch { /* ignore malformed SSE lines */ }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError('grok', 0, 'Request cancelled or timed out.');
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
    const messages: { role: string; content: string }[] = [];
    if (context) {
      messages.push({ role: 'system', content: `Project context:\n${context}` });
    }
    messages.push(...history);
    return this.callStream(messages, onChunk, signal);
  }

  async generateDraft(
    userRequest: string,
    filePath: string,
    originalContent: string,
    context: string,
    previousFeedback: string | null,
    signal?: AbortSignal
  ): Promise<string> {
    const systemPrompt = `You are a code builder. Output ONLY the complete file content, no markdown fences, no explanation.
If the file is new, create it from scratch. If modifying, output the full updated file.`;

    let userPrompt = `User request: ${userRequest}\nFile: ${filePath}\nProject context:\n${context}\n`;
    if (originalContent) {
      userPrompt += `\nCurrent file content:\n${originalContent}\n`;
    }
    if (previousFeedback) {
      userPrompt += `\nPrevious review feedback to address:\n${previousFeedback}\n`;
    }
    userPrompt += `\nOutput the complete file content for ${filePath}:`;

    return this.call([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], signal);
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
    const systemPrompt = `You are a code reviewer. Respond ONLY with valid JSON matching this schema:
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

    const raw = await this.call([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], signal);

    return this.parseReview(raw, filePath, fileHash);
  }

  async planTask(
    userRequest: string,
    context: string,
    signal?: AbortSignal
  ): Promise<{ files: { filePath: string; action: 'create' | 'modify' | 'delete'; reason: string }[] }> {
    const systemPrompt = `You are a project planner. Given a user request and project context, determine which files need to be created, modified, or deleted. Respond ONLY with valid JSON:
{"files": [{"filePath": "relative/path", "action": "create"|"modify"|"delete", "reason": "why"}]}
Keep the list minimal and focused.`;

    const raw = await this.call([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Request: ${userRequest}\n\nProject context:\n${context}` },
    ], signal);

    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { files: [] };
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      const res = await fetch(VALIDATE_URL, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
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
        provider: 'grok',
        filePath,
        fileHash,
        verdict: parsed.verdict === 'APPROVE' ? 'APPROVE' : 'REQUEST_CHANGES',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        requiredChanges: Array.isArray(parsed.requiredChanges) ? parsed.requiredChanges : [],
        reasoning: parsed.reasoning || '',
        timestamp: new Date(),
      };
    } catch (err) {
      console.error('[TriForge] Grok parseReview failed — malformed JSON from provider:', err, '\nRaw (first 200 chars):', raw.substring(0, 200));
      return {
        provider: 'grok',
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
