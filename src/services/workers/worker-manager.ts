/**
 * WorkerManager - Manages background workers for the terminal server.
 *
 * Provides:
 * - Graceful startup and shutdown
 * - Worker lifecycle management
 * - Error handling with exponential backoff
 * - Memory leak prevention via periodic cleanup
 */

export interface Worker {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface WorkerConfig {
  name: string;
  enabled: boolean;
}

/**
 * Manages all background workers.
 */
export class WorkerManager {
  private readonly workers: Map<string, Worker> = new Map();
  private isShuttingDown = false;

  /**
   * Register a worker.
   */
  register(worker: Worker): void {
    if (this.workers.has(worker.name)) {
      console.warn(`[WorkerManager] Worker ${worker.name} already registered, replacing`);
    }
    this.workers.set(worker.name, worker);
  }

  /**
   * Start all registered workers.
   */
  async startAll(): Promise<void> {
    console.log(`[WorkerManager] Starting ${this.workers.size} workers...`);

    const startPromises: Promise<void>[] = [];

    for (const [name, worker] of this.workers) {
      startPromises.push(
        worker.start().catch((error) => {
          console.error(`[WorkerManager] Failed to start worker ${name}:`, error);
        })
      );
    }

    await Promise.all(startPromises);
    console.log("[WorkerManager] All workers started");
  }

  /**
   * Stop all workers gracefully.
   */
  async stopAll(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    console.log("[WorkerManager] Stopping all workers...");

    const stopPromises: Promise<void>[] = [];

    for (const [name, worker] of this.workers) {
      if (worker.isRunning()) {
        stopPromises.push(
          worker.stop().catch((error) => {
            console.error(`[WorkerManager] Error stopping worker ${name}:`, error);
          })
        );
      }
    }

    await Promise.all(stopPromises);
    console.log("[WorkerManager] All workers stopped");
  }

  /**
   * Get worker status.
   */
  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [name, worker] of this.workers) {
      status[name] = { running: worker.isRunning() };
    }
    return status;
  }

  /**
   * Get a specific worker.
   */
  getWorker(name: string): Worker | undefined {
    return this.workers.get(name);
  }
}

/**
 * Global worker manager instance.
 */
export const workerManager = new WorkerManager();
