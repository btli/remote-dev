/**
 * PauseOrchestratorUseCase - Pause an orchestrator's monitoring activity.
 *
 * When paused, the orchestrator will:
 * - Stop monitoring sessions for stalls
 * - Stop generating insights
 * - Not inject any commands
 *
 * The orchestrator's terminal session remains active, but it won't
 * perform any automated actions until resumed.
 *
 * This use case:
 * 1. Validates that the orchestrator exists
 * 2. Pauses the orchestrator (updates status to "paused")
 * 3. Creates an audit log entry
 */

import type { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import { OrchestratorNotFoundError } from "@/domain/errors/OrchestratorErrors";

export interface PauseOrchestratorInput {
  orchestratorId: string;
  reason?: string; // Optional reason for pausing (for audit log)
}

export interface PauseOrchestratorOutput {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

export class PauseOrchestratorUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository
  ) {}

  async execute(input: PauseOrchestratorInput): Promise<PauseOrchestratorOutput> {
    // Step 1: Get the orchestrator
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
    }

    // Step 2: Pause the orchestrator
    const pausedOrchestrator = orchestrator.pause();

    // Step 3: Persist the updated orchestrator (only if status changed)
    if (pausedOrchestrator !== orchestrator) {
      await this.orchestratorRepository.update(pausedOrchestrator);
    }

    // Step 4: Create audit log entry
    const auditLog = OrchestratorAuditLog.forStatusChanged(
      input.orchestratorId,
      orchestrator.status,
      "paused"
    );
    await this.auditLogRepository.save(auditLog);

    return {
      orchestrator: pausedOrchestrator,
      auditLog,
    };
  }
}
