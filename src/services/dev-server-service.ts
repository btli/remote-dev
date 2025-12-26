/**
 * DevServerService - Manages development server sessions with browser preview
 *
 * This service handles the lifecycle of dev server sessions:
 * - Starting servers with optional pre-build step
 * - Stopping servers gracefully with Ctrl+C
 * - Health monitoring for crash detection
 * - One dev server per folder enforcement
 */
import { db } from "@/db";
import { terminalSessions, devServerHealth, sessionFolders, folderPreferences } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import * as TmuxService from "./tmux-service";
import { getResolvedPreferences, getEnvironmentForSession } from "./preferences-service";
import { execFile } from "@/lib/exec";
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

  // Generate session IDs
  const sessionId = crypto.randomUUID();
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
  // If runBuildBeforeStart is true, chain build && server commands
  let startupCommand = config.serverStartupCommand;
  if (config.runBuildBeforeStart && config.buildCommand) {
    startupCommand = `${config.buildCommand} && ${config.serverStartupCommand}`;
  }

  // Create the tmux session
  try {
    await TmuxService.createSession(
      tmuxSessionName,
      workingPath ?? undefined,
      startupCommand,
      undefined, // No profile env for dev servers
      folderEnv ?? undefined
    );
  } catch (error) {
    if (error instanceof TmuxService.TmuxServiceError) {
      throw new DevServerServiceError(
        `Failed to create tmux session: ${error.message}`,
        "TMUX_CREATE_FAILED",
        sessionId
      );
    }
    throw error;
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
    // Clean up tmux session if DB insert fails
    await TmuxService.killSession(tmuxSessionName).catch(() => {
      console.error(`Failed to clean up orphaned tmux session: ${tmuxSessionName}`);
    });
    throw new DevServerServiceError(
      `Failed to create dev server record: ${(error as Error).message}`,
      "DB_INSERT_FAILED",
      sessionId
    );
  }
}

/**
 * Stop a dev server gracefully with Ctrl+C
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

  // Send Ctrl+C to gracefully stop the server
  if (await TmuxService.sessionExists(session.tmuxSessionName)) {
    // Send Ctrl+C (C-c in tmux notation)
    await execFile("tmux", ["send-keys", "-t", session.tmuxSessionName, "C-c"]);
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

  // Kill the tmux session after a short delay to allow graceful shutdown
  setTimeout(async () => {
    try {
      await TmuxService.killSession(session.tmuxSessionName);
    } catch {
      // Ignore errors - session may already be dead
    }
  }, 2000);
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
