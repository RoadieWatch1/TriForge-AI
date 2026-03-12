// ── buses.ts ─────────────────────────────────────────────────────────────────
//
// Specialized event buses for major subsystems.
// Each module emits to its own bus — consumers subscribe only to what they need.
//
// Global engine EventBus (eventBus from core/eventBus) remains the authoritative
// audit stream. These buses are lightweight signal channels for real-time
// streaming and coordination within each subsystem.
//
// Usage:
//   import { councilBus } from '../events/buses';
//   councilBus.emit('RESULT', { provider, text });
//   councilBus.on('RESULT', (data) => { ... });

import { createBus } from './createBus';

/** Council Executor + CouncilConversationEngine events (streaming, draft, critique). */
export const councilBus = createBus();

/** Voice subsystem events (interrupt, chunk, done, transcript). */
export const voiceBus = createBus();

/** ThinkTankPlanner / planning pipeline events. */
export const plannerBus = createBus();

/** Cross-system notifications, health checks, and system-level events. */
export const systemBus = createBus();
