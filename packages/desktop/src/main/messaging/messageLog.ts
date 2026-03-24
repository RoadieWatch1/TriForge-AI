// ── messageLog.ts — Phase 6: In-memory message ring buffer ────────────────────
//
// Keeps the last N inbound/outbound messages in memory for display in the UI.
// Not persisted — cleared on restart. Restart doesn't lose history that matters
// because audit events in AuditLedger already capture the permanent record.

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus    = 'received' | 'classified' | 'task_created' | 'blocked' | 'replied' | 'approval_pending';

export interface LoggedMessage {
  id:        string;
  direction: MessageDirection;
  channel:   'telegram' | 'slack' | 'discord';
  /** For Telegram: numeric chat ID. For Slack/Discord: string ID encoded as 0 (use channelId). */
  chatId:    number;
  chatName?: string;
  /** Slack/Discord channel/user ID (string). Only populated for Slack and Discord messages. */
  channelId?: string;
  text:      string;
  riskClass?: string;
  taskId?:   string;
  status:    MessageStatus;
  blockedReason?: string;
  timestamp: number;
}

const MAX_MESSAGES = 100;

export class MessageLog {
  private _messages: LoggedMessage[] = [];
  private _seq = 0;

  push(msg: Omit<LoggedMessage, 'id' | 'timestamp'>): LoggedMessage {
    const entry: LoggedMessage = {
      ...msg,
      id:        `msg_${++this._seq}`,
      timestamp: Date.now(),
    };
    this._messages.push(entry);
    if (this._messages.length > MAX_MESSAGES) {
      this._messages.shift();
    }
    return entry;
  }

  update(id: string, patch: Partial<Pick<LoggedMessage, 'status' | 'taskId' | 'blockedReason'>>): void {
    const m = this._messages.find(m => m.id === id);
    if (m) Object.assign(m, patch);
  }

  list(limit = 50): LoggedMessage[] {
    return this._messages.slice(-limit).reverse();
  }

  clear(): void {
    this._messages = [];
  }
}
