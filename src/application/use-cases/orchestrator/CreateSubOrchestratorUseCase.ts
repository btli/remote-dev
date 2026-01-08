/**
 * CreateSubOrchestratorUseCase - Create a folder-scoped sub-orchestrator.
 *
 * Sub-orchestrators monitor sessions within a specific folder and take
 * precedence over the master orchestrator for those sessions.
 *
 * This use case:
 * 1. Validates that a sub-orchestrator doesn't already exist for this folder
 * 2. Creates a special terminal session with isOrchestratorSession=true
 * 3. Creates the Orchestrator domain entity with folder scope
 * 4. Persists to the database via repository
 * 5. Creates an audit log entry
 */

import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import { SubOrchestratorAlreadyExistsError } from "@/domain/errors/OrchestratorErrors";

export interface CreateSubOrchestratorInput {
  userId: string;
  sessionId: string; // The terminal session ID (must be created first)
  folderId: string; // The folder this sub-orchestrator monitors
  customInstructions?: string;
  monitoringInterval?: number; // Seconds between monitoring checks (default: 30)
  stallThreshold?: number; // Seconds of inactivity before considering session stalled (default: 300)
  autoIntervention?: boolean; // Whether to automatically inject commands (default: false)
}

export interface CreateSubOrchestratorOutput {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

export class CreateSubOrchestratorUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository
  ) {}

  async execute(input: CreateSubOrchestratorInput): Promise<CreateSubOrchestratorOutput> {
    // Step 1: Validate that a sub-orchestrator doesn't already exist for this folder
    const existingSubOrchestrators = await this.orchestratorRepository.findByScope(
      input.userId,
      input.folderId
    );

    if (existingSubOrchestrators.length > 0) {
      const existing = existingSubOrchestrators[0];
      throw new SubOrchestratorAlreadyExistsError(
        input.folderId,
        existing.id
      );
    }

    // Step 2: Create the Orchestrator domain entity with folder scope
    const orchestrator = Orchestrator.createSubOrchestrator({
      sessionId: input.sessionId,
      userId: input.userId,
      scopeId: input.folderId,
      customInstructions: input.customInstructions,
      monitoringInterval: input.monitoringInterval ?? 30,
      stallThreshold: input.stallThreshold ?? 300,
      autoIntervention: input.autoIntervention ?? false,
    });

    // Step 3: Persist the orchestrator
    await this.orchestratorRepository.save(orchestrator);

    // Step 4: Create audit log entry
    const auditLog = OrchestratorAuditLog.forOrchestratorCreated(
      orchestrator.id,
      orchestrator.type,
      null, // No target session for creation event
      { userId: input.userId, folderId: input.folderId }
    );
    await this.auditLogRepository.save(auditLog);

    return {
      orchestrator,
      auditLog,
    };
  }
}
