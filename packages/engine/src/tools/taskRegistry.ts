import type { TaskToolName, ToolDefinition, ToolContext } from '../core/taskTypes';

// ── TaskToolRegistry ──────────────────────────────────────────────────────────

type ToolEntry = ToolDefinition & {
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export class TaskToolRegistry {
  private _tools = new Map<TaskToolName, ToolEntry>();

  register(def: ToolDefinition, run: ToolEntry['run']): void {
    this._tools.set(def.name, { ...def, run });
  }

  async run(name: TaskToolName, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.run(args, ctx);
  }

  describe(name: TaskToolName): ToolDefinition | undefined {
    const t = this._tools.get(name);
    if (!t) return undefined;
    const { run: _, ...def } = t;
    return def;
  }

  listAll(): ToolDefinition[] {
    return [...this._tools.values()].map(({ run: _, ...def }) => def);
  }
}

export function createDefaultRegistry(): TaskToolRegistry {
  const registry = new TaskToolRegistry();

  // Import and register all tools
  const { runDraftEmail, draftEmailDef } = require('./draftEmail');
  const { runSchedulePost, schedulePostDef } = require('./schedulePost');
  const { runDocSearch, docSearchDef } = require('./docSearch');
  const { runFileOrganize, fileOrganizeDef } = require('./fileOrganize');
  const { runBrokerSim, brokerSimDef } = require('./brokerSim');

  registry.register(draftEmailDef, runDraftEmail);
  registry.register(schedulePostDef, runSchedulePost);
  registry.register(docSearchDef, runDocSearch);
  registry.register(fileOrganizeDef, runFileOrganize);
  registry.register(brokerSimDef, runBrokerSim);

  // Phase 4 — Real Execution tools
  const { runSendEmail, sendEmailDef }             = require('./sendEmail');
  const { runPostTwitter, postTwitterDef }         = require('./postTwitter');
  const { runRunOutreach, runOutreachDef }         = require('./runOutreach');
  const { runAnalyzeResults, analyzeResultsDef }   = require('./analyzeResults');
  const { runWebResearch, webResearchDef }         = require('./webResearch');

  registry.register(sendEmailDef,      runSendEmail);
  registry.register(postTwitterDef,    runPostTwitter);
  registry.register(runOutreachDef,    runRunOutreach);
  registry.register(analyzeResultsDef, runAnalyzeResults);
  registry.register(webResearchDef,    runWebResearch);

  // IT Tool Pack
  const { runItDiagnostics,   itDiagnosticsDef }   = require('./it/diagnostics');
  const { runItNetworkDoctor, itNetworkDoctorDef }  = require('./it/networkDoctor');
  const { runItEventLogs,     itEventLogsDef }      = require('./it/eventLogs');
  const { runItServices,      itServicesDef }       = require('./it/services');
  const { runItProcesses,     itProcessesDef }      = require('./it/processes');
  const { runItScriptRunner,  itScriptRunnerDef }   = require('./it/scriptRunner');
  const { runItPatchAdvisor,  itPatchAdvisorDef }   = require('./it/patchAdvisor');

  registry.register(itDiagnosticsDef,   runItDiagnostics);
  registry.register(itNetworkDoctorDef, runItNetworkDoctor);
  registry.register(itEventLogsDef,     runItEventLogs);
  registry.register(itServicesDef,      runItServices);
  registry.register(itProcessesDef,     runItProcesses);
  registry.register(itScriptRunnerDef,  runItScriptRunner);
  registry.register(itPatchAdvisorDef,  runItPatchAdvisor);

  return registry;
}
