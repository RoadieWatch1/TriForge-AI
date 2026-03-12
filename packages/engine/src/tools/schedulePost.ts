import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const schedulePostDef: ToolDefinition = {
  name: 'schedule_post',
  description: 'Plan a social media post with content and hashtags. Does NOT publish.',
  category: 'social',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    platform: { type: 'string', description: 'Target platform: twitter, linkedin, instagram' },
    contentHint: { type: 'string', description: 'Brief description of what the post should say' },
    scheduledAt: { type: 'string', description: 'ISO timestamp to schedule (optional)' },
  },
};

interface SchedulePostArgs {
  platform: string;
  contentHint: string;
  scheduledAt?: string;
}

interface SchedulePostResult {
  content: string;
  platform: string;
  scheduledAt: string;
  hashtags: string[];
  preview: string;
}

const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  linkedin: 700,
  instagram: 500,
};

export async function runSchedulePost(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<SchedulePostResult> {
  const { platform = 'twitter', contentHint, scheduledAt } = args as unknown as SchedulePostArgs;

  const limit = PLATFORM_LIMITS[platform] ?? 280;
  const content = `${contentHint ?? 'Exciting update coming soon'} — stay tuned for more!`.slice(0, limit);
  const hashtags = ['#TriForge', '#AI', `#${platform.charAt(0).toUpperCase() + platform.slice(1)}`];
  const resolvedAt = scheduledAt ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  return {
    content,
    platform,
    scheduledAt: resolvedAt,
    hashtags,
    preview: `${content.slice(0, 80)}… ${hashtags.join(' ')}`,
  };
}
