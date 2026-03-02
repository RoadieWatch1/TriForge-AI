import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../core/taskTypes';
import { serviceLocator } from '../core/serviceLocator';
import { eventBus } from '../core/eventBus';

export const runOutreachDef: ToolDefinition = {
  name: 'run_outreach',
  description: 'Send personalized outreach emails to a list of targets. Rate-limited to max 50/day. Requires SMTP credentials.',
  category: 'email',
  riskLevel: 'high',
  estimatedCostCents: 0,
  inputSchema: {
    targets:      { type: 'array',  description: 'List of target email addresses (max 50)' },
    subject:      { type: 'string', description: 'Email subject line' },
    bodyTemplate: { type: 'string', description: 'Email body. Use {name} for first-name personalization.' },
    fromName:     { type: 'string', description: 'Sender display name (optional)' },
    batchSize:    { type: 'number', description: 'Max emails to send in this run (default 10, max 50)' },
    delayMs:      { type: 'number', description: 'Delay between emails in ms (default 1500, min 1000)' },
  },
};

interface RunOutreachArgs {
  targets:      unknown;
  subject:      string;
  bodyTemplate: string;
  fromName?:    string;
  batchSize?:   number;
  delayMs?:     number;
}

interface OutreachDetail {
  email:     string;
  status:    'sent' | 'failed' | 'skipped';
  messageId?: string;
  error?:    string;
}

export interface RunOutreachResult {
  total:       number;
  sent:        number;
  failed:      number;
  paperMode:   boolean;
  successRate: number;
  details:     OutreachDetail[];
  timestamp:   number;
}

export async function runRunOutreach(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<RunOutreachResult> {
  const {
    targets,
    subject,
    bodyTemplate,
    fromName,
    batchSize = 10,
    delayMs   = 1500,
  } = args as RunOutreachArgs;

  if (!subject?.trim())      throw new Error('run_outreach: "subject" is required');
  if (!bodyTemplate?.trim()) throw new Error('run_outreach: "bodyTemplate" is required');

  const targetList: string[] = (Array.isArray(targets) ? targets : [targets])
    .map(String)
    .filter(s => s.includes('@'));

  if (targetList.length === 0) throw new Error('run_outreach: no valid email targets provided');

  // Safety caps
  const safeBatch = Math.min(Math.max(1, Number(batchSize) || 10), 50);
  const safeDelay = Math.max(1000, Number(delayMs) || 1500);
  const batch     = targetList.slice(0, safeBatch);

  const details: OutreachDetail[] = [];
  let sent = 0, failed = 0;
  let anyPaperMode = false;

  for (let i = 0; i < batch.length; i++) {
    const email = batch[i];
    const firstName = email.split('@')[0].replace(/[._-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    const body = bodyTemplate.replace(/\{name\}/gi, firstName);

    try {
      const mailResult = await serviceLocator.sendMail({
        to: email,
        subject,
        body,
        from: fromName,
      });

      if (mailResult.accepted.length > 0) {
        sent++;
        details.push({ email, status: 'sent', messageId: mailResult.messageId });
      } else {
        failed++;
        details.push({ email, status: 'failed', error: 'Rejected by server' });
      }
      if (mailResult.paperMode) anyPaperMode = true;
    } catch (err) {
      failed++;
      details.push({ email, status: 'failed', error: String(err) });
    }

    // Rate limiting: pause between sends (except after last)
    if (i < batch.length - 1) {
      await new Promise<void>(r => setTimeout(r, safeDelay));
    }
  }

  const successRate = batch.length > 0 ? Math.round((sent / batch.length) * 100) : 0;

  const execResult: ExecutionResult = {
    id:        crypto.randomUUID(),
    taskId:    ctx.taskId,
    stepId:    ctx.stepId,
    tool:      'run_outreach',
    timestamp: Date.now(),
    success:   sent > 0,
    paperMode: anyPaperMode,
    data:      { sent, failed, total: batch.length, details },
    metrics:   { emailsSent: sent, emailsFailed: failed, targets: batch.length, successRate },
  };
  serviceLocator.logResult(execResult);

  eventBus.emit({
    type:   'OUTREACH_COMPLETED',
    taskId: ctx.taskId,
    stepId: ctx.stepId,
    sent,
    failed,
    total:  batch.length,
  });

  serviceLocator.notify(
    anyPaperMode ? 'Outreach Simulated' : 'Outreach Complete',
    `${sent}/${batch.length} emails sent${anyPaperMode ? ' (paper mode)' : ''}`,
    'email',
  );

  return {
    total:       batch.length,
    sent,
    failed,
    paperMode:   anyPaperMode,
    successRate,
    details,
    timestamp:   Date.now(),
  };
}
