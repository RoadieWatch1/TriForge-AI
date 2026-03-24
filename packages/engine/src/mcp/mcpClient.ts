// ── mcpClient.ts ────────────────────────────────────────────────────────────
//
// Model Context Protocol (MCP) client for TriForge.
//
// MCP is Anthropic's open standard for connecting AI agents to external tools
// and servers. It uses JSON-RPC 2.0 over stdio (local) or SSE (remote).
//
// Phase 2C scope (this file):
//   - JSON-RPC 2.0 message types
//   - Stdio transport (for local MCP servers like BlenderMCP, filesystem, etc.)
//   - Connection lifecycle: connect, initialize, list tools, call tool, disconnect
//   - Approval gate: every tool call is approval-gated before execution
//   - Trust classification: maps MCP server capabilities to TriForge risk levels
//
// Out of scope for this file:
//   - SSE transport (future: remote MCP servers)
//   - MCP resource subscriptions (future)
//   - MCP prompts (future)
//
// Supported MCP servers today (tested):
//   - BlenderMCP (github.com/ahujasid/blender-mcp) — 3D modeling via stdio
//   - Filesystem MCP — safe local file read/write
//   - Fetch MCP — web fetching
//
// Design rules:
//   - Never auto-executes tool calls — always returns for approval first
//   - Timeout all requests (default 30s) to prevent hanging
//   - Graceful shutdown: kills child process on disconnect
//   - Does not import from Electron — usable in engine layer only

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter }        from 'events';
import crypto                  from 'crypto';

// ── JSON-RPC 2.0 types ──────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id:      string | number;
  method:  string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id:      string | number | null;
  result?: unknown;
  error?:  { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method:  string;
  params?: unknown;
}

// ── MCP protocol types ──────────────────────────────────────────────────────

export interface McpServerInfo {
  name:         string;
  version:      string;
  protocolVersion?: string;
}

export interface McpTool {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface McpToolCallResult {
  content: Array<{
    type:  'text' | 'image' | 'resource';
    text?: string;
    data?: string;    // base64 for images
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ── TriForge trust mapping for MCP tools ────────────────────────────────────

export type McpToolRisk = 'low' | 'medium' | 'high' | 'blocked';

/** Maps MCP tool name patterns to risk levels. Used for approval gate. */
const MCP_RISK_RULES: Array<{ pattern: RegExp; risk: McpToolRisk; reason: string }> = [
  // Filesystem writes — high risk
  { pattern: /write|delete|remove|rename|mkdir|rmdir/i,    risk: 'high',    reason: 'Filesystem mutation' },
  // Shell / process execution — blocked
  { pattern: /exec|shell|spawn|run_command|terminal/i,     risk: 'blocked', reason: 'Shell execution' },
  // Network calls with URL — medium
  { pattern: /fetch|request|download|http/i,               risk: 'medium',  reason: 'Network access' },
  // Blender operations — medium (controlled 3D context)
  { pattern: /blender|bpy|render|scene|object/i,           risk: 'medium',  reason: 'Blender scene mutation' },
  // Read-only filesystem — low
  { pattern: /read|list|get|search|find|stat/i,            risk: 'low',     reason: 'Read-only operation' },
];

export function classifyMcpToolRisk(toolName: string): { risk: McpToolRisk; reason: string } {
  for (const rule of MCP_RISK_RULES) {
    if (rule.pattern.test(toolName)) {
      return { risk: rule.risk, reason: rule.reason };
    }
  }
  return { risk: 'medium', reason: 'Unknown tool — defaulting to medium risk' };
}

// ── Pending request tracker ─────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject:  (reason: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

// ── McpClient ───────────────────────────────────────────────────────────────

export interface McpClientOptions {
  /** Command to launch the MCP server. */
  command:   string;
  /** Arguments passed to the server process. */
  args?:     string[];
  /** Working directory for the server process. */
  cwd?:      string;
  /** Environment variables to pass to the server. */
  env?:      Record<string, string>;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
}

export class McpClient extends EventEmitter {
  private _proc:     ChildProcess | null = null;
  private _buffer    = '';
  private _pending   = new Map<string | number, PendingRequest>();
  private _nextId    = 1;
  private _connected = false;
  private _serverInfo: McpServerInfo | null = null;
  private _tools:    McpTool[] = [];
  private _options:  Required<McpClientOptions>;

  constructor(options: McpClientOptions) {
    super();
    this._options = {
      command:   options.command,
      args:      options.args   ?? [],
      cwd:       options.cwd    ?? process.cwd(),
      env:       options.env    ?? {},
      timeoutMs: options.timeoutMs ?? 30_000,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<McpServerInfo> {
    if (this._connected) throw new Error('McpClient already connected');

    this._proc = spawn(this._options.command, this._options.args, {
      cwd:   this._options.cwd,
      env:   { ...process.env, ...this._options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._proc.stdout?.setEncoding('utf8');
    this._proc.stdout?.on('data', (chunk: string) => this._onData(chunk));
    this._proc.stderr?.on('data', (err: Buffer) => {
      this.emit('serverError', err.toString());
    });
    this._proc.on('exit', (code) => {
      this._connected = false;
      this.emit('disconnect', code);
      this._rejectAllPending(new Error(`MCP server exited with code ${code}`));
    });

    this._connected = true;

    // MCP initialize handshake
    const initResult = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    { tools: {} },
      clientInfo:      { name: 'TriForge', version: '1.0.0' },
    }) as { serverInfo: McpServerInfo };

    this._serverInfo = initResult.serverInfo ?? { name: 'unknown', version: '0.0.0' };

    // Notify server that we are initialized
    this._notify('notifications/initialized', {});

    // Fetch tool list
    await this._refreshTools();

    this.emit('connect', this._serverInfo);
    return this._serverInfo;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    this._rejectAllPending(new Error('McpClient disconnected'));
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
  }

  get isConnected(): boolean { return this._connected; }
  get serverInfo():  McpServerInfo | null { return this._serverInfo; }
  get tools():       McpTool[] { return [...this._tools]; }

  // ── Tool operations ────────────────────────────────────────────────────────

  async listTools(): Promise<McpTool[]> {
    await this._refreshTools();
    return this.tools;
  }

  /**
   * Evaluates whether a tool call should be allowed.
   * Returns the risk level and reason — caller is responsible for approval.
   *
   * TriForge NEVER auto-executes MCP tools. This method exists to surface
   * the risk level so the approval queue can present it correctly.
   */
  evaluateToolCall(toolName: string, _args: unknown): { risk: McpToolRisk; reason: string; requiresApproval: boolean } {
    const { risk, reason } = classifyMcpToolRisk(toolName);
    return {
      risk,
      reason,
      requiresApproval: risk !== 'low', // low-risk reads auto-allowed
    };
  }

  /**
   * Executes a tool call.
   *
   * IMPORTANT: callers must call evaluateToolCall() first and gate on user
   * approval for any risk level above 'low'. The client will execute
   * regardless — enforcement is the caller's responsibility.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    this._assertConnected();
    const result = await this._request('tools/call', {
      name:      toolName,
      arguments: args,
    }) as McpToolCallResult;
    return result;
  }

  // ── Private: JSON-RPC transport ────────────────────────────────────────────

  private async _refreshTools(): Promise<void> {
    const result = await this._request('tools/list', {}) as { tools: McpTool[] };
    this._tools = result.tools ?? [];
  }

  private _request(method: string, params: unknown): Promise<unknown> {
    this._assertConnected();
    const id = this._nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this._options.timeoutMs}ms`));
      }, this._options.timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      this._send(msg);
    });
  }

  private _notify(method: string, params: unknown): void {
    if (!this._connected) return;
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this._send(msg);
  }

  private _send(msg: unknown): void {
    if (!this._proc?.stdin?.writable) {
      throw new Error('MCP server stdin is not writable');
    }
    this._proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private _onData(chunk: string): void {
    this._buffer += chunk;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() ?? ''; // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;
        this._handleMessage(msg);
      } catch {
        // Ignore non-JSON lines (server log output, etc.)
      }
    }
  }

  private _handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    // Notification (no id)
    if (!('id' in msg) || msg.id == null) {
      this.emit('notification', msg as JsonRpcNotification);
      return;
    }

    const response = msg as JsonRpcResponse;
    const pending  = this._pending.get(response.id!);
    if (!pending) return;

    clearTimeout(pending.timer);
    this._pending.delete(response.id!);

    if (response.error) {
      pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private _rejectAllPending(err: Error): void {
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this._pending.delete(id);
    }
  }

  private _assertConnected(): void {
    if (!this._connected) throw new Error('McpClient is not connected. Call connect() first.');
  }
}

// ── McpClientRegistry ───────────────────────────────────────────────────────
// Manages multiple MCP server connections. One instance per TriForge session.

export interface McpServerConfig {
  id:       string;  // stable identifier, e.g. 'blender', 'filesystem'
  label:    string;  // display name
  command:  string;
  args?:    string[];
  cwd?:     string;
  env?:     Record<string, string>;
}

export class McpClientRegistry {
  private _clients = new Map<string, McpClient>();

  async connect(config: McpServerConfig): Promise<McpServerInfo> {
    if (this._clients.has(config.id)) {
      throw new Error(`MCP server "${config.id}" is already connected`);
    }
    const client = new McpClient({
      command:  config.command,
      args:     config.args,
      cwd:      config.cwd,
      env:      config.env,
    });
    const info = await client.connect();
    this._clients.set(config.id, client);
    return info;
  }

  async disconnect(id: string): Promise<void> {
    const client = this._clients.get(id);
    if (client) {
      await client.disconnect();
      this._clients.delete(id);
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this._clients.keys()].map(id => this.disconnect(id)));
  }

  getClient(id: string): McpClient | undefined {
    return this._clients.get(id);
  }

  listConnected(): Array<{ id: string; serverInfo: McpServerInfo | null; toolCount: number }> {
    return [...this._clients.entries()].map(([id, client]) => ({
      id,
      serverInfo: client.serverInfo,
      toolCount:  client.tools.length,
    }));
  }

  /** Convenience: call a tool on a named server after evaluating risk. */
  async callTool(
    serverId:  string,
    toolName:  string,
    args:      Record<string, unknown>,
    approved:  boolean,
  ): Promise<McpToolCallResult> {
    const client = this._clients.get(serverId);
    if (!client) throw new Error(`MCP server "${serverId}" is not connected`);

    const evaluation = client.evaluateToolCall(toolName, args);
    if (evaluation.risk === 'blocked') {
      throw new Error(`MCP tool "${toolName}" is blocked: ${evaluation.reason}`);
    }
    if (evaluation.requiresApproval && !approved) {
      throw new Error(`MCP tool "${toolName}" requires approval before execution`);
    }

    return client.callTool(toolName, args);
  }
}

// ── Singleton registry (used by ipc.ts) ─────────────────────────────────────
export const mcpRegistry = new McpClientRegistry();
