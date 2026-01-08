/**
 * CreateMasterOrchestratorUseCase - Create a master orchestrator for a user.
 *
 * The master orchestrator monitors ALL sessions across all folders.
 * Each user can have exactly ONE master orchestrator.
 *
 * This use case:
 * 1. Validates that the user doesn't already have a master orchestrator
 * 2. Creates a special terminal session with isOrchestratorSession=true
 * 3. Creates the Orchestrator domain entity
 * 4. Persists to the database via repository
 * 5. Creates an audit log entry
 */

import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import { MasterOrchestratorAlreadyExistsError } from "@/domain/errors/OrchestratorErrors";

export interface CreateMasterOrchestratorInput {
  userId: string;
  sessionId: string; // The terminal session ID (must be created first)
  customInstructions?: string;
  monitoringInterval?: number; // Seconds between monitoring checks (default: 30)
  stallThreshold?: number; // Seconds of inactivity before considering session stalled (default: 300)
  autoIntervention?: boolean; // Whether to automatically inject commands (default: false)
}

export interface CreateMasterOrchestratorOutput {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

export class CreateMasterOrchestratorUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository
  ) {}

  async execute(input: CreateMasterOrchestratorInput): Promise<CreateMasterOrchestratorOutput> {
    // Step 1: Validate that user doesn't already have a master orchestrator
    const existingMaster = await this.orchestratorRepository.findMasterByUserId(input.userId);
    if (existingMaster) {
      throw new MasterOrchestratorAlreadyExistsError(
        input.userId,
        existingMaster.id
      );
    }

    // Step 2: Create the Orchestrator domain entity
    const orchestrator = Orchestrator.createMaster({
      sessionId: input.sessionId,
      userId: input.userId,
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
      { userId: input.userId }
    );
    await this.auditLogRepository.save(auditLog);

    return {
      orchestrator,
      auditLog,
    };
  }
}
