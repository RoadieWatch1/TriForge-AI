import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../core/taskTypes';
import { serviceLocator } from '../core/serviceLocator';
import { eventBus } from '../core/eventBus';

export const sendEmailDef: ToolDefinition = {
  name: 'send_email',
  description: 'Send a real email via configured SMTP. Requires SMTP credentials. Falls back to paper mode if not configured.',
  category: 'email',
  riskLevel: 'medium',
  estimatedCostCents: 0,
  inputSchema: {
    to:      { type: 'string',  description: 'Recipient address(es), comma-separated' },
    subject: { type: 'string',  description: 'Email subject line' },
    body:    { type: 'string',  description: 'Email body (plain text)' },
    from:    { type: 'string',  description: 'Sender name / address override (optional)' },
    isHtml:  { type: 'boolean', description: 'Treat body as HTML (optional)' },
  },
};

interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
  from?: string;
  isHtml?: boolean;
}

export interface SendEmailResult {
  sent: boolean;
  to: string[];
  subject: string;
  messageId: string;
  paperMode: boolean;
  timestamp: number;
}

export async function runSendEmail(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<SendEmailResult> {
  const { to, subject, body, from, isHtml } = args as unknown as SendEmailArgs;

  if (!to?.trim())      throw new Error('send_email: "to" is required');
  if (!subject?.trim()) throw new Error('send_email: "subject" is required');
  if (!body?.trim())    throw new Error('send_email: "body" is required');

  const toList = to.split(',').map(s => s.trim()).filter(Boolean);

  const result = await serviceLocator.sendMail({ to: toList, subject, body, from, isHtml });

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(),
    taskId: ctx.taskId,
    stepId: ctx.stepId,
    tool: 'send_email',
    timestamp: Date.now(),
    success: result.accepted.length > 0,
    paperMode: result.paperMode,
    data: { to: result.accepted, subject, messageId: result.messageId },
    metrics: {
      emailsSent:   result.accepted.length,
      emailsFailed: result.rejected.length,
    },
  };
  serviceLocator.logResult(execResult);

  eventBus.emit({
    type:      'EMAIL_SENT',
    taskId:    ctx.taskId,
    stepId:    ctx.stepId,
    to:        result.accepted,
    subject,
    paperMode: result.paperMode,
  });

  if (!result.paperMode && result.accepted.length > 0) {
    serviceLocator.notify(
      'Email Sent',
      `"${subject}" → ${result.accepted.join(', ')}`,
      'email',
    );
  }

  return {
    sent:      result.accepted.length > 0,
    to:        result.accepted,
    subject,
    messageId: result.messageId,
    paperMode: result.paperMode,
    timestamp: Date.now(),
  };
}
