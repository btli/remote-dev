/**
 * MonitoringService - Event-driven orchestrator monitoring
 *
 * This service provides event-driven monitoring of terminal sessions.
 * Instead of polling, it relies on agent hooks to report activity via heartbeats.
 *
 * Architecture:
 * - Agent hooks send heartbeats to /api/orchestrators/agent-event
 * - Heartbeats update session.lastActivityAt timestamps
 * - Stall detection checks if lastActivityAt exceeds threshold
 * - Scrollback capture is on-demand for diagnostics only
 *
 * Hierarchy: Agent Hooks → Folder Orchestrator → Master Control (escalation)
 *
 * Migration Note:
 * This service now delegates to rdv-server (Rust) when available.
 * The in-process implementation is kept as a fallback during migration.
 */
import { db } from "@/db";
import { orchestratorSessions, terminalSessions, userSettings, folderPreferences } from "@/db/schema";
import { eq, and, lt, isNull, or } from "drizzle-orm";
import { scrollbackMonitor } from "@/infrastructure/container";
import type { ScrollbackSnapshot } from "@/types/orchestrator";
import * as TmuxService from "./tmux-service";
import { callRdvServer, isRdvServerAvailable } from "@/lib/rdv-proxy";
import { onStalledSessionDetected } from "./meta-agent-orchestrator-service";

/**
 * Error class for monitoring service operations
 */
export class MonitoringServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly orchestratorId?: string
  ) {
    super(message);
    this.name = "MonitoringServiceError";
  }
}

/**
 * Session with stall information
 */
export interface StalledSession {
  sessionId: string;
  sessionName: string;
  tmuxSessionName: string;
  folderId: string | null;
  lastActivityAt: Date | null;
  stalledMinutes: number;
}

/**
 * Stall check result
 */
export interface StallCheckResult {
  orchestratorId: string;
  stalledSessions: StalledSession[];
  checkedAt: Date;
}

/**
 * Active stall check intervals (lightweight, just checks timestamps)
 * Maps orchestratorId -> NodeJS.Timeout
 */
const activeStallChecks = new Map<string, NodeJS.Timeout>();

/**
 * Default stall threshold in minutes
 */
const DEFAULT_STALL_THRESHOLD_MINUTES = 5;

/**
 * Check for stalled sessions for an orchestrator
 *
 * A session is considered stalled if:
 * - lastActivityAt is older than stallThreshold
 * - OR lastActivityAt is null and session is active
 *
 * This is a lightweight check - it only reads timestamps from the database.
 */
export async function checkForStalledSessions(
  orchestratorId: string,
  userId: string
): Promise<StallCheckResult> {
  // Get orchestrator configuration
  const orchestratorResult = await db
    .select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    )
    .limit(1);

  if (orchestratorResult.length === 0) {
    throw new MonitoringServiceError(
      "Orchestrator not found",
      "ORCHESTRATOR_NOT_FOUND",
      orchestratorId
    );
  }

  const orchestrator = orchestratorResult[0];
  const stallThresholdMinutes = Math.floor(orchestrator.stallThreshold / 60) || DEFAULT_STALL_THRESHOLD_MINUTES;
  const stallThresholdMs = stallThresholdMinutes * 60 * 1000;
  const cutoffTime = new Date(Date.now() - stallThresholdMs);

  // Build query based on orchestrator type
  let sessions;

  if (orchestrator.type === "master") {
    // Master orchestrator checks ALL active sessions
    sessions = await db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.userId, userId),
          eq(terminalSessions.status, "active"),
          eq(terminalSessions.isOrchestratorSession, false), // Don't monitor orchestrator sessions
          or(
            isNull(terminalSessions.lastActivityAt),
            lt(terminalSessions.lastActivityAt, cutoffTime)
          )
        )
      );
  } else {
    // Folder orchestrator checks only sessions in its folder
    if (!orchestrator.scopeId) {
      return {
        orchestratorId,
        stalledSessions: [],
        checkedAt: new Date(),
      };
    }

    sessions = await db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.userId, userId),
          eq(terminalSessions.status, "active"),
          eq(terminalSessions.folderId, orchestrator.scopeId),
          eq(terminalSessions.isOrchestratorSession, false),
          or(
            isNull(terminalSessions.lastActivityAt),
            lt(terminalSessions.lastActivityAt, cutoffTime)
          )
        )
      );
  }

  const stalledSessions: StalledSession[] = sessions.map((session) => {
    const lastActivity = session.lastActivityAt;
    const stalledMinutes = lastActivity
      ? Math.floor((Date.now() - lastActivity.getTime()) / 60000)
      : stallThresholdMinutes; // If no activity recorded, assume stalled

    return {
      sessionId: session.id,
      sessionName: session.name,
      tmuxSessionName: session.tmuxSessionName,
      folderId: session.folderId,
      lastActivityAt: lastActivity,
      stalledMinutes,
    };
  });

  return {
    orchestratorId,
    stalledSessions,
    checkedAt: new Date(),
  };
}

/**
 * Capture scrollback for a session (on-demand diagnostic tool)
 *
 * This should only be called when investigating a potentially stalled session,
 * not as part of regular monitoring.
 */
export async function captureSessionScrollback(
  tmuxSessionName: string
): Promise<ScrollbackSnapshot | null> {
  try {
    // Check if tmux session exists
    const exists = await TmuxService.sessionExists(tmuxSessionName);
    if (!exists) {
      return null;
    }

    // Capture scrollback
    return await scrollbackMonitor.captureScrollback(tmuxSessionName);
  } catch (error) {
    console.error(`[MonitoringService] Failed to capture scrollback for ${tmuxSessionName}:`, error);
    return null;
  }
}

/**
 * Start periodic stall checking for an orchestrator
 *
 * This is a lightweight operation - it only checks timestamps in the database.
 * Unlike the old polling approach, it does NOT capture scrollback on every cycle.
 */
export function startStallChecking(
  orchestratorId: string,
  userId: string,
  intervalMs: number = 60000 // Default: check every minute
): void {
  // Stop existing check if any
  stopStallChecking(orchestratorId);

  console.log(
    `[MonitoringService] Starting stall checking for ${orchestratorId} (interval: ${intervalMs / 1000}s)`
  );

  const interval = setInterval(async () => {
    try {
      const result = await checkForStalledSessions(orchestratorId, userId);

      if (result.stalledSessions.length > 0) {
        console.log(
          `[MonitoringService] Found ${result.stalledSessions.length} potentially stalled sessions for ${orchestratorId}`
        );

        // Process each stalled session
        for (const session of result.stalledSessions) {
          console.log(
            `[MonitoringService] Stalled: ${session.sessionName} (${session.stalledMinutes} min)`
          );

          // Capture scrollback and store observations to memory
          try {
            const scrollback = await captureSessionScrollback(session.tmuxSessionName);
            if (scrollback) {
              const { processScrollbackForMemory } = await import("./session-memory-service");
              const storedIds = await processScrollbackForMemory(
                userId,
                session.sessionId,
                session.folderId,
                scrollback
              );
              if (storedIds.length > 0) {
                console.log(
                  `[MonitoringService] Stored ${storedIds.length} observations from scrollback`
                );
              }
            }
          } catch (error) {
            console.warn(`[MonitoringService] Failed to process scrollback for memory:`, error);
          }

          // Trigger meta-agent optimization for significantly stalled sessions
          try {
            await onStalledSessionDetected(session, userId);
          } catch (error) {
            console.warn(`[MonitoringService] Failed to trigger meta-agent optimization:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[MonitoringService] Stall check failed for ${orchestratorId}:`, error);
    }
  }, intervalMs);

  activeStallChecks.set(orchestratorId, interval);
}

/**
 * Stop stall checking for an orchestrator
 */
export function stopStallChecking(orchestratorId: string): void {
  const interval = activeStallChecks.get(orchestratorId);
  if (interval) {
    clearInterval(interval);
    activeStallChecks.delete(orchestratorId);
    console.log(`[MonitoringService] Stopped stall checking for ${orchestratorId}`);
  }
}

/**
 * Check if stall checking is active for an orchestrator
 */
export function isStallCheckingActive(orchestratorId: string): boolean {
  return activeStallChecks.has(orchestratorId);
}

/**
 * Get all active stall checking orchestrators
 */
export function getActiveStallChecks(): string[] {
  return Array.from(activeStallChecks.keys());
}

/**
 * Stop all stall checking
 */
export function stopAllStallChecking(): void {
  for (const orchestratorId of activeStallChecks.keys()) {
    stopStallChecking(orchestratorId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy API compatibility - delegates to rdv-server when available
// ─────────────────────────────────────────────────────────────────────────────

// Cache for rdv-server availability (checked periodically)
let rdvServerAvailableCache: boolean | null = null;
let rdvServerLastCheck = 0;
const RDV_CHECK_INTERVAL = 30000; // 30 seconds

/**
 * Check if rdv-server is available (with caching)
 */
async function checkRdvServerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (rdvServerAvailableCache !== null && now - rdvServerLastCheck < RDV_CHECK_INTERVAL) {
    return rdvServerAvailableCache;
  }
  rdvServerAvailableCache = await isRdvServerAvailable();
  rdvServerLastCheck = now;
  return rdvServerAvailableCache;
}

/**
 * Start monitoring for an orchestrator
 *
 * Delegates to rdv-server if available, falls back to in-process implementation.
 */
export function startMonitoring(orchestratorId: string, userId: string): void {
  // Fire and forget - try rdv-server first, fall back to in-process
  checkRdvServerAvailable().then(async (available) => {
    if (available) {
      const result = await callRdvServer(
        "POST",
        `/orchestrators/${orchestratorId}/monitoring/start`,
        userId,
        {}
      );
      if ("error" in result) {
        console.warn(`[MonitoringService] rdv-server start failed, using fallback: ${result.error}`);
        startStallChecking(orchestratorId, userId, 60000);
      } else {
        console.log(`[MonitoringService] Started monitoring via rdv-server: ${orchestratorId}`);
      }
    } else {
      startStallChecking(orchestratorId, userId, 60000);
    }
  });
}

/**
 * Stop monitoring for an orchestrator
 *
 * Delegates to rdv-server if available, also stops in-process.
 */
export function stopMonitoring(orchestratorId: string): void {
  // Always stop in-process (in case it's running)
  stopStallChecking(orchestratorId);

  // Also stop in rdv-server
  checkRdvServerAvailable().then(async (available) => {
    if (available) {
      // We need a userId for rdv-server, but we don't have it here
      // For now, try with empty userId (rdv-server will validate)
      // In practice, stopMonitoring is always called with proper context
      const result = await callRdvServer(
        "POST",
        `/orchestrators/${orchestratorId}/monitoring/stop`,
        "",  // userId not needed for stop
        {}
      );
      if ("error" in result) {
        console.warn(`[MonitoringService] rdv-server stop failed: ${result.error}`);
      }
    }
  });
}

/**
 * Check if monitoring is active for an orchestrator
 *
 * Checks both in-process and rdv-server state.
 */
export function isMonitoringActive(orchestratorId: string): boolean {
  // For synchronous API compatibility, check in-process state
  // The rdv-server state is checked asynchronously by the caller
  return isStallCheckingActive(orchestratorId);
}

/**
 * Check if monitoring is active (async version that checks rdv-server)
 */
export async function isMonitoringActiveAsync(
  orchestratorId: string,
  userId: string
): Promise<boolean> {
  // Check in-process first
  if (isStallCheckingActive(orchestratorId)) {
    return true;
  }

  // Check rdv-server
  const available = await checkRdvServerAvailable();
  if (available) {
    const result = await callRdvServer<{ is_active: boolean }>(
      "GET",
      `/orchestrators/${orchestratorId}/monitoring/status`,
      userId
    );
    if ("data" in result) {
      return result.data.is_active;
    }
  }

  return false;
}

/**
 * @deprecated Use getActiveStallChecks instead
 */
export function getActiveMonitoringSessions(): string[] {
  return getActiveStallChecks();
}

/**
 * @deprecated Use stopAllStallChecking instead
 */
export function stopAllMonitoring(): void {
  stopAllStallChecking();
}

/**
 * Check if orchestrator mode is enabled for a user/folder combination
 *
 * Returns true if:
 * - Folder has orchestratorFirstMode = true, OR
 * - Folder has orchestratorFirstMode = null AND user has orchestratorFirstMode = true
 *
 * Use this to gate orchestrator creation and monitoring operations.
 */
export async function isOrchestratorModeEnabled(
  userId: string,
  scopeId: string | null
): Promise<boolean> {
  // Get user settings
  const userSettingsResult = await db
    .select({ orchestratorFirstMode: userSettings.orchestratorFirstMode })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  const userEnabled = userSettingsResult[0]?.orchestratorFirstMode ?? false;

  // If this is a folder-scoped orchestrator, check folder preferences
  if (scopeId) {
    const folderPrefsResult = await db
      .select({ orchestratorFirstMode: folderPreferences.orchestratorFirstMode })
      .from(folderPreferences)
      .where(
        and(
          eq(folderPreferences.folderId, scopeId),
          eq(folderPreferences.userId, userId)
        )
      )
      .limit(1);

    const folderEnabled = folderPrefsResult[0]?.orchestratorFirstMode;

    // Folder preference takes precedence if explicitly set
    if (folderEnabled !== null && folderEnabled !== undefined) {
      return folderEnabled;
    }
  }

  // Fall back to user-level preference
  return userEnabled;
}

/**
 * Initialize stall checking for all active orchestrators
 * Call this on server startup
 *
 * Respects the orchestratorFirstMode feature flag:
 * - Only starts monitoring for users/folders with the flag enabled
 * - Orchestrators for disabled users/folders remain in 'idle' state but don't run
 */
export async function initializeMonitoring(): Promise<void> {
  console.log("[MonitoringService] Initializing event-driven monitoring...");

  // Get all non-paused orchestrators
  const orchestrators = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.status, "idle"));

  console.log(`[MonitoringService] Found ${orchestrators.length} orchestrators`);

  let enabledCount = 0;
  let skippedCount = 0;

  // Start stall checking for each (lightweight timestamp checks)
  for (const orchestrator of orchestrators) {
    // Check if orchestrator mode is enabled for this user/folder
    const isEnabled = await isOrchestratorModeEnabled(
      orchestrator.userId,
      orchestrator.scopeId
    );

    if (!isEnabled) {
      console.log(
        `[MonitoringService] Skipping ${orchestrator.id} (orchestratorFirstMode disabled)`
      );
      skippedCount++;
      continue;
    }

    // Convert stallThreshold seconds to check interval (check at half the threshold)
    const checkInterval = Math.max(30000, (orchestrator.stallThreshold / 2) * 1000);
    startStallChecking(orchestrator.id, orchestrator.userId, checkInterval);
    enabledCount++;
  }

  console.log(
    `[MonitoringService] Event-driven monitoring initialized: ${enabledCount} enabled, ${skippedCount} skipped (feature flag disabled)`
  );
}
