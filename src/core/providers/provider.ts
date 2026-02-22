/**
 * Shared interface for all AI providers.
 * Supports both simple chat and structured draft/review for the consensus engine.
 */

import { ProviderName } from '../../webview/protocol';
import { ReviewResult } from '../types';

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
}

export interface AIProvider {
  readonly name: ProviderName;

  /** Simple text completion for single-model chat. */
  generateResponse(prompt: string, context?: string, signal?: AbortSignal): Promise<string>;

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
