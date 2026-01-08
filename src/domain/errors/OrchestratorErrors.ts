/**
 * OrchestratorErrors - Domain-specific errors for orchestrator operations.
 *
 * These errors represent business rule violations in the orchestrator domain.
 */

import { DomainError } from "./DomainError";

/**
 * OrchestratorNotFoundError - Thrown when an orchestrator cannot be found.
 */
export class OrchestratorNotFoundError extends DomainError {
  constructor(orchestratorId: string, context?: Record<string, unknown>) {
    super(
      `Orchestrator not found: ${orchestratorId}`,
      "ORCHESTRATOR_NOT_FOUND",
      context
    );
    this.name = "OrchestratorNotFoundError";
  }
}

/**
 * InvalidScopeError - Thrown when orchestrator scope is invalid.
 */
export class InvalidScopeError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INVALID_SCOPE", context);
    this.name = "InvalidScopeError";
  }
}

/**
 * CollisionError - Thrown when multiple orchestrators try to act on the same session.
 */
export class CollisionError extends DomainError {
  constructor(
    sessionId: string,
    orchestratorIds: string[],
    context?: Record<string, unknown>
  ) {
    super(
      `Multiple orchestrators attempting to act on session ${sessionId}: ${orchestratorIds.join(", ")}`,
      "ORCHESTRATOR_COLLISION",
      { ...context, sessionId, orchestratorIds }
    );
    this.name = "CollisionError";
  }
}

/**
 * StallDetectionError - Thrown when stall detection fails.
 */
export class StallDetectionError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "STALL_DETECTION_ERROR", context);
    this.name = "StallDetectionError";
  }
}

/**
 * CommandInjectionError - Thrown when command injection fails or is rejected.
 */
export class CommandInjectionError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "COMMAND_INJECTION_ERROR", context);
    this.name = "CommandInjectionError";
  }
}

/**
 * InsightNotFoundError - Thrown when an insight cannot be found.
 */
export class InsightNotFoundError extends DomainError {
  constructor(insightId: string, context?: Record<string, unknown>) {
    super(
      `Insight not found: ${insightId}`,
      "INSIGHT_NOT_FOUND",
      context
    );
    this.name = "InsightNotFoundError";
  }
}

/**
 * AuditLogNotFoundError - Thrown when an audit log entry cannot be found.
 */
export class AuditLogNotFoundError extends DomainError {
  constructor(auditLogId: string, context?: Record<string, unknown>) {
    super(
      `Audit log entry not found: ${auditLogId}`,
      "AUDIT_LOG_NOT_FOUND",
      context
    );
    this.name = "AuditLogNotFoundError";
  }
}

/**
 * OrchestratorAlreadyExistsError - Thrown when trying to create a duplicate orchestrator.
 */
export class OrchestratorAlreadyExistsError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "ORCHESTRATOR_ALREADY_EXISTS", context);
    this.name = "OrchestratorAlreadyExistsError";
  }
}

/**
 * MasterOrchestratorAlreadyExistsError - Thrown when trying to create a second master orchestrator.
 */
export class MasterOrchestratorAlreadyExistsError extends DomainError {
  constructor(userId: string, existingId: string, context?: Record<string, unknown>) {
    super(
      `User ${userId} already has a master orchestrator: ${existingId}`,
      "MASTER_ORCHESTRATOR_ALREADY_EXISTS",
      { ...context, userId, existingId }
    );
    this.name = "MasterOrchestratorAlreadyExistsError";
  }
}

/**
 * OrchestratorPausedError - Thrown when attempting operations on a paused orchestrator.
 */
export class OrchestratorPausedError extends DomainError {
  constructor(orchestratorId: string, operation: string, context?: Record<string, unknown>) {
    super(
      `Cannot ${operation} on paused orchestrator: ${orchestratorId}`,
      "ORCHESTRATOR_PAUSED",
      { ...context, orchestratorId, operation }
    );
    this.name = "OrchestratorPausedError";
  }
}

/**
 * InvalidMonitoringConfigError - Thrown when monitoring configuration is invalid.
 */
export class InvalidMonitoringConfigError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INVALID_MONITORING_CONFIG", context);
    this.name = "InvalidMonitoringConfigError";
  }
}

/**
 * SessionNotInScopeError - Thrown when orchestrator tries to act on an out-of-scope session.
 */
export class SessionNotInScopeError extends DomainError {
  constructor(
    orchestratorId: string,
    sessionId: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Session ${sessionId} is not in scope for orchestrator ${orchestratorId}`,
      "SESSION_NOT_IN_SCOPE",
      { ...context, orchestratorId, sessionId }
    );
    this.name = "SessionNotInScopeError";
  }
}
