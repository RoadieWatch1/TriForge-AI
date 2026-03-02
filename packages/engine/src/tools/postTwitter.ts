import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../core/taskTypes';
import { serviceLocator } from '../core/serviceLocator';
import { eventBus } from '../core/eventBus';

export const postTwitterDef: ToolDefinition = {
  name: 'post_twitter',
  description: 'Post a tweet to Twitter/X via API v2. Requires Twitter Bearer Token. Falls back to paper mode if not configured.',
  category: 'social',
  riskLevel: 'medium',
  estimatedCostCents: 0,
  inputSchema: {
    content:    { type: 'string', description: 'Tweet content (max 280 chars)' },
    replyToId:  { type: 'string', description: 'Tweet ID to reply to (optional)' },
  },
};

interface PostTwitterArgs {
  content: string;
  replyToId?: string;
}

export interface PostTwitterResult {
  posted: boolean;
  tweetId: string;
  url: string;
  content: string;
  charCount: number;
  paperMode: boolean;
  timestamp: number;
}

export async function runPostTwitter(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PostTwitterResult> {
  const { content, replyToId } = args as PostTwitterArgs;

  if (!content?.trim()) throw new Error('post_twitter: "content" is required');

  // Enforce 280-char Twitter limit
  const tweet = String(content).slice(0, 280);

  const result = await serviceLocator.postTweet({ content: tweet, replyToId });

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(),
    taskId: ctx.taskId,
    stepId: ctx.stepId,
    tool: 'post_twitter',
    timestamp: Date.now(),
    success: !result.paperMode,
    paperMode: result.paperMode,
    data: { tweetId: result.tweetId, url: result.url, content: result.content },
    metrics: { tweetId: result.tweetId },
  };
  serviceLocator.logResult(execResult);

  eventBus.emit({
    type:      'TWEET_POSTED',
    taskId:    ctx.taskId,
    stepId:    ctx.stepId,
    tweetId:   result.tweetId,
    url:       result.url,
    paperMode: result.paperMode,
  });

  if (!result.paperMode) {
    serviceLocator.notify(
      'Tweet Posted',
      `"${tweet.slice(0, 60)}…"`,
      'social',
    );
  }

  return {
    posted:    !result.paperMode,
    tweetId:   result.tweetId,
    url:       result.url,
    content:   result.content,
    charCount: tweet.length,
    paperMode: result.paperMode,
    timestamp: Date.now(),
  };
}
