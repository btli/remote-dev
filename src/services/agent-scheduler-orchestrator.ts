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
          this.registerSchedule(schedule);
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
    this.isRunning = false;
    this.startupComplete = false;
    log.info("AgentSchedulerOrchestrator stopped");
  }

  private registerSchedule(schedule: AgentScheduleRow): void {
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
    } else {
      if (!schedule.cronExpression) {
        log.error("Recurring agent schedule has no cronExpression", {
          scheduleId: schedule.id,
        });
        return;
      }
      cronPattern = schedule.cronExpression;
      label = `"${schedule.cronExpression}"`;
    }

    try {
      const cronJob = new Cron(
        cronPattern,
        {
          timezone: schedule.timezone,
          catch: (error: unknown) => {
            log.error("Agent schedule cron error", {
              scheduleId: schedule.id,
              error: String(error),
            });
          },
        },
        () => {
          void this.executeJob(schedule.id);
        },
      );
      this.jobs.set(schedule.id, {
        scheduleId: schedule.id,
        cronJob,
        schedule,
      });
      log.info("Registered agent schedule", {
        name: schedule.name,
        scheduleId: schedule.id,
        type: label,
        timezone: schedule.timezone,
        nextRun: cronJob.nextRun()?.toISOString() ?? "never",
      });
    } catch (error) {
      log.error("Failed to create agent cron job", {
        scheduleId: schedule.id,
        error: String(error),
      });
    }
  }

  private async executeJob(scheduleId: string): Promise<void> {
    const job = this.jobs.get(scheduleId);
    if (!job) {
      log.warn("Agent job not found in active jobs", { scheduleId });
      return;
    }
    // Reload to honor disable/edit between registration and fire.
    const schedule = await AgentScheduleService.getAgentSchedule(
      job.schedule.userId,
      scheduleId,
    );
    if (!schedule || !schedule.enabled) {
      log.debug("Agent schedule disabled or removed; skipping", { scheduleId });
      this.removeJobInternal(scheduleId);
      return;
    }

    log.info("Executing agent schedule", { scheduleId });
    try {
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
    } catch (error) {
      log.error("Failed to execute agent schedule", {
        scheduleId,
        error: String(error),
      });
    } finally {
      if (schedule.scheduleType === "one-time") {
        this.removeJobInternal(scheduleId);
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
    if (schedule) this.registerSchedule(schedule);
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

  getJobCount(): number {
    return this.jobs.size;
  }
}

export const agentSchedulerOrchestrator = new AgentSchedulerOrchestrator();
