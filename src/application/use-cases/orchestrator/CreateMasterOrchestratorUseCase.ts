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
 * 4. Persists to the database via repository (within a transaction)
 * 5. Creates an audit log entry (within the same transaction)
 *
 * Note: Steps 4-5 are wrapped in a transaction to ensure atomicity.
 */

import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import { MasterOrchestratorAlreadyExistsError } from "@/domain/errors/OrchestratorErrors";
import { TransactionManager } from "@/infrastructure/persistence/TransactionManager";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly transactionManager: TransactionManager
  ) {}

  async execute(input: CreateMasterOrchestratorInput): Promise<CreateMasterOrchestratorOutput> {
    // Step 0: Validate that session exists and belongs to user (authorization check)
    // NOTE: This validation is done OUTSIDE the transaction because it's an authorization
    // check and doesn't require consistency with the orchestrator creation
    const session = await db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.id, input.sessionId),
          eq(terminalSessions.userId, input.userId)
        )
      )
      .limit(1);

    if (session.length === 0) {
      throw new Error(`Session ${input.sessionId} not found or does not belong to user ${input.userId}`);
    }

    // Step 1: Create the Orchestrator domain entity
    const orchestrator = Orchestrator.createMaster({
      sessionId: input.sessionId,
      userId: input.userId,
      customInstructions: input.customInstructions,
      monitoringInterval: input.monitoringInterval ?? 30,
      stallThreshold: input.stallThreshold ?? 300,
      autoIntervention: input.autoIntervention ?? false,
    });

    // Step 2: Create audit log entry
    const auditLog = OrchestratorAuditLog.forOrchestratorCreated(
      orchestrator.id,
      orchestrator.type,
      null, // No target session for creation event
      { userId: input.userId }
    );

    // Step 3: Persist orchestrator and audit log atomically within a transaction
    // The validation happens INSIDE the transaction to prevent race conditions
    try {
      await this.transactionManager.execute(async (tx) => {
        // Validate no existing master inside the transaction for consistency
        const existingMaster = await this.orchestratorRepository.findMasterByUserId(input.userId, tx);
        if (existingMaster) {
          throw new MasterOrchestratorAlreadyExistsError(
            input.userId,
            existingMaster.id
          );
        }

        // Save orchestrator - database unique constraint will also prevent duplicates
        await this.orchestratorRepository.save(orchestrator, tx);
        await this.auditLogRepository.save(auditLog, tx);
      });
    } catch (error) {
      // Handle database unique constraint violations
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        // Race condition caught by database - another request created master first
        const existingMaster = await this.orchestratorRepository.findMasterByUserId(input.userId);
        if (existingMaster) {
          throw new MasterOrchestratorAlreadyExistsError(
            input.userId,
            existingMaster.id
          );
        }
      }
      // Re-throw other errors
      throw error;
    }

    return {
      orchestrator,
      auditLog,
    };
  }
}
