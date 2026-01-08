/**
 * ResumeOrchestratorUseCase - Resume a paused orchestrator's monitoring activity.
 *
 * When resumed, the orchestrator will:
 * - Resume monitoring sessions for stalls
 * - Resume generating insights
 * - Resume automated interventions (if enabled)
 *
 * This use case:
 * 1. Validates that the orchestrator exists
 * 2. Resumes the orchestrator (updates status to "idle")
 * 3. Creates an audit log entry
 */

import type { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import { OrchestratorNotFoundError } from "@/domain/errors/OrchestratorErrors";

export interface ResumeOrchestratorInput {
  orchestratorId: string;
  reason?: string; // Optional reason for resuming (for audit log)
}

export interface ResumeOrchestratorOutput {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

export class ResumeOrchestratorUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository
  ) {}

  async execute(input: ResumeOrchestratorInput): Promise<ResumeOrchestratorOutput> {
    // Step 1: Get the orchestrator
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
    }

    // Step 2: Resume the orchestrator
    const resumedOrchestrator = orchestrator.resume();

    // Step 3: Persist the updated orchestrator (only if status changed)
    if (resumedOrchestrator !== orchestrator) {
      await this.orchestratorRepository.update(resumedOrchestrator);
    }

    // Step 4: Create audit log entry
    const auditLog = OrchestratorAuditLog.forStatusChanged(
      input.orchestratorId,
      orchestrator.status,
      "idle"
    );
    await this.auditLogRepository.save(auditLog);

    return {
      orchestrator: resumedOrchestrator,
      auditLog,
    };
  }
}
