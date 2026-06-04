/**
 * AgentScheduleService — CRUD + cron validation for `agentSchedules` (epic
 * remote-dev-oyej.1). Reuses the cron utilities from `schedule-service.ts`
 * (`validateCronExpression`/`calculateNextRun`). A scheduled agent run is a
 * REAL launch (see AgentRunService), NOT keystrokes.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentSchedules } from "@/db/schema";
import { affectedRows } from "@/db/sql-helpers";
import { createLogger } from "@/lib/logger";
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
  scheduleType: ScheduleType;
  cronExpression: string | null;
  scheduledAt: Date | null;
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
  const timezone = input.timezone || DEFAULT_TZ;
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

  let nextRunAt: Date | null = null;
  let scheduledAt: Date | null = null;
  let cronExpression: string | null = null;

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
  } else {
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
  }

  return {
    name: input.name.trim(),
    agentProvider,
    agentFlags: input.agentFlags ?? [],
    prompt: input.prompt,
    worktreeType: input.worktreeType ?? null,
    baseBranch: input.baseBranch ?? null,
    scheduleType,
    cronExpression,
    scheduledAt,
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
      scheduleType: v.scheduleType,
      cronExpression: v.cronExpression,
      scheduledAt: v.scheduledAt,
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

  // Re-validate cron / recompute nextRunAt when scheduling fields change.
  const timezone = patch.timezone ?? existing.timezone;
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
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.maxRetries !== undefined) set.maxRetries = patch.maxRetries;

  if (patch.cronExpression !== undefined) {
    if (patch.cronExpression && !validateCronExpression(patch.cronExpression, timezone)) {
      throw new AgentScheduleServiceError(
        "Invalid cron expression or timezone",
        "INVALID_CRON_EXPRESSION",
      );
    }
    set.cronExpression = patch.cronExpression ?? null;
    set.nextRunAt = patch.cronExpression
      ? calculateNextRun(patch.cronExpression, timezone)
      : null;
  } else if (patch.timezone !== undefined && existing.cronExpression) {
    // Timezone changed → recompute nextRunAt for the existing cron.
    set.nextRunAt = calculateNextRun(existing.cronExpression, timezone);
  }

  const [row] = await db
    .update(agentSchedules)
    .set(set)
    .where(and(eq(agentSchedules.id, id), eq(agentSchedules.userId, userId)))
    .returning();
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

/** Record a run firing: bump lastRunAt + recompute nextRunAt for recurring. */
export async function markScheduleFired(id: string): Promise<void> {
  const row = await db.query.agentSchedules.findFirst({
    where: eq(agentSchedules.id, id),
  });
  if (!row) return;
  const set: Partial<AgentScheduleRow> = {
    lastRunAt: new Date(),
    updatedAt: new Date(),
  };
  if (row.scheduleType === "recurring" && row.cronExpression) {
    set.nextRunAt = calculateNextRun(row.cronExpression, row.timezone);
  } else if (row.scheduleType === "one-time") {
    set.status = "completed" as ScheduleStatus;
    set.enabled = false;
  }
  await db.update(agentSchedules).set(set).where(eq(agentSchedules.id, id));
}
