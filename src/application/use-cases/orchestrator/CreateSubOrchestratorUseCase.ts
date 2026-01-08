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
 * 4. Persists to the database via repository (within a transaction)
 * 5. Creates an audit log entry (within the same transaction)
 *
 * Note: Steps 4-5 are wrapped in a transaction to ensure atomicity.
 */

import { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import { SubOrchestratorAlreadyExistsError } from "@/domain/errors/OrchestratorErrors";
import { TransactionManager } from "@/infrastructure/persistence/TransactionManager";
import { db } from "@/db";
import { terminalSessions, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly transactionManager: TransactionManager
  ) {}

  async execute(input: CreateSubOrchestratorInput): Promise<CreateSubOrchestratorOutput> {
    // Step 0a: Validate that session exists and belongs to user (authorization check)
    // NOTE: These validations are done OUTSIDE the transaction because they're authorization
    // checks and don't require consistency with the orchestrator creation
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

    // Step 0b: Validate that folder exists and belongs to user (authorization check)
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, input.folderId),
          eq(sessionFolders.userId, input.userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      throw new Error(`Folder ${input.folderId} not found or does not belong to user ${input.userId}`);
    }

    // Step 1: Create the Orchestrator domain entity with folder scope
    const orchestrator = Orchestrator.createSubOrchestrator({
      sessionId: input.sessionId,
      userId: input.userId,
      scopeId: input.folderId,
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
      { userId: input.userId, folderId: input.folderId }
    );

    // Step 3: Persist orchestrator and audit log atomically within a transaction
    // The validation happens INSIDE the transaction to prevent race conditions
    try {
      await this.transactionManager.execute(async (tx) => {
        // Validate no existing sub-orchestrator for this folder inside the transaction
        const existingSubOrchestrators = await this.orchestratorRepository.findByScope(
          input.userId,
          input.folderId,
          tx
        );

        if (existingSubOrchestrators.length > 0) {
          const existing = existingSubOrchestrators[0];
          throw new SubOrchestratorAlreadyExistsError(
            input.folderId,
            existing.id
          );
        }

        // Save orchestrator - database unique constraint will also prevent duplicates
        await this.orchestratorRepository.save(orchestrator, tx);
        await this.auditLogRepository.save(auditLog, tx);
      });
    } catch (error) {
      // Handle database unique constraint violations
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        // Race condition caught by database - another request created sub-orchestrator first
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
