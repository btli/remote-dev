/**
 * AgentScheduleService — CRUD + timing validation for `agentSchedules` (epic
 * remote-dev-oyej.1). Reuses the cron utilities from `schedule-service.ts`;
 * interval calculations come from the shared pure format helpers. A scheduled
 * agent run is a REAL launch (see AgentRunService), NOT keystrokes.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentSchedules } from "@/db/schema";
import { affectedRows } from "@/db/sql-helpers";
import { createLogger } from "@/lib/logger";
import {
  isValidIntervalSeconds,
  isValidTimezone,
} from "@/lib/schedule-validation";
import {
  calculateNextIntervalRun,
  describeIntervalSchedule,
} from "@/lib/schedule-format";
import { AGENT_PROVIDERS } from "@/types/session";
import type { ScheduleType, ScheduleStatus } from "@/types/schedule";
import type {
  AgentScheduleInput,
  AgentScheduleUpdate,
} from "@/types/agent-run";
import {
  validateCronExpression,
  calculateNextRun,
} from "./schedule-service";
export { calculateNextIntervalRun, describeIntervalSchedule };

const log = createLogger("AgentSchedule");

export type AgentScheduleRow = typeof agentSchedules.$inferSelect;

const DEFAULT_TZ = "America/Los_Angeles";
const VALID_PROVIDERS = new Set(AGENT_PROVIDERS.map((p) => p.id));

export class AgentScheduleServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AgentScheduleServiceError";
  }
}

/** Normalized, validated schedule fields ready for insert. */
export interface ValidatedAgentSchedule {
  name: string;
  agentProvider: string;
  agentFlags: string[];
  prompt: string;
  worktreeType: string | null;
  baseBranch: string | null;
  profileId: string | null;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  scheduledAt: Date | null;
  intervalSeconds: number | null;
  anchorAt: Date | null;
  timezone: string;
  enabled: boolean;
  maxRetries: number;
  nextRunAt: Date | null;
}

/**
 * Validate + normalize an agent-schedule create input. Pure (no DB) so the
 * cron/provider gates are unit-testable. Throws {@link AgentScheduleServiceError}.
 */
export function validateAgentScheduleInput(
  input: AgentScheduleInput,
): ValidatedAgentSchedule {
  const timezone =
    input.timezone === undefined ? DEFAULT_TZ : input.timezone;
  const scheduleType: ScheduleType = input.scheduleType || "recurring";
  const agentProvider = input.agentProvider || "claude";

  if (!input.name || input.name.trim() === "") {
    throw new AgentScheduleServiceError("Name is required", "NAME_REQUIRED");
  }
  if (!input.prompt || input.prompt.trim() === "") {
    throw new AgentScheduleServiceError(
      "Prompt is required",
      "PROMPT_REQUIRED",
    );
  }
  if (!VALID_PROVIDERS.has(agentProvider as never)) {
    throw new AgentScheduleServiceError(
      `Unknown agent provider "${agentProvider}"`,
      "INVALID_PROVIDER",
    );
  }
  if (!["one-time", "recurring", "interval"].includes(scheduleType)) {
    throw new AgentScheduleServiceError(
      `Unknown schedule type "${scheduleType}"`,
      "INVALID_SCHEDULE_TYPE",
    );
  }
  if (!isValidTimezone(timezone)) {
    throw new AgentScheduleServiceError(
      "Invalid timezone",
      "INVALID_TIMEZONE",
    );
  }

  let nextRunAt: Date | null = null;
  let scheduledAt: Date | null = null;
  let cronExpression: string | null = null;
  let intervalSeconds: number | null = null;
  let anchorAt: Date | null = null;

  if (scheduleType === "one-time") {
    if (!input.scheduledAt) {
      throw new AgentScheduleServiceError(
        "Scheduled time is required for one-time schedules",
        "SCHEDULED_AT_REQUIRED",
      );
    }
    scheduledAt = new Date(input.scheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      throw new AgentScheduleServiceError(
        "Invalid scheduled time format",
        "INVALID_SCHEDULED_AT",
      );
    }
    if (scheduledAt <= new Date()) {
      throw new AgentScheduleServiceError(
        "Scheduled time must be in the future",
        "SCHEDULED_AT_IN_PAST",
      );
    }
    nextRunAt = scheduledAt;
  } else if (scheduleType === "recurring") {
    if (!input.cronExpression) {
      throw new AgentScheduleServiceError(
        "Cron expression is required for recurring schedules",
        "CRON_EXPRESSION_REQUIRED",
      );
    }
    if (!validateCronExpression(input.cronExpression, timezone)) {
      throw new AgentScheduleServiceError(
        "Invalid cron expression or timezone",
        "INVALID_CRON_EXPRESSION",
      );
    }
    cronExpression = input.cronExpression;
    nextRunAt = calculateNextRun(input.cronExpression, timezone);
  } else {
    if (!isValidIntervalSeconds(input.intervalSeconds)) {
      throw new AgentScheduleServiceError(
        "Interval must be between 1 minute and 30 days",
        "INVALID_INTERVAL_SECONDS",
      );
    }
    if (!input.anchorAt) {
      throw new AgentScheduleServiceError(
        "Anchor time is required for interval schedules",
        "ANCHOR_AT_REQUIRED",
      );
    }
    anchorAt = new Date(input.anchorAt);
    if (isNaN(anchorAt.getTime())) {
      throw new AgentScheduleServiceError(
        "Invalid anchor time format",
        "INVALID_ANCHOR_AT",
      );
    }
    intervalSeconds = input.intervalSeconds;
    nextRunAt = calculateNextIntervalRun(anchorAt, intervalSeconds);
  }

  return {
    name: input.name.trim(),
    agentProvider,
    agentFlags: input.agentFlags ?? [],
    prompt: input.prompt,
    worktreeType: input.worktreeType ?? null,
    baseBranch: input.baseBranch ?? null,
    profileId: input.profileId ?? null,
    scheduleType,
    cronExpression,
    scheduledAt,
    intervalSeconds,
    anchorAt,
    timezone,
    enabled: input.enabled ?? true,
    maxRetries: input.maxRetries ?? 0,
    nextRunAt,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createAgentSchedule(
  userId: string,
  input: AgentScheduleInput,
): Promise<AgentScheduleRow> {
  const v = validateAgentScheduleInput(input);
  const [row] = await db
    .insert(agentSchedules)
    .values({
      userId,
      projectId: input.projectId,
      name: v.name,
      agentProvider: v.agentProvider,
      agentFlags: JSON.stringify(v.agentFlags),
      prompt: v.prompt,
      worktreeType: v.worktreeType,
      baseBranch: v.baseBranch,
      profileId: v.profileId,
      scheduleType: v.scheduleType,
      cronExpression: v.cronExpression,
      scheduledAt: v.scheduledAt,
      intervalSeconds: v.intervalSeconds,
      anchorAt: v.anchorAt,
      timezone: v.timezone,
      enabled: v.enabled,
      maxRetries: v.maxRetries,
      nextRunAt: v.nextRunAt,
    })
    .returning();
  log.info("agent schedule created", {
    scheduleId: row.id,
    userId,
    enabled: row.enabled,
  });
  return row;
}

export async function listAgentSchedules(
  userId: string,
  projectId?: string,
): Promise<AgentScheduleRow[]> {
  const conds = [eq(agentSchedules.userId, userId)];
  if (projectId) conds.push(eq(agentSchedules.projectId, projectId));
  return db
    .select()
    .from(agentSchedules)
    .where(and(...conds))
    .orderBy(desc(agentSchedules.createdAt));
}

export async function getAgentSchedule(
  userId: string,
  id: string,
): Promise<AgentScheduleRow | null> {
  const row = await db.query.agentSchedules.findFirst({
    where: and(eq(agentSchedules.id, id), eq(agentSchedules.userId, userId)),
  });
  return row ?? null;
}

/** Return all enabled, non-completed schedules (for orchestrator load). */
export async function getEnabledAgentSchedules(): Promise<AgentScheduleRow[]> {
  return db
    .select()
    .from(agentSchedules)
    .where(eq(agentSchedules.enabled, true));
}

export async function updateAgentSchedule(
  userId: string,
  id: string,
  patch: AgentScheduleUpdate,
): Promise<AgentScheduleRow | null> {
  const existing = await getAgentSchedule(userId, id);
  if (!existing) return null;

  const scheduleType = patch.scheduleType ?? existing.scheduleType;
  if (!["one-time", "recurring", "interval"].includes(scheduleType)) {
    throw new AgentScheduleServiceError(
      `Unknown schedule type "${scheduleType}"`,
      "INVALID_SCHEDULE_TYPE",
    );
  }
  const timezone =
    patch.timezone === undefined ? existing.timezone : patch.timezone;
  if (!isValidTimezone(timezone)) {
    throw new AgentScheduleServiceError(
      "Invalid timezone",
      "INVALID_TIMEZONE",
    );
  }

  let nextRunAt: Date | null | undefined;
  let scheduledAt: Date | null | undefined;
  let intervalSeconds: number | null | undefined;
  let anchorAt: Date | null | undefined;
  let cronExpression: string | null | undefined;
  let enabled = patch.enabled;
  let status: ScheduleStatus | undefined;

  if (scheduleType === "one-time") {
    if (patch.scheduledAt !== undefined || patch.scheduleType !== undefined) {
      const scheduledAtValue =
        patch.scheduledAt !== undefined
          ? patch.scheduledAt
          : existing.scheduledAt;
      if (!scheduledAtValue) {
        throw new AgentScheduleServiceError(
          "Scheduled time is required for one-time schedules",
          "SCHEDULED_AT_REQUIRED",
        );
      }
      scheduledAt = new Date(scheduledAtValue);
      if (isNaN(scheduledAt.getTime())) {
        throw new AgentScheduleServiceError(
          "Invalid scheduled time format",
          "INVALID_SCHEDULED_AT",
        );
      }
      if (scheduledAt <= new Date()) {
        throw new AgentScheduleServiceError(
          "Scheduled time must be in the future",
          "SCHEDULED_AT_IN_PAST",
        );
      }
      nextRunAt = scheduledAt;
      status = "active";
      if (enabled === undefined) enabled = true;
    }
    if (patch.scheduleType !== undefined) {
      cronExpression = null;
      intervalSeconds = null;
      anchorAt = null;
    }
  } else if (scheduleType === "recurring") {
    if (
      patch.cronExpression !== undefined ||
      patch.timezone !== undefined ||
      patch.scheduleType !== undefined
    ) {
      const cronExpr = patch.cronExpression ?? existing.cronExpression;
      if (!cronExpr) {
        throw new AgentScheduleServiceError(
          "Cron expression is required for recurring schedules",
          "CRON_EXPRESSION_REQUIRED",
        );
      }
      if (!validateCronExpression(cronExpr, timezone)) {
        throw new AgentScheduleServiceError(
          "Invalid cron expression or timezone",
          "INVALID_CRON_EXPRESSION",
        );
      }
      cronExpression = cronExpr;
      nextRunAt = calculateNextRun(cronExpr, timezone);
    }
    if (patch.scheduleType !== undefined) {
      scheduledAt = null;
      intervalSeconds = null;
      anchorAt = null;
    }
  } else {
    const shouldRecomputeInterval =
      patch.intervalSeconds !== undefined ||
      patch.anchorAt !== undefined ||
      patch.scheduleType !== undefined ||
      patch.enabled === true;
    if (shouldRecomputeInterval) {
      const intervalValue =
        patch.intervalSeconds !== undefined
          ? patch.intervalSeconds
          : existing.intervalSeconds;
      if (!isValidIntervalSeconds(intervalValue)) {
        throw new AgentScheduleServiceError(
          "Interval must be between 1 minute and 30 days",
          "INVALID_INTERVAL_SECONDS",
        );
      }
      const anchorValue =
        patch.anchorAt !== undefined ? patch.anchorAt : existing.anchorAt;
      if (!anchorValue) {
        throw new AgentScheduleServiceError(
          "Anchor time is required for interval schedules",
          "ANCHOR_AT_REQUIRED",
        );
      }
      anchorAt = new Date(anchorValue);
      if (isNaN(anchorAt.getTime())) {
        throw new AgentScheduleServiceError(
          "Invalid anchor time format",
          "INVALID_ANCHOR_AT",
        );
      }
      intervalSeconds = intervalValue;
      nextRunAt = calculateNextIntervalRun(anchorAt, intervalSeconds);
    }
    if (patch.scheduleType !== undefined) {
      cronExpression = null;
      scheduledAt = null;
    }
  }

  const switchedToRepeating =
    patch.scheduleType !== undefined &&
    existing.scheduleType !== scheduleType &&
    scheduleType !== "one-time" &&
    nextRunAt !== undefined;
  // `paused` is import-only for agent schedules because AgentScheduleUpdate
  // has no status field — revisit if a pause API lands, since a user-intended
  // pause must survive a re-enable, cf. the session stack which deliberately
  // omits it.
  if (switchedToRepeating) {
    if (
      ["completed", "cancelled", "missed", "paused"].includes(existing.status)
    ) {
      status = "active";
    }
    if (enabled === undefined) enabled = true;
  }

  if (
    enabled === true &&
    status === undefined &&
    (existing.status === "paused" ||
      existing.status === "cancelled" ||
      existing.status === "missed" ||
      (scheduleType !== "one-time" && existing.status === "completed"))
  ) {
    status = "active";
  }

  // Build the DB update from an explicit whitelist. Type-specific client
  // fields are only written after validation and conversion above.
  const set: Partial<AgentScheduleRow> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.prompt !== undefined) set.prompt = patch.prompt;
  if (patch.agentProvider !== undefined) {
    if (!VALID_PROVIDERS.has(patch.agentProvider as never)) {
      throw new AgentScheduleServiceError(
        `Unknown agent provider "${patch.agentProvider}"`,
        "INVALID_PROVIDER",
      );
    }
    set.agentProvider = patch.agentProvider;
  }
  if (patch.agentFlags !== undefined)
    set.agentFlags = JSON.stringify(patch.agentFlags);
  if (patch.worktreeType !== undefined)
    set.worktreeType = patch.worktreeType ?? null;
  if (patch.baseBranch !== undefined) set.baseBranch = patch.baseBranch ?? null;
  if (patch.profileId !== undefined) set.profileId = patch.profileId ?? null;
  if (patch.scheduleType !== undefined) {
    set.scheduleType = patch.scheduleType;
  }
  if (patch.timezone !== undefined) set.timezone = timezone;
  if (enabled !== undefined) set.enabled = enabled;
  if (status !== undefined) set.status = status;
  if (patch.maxRetries !== undefined) set.maxRetries = patch.maxRetries;
  if (nextRunAt !== undefined) set.nextRunAt = nextRunAt;
  if (cronExpression !== undefined) set.cronExpression = cronExpression;
  if (scheduledAt !== undefined) set.scheduledAt = scheduledAt;
  if (intervalSeconds !== undefined) set.intervalSeconds = intervalSeconds;
  if (anchorAt !== undefined) set.anchorAt = anchorAt;

  const [row] = await db
    .update(agentSchedules)
    .set(set)
    .where(and(eq(agentSchedules.id, id), eq(agentSchedules.userId, userId)))
    .returning();

  if (enabled !== undefined) {
    log.info("Agent schedule enabled-state transition", {
      scheduleId: id,
      enabled,
      previousEnabled: existing.enabled,
      status: status ?? existing.status,
    });
  }

  return row ?? null;
}

export async function deleteAgentSchedule(
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .delete(agentSchedules)
    .where(and(eq(agentSchedules.id, id), eq(agentSchedules.userId, userId)));
  return affectedRows(result) > 0;
}

/** Record a run firing and re-arm repeating schedules. */
export async function markScheduleFired(id: string): Promise<void> {
  const row = await db.query.agentSchedules.findFirst({
    where: eq(agentSchedules.id, id),
  });
  if (!row) return;
  const now = new Date();
  const set: Partial<AgentScheduleRow> = {
    lastRunAt: now,
    updatedAt: now,
  };
  if (row.scheduleType === "recurring" && row.cronExpression) {
    set.nextRunAt = calculateNextRun(row.cronExpression, row.timezone);
  } else if (
    row.scheduleType === "interval" &&
    row.anchorAt &&
    row.intervalSeconds
  ) {
    set.nextRunAt = calculateNextIntervalRun(
      row.anchorAt,
      row.intervalSeconds,
      now,
    );
  } else if (row.scheduleType === "one-time") {
    set.status = "completed";
    set.enabled = false;
    set.nextRunAt = null;
  } else {
    set.nextRunAt = null;
  }
  await db.update(agentSchedules).set(set).where(eq(agentSchedules.id, id));
}

/**
 * Persist the scheduler's computed next interval fire without changing the
 * schedule's configuration timestamp.
 */
export async function persistNextRunAt(
  scheduleId: string,
  nextRunAt: Date,
): Promise<void> {
  await db
    .update(agentSchedules)
    .set({ nextRunAt })
    .where(eq(agentSchedules.id, scheduleId));
}
