/**
 * HealthChecker - Background health monitoring for dev servers
 *
 * This module runs in the terminal server process and periodically
 * checks if dev servers are responding. It updates health records
 * and marks servers as crashed after consecutive failures.
 *
 * Uses DevServerProcessManager for direct PID access, eliminating
 * the need for complex process tree traversal.
 */
import { db } from "@/db";
import { terminalSessions, devServerHealth } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { HEALTH_CHECK_CONFIG } from "@/types/dev-server";
import type { DevServerStatus } from "@/types/dev-server";
import { getDevServerProcessManager } from "@/services/dev-server-process-manager";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Process resource usage metrics
 */
interface ProcessMetrics {
  cpuPercent: number | null;
  memoryMb: number | null;
}

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get CPU and memory usage for a process by PID
 * Uses direct PID from DevServerProcessManager - no process tree traversal needed
 */
async function getProcessMetrics(sessionId: string): Promise<ProcessMetrics> {
  try {
    const processManager = getDevServerProcessManager();
    const pid = processManager.getPid(sessionId);

    if (!pid) {
      return { cpuPercent: null, memoryMb: null };
    }

    // Single ps call with direct PID - no pgrep recursion needed!
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "pcpu=,rss=",
    ]);

    // Parse the output: "  5.2  12345"
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      const cpuPercent = parseFloat(parts[0]) || 0;
      // RSS is in KB, convert to MB
      const memoryMb = (parseInt(parts[1], 10) || 0) / 1024;
      return { cpuPercent, memoryMb };
    }

    return { cpuPercent: null, memoryMb: null };
  } catch {
    // Process may have exited
    return { cpuPercent: null, memoryMb: null };
  }
}

/**
 * Perform a health check on a single dev server
 */
async function checkServerHealth(
  sessionId: string,
  port: number
): Promise<{ isHealthy: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_CONFIG.timeoutMs);

    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
      method: "HEAD",
    });

    clearTimeout(timeoutId);

    // Consider 2xx, 3xx, and 4xx as "server is responding"
    // Only 5xx or connection failures indicate a problem
    return { isHealthy: response.status < 500 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Distinguish between "server not started yet" and "server crashed"
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return { isHealthy: false, error: "Connection refused - server may still be starting or has crashed" };
    }
    if (message.includes("abort")) {
      return { isHealthy: false, error: "Health check timed out" };
    }
    return { isHealthy: false, error: message };
  }
}

/**
 * Update health status in database
 */
async function updateHealth(
  sessionId: string,
  isHealthy: boolean,
  error?: string,
  metrics?: ProcessMetrics
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

  // Update health record with metrics
  await db
    .update(devServerHealth)
    .set({
      isHealthy,
      lastHealthCheck: now,
      consecutiveFailures: newFailures,
      crashedAt: isCrashed && !health.crashedAt ? now : health.crashedAt,
      crashReason: isCrashed ? error : null,
      cpuPercent: metrics?.cpuPercent ?? null,
      memoryMb: metrics?.memoryMb ?? null,
      updatedAt: now,
    })
    .where(eq(devServerHealth.sessionId, sessionId));

  // Update session status based on health
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
  });

  if (!session) return;

  let newStatus: DevServerStatus | null = null;

  if (isCrashed && session.devServerStatus !== "crashed") {
    newStatus = "crashed";
    console.log(`[HealthChecker] Dev server ${sessionId} marked as crashed: ${error}`);
  } else if (isHealthy && session.devServerStatus === "starting") {
    newStatus = "running";
    console.log(`[HealthChecker] Dev server ${sessionId} is now running`);

    // Also notify the process manager
    const processManager = getDevServerProcessManager();
    processManager.markRunning(sessionId);
  }

  if (newStatus) {
    await db
      .update(terminalSessions)
      .set({
        devServerStatus: newStatus,
        updatedAt: now,
      })
      .where(eq(terminalSessions.id, sessionId));
  }
}

/**
 * Check if startup timeout has been exceeded
 */
async function checkStartupTimeout(
  sessionId: string,
  createdAt: Date
): Promise<boolean> {
  const elapsed = Date.now() - createdAt.getTime();
  if (elapsed > HEALTH_CHECK_CONFIG.startupTimeoutMs) {
    const session = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
    });

    if (session?.devServerStatus === "starting") {
      console.log(`[HealthChecker] Dev server ${sessionId} startup timeout exceeded`);

      await db
        .update(terminalSessions)
        .set({
          devServerStatus: "crashed",
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, sessionId));

      await db
        .update(devServerHealth)
        .set({
          crashedAt: new Date(),
          crashReason: "Startup timeout exceeded",
          updatedAt: new Date(),
        })
        .where(eq(devServerHealth.sessionId, sessionId));

      return true;
    }
  }
  return false;
}

/**
 * Run health checks on all active dev servers
 */
async function runHealthChecks(): Promise<void> {
  try {
    // Get all active dev server sessions
    const sessions = await db.query.terminalSessions.findMany({
      where: and(
        eq(terminalSessions.sessionType, "dev-server"),
        eq(terminalSessions.status, "active")
      ),
    });

    for (const session of sessions) {
      if (!session.devServerPort) continue;

      // Skip crashed servers
      if (session.devServerStatus === "crashed") continue;

      // Check startup timeout for servers still starting
      if (session.devServerStatus === "starting") {
        const timedOut = await checkStartupTimeout(session.id, session.createdAt);
        if (timedOut) continue;
      }

      // Perform health check
      const { isHealthy, error } = await checkServerHealth(
        session.id,
        session.devServerPort
      );

      // Collect process metrics (CPU, memory) using direct PID
      const metrics = await getProcessMetrics(session.id);

      await updateHealth(session.id, isHealthy, error, metrics);
    }
  } catch (error) {
    console.error("[HealthChecker] Error during health check cycle:", error);
  }
}

/**
 * Start the health checker background process
 */
export function startHealthChecker(): void {
  if (healthCheckInterval) {
    console.log("[HealthChecker] Already running");
    return;
  }

  console.log(`[HealthChecker] Starting with ${HEALTH_CHECK_CONFIG.intervalMs}ms interval`);

  // Run initial check after a short delay
  setTimeout(runHealthChecks, 5000);

  // Then run at regular intervals
  healthCheckInterval = setInterval(runHealthChecks, HEALTH_CHECK_CONFIG.intervalMs);
}

/**
 * Stop the health checker
 */
export function stopHealthChecker(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log("[HealthChecker] Stopped");
  }
}

/**
 * Check if health checker is running
 */
export function isHealthCheckerRunning(): boolean {
  return healthCheckInterval !== null;
}

/**
 * Manually trigger a health check (for testing)
 */
export async function triggerHealthCheck(): Promise<void> {
  await runHealthChecks();
}
