// ── BlueprintTypes.ts — Shared type definitions for the Blueprint System ───────
//
// A TriForgeBlueprint is a declarative configuration that tells TriForge how
// to configure itself for a specific profession or use case. Blueprints are
// loaded at startup or when the user selects a profile, and applied via
// applyBlueprint() which wires them into ProfessionEngine, AutonomyEngine,
// TaskToolRegistry, MissionController, and CouncilMemoryGraph.
//
// Blueprint JSON files live in: core/blueprints/definitions/
// TypeScript constants live in: defaultBlueprint.ts

export type BlueprintId =
  | 'developer'
  | 'founder'
  | 'marketing'
  | 'it'
  | 'research'
  | 'business'
  | 'business_operator'
  | 'consultant'
  | 'trader'
  | 'sales'
  | 'voice'
  | 'filmmaker'
  | 'real_estate'
  | 'legal'
  | 'healthcare_admin'
  | 'cybersecurity'
  | 'data_science'
  | 'product_manager'
  | 'educator'
  | 'logistics'
  | 'power_user';

// ── Workflow definitions embedded in blueprints ────────────────────────────────

export interface BlueprintTrigger {
  eventType: string;
  filter?: Record<string, unknown>;
}

export interface BlueprintAction {
  type: 'notify' | 'ai_task' | 'queue_approval' | 'run_tool';
  params: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface BlueprintWorkflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: BlueprintTrigger[];
  actions: BlueprintAction[];
  cooldownMs: number;
}

// ── Mission template — a reusable goal string with a label ─────────────────────

export interface MissionTemplate {
  id: string;
  label: string;
  goal: string;
  category?: string;
}

// ── The blueprint itself ───────────────────────────────────────────────────────

export interface TriForgeBlueprint {
  /** Unique identifier — must match a BlueprintId. */
  id: BlueprintId;

  /** Human-readable display name shown in UI. */
  name: string;

  /** One-sentence description of who this blueprint is for. */
  description: string;

  /** Version string for future migration support. */
  version: string;

  // ── Council behavior ────────────────────────────────────────────────────────

  /** Lines injected into the system prompt when this blueprint is active. */
  systemPromptAdditions: string[];

  /** How strictly the system requires approval for actions. */
  approvalStrictness: 'strict' | 'balanced' | 'relaxed';

  // ── Sensor configuration ────────────────────────────────────────────────────

  /** Sensors to start when this blueprint is activated. */
  activeSensors: string[];

  // ── Workflow automation ─────────────────────────────────────────────────────

  /** Autonomous workflows registered when this blueprint is activated. */
  workflows: BlueprintWorkflow[];

  // ── Task tooling ────────────────────────────────────────────────────────────

  /**
   * Suggested tools for this profession. These are prompt hints to the council,
   * not hard capability filters — the registry always has all tools available.
   */
  enabledTools: string[];

  // ── Mission planning ────────────────────────────────────────────────────────

  /** Reusable mission templates shown as quick-start goals. */
  missionTemplates: MissionTemplate[];

  // ── Memory tagging ──────────────────────────────────────────────────────────

  /**
   * Memory bucket tags relevant to this profession.
   * CouncilMemoryGraph uses these to boost retrieval relevance.
   */
  memoryTags: string[];

  // ── Optional enhancement flags ──────────────────────────────────────────────

  /** If true, InsightEngine runs in ambient proactive mode for this blueprint. */
  proactiveInsights?: boolean;

  /** If true, insights and alerts are also routed to TTS voice output. */
  voiceAlerts?: boolean;

  /** Preferred response style for AI output. */
  responseStyle?: 'technical' | 'executive' | 'conversational';
}

// ── Context passed to applyBlueprint() ────────────────────────────────────────

export interface BlueprintApplyContext {
  sensorManager: {
    startSensor(name: string, config?: Record<string, unknown>): { ok?: boolean; error?: string };
    stopSensor(name: string): { ok?: boolean; error?: string };
  };
  autonomyEngine: {
    registerWorkflow(wf: BlueprintWorkflow & { createdAt: number }): unknown;
    deleteWorkflow(id: string): boolean;
    // Uses Partial<> to remain compatible with the real AutonomyEngine.setRiskPolicy signature
    setRiskPolicy?(policy: Record<string, unknown>): void;
  };
  missionController: {
    registerMissionTemplates(templates: MissionTemplate[]): void;
  };
}

// ── Loaded blueprint state ─────────────────────────────────────────────────────

export interface ActiveBlueprintState {
  blueprint: TriForgeBlueprint;
  activatedAt: number;
  registeredWorkflowIds: string[];
}
