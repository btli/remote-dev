/**
 * AutoUpdateOrchestrator - Coordinates the full auto-update lifecycle.
 *
 * Lifecycle: detect → schedule (delay) → drain → apply → restart
 *
 * Started alongside the UpdateScheduler in the terminal server process.
 * Recovers in-progress deployments on restart by reading persisted state.
 */

import type { ScheduleAutoUpdateUseCase } from "@/application/use-cases/update/ScheduleAutoUpdateUseCase";
import type { DrainSessionsUseCase } from "@/application/use-cases/update/DrainSessionsUseCase";
import type { ApplyUpdateUseCase } from "@/application/use-cases/update/ApplyUpdateUseCase";
import type { DeploymentRepository } from "@/application/ports/DeploymentRepository";
import { UpdatePolicy } from "@/domain/value-objects/UpdatePolicy";
import { DeploymentAlreadyActiveError } from "@/domain/errors/UpdateError";
import type { DeploymentStageTag } from "@/domain/value-objects/DeploymentStage";
import { createLogger } from "@/lib/logger";

const log = createLogger("AutoUpdateOrchestrator");

export class AutoUpdateOrchestrator {
  private policy: UpdatePolicy;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly scheduleUseCase: ScheduleAutoUpdateUseCase,
    private readonly drainUseCase: DrainSessionsUseCase,
    private readonly applyUseCase: ApplyUpdateUseCase,
    private readonly deploymentRepository: DeploymentRepository
  ) {
    this.policy = UpdatePolicy.fromEnv();
  }

  /**
   * Start the orchestrator. Recovers pending deployments from the database.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    log.info("Started", { policy: this.policy.toString() });

    if (!this.policy.enabled) {
      log.info("Auto-update is disabled (set AUTO_UPDATE_ENABLED=true to enable)");
      return;
    }

    // Recover any in-progress deployment from a previous server instance
    await this.recoverPendingDeployment();
  }

  /**
   * Stop the orchestrator and cancel any pending timers.
   */
  stop(): void {
    this.running = false;
    if (this.applyTimer) {
      clearTimeout(this.applyTimer);
      this.applyTimer = null;
    }
    log.info("Stopped");
  }

  /**
   * Called by UpdateScheduler when a new release is detected.
   */
  async onUpdateDetected(version: string): Promise<void> {
    if (!this.policy.enabled) {
      log.debug("Auto-update disabled, ignoring detected update", { version });
      return;
    }

    if (this.applyTimer) {
      log.debug("Auto-update already scheduled, ignoring", { version });
      return;
    }

    try {
      const result = await this.scheduleUseCase.execute({
        version,
        policy: this.policy,
      });

      const scheduledFor = result.deployment.scheduledFor;
      if (!scheduledFor) return;

      const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());
      this.armTimer(delayMs, version);

      log.info("Auto-update armed", {
        version,
        delayMinutes: this.policy.delayMinutes,
        scheduledFor: scheduledFor.toISOString(),
      });
    } catch (error) {
      if (error instanceof DeploymentAlreadyActiveError) {
        log.debug("Deployment already active, skipping schedule", {
          currentStage: error.currentStage,
        });
        return;
      }
      log.error("Failed to schedule auto-update", { error: String(error) });
    }
  }

  /**
   * Cancel a pending scheduled update.
   * Cannot cancel a deployment that has already started draining or applying.
   */
  async cancelPendingUpdate(): Promise<void> {
    const existing = await this.deploymentRepository.getCurrent();
    if (existing && existing.stage.isActive()) {
      log.warn("Cannot cancel active deployment", { stage: existing.stageTag });
      throw new DeploymentAlreadyActiveError(existing.stageTag);
    }

    if (this.applyTimer) {
      clearTimeout(this.applyTimer);
      this.applyTimer = null;
    }

    await this.deploymentRepository.clear();
    log.info("Pending auto-update cancelled");
  }

  /**
   * Get the current deployment stage for status reporting.
   */
  async getDeploymentStage(): Promise<DeploymentStageTag | null> {
    const deployment = await this.deploymentRepository.getCurrent();
    return deployment?.stageTag ?? null;
  }

  private armTimer(delayMs: number, version: string): void {
    if (this.applyTimer) {
      clearTimeout(this.applyTimer);
    }

    this.applyTimer = setTimeout(async () => {
      this.applyTimer = null;
      await this.executeUpdate(version);
    }, delayMs);
  }

  private async executeUpdate(version: string): Promise<void> {
    log.info("Starting auto-update", { version });

    try {
      let deployment = await this.deploymentRepository.getCurrent();
      if (!deployment) {
        log.warn("No deployment record found, aborting auto-update");
        return;
      }

      const drainResult = await this.drainUseCase.execute({
        deployment,
        policy: this.policy,
      });

      log.info("Drain complete", {
        drained: drainResult.drained,
        remainingSessions: drainResult.remainingSessions,
        elapsedSeconds: drainResult.elapsedSeconds,
      });

      // Re-read deployment (drain use case may have updated it)
      deployment = await this.deploymentRepository.getCurrent();
      if (!deployment) {
        log.warn("Deployment record lost during drain, aborting");
        return;
      }

      const applyingDeployment = deployment.startApply();
      await this.deploymentRepository.save(applyingDeployment);

      await this.applyUseCase.execute();

      // Mark applied (may not execute if restart happens first)
      const appliedDeployment = applyingDeployment.markApplied();
      await this.deploymentRepository.save(appliedDeployment);

      log.info("Auto-update applied successfully", { version });
    } catch (error) {
      log.error("Auto-update failed", { version, error: String(error) });

      // Record failure
      try {
        const deployment = await this.deploymentRepository.getCurrent();
        if (deployment) {
          const failedDeployment = deployment.markFailed(String(error));
          await this.deploymentRepository.save(failedDeployment);
        }
      } catch (saveError) {
        log.error("Failed to record deployment failure", { error: String(saveError) });
      }
    }
  }

  /**
   * On startup, check if there's a pending deployment from a previous instance.
   * If the scheduled time is in the past, apply immediately.
   * If in the future, re-arm the timer for the remaining delay.
   */
  private async recoverPendingDeployment(): Promise<void> {
    const deployment = await this.deploymentRepository.getCurrent();
    if (!deployment) return;

    const stage = deployment.stageTag;

    // Terminal stages — clear stale state
    if (deployment.stage.isTerminal()) {
      log.debug("Clearing terminal deployment state", { stage });
      await this.deploymentRepository.clear();
      return;
    }

    // If scheduled, re-arm timer
    if (stage === "scheduled" && deployment.scheduledFor) {
      const remainingMs = deployment.scheduledFor.getTime() - Date.now();
      if (remainingMs > 0) {
        log.info("Recovering scheduled deployment", {
          version: deployment.version,
          remainingMinutes: Math.ceil(remainingMs / 60_000),
        });
        this.armTimer(remainingMs, deployment.version);
      } else {
        log.info("Scheduled deployment overdue, applying now", {
          version: deployment.version,
        });
        this.armTimer(0, deployment.version);
      }
      return;
    }

    // If draining or applying, the previous instance was interrupted mid-update.
    // Clear the state and let the next poll cycle detect the update again.
    if (stage === "draining" || stage === "applying") {
      log.warn("Previous deployment was interrupted, clearing state", {
        stage,
        version: deployment.version,
      });
      await this.deploymentRepository.clear();
      return;
    }

    // Detected but not yet scheduled — schedule now
    if (stage === "detected") {
      log.info("Recovering detected deployment, scheduling", {
        version: deployment.version,
      });
      await this.onUpdateDetected(deployment.version);
    }
  }
}
