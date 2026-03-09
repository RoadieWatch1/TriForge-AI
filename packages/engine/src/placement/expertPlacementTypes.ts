// ── expertPlacementTypes.ts — Domain model for Adaptive Expert Placement ─────
//
// Lane/chip abstraction, per-expert placement metadata, placement decisions,
// migration plans, and configuration for dynamic load balancing.

import type { ExpertPool } from '../experts/expertTypes';

// ── Lane / Chip abstraction ──────────────────────────────────────────────────

export type LaneId = string; // e.g. 'claude:primary', 'gpt:primary', 'shared:burst-1'

export type LaneStatus = 'idle' | 'normal' | 'busy' | 'saturated' | 'cooldown';

export interface LaneProfile {
  id: LaneId;
  pool: ExpertPool;
  kind: 'primary' | 'burst';
  utilization: number;                   // 0-100
  queueDepth: number;                   // pending invocations
  memoryPressure: number;               // 0-100
  avgResponseTimeMs: number;
  activeExpertCount: number;
  expertIds: string[];                  // experts currently placed here
  saturationThreshold: number;          // default 80
  maxConcurrent: number;               // max parallel expert invocations
  status: LaneStatus;
}

// ── Expert placement metadata ────────────────────────────────────────────────

export interface ExpertPlacement {
  expertId: string;
  homeLane: LaneId;                     // default lane (matches pool)
  currentLane: LaneId;                  // where it's currently running
  burstLanes: LaneId[];                // overflow lanes allowed
  priorityClass: 'critical' | 'standard' | 'background';
  affinityScore: number;               // 0-100 — how strongly bound to home lane
  migrationCost: number;               // estimated cost of moving (0-100)
  lastMigratedAt: number;
  migrationCount: number;
  invocationCount: number;
  queueDepth: number;                  // pending work for this expert
  avgRuntimeMs: number;
  avgTokenCost: number;
  avgMemoryCost: number;               // estimated memory footprint
  failureRate: number;                 // 0-1
  isHot: boolean;                      // invocation rate exceeds hotThreshold
  isMigratable: boolean;              // false for protected experts on critical lanes
}

// ── Placement decisions ──────────────────────────────────────────────────────

export interface PlacementDecision {
  expertId: string;
  action: 'keep' | 'migrate' | 'clone' | 'recall';
  fromLane: LaneId;
  toLane: LaneId;
  reason: string;
  confidence: number;                  // 0-100
  timestamp: number;
}

export type PlacementAction =
  | 'expert_placed'
  | 'expert_migrated'
  | 'expert_cloned'
  | 'expert_recalled'
  | 'lane_saturated'
  | 'lane_cooled'
  | 'rebalance_triggered'
  | 'hotspot_detected';

export interface PlacementLedgerEntry {
  timestamp: number;
  action: PlacementAction;
  expertId?: string;
  laneId?: string;
  details: Record<string, unknown>;
}

// ── Migration plan ───────────────────────────────────────────────────────────

export interface MigrationPlan {
  expertId: string;
  fromLane: LaneId;
  toLane: LaneId;
  preMigrationState: {
    expertPlacement: ExpertPlacement;
    fromLaneProfile: LaneProfile;
    toLaneProfile: LaneProfile;
  };
  isProtected: boolean;
  estimatedCost: number;
  timestamp: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface PlacementConfig {
  hotThresholdInvocationsPerMinute: number;
  saturationThreshold: number;
  cooldownPeriodMs: number;
  maxMigrationsPerCycle: number;
  affinityDecayRate: number;
  burstLaneMaxExperts: number;
  rebalanceIntervalMs: number;
  protectedExpertMigrationThreshold: number;
}

export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = {
  hotThresholdInvocationsPerMinute: 10,
  saturationThreshold: 80,
  cooldownPeriodMs: 30_000,
  maxMigrationsPerCycle: 3,
  affinityDecayRate: 0.95,
  burstLaneMaxExperts: 6,
  rebalanceIntervalMs: 15_000,
  protectedExpertMigrationThreshold: 95,
};

// ── Default lanes ────────────────────────────────────────────────────────────

function makeLane(
  id: LaneId,
  pool: ExpertPool,
  kind: 'primary' | 'burst',
  maxConcurrent: number,
): LaneProfile {
  return {
    id,
    pool,
    kind,
    utilization: 0,
    queueDepth: 0,
    memoryPressure: 0,
    avgResponseTimeMs: 0,
    activeExpertCount: 0,
    expertIds: [],
    saturationThreshold: DEFAULT_PLACEMENT_CONFIG.saturationThreshold,
    maxConcurrent,
    status: 'idle',
  };
}

export const DEFAULT_LANES: LaneProfile[] = [
  makeLane('claude:primary', 'claude', 'primary', 5),
  makeLane('gpt:primary',    'gpt',    'primary', 5),
  makeLane('grok:primary',   'grok',   'primary', 5),
  makeLane('shared:primary', 'shared', 'primary', 8),
  makeLane('shared:burst-1', 'shared', 'burst',   6),
  makeLane('shared:burst-2', 'shared', 'burst',   6),
];

// ── Placement report ─────────────────────────────────────────────────────────

export interface PlacementReport {
  timestamp: number;
  totalExperts: number;
  hotExperts: number;
  totalLanes: number;
  saturatedLanes: number;
  idleLanes: number;
  recentMigrations: number;
  lanes: LaneProfile[];
  hotspots: { expertId: string; lane: LaneId; invocationRate: number }[];
}
