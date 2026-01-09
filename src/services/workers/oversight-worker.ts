/**
 * OversightWorker - Background worker for asynchronous oversight.
 *
 * Runs periodic safety checks on all active delegations:
 * - Detects infinite loops, cost runaway, error spirals
 * - Detects task deviation and safety violations
 * - Executes interventions (warn, redirect, pause, terminate)
 *
 * Features:
 * - Configurable check interval (default: 30s)
 * - Concurrent delegation checking
 * - Automatic intervention execution
 */

import { db } from "@/db";
import { delegations } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { DelegationStatusType } from "@/db/schema";
import type { Worker } from "./worker-manager";
import {
  checkDelegation,
  executeIntervention,
  cleanupDelegation,
  getActiveOversights,
} from "@/services/oversight-service";
import {
  type OversightConfig,
  DEFAULT_OVERSIGHT_CONFIG,
} from "@/domain/entities/OverseerCheck";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

interface OversightWorkerConfig {
  /** Override for oversight config */
  oversightConfig?: Partial<OversightConfig>;
  /** Maximum concurrent checks */
  maxConcurrent: number;
}

const DEFAULT_WORKER_CONFIG: OversightWorkerConfig = {
  maxConcurrent: 10,
};

// ─────────────────────────────────────────────────────────────────────────────
// Oversight Worker
// ─────────────────────────────────────────────────────────────────────────────

export class OversightWorker implements Worker {
  readonly name = "oversight";
  private workerConfig: OversightWorkerConfig;
  private oversightConfig: OversightConfig;
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;

  constructor(config: Partial<OversightWorkerConfig> = {}) {
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config };
    this.oversightConfig = {
      ...DEFAULT_OVERSIGHT_CONFIG,
      ...config.oversightConfig,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn("[OversightWorker] Already running");
      return;
    }

    if (!this.oversightConfig.enabled) {
      console.log("[OversightWorker] Oversight is disabled, not starting");
      return;
    }

    console.log(
      `[OversightWorker] Starting with ${this.oversightConfig.checkIntervalSeconds}s interval`
    );

    this.running = true;

    // Run immediately then on interval
    await this.runCycle();

    this.interval = setInterval(async () => {
      if (!this.processing) {
        await this.runCycle();
      }
    }, this.oversightConfig.checkIntervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log("[OversightWorker] Stopping...");

    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Wait for current processing to complete (with timeout)
    const timeout = 30000;
    const start = Date.now();
    while (this.processing && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("[OversightWorker] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run an oversight cycle on all active delegations.
   */
  private async runCycle(): Promise<void> {
    if (!this.running) return;

    this.processing = true;

    try {
      // Find all active delegations
      const activeDelegations = await this.findActiveDelegations();

      if (activeDelegations.length === 0) {
        // Cleanup any orphaned oversight states
        this.cleanupOrphanedStates([]);
        this.processing = false;
        return;
      }

      // Limit concurrent processing
      const toProcess = activeDelegations.slice(0, this.workerConfig.maxConcurrent);

      // Check each delegation
      const results = await Promise.allSettled(
        toProcess.map((d) => this.checkAndIntervene(d.id))
      );

      // Log any errors
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
          console.error(
            `[OversightWorker] Error checking delegation ${toProcess[i].id}:`,
            result.reason
          );
        }
      }

      // Cleanup states for delegations that are no longer active
      this.cleanupOrphanedStates(activeDelegations.map((d) => d.id));

      console.log(
        `[OversightWorker] Checked ${toProcess.length} delegations`
      );
    } catch (error) {
      console.error("[OversightWorker] Cycle error:", error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Find all active delegations.
   */
  private async findActiveDelegations(): Promise<Array<{ id: string }>> {
    const activeStatuses: DelegationStatusType[] = ["running", "monitoring"];

    const results = await db
      .select({
        id: delegations.id,
      })
      .from(delegations)
      .where(inArray(delegations.status, activeStatuses))
      .limit(this.workerConfig.maxConcurrent * 2);

    return results;
  }

  /**
   * Check a delegation and execute any required intervention.
   */
  private async checkAndIntervene(delegationId: string): Promise<void> {
    const check = await checkDelegation(delegationId, this.oversightConfig);

    if (!check) return;

    // Log issues if any
    if (check.hasIssues()) {
      const issues = check.assessment.issues;
      console.log(
        `[OversightWorker] Delegation ${delegationId}: ${issues.length} issues found`,
        issues.map((i) => `[${i.severity}] ${i.type}: ${i.description}`)
      );
    }

    // Execute intervention if required
    if (check.requiresIntervention() && !check.interventionExecuted()) {
      await executeIntervention(check);
    }
  }

  /**
   * Cleanup oversight states for delegations no longer active.
   */
  private cleanupOrphanedStates(activeDelegationIds: string[]): void {
    const activeSet = new Set(activeDelegationIds);
    const currentStates = getActiveOversights();

    for (const delegationId of currentStates) {
      if (!activeSet.has(delegationId)) {
        cleanupDelegation(delegationId);
      }
    }
  }
}

/**
 * Create an oversight worker instance.
 */
export function createOversightWorker(
  config?: Partial<OversightWorkerConfig>
): OversightWorker {
  return new OversightWorker(config);
}
