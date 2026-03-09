// ── healthScanner.ts — Periodic component health classification ─────────────
//
// Scans all tracked components and classifies their health status.
// Identifies dormant candidates for quarantine (never protected categories).

import type { ComponentUseTracker } from './componentUseTracker';
import type { ComponentRecord, ComponentHealthStatus, EvolutionConfig } from './evolutionTypes';
import { DEFAULT_EVOLUTION_CONFIG, PROTECTED_CATEGORIES } from './evolutionTypes';

export class HealthScanner {
  private _tracker: ComponentUseTracker;
  private _config: EvolutionConfig;
  private _baselineLatency: Map<string, number> = new Map();

  constructor(tracker: ComponentUseTracker, config?: Partial<EvolutionConfig>) {
    this._tracker = tracker;
    this._config = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
  }

  // ── Full scan ───────────────────────────────────────────────────────────────

  scan(): ComponentRecord[] {
    const records = this._tracker.getAllRecords();

    for (const record of records) {
      const newStatus = this.classifyHealth(record);
      if (newStatus !== record.healthStatus && record.healthStatus !== 'quarantined') {
        record.healthStatus = newStatus;
      }
    }

    return records;
  }

  // ── Classification ──────────────────────────────────────────────────────────

  classifyHealth(record: ComponentRecord): ComponentHealthStatus {
    // Quarantined components stay quarantined until explicitly restored
    if (record.healthStatus === 'quarantined') return 'quarantined';

    // Recently restored components stay in restored until next scan finds them healthy
    if (record.healthStatus === 'restored') {
      // Check if they're now actually healthy
      if (this._isHealthy(record)) return 'healthy';
      return 'restored';
    }

    // Dormant: unused for more than threshold days AND has been used before
    const daysSinceUse = (Date.now() - record.lastUsed) / (24 * 60 * 60 * 1000);
    if (
      record.useCount >= this._config.minUseCountForHealth &&
      daysSinceUse > this._config.dormantThresholdDays
    ) {
      return 'dormant';
    }

    // Degraded: high error rate or excessive latency
    if (this._isDegraded(record)) return 'degraded';

    // Healthy: active, low errors, normal latency
    return 'healthy';
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  getDormantCandidates(): ComponentRecord[] {
    const records = this._tracker.getAllRecords();
    return records.filter(r =>
      this.classifyHealth(r) === 'dormant' &&
      !r.isProtected &&
      !PROTECTED_CATEGORIES.includes(r.category)
    );
  }

  getDegradedComponents(): ComponentRecord[] {
    const records = this._tracker.getAllRecords();
    return records.filter(r => this.classifyHealth(r) === 'degraded');
  }

  // ── Health report ───────────────────────────────────────────────────────────

  generateHealthReport(): string {
    const records = this.scan();

    const healthy = records.filter(r => r.healthStatus === 'healthy');
    const degraded = records.filter(r => r.healthStatus === 'degraded');
    const dormant = records.filter(r => r.healthStatus === 'dormant');
    const quarantined = records.filter(r => r.healthStatus === 'quarantined');
    const restored = records.filter(r => r.healthStatus === 'restored');

    const lines: string[] = [
      `Component Health Report — ${new Date().toISOString().slice(0, 10)}`,
      `Total: ${records.length} | Healthy: ${healthy.length} | Degraded: ${degraded.length} | Dormant: ${dormant.length} | Quarantined: ${quarantined.length} | Restored: ${restored.length}`,
      '',
    ];

    if (degraded.length > 0) {
      lines.push('DEGRADED:');
      for (const r of degraded) {
        const errorRate = r.useCount > 0 ? (r.errorCount / r.useCount * 100).toFixed(1) : '0';
        lines.push(`  - ${r.name} (${r.category}) — error rate: ${errorRate}%, latency: ${Math.round(r.averageLatencyMs)}ms`);
      }
      lines.push('');
    }

    if (dormant.length > 0) {
      lines.push('DORMANT:');
      for (const r of dormant) {
        const daysSince = Math.round((Date.now() - r.lastUsed) / (24 * 60 * 60 * 1000));
        lines.push(`  - ${r.name} (${r.category}) — unused for ${daysSince} days, ${r.isProtected ? 'PROTECTED' : 'can quarantine'}`);
      }
      lines.push('');
    }

    if (quarantined.length > 0) {
      lines.push('QUARANTINED:');
      for (const r of quarantined) {
        const since = r.quarantinedAt ? new Date(r.quarantinedAt).toISOString().slice(0, 10) : 'unknown';
        lines.push(`  - ${r.name} (${r.category}) — since ${since}`);
      }
    }

    return lines.join('\n');
  }

  // ── Baseline management ─────────────────────────────────────────────────────

  setBaselineLatency(componentId: string, latencyMs: number): void {
    this._baselineLatency.set(componentId, latencyMs);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _isHealthy(record: ComponentRecord): boolean {
    return !this._isDegraded(record) && !this._isDormant(record);
  }

  private _isDegraded(record: ComponentRecord): boolean {
    if (record.useCount < this._config.minUseCountForHealth) return false;

    // Error rate > 10%
    const errorRate = record.errorCount / record.useCount;
    if (errorRate > 0.1) return true;

    // Latency > 2x baseline
    const baseline = this._baselineLatency.get(record.id);
    if (baseline && record.averageLatencyMs > baseline * 2) return true;

    return false;
  }

  private _isDormant(record: ComponentRecord): boolean {
    const daysSinceUse = (Date.now() - record.lastUsed) / (24 * 60 * 60 * 1000);
    return (
      record.useCount >= this._config.minUseCountForHealth &&
      daysSinceUse > this._config.dormantThresholdDays
    );
  }
}
