/**
 * ActionPlanner — converts an IntentPlan from the Think Tank into a concrete,
 * risk-labelled ActionStep[] that ActionRunner can execute or queue for approval.
 */

import { ActionStep, IntentPlan, PolicyConfig } from '../protocol';

let _stepCounter = 0;

function newStepId(): string {
  return 'step_' + (++_stepCounter).toString().padStart(4, '0');
}

function riskForText(text: string): ActionStep['riskLevel'] {
  if (/delete|remove|push|deploy|publish|send email|pay|purchase|buy|transfer/i.test(text)) {
    return 'high';
  }
  if (/create|write|implement|modify|install|run|execute|test/i.test(text)) {
    return 'medium';
  }
  return 'low';
}

function typeForText(text: string): ActionStep['type'] {
  if (/research|look up|find|investigate|check|analyze|review|assess/i.test(text)) { return 'research'; }
  if (/write|draft|compose|document|report/i.test(text)) { return 'write'; }
  if (/code|implement|build|create file|modify|refactor|fix bug/i.test(text)) { return 'code'; }
  if (/run|execute|test|install|build|compile/i.test(text)) { return 'run_command'; }
  if (/open|view|navigate|show/i.test(text)) { return 'open_file'; }
  if (/remind|schedule|track|note|remember/i.test(text)) { return 'remind'; }
  return 'write';
}

export class ActionPlanner {
  constructor(private _policy: PolicyConfig) {}

  /**
   * Convert an IntentPlan into structured, executable ActionSteps.
   * Steps are ordered: research → execute → measure.
   */
  plan(intentPlan: IntentPlan): ActionStep[] {
    const steps: ActionStep[] = [];

    // Step 0: always clarify the goal first (zero-risk, no approval needed)
    steps.push({
      id: newStepId(),
      type: 'research',
      description: `Clarify scope: "${intentPlan.goalStatement}"`,
      inputs: {
        goal: intentPlan.goalStatement,
        obstacles: intentPlan.obstacles,
      },
      expectedOutcome: 'Clear understanding of scope, constraints, and definition of done',
      riskLevel: 'low',
      requiresApproval: false,
      status: 'planned',
    });

    // Map each action plan item to a typed, risk-labelled step
    for (const item of intentPlan.actionPlan) {
      const risk = riskForText(item);
      const type = typeForText(item);
      steps.push({
        id: newStepId(),
        type,
        description: item,
        inputs: { instruction: item },
        expectedOutcome: item.substring(0, 80),
        riskLevel: risk,
        requiresApproval: this._requiresApproval(risk),
        status: 'planned',
      });
    }

    // Final step: measure success against metrics (zero-risk review)
    if (intentPlan.metrics.length > 0) {
      steps.push({
        id: newStepId(),
        type: 'research',
        description: `Measure success: ${intentPlan.metrics.slice(0, 2).join(' • ')}`,
        inputs: { metrics: intentPlan.metrics },
        expectedOutcome: 'Progress report against success metrics and next iteration plan',
        riskLevel: 'low',
        requiresApproval: false,
        status: 'planned',
      });
    }

    return steps;
  }

  private _requiresApproval(risk: ActionStep['riskLevel']): boolean {
    if (risk === 'high') { return true; }
    if (risk === 'low' && this._policy.autoApprove) { return false; }
    return true;
  }
}
