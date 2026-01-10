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
  projectMetadataRepository,
} from "@/infrastructure/container";
import type { Orchestrator } from "@/domain/entities/Orchestrator";
import type { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { ProjectMetadata } from "@/domain/entities/ProjectMetadata";
import {
  bootstrapMasterControl,
  bootstrapFolderControl,
} from "@/services/orchestrator-bootstrap-service";

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
      userId, // Pass userId for authorization validation
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
      userId, // Pass userId for authorization validation
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

/**
 * Ensure master orchestrator exists for a user
 * Creates one if it doesn't exist yet
 * Returns the existing or newly created orchestrator
 *
 * Uses the bootstrap service to create a real Claude Code session with:
 * - CLAUDE.md instructions for orchestration
 * - .mcp.json for MCP server access
 * - Claude Code started with --resume
 */
export async function ensureMasterOrchestrator(
  userId: string
): Promise<{
  orchestrator: Orchestrator;
  created: boolean;
  sessionId?: string;
}> {
  // Check if master orchestrator already exists
  const existing = await getMasterOrchestrator(userId);
  if (existing) {
    return { orchestrator: existing, created: false };
  }

  // Use bootstrap service to create fully-instrumented orchestrator session
  const bootstrapResult = await bootstrapMasterControl({ userId });

  // Retrieve the orchestrator entity
  const orchestrator = await getOrchestrator(bootstrapResult.orchestratorId, userId);
  if (!orchestrator) {
    throw new OrchestratorServiceError(
      "Failed to retrieve orchestrator after bootstrap",
      "BOOTSTRAP_FAILED"
    );
  }

  return {
    orchestrator,
    created: true,
    sessionId: bootstrapResult.sessionId,
  };
}

/**
 * Create or update folder sub-orchestrator with automatic session setup
 * If an orchestrator already exists for this folder, returns it
 * Otherwise creates a new dedicated session and sub-orchestrator
 *
 * Uses the bootstrap service to create a real Claude Code session with:
 * - CLAUDE.md instructions with project knowledge
 * - .mcp.json for MCP server access
 * - Claude Code started with --resume
 */
export async function ensureFolderSubOrchestrator(
  userId: string,
  folderId: string,
  config?: {
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }
): Promise<{
  orchestrator: Orchestrator;
  created: boolean;
  sessionId?: string;
}> {
  // Check if sub-orchestrator already exists for this folder
  const existing = await getSubOrchestratorForFolder(folderId, userId);
  if (existing) {
    return { orchestrator: existing, created: false };
  }

  const { sessionFolders, terminalSessions } = await import("@/db/schema");
  const { desc } = await import("drizzle-orm");

  // Validate folder ownership (IDOR protection)
  const folder = await db
    .select()
    .from(sessionFolders)
    .where(
      and(
        eq(sessionFolders.id, folderId),
        eq(sessionFolders.userId, userId)
      )
    )
    .limit(1);

  if (folder.length === 0) {
    throw new OrchestratorServiceError(
      "Folder not found or access denied",
      "FOLDER_NOT_FOUND"
    );
  }

  // Get project path from an existing session in this folder
  const existingSessions = await db
    .select({ projectPath: terminalSessions.projectPath })
    .from(terminalSessions)
    .where(
      and(
        eq(terminalSessions.folderId, folderId),
        eq(terminalSessions.userId, userId)
      )
    )
    .orderBy(desc(terminalSessions.createdAt))
    .limit(1);

  const projectPath = existingSessions[0]?.projectPath;
  if (!projectPath) {
    throw new OrchestratorServiceError(
      "No sessions with project path found in folder",
      "NO_PROJECT_PATH"
    );
  }

  // Use bootstrap service to create fully-instrumented orchestrator session
  const bootstrapResult = await bootstrapFolderControl({
    userId,
    folderId,
    projectPath,
    customInstructions: config?.customInstructions,
  });

  // Retrieve the orchestrator entity
  const orchestrator = await getOrchestrator(bootstrapResult.orchestratorId, userId);
  if (!orchestrator) {
    throw new OrchestratorServiceError(
      "Failed to retrieve orchestrator after bootstrap",
      "BOOTSTRAP_FAILED"
    );
  }

  return {
    orchestrator,
    created: true,
    sessionId: bootstrapResult.sessionId,
  };
}

/**
 * Reinitialize master orchestrator for a user
 *
 * This will:
 * 1. Stop any active monitoring
 * 2. Delete the existing master orchestrator (if any)
 * 3. Close the existing orchestrator session (if any)
 * 4. Create a new master orchestrator with a new session
 *
 * Use this when the orchestrator is in a bad state or needs to be reset.
 */
export async function reinitializeMasterOrchestrator(
  userId: string
): Promise<{
  orchestrator: Orchestrator;
  sessionId: string;
  previousOrchestrator?: { id: string; sessionId: string };
}> {
  const MonitoringService = await import("./monitoring-service");
  const SessionService = await import("./session-service");

  // Find existing master orchestrator
  const existing = await getMasterOrchestrator(userId);
  let previousOrchestrator: { id: string; sessionId: string } | undefined;

  if (existing) {
    previousOrchestrator = {
      id: existing.id,
      sessionId: existing.sessionId,
    };

    // Stop monitoring
    MonitoringService.stopMonitoring(existing.id);

    // Delete orchestrator record
    await db
      .delete(orchestratorSessions)
      .where(eq(orchestratorSessions.id, existing.id));

    // Close the orchestrator session
    try {
      await SessionService.closeSession(userId, existing.sessionId);
    } catch (error) {
      // Session might already be closed, ignore
      console.log(`[OrchestratorService] Previous session already closed: ${existing.sessionId}`);
    }

    console.log(`[OrchestratorService] Deleted previous master orchestrator: ${existing.id}`);
  }

  // Create new master orchestrator
  const result = await ensureMasterOrchestrator(userId);

  // Start monitoring for new orchestrator
  MonitoringService.startMonitoring(result.orchestrator.id, userId);

  console.log(`[OrchestratorService] Created new master orchestrator: ${result.orchestrator.id}`);

  return {
    orchestrator: result.orchestrator,
    sessionId: result.sessionId!,
    previousOrchestrator,
  };
}

/**
 * Reinitialize folder orchestrator
 *
 * This will:
 * 1. Stop any active monitoring
 * 2. Delete the existing folder orchestrator (if any)
 * 3. Close the existing orchestrator session (if any)
 * 4. Create a new folder orchestrator with a new session
 *
 * Use this when the folder orchestrator is in a bad state or needs to be reset.
 */
export async function reinitializeFolderOrchestrator(
  userId: string,
  folderId: string,
  config?: {
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }
): Promise<{
  orchestrator: Orchestrator;
  sessionId: string;
  previousOrchestrator?: { id: string; sessionId: string };
}> {
  const MonitoringService = await import("./monitoring-service");
  const SessionService = await import("./session-service");

  // Find existing folder orchestrator
  const existing = await getSubOrchestratorForFolder(folderId, userId);
  let previousOrchestrator: { id: string; sessionId: string } | undefined;

  if (existing) {
    previousOrchestrator = {
      id: existing.id,
      sessionId: existing.sessionId,
    };

    // Stop monitoring
    MonitoringService.stopMonitoring(existing.id);

    // Delete orchestrator record
    await db
      .delete(orchestratorSessions)
      .where(eq(orchestratorSessions.id, existing.id));

    // Close the orchestrator session
    try {
      await SessionService.closeSession(userId, existing.sessionId);
    } catch (error) {
      // Session might already be closed, ignore
      console.log(`[OrchestratorService] Previous session already closed: ${existing.sessionId}`);
    }

    console.log(`[OrchestratorService] Deleted previous folder orchestrator: ${existing.id}`);
  }

  // Create new folder orchestrator
  const result = await ensureFolderSubOrchestrator(userId, folderId, config);

  // Start monitoring for new orchestrator
  MonitoringService.startMonitoring(result.orchestrator.id, userId);

  console.log(`[OrchestratorService] Created new folder orchestrator: ${result.orchestrator.id}`);

  return {
    orchestrator: result.orchestrator,
    sessionId: result.sessionId!,
    previousOrchestrator,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Metadata Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get project metadata for a folder
 *
 * Returns the enriched project metadata if available, null otherwise.
 */
export async function getProjectMetadataForFolder(
  folderId: string,
  userId: string
): Promise<ProjectMetadata | null> {
  return projectMetadataRepository.findByFolderId(folderId, userId);
}

/**
 * Project context summary for orchestrator use
 */
export interface ProjectContext {
  framework: string | null;
  category: string;
  primaryLanguage: string | null;
  languages: string[];
  packageManager: string | null;
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  testFramework: string | null;
  ciProvider: string | null;
  gitBranch: string | null;
  isDirty: boolean;
  suggestedCommands: string[];
  agentInstructions: string | null;
}

/**
 * Get project context for orchestrator decision making
 *
 * Returns a summarized project context suitable for inclusion
 * in orchestrator prompts or decision logic.
 */
export async function getProjectContextForFolder(
  folderId: string,
  userId: string
): Promise<ProjectContext | null> {
  const metadata = await getProjectMetadataForFolder(folderId, userId);

  if (!metadata || !metadata.hasData()) {
    return null;
  }

  return {
    framework: metadata.framework,
    category: metadata.category,
    primaryLanguage: metadata.primaryLanguage,
    languages: metadata.languages,
    packageManager: metadata.packageManager,
    hasTypeScript: metadata.hasTypeScript,
    hasDocker: metadata.hasDocker,
    hasCI: metadata.hasCI,
    testFramework: metadata.testFramework?.framework ?? null,
    ciProvider: metadata.cicd?.provider ?? null,
    gitBranch: metadata.git?.currentBranch ?? null,
    isDirty: metadata.git?.isDirty ?? false,
    suggestedCommands: metadata.suggestedStartupCommands,
    agentInstructions: metadata.suggestedAgentInstructions,
  };
}

/**
 * Format project context as text for orchestrator prompts
 *
 * Generates human-readable context that can be included in
 * orchestrator custom instructions or system prompts.
 */
export function formatProjectContextAsText(context: ProjectContext): string {
  const lines: string[] = [];

  // Project type
  if (context.framework) {
    lines.push(`Project: ${context.framework} (${context.category})`);
  } else {
    lines.push(`Project: ${context.category}`);
  }

  // Languages
  if (context.primaryLanguage) {
    const allLanguages = context.languages.length > 1
      ? ` (also: ${context.languages.filter(l => l !== context.primaryLanguage).join(", ")})`
      : "";
    lines.push(`Primary Language: ${context.primaryLanguage}${allLanguages}`);
  }

  // Build tools
  if (context.packageManager) {
    lines.push(`Package Manager: ${context.packageManager}`);
  }

  // Features
  const features: string[] = [];
  if (context.hasTypeScript) features.push("TypeScript");
  if (context.hasDocker) features.push("Docker");
  if (context.hasCI) features.push("CI/CD");
  if (context.testFramework) features.push(`Tests (${context.testFramework})`);
  if (features.length > 0) {
    lines.push(`Features: ${features.join(", ")}`);
  }

  // Git state
  if (context.gitBranch) {
    const dirty = context.isDirty ? " (uncommitted changes)" : "";
    lines.push(`Branch: ${context.gitBranch}${dirty}`);
  }

  // Suggested commands
  if (context.suggestedCommands.length > 0) {
    lines.push(`Startup Commands: ${context.suggestedCommands.join(", ")}`);
  }

  // Agent instructions
  if (context.agentInstructions) {
    lines.push("", "Agent Instructions:", context.agentInstructions);
  }

  return lines.join("\n");
}

/**
 * Get formatted project context for a folder
 *
 * Convenience function that retrieves metadata and formats it for use
 * in orchestrator prompts. Returns null if no metadata is available.
 */
export async function getFormattedProjectContext(
  folderId: string,
  userId: string
): Promise<string | null> {
  const context = await getProjectContextForFolder(folderId, userId);
  if (!context) {
    return null;
  }
  return formatProjectContextAsText(context);
}
