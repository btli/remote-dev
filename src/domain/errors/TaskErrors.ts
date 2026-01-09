/**
 * Task-specific domain errors for the orchestrator-first architecture.
 */

import { DomainError } from "./DomainError";

/**
 * Thrown when task parsing fails.
 */
export class TaskParsingError extends DomainError {
  constructor(input: string, reason: string) {
    super(
      `Failed to parse task from input: "${input.substring(0, 100)}${input.length > 100 ? "..." : ""}". Reason: ${reason}`,
      "TASK_PARSING_ERROR"
    );
  }
}

/**
 * Thrown when task execution fails.
 */
export class TaskExecutionError extends DomainError {
  constructor(taskId: string, reason: string, recoverable = false) {
    super(`Task ${taskId} execution failed: ${reason}`, "TASK_EXECUTION_ERROR");
    this.recoverable = recoverable;
  }

  readonly recoverable: boolean;
}

/**
 * Thrown when no suitable agent is found for a task.
 */
export class NoSuitableAgentError extends DomainError {
  constructor(taskType: string, reason: string) {
    super(
      `No suitable agent found for task type "${taskType}": ${reason}`,
      "NO_SUITABLE_AGENT_ERROR"
    );
  }
}

/**
 * Thrown when delegation fails.
 */
export class DelegationError extends DomainError {
  constructor(taskId: string, sessionId: string, reason: string) {
    super(
      `Delegation failed for task ${taskId} to session ${sessionId}: ${reason}`,
      "DELEGATION_ERROR"
    );
  }
}

/**
 * Thrown when context injection fails.
 */
export class ContextInjectionError extends DomainError {
  constructor(sessionId: string, reason: string) {
    super(`Failed to inject context into session ${sessionId}: ${reason}`, "CONTEXT_INJECTION_ERROR");
  }
}

/**
 * Thrown when transcript analysis fails.
 */
export class TranscriptAnalysisError extends DomainError {
  constructor(sessionId: string, reason: string) {
    super(`Failed to analyze transcript for session ${sessionId}: ${reason}`, "TRANSCRIPT_ANALYSIS_ERROR");
  }
}

/**
 * Thrown when skill verification fails.
 */
export class SkillVerificationError extends DomainError {
  constructor(skillId: string, reason: string) {
    super(`Skill ${skillId} verification failed: ${reason}`, "SKILL_VERIFICATION_ERROR");
  }
}

/**
 * Thrown when tool generation fails.
 */
export class ToolGenerationError extends DomainError {
  constructor(toolName: string, reason: string) {
    super(`Failed to generate tool "${toolName}": ${reason}`, "TOOL_GENERATION_ERROR");
  }
}

/**
 * Thrown when beads operation fails.
 */
export class BeadsOperationError extends DomainError {
  constructor(operation: string, reason: string) {
    super(`Beads operation "${operation}" failed: ${reason}`, "BEADS_OPERATION_ERROR");
  }
}

/**
 * Thrown when project knowledge update fails.
 */
export class KnowledgeUpdateError extends DomainError {
  constructor(folderId: string, reason: string) {
    super(`Failed to update project knowledge for folder ${folderId}: ${reason}`, "KNOWLEDGE_UPDATE_ERROR");
  }
}
