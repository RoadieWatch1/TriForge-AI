/**
 * supervisor.ts — lightweight service supervisor for TriForge AI subsystems.
 *
 * Monitors critical services and automatically restarts them on crash.
 * Does NOT touch UI, renderer, or React code.
 */

type ServiceStatus = 'starting' | 'running' | 'crashed' | 'disabled';

interface ServiceDefinition {
  name: string;
  start: () => Promise<void> | void;
  /** Milliseconds to wait before restarting after a crash. Default: 3000 */
  restartDelay?: number;
  /** Maximum restarts before giving up. Default: 10 */
  maxRestarts?: number;
}

export class ServiceSupervisor {
  private services      = new Map<string, ServiceDefinition>();
  private status        = new Map<string, ServiceStatus>();
  private restartCounts = new Map<string, number>();

  register(service: ServiceDefinition): void {
    this.services.set(service.name, service);
    this.status.set(service.name, 'starting');
    this.restartCounts.set(service.name, 0);
  }

  async startAll(): Promise<void> {
    for (const service of this.services.values()) {
      await this.startService(service);
    }
  }

  getStatus(): Record<string, ServiceStatus> {
    return Object.fromEntries(this.status.entries());
  }

  private async startService(service: ServiceDefinition): Promise<void> {
    const maxRestarts = service.maxRestarts ?? 10;
    const count = this.restartCounts.get(service.name) ?? 0;

    if (count > maxRestarts) {
      console.error(`[Supervisor] ${service.name} disabled after ${count} crashes — giving up`);
      this.status.set(service.name, 'disabled');
      return;
    }

    try {
      if (count > 0) {
        console.log(`[Supervisor] Restarting ${service.name} (attempt ${count})`);
      } else {
        console.log(`[Supervisor] Starting ${service.name}`);
      }

      this.status.set(service.name, 'running');
      await service.start();
      console.log(`[Supervisor] ${service.name} started`);
    } catch (err) {
      const nextCount = count + 1;
      this.restartCounts.set(service.name, nextCount);
      this.status.set(service.name, 'crashed');

      if (nextCount > maxRestarts) {
        console.error(`[Supervisor] ${service.name} disabled after ${nextCount} crashes`, err);
        this.status.set(service.name, 'disabled');
        return;
      }

      const delay = service.restartDelay ?? 3000;
      console.error(`[Supervisor] ${service.name} crashed — restarting in ${delay}ms`, err);
      setTimeout(() => this.startService(service), delay);
    }
  }
}

/** Singleton supervisor — shared across the main process */
export const supervisor = new ServiceSupervisor();
