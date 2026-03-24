/**
 * runbookTemplate.ts — Phase 34
 *
 * Template resolution for runbook step params and text fields.
 *
 * Syntax:
 *   {{varName}}             — resolved from exec.vars
 *   {{step.STEPID}}         — resolved from exec.stepOutputs[STEPID]
 *   {{step.STEPID.result}}  — same as above (alias)
 *   {{lastStep}}            — most recently captured step output
 *   {{incident.active}}     — 'true' or 'false'
 *   {{incident.reason}}     — workspace incident reason or ''
 *   {{workspace.name}}      — workspace name or ''
 *   {{runbook.title}}       — runbook title
 *   {{runbook.id}}          — runbook id
 *   {{execution.id}}        — execution id
 *   {{actor.id}}            — actorId or ''
 *   {{actor.label}}         — actorLabel or ''
 *
 * Unresolved placeholders are left as-is so they are visible in audit logs.
 */

import type { RunbookExecution, RunbookDef } from './runbooks';

export interface TemplateContext {
  vars:           Record<string, string>;
  stepOutputs:    Record<string, string>;
  incidentActive: boolean;
  incidentReason: string;
  workspaceName:  string;
  runbookTitle:   string;
  runbookId:      string;
  executionId:    string;
  actorId:        string;
  actorLabel:     string;
}

/** Build a TemplateContext from live execution state. */
export function buildTemplateContext(
  exec:          RunbookExecution,
  def:           RunbookDef,
  incidentActive:boolean,
  incidentReason:string,
  workspaceName: string,
): TemplateContext {
  return {
    vars:           exec.vars ?? {},
    stepOutputs:    exec.stepOutputs ?? {},
    incidentActive,
    incidentReason,
    workspaceName,
    runbookTitle:   def.title,
    runbookId:      def.id,
    executionId:    exec.id,
    actorId:        exec.actorId ?? '',
    actorLabel:     exec.actorLabel ?? '',
  };
}

/** Resolve a single template string. */
export function resolveTemplate(text: string, ctx: TemplateContext): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const k = key.trim();

    // Special keys
    if (k === 'incident.active')  return ctx.incidentActive ? 'true' : 'false';
    if (k === 'incident.reason')  return ctx.incidentReason;
    if (k === 'workspace.name')   return ctx.workspaceName;
    if (k === 'runbook.title')    return ctx.runbookTitle;
    if (k === 'runbook.id')       return ctx.runbookId;
    if (k === 'execution.id')     return ctx.executionId;
    if (k === 'actor.id')         return ctx.actorId;
    if (k === 'actor.label')      return ctx.actorLabel;

    // Last step output
    if (k === 'lastStep') {
      const keys = Object.keys(ctx.stepOutputs);
      return keys.length > 0 ? ctx.stepOutputs[keys[keys.length - 1]] ?? '' : '';
    }

    // Step output: {{step.STEPID}} or {{step.STEPID.result}}
    if (k.startsWith('step.')) {
      const parts  = k.split('.');
      const stepId = parts[1] ?? '';
      return ctx.stepOutputs[stepId] ?? `{{${k}}}`;
    }

    // Variable lookup
    if (k in ctx.vars) return ctx.vars[k];

    // Unresolved — return original placeholder to make it visible
    return `{{${k}}}`;
  });
}

/** Resolve all values in a step's params record. */
export function resolveParams(
  params: Record<string, string>,
  ctx:    TemplateContext,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveTemplate(value, ctx);
  }
  return resolved;
}

/**
 * Merge declared variable defaults with launch-time inputs.
 * Returns the final runtime vars dict to store on exec.vars.
 */
export function buildRuntimeVars(
  declared:   { name: string; defaultValue?: string; required: boolean }[],
  launchVars: Record<string, string>,
): { vars: Record<string, string>; missing: string[] } {
  const vars:    Record<string, string> = {};
  const missing: string[]               = [];

  for (const decl of declared) {
    const launchVal = launchVars[decl.name];
    if (launchVal !== undefined && launchVal !== '') {
      vars[decl.name] = launchVal;
    } else if (decl.defaultValue !== undefined && decl.defaultValue !== '') {
      vars[decl.name] = decl.defaultValue;
    } else if (decl.required) {
      missing.push(decl.name);
    }
  }

  // Pass through any extra launch vars not in declarations
  for (const [k, v] of Object.entries(launchVars)) {
    if (!(k in vars)) vars[k] = v;
  }

  return { vars, missing };
}

/**
 * Evaluate a Phase 34 parameterised condition expression.
 * Handles: var_set:, var_equals:, var_contains:, step_output_set:
 * Returns null if the expression is not a Phase 34 pattern (handled by caller).
 */
export function evalParameterisedCondition(
  expr: string,
  ctx:  TemplateContext,
): boolean | null {
  if (expr.startsWith('var_set:')) {
    const name = expr.slice('var_set:'.length);
    return !!(ctx.vars[name]);
  }
  if (expr.startsWith('var_equals:')) {
    const rest  = expr.slice('var_equals:'.length);
    const colon = rest.indexOf(':');
    if (colon < 0) return null;
    const name  = rest.slice(0, colon);
    const value = rest.slice(colon + 1);
    return ctx.vars[name] === value;
  }
  if (expr.startsWith('var_contains:')) {
    const rest  = expr.slice('var_contains:'.length);
    const colon = rest.indexOf(':');
    if (colon < 0) return null;
    const name = rest.slice(0, colon);
    const sub  = rest.slice(colon + 1).toLowerCase();
    return (ctx.vars[name] ?? '').toLowerCase().includes(sub);
  }
  if (expr.startsWith('step_output_set:')) {
    const stepId = expr.slice('step_output_set:'.length);
    return !!(ctx.stepOutputs[stepId]);
  }
  return null; // not a Phase 34 pattern
}
