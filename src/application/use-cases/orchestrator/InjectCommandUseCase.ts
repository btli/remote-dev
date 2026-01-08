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
 * 5. Creates an audit log entry
 */

import type { Orchestrator } from "@/domain/entities/Orchestrator";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import type { ICommandInjector } from "@/application/ports/ICommandInjector";
import type { CommandInjectionResult } from "@/types/orchestrator";
import {
  OrchestratorNotFoundError,
  OrchestratorPausedError,
  SessionNotInScopeError,
  InvalidCommandError,
} from "@/domain/errors/OrchestratorErrors";

export interface InjectCommandInput {
  orchestratorId: string;
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
    private readonly commandInjector: ICommandInjector
  ) {}

  async execute(input: InjectCommandInput): Promise<InjectCommandOutput> {
    // Step 1: Get the orchestrator and validate
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
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

    // Step 4: Inject the command
    const result = await this.commandInjector.injectCommand(
      input.targetTmuxSessionName,
      input.command,
      input.pressEnter ?? true
    );

    // Step 5: Create audit log entry
    const auditLog = OrchestratorAuditLog.forCommandInjected(
      input.orchestratorId,
      input.targetSessionId,
      input.command,
      input.reason
    );
    await this.auditLogRepository.save(auditLog);

    // Step 6: Update orchestrator status to "acting" if successful
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
