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
import { TransactionManager } from "@/infrastructure/persistence/TransactionManager";
import { OrchestratorNotFoundError } from "@/domain/errors/OrchestratorErrors";

export interface ResumeOrchestratorInput {
  orchestratorId: string;
  userId: string; // Required for authorization validation
  reason?: string; // Optional reason for resuming (for audit log)
}

export interface ResumeOrchestratorOutput {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

export class ResumeOrchestratorUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly transactionManager: TransactionManager
  ) {}

  async execute(input: ResumeOrchestratorInput): Promise<ResumeOrchestratorOutput> {
    // Step 1: Get the orchestrator
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
    }

    // Step 1.5: Validate userId ownership (TOCTOU protection)
    if (orchestrator.userId !== input.userId) {
      throw new OrchestratorNotFoundError(input.orchestratorId); // Return same error to avoid leaking existence
    }

    // Step 2: Resume the orchestrator
    const resumedOrchestrator = orchestrator.resume();

    // Step 3: Create audit log entry
    const auditLog = OrchestratorAuditLog.forStatusChanged(
      input.orchestratorId,
      orchestrator.status,
      "idle"
    );

    // Step 4: Persist orchestrator update and audit log atomically within a transaction
    await this.transactionManager.execute(async (tx) => {
      // Only update if status changed
      if (resumedOrchestrator !== orchestrator) {
        await this.orchestratorRepository.update(resumedOrchestrator, tx);
      }
      await this.auditLogRepository.save(auditLog, tx);
    });

    return {
      orchestrator: resumedOrchestrator,
      auditLog,
    };
  }
}
