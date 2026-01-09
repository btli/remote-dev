/**
 * MonitoringService - Automated orchestrator monitoring
 *
 * This service handles the continuous monitoring of terminal sessions by orchestrators.
 * It runs periodic checks for stalled sessions, generates insights, and can trigger
 * automated interventions based on orchestrator configuration.
 *
 * Architecture:
 * - Each orchestrator runs on its own monitoring interval (default: 30 seconds)
 * - Master orchestrators monitor ALL sessions
 * - Sub-orchestrators monitor only sessions in their folder scope
 * - Insights are generated when stalls are detected
 * - Audit logs track all monitoring activities
 */
import { db } from "@/db";
import { orchestratorSessions, terminalSessions } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { detectStalledSessionsUseCase, scrollbackMonitor } from "@/infrastructure/container";
import type { Orchestrator } from "@/domain/entities/Orchestrator";
import type { ScrollbackSnapshot } from "@/types/orchestrator";
import * as TmuxService from "./tmux-service";
import pLimit from "p-limit";

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
 * Session to monitor with previous snapshot
 */
interface SessionToMonitor {
  sessionId: string;
  tmuxSessionName: string;
  name: string;
  folderId: string | null;
  previousSnapshot: ScrollbackSnapshot | null;
}

/**
 * Monitoring result for a single check cycle
 */
export interface MonitoringCycleResult {
  orchestratorId: string;
  sessionsChecked: number;
  stallsDetected: number;
  insightsGenerated: number;
  errors: Array<{ sessionId: string; error: string }>;
  timestamp: Date;
}

/**
 * In-memory snapshot storage
 * Maps orchestratorId -> sessionId -> snapshot
 */
const snapshotStore = new Map<string, Map<string, ScrollbackSnapshot>>();

/**
 * Active monitoring intervals
 * Maps orchestratorId -> NodeJS.Timeout
 */
const activeIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Failure tracking for monitoring health
 * Maps orchestratorId -> failure count
 */
const failureTracker = new Map<
  string,
  {
    consecutiveFailures: number;
    totalFailures: number;
    lastFailureAt: Date | null;
    lastSuccessAt: Date | null;
  }
>();

/**
 * Maximum consecutive failures before auto-pausing
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Concurrency limiter for subprocess spawning
 * Prevents resource exhaustion from spawning too many tmux processes
 */
const CONCURRENCY_LIMIT = 10; // Max 10 concurrent tmux captures
const captureLimit = pLimit(CONCURRENCY_LIMIT);

/**
 * Get sessions to monitor for an orchestrator
 */
async function getSessionsToMonitor(
  orchestrator: Orchestrator,
  userId: string
): Promise<SessionToMonitor[]> {
  let sessions;

  if (orchestrator.type === "master") {
    // Master orchestrator monitors ALL active sessions for the user
    sessions = await db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.userId, userId),
          eq(terminalSessions.status, "active")
        )
      );
  } else {
    // Sub-orchestrator monitors only sessions in its folder scope
    if (!orchestrator.scopeId) {
      throw new MonitoringServiceError(
        "Sub-orchestrator missing scopeId",
        "INVALID_SCOPE",
        orchestrator.id
      );
    }

    sessions = await db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.userId, userId),
          eq(terminalSessions.status, "active"),
          eq(terminalSessions.folderId, orchestrator.scopeId)
        )
      );
  }

  // Get previous snapshots from store
  const orchestratorSnapshots = snapshotStore.get(orchestrator.id) || new Map();

  return sessions.map((session) => ({
    sessionId: session.id,
    tmuxSessionName: session.tmuxSessionName,
    name: session.name,
    folderId: session.folderId,
    previousSnapshot: orchestratorSnapshots.get(session.id) || null,
  }));
}

/**
 * Store snapshot for a session
 */
function storeSnapshot(
  orchestratorId: string,
  sessionId: string,
  snapshot: ScrollbackSnapshot
): void {
  let orchestratorSnapshots = snapshotStore.get(orchestratorId);
  if (!orchestratorSnapshots) {
    orchestratorSnapshots = new Map();
    snapshotStore.set(orchestratorId, orchestratorSnapshots);
  }

  orchestratorSnapshots.set(sessionId, snapshot);
}

/**
 * Clear all snapshots for an orchestrator
 */
function clearSnapshots(orchestratorId: string): void {
  snapshotStore.delete(orchestratorId);
}

/**
 * Clear snapshots for specific sessions
 */
function clearSessionSnapshots(orchestratorId: string, sessionIds: string[]): void {
  const orchestratorSnapshots = snapshotStore.get(orchestratorId);
  if (!orchestratorSnapshots) {
    return;
  }

  for (const sessionId of sessionIds) {
    orchestratorSnapshots.delete(sessionId);
  }

  // If no snapshots left, remove the orchestrator entry
  if (orchestratorSnapshots.size === 0) {
    snapshotStore.delete(orchestratorId);
  }
}

/**
 * Clean up snapshots for closed/deleted sessions
 * Should be called periodically or when sessions are closed
 */
export async function cleanupOrphanedSnapshots(orchestratorId: string): Promise<number> {
  const orchestratorSnapshots = snapshotStore.get(orchestratorId);
  if (!orchestratorSnapshots) {
    return 0;
  }

  const sessionIds = Array.from(orchestratorSnapshots.keys());
  if (sessionIds.length === 0) {
    return 0;
  }

  // Query database for active sessions
  const activeSessions = await db
    .select({ id: terminalSessions.id })
    .from(terminalSessions)
    .where(
      and(
        inArray(terminalSessions.id, sessionIds),
        eq(terminalSessions.status, "active")
      )
    );

  const activeSessionIds = new Set(activeSessions.map((s) => s.id));

  // Find orphaned snapshots
  const orphanedSessionIds = sessionIds.filter((id) => !activeSessionIds.has(id));

  // Remove orphaned snapshots
  if (orphanedSessionIds.length > 0) {
    clearSessionSnapshots(orchestratorId, orphanedSessionIds);
    console.log(
      `[MonitoringService] Cleaned up ${orphanedSessionIds.length} orphaned snapshots for orchestrator ${orchestratorId}`
    );
  }

  return orphanedSessionIds.length;
}

/**
 * Run a single monitoring cycle for an orchestrator
 */
export async function runMonitoringCycle(
  orchestratorId: string,
  userId: string
): Promise<MonitoringCycleResult> {
  const timestamp = new Date();
  const errors: Array<{ sessionId: string; error: string }> = [];

  try {
    // Step 1: Get orchestrator from database
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

    // Reconstitute orchestrator entity
    const { Orchestrator } = await import("@/domain/entities/Orchestrator");
    const orchestrator = Orchestrator.reconstitute({
      id: orchestratorResult[0].id,
      sessionId: orchestratorResult[0].sessionId,
      userId: orchestratorResult[0].userId,
      type: orchestratorResult[0].type as "master" | "sub_orchestrator",
      status: orchestratorResult[0].status as "idle" | "analyzing" | "acting" | "paused",
      scopeType: orchestratorResult[0].scopeType as "folder" | null,
      scopeId: orchestratorResult[0].scopeId,
      customInstructions: orchestratorResult[0].customInstructions,
      monitoringInterval: orchestratorResult[0].monitoringInterval,
      stallThreshold: orchestratorResult[0].stallThreshold,
      autoIntervention: orchestratorResult[0].autoIntervention,
      lastActivityAt: orchestratorResult[0].lastActivityAt,
      createdAt: orchestratorResult[0].createdAt,
      updatedAt: orchestratorResult[0].updatedAt,
    });

    // Skip if orchestrator is paused
    if (orchestrator.isPaused()) {
      return {
        orchestratorId,
        sessionsChecked: 0,
        stallsDetected: 0,
        insightsGenerated: 0,
        errors: [],
        timestamp,
      };
    }

    // Step 2: Get sessions to monitor
    const sessionsToMonitor = await getSessionsToMonitor(orchestrator, userId);

    // Step 3: Capture current snapshots for all sessions (with concurrency limiting)
    const capturePromises = sessionsToMonitor.map((session) =>
      captureLimit(async () => {
        try {
          // Check if tmux session exists
          const exists = await TmuxService.sessionExists(session.tmuxSessionName);
          if (!exists) {
            return null;
          }

          // Capture scrollback
          const snapshot = await scrollbackMonitor.captureScrollback(
            session.tmuxSessionName
          );

          // Store snapshot for next cycle
          storeSnapshot(orchestratorId, session.sessionId, snapshot);

          return { session, snapshot };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({
            sessionId: session.sessionId,
            error: `Failed to capture scrollback: ${message}`,
          });
          return null;
        }
      })
    );

    const captured = (await Promise.all(capturePromises)).filter(
      (result) => result !== null
    ) as Array<{ session: SessionToMonitor; snapshot: ScrollbackSnapshot }>;

    // Step 3.5: Clean up orphaned snapshots (prevent memory leaks)
    await cleanupOrphanedSnapshots(orchestratorId);

    // Step 4: Run stall detection
    const result = await detectStalledSessionsUseCase.execute({
      orchestratorId,
      sessionsToMonitor: sessionsToMonitor.map((s) => ({
        sessionId: s.sessionId,
        tmuxSessionName: s.tmuxSessionName,
        name: s.name,
        folderId: s.folderId,
        previousSnapshot: s.previousSnapshot,
      })),
    });

    return {
      orchestratorId,
      sessionsChecked: captured.length, // Use actual captured count for accuracy
      stallsDetected: result.stallDetectionResults.size,
      insightsGenerated: result.insights.length,
      errors,
      timestamp,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MonitoringServiceError(
      `Monitoring cycle failed: ${message}`,
      "MONITORING_FAILED",
      orchestratorId
    );
  }
}

/**
 * Start automated monitoring for an orchestrator
 */
export function startMonitoring(orchestratorId: string, userId: string): void {
  // Stop existing monitoring if any
  stopMonitoring(orchestratorId);

  // Get orchestrator configuration
  db.select()
    .from(orchestratorSessions)
    .where(
      and(
        eq(orchestratorSessions.id, orchestratorId),
        eq(orchestratorSessions.userId, userId)
      )
    )
    .limit(1)
    .then((result) => {
      if (result.length === 0) {
        console.error(`[MonitoringService] Orchestrator ${orchestratorId} not found`);
        return;
      }

      const orchestrator = result[0];
      const intervalMs = orchestrator.monitoringInterval * 1000;

      // Run first cycle immediately and await it to prevent TOCTOU race condition
      console.log(
        `[MonitoringService] Starting monitoring for ${orchestratorId} (interval: ${orchestrator.monitoringInterval}s)`
      );

      runMonitoringCycle(orchestratorId, userId)
        .then((cycleResult) => {
          console.log(`[MonitoringService] Initial cycle complete for ${orchestratorId}:`, {
            sessionsChecked: cycleResult.sessionsChecked,
            stallsDetected: cycleResult.stallsDetected,
            insightsGenerated: cycleResult.insightsGenerated,
            errors: cycleResult.errors.length,
          });

          // Reset failure tracking on successful initial cycle
          recordSuccess(orchestratorId);

          // Only start interval after initial cycle completes successfully
          const interval = setInterval(async () => {
            try {
              const result = await runMonitoringCycle(orchestratorId, userId);

              // Log monitoring cycle
              console.log(`[MonitoringService] Cycle complete for ${orchestratorId}:`, {
                sessionsChecked: result.sessionsChecked,
                stallsDetected: result.stallsDetected,
                insightsGenerated: result.insightsGenerated,
                errors: result.errors.length,
              });

              // Log errors if any
              if (result.errors.length > 0) {
                console.error(`[MonitoringService] Errors in cycle:`, result.errors);
              }

              // Record successful cycle
              recordSuccess(orchestratorId);
            } catch (error) {
              console.error(`[MonitoringService] Monitoring cycle failed:`, error);

              // Record failure and check if we should pause monitoring
              recordFailure(orchestratorId);

              const failureMetrics = getFailureMetrics(orchestratorId);
              if (
                failureMetrics &&
                failureMetrics.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
              ) {
                console.error(
                  `[MonitoringService] Orchestrator ${orchestratorId} has ${failureMetrics.consecutiveFailures} consecutive failures. Auto-pausing...`
                );

                // Stop monitoring
                stopMonitoring(orchestratorId);

                // Pause orchestrator in database
                try {
                  await db
                    .update(orchestratorSessions)
                    .set({ status: "paused", updatedAt: new Date() })
                    .where(eq(orchestratorSessions.id, orchestratorId));

                  console.log(
                    `[MonitoringService] Orchestrator ${orchestratorId} auto-paused due to repeated failures`
                  );
                } catch (pauseError) {
                  console.error(
                    `[MonitoringService] Failed to pause orchestrator ${orchestratorId}:`,
                    pauseError
                  );
                }
              }
            }
          }, intervalMs);

          activeIntervals.set(orchestratorId, interval);
          console.log(`[MonitoringService] Monitoring interval started for ${orchestratorId}`);
        })
        .catch((error) => {
          console.error(`[MonitoringService] Initial cycle failed:`, error);
          console.error(`[MonitoringService] Monitoring NOT started for ${orchestratorId}`);
        });
    })
    .catch((error) => {
      console.error(`[MonitoringService] Failed to start monitoring:`, error);
    });
}

/**
 * Record a successful monitoring cycle
 */
function recordSuccess(orchestratorId: string): void {
  let metrics = failureTracker.get(orchestratorId);
  if (!metrics) {
    metrics = {
      consecutiveFailures: 0,
      totalFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
    };
    failureTracker.set(orchestratorId, metrics);
  }

  // Reset consecutive failures on success
  metrics.consecutiveFailures = 0;
  metrics.lastSuccessAt = new Date();
}

/**
 * Record a failed monitoring cycle
 */
function recordFailure(orchestratorId: string): void {
  let metrics = failureTracker.get(orchestratorId);
  if (!metrics) {
    metrics = {
      consecutiveFailures: 0,
      totalFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
    };
    failureTracker.set(orchestratorId, metrics);
  }

  metrics.consecutiveFailures += 1;
  metrics.totalFailures += 1;
  metrics.lastFailureAt = new Date();
}

/**
 * Get failure metrics for an orchestrator
 */
export function getFailureMetrics(orchestratorId: string): {
  consecutiveFailures: number;
  totalFailures: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
} | null {
  return failureTracker.get(orchestratorId) || null;
}

/**
 * Get failure metrics for all orchestrators
 */
export function getAllFailureMetrics(): Map<
  string,
  {
    consecutiveFailures: number;
    totalFailures: number;
    lastFailureAt: Date | null;
    lastSuccessAt: Date | null;
  }
> {
  return new Map(failureTracker);
}

/**
 * Clear failure tracking for an orchestrator
 */
export function clearFailureTracking(orchestratorId: string): void {
  failureTracker.delete(orchestratorId);
}

/**
 * Stop automated monitoring for an orchestrator
 */
export function stopMonitoring(orchestratorId: string): void {
  const interval = activeIntervals.get(orchestratorId);
  if (interval) {
    clearInterval(interval);
    activeIntervals.delete(orchestratorId);
    console.log(`[MonitoringService] Stopped monitoring for ${orchestratorId}`);
  }

  // Clear snapshots
  clearSnapshots(orchestratorId);

  // Clear failure tracking
  clearFailureTracking(orchestratorId);
}

/**
 * Check if monitoring is active for an orchestrator
 */
export function isMonitoringActive(orchestratorId: string): boolean {
  return activeIntervals.has(orchestratorId);
}

/**
 * Get all active monitoring sessions
 */
export function getActiveMonitoringSessions(): string[] {
  return Array.from(activeIntervals.keys());
}

/**
 * Stop all monitoring
 */
export function stopAllMonitoring(): void {
  for (const orchestratorId of activeIntervals.keys()) {
    stopMonitoring(orchestratorId);
  }
}

/**
 * Clean up orphaned snapshots for ALL orchestrators
 * This should be called periodically (e.g., every hour) to prevent memory leaks
 */
export async function cleanupAllOrphanedSnapshots(): Promise<number> {
  const orchestratorIds = Array.from(snapshotStore.keys());
  let totalCleaned = 0;

  console.log(
    `[MonitoringService] Running global snapshot cleanup for ${orchestratorIds.length} orchestrators...`
  );

  for (const orchestratorId of orchestratorIds) {
    try {
      const cleaned = await cleanupOrphanedSnapshots(orchestratorId);
      totalCleaned += cleaned;
    } catch (error) {
      console.error(
        `[MonitoringService] Failed to cleanup snapshots for ${orchestratorId}:`,
        error
      );
    }
  }

  if (totalCleaned > 0) {
    console.log(`[MonitoringService] Global cleanup: removed ${totalCleaned} orphaned snapshots`);
  }

  return totalCleaned;
}

/**
 * Initialize monitoring for all active orchestrators
 * Call this on server startup
 */
export async function initializeMonitoring(): Promise<void> {
  console.log("[MonitoringService] Initializing monitoring for all orchestrators...");

  // Get all non-paused orchestrators
  const orchestrators = await db
    .select()
    .from(orchestratorSessions)
    .where(eq(orchestratorSessions.status, "idle"));

  console.log(`[MonitoringService] Found ${orchestrators.length} orchestrators to monitor`);

  // Start monitoring for each
  for (const orchestrator of orchestrators) {
    startMonitoring(orchestrator.id, orchestrator.userId);
  }

  // Set up periodic global snapshot cleanup (every hour)
  setInterval(async () => {
    try {
      await cleanupAllOrphanedSnapshots();
    } catch (error) {
      console.error("[MonitoringService] Global snapshot cleanup failed:", error);
    }
  }, 60 * 60 * 1000); // 1 hour
}
