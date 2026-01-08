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
import { TransactionManager } from "@/infrastructure/persistence/TransactionManager";
import { OrchestratorNotFoundError } from "@/domain/errors/OrchestratorErrors";

export interface PauseOrchestratorInput {
  orchestratorId: string;
  userId: string; // Required for authorization validation
  reason?: string; // Optional reason for pausing (for audit log)
}

export interface PauseOrchestratorOutput {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

export class PauseOrchestratorUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly transactionManager: TransactionManager
  ) {}

  async execute(input: PauseOrchestratorInput): Promise<PauseOrchestratorOutput> {
    // Step 1: Get the orchestrator
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
    }

    // Step 1.5: Validate userId ownership (TOCTOU protection)
    if (orchestrator.userId !== input.userId) {
      throw new OrchestratorNotFoundError(input.orchestratorId); // Return same error to avoid leaking existence
    }

    // Step 2: Pause the orchestrator
    const pausedOrchestrator = orchestrator.pause();

    // Step 3: Create audit log entry
    const auditLog = OrchestratorAuditLog.forStatusChanged(
      input.orchestratorId,
      orchestrator.status,
      "paused"
    );

    // Step 4: Persist orchestrator update and audit log atomically within a transaction
    await this.transactionManager.execute(async (tx) => {
      // Only update if status changed
      if (pausedOrchestrator !== orchestrator) {
        await this.orchestratorRepository.update(pausedOrchestrator, tx);
      }
      await this.auditLogRepository.save(auditLog, tx);
    });

    return {
      orchestrator: pausedOrchestrator,
      auditLog,
    };
  }
}
