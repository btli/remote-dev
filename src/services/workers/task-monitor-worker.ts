/**
 * TaskMonitorWorker - Background worker for monitoring task delegations.
 *
 * Monitors:
 * - Active delegations (executing/monitoring status)
 * - Session scrollback for progress analysis
 * - Stalled or failed delegations
 *
 * Features:
 * - Configurable polling interval (default: 10s)
 * - Concurrency limit (default: 10 concurrent monitors)
 * - Exponential backoff on failures
 * - Memory-efficient scrollback sampling
 */

import { db } from "@/db";
import { delegations, tasks, terminalSessions, type DelegationStatusType } from "@/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import type { Worker } from "./worker-manager";
import * as TmuxService from "@/services/tmux-service";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

interface TaskMonitorConfig {
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Maximum concurrent delegation monitors */
  maxConcurrent: number;
  /** Maximum retries before giving up on a delegation */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  backoffBaseMs: number;
  /** Maximum backoff delay (ms) */
  backoffMaxMs: number;
}

const DEFAULT_CONFIG: TaskMonitorConfig = {
  intervalMs: 10000, // 10 seconds
  maxConcurrent: 10,
  maxRetries: 5,
  backoffBaseMs: 1000,
  backoffMaxMs: 60000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Worker State
// ─────────────────────────────────────────────────────────────────────────────

interface DelegationMonitorState {
  delegationId: string;
  retryCount: number;
  lastChecked: Date;
  lastError: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Monitor Worker
// ─────────────────────────────────────────────────────────────────────────────

export class TaskMonitorWorker implements Worker {
  readonly name = "task-monitor";
  private config: TaskMonitorConfig;
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private delegationStates: Map<string, DelegationMonitorState> = new Map();

  constructor(config: Partial<TaskMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn("[TaskMonitorWorker] Already running");
      return;
    }

    console.log(
      `[TaskMonitorWorker] Starting with interval ${this.config.intervalMs}ms, max concurrent ${this.config.maxConcurrent}`
    );

    this.running = true;

    // Run immediately then on interval
    await this.runCycle();

    this.interval = setInterval(async () => {
      if (!this.processing) {
        await this.runCycle();
      }
    }, this.config.intervalMs);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log("[TaskMonitorWorker] Stopping...");

    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Wait for current processing to complete (with timeout)
    const timeout = 30000;
    const start = Date.now();
    while (this.processing && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Clear state
    this.delegationStates.clear();

    console.log("[TaskMonitorWorker] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run a monitoring cycle.
   */
  private async runCycle(): Promise<void> {
    if (!this.running) return;

    this.processing = true;

    try {
      // Find active delegations
      const activeDelegations = await this.findActiveDelegations();

      if (activeDelegations.length === 0) {
        this.processing = false;
        return;
      }

      // Limit concurrent processing
      const toProcess = activeDelegations.slice(0, this.config.maxConcurrent);

      // Monitor each delegation
      const results = await Promise.allSettled(
        toProcess.map((d) => this.monitorDelegation(d))
      );

      // Log any errors
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
          const delegation = toProcess[i];
          console.error(
            `[TaskMonitorWorker] Error monitoring delegation ${delegation.id}:`,
            result.reason
          );
          this.recordError(delegation.id, String(result.reason));
        }
      }

      // Cleanup old states for completed delegations
      this.cleanupStates(activeDelegations.map((d) => d.id));
    } catch (error) {
      console.error("[TaskMonitorWorker] Cycle error:", error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Find all active delegations that need monitoring.
   */
  private async findActiveDelegations(): Promise<
    Array<{
      id: string;
      taskId: string;
      sessionId: string;
      status: string;
      agentProvider: string;
    }>
  > {
    const activeStatuses: DelegationStatusType[] = ["running", "monitoring"];

    const results = await db
      .select({
        id: delegations.id,
        taskId: delegations.taskId,
        sessionId: delegations.sessionId,
        status: delegations.status,
        agentProvider: delegations.agentProvider,
      })
      .from(delegations)
      .where(inArray(delegations.status, activeStatuses))
      .orderBy(desc(delegations.createdAt))
      .limit(this.config.maxConcurrent * 2); // Get extra in case some are filtered

    return results as Array<{
      id: string;
      taskId: string;
      sessionId: string;
      status: string;
      agentProvider: string;
    }>;
  }

  /**
   * Monitor a single delegation.
   */
  private async monitorDelegation(delegation: {
    id: string;
    taskId: string;
    sessionId: string;
    status: string;
    agentProvider: string;
  }): Promise<void> {
    // Check backoff
    const state = this.delegationStates.get(delegation.id);
    if (state && this.shouldBackoff(state)) {
      return;
    }

    // Get session info
    const sessionResult = await db
      .select({
        tmuxSessionName: terminalSessions.tmuxSessionName,
        status: terminalSessions.status,
      })
      .from(terminalSessions)
      .where(eq(terminalSessions.id, delegation.sessionId))
      .limit(1);

    if (sessionResult.length === 0) {
      // Session not found - mark delegation as failed
      await this.failDelegation(delegation.id, "SESSION_NOT_FOUND", "Session was deleted");
      return;
    }

    const session = sessionResult[0];

    // Check if session is still active
    if (session.status !== "active") {
      // Session closed - delegation is complete or failed
      await this.handleClosedSession(delegation, session.status);
      return;
    }

    // Check if tmux session exists
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
    if (!tmuxExists) {
      await this.failDelegation(
        delegation.id,
        "TMUX_SESSION_GONE",
        "Tmux session no longer exists"
      );
      return;
    }

    // Get scrollback for analysis (captures visible pane content)
    const scrollback = await this.getScrollback(session.tmuxSessionName);

    // Analyze scrollback for completion signals
    const analysis = this.analyzeScrollback(scrollback, delegation.agentProvider);

    // Update delegation based on analysis
    await this.updateDelegationFromAnalysis(delegation.id, analysis);

    // Record successful check
    this.recordSuccess(delegation.id);
  }

  /**
   * Get scrollback from a tmux session.
   * Note: capturePane captures the visible pane content.
   */
  private async getScrollback(tmuxSessionName: string): Promise<string> {
    try {
      const scrollback = await TmuxService.capturePane(tmuxSessionName);
      return scrollback;
    } catch {
      return "";
    }
  }

  /**
   * Analyze scrollback for task completion signals.
   */
  private analyzeScrollback(
    scrollback: string,
    agentProvider: string
  ): {
    status: "running" | "completed" | "failed" | "unknown";
    exitCode: number | null;
    summary: string;
  } {
    // Look for common completion patterns
    const lines = scrollback.split("\n").filter((l) => l.trim());

    // Check for explicit exit codes
    const exitMatch = scrollback.match(/exit (\d+)/i);
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;

    // Check for Claude Code completion
    if (agentProvider === "claude") {
      if (scrollback.includes("Task completed") || scrollback.includes("Done!")) {
        return { status: "completed", exitCode, summary: "Task completed successfully" };
      }
      if (scrollback.includes("Error:") || scrollback.includes("Failed:")) {
        return { status: "failed", exitCode, summary: "Task failed with error" };
      }
    }

    // Check for Codex completion
    if (agentProvider === "codex") {
      if (scrollback.includes("✓") && !scrollback.includes("✗")) {
        return { status: "completed", exitCode, summary: "Task completed" };
      }
    }

    // Check for common shell prompts indicating idle state
    const lastLine = lines[lines.length - 1] || "";
    if (lastLine.match(/[>$#]\s*$/) && lines.length < 10) {
      // Looks like an idle prompt with minimal output
      return { status: "unknown", exitCode: null, summary: "Session appears idle" };
    }

    return { status: "running", exitCode: null, summary: "Task in progress" };
  }

  /**
   * Update delegation based on scrollback analysis.
   */
  private async updateDelegationFromAnalysis(
    delegationId: string,
    analysis: { status: string; exitCode: number | null; summary: string }
  ): Promise<void> {
    if (analysis.status === "completed") {
      // TODO: Update delegation to completed via repository
      console.log(`[TaskMonitorWorker] Delegation ${delegationId} appears completed`);
    } else if (analysis.status === "failed") {
      // TODO: Update delegation to failed via repository
      console.log(`[TaskMonitorWorker] Delegation ${delegationId} appears failed`);
    }
    // For "running" and "unknown", no update needed
  }

  /**
   * Handle a delegation whose session was closed.
   */
  private async handleClosedSession(
    delegation: { id: string; taskId: string },
    sessionStatus: string
  ): Promise<void> {
    if (sessionStatus === "closed") {
      // Session was closed normally - assume success unless error found
      console.log(
        `[TaskMonitorWorker] Delegation ${delegation.id} session closed, assuming completion`
      );
      // TODO: Mark as completed
    } else {
      // Session in unexpected state
      await this.failDelegation(
        delegation.id,
        "SESSION_CLOSED",
        `Session status: ${sessionStatus}`
      );
    }
  }

  /**
   * Mark a delegation as failed.
   */
  private async failDelegation(
    delegationId: string,
    code: string,
    message: string
  ): Promise<void> {
    console.log(`[TaskMonitorWorker] Failing delegation ${delegationId}: ${code} - ${message}`);

    await db
      .update(delegations)
      .set({
        status: "failed" as DelegationStatusType,
        errorJson: JSON.stringify({ code, message, exitCode: null, recoverable: false }),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(delegations.id, delegationId));

    // Also update the associated task
    const delegationResult = await db
      .select({ taskId: delegations.taskId })
      .from(delegations)
      .where(eq(delegations.id, delegationId))
      .limit(1);

    if (delegationResult.length > 0) {
      await db
        .update(tasks)
        .set({
          status: "failed",
          errorJson: JSON.stringify({ code, message, recoverable: false }),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, delegationResult[0].taskId));
    }
  }

  /**
   * Check if we should backoff on this delegation.
   */
  private shouldBackoff(state: DelegationMonitorState): boolean {
    if (state.retryCount === 0) return false;
    if (state.retryCount >= this.config.maxRetries) return true;

    const delay = Math.min(
      this.config.backoffBaseMs * Math.pow(2, state.retryCount - 1),
      this.config.backoffMaxMs
    );

    const timeSinceLastCheck = Date.now() - state.lastChecked.getTime();
    return timeSinceLastCheck < delay;
  }

  /**
   * Record a successful check.
   */
  private recordSuccess(delegationId: string): void {
    this.delegationStates.set(delegationId, {
      delegationId,
      retryCount: 0,
      lastChecked: new Date(),
      lastError: null,
    });
  }

  /**
   * Record an error.
   */
  private recordError(delegationId: string, error: string): void {
    const existing = this.delegationStates.get(delegationId);
    this.delegationStates.set(delegationId, {
      delegationId,
      retryCount: (existing?.retryCount ?? 0) + 1,
      lastChecked: new Date(),
      lastError: error,
    });
  }

  /**
   * Cleanup states for delegations that are no longer active.
   */
  private cleanupStates(activeDelegationIds: string[]): void {
    const activeSet = new Set(activeDelegationIds);
    for (const id of this.delegationStates.keys()) {
      if (!activeSet.has(id)) {
        this.delegationStates.delete(id);
      }
    }
  }
}

/**
 * Create a task monitor worker instance.
 */
export function createTaskMonitorWorker(
  config?: Partial<TaskMonitorConfig>
): TaskMonitorWorker {
  return new TaskMonitorWorker(config);
}
