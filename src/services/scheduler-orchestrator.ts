/**
 * SchedulerOrchestrator - Singleton service managing all active cron jobs
 *
 * This service runs in the terminal server process and:
 * - Loads enabled schedules from the database on startup
 * - Registers cron jobs using croner
 * - Handles schedule lifecycle (add, remove, pause, resume)
 * - Provides graceful shutdown
 *
 * Integration:
 * - Started in src/server/index.ts on terminal server boot
 * - API routes notify orchestrator of schedule changes
 */
import { Cron } from "croner";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as ScheduleService from "./schedule-service";
import type { SessionScheduleWithCommands } from "@/types/schedule";

interface ActiveJob {
  scheduleId: string;
  cronJob: Cron;
  scheduleData: SessionScheduleWithCommands;
}

class SchedulerOrchestrator {
  private jobs: Map<string, ActiveJob> = new Map();
  private isRunning = false;
  private startupComplete = false;

  /**
   * Start the orchestrator - load all enabled schedules
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("[Scheduler] SchedulerOrchestrator already running");
      return;
    }

    console.log("[Scheduler] Starting SchedulerOrchestrator...");
    this.isRunning = true;

    try {
      // Load all enabled schedules from database
      const schedules = await ScheduleService.getEnabledSchedules();

      for (const schedule of schedules) {
        try {
          await this.registerSchedule(schedule);
        } catch (error) {
          console.error(
            `[Scheduler] Failed to register schedule ${schedule.id}:`,
            error
          );
        }
      }

      this.startupComplete = true;
      console.log(
        `[Scheduler] SchedulerOrchestrator started with ${this.jobs.size} active jobs`
      );
    } catch (error) {
      console.error("[Scheduler] Failed to start SchedulerOrchestrator:", error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the orchestrator - pause all jobs gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("[Scheduler] Stopping SchedulerOrchestrator...");

    for (const job of this.jobs.values()) {
      try {
        job.cronJob.stop();
      } catch (error) {
        console.error(
          `[Scheduler] Error stopping job ${job.scheduleId}:`,
          error
        );
      }
    }

    this.jobs.clear();
    this.isRunning = false;
    this.startupComplete = false;

    console.log("[Scheduler] SchedulerOrchestrator stopped");
  }

  /**
   * Register a schedule with croner
   */
  private async registerSchedule(
    schedule: SessionScheduleWithCommands
  ): Promise<void> {
    // Skip if not enabled
    if (!schedule.enabled) {
      return;
    }

    // Skip completed one-time schedules
    if (schedule.scheduleType === "one-time" && schedule.status === "completed") {
      return;
    }

    // Remove existing job if present
    this.removeJobInternal(schedule.id);

    // Verify the session exists and get tmux session name
    const session = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, schedule.sessionId),
    });

    if (!session || session.status === "closed") {
      console.warn(
        `[Scheduler] Session ${schedule.sessionId} not found or closed for schedule ${schedule.id}`
      );
      return;
    }

    const tmuxSessionName = session.tmuxSessionName;

    try {
      // Determine cron pattern based on schedule type
      let cronPattern: string | Date;
      let scheduleTypeLabel: string;

      if (schedule.scheduleType === "one-time") {
        // For one-time schedules, use the scheduledAt timestamp
        if (!schedule.scheduledAt) {
          console.error(
            `[Scheduler] One-time schedule ${schedule.id} has no scheduledAt`
          );
          return;
        }
        // Check if the scheduled time is in the past
        if (schedule.scheduledAt <= new Date()) {
          console.warn(
            `[Scheduler] One-time schedule ${schedule.id} scheduled time is in the past`
          );
          return;
        }
        // Croner accepts Date objects for one-time scheduling
        cronPattern = schedule.scheduledAt;
        scheduleTypeLabel = `one-time at ${schedule.scheduledAt.toISOString()}`;
      } else {
        // For recurring schedules, use the cron expression
        if (!schedule.cronExpression) {
          console.error(
            `[Scheduler] Recurring schedule ${schedule.id} has no cronExpression`
          );
          return;
        }
        cronPattern = schedule.cronExpression;
        scheduleTypeLabel = `"${schedule.cronExpression}"`;
      }

      // Create cron job
      const cronJob = new Cron(
        cronPattern,
        {
          timezone: schedule.timezone,
          catch: (error: unknown) => {
            console.error(
              `[Scheduler] Schedule ${schedule.id} cron error:`,
              error
            );
          },
        },
        async () => {
          await this.executeJob(schedule.id, tmuxSessionName, schedule.scheduleType === "one-time");
        }
      );

      this.jobs.set(schedule.id, {
        scheduleId: schedule.id,
        cronJob,
        scheduleData: schedule,
      });

      const nextRun = cronJob.nextRun();
      console.log(
        `[Scheduler] Registered: ${schedule.name} (${schedule.id}) - ` +
          `${scheduleTypeLabel} ${schedule.timezone} - ` +
          `Next run: ${nextRun?.toISOString() ?? "never"}`
      );
    } catch (error) {
      console.error(
        `[Scheduler] Failed to create cron job for schedule ${schedule.id}:`,
        error
      );
    }
  }

  /**
   * Execute a job
   */
  private async executeJob(
    scheduleId: string,
    tmuxSessionName: string,
    isOneTime = false
  ): Promise<void> {
    console.log(`[Scheduler] Executing ${isOneTime ? "one-time " : ""}schedule ${scheduleId}...`);

    const job = this.jobs.get(scheduleId);
    if (!job) {
      console.warn(`[Scheduler] Job ${scheduleId} not found in active jobs`);
      return;
    }

    try {
      // Reload schedule data to get latest commands
      const schedule = await ScheduleService.getScheduleWithCommands(
        scheduleId,
        job.scheduleData.userId
      );

      if (!schedule || !schedule.enabled) {
        console.log(`[Scheduler] Schedule ${scheduleId} is disabled or removed`);
        this.removeJobInternal(scheduleId);
        return;
      }

      // Execute the schedule
      const execution = await ScheduleService.executeSchedule(
        schedule,
        tmuxSessionName
      );

      console.log(
        `[Scheduler] Schedule ${scheduleId} completed: ${execution.status} ` +
          `(${execution.successCount}/${execution.commandCount} commands succeeded)`
      );

      // For one-time schedules, remove the job after execution
      // (The schedule service already marked it as completed and disabled)
      if (isOneTime) {
        this.removeJobInternal(scheduleId);
        console.log(`[Scheduler] One-time schedule ${scheduleId} removed after execution`);
      }

      // Note: We intentionally do NOT update the cached scheduleData here.
      // The database is the source of truth - next execution will reload fresh data.
      // This avoids race conditions with concurrent API updates.
    } catch (error) {
      console.error(`[Scheduler] Failed to execute schedule ${scheduleId}:`, error);

      // Still remove one-time jobs even if they failed
      if (isOneTime) {
        this.removeJobInternal(scheduleId);
        console.log(`[Scheduler] One-time schedule ${scheduleId} removed after failed execution`);
      }
    }
  }

  /**
   * Add a new job to the orchestrator (called when schedule is created)
   */
  async addJob(scheduleId: string): Promise<void> {
    if (!this.isRunning) {
      console.warn(
        "[Scheduler] Orchestrator not running, skipping addJob for",
        scheduleId
      );
      return;
    }

    try {
      // Fetch schedule without userId context since this is called from API routes
      // where we've already validated ownership. getEnabledSchedules() returns all
      // enabled schedules - this is safe because registerSchedule validates the
      // session exists and adds proper error handling.
      const schedules = await ScheduleService.getEnabledSchedules();
      const schedule = schedules.find((s) => s.id === scheduleId);

      if (schedule) {
        await this.registerSchedule(schedule);
      }
    } catch (error) {
      console.error(`[Scheduler] Failed to add job ${scheduleId}:`, error);
    }
  }

  /**
   * Remove a job from the orchestrator (called when schedule is deleted)
   */
  removeJob(scheduleId: string): void {
    this.removeJobInternal(scheduleId);
    console.log(`[Scheduler] Removed job: ${scheduleId}`);
  }

  /**
   * Internal remove without logging
   */
  private removeJobInternal(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      try {
        job.cronJob.stop();
      } catch (error) {
        // Log but don't propagate - we still want to clean up
        console.warn(`[Scheduler] Error stopping cron job ${scheduleId}:`, error);
      }
      this.jobs.delete(scheduleId);
    }
  }

  /**
   * Update a job (called when schedule is modified)
   */
  async updateJob(scheduleId: string): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Remove and re-add
    this.removeJobInternal(scheduleId);
    await this.addJob(scheduleId);
  }

  /**
   * Pause a job (called when schedule is disabled)
   *
   * Note: pause() stops the cron from triggering but keeps the job registered.
   * Use this for temporary disabling. Use removeJob() for permanent removal.
   */
  pauseJob(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.cronJob.pause();
      console.log(`[Scheduler] Paused job: ${scheduleId}`);
    }
  }

  /**
   * Resume a job (called when schedule is enabled)
   *
   * Note: resume() restarts a paused cron job. Only works on jobs that were
   * paused with pauseJob(). If the job was removed, use addJob() instead.
   */
  resumeJob(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.cronJob.resume();
      console.log(`[Scheduler] Resumed job: ${scheduleId}`);
    }
  }

  /**
   * Remove all jobs for a session (called when session is closed)
   *
   * INTEGRATION: This must be called from SessionService when a session is
   * closed or deleted to ensure orphaned cron jobs are cleaned up.
   * See: src/app/api/sessions/[id]/route.ts DELETE handler
   */
  removeSessionJobs(sessionId: string): void {
    const toRemove: string[] = [];

    for (const job of this.jobs.values()) {
      if (job.scheduleData.sessionId === sessionId) {
        toRemove.push(job.scheduleId);
      }
    }

    for (const scheduleId of toRemove) {
      this.removeJobInternal(scheduleId);
    }

    if (toRemove.length > 0) {
      console.log(
        `[Scheduler] Removed ${toRemove.length} jobs for session ${sessionId}`
      );
    }
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Array<{
    scheduleId: string;
    name: string;
    scheduleType: string;
    cronExpression: string | null;
    scheduledAt: Date | null;
    isRunning: boolean;
    isPaused: boolean;
    nextRun: Date | null;
    lastRun: Date | null;
    lastStatus: string | null;
  }> {
    return Array.from(this.jobs.values()).map((job) => ({
      scheduleId: job.scheduleId,
      name: job.scheduleData.name,
      scheduleType: job.scheduleData.scheduleType,
      cronExpression: job.scheduleData.cronExpression,
      scheduledAt: job.scheduleData.scheduledAt,
      isRunning: job.cronJob.isBusy(),
      isPaused: !job.cronJob.isRunning(),
      nextRun: job.cronJob.nextRun(),
      lastRun: job.scheduleData.lastRunAt,
      lastStatus: job.scheduleData.lastRunStatus,
    }));
  }

  /**
   * Check if orchestrator is running
   */
  isStarted(): boolean {
    return this.isRunning && this.startupComplete;
  }

  /**
   * Get count of active jobs
   */
  getJobCount(): number {
    return this.jobs.size;
  }
}

// Export singleton instance
export const schedulerOrchestrator = new SchedulerOrchestrator();
