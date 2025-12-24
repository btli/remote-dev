/**
 * ScheduleService - Manages scheduled command execution for terminal sessions
 *
 * This service handles:
 * - CRUD operations for schedules and commands
 * - Cron expression validation and next run calculation
 * - Execution tracking and history
 * - Integration with TmuxService for command execution
 */
import { db } from "@/db";
import {
  sessionSchedules,
  scheduleCommands,
  scheduleExecutions,
  commandExecutions,
  terminalSessions,
} from "@/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { Cron } from "croner";
import { ScheduleServiceError } from "@/lib/errors";
import * as TmuxService from "./tmux-service";
import type {
  SessionSchedule,
  SessionScheduleWithSession,
  SessionScheduleWithCommands,
  ScheduleCommand,
  ScheduleExecution,
  ScheduleExecutionWithCommands,
  CommandExecution,
  CreateScheduleInput,
  UpdateScheduleInput,
  ScheduleCommandInput,
  ExecutionStatus,
  ScheduleStatus,
} from "@/types/schedule";

// Re-export error class for API routes
export { ScheduleServiceError };

// =============================================================================
// Cron Utilities
// =============================================================================

/**
 * Validate a cron expression with timezone
 */
export function validateCronExpression(
  expression: string,
  timezone: string
): boolean {
  try {
    new Cron(expression, { timezone, paused: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate the next run time for a cron expression
 */
export function calculateNextRun(
  expression: string,
  timezone: string
): Date | null {
  try {
    const job = new Cron(expression, { timezone, paused: true });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return null;
  }
}

/**
 * Get human-readable description of cron expression
 */
export function describeCronExpression(expression: string): string {
  // Simple descriptions for common patterns
  const patterns: Record<string, string> = {
    "* * * * *": "Every minute",
    "*/5 * * * *": "Every 5 minutes",
    "*/15 * * * *": "Every 15 minutes",
    "0 * * * *": "Every hour",
    "0 0 * * *": "Daily at midnight",
    "0 9 * * *": "Daily at 9:00 AM",
    "0 9 * * 1-5": "Weekdays at 9:00 AM",
    "0 0 * * 0": "Weekly on Sunday",
    "0 0 1 * *": "Monthly on the 1st",
  };

  return patterns[expression] || expression;
}

// =============================================================================
// Schedule CRUD Operations
// =============================================================================

/**
 * Create a new schedule with commands
 */
export async function createSchedule(
  userId: string,
  input: CreateScheduleInput
): Promise<SessionScheduleWithCommands> {
  // Validate cron expression
  const timezone = input.timezone || "America/Los_Angeles";
  if (!validateCronExpression(input.cronExpression, timezone)) {
    throw new ScheduleServiceError(
      "Invalid cron expression or timezone",
      "INVALID_CRON_EXPRESSION"
    );
  }

  // Validate session ownership
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, input.sessionId),
      eq(terminalSessions.userId, userId)
    ),
  });

  if (!session) {
    throw new ScheduleServiceError("Session not found", "SESSION_NOT_FOUND");
  }

  // Validate commands
  if (!input.commands || input.commands.length === 0) {
    throw new ScheduleServiceError(
      "At least one command is required",
      "COMMANDS_REQUIRED"
    );
  }

  const scheduleId = crypto.randomUUID();
  const now = new Date();
  const nextRunAt = calculateNextRun(input.cronExpression, timezone);

  // Insert schedule
  const [schedule] = await db
    .insert(sessionSchedules)
    .values({
      id: scheduleId,
      userId,
      sessionId: input.sessionId,
      name: input.name,
      cronExpression: input.cronExpression,
      timezone,
      enabled: input.enabled ?? true,
      status: "active",
      maxRetries: input.maxRetries ?? 0,
      retryDelaySeconds: input.retryDelaySeconds ?? 60,
      timeoutSeconds: input.timeoutSeconds ?? 300,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Insert commands
  const commandRecords = await db
    .insert(scheduleCommands)
    .values(
      input.commands.map((cmd, index) => ({
        id: crypto.randomUUID(),
        scheduleId,
        command: cmd.command,
        order: index,
        delayBeforeSeconds: cmd.delayBeforeSeconds ?? 0,
        continueOnError: cmd.continueOnError ?? false,
        createdAt: now,
      }))
    )
    .returning();

  return {
    ...mapDbScheduleToSchedule(schedule),
    commands: commandRecords.map(mapDbCommandToCommand),
  };
}

/**
 * Get a schedule by ID
 */
export async function getSchedule(
  scheduleId: string,
  userId: string
): Promise<SessionSchedule | null> {
  const schedule = await db.query.sessionSchedules.findFirst({
    where: and(
      eq(sessionSchedules.id, scheduleId),
      eq(sessionSchedules.userId, userId)
    ),
  });

  return schedule ? mapDbScheduleToSchedule(schedule) : null;
}

/**
 * Get a schedule with its commands
 */
export async function getScheduleWithCommands(
  scheduleId: string,
  userId: string
): Promise<SessionScheduleWithCommands | null> {
  const schedule = await db.query.sessionSchedules.findFirst({
    where: and(
      eq(sessionSchedules.id, scheduleId),
      eq(sessionSchedules.userId, userId)
    ),
  });

  if (!schedule) return null;

  const commands = await db.query.scheduleCommands.findMany({
    where: eq(scheduleCommands.scheduleId, scheduleId),
    orderBy: [asc(scheduleCommands.order)],
  });

  return {
    ...mapDbScheduleToSchedule(schedule),
    commands: commands.map(mapDbCommandToCommand),
  };
}

/**
 * List all schedules for a user
 */
export async function listSchedules(
  userId: string,
  sessionId?: string
): Promise<SessionScheduleWithSession[]> {
  const schedules = await db.query.sessionSchedules.findMany({
    where: sessionId
      ? and(
          eq(sessionSchedules.userId, userId),
          eq(sessionSchedules.sessionId, sessionId)
        )
      : eq(sessionSchedules.userId, userId),
    orderBy: [desc(sessionSchedules.createdAt)],
  });

  // Fetch session info for each schedule
  const sessionIds = [...new Set(schedules.map((s) => s.sessionId))];
  const sessions = await db.query.terminalSessions.findMany({
    where: sql`${terminalSessions.id} IN ${sessionIds}`,
  });

  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  return schedules.map((schedule) => {
    const session = sessionMap.get(schedule.sessionId);
    return {
      ...mapDbScheduleToSchedule(schedule),
      session: session
        ? {
            id: session.id,
            name: session.name,
            status: session.status,
            tmuxSessionName: session.tmuxSessionName,
          }
        : {
            id: schedule.sessionId,
            name: "Unknown Session",
            status: "closed",
            tmuxSessionName: "",
          },
    };
  });
}

/**
 * Update a schedule
 */
export async function updateSchedule(
  scheduleId: string,
  userId: string,
  updates: UpdateScheduleInput
): Promise<SessionSchedule> {
  // Validate ownership
  const existing = await db.query.sessionSchedules.findFirst({
    where: and(
      eq(sessionSchedules.id, scheduleId),
      eq(sessionSchedules.userId, userId)
    ),
  });

  if (!existing) {
    throw new ScheduleServiceError(
      "Schedule not found",
      "SCHEDULE_NOT_FOUND",
      scheduleId
    );
  }

  // Recalculate next run if cron/timezone changed
  let nextRunAt: Date | null | undefined;
  if (updates.cronExpression || updates.timezone) {
    const cronExpr = updates.cronExpression ?? existing.cronExpression;
    const tz = updates.timezone ?? existing.timezone;
    if (!validateCronExpression(cronExpr, tz)) {
      throw new ScheduleServiceError(
        "Invalid cron expression or timezone",
        "INVALID_CRON_EXPRESSION",
        scheduleId
      );
    }
    nextRunAt = calculateNextRun(cronExpr, tz);
  }

  const [updated] = await db
    .update(sessionSchedules)
    .set({
      ...updates,
      nextRunAt: nextRunAt !== undefined ? nextRunAt : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionSchedules.id, scheduleId),
        eq(sessionSchedules.userId, userId)
      )
    )
    .returning();

  return mapDbScheduleToSchedule(updated);
}

/**
 * Update commands for a schedule
 */
export async function updateScheduleCommands(
  scheduleId: string,
  userId: string,
  commands: ScheduleCommandInput[]
): Promise<ScheduleCommand[]> {
  // Validate ownership
  const existing = await db.query.sessionSchedules.findFirst({
    where: and(
      eq(sessionSchedules.id, scheduleId),
      eq(sessionSchedules.userId, userId)
    ),
  });

  if (!existing) {
    throw new ScheduleServiceError(
      "Schedule not found",
      "SCHEDULE_NOT_FOUND",
      scheduleId
    );
  }

  if (!commands || commands.length === 0) {
    throw new ScheduleServiceError(
      "At least one command is required",
      "COMMANDS_REQUIRED",
      scheduleId
    );
  }

  // Delete existing commands
  await db
    .delete(scheduleCommands)
    .where(eq(scheduleCommands.scheduleId, scheduleId));

  // Insert new commands
  const now = new Date();
  const commandRecords = await db
    .insert(scheduleCommands)
    .values(
      commands.map((cmd, index) => ({
        id: crypto.randomUUID(),
        scheduleId,
        command: cmd.command,
        order: index,
        delayBeforeSeconds: cmd.delayBeforeSeconds ?? 0,
        continueOnError: cmd.continueOnError ?? false,
        createdAt: now,
      }))
    )
    .returning();

  // Update schedule timestamp
  await db
    .update(sessionSchedules)
    .set({ updatedAt: now })
    .where(eq(sessionSchedules.id, scheduleId));

  return commandRecords.map(mapDbCommandToCommand);
}

/**
 * Delete a schedule
 */
export async function deleteSchedule(
  scheduleId: string,
  userId: string
): Promise<void> {
  const result = await db
    .delete(sessionSchedules)
    .where(
      and(
        eq(sessionSchedules.id, scheduleId),
        eq(sessionSchedules.userId, userId)
      )
    );

  // Check if anything was deleted
  if (result.rowsAffected === 0) {
    throw new ScheduleServiceError(
      "Schedule not found",
      "SCHEDULE_NOT_FOUND",
      scheduleId
    );
  }
}

/**
 * Toggle schedule enabled state
 */
export async function setScheduleEnabled(
  scheduleId: string,
  userId: string,
  enabled: boolean
): Promise<void> {
  const result = await db
    .update(sessionSchedules)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionSchedules.id, scheduleId),
        eq(sessionSchedules.userId, userId)
      )
    );

  if (result.rowsAffected === 0) {
    throw new ScheduleServiceError(
      "Schedule not found",
      "SCHEDULE_NOT_FOUND",
      scheduleId
    );
  }
}

// =============================================================================
// Schedule Execution
// =============================================================================

/**
 * Execute a schedule manually (trigger now)
 */
export async function executeScheduleNow(
  scheduleId: string,
  userId: string
): Promise<ScheduleExecution> {
  const scheduleData = await getScheduleWithCommands(scheduleId, userId);
  if (!scheduleData) {
    throw new ScheduleServiceError(
      "Schedule not found",
      "SCHEDULE_NOT_FOUND",
      scheduleId
    );
  }

  // Get session
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, scheduleData.sessionId),
  });

  if (!session) {
    throw new ScheduleServiceError(
      "Session not found",
      "SESSION_NOT_FOUND",
      scheduleId
    );
  }

  if (session.status === "closed") {
    throw new ScheduleServiceError(
      "Session is closed",
      "SESSION_CLOSED",
      scheduleId
    );
  }

  return executeSchedule(scheduleData, session.tmuxSessionName);
}

/**
 * Core execution logic - runs commands sequentially
 */
export async function executeSchedule(
  schedule: SessionScheduleWithCommands,
  tmuxSessionName: string
): Promise<ScheduleExecution> {
  const startedAt = new Date();
  const executionId = crypto.randomUUID();

  let successCount = 0;
  let failureCount = 0;
  const commandResults: Array<{
    commandId: string;
    command: string;
    status: ExecutionStatus;
    exitCode: number | null;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    output?: string;
    errorMessage?: string;
  }> = [];

  // Check if tmux session exists
  const sessionExists = await TmuxService.sessionExists(tmuxSessionName);
  if (!sessionExists) {
    // Record failed execution
    const completedAt = new Date();
    const [execution] = await db
      .insert(scheduleExecutions)
      .values({
        id: executionId,
        scheduleId: schedule.id,
        status: "failed",
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        commandCount: schedule.commands.length,
        successCount: 0,
        failureCount: schedule.commands.length,
        errorMessage: `Tmux session "${tmuxSessionName}" does not exist`,
      })
      .returning();

    // Update schedule metadata
    await updateScheduleAfterExecution(schedule.id, "failed");

    return mapDbExecutionToExecution(execution);
  }

  // Execute commands sequentially
  for (const cmd of schedule.commands) {
    // Apply delay before command
    if (cmd.delayBeforeSeconds > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, cmd.delayBeforeSeconds * 1000)
      );
    }

    const cmdStartedAt = new Date();
    try {
      // Send command to tmux session
      await TmuxService.sendKeys(tmuxSessionName, cmd.command, true);

      // Brief wait to allow command to start (fire-and-forget style)
      await new Promise((resolve) => setTimeout(resolve, 100));

      const cmdCompletedAt = new Date();
      commandResults.push({
        commandId: cmd.id,
        command: cmd.command,
        status: "success",
        exitCode: 0,
        startedAt: cmdStartedAt,
        completedAt: cmdCompletedAt,
        durationMs: cmdCompletedAt.getTime() - cmdStartedAt.getTime(),
      });

      successCount++;
    } catch (error) {
      const cmdCompletedAt = new Date();
      const errorMsg = error instanceof Error ? error.message : String(error);
      commandResults.push({
        commandId: cmd.id,
        command: cmd.command,
        status: "failed",
        exitCode: 1,
        startedAt: cmdStartedAt,
        completedAt: cmdCompletedAt,
        durationMs: cmdCompletedAt.getTime() - cmdStartedAt.getTime(),
        errorMessage: errorMsg,
      });

      failureCount++;

      // Stop execution if not configured to continue on error
      if (!cmd.continueOnError) {
        break;
      }
    }
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const status: ExecutionStatus = failureCount > 0 ? "failed" : "success";

  // Store execution record
  const [execution] = await db
    .insert(scheduleExecutions)
    .values({
      id: executionId,
      scheduleId: schedule.id,
      status,
      startedAt,
      completedAt,
      durationMs,
      commandCount: schedule.commands.length,
      successCount,
      failureCount,
    })
    .returning();

  // Store command execution details
  if (commandResults.length > 0) {
    await db.insert(commandExecutions).values(
      commandResults.map((r) => ({
        id: crypto.randomUUID(),
        executionId,
        commandId: r.commandId,
        command: r.command,
        status: r.status,
        exitCode: r.exitCode,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        durationMs: r.durationMs,
        output: r.output?.substring(0, 5000), // Truncate to 5KB
        errorMessage: r.errorMessage,
      }))
    );
  }

  // Update schedule metadata
  await updateScheduleAfterExecution(schedule.id, status);

  return mapDbExecutionToExecution(execution);
}

/**
 * Update schedule metadata after execution
 */
async function updateScheduleAfterExecution(
  scheduleId: string,
  status: ExecutionStatus
): Promise<void> {
  const schedule = await db.query.sessionSchedules.findFirst({
    where: eq(sessionSchedules.id, scheduleId),
  });

  if (!schedule) return;

  const now = new Date();
  const nextRunAt = calculateNextRun(schedule.cronExpression, schedule.timezone);
  const consecutiveFailures =
    status === "failed" ? (schedule.consecutiveFailures || 0) + 1 : 0;

  await db
    .update(sessionSchedules)
    .set({
      lastRunAt: now,
      lastRunStatus: status,
      nextRunAt,
      consecutiveFailures,
      updatedAt: now,
    })
    .where(eq(sessionSchedules.id, scheduleId));
}

// =============================================================================
// Execution History
// =============================================================================

/**
 * Get execution history for a schedule
 */
export async function getExecutionHistory(
  scheduleId: string,
  userId: string,
  limit = 50
): Promise<ScheduleExecution[]> {
  // Validate ownership
  const schedule = await db.query.sessionSchedules.findFirst({
    where: and(
      eq(sessionSchedules.id, scheduleId),
      eq(sessionSchedules.userId, userId)
    ),
  });

  if (!schedule) {
    throw new ScheduleServiceError(
      "Schedule not found",
      "SCHEDULE_NOT_FOUND",
      scheduleId
    );
  }

  const executions = await db.query.scheduleExecutions.findMany({
    where: eq(scheduleExecutions.scheduleId, scheduleId),
    orderBy: [desc(scheduleExecutions.startedAt)],
    limit,
  });

  return executions.map(mapDbExecutionToExecution);
}

/**
 * Get execution with command details
 */
export async function getExecutionWithCommands(
  executionId: string,
  userId: string
): Promise<ScheduleExecutionWithCommands | null> {
  const execution = await db.query.scheduleExecutions.findFirst({
    where: eq(scheduleExecutions.id, executionId),
  });

  if (!execution) return null;

  // Validate ownership via schedule
  const schedule = await db.query.sessionSchedules.findFirst({
    where: and(
      eq(sessionSchedules.id, execution.scheduleId),
      eq(sessionSchedules.userId, userId)
    ),
  });

  if (!schedule) return null;

  const cmdExecutions = await db.query.commandExecutions.findMany({
    where: eq(commandExecutions.executionId, executionId),
    orderBy: [asc(commandExecutions.startedAt)],
  });

  return {
    ...mapDbExecutionToExecution(execution),
    commandExecutions: cmdExecutions.map(mapDbCommandExecutionToCommandExecution),
  };
}

// =============================================================================
// Scheduler Utilities
// =============================================================================

/**
 * Get all enabled schedules for the scheduler to register
 */
export async function getEnabledSchedules(): Promise<SessionScheduleWithCommands[]> {
  const schedules = await db.query.sessionSchedules.findMany({
    where: eq(sessionSchedules.enabled, true),
  });

  const result: SessionScheduleWithCommands[] = [];

  for (const schedule of schedules) {
    const commands = await db.query.scheduleCommands.findMany({
      where: eq(scheduleCommands.scheduleId, schedule.id),
      orderBy: [asc(scheduleCommands.order)],
    });

    result.push({
      ...mapDbScheduleToSchedule(schedule),
      commands: commands.map(mapDbCommandToCommand),
    });
  }

  return result;
}

/**
 * Disable all schedules for a session (called on session close)
 */
export async function disableSessionSchedules(sessionId: string): Promise<number> {
  const result = await db
    .update(sessionSchedules)
    .set({
      enabled: false,
      updatedAt: new Date(),
    })
    .where(eq(sessionSchedules.sessionId, sessionId));

  return result.rowsAffected ?? 0;
}

/**
 * Re-enable schedules for a session (called on worktree restore)
 */
export async function reEnableSessionSchedules(sessionId: string): Promise<number> {
  const result = await db
    .update(sessionSchedules)
    .set({
      enabled: true,
      updatedAt: new Date(),
    })
    .where(eq(sessionSchedules.sessionId, sessionId));

  return result.rowsAffected ?? 0;
}

// =============================================================================
// Mappers
// =============================================================================

function mapDbScheduleToSchedule(
  dbSchedule: typeof sessionSchedules.$inferSelect
): SessionSchedule {
  return {
    id: dbSchedule.id,
    userId: dbSchedule.userId,
    sessionId: dbSchedule.sessionId,
    name: dbSchedule.name,
    cronExpression: dbSchedule.cronExpression,
    timezone: dbSchedule.timezone,
    enabled: dbSchedule.enabled,
    status: dbSchedule.status as ScheduleStatus,
    maxRetries: dbSchedule.maxRetries,
    retryDelaySeconds: dbSchedule.retryDelaySeconds,
    timeoutSeconds: dbSchedule.timeoutSeconds,
    lastRunAt: dbSchedule.lastRunAt ? new Date(dbSchedule.lastRunAt) : null,
    lastRunStatus: dbSchedule.lastRunStatus as ExecutionStatus | null,
    nextRunAt: dbSchedule.nextRunAt ? new Date(dbSchedule.nextRunAt) : null,
    consecutiveFailures: dbSchedule.consecutiveFailures,
    createdAt: new Date(dbSchedule.createdAt),
    updatedAt: new Date(dbSchedule.updatedAt),
  };
}

function mapDbCommandToCommand(
  dbCommand: typeof scheduleCommands.$inferSelect
): ScheduleCommand {
  return {
    id: dbCommand.id,
    scheduleId: dbCommand.scheduleId,
    command: dbCommand.command,
    order: dbCommand.order,
    delayBeforeSeconds: dbCommand.delayBeforeSeconds,
    continueOnError: dbCommand.continueOnError,
    createdAt: new Date(dbCommand.createdAt),
  };
}

function mapDbExecutionToExecution(
  dbExecution: typeof scheduleExecutions.$inferSelect
): ScheduleExecution {
  return {
    id: dbExecution.id,
    scheduleId: dbExecution.scheduleId,
    status: dbExecution.status as ExecutionStatus,
    startedAt: new Date(dbExecution.startedAt),
    completedAt: new Date(dbExecution.completedAt),
    durationMs: dbExecution.durationMs,
    commandCount: dbExecution.commandCount,
    successCount: dbExecution.successCount,
    failureCount: dbExecution.failureCount,
    errorMessage: dbExecution.errorMessage,
    output: dbExecution.output,
  };
}

function mapDbCommandExecutionToCommandExecution(
  dbCmdExec: typeof commandExecutions.$inferSelect
): CommandExecution {
  return {
    id: dbCmdExec.id,
    executionId: dbCmdExec.executionId,
    commandId: dbCmdExec.commandId,
    command: dbCmdExec.command,
    status: dbCmdExec.status as ExecutionStatus,
    exitCode: dbCmdExec.exitCode,
    startedAt: new Date(dbCmdExec.startedAt),
    completedAt: new Date(dbCmdExec.completedAt),
    durationMs: dbCmdExec.durationMs,
    output: dbCmdExec.output,
    errorMessage: dbCmdExec.errorMessage,
  };
}
