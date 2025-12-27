/**
 * DevServerService - Manages development server sessions with browser preview
 *
 * This service handles the lifecycle of dev server sessions:
 * - Starting servers with direct process spawning (no tmux)
 * - Stopping servers gracefully with SIGTERM
 * - Health monitoring for crash detection
 * - One dev server per folder enforcement
 *
 * NOTE: Dev servers use direct process spawning (DevServerProcessManager)
 * instead of tmux. This allows for direct PID tracking, cleaner log capture,
 * and simplified CPU/memory monitoring.
 */
import { db } from "@/db";
import { terminalSessions, devServerHealth, sessionFolders, folderPreferences } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import * as TmuxService from "./tmux-service";
import { getDevServerProcessManager } from "./dev-server-process-manager";
import { getResolvedPreferences, getEnvironmentForSession } from "./preferences-service";
import type { DevServerStatus, DevServerHealth, DevServerState, StartDevServerResponse, DevServerConfig } from "@/types/dev-server";
import { getProxyUrl, HEALTH_CHECK_CONFIG } from "@/types/dev-server";
import type { TerminalSession } from "@/types/session";

export class DevServerServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public sessionId?: string
  ) {
    super(message);
    this.name = "DevServerServiceError";
  }
}

/**
 * Get dev server config from folder preferences
 */
export async function getDevServerConfig(
  folderId: string,
  userId: string
): Promise<DevServerConfig | null> {
  const prefs = await db.query.folderPreferences.findFirst({
    where: and(
      eq(folderPreferences.folderId, folderId),
      eq(folderPreferences.userId, userId)
    ),
  });

  if (!prefs) {
    return null;
  }

  return {
    serverStartupCommand: prefs.serverStartupCommand,
    buildCommand: prefs.buildCommand,
    runBuildBeforeStart: prefs.runBuildBeforeStart ?? false,
  };
}

/**
 * Get the PORT from folder environment variables
 */
async function getPortFromEnv(
  userId: string,
  folderId: string
): Promise<number | null> {
  const env = await getEnvironmentForSession(userId, folderId);
  if (!env?.PORT) {
    return null;
  }
  const port = parseInt(env.PORT, 10);
  return isNaN(port) ? null : port;
}

/**
 * Parse a shell command string into command and args
 * Handles basic quoting and escaping
 */
function parseCommand(cmdString: string): { command: string; args: string[] } {
  // Simple parsing - split on whitespace but respect quotes
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of cmdString) {
    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
    } else if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = "";
    } else if (!inQuote && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    throw new DevServerServiceError("Empty command", "INVALID_COMMAND");
  }

  return {
    command: parts[0],
    args: parts.slice(1),
  };
}

/**
 * Get the existing dev server session for a folder (if any)
 */
export async function getDevServerForFolder(
  folderId: string,
  userId: string
): Promise<TerminalSession | null> {
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.folderId, folderId),
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.sessionType, "dev-server"),
      eq(terminalSessions.status, "active")
    ),
  });

  if (!session) {
    return null;
  }

  return mapDbSessionToSession(session);
}

/**
 * Check if a folder has an active dev server
 */
export async function hasActiveDevServer(
  folderId: string,
  userId: string
): Promise<boolean> {
  const session = await getDevServerForFolder(folderId, userId);
  return session !== null;
}

/**
 * Start a dev server for a folder
 *
 * This creates a special session type that runs the server startup command.
 * Optionally runs a build command first if configured.
 */
export async function startDevServer(
  folderId: string,
  userId: string
): Promise<StartDevServerResponse> {
  // Check if folder exists
  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, folderId),
      eq(sessionFolders.userId, userId)
    ),
  });

  if (!folder) {
    throw new DevServerServiceError("Folder not found", "FOLDER_NOT_FOUND");
  }

  // Check if there's already an active dev server
  const existing = await getDevServerForFolder(folderId, userId);
  if (existing) {
    throw new DevServerServiceError(
      "A dev server is already running for this folder",
      "ALREADY_RUNNING",
      existing.id
    );
  }

  // Get dev server config
  const config = await getDevServerConfig(folderId, userId);
  if (!config?.serverStartupCommand) {
    throw new DevServerServiceError(
      "No server startup command configured for this folder",
      "NO_STARTUP_COMMAND"
    );
  }

  // Get port from environment variables
  const port = await getPortFromEnv(userId, folderId);
  if (!port) {
    throw new DevServerServiceError(
      "No PORT environment variable configured for this folder",
      "NO_PORT_CONFIGURED"
    );
  }

  // Get resolved preferences for working directory
  const preferences = await getResolvedPreferences(userId, folderId);
  const workingPath = preferences.localRepoPath ?? preferences.defaultWorkingDirectory ?? process.env.HOME;

  // Get environment variables for the session
  const folderEnv = await getEnvironmentForSession(userId, folderId);

  // Generate session ID (no tmux session name needed for direct spawn)
  const sessionId = crypto.randomUUID();
  // Keep tmuxSessionName for backward compatibility with existing code paths
  const tmuxSessionName = TmuxService.generateSessionName(sessionId);

  // Get the next tab order
  const existingSessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.status, "active")
    ),
    orderBy: [desc(terminalSessions.tabOrder)],
    limit: 1,
  });
  const nextTabOrder = existingSessions.length > 0
    ? existingSessions[0].tabOrder + 1
    : 0;

  // Build the startup command
  // If runBuildBeforeStart is true, we need to handle this differently
  // For direct spawn, we'll run the build first, then the server
  const startupCommand = config.serverStartupCommand;

  // Parse the command into executable + args
  const { command, args } = parseCommand(startupCommand);

  // Start the process using DevServerProcessManager (direct spawn, no tmux)
  const processManager = getDevServerProcessManager();
  try {
    // If build is required, run it first
    if (config.runBuildBeforeStart && config.buildCommand) {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFilePromise = promisify(execFile);

      // Parse build command into executable + args (prevents shell injection)
      const { command: buildCmd, args: buildArgs } = parseCommand(config.buildCommand);

      // Run build command and wait for completion
      console.log(`[DevServerService] Running build command: ${config.buildCommand}`);
      await execFilePromise(buildCmd, buildArgs, {
        cwd: workingPath,
        env: { ...process.env, ...folderEnv } as NodeJS.ProcessEnv,
      });
      console.log(`[DevServerService] Build completed`);
    }

    await processManager.startProcess({
      sessionId,
      command,
      args,
      cwd: workingPath ?? process.env.HOME ?? "/tmp",
      env: folderEnv ?? {},
    });
  } catch (error) {
    throw new DevServerServiceError(
      `Failed to start dev server process: ${(error as Error).message}`,
      "PROCESS_START_FAILED",
      sessionId
    );
  }

  // Generate the proxy URL
  const proxyUrl = getProxyUrl(folder.name);

  // Insert the database record
  const now = new Date();
  try {
    const [session] = await db
      .insert(terminalSessions)
      .values({
        id: sessionId,
        userId,
        name: `Dev Server: ${folder.name}`,
        tmuxSessionName,
        projectPath: workingPath ?? null,
        folderId,
        sessionType: "dev-server",
        devServerPort: port,
        devServerStatus: "starting",
        devServerUrl: proxyUrl,
        status: "active",
        tabOrder: nextTabOrder,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create the health record
    await db.insert(devServerHealth).values({
      sessionId: session.id,
      userId,
      isHealthy: false,
      port,
      url: proxyUrl,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      sessionId: session.id,
      port,
      proxyUrl,
      status: "starting",
    };
  } catch (error) {
    // Clean up spawned process if DB insert fails
    try {
      await processManager.stopProcess(sessionId);
      processManager.removeProcess(sessionId);
    } catch {
      console.error(`Failed to clean up orphaned process for session: ${sessionId}`);
    }
    throw new DevServerServiceError(
      `Failed to create dev server record: ${(error as Error).message}`,
      "DB_INSERT_FAILED",
      sessionId
    );
  }
}

/**
 * Stop a dev server gracefully with SIGTERM
 */
export async function stopDevServer(
  sessionId: string,
  userId: string
): Promise<void> {
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, sessionId),
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.sessionType, "dev-server")
    ),
  });

  if (!session) {
    throw new DevServerServiceError("Dev server session not found", "SESSION_NOT_FOUND", sessionId);
  }

  // Stop the process using DevServerProcessManager
  const processManager = getDevServerProcessManager();
  if (processManager.hasProcess(sessionId)) {
    try {
      await processManager.stopProcess(sessionId, "SIGTERM");
    } catch (error) {
      console.error(`[DevServerService] Error stopping process:`, error);
    }
    // Remove from tracking
    processManager.removeProcess(sessionId);
  }

  // Update status to stopped
  await db
    .update(terminalSessions)
    .set({
      devServerStatus: "stopped",
      status: "closed",
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, sessionId));

  // Update health record
  await db
    .update(devServerHealth)
    .set({
      isHealthy: false,
      updatedAt: new Date(),
    })
    .where(eq(devServerHealth.sessionId, sessionId));
}

/**
 * Restart a dev server
 */
export async function restartDevServer(
  sessionId: string,
  userId: string
): Promise<StartDevServerResponse> {
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, sessionId),
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.sessionType, "dev-server")
    ),
  });

  if (!session || !session.folderId) {
    throw new DevServerServiceError("Dev server session not found", "SESSION_NOT_FOUND", sessionId);
  }

  // Stop the current server
  await stopDevServer(sessionId, userId);

  // Wait a moment for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Start a new server
  return startDevServer(session.folderId, userId);
}

/**
 * Update dev server status
 */
export async function updateDevServerStatus(
  sessionId: string,
  status: DevServerStatus
): Promise<void> {
  await db
    .update(terminalSessions)
    .set({
      devServerStatus: status,
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, sessionId));
}

/**
 * Get dev server health record
 */
export async function getDevServerHealth(
  sessionId: string
): Promise<DevServerHealth | null> {
  const health = await db.query.devServerHealth.findFirst({
    where: eq(devServerHealth.sessionId, sessionId),
  });

  if (!health) {
    return null;
  }

  return {
    id: health.id,
    sessionId: health.sessionId,
    isHealthy: health.isHealthy,
    port: health.port,
    url: health.url,
    lastHealthCheck: health.lastHealthCheck,
    crashedAt: health.crashedAt,
    crashReason: health.crashReason,
    consecutiveFailures: health.consecutiveFailures,
    cpuPercent: health.cpuPercent,
    memoryMb: health.memoryMb,
    createdAt: health.createdAt,
    updatedAt: health.updatedAt,
  };
}

/**
 * Update dev server health after a health check
 */
export async function updateDevServerHealth(
  sessionId: string,
  isHealthy: boolean,
  crashReason?: string
): Promise<void> {
  const now = new Date();
  const health = await db.query.devServerHealth.findFirst({
    where: eq(devServerHealth.sessionId, sessionId),
  });

  if (!health) {
    return;
  }

  const newFailures = isHealthy ? 0 : health.consecutiveFailures + 1;
  const isCrashed = newFailures >= HEALTH_CHECK_CONFIG.failureThreshold;

  await db
    .update(devServerHealth)
    .set({
      isHealthy,
      lastHealthCheck: now,
      consecutiveFailures: newFailures,
      crashedAt: isCrashed && !health.crashedAt ? now : health.crashedAt,
      crashReason: isCrashed ? crashReason : null,
      updatedAt: now,
    })
    .where(eq(devServerHealth.sessionId, sessionId));

  // Update session status if crashed
  if (isCrashed) {
    await updateDevServerStatus(sessionId, "crashed");
  } else if (isHealthy) {
    // Only update to running if currently starting
    const session = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
    });
    if (session?.devServerStatus === "starting") {
      await updateDevServerStatus(sessionId, "running");
    }
  }
}

/**
 * Get all active dev servers for a user
 */
export async function getActiveDevServers(
  userId: string
): Promise<DevServerState[]> {
  const sessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.sessionType, "dev-server"),
      eq(terminalSessions.status, "active")
    ),
  });

  const states: DevServerState[] = [];

  for (const session of sessions) {
    if (!session.folderId || !session.devServerPort) continue;

    const folder = await db.query.sessionFolders.findFirst({
      where: eq(sessionFolders.id, session.folderId),
    });

    if (!folder) continue;

    const health = await getDevServerHealth(session.id);

    states.push({
      sessionId: session.id,
      folderId: session.folderId,
      folderName: folder.name,
      port: session.devServerPort,
      status: (session.devServerStatus as DevServerStatus) ?? "stopped",
      proxyUrl: session.devServerUrl ?? getProxyUrl(folder.name),
      health,
      isStarting: session.devServerStatus === "starting",
    });
  }

  return states;
}

/**
 * Get dev server state by folder
 */
export async function getDevServerState(
  folderId: string,
  userId: string
): Promise<DevServerState | null> {
  const session = await getDevServerForFolder(folderId, userId);
  if (!session || !session.devServerPort) {
    return null;
  }

  const folder = await db.query.sessionFolders.findFirst({
    where: eq(sessionFolders.id, folderId),
  });

  if (!folder) {
    return null;
  }

  const health = await getDevServerHealth(session.id);

  return {
    sessionId: session.id,
    folderId,
    folderName: folder.name,
    port: session.devServerPort,
    status: (session.devServerStatus as DevServerStatus) ?? "stopped",
    proxyUrl: session.devServerUrl ?? getProxyUrl(folder.name),
    health,
    isStarting: session.devServerStatus === "starting",
  };
}

// Database mapper
function mapDbSessionToSession(dbSession: typeof terminalSessions.$inferSelect): TerminalSession {
  return {
    id: dbSession.id,
    userId: dbSession.userId,
    name: dbSession.name,
    tmuxSessionName: dbSession.tmuxSessionName,
    projectPath: dbSession.projectPath,
    githubRepoId: dbSession.githubRepoId,
    worktreeBranch: dbSession.worktreeBranch,
    folderId: dbSession.folderId,
    profileId: dbSession.profileId,
    agentProvider: dbSession.agentProvider as TerminalSession["agentProvider"],
    splitGroupId: dbSession.splitGroupId,
    splitOrder: dbSession.splitOrder,
    splitSize: dbSession.splitSize ?? 0.5,
    sessionType: dbSession.sessionType as TerminalSession["sessionType"],
    devServerPort: dbSession.devServerPort,
    devServerStatus: dbSession.devServerStatus as TerminalSession["devServerStatus"],
    devServerUrl: dbSession.devServerUrl,
    status: dbSession.status as TerminalSession["status"],
    tabOrder: dbSession.tabOrder,
    lastActivityAt: new Date(dbSession.lastActivityAt),
    createdAt: new Date(dbSession.createdAt),
    updatedAt: new Date(dbSession.updatedAt),
  };
}
