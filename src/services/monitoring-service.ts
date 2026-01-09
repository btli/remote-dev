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
 */
import { db } from "@/db";
import { orchestratorSessions, terminalSessions } from "@/db/schema";
import { eq, and, lt, isNull, or } from "drizzle-orm";
import { scrollbackMonitor } from "@/infrastructure/container";
import type { ScrollbackSnapshot } from "@/types/orchestrator";
import * as TmuxService from "./tmux-service";

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

        // Log stalled sessions for debugging
        for (const session of result.stalledSessions) {
          console.log(
            `[MonitoringService] Stalled: ${session.sessionName} (${session.stalledMinutes} min)`
          );
        }

        // TODO: Generate insights for stalled sessions
        // This would create OrchestratorInsight records for the UI to display
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
// Legacy API compatibility (deprecated - use new event-driven functions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use startStallChecking instead
 */
export function startMonitoring(orchestratorId: string, userId: string): void {
  startStallChecking(orchestratorId, userId, 60000);
}

/**
 * @deprecated Use stopStallChecking instead
 */
export function stopMonitoring(orchestratorId: string): void {
  stopStallChecking(orchestratorId);
}

/**
 * @deprecated Use isStallCheckingActive instead
 */
export function isMonitoringActive(orchestratorId: string): boolean {
  return isStallCheckingActive(orchestratorId);
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
 * Initialize stall checking for all active orchestrators
 * Call this on server startup
 */
export async function initializeMonitoring(): Promise<void> {
  console.log("[MonitoringService] Initializing event-driven monitoring...");

  // Get all non-paused orchestrators
  const orchestrators = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.status, "idle"));

  console.log(`[MonitoringService] Found ${orchestrators.length} orchestrators`);

  // Start stall checking for each (lightweight timestamp checks)
  for (const orchestrator of orchestrators) {
    // Convert stallThreshold seconds to check interval (check at half the threshold)
    const checkInterval = Math.max(30000, (orchestrator.stallThreshold / 2) * 1000);
    startStallChecking(orchestrator.id, orchestrator.userId, checkInterval);
  }

  console.log("[MonitoringService] Event-driven monitoring initialized");
}
