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

    // Step 3: Capture current snapshots for all sessions
    const capturePromises = sessionsToMonitor.map(async (session) => {
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
    });

    const captured = (await Promise.all(capturePromises)).filter(
      (result) => result !== null
    ) as Array<{ session: SessionToMonitor; snapshot: ScrollbackSnapshot }>;

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
      sessionsChecked: sessionsToMonitor.length,
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

      // Start interval
      const interval = setInterval(async () => {
        try {
          const cycleResult = await runMonitoringCycle(orchestratorId, userId);

          // Log monitoring cycle
          console.log(`[MonitoringService] Cycle complete for ${orchestratorId}:`, {
            sessionsChecked: cycleResult.sessionsChecked,
            stallsDetected: cycleResult.stallsDetected,
            insightsGenerated: cycleResult.insightsGenerated,
            errors: cycleResult.errors.length,
          });

          // Log errors if any
          if (cycleResult.errors.length > 0) {
            console.error(`[MonitoringService] Errors in cycle:`, cycleResult.errors);
          }
        } catch (error) {
          console.error(`[MonitoringService] Monitoring cycle failed:`, error);
        }
      }, intervalMs);

      activeIntervals.set(orchestratorId, interval);
      console.log(
        `[MonitoringService] Started monitoring for ${orchestratorId} (interval: ${orchestrator.monitoringInterval}s)`
      );

      // Run first cycle immediately
      runMonitoringCycle(orchestratorId, userId).catch((error) => {
        console.error(`[MonitoringService] Initial cycle failed:`, error);
      });
    })
    .catch((error) => {
      console.error(`[MonitoringService] Failed to start monitoring:`, error);
    });
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
}
