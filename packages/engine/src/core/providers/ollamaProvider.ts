// ── ollamaProvider.ts ─────────────────────────────────────────────────────────
//
// Local AI provider adapter for Ollama (and Ollama-compatible endpoints such as
// LM Studio, Jan, and OpenWebUI).
//
// This provider implements the same interface methods as cloud providers, using
// Ollama's native REST API. It does NOT register in ProviderManager (which is
// constrained to 'openai' | 'grok' | 'claude') — instead it is used directly
// via the local:provider:* IPC handlers.
//
// Supported endpoints:
//   Ollama (default)  — http://localhost:11434
//   LM Studio         — http://localhost:1234  (OpenAI-compatible; use /v1 path)
//   Jan               — http://localhost:1337
//   Any local server  — pass custom baseUrl
//
// Usage:
//   const p = new OllamaProvider('http://localhost:11434', 'mistral');
//   const text = await p.chat([{ role: 'user', content: 'Hello' }]);

export interface LocalProviderConfig {
  baseUrl: string;  // e.g. 'http://localhost:11434'
  model:   string;  // e.g. 'mistral', 'llama3', 'deepseek-coder'
}

export class OllamaProvider {
  readonly name: string;
  private _baseUrl: string;
  private _model:   string;

  constructor(config: LocalProviderConfig) {
    this._baseUrl = config.baseUrl.replace(/\/$/, '');
    this._model   = config.model;
    this.name     = `ollama:${this._model}`;
  }

  // ── Core chat ───────────────────────────────────────────────────────────────

  async chat(
    messages: Array<{ role: string; content: string }>,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch(`${this._baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this._model, messages, stream: false }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { message?: { content?: string }; response?: string };
    return data.message?.content ?? data.response ?? '';
  }

  // ── Streaming chat ──────────────────────────────────────────────────────────

  async chatStream(
    messages: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch(`${this._baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this._model, messages, stream: true }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }
    if (!res.body) {
      return this.chat(messages, signal);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   full    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Ollama streams NDJSON: one JSON object per line
      const lines = decoder.decode(value, { stream: true }).split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
          };
          const token = obj.message?.content ?? '';
          if (token) {
            full += token;
            onChunk(token);
          }
        } catch { /* partial line — skip */ }
      }
    }

    return full;
  }

  // ── Discovery ───────────────────────────────────────────────────────────────

  /**
   * List available models on this Ollama endpoint.
   * Returns model names e.g. ['mistral:latest', 'llama3:8b'].
   */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this._baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).map(m => m.name);
  }

  /**
   * Measure latency and confirm the model is available.
   * Returns { ok, latencyMs } on success or { ok: false, error } on failure.
   */
  async testConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const text = await this.chat([{ role: 'user', content: 'Hi' }]);
      if (text.length === 0) return { ok: false, error: 'Empty response from model' };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
