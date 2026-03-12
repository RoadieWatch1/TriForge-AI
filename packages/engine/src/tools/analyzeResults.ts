import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../core/taskTypes';
import { serviceLocator } from '../core/serviceLocator';
import { eventBus } from '../core/eventBus';

export const analyzeResultsDef: ToolDefinition = {
  name: 'analyze_results',
  description: 'Analyze past execution results for a task and surface insights, improvements, and next actions.',
  category: 'research',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    taskId: { type: 'string', description: 'Task ID to analyze (defaults to current task)' },
    scope:  { type: 'string', description: 'Scope: emails | social | all (default: all)' },
  },
};

interface AnalyzeResultsArgs {
  taskId?: string;
  scope?:  'emails' | 'social' | 'all';
}

export interface AnalyzeResultsOutput {
  metrics: {
    total:           number;
    successful:      number;
    failed:          number;
    emailsSent:      number;
    tweetsPosted:    number;
    outreachTargets: number;
    paperModeCount:  number;
    successRate:     number;
  };
  improvements: string[];
  nextActions:  string[];
  score:        number;   // 0-100 overall health score
  analyzedAt:   number;
}

export async function runAnalyzeResults(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<AnalyzeResultsOutput> {
  const { taskId = ctx.taskId, scope = 'all' } = args as AnalyzeResultsArgs;

  const allResults = serviceLocator.queryResults(typeof taskId === 'string' ? taskId : undefined);

  const results: ExecutionResult[] = allResults.filter(r => {
    if (scope === 'emails')  return r.tool === 'send_email' || r.tool === 'run_outreach';
    if (scope === 'social')  return r.tool === 'post_twitter';
    return true;
  });

  // Compute metrics
  const total           = results.length;
  const successful      = results.filter(r => r.success).length;
  const failed          = results.filter(r => !r.success).length;
  const emailsSent      = results.reduce((s, r) => s + (r.metrics?.emailsSent ?? 0), 0);
  const tweetsPosted    = results.filter(r => r.tool === 'post_twitter' && r.success).length;
  const outreachTargets = results.reduce((s, r) => s + (r.metrics?.targets ?? 0), 0);
  const paperModeCount  = results.filter(r => r.paperMode).length;
  const successRate     = total > 0 ? Math.round((successful / total) * 100) : 0;

  // Build improvements + next actions
  const improvements: string[] = [];
  const nextActions:  string[] = [];

  if (paperModeCount > 0) {
    improvements.push(`${paperModeCount} action${paperModeCount > 1 ? 's' : ''} ran in paper mode — configure SMTP and Twitter credentials for real execution`);
    nextActions.push('Open Credentials panel in Agent HQ and add SMTP / Twitter API keys');
  }
  if (successRate < 70 && total > 0) {
    improvements.push(`Success rate is ${successRate}% — review email deliverability and target list quality`);
    nextActions.push('Check spam folder rates and sender reputation');
  }
  if (emailsSent > 20 && tweetsPosted === 0) {
    improvements.push('Email outreach active but no social amplification — consider pairing with Twitter posts');
    nextActions.push('Add a post_twitter step to your outreach workflow');
  }
  if (failed > 3) {
    nextActions.push(`Investigate ${failed} failed steps — check credentials and network access`);
  }
  if (total === 0) {
    improvements.push('No execution results yet — run some tasks to see analytics here');
    nextActions.push('Create and run a send_email or run_outreach task');
  }

  // Overall health score
  const score = total === 0 ? 0 :
    Math.round(
      (successRate * 0.5) +
      (Math.min(emailsSent + tweetsPosted, 20) / 20 * 30) +
      (paperModeCount === 0 && total > 0 ? 20 : 0),
    );

  const execResult: ExecutionResult = {
    id:        crypto.randomUUID(),
    taskId:    ctx.taskId,
    stepId:    ctx.stepId,
    tool:      'analyze_results',
    timestamp: Date.now(),
    success:   true,
    paperMode: false,
    data:      { total, successRate, improvements, nextActions },
    metrics:   { emailsSent, successRate },
  };
  serviceLocator.logResult(execResult);

  eventBus.emit({
    type:    'RESULT_LOGGED',
    taskId:  ctx.taskId,
    stepId:  ctx.stepId,
    tool:    'analyze_results',
    success: true,
  });

  return {
    metrics: {
      total, successful, failed,
      emailsSent, tweetsPosted, outreachTargets,
      paperModeCount, successRate,
    },
    improvements,
    nextActions,
    score,
    analyzedAt: Date.now(),
  };
}
