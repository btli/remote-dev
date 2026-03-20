/**
 * ScheduleAutoUpdateUseCase - Creates and persists a deployment record
 * when an update is detected, computing the scheduled apply time.
 *
 * Called by the AutoUpdateOrchestrator when CheckForUpdatesUseCase
 * returns an available update and auto-update is enabled.
 */

import { UpdateDeployment } from "@/domain/entities/UpdateDeployment";
import type { DeploymentRepository } from "@/application/ports/DeploymentRepository";
import type { UpdatePolicy } from "@/domain/value-objects/UpdatePolicy";
import { DeploymentAlreadyActiveError } from "@/domain/errors/UpdateError";
import { createLogger } from "@/lib/logger";

const log = createLogger("ScheduleAutoUpdate");

export interface ScheduleAutoUpdateInput {
  version: string;
  policy: UpdatePolicy;
}

export interface ScheduleAutoUpdateOutput {
  deployment: UpdateDeployment;
}

export class ScheduleAutoUpdateUseCase {
  constructor(
    private readonly deploymentRepository: DeploymentRepository
  ) {}

  async execute(input: ScheduleAutoUpdateInput): Promise<ScheduleAutoUpdateOutput> {
    const { version, policy } = input;

    const existing = await this.deploymentRepository.getCurrent();
    if (existing && !existing.stage.isTerminal()) {
      throw new DeploymentAlreadyActiveError(existing.stageTag);
    }

    const scheduledFor = new Date(Date.now() + policy.delayMs);
    const deployment = UpdateDeployment.detected(version).schedule(scheduledFor);

    await this.deploymentRepository.save(deployment);

    log.info("Auto-update scheduled", {
      version,
      scheduledFor: scheduledFor.toISOString(),
      delayMinutes: policy.delayMinutes,
    });

    return { deployment };
  }
}
