/**
 * OrchestratorService - Manages orchestrator lifecycle and operations
 *
 * This service provides high-level operations for creating, managing, and
 * controlling orchestrator agents. It wraps the use cases and provides
 * additional coordination logic.
 */
import { db } from "@/db";
import { orchestratorSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  createMasterOrchestratorUseCase,
  createSubOrchestratorUseCase,
  pauseOrchestratorUseCase,
  resumeOrchestratorUseCase,
} from "@/infrastructure/container";
import type { Orchestrator } from "@/domain/entities/Orchestrator";
import type { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";

/**
 * Error class for orchestrator service operations
 */
export class OrchestratorServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly orchestratorId?: string
  ) {
    super(message);
    this.name = "OrchestratorServiceError";
  }
}

/**
 * Input for creating a master orchestrator
 */
export interface CreateMasterOrchestratorInput {
  userId: string;
  sessionId: string;
  customInstructions?: string;
  monitoringInterval?: number;
  stallThreshold?: number;
  autoIntervention?: boolean;
}

/**
 * Input for creating a sub-orchestrator
 */
export interface CreateSubOrchestratorInput {
  userId: string;
  sessionId: string;
  folderId: string;
  customInstructions?: string;
  monitoringInterval?: number;
  stallThreshold?: number;
  autoIntervention?: boolean;
}

/**
 * Orchestrator with audit log from creation
 */
export interface OrchestratorWithAuditLog {
  orchestrator: Orchestrator;
  auditLog: OrchestratorAuditLog;
}

/**
 * Create a master orchestrator for monitoring all sessions
 */
export async function createMasterOrchestrator(
  input: CreateMasterOrchestratorInput
): Promise<OrchestratorWithAuditLog> {
  try {
    const result = await createMasterOrchestratorUseCase.execute({
      userId: input.userId,
      sessionId: input.sessionId,
      customInstructions: input.customInstructions,
      monitoringInterval: input.monitoringInterval,
      stallThreshold: input.stallThreshold,
      autoIntervention: input.autoIntervention,
    });

    return {
      orchestrator: result.orchestrator,
      auditLog: result.auditLog,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : "UNKNOWN_ERROR";

    throw new OrchestratorServiceError(message, code);
  }
}

/**
 * Create a sub-orchestrator for monitoring a specific folder
 */
export async function createSubOrchestrator(
  input: CreateSubOrchestratorInput
): Promise<OrchestratorWithAuditLog> {
  try {
    const result = await createSubOrchestratorUseCase.execute({
      userId: input.userId,
      sessionId: input.sessionId,
      folderId: input.folderId,
      customInstructions: input.customInstructions,
      monitoringInterval: input.monitoringInterval,
      stallThreshold: input.stallThreshold,
      autoIntervention: input.autoIntervention,
    });

    return {
      orchestrator: result.orchestrator,
      auditLog: result.auditLog,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : "UNKNOWN_ERROR";

    throw new OrchestratorServiceError(message, code, input.sessionId);
  }
}

/**
 * Get orchestrator by ID
 */
export async function getOrchestrator(
  orchestratorId: string,
  userId: string
): Promise<Orchestrator | null> {
  const result = await db
    .select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  // Reconstitute domain entity
  const { Orchestrator } = await import("@/domain/entities/Orchestrator");
  return Orchestrator.reconstitute({
    id: result[0].id,
    sessionId: result[0].sessionId,
    userId: result[0].userId,
    type: result[0].type as "master" | "sub_orchestrator",
    status: result[0].status as "idle" | "analyzing" | "acting" | "paused",
    scopeType: result[0].scopeType as "folder" | null,
    scopeId: result[0].scopeId,
    customInstructions: result[0].customInstructions,
    monitoringInterval: result[0].monitoringInterval,
    stallThreshold: result[0].stallThreshold,
    autoIntervention: result[0].autoIntervention,
    lastActivityAt: result[0].lastActivityAt,
    createdAt: result[0].createdAt,
    updatedAt: result[0].updatedAt,
  });
}

/**
 * List all orchestrators for a user
 */
export async function listOrchestrators(userId: string): Promise<Orchestrator[]> {
  const results = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.userId, userId));

  // Reconstitute domain entities
  const { Orchestrator } = await import("@/domain/entities/Orchestrator");
  return results.map((row) =>
    Orchestrator.reconstitute({
      id: row.id,
      sessionId: row.sessionId,
      userId: row.userId,
      type: row.type as "master" | "sub_orchestrator",
      status: row.status as "idle" | "analyzing" | "acting" | "paused",
      scopeType: row.scopeType as "folder" | null,
      scopeId: row.scopeId,
      customInstructions: row.customInstructions,
      monitoringInterval: row.monitoringInterval,
      stallThreshold: row.stallThreshold,
      autoIntervention: row.autoIntervention,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  );
}

/**
 * Get master orchestrator for a user (if it exists)
 */
export async function getMasterOrchestrator(
  userId: string
): Promise<Orchestrator | null> {
  const result = await db
    .select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.userId, userId),
        eq(orchestratorSessions.type, "master")
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  // Reconstitute domain entity
  const { Orchestrator } = await import("@/domain/entities/Orchestrator");
  return Orchestrator.reconstitute({
    id: result[0].id,
    sessionId: result[0].sessionId,
    userId: result[0].userId,
    type: result[0].type as "master" | "sub_orchestrator",
    status: result[0].status as "idle" | "analyzing" | "acting" | "paused",
    scopeType: result[0].scopeType as "folder" | null,
    scopeId: result[0].scopeId,
    customInstructions: result[0].customInstructions,
    monitoringInterval: result[0].monitoringInterval,
    stallThreshold: result[0].stallThreshold,
    autoIntervention: result[0].autoIntervention,
    lastActivityAt: result[0].lastActivityAt,
    createdAt: result[0].createdAt,
    updatedAt: result[0].updatedAt,
  });
}

/**
 * Get sub-orchestrator for a folder (if it exists)
 */
export async function getSubOrchestratorForFolder(
  folderId: string,
  userId: string
): Promise<Orchestrator | null> {
  const result = await db
    .select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.userId, userId),
        eq(orchestratorSessions.type, "sub_orchestrator"),
        eq(orchestratorSessions.scopeType, "folder"),
        eq(orchestratorSessions.scopeId, folderId)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  // Reconstitute domain entity
  const { Orchestrator } = await import("@/domain/entities/Orchestrator");
  return Orchestrator.reconstitute({
    id: result[0].id,
    sessionId: result[0].sessionId,
    userId: result[0].userId,
    type: result[0].type as "master" | "sub_orchestrator",
    status: result[0].status as "idle" | "analyzing" | "acting" | "paused",
    scopeType: result[0].scopeType as "folder" | null,
    scopeId: result[0].scopeId,
    customInstructions: result[0].customInstructions,
    monitoringInterval: result[0].monitoringInterval,
    stallThreshold: result[0].stallThreshold,
    autoIntervention: result[0].autoIntervention,
    lastActivityAt: result[0].lastActivityAt,
    createdAt: result[0].createdAt,
    updatedAt: result[0].updatedAt,
  });
}

/**
 * Pause an orchestrator
 */
export async function pauseOrchestrator(
  orchestratorId: string,
  userId: string
): Promise<OrchestratorWithAuditLog> {
  try {
    const result = await pauseOrchestratorUseCase.execute({
      orchestratorId,
    });

    return {
      orchestrator: result.orchestrator,
      auditLog: result.auditLog,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : "UNKNOWN_ERROR";

    throw new OrchestratorServiceError(message, code, orchestratorId);
  }
}

/**
 * Resume a paused orchestrator
 */
export async function resumeOrchestrator(
  orchestratorId: string,
  userId: string
): Promise<OrchestratorWithAuditLog> {
  try {
    const result = await resumeOrchestratorUseCase.execute({
      orchestratorId,
    });

    return {
      orchestrator: result.orchestrator,
      auditLog: result.auditLog,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : "UNKNOWN_ERROR";

    throw new OrchestratorServiceError(message, code, orchestratorId);
  }
}

/**
 * Delete an orchestrator
 */
export async function deleteOrchestrator(
  orchestratorId: string,
  userId: string
): Promise<boolean> {
  // Verify ownership before deletion
  const orchestrator = await getOrchestrator(orchestratorId, userId);
  if (!orchestrator) {
    throw new OrchestratorServiceError(
      "Orchestrator not found",
      "ORCHESTRATOR_NOT_FOUND",
      orchestratorId
    );
  }

  const result = await db
    .delete(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    )
    .returning({ id: orchestratorSessions.id });

  return result.length > 0;
}

/**
 * Update orchestrator configuration
 */
export async function updateOrchestrator(
  orchestratorId: string,
  userId: string,
  updates: {
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }
): Promise<Orchestrator> {
  // Verify ownership
  const orchestrator = await getOrchestrator(orchestratorId, userId);
  if (!orchestrator) {
    throw new OrchestratorServiceError(
      "Orchestrator not found",
      "ORCHESTRATOR_NOT_FOUND",
      orchestratorId
    );
  }

  // Update in database
  await db
    .update(orchestratorSessions)
    .set({
      customInstructions: updates.customInstructions,
      monitoringInterval: updates.monitoringInterval,
      stallThreshold: updates.stallThreshold,
      autoIntervention: updates.autoIntervention,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    );

  // Return updated orchestrator
  const updated = await getOrchestrator(orchestratorId, userId);
  if (!updated) {
    throw new OrchestratorServiceError(
      "Failed to retrieve updated orchestrator",
      "UPDATE_FAILED",
      orchestratorId
    );
  }

  return updated;
}
