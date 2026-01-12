/**
 * OrchestratorBootstrapService - Bootstrap orchestrator Claude Code sessions.
 *
 * Creates orchestrator sessions that ARE Claude Code agents with:
 * - Full project knowledge loaded
 * - MCP tools available for session control
 * - Custom orchestration instructions
 *
 * The orchestrator is event-driven: it wakes on agent events (heartbeat, stall, etc.)
 * rather than polling.
 */

import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  generateOrchestratorInstructions,
} from "@/services/orchestrator-instruction-generator";
import {
  container,
  createMasterOrchestratorUseCase,
  createSubOrchestratorUseCase,
} from "@/infrastructure/container";
import { db } from "@/db";
import { sessionFolders, terminalSessions, orchestratorSessions, userSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default directory for Master Control orchestrator.
 * This is where the Master Control session runs from.
 * Users can override this in their settings.
 */
const DEFAULT_MASTER_CONTROL_DIR = join(process.env.HOME || "/tmp", ".remote-dev", "projects");

/**
 * Escape a string for safe use in a shell command.
 *
 * Uses single quotes which prevent all shell expansion ($, `, \, etc.)
 * The only character that needs escaping in single quotes is the single quote itself,
 * which is done by ending the quote, adding an escaped quote, and starting a new quote.
 *
 * Example: "path with 'quotes'" becomes "'path with '\''quotes'\'''"
 *
 * @param str - The string to escape
 * @returns The escaped string safe for shell use
 */
function escapeShellArg(str: string): string {
  // Replace single quotes with: end quote, escaped quote, start quote
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock mechanism to prevent race conditions in orchestrator creation
// ─────────────────────────────────────────────────────────────────────────────

const creationLocks = new Map<string, Promise<BootstrapResult>>();

/**
 * Generate a lock key for orchestrator creation.
 */
function getLockKey(type: "master" | "folder", userId: string, scopeId?: string): string {
  return type === "master" ? `master:${userId}` : `folder:${userId}:${scopeId}`;
}

/**
 * Execute a bootstrap function with lock protection.
 * If another request is already creating the same orchestrator, wait for it.
 *
 * Uses a synchronous placeholder pattern to prevent TOCTOU race conditions:
 * 1. Atomically check-and-set a placeholder promise
 * 2. If we set the placeholder, we own the lock - run the factory
 * 3. If someone else has the lock, wait for their result and retry
 */
async function withCreationLock<T extends BootstrapResult>(
  lockKey: string,
  factory: () => Promise<T>
): Promise<T> {
  // Retry loop to handle race condition after waiting
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Check if there's already a creation in progress
    const existingLock = creationLocks.get(lockKey);
    if (existingLock) {
      console.log(`[Bootstrap] Waiting for existing creation: ${lockKey}`);
      await existingLock;
      // After waiting, re-check if another waiter grabbed the lock
      continue;
    }

    // Atomically set a placeholder to prevent TOCTOU race
    let resolveCreation: (value: T) => void;
    let rejectCreation: (error: unknown) => void;
    const placeholderPromise = new Promise<T>((resolve, reject) => {
      resolveCreation = resolve;
      rejectCreation = reject;
    });

    // Check again before setting - if someone beat us, retry
    if (creationLocks.has(lockKey)) {
      continue;
    }
    creationLocks.set(lockKey, placeholderPromise);

    try {
      // Now we own the lock - run the factory
      const result = await factory();
      resolveCreation!(result);
      return result;
    } catch (error) {
      rejectCreation!(error);
      throw error;
    } finally {
      // Clean up lock after completion (success or failure)
      creationLocks.delete(lockKey);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BootstrapResult {
  orchestratorId: string;
  sessionId: string;
  tmuxSessionName: string;
  claudeMdPath: string;
}

export interface BootstrapMasterInput {
  userId: string;
  customInstructions?: string;
}

export interface BootstrapFolderInput {
  userId: string;
  folderId: string;
  projectPath: string;
  customInstructions?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup Initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize orchestrators on server startup.
 *
 * This handles:
 * 1. Cleaning up stale orchestrator records (where terminal session is closed)
 * 2. Bootstrapping "pending_bootstrap" orchestrators created by rdv-server
 * 3. Waking existing orchestrators that should be running
 *
 * Note: rdv-server now creates "pending_bootstrap" orchestrators when the first
 * session is created. This function completes their bootstrap.
 */
export async function initializeOrchestrators(): Promise<void> {
  console.log("[Bootstrap] Initializing orchestrators on startup...");

  try {
    // Step 1: Clean up stale orchestrator records
    // Find orchestrators whose terminal sessions are closed/inactive
    await cleanupStaleOrchestrators();

    // Step 2: Bootstrap pending orchestrators (created by rdv-server)
    await bootstrapPendingOrchestrators();

    // Step 3: Find all users with active non-orchestrator sessions
    const usersWithSessions = await db
      .selectDistinct({ userId: terminalSessions.userId })
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.status, "active"),
          eq(terminalSessions.isOrchestratorSession, false)
        )
      );

    console.log(`[Bootstrap] Found ${usersWithSessions.length} users with active sessions`);

    for (const { userId } of usersWithSessions) {
      try {
        // Check if Master Control exists (and is fully bootstrapped)
        const existingMaster = await container.orchestratorRepository.findMasterByUserId(userId);

        if (!existingMaster) {
          console.log(`[Bootstrap] Creating Master Control for user ${userId}...`);
          const result = await bootstrapMasterControl({ userId });
          console.log(`[Bootstrap] Created Master Control: ${result.orchestratorId}`);
        } else if (existingMaster.status !== "pending_bootstrap") {
          // Wake existing Master Control if dormant (skip pending ones, they're handled above)
          console.log(`[Bootstrap] Waking existing Master Control: ${existingMaster.id}`);
          await wakeOrchestrator(existingMaster.id);
        }
      } catch (error) {
        console.error(`[Bootstrap] Failed to initialize orchestrator for user ${userId}:`, error);
        // Continue with other users
      }
    }

    console.log("[Bootstrap] Orchestrator initialization complete");
  } catch (error) {
    console.error("[Bootstrap] Failed to initialize orchestrators:", error);
    throw error;
  }
}

/**
 * Bootstrap pending orchestrators.
 *
 * rdv-server creates orchestrator records with status "pending_bootstrap"
 * when the first session is created for a user. This function completes
 * the bootstrap by creating the terminal session, CLAUDE.md, and starting Claude.
 */
async function bootstrapPendingOrchestrators(): Promise<void> {
  console.log("[Bootstrap] Checking for pending orchestrators...");

  try {
    // Find all orchestrators with status "pending_bootstrap"
    const pendingOrchestrators = await db
      .select()
      .from(orchestratorSessions)
      .where(eq(orchestratorSessions.status, "pending_bootstrap"));

    if (pendingOrchestrators.length === 0) {
      console.log("[Bootstrap] No pending orchestrators found");
      return;
    }

    console.log(`[Bootstrap] Found ${pendingOrchestrators.length} pending orchestrator(s)`);

    for (const orc of pendingOrchestrators) {
      try {
        if (orc.type === "master") {
          console.log(`[Bootstrap] Completing bootstrap for Master Control: ${orc.id.slice(0, 8)}`);
          await completeMasterControlBootstrap(orc);
        } else if (orc.type === "sub_orchestrator" && orc.scopeId) {
          console.log(`[Bootstrap] Completing bootstrap for Folder Control: ${orc.id.slice(0, 8)}`);
          await completeFolderControlBootstrap(orc);
        } else {
          console.warn(`[Bootstrap] Unknown orchestrator type: ${orc.type}`);
        }
      } catch (error) {
        console.error(`[Bootstrap] Failed to complete bootstrap for orchestrator ${orc.id}:`, error);
        // Continue with other orchestrators
      }
    }
  } catch (error) {
    console.error("[Bootstrap] Failed to check pending orchestrators:", error);
    // Don't throw - allow other initialization to continue
  }
}

/**
 * Complete bootstrap for a pending Master Control orchestrator.
 *
 * Creates terminal session, CLAUDE.md, MCP config, and starts Claude.
 */
async function completeMasterControlBootstrap(orc: typeof orchestratorSessions.$inferSelect): Promise<void> {
  const { userId } = orc;

  // Get user's Master Control directory setting
  const settings = await db
    .select({ masterControlDirectory: userSettings.masterControlDirectory })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  const workDir = settings[0]?.masterControlDirectory || DEFAULT_MASTER_CONTROL_DIR;
  const configDir = join(workDir, ".claude");

  // Ensure directory exists
  if (!existsSync(workDir)) {
    await mkdir(workDir, { recursive: true });
  }

  // Create terminal session for the orchestrator
  const session = await SessionService.createSession(userId, {
    name: "Master Control",
    projectPath: workDir,
    isOrchestratorSession: true,
    agentProvider: "claude",
    tmuxSessionName: "rdv-master-control",
  });

  // Generate and write CLAUDE.md
  const claudeMdPath = join(configDir, "CLAUDE.md");
  const instructions = generateOrchestratorInstructions({
    type: "master",
    customInstructions: orc.customInstructions ?? undefined,
    availableTools: [
      "session_list",
      "session_analyze",
      "session_send_input",
      "session_get_insights",
      "orchestrator_status",
      "project_metadata_detect",
    ],
  });

  await mkdir(configDir, { recursive: true });
  await writeFile(claudeMdPath, instructions, "utf-8");

  // Write MCP config
  const mcpConfigPath = join(configDir, ".mcp.json");
  await writeMcpConfig(mcpConfigPath);

  // Link session to orchestrator and update status
  await db
    .update(orchestratorSessions)
    .set({
      sessionId: session.id,
      status: "idle",
      updatedAt: new Date(),
    })
    .where(eq(orchestratorSessions.id, orc.id));

  // Start Claude Code
  await startClaudeInSession(session.tmuxSessionName, workDir);

  console.log(`[Bootstrap] Completed Master Control bootstrap: ${orc.id.slice(0, 8)} -> session ${session.id.slice(0, 8)}`);
}

/**
 * Complete bootstrap for a pending Folder Control orchestrator.
 *
 * Creates terminal session, CLAUDE.md, MCP config, and starts Claude.
 */
async function completeFolderControlBootstrap(orc: typeof orchestratorSessions.$inferSelect): Promise<void> {
  const { userId, scopeId } = orc;

  if (!scopeId) {
    throw new Error("Folder Control orchestrator missing scopeId (folderId)");
  }

  // Get folder info
  const folders = await db
    .select()
    .from(sessionFolders)
    .where(and(eq(sessionFolders.id, scopeId), eq(sessionFolders.userId, userId)))
    .limit(1);

  const folder = folders[0];
  if (!folder) {
    throw new Error(`Folder ${scopeId} not found`);
  }

  const projectPath = folder.path || process.env.HOME || "/tmp";
  const configDir = join(projectPath, ".claude");

  // Get project knowledge
  const projectKnowledge = await container.projectKnowledgeRepository.findByFolderId(scopeId);

  // Create terminal session
  const session = await SessionService.createSession(userId, {
    name: `${folder.name} Control`,
    projectPath,
    folderId: scopeId,
    isOrchestratorSession: true,
    agentProvider: "claude",
  });

  // Generate and write CLAUDE.md
  const claudeMdPath = join(configDir, "CLAUDE.md");
  const instructions = generateOrchestratorInstructions({
    type: "folder",
    folderName: folder.name,
    projectPath,
    projectKnowledge: projectKnowledge || undefined,
    customInstructions: orc.customInstructions ?? undefined,
    availableTools: [
      "session_list",
      "session_analyze",
      "session_send_input",
      "session_get_insights",
      "orchestrator_status",
      "project_metadata_detect",
      "session_agent_info",
    ],
  });

  await mkdir(configDir, { recursive: true });
  await writeFile(claudeMdPath, instructions, "utf-8");

  // Write MCP config
  const mcpConfigPath = join(configDir, ".mcp.json");
  await writeMcpConfig(mcpConfigPath);

  // Link session to orchestrator and update status
  await db
    .update(orchestratorSessions)
    .set({
      sessionId: session.id,
      status: "idle",
      updatedAt: new Date(),
    })
    .where(eq(orchestratorSessions.id, orc.id));

  // Start Claude Code
  await startClaudeInSession(session.tmuxSessionName, projectPath);

  console.log(`[Bootstrap] Completed Folder Control bootstrap: ${orc.id.slice(0, 8)} -> session ${session.id.slice(0, 8)}`);
}

/**
 * Clean up stale orchestrator records.
 *
 * Finds orchestrator records whose terminal sessions are closed/inactive
 * and deletes them so fresh ones can be created.
 */
async function cleanupStaleOrchestrators(): Promise<void> {
  console.log("[Bootstrap] Cleaning up stale orchestrator records...");

  try {
    // Find all orchestrators
    const allOrchestrators = await db
      .select({
        id: orchestratorSessions.id,
        sessionId: orchestratorSessions.sessionId,
        type: orchestratorSessions.type,
      })
      .from(orchestratorSessions);

    let cleanedCount = 0;

    for (const orc of allOrchestrators) {
      // Check if the terminal session exists and is active
      const sessions = await db
        .select({ status: terminalSessions.status, tmuxSessionName: terminalSessions.tmuxSessionName })
        .from(terminalSessions)
        .where(eq(terminalSessions.id, orc.sessionId))
        .limit(1);

      const session = sessions[0];

      // Delete orchestrator if:
      // 1. Terminal session doesn't exist, OR
      // 2. Terminal session is closed/suspended
      const isStale = !session || session.status === "closed" || session.status === "suspended";

      // Also check if tmux session actually exists
      let tmuxExists = false;
      if (session?.tmuxSessionName) {
        tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
      }

      if (isStale || !tmuxExists) {
        console.log(`[Bootstrap] Removing stale ${orc.type} orchestrator: ${orc.id}`);
        await db.delete(orchestratorSessions).where(eq(orchestratorSessions.id, orc.id));
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Bootstrap] Cleaned up ${cleanedCount} stale orchestrator records`);
    } else {
      console.log("[Bootstrap] No stale orchestrator records found");
    }
  } catch (error) {
    console.error("[Bootstrap] Failed to cleanup stale orchestrators:", error);
    // Don't throw - allow initialization to continue
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Spin Feature Flag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if auto-spin is enabled for a folder.
 *
 * Auto-spin creates a Folder Control orchestrator when the first session
 * is created in a folder.
 */
export async function isAutoSpinEnabled(folderId: string, userId: string): Promise<boolean> {
  // Check folder preferences for orchestrator settings
  const folders = await db
    .select()
    .from(sessionFolders)
    .where(and(eq(sessionFolders.id, folderId), eq(sessionFolders.userId, userId)))
    .limit(1);

  const folder = folders[0];
  if (!folder) return false;

  // For now, auto-spin is enabled by default for all folders
  // TODO: Add per-folder preference to disable
  return true;
}

/**
 * Auto-spin Folder Control on first session creation.
 *
 * Call this after creating a session in a folder. It will create a Folder Control
 * orchestrator if one doesn't exist and auto-spin is enabled.
 *
 * This is a fire-and-forget operation - it doesn't block session creation.
 */
export async function autoSpinFolderControl(params: {
  userId: string;
  folderId: string;
  projectPath: string;
}): Promise<void> {
  const { userId, folderId, projectPath } = params;

  try {
    // Check if auto-spin is enabled
    const enabled = await isAutoSpinEnabled(folderId, userId);
    if (!enabled) {
      console.log(`[AutoSpin] Disabled for folder ${folderId}`);
      return;
    }

    // Check if folder control already exists
    const existingControls = await container.orchestratorRepository.findByScope(
      userId,
      folderId
    );
    if (existingControls.length > 0) {
      console.log(`[AutoSpin] Folder Control already exists: ${existingControls[0].id}`);
      return;
    }

    // Create folder control
    const result = await bootstrapFolderControl({
      userId,
      folderId,
      projectPath,
    });

    console.log(`[AutoSpin] Created Folder Control: ${result.orchestratorId}`);
  } catch (error) {
    // Don't fail session creation if auto-spin fails
    console.error(`[AutoSpin] Failed to create Folder Control:`, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bootstrap Master Control orchestrator.
 *
 * Creates a Claude Code session that monitors ALL sessions across folders.
 * Uses lock to prevent race conditions when multiple requests try to create
 * the same orchestrator simultaneously.
 */
export async function bootstrapMasterControl(
  input: BootstrapMasterInput
): Promise<BootstrapResult> {
  const { userId, customInstructions } = input;
  const lockKey = getLockKey("master", userId);

  return withCreationLock(lockKey, async () => {
    // Check if master already exists (inside lock to prevent race)
    const existingMaster = await container.orchestratorRepository.findMasterByUserId(userId);
    if (existingMaster) {
      // Return existing master info
      const session = await SessionService.getSession(existingMaster.sessionId, userId);
      return {
        orchestratorId: existingMaster.id,
        sessionId: existingMaster.sessionId,
        tmuxSessionName: session?.tmuxSessionName || "",
        claudeMdPath: "", // Would need to be stored
      };
    }

  // Step 1: Get user's Master Control directory setting
  const settings = await db
    .select({ masterControlDirectory: userSettings.masterControlDirectory })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  // Use user's setting or fall back to default (~/.remote-dev/projects)
  const workDir = settings[0]?.masterControlDirectory || DEFAULT_MASTER_CONTROL_DIR;
  const configDir = join(workDir, ".claude");

  // Ensure the directory exists
  if (!existsSync(workDir)) {
    await mkdir(workDir, { recursive: true });
  }

  // Step 2: Create the terminal session (runs in configured directory)
  // Use predictable name rdv-master-control so rdv CLI can detect it
  const session = await SessionService.createSession(userId, {
    name: "Master Control",
    projectPath: workDir,
    isOrchestratorSession: true,
    agentProvider: "claude",
    tmuxSessionName: "rdv-master-control",
  });

  // Step 3: Generate CLAUDE.md for the orchestrator
  const claudeMdPath = join(configDir, "CLAUDE.md");
  const instructions = generateOrchestratorInstructions({
    type: "master",
    customInstructions,
    availableTools: [
      "session_list",
      "session_analyze",
      "session_send_input",
      "session_get_insights",
      "orchestrator_status",
      "project_metadata_detect",
    ],
  });

  // Step 4: Write CLAUDE.md to disk
  await mkdir(configDir, { recursive: true });
  await writeFile(claudeMdPath, instructions, "utf-8");

  // Step 4b: Write .mcp.json for MCP server access (in config dir)
  const mcpConfigPath = join(configDir, ".mcp.json");
  await writeMcpConfig(mcpConfigPath);

  // Step 5: Create orchestrator record
  const { orchestrator } = await createMasterOrchestratorUseCase.execute({
    userId,
    sessionId: session.id,
    customInstructions,
    monitoringInterval: 30,
    stallThreshold: 300,
    autoIntervention: false,
  });

  // Step 6: Start Claude Code in the session (in home directory)
  await startClaudeInSession(session.tmuxSessionName, workDir);

  console.log(`[Bootstrap] Created Master Control orchestrator: ${orchestrator.id}`);

  return {
    orchestratorId: orchestrator.id,
    sessionId: session.id,
    tmuxSessionName: session.tmuxSessionName,
    claudeMdPath,
  };
  }); // End withCreationLock
}

/**
 * Bootstrap Folder Control orchestrator.
 *
 * Creates a Claude Code session that monitors sessions within a specific folder.
 * Loads folder-specific project knowledge.
 * Uses lock to prevent race conditions when multiple requests try to create
 * the same orchestrator simultaneously.
 */
export async function bootstrapFolderControl(
  input: BootstrapFolderInput
): Promise<BootstrapResult> {
  const { userId, folderId, projectPath, customInstructions } = input;
  const lockKey = getLockKey("folder", userId, folderId);

  return withCreationLock(lockKey, async () => {
    // Check if folder control already exists (inside lock to prevent race)
    const existingControls = await container.orchestratorRepository.findByScope(
      userId,
      folderId
    );
    if (existingControls.length > 0) {
      const existingControl = existingControls[0];
      const session = await SessionService.getSession(existingControl.sessionId, userId);
      return {
        orchestratorId: existingControl.id,
        sessionId: existingControl.sessionId,
        tmuxSessionName: session?.tmuxSessionName || "",
        claudeMdPath: "",
      };
    }

  // Step 1: Get folder info
  const folders = await db
    .select()
    .from(sessionFolders)
    .where(and(eq(sessionFolders.id, folderId), eq(sessionFolders.userId, userId)))
    .limit(1);

  const folder = folders[0];
  if (!folder) {
    throw new Error(`Folder ${folderId} not found`);
  }

  // Step 2: Get project knowledge for this folder
  const projectKnowledge = await container.projectKnowledgeRepository.findByFolderId(folderId);

  // Step 3: Config directory for orchestrator files (CLAUDE.md, .mcp.json)
  // Session runs in projectPath, config goes in .claude/ subdirectory
  const configDir = join(projectPath, ".claude");

  // Step 4: Create the terminal session (runs in actual project directory)
  const session = await SessionService.createSession(userId, {
    name: `${folder.name} Control`,
    projectPath: projectPath,  // Run in actual project, not subdirectory
    folderId,
    isOrchestratorSession: true,
    agentProvider: "claude",
  });

  // Step 5: Generate CLAUDE.md with project knowledge
  const claudeMdPath = join(configDir, "CLAUDE.md");
  const instructions = generateOrchestratorInstructions({
    type: "folder",
    folderName: folder.name,
    projectPath,
    projectKnowledge: projectKnowledge || undefined,
    customInstructions,
    availableTools: [
      "session_list",
      "session_analyze",
      "session_send_input",
      "session_get_insights",
      "orchestrator_status",
      "project_metadata_detect",
      "session_agent_info",
    ],
  });

  // Step 6: Write CLAUDE.md to disk
  await mkdir(configDir, { recursive: true });
  await writeFile(claudeMdPath, instructions, "utf-8");

  // Step 6b: Write .mcp.json for MCP server access (in .claude/ config dir)
  const mcpConfigPath = join(configDir, ".mcp.json");
  await writeMcpConfig(mcpConfigPath);

  // Step 7: Create orchestrator record
  const { orchestrator } = await createSubOrchestratorUseCase.execute({
    userId,
    sessionId: session.id,
    folderId,
    customInstructions,
    monitoringInterval: 30,
    stallThreshold: 300,
    autoIntervention: false,
  });

  // Step 8: Start Claude Code in the session (in actual project directory)
  await startClaudeInSession(session.tmuxSessionName, projectPath);

  console.log(`[Bootstrap] Created Folder Control orchestrator: ${orchestrator.id} for folder ${folder.name}`);

  return {
    orchestratorId: orchestrator.id,
    sessionId: session.id,
    tmuxSessionName: session.tmuxSessionName,
    claudeMdPath,
  };
  }); // End withCreationLock
}

/**
 * Wake a dormant orchestrator.
 *
 * Checks if Claude Code is running in the session, and starts it if not.
 */
export async function wakeOrchestrator(orchestratorId: string): Promise<boolean> {
  // Get orchestrator
  const orchestrators = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.id, orchestratorId))
    .limit(1);

  const orc = orchestrators[0];
  if (!orc) {
    console.warn(`[Bootstrap] Orchestrator ${orchestratorId} not found`);
    return false;
  }

  // Get session
  const sessions = await db
    .select()
    .from(terminalSessions)
    .where(eq(terminalSessions.id, orc.sessionId))
    .limit(1);

  const session = sessions[0];
  if (!session || !session.tmuxSessionName) {
    console.warn(`[Bootstrap] Session for orchestrator ${orchestratorId} not found`);
    return false;
  }

  // Check if tmux session exists
  const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
  if (!tmuxExists) {
    console.warn(`[Bootstrap] Tmux session ${session.tmuxSessionName} no longer exists`);
    return false;
  }

  // Check if Claude Code is running by looking at scrollback
  const scrollback = await TmuxService.captureOutput(session.tmuxSessionName, 20);

  // Look for signs Claude Code is running
  const isClaudeRunning =
    scrollback.includes("claude") ||
    scrollback.includes("Claude") ||
    scrollback.includes("❯") ||
    scrollback.includes("Thinking");

  if (!isClaudeRunning) {
    // Start Claude Code
    const workDir = session.projectPath || process.env.HOME || "/tmp";
    await startClaudeInSession(session.tmuxSessionName, workDir);
    console.log(`[Bootstrap] Woke orchestrator ${orchestratorId}`);
  }

  // Update last activity
  await db
    .update(orchestratorSessions)
    .set({
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orchestratorSessions.id, orchestratorId));

  return true;
}

/**
 * Inject an event notification into an orchestrator session.
 *
 * This is how we communicate with the orchestrator Claude Code agent.
 */
export async function notifyOrchestrator(
  orchestratorId: string,
  event: {
    type: string;
    sessionId?: string;
    sessionName?: string;
    agent?: string;
    context?: Record<string, unknown>;
  }
): Promise<void> {
  // First wake the orchestrator if dormant
  await wakeOrchestrator(orchestratorId);

  // Get orchestrator session
  const orchestrators = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.id, orchestratorId))
    .limit(1);

  const orc = orchestrators[0];
  if (!orc) return;

  const sessions = await db
    .select()
    .from(terminalSessions)
    .where(eq(terminalSessions.id, orc.sessionId))
    .limit(1);

  const session = sessions[0];
  if (!session?.tmuxSessionName) return;

  // Format event as a message to Claude
  const eventMessage = formatEventMessage(event);

  // Send the event to the orchestrator
  // We use a special format that Claude Code will recognize as an event
  await TmuxService.sendKeys(
    session.tmuxSessionName,
    eventMessage,
    true // Press enter to submit
  );

  console.log(`[Bootstrap] Notified orchestrator ${orchestratorId} of event: ${event.type}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start Claude Code in a tmux session.
 */
async function startClaudeInSession(
  tmuxSessionName: string,
  workDir: string
): Promise<void> {
  // First cd to the working directory (use escapeShellArg for safety)
  await TmuxService.sendKeys(tmuxSessionName, `cd ${escapeShellArg(workDir)}`, true);

  // Wait a moment for cd to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Start Claude Code with --resume to continue from previous context
  await TmuxService.sendKeys(tmuxSessionName, "claude --resume", true);
}

/**
 * Format an event as a message for the orchestrator.
 */
function formatEventMessage(event: {
  type: string;
  sessionId?: string;
  sessionName?: string;
  agent?: string;
  context?: Record<string, unknown>;
}): string {
  const parts = [`[EVENT: ${event.type}]`];

  if (event.sessionName) {
    parts.push(`Session: ${event.sessionName}`);
  }
  if (event.agent) {
    parts.push(`Agent: ${event.agent}`);
  }
  if (event.context) {
    parts.push(`Context: ${JSON.stringify(event.context)}`);
  }

  return parts.join(" | ");
}

/**
 * Write .mcp.json configuration for orchestrator MCP access.
 *
 * Uses stdio transport which bypasses Cloudflare auth.
 * Prefers Unix socket if it exists, otherwise falls back to HTTP.
 */
async function writeMcpConfig(configPath: string): Promise<void> {
  // Check for Unix socket (production mode)
  const socketPath = process.env.RDV_SOCKET_PATH || "/tmp/rdv/next.sock";
  const useSocket = existsSync(socketPath);

  // Path to the MCP server script
  // Use RDV_PROJECT_ROOT env var or fall back to cwd (more reliable than __dirname in Next.js)
  const projectRoot = process.env.RDV_PROJECT_ROOT || process.cwd();
  const mcpServerPath = join(projectRoot, "scripts", "mcp-server.mjs");

  const config = {
    mcpServers: {
      "remote-dev": {
        command: "node",
        args: [mcpServerPath],
        env: useSocket
          ? {
              SOCKET_PATH: socketPath,
            }
          : {
              REMOTE_DEV_URL: process.env.NEXTAUTH_URL || "http://localhost:6001",
            },
      },
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}
