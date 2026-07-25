/**
 * AgentSchedulerOrchestrator — singleton cron loop for REAL agent runs (epic
 * remote-dev-oyej.1), running in the terminal-server process alongside the
 * keystroke `SchedulerOrchestrator`.
 *
 * - Loads enabled `agentSchedules` on boot, registers a croner job per schedule.
 * - On fire: `AgentRunService.launchAgentRun({ source: "schedule", ... })` —
 *   a fresh `terminalType:"agent"` session + prompt delivery (NOT keystrokes).
 * - API routes notify it of add/update/remove via the terminal server's
 *   internal `/internal/agent-scheduler/*` endpoint (see scheduler-client.ts).
 */
import { Cron } from "croner";
import { createLogger } from "@/lib/logger";
import * as AgentScheduleService from "./agent-schedule-service";
import * as AgentRunService from "./agent-run-service";
import type { AgentScheduleRow } from "./agent-schedule-service";
import type { ScheduleType } from "@/types/schedule";

const log = createLogger("AgentScheduler");

interface ActiveJob {
  scheduleId: string;
  cronJob: Cron;
  schedule: AgentScheduleRow;
}

class AgentSchedulerOrchestrator {
  private jobs = new Map<string, ActiveJob>();
  private isRunning = false;
  private startupComplete = false;
  /**
   * Schedule ids with an execution currently in flight. Guards against
   * concurrent double-launches for the same schedule while an interval is
   * being re-registered or updated.
   */
  private executing = new Set<string>();

  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn("AgentSchedulerOrchestrator already running");
      return;
    }
    log.info("Starting AgentSchedulerOrchestrator...");
    this.isRunning = true;
    try {
      const schedules = await AgentScheduleService.getEnabledAgentSchedules();
      for (const schedule of schedules) {
        try {
          await this.registerSchedule(schedule);
        } catch (error) {
          log.error("Failed to register agent schedule", {
            scheduleId: schedule.id,
            error: String(error),
          });
        }
      }
      this.startupComplete = true;
      log.info("AgentSchedulerOrchestrator started", {
        activeJobs: this.jobs.size,
      });
    } catch (error) {
      log.error("Failed to start AgentSchedulerOrchestrator", {
        error: String(error),
      });
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    log.info("Stopping AgentSchedulerOrchestrator...");
    for (const job of this.jobs.values()) {
      try {
        job.cronJob.stop();
      } catch (error) {
        log.error("Error stopping agent job", {
          scheduleId: job.scheduleId,
          error: String(error),
        });
      }
    }
    this.jobs.clear();
    this.executing.clear();
    this.isRunning = false;
    this.startupComplete = false;
    log.info("AgentSchedulerOrchestrator stopped");
  }

  private async registerSchedule(
    schedule: AgentScheduleRow,
    completedIntervalFireAt?: Date,
  ): Promise<void> {
    if (!this.isRunning) return;
    if (!schedule.enabled) return;
    if (
      schedule.scheduleType === "one-time" &&
      schedule.status === "completed"
    ) {
      return;
    }
    this.removeJobInternal(schedule.id);

    let cronPattern: string | Date;
    let label: string;
    if (schedule.scheduleType === "one-time") {
      if (!schedule.scheduledAt) {
        log.error("One-time agent schedule has no scheduledAt", {
          scheduleId: schedule.id,
        });
        return;
      }
      if (schedule.scheduledAt <= new Date()) {
        log.warn("One-time agent schedule is in the past", {
          scheduleId: schedule.id,
        });
        return;
      }
      cronPattern = schedule.scheduledAt;
      label = `one-time at ${schedule.scheduledAt.toISOString()}`;
    } else if (schedule.scheduleType === "recurring") {
      if (!schedule.cronExpression) {
        log.error("Recurring agent schedule has no cronExpression", {
          scheduleId: schedule.id,
        });
        return;
      }
      cronPattern = schedule.cronExpression;
      label = `"${schedule.cronExpression}"`;
    } else {
      if (!schedule.anchorAt || !schedule.intervalSeconds) {
        log.error("Interval agent schedule is missing its interval or anchor", {
          scheduleId: schedule.id,
        });
        return;
      }
      const now = new Date();
      const intervalCalculationTime =
        completedIntervalFireAt &&
        completedIntervalFireAt.getTime() > now.getTime()
          ? completedIntervalFireAt
          : now;
      const nextIntervalRun =
        AgentScheduleService.calculateNextIntervalRun(
          schedule.anchorAt,
          schedule.intervalSeconds,
          intervalCalculationTime,
        );
      cronPattern = nextIntervalRun;
      label = AgentScheduleService.describeIntervalSchedule(
        schedule.intervalSeconds,
        schedule.anchorAt,
        schedule.timezone,
      );
      if (schedule.nextRunAt?.getTime() !== nextIntervalRun.getTime()) {
        try {
          await AgentScheduleService.persistNextRunAt(
            schedule.id,
            nextIntervalRun,
          );
        } catch (error) {
          log.error(
            "Failed to persist agent interval nextRunAt at registration",
            {
              scheduleId: schedule.id,
              error: String(error),
            },
          );
        }
      }
    }

    try {
      // stop() may have run while registration awaited DB/bookkeeping work.
      // Re-check immediately before constructing the Cron so it cannot leak.
      if (!this.isRunning) return;

      const cronJob = new Cron(
        cronPattern,
        {
          timezone: schedule.timezone,
          // Hold Date-based interval jobs until registration has verified
          // that their one-shot fire is still schedulable. This prevents a
          // boundary timer from racing the missed-fire recovery path.
          paused: schedule.scheduleType === "interval",
          catch: (error: unknown) => {
            log.error("Agent schedule cron error", {
              scheduleId: schedule.id,
              error: String(error),
            });
          },
        },
        async () => {
          await this.executeJob(schedule.id, schedule.scheduleType);
        },
      );
      this.jobs.get(schedule.id)?.cronJob.stop();
      this.jobs.set(schedule.id, {
        scheduleId: schedule.id,
        cronJob,
        schedule:
          schedule.scheduleType === "interval" &&
          cronPattern instanceof Date
            ? { ...schedule, nextRunAt: cronPattern }
            : schedule,
      });

      let nextRun = cronJob.nextRun();
      if (schedule.scheduleType === "interval" && nextRun) {
        cronJob.resume();
        // The Date can cross while resuming; use Croner's post-resume view to
        // decide whether the normal callback or recovery owns this occurrence.
        nextRun = cronJob.nextRun();
      }
      log.info("Registered agent schedule", {
        name: schedule.name,
        scheduleId: schedule.id,
        type: label,
        timezone: schedule.timezone,
        nextRun: nextRun?.toISOString() ?? "never",
      });

      // A Date-based interval fire can pass while registration awaits DB
      // bookkeeping. Croner does not fire past Date patterns, so recover the
      // just-missed occurrence through the normal execution path; its finally
      // block will calculate and register the next interval occurrence.
      if (schedule.scheduleType === "interval" && !nextRun) {
        // Cancel any timer Croner queued while the Date crossed its boundary;
        // recovery below owns this occurrence and must not race a late callback.
        cronJob.stop();
        log.warn(
          "Interval fire passed during registration; executing immediately",
          {
            scheduleId: schedule.id,
            fireAt:
              cronPattern instanceof Date
                ? cronPattern.toISOString()
                : null,
          },
        );
        void this.executeJob(schedule.id, "interval");
      }
    } catch (error) {
      log.error("Failed to create agent cron job", {
        scheduleId: schedule.id,
        error: String(error),
      });
    }
  }

  private async executeJob(
    scheduleId: string,
    scheduleType: ScheduleType = "recurring",
  ): Promise<void> {
    if (this.executing.has(scheduleId)) {
      log.warn("Skipping agent schedule fire: an execution is already in flight", {
        scheduleId,
      });
      return;
    }

    const job = this.jobs.get(scheduleId);
    if (!job) {
      log.warn("Agent job not found in active jobs", { scheduleId });
      return;
    }

    this.executing.add(scheduleId);
    // Reload to honor disable/edit between registration and fire.
    try {
      const schedule = await AgentScheduleService.getAgentSchedule(
        job.schedule.userId,
        scheduleId,
      );
      if (!schedule || !schedule.enabled) {
        log.debug("Agent schedule disabled or removed; skipping", {
          scheduleId,
        });
        this.removeJobInternal(scheduleId);
        return;
      }

      log.info("Executing agent schedule", { scheduleId, scheduleType });
      await AgentRunService.launchAgentRun({
        userId: schedule.userId,
        projectId: schedule.projectId,
        source: "schedule",
        scheduleId: schedule.id,
        agentProvider: schedule.agentProvider,
        agentFlags: JSON.parse(schedule.agentFlags) as string[],
        prompt: schedule.prompt,
        worktreeType: schedule.worktreeType,
        baseBranch: schedule.baseBranch,
        profileId: schedule.profileId,
      });
      await AgentScheduleService.markScheduleFired(scheduleId);

      if (scheduleType === "one-time") {
        this.removeJobInternal(scheduleId);
      }
    } catch (error) {
      log.error("Failed to execute agent schedule", {
        scheduleId,
        error: String(error),
      });

      if (scheduleType === "one-time") {
        this.removeJobInternal(scheduleId);
      }
    } finally {
      this.executing.delete(scheduleId);
      if (scheduleType === "interval" && this.isRunning) {
        try {
          const refreshed = await AgentScheduleService.getAgentSchedule(
            job.schedule.userId,
            scheduleId,
          );
          if (
            this.isRunning &&
            refreshed?.enabled &&
            refreshed.scheduleType === "interval"
          ) {
            await this.registerSchedule(
              refreshed,
              job.schedule.nextRunAt ?? undefined,
            );
            log.debug(
              "Re-registered agent interval schedule after execution",
              { scheduleId },
            );
          } else {
            this.removeJobInternal(scheduleId);
          }
        } catch (error) {
          log.error("Failed to re-register agent interval schedule", {
            scheduleId,
            error: String(error),
          });
          this.removeJobInternal(scheduleId);
        }
      }
    }
  }

  async addJob(scheduleId: string): Promise<void> {
    if (!this.isRunning) {
      log.warn("Agent orchestrator not running, skipping addJob", {
        scheduleId,
      });
      return;
    }
    const schedules = await AgentScheduleService.getEnabledAgentSchedules();
    const schedule = schedules.find((s) => s.id === scheduleId);
    if (schedule) await this.registerSchedule(schedule);
  }

  removeJob(scheduleId: string): void {
    this.removeJobInternal(scheduleId);
    log.debug("Removed agent job", { scheduleId });
  }

  async updateJob(scheduleId: string): Promise<void> {
    if (!this.isRunning) return;
    this.removeJobInternal(scheduleId);
    await this.addJob(scheduleId);
  }

  private removeJobInternal(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      try {
        job.cronJob.stop();
      } catch (error) {
        log.warn("Error stopping agent cron job", {
          scheduleId,
          error: String(error),
        });
      }
      this.jobs.delete(scheduleId);
    }
  }

  isStarted(): boolean {
    return this.isRunning && this.startupComplete;
  }

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
  }> {
    return Array.from(this.jobs.values()).map((job) => ({
      scheduleId: job.scheduleId,
      name: job.schedule.name,
      scheduleType: job.schedule.scheduleType,
      cronExpression: job.schedule.cronExpression,
      scheduledAt: job.schedule.scheduledAt,
      isRunning: job.cronJob.isBusy(),
      isPaused: !job.cronJob.isRunning(),
      nextRun: job.cronJob.nextRun() ?? job.schedule.nextRunAt,
      lastRun: job.schedule.lastRunAt,
    }));
  }

  getJobCount(): number {
    return this.jobs.size;
  }
}

export const agentSchedulerOrchestrator = new AgentSchedulerOrchestrator();
