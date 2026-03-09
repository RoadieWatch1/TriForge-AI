// ── placement/index.ts — Public API re-exports ──────────────────────────────

// Types
export type {
  LaneId,
  LaneStatus,
  LaneProfile,
  ExpertPlacement,
  PlacementDecision,
  PlacementAction,
  PlacementLedgerEntry,
  MigrationPlan,
  PlacementConfig,
  PlacementReport,
} from './expertPlacementTypes';

export { DEFAULT_PLACEMENT_CONFIG, DEFAULT_LANES } from './expertPlacementTypes';

// Load tracker
export { ExpertLoadTracker } from './expertLoadTracker';

// Capacity monitor
export { ChipCapacityMonitor } from './chipCapacityMonitor';

// Placement engine
export { ExpertPlacementEngine } from './expertPlacementEngine';

// Migration manager
export { ExpertMigrationManager } from './expertMigrationManager';

// Traffic controller
export { ExpertTrafficController } from './expertTrafficController';

// Learning bridge
export { PlacementLearningBridge } from './placementLearningBridge';
export type { PlacementReportSection } from './placementLearningBridge';
