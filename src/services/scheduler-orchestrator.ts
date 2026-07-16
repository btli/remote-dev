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
import { createLogger } from "@/lib/logger";

const log = createLogger("Scheduler");

/**
 * Maximum lateness for firing a past-due one-time schedule at registration.
 * A one-time schedule whose fire time passed while the scheduler was down is
 * fired immediately if it is at most this late; otherwise it is persisted as
 * status "missed" (enabled=false) so the miss is visible instead of silently
 * rendering as armed forever.
 */
export const MISSED_FIRE_GRACE_MS = 10 * 60_000;

export type OneTimeRegistrationAction = "register" | "fire-now" | "mark-missed";

/**
 * Pure decision for what to do with a one-time schedule at registration time.
 * Factored out of registerSchedule so the grace-window logic is testable
 * without wall-clock flakiness.
 */
export function classifyOneTimeRegistration(
  scheduledAt: Date,
  now: Date,
  graceMs: number = MISSED_FIRE_GRACE_MS
): OneTimeRegistrationAction {
  const latenessMs = now.getTime() - scheduledAt.getTime();
  if (latenessMs < 0) return "register";
  return latenessMs <= graceMs ? "fire-now" : "mark-missed";
}

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
   * Schedule ids with an execution currently in flight. Guards against
   * concurrent double-injection of keystrokes for the same schedule — e.g. a
   * PATCH re-entering registration's grace-window catch-up while the fire it
   * caught up on is still executing (the row is still enabled until
   * post-execution bookkeeping lands).
   */
  private executing: Set<string> = new Set();

  /**
   * Start the orchestrator - load all enabled schedules
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn("SchedulerOrchestrator already running");
      return;
    }

    log.info("Starting SchedulerOrchestrator...");
    this.isRunning = true;

    try {
      // Load all enabled schedules from database
      const schedules = await ScheduleService.getEnabledSchedules();

      for (const schedule of schedules) {
        try {
          await this.registerSchedule(schedule);
        } catch (error) {
          log.error("Failed to register schedule", { scheduleId: schedule.id, error: String(error) });
        }
      }

      this.startupComplete = true;
      log.info("SchedulerOrchestrator started", { activeJobs: this.jobs.size });
    } catch (error) {
      log.error("Failed to start SchedulerOrchestrator", { error: String(error) });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the orchestrator - pause all jobs gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    log.info("Stopping SchedulerOrchestrator...");

    for (const job of this.jobs.values()) {
      try {
        job.cronJob.stop();
      } catch (error) {
        log.error("Error stopping job", { scheduleId: job.scheduleId, error: String(error) });
      }
    }

    this.jobs.clear();
    this.executing.clear();
    this.isRunning = false;
    this.startupComplete = false;

    log.info("SchedulerOrchestrator stopped");
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

    if (!session || session.status === "closed" || session.status === "trashed") {
      // The session's tmux is gone forever — closed, trashed (trashing kills
      // tmux too; restore never resurrects schedules), or the row is missing
      // entirely — so persist the cancellation (recurring included) instead
      // of leaving the row rendering as armed. This also self-heals orphans
      // left by close paths that bypass disableSessionSchedules (PATCH
      // {status:'closed'}, reconcile, pre-fix trashed sessions).
      log.warn("Session not found or closed for schedule; cancelling schedule", {
        sessionId: schedule.sessionId,
        scheduleId: schedule.id,
        sessionStatus: session?.status ?? "missing",
      });
      try {
        const stamped = await ScheduleService.markScheduleCancelled(schedule.id);
        if (stamped === 0) {
          // The guarded write matched nothing: the user disabled/changed the
          // row after this snapshot was read — their state wins.
          log.info("Schedule changed concurrently; skipping cancelled stamp", {
            scheduleId: schedule.id,
          });
        }
      } catch (error) {
        log.error("Failed to mark schedule cancelled", { scheduleId: schedule.id, error: String(error) });
      }
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
          log.error("One-time schedule has no scheduledAt", { scheduleId: schedule.id });
          return;
        }
        // Past-due handling: fire immediately within the grace window,
        // otherwise persist the miss so it is visible instead of silently
        // rendering as armed forever.
        const now = new Date();
        const action = classifyOneTimeRegistration(schedule.scheduledAt, now);
        if (action !== "register") {
          // Both past-due outcomes are destructive (inject keystrokes now or
          // disable the row), and start()'s boot loop classifies a snapshot
          // read before the loop began — while the notify endpoint is already
          // live, so a concurrent user PATCH may have rescheduled or disabled
          // this row in the meantime. Re-read and act on fresh data before
          // doing anything irreversible.
          const fresh = await ScheduleService.getScheduleWithCommands(
            schedule.id,
            schedule.userId
          );
          if (!fresh || !fresh.enabled || fresh.status === "completed") {
            log.info("One-time schedule disabled or gone since snapshot; skipping past-due handling", {
              scheduleId: schedule.id,
            });
            return;
          }
          if (
            fresh.scheduleType !== schedule.scheduleType ||
            !fresh.scheduledAt ||
            fresh.scheduledAt.getTime() !== schedule.scheduledAt.getTime()
          ) {
            log.info("One-time schedule changed since snapshot; re-registering from fresh data", {
              scheduleId: schedule.id,
            });
            await this.registerSchedule(fresh);
            return;
          }
          const latenessMs = now.getTime() - schedule.scheduledAt.getTime();
          if (action === "fire-now") {
            log.warn("One-time schedule past due within grace window; firing immediately", {
              scheduleId: schedule.id,
              scheduledAt: schedule.scheduledAt.toISOString(),
              latenessMs,
              graceMs: MISSED_FIRE_GRACE_MS,
            });
            // Register a PAUSED croner job keyed on the (past) scheduledAt so
            // executeJob's in-memory bookkeeping (map lookup, stop, delete)
            // stays identical to the normal path. Croner never fires a past
            // Date pattern — even if resumed — so it cannot double-fire.
            const placeholderJob = new Cron(
              schedule.scheduledAt,
              {
                timezone: schedule.timezone,
                paused: true,
                catch: (error: unknown) => {
                  log.error("Schedule cron error", { scheduleId: schedule.id, error: String(error) });
                },
              },
              async () => {
                await this.executeJob(schedule.id, tmuxSessionName, true);
              }
            );
            this.jobs.set(schedule.id, {
              scheduleId: schedule.id,
              cronJob: placeholderJob,
              scheduleData: schedule,
            });
            // Fire through the exact same execution path croner would use
            // (execution-row insert, one-time completion marking, and job
            // removal all happen inside executeJob). Fire-and-forget so a
            // slow catch-up run does not block startup registration.
            void this.executeJob(schedule.id, tmuxSessionName, true);
            return;
          }
          // action === "mark-missed"
          log.warn("One-time schedule fire time missed beyond grace window; marking missed", {
            scheduleId: schedule.id,
            scheduledAt: schedule.scheduledAt.toISOString(),
            latenessMs,
            graceMs: MISSED_FIRE_GRACE_MS,
          });
          try {
            const stamped = await ScheduleService.markScheduleMissed(
              schedule.id,
              schedule.scheduledAt
            );
            if (stamped === 0) {
              // The guarded write matched nothing: the user disabled or
              // rescheduled the row after the fresh re-read — their state wins.
              log.info("Schedule changed concurrently; skipping missed stamp", {
                scheduleId: schedule.id,
              });
            }
          } catch (error) {
            log.error("Failed to mark schedule missed", { scheduleId: schedule.id, error: String(error) });
          }
          return;
        }
        // Croner accepts Date objects for one-time scheduling
        cronPattern = schedule.scheduledAt;
        scheduleTypeLabel = `one-time at ${schedule.scheduledAt.toISOString()}`;
      } else {
        // For recurring schedules, use the cron expression
        if (!schedule.cronExpression) {
          log.error("Recurring schedule has no cronExpression", { scheduleId: schedule.id });
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
            log.error("Schedule cron error", { scheduleId: schedule.id, error: String(error) });
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
      log.info("Registered schedule", { name: schedule.name, scheduleId: schedule.id, type: scheduleTypeLabel, timezone: schedule.timezone, nextRun: nextRun?.toISOString() ?? "never" });

      // Persist the armed next fire time for recurring schedules so the row
      // never shows a stale (past) nextRunAt while a valid croner job is
      // armed. nextRunAt was previously only written at create/update/post-
      // execution, so a restart could leave it pointing into the past.
      if (
        schedule.scheduleType === "recurring" &&
        nextRun &&
        schedule.nextRunAt?.getTime() !== nextRun.getTime()
      ) {
        try {
          await ScheduleService.persistNextRunAt(schedule.id, nextRun);
          log.debug("Persisted recurring nextRunAt at registration", {
            scheduleId: schedule.id,
            previousNextRunAt: schedule.nextRunAt?.toISOString() ?? null,
            nextRunAt: nextRun.toISOString(),
          });
        } catch (error) {
          log.error("Failed to persist nextRunAt at registration", { scheduleId: schedule.id, error: String(error) });
        }
      }
    } catch (error) {
      log.error("Failed to create cron job", { scheduleId: schedule.id, error: String(error) });
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
    if (this.executing.has(scheduleId)) {
      log.warn("Skipping schedule fire: an execution is already in flight", { scheduleId });
      return;
    }

    log.info("Executing schedule", { scheduleId, isOneTime });

    const job = this.jobs.get(scheduleId);
    if (!job) {
      log.warn("Job not found in active jobs", { scheduleId });
      return;
    }

    this.executing.add(scheduleId);
    try {
      // Reload schedule data to get latest commands
      const schedule = await ScheduleService.getScheduleWithCommands(
        scheduleId,
        job.scheduleData.userId
      );

      if (!schedule || !schedule.enabled) {
        log.info("Schedule is disabled or removed; skipping fire", { scheduleId });
        this.removeJobInternal(scheduleId);
        return;
      }

      // Execute the schedule
      const execution = await ScheduleService.executeSchedule(
        schedule,
        tmuxSessionName
      );

      log.info("Schedule completed", { scheduleId, status: execution.status, successCount: execution.successCount, commandCount: execution.commandCount });

      // For one-time schedules, remove the job after execution
      // (The schedule service already marked it as completed and disabled)
      if (isOneTime) {
        this.removeJobInternal(scheduleId);
        log.info("One-time schedule removed after execution", { scheduleId });
      }

      // Note: We intentionally do NOT update the cached scheduleData here.
      // The database is the source of truth - next execution will reload fresh data.
      // This avoids race conditions with concurrent API updates.
    } catch (error) {
      log.error("Failed to execute schedule", { scheduleId, error: String(error) });

      // Still remove one-time jobs even if they failed
      if (isOneTime) {
        this.removeJobInternal(scheduleId);
        log.info("One-time schedule removed after failed execution", { scheduleId });
      }
    } finally {
      this.executing.delete(scheduleId);
    }
  }

  /**
   * Add a new job to the orchestrator (called when schedule is created)
   */
  async addJob(scheduleId: string): Promise<void> {
    if (!this.isRunning) {
      log.warn("Orchestrator not running, skipping addJob", { scheduleId });
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
      } else {
        log.warn("Schedule not registered: disabled or not found", { scheduleId });
      }
    } catch (error) {
      log.error("Failed to add job", { scheduleId, error: String(error) });
    }
  }

  /**
   * Remove a job from the orchestrator (called when schedule is deleted)
   */
  removeJob(scheduleId: string): void {
    this.removeJobInternal(scheduleId);
    log.debug("Removed job", { scheduleId });
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
        log.warn("Error stopping cron job", { scheduleId, error: String(error) });
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
      log.debug("Paused job", { scheduleId });
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
      log.debug("Resumed job", { scheduleId });
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
      log.info("Removed jobs for session", { count: toRemove.length, sessionId });
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
