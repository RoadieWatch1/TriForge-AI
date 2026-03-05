// ── CapabilityTypes.ts — Core schema for the TriForge Capability Matrix ────────

export interface Capability {
  /** Unique identifier for this capability. */
  id: string;
  /** The engine or subsystem that powers this capability. */
  engine: string;
  /** Human-readable description of what this capability does. */
  description: string;
  /** Blueprint IDs that benefit from this capability. */
  professions: string[];
  /** Tools that must be enabled for this capability to function. */
  requiredTools?: string[];
  /** Sensors that must be active for this capability to function. */
  requiredSensors?: string[];
}

/** Result returned by CapabilityResolver for a given blueprint. */
export interface ResolvedCapabilities {
  blueprintId:  string;
  capabilities: Capability[];
  engines:      string[];  // deduplicated list of engines activated
}
