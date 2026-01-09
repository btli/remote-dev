/**
 * InjectCommandUseCase - Inject a command into a target session.
 *
 * This use case allows an orchestrator to send commands to monitored sessions.
 * It implements safety checks and audit logging for all command injections.
 *
 * This use case:
 * 1. Validates that the orchestrator exists and is not paused
 * 2. Validates that the orchestrator is in scope for the target session
 * 3. Validates the command for dangerous patterns
 * 4. Injects the command via the ICommandInjector gateway
 * 5. Creates an audit log entry (within a transaction)
 * 6. Updates orchestrator status (within the same transaction)
 *
 * Note: Steps 5-6 are wrapped in a transaction to ensure atomicity.
 */

import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import type { ICommandInjector } from "@/application/ports/ICommandInjector";
import type { CommandInjectionResult } from "@/types/orchestrator";
import { TransactionManager } from "@/infrastructure/persistence/TransactionManager";
import {
  OrchestratorNotFoundError,
  OrchestratorPausedError,
  SessionNotInScopeError,
  InvalidCommandError,
} from "@/domain/errors/OrchestratorErrors";

export interface InjectCommandInput {
  orchestratorId: string;
  userId: string; // For authorization validation
  targetSessionId: string;
  targetTmuxSessionName: string;
  targetSessionFolderId: string | null; // For scope validation
  command: string;
  pressEnter?: boolean; // Whether to automatically press Enter after injecting
  reason?: string; // Human-readable reason for injection (for audit log)
}

export interface InjectCommandOutput {
  result: CommandInjectionResult;
  auditLog: OrchestratorAuditLog;
}

export class InjectCommandUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly commandInjector: ICommandInjector,
    private readonly transactionManager: TransactionManager
  ) {}

  async execute(input: InjectCommandInput): Promise<InjectCommandOutput> {
    // Step 1: Get the orchestrator and validate ownership (IDOR protection)
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
    }

    // Authorization check: verify orchestrator belongs to requesting user
    if (orchestrator.userId !== input.userId) {
      throw new OrchestratorNotFoundError(input.orchestratorId); // Don't reveal existence
    }

    if (orchestrator.isPaused()) {
      throw new OrchestratorPausedError(input.orchestratorId);
    }

    // Step 2: Validate that the orchestrator is in scope for the target session
    if (!orchestrator.isInScope(input.targetSessionFolderId)) {
      throw new SessionNotInScopeError(
        input.orchestratorId,
        input.targetSessionId
      );
    }

    // Step 3: Validate the command
    const validation = await this.commandInjector.validateCommand(input.command);
    if (!validation.valid) {
      throw new InvalidCommandError(
        input.command,
        validation.reason ?? "Unknown validation error"
      );
    }

    // Step 4: Create audit log entry BEFORE command injection
    // This ensures we have a record even if the injection succeeds but subsequent operations fail
    const auditLog = OrchestratorAuditLog.forCommandInjected(
      input.orchestratorId,
      input.targetSessionId,
      input.command,
      input.reason
    );

    // Step 5: Persist audit log in a transaction BEFORE the irreversible command injection
    await this.transactionManager.execute(async (tx) => {
      await this.auditLogRepository.save(auditLog, tx);
    });

    // Step 6: Inject the command (IRREVERSIBLE EXTERNAL SIDE EFFECT)
    // We do this AFTER saving the audit log to ensure we have a record
    // Note: If this fails, the audit log already exists, which is acceptable
    // since it documents the intent to inject the command
    const result = await this.commandInjector.injectCommand(
      input.targetTmuxSessionName,
      input.command,
      input.pressEnter ?? true
    );

    // Step 7: Update orchestrator status if successful
    // This happens in a separate transaction after the command injection
    if (result.success && orchestrator.isIdle()) {
      const actingOrchestrator = orchestrator.startActing();
      await this.orchestratorRepository.update(actingOrchestrator);
    }

    return {
      result,
      auditLog,
    };
  }
}
