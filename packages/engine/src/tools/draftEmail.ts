import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const draftEmailDef: ToolDefinition = {
  name: 'draft_email',
  description: 'Draft an email based on a subject and body hint. Does NOT send.',
  category: 'email',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    to: { type: 'string', description: 'Recipient address (optional)' },
    subject: { type: 'string', description: 'Email subject (optional, will be generated)' },
    bodyHint: { type: 'string', description: 'Brief description of what the email should say' },
  },
};

interface DraftEmailArgs {
  to?: string;
  subject?: string;
  bodyHint: string;
}

interface DraftEmailResult {
  subject: string;
  body: string;
  preview: string;
  wordCount: number;
}

export async function runDraftEmail(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<DraftEmailResult> {
  const { to, subject, bodyHint } = args as unknown as DraftEmailArgs;

  const resolvedSubject = subject ?? `Re: ${(bodyHint ?? 'your message').slice(0, 50)}`;
  const body = [
    `Hi${to ? ` ${to.split('@')[0]}` : ''},`,
    '',
    bodyHint
      ? `I'm reaching out regarding: ${bodyHint}.`
      : 'I wanted to follow up with you.',
    '',
    'Please let me know if you have any questions.',
    '',
    'Best regards',
  ].join('\n');

  return {
    subject: resolvedSubject,
    body,
    preview: body.slice(0, 120),
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}
