/**
 * Shared interface for all AI providers.
 * Supports both simple chat and structured draft/review for the consensus engine.
 */

import { ProviderName } from '../../protocol';
import { ReviewResult } from '../types';

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
}

export interface AIProvider {
  readonly name: ProviderName;

  /** Simple text completion for single-model chat. */
  generateResponse(prompt: string, context?: string, signal?: AbortSignal): Promise<string>;

  /** Full-history chat with a pre-built messages array (system + user + assistant turns). */
  chat(messages: { role: string; content: string }[], signal?: AbortSignal): Promise<string>;

  /**
   * Streaming chat with full conversation history.
   * Calls onChunk for each token as it arrives; returns the full accumulated text.
   */
  generateResponseStream(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: string | undefined,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string>;

  /** Generate a full file draft (create or modify). Returns the complete file content. */
  generateDraft(
    userRequest: string,
    filePath: string,
    originalContent: string,
    context: string,
    previousFeedback: string | null,
    signal?: AbortSignal
  ): Promise<string>;

  /** Review a proposed file and return structured verdict. */
  reviewFile(
    userRequest: string,
    filePath: string,
    proposedContent: string,
    fileHash: string,
    originalContent: string,
    context: string,
    signal?: AbortSignal
  ): Promise<ReviewResult>;

  /** Plan which files need to change for a user request. Returns JSON. */
  planTask(
    userRequest: string,
    context: string,
    signal?: AbortSignal
  ): Promise<{ files: { filePath: string; action: 'create' | 'modify' | 'delete'; reason: string }[] }>;

  /** Check if the provider's API key is valid. */
  validateConnection(): Promise<boolean>;
}

/**
 * Structured error from a provider API call.
 */
export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * Retries a provider call up to MAX_ATTEMPTS times with exponential backoff.
 * Respects retry-after headers from 429 responses and aborts immediately on
 * user cancellation or non-retryable errors (4xx excluding 429).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Never retry on user abort or timeout
      if (err instanceof Error && err.name === 'AbortError') { throw err; }
      if (signal?.aborted) { throw err; }

      // Only retry on network errors or specific status codes
      const isRetryable =
        !(err instanceof ProviderError) || RETRY_STATUS_CODES.has(err.statusCode);

      if (!isRetryable || attempt === MAX_ATTEMPTS) { throw err; }

      // Determine delay: honour Retry-After header, else exponential + jitter
      const baseDelayMs =
        err instanceof ProviderError && err.retryAfterMs
          ? err.retryAfterMs
          : (2 ** (attempt - 1)) * 1000 + Math.random() * 500;

      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, baseDelayMs);
        signal?.addEventListener('abort', () => { clearTimeout(id); reject(new Error('AbortError')); }, { once: true });
      });
    }
  }

  throw lastErr;
}
