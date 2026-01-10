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
 */
export async function bootstrapMasterControl(
  input: BootstrapMasterInput
): Promise<BootstrapResult> {
  const { userId, customInstructions } = input;

  // Check if master already exists
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
  const session = await SessionService.createSession(userId, {
    name: "Master Control",
    projectPath: workDir,
    isOrchestratorSession: true,
    agentProvider: "claude",
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
}

/**
 * Bootstrap Folder Control orchestrator.
 *
 * Creates a Claude Code session that monitors sessions within a specific folder.
 * Loads folder-specific project knowledge.
 */
export async function bootstrapFolderControl(
  input: BootstrapFolderInput
): Promise<BootstrapResult> {
  const { userId, folderId, projectPath, customInstructions } = input;

  // Check if folder control already exists
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
  // First cd to the working directory
  await TmuxService.sendKeys(tmuxSessionName, `cd "${workDir}"`, true);

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
 * In production, uses Unix socket; in dev, uses HTTP.
 */
async function writeMcpConfig(configPath: string): Promise<void> {
  // Detect production mode via socket path
  const socketPath = process.env.RDV_SOCKET_PATH || "/tmp/rdv/next.sock";
  const isProduction = process.env.NODE_ENV === "production";

  // Path to the MCP server script (relative to project root)
  const projectRoot = join(__dirname, "..", "..");
  const mcpServerPath = join(projectRoot, "scripts", "mcp-server.mjs");

  const config = {
    mcpServers: {
      "remote-dev": {
        command: "node",
        args: [mcpServerPath],
        env: isProduction
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
