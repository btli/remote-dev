/**
 * TriggerConfigService — CRUD for `triggerConfigs` (epic remote-dev-oyej.3).
 *
 * A trigger config binds a GitHub event kind + filter to an agent-launch
 * template; when an inbound webhook event matches (see TriggerService), a REAL
 * agent run fires. Pure validation lives in {@link validateTriggerConfigInput}
 * so the kind/filter gates are unit-testable.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { triggerConfigs } from "@/db/schema";
import { affectedRows } from "@/db/sql-helpers";
import { createLogger } from "@/lib/logger";
import { AGENT_PROVIDERS } from "@/types/session";
import type {
  TriggerConfigInput,
  TriggerConfigUpdate,
  TriggerKind,
} from "@/types/agent-run";

const log = createLogger("TriggerConfig");

export type TriggerConfigRow = typeof triggerConfigs.$inferSelect;

const VALID_KINDS = new Set<TriggerKind>([
  "pr_labeled",
  "issue_opened",
  "ci_failed",
]);
const VALID_PROVIDERS = new Set(AGENT_PROVIDERS.map((p) => p.id));

export class TriggerConfigServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "TriggerConfigServiceError";
  }
}

export interface ValidatedTriggerConfig {
  name: string;
  kind: TriggerKind;
  filter: string;
  agentProvider: string;
  agentFlags: string[];
  promptTemplate: string;
  worktreeType: string | null;
  profileId: string | null;
  enabled: boolean;
  githubRepoId: string | null;
}

/** Validate + normalize a trigger-config input. Pure. Throws on bad input. */
export function validateTriggerConfigInput(
  input: TriggerConfigInput,
): ValidatedTriggerConfig {
  if (!input.name || input.name.trim() === "") {
    throw new TriggerConfigServiceError("Name is required", "NAME_REQUIRED");
  }
  if (!VALID_KINDS.has(input.kind)) {
    throw new TriggerConfigServiceError(
      `Unknown trigger kind "${input.kind}"`,
      "INVALID_KIND",
    );
  }
  if (!input.promptTemplate || input.promptTemplate.trim() === "") {
    throw new TriggerConfigServiceError(
      "promptTemplate is required",
      "PROMPT_TEMPLATE_REQUIRED",
    );
  }
  const agentProvider = input.agentProvider || "claude";
  if (!VALID_PROVIDERS.has(agentProvider as never)) {
    throw new TriggerConfigServiceError(
      `Unknown agent provider "${agentProvider}"`,
      "INVALID_PROVIDER",
    );
  }

  const filter = input.filter ?? {};
  // pr_labeled requires a non-empty `label` filter to be meaningful.
  if (input.kind === "pr_labeled") {
    const label = (filter as { label?: unknown }).label;
    if (typeof label !== "string" || label.trim() === "") {
      throw new TriggerConfigServiceError(
        'pr_labeled triggers require a string "label" filter',
        "FILTER_REQUIRED",
      );
    }
  }

  return {
    name: input.name.trim(),
    kind: input.kind,
    filter: JSON.stringify(filter),
    agentProvider,
    agentFlags: input.agentFlags ?? [],
    promptTemplate: input.promptTemplate,
    worktreeType: input.worktreeType ?? null,
    profileId: input.profileId ?? null,
    enabled: input.enabled ?? true,
    githubRepoId: input.githubRepoId ?? null,
  };
}

export async function createTriggerConfig(
  userId: string,
  input: TriggerConfigInput,
): Promise<TriggerConfigRow> {
  const v = validateTriggerConfigInput(input);
  const [row] = await db
    .insert(triggerConfigs)
    .values({
      userId,
      projectId: input.projectId,
      githubRepoId: v.githubRepoId,
      name: v.name,
      kind: v.kind,
      filter: v.filter,
      agentProvider: v.agentProvider,
      agentFlags: JSON.stringify(v.agentFlags),
      promptTemplate: v.promptTemplate,
      worktreeType: v.worktreeType,
      profileId: v.profileId,
      enabled: v.enabled,
    })
    .returning();
  log.info("trigger config created", {
    configId: row.id,
    userId,
    kind: row.kind,
  });
  return row;
}

export async function listTriggerConfigs(
  userId: string,
  projectId?: string,
): Promise<TriggerConfigRow[]> {
  const conds = [eq(triggerConfigs.userId, userId)];
  if (projectId) conds.push(eq(triggerConfigs.projectId, projectId));
  return db
    .select()
    .from(triggerConfigs)
    .where(and(...conds))
    .orderBy(desc(triggerConfigs.createdAt));
}

export async function getTriggerConfig(
  userId: string,
  id: string,
): Promise<TriggerConfigRow | null> {
  const row = await db.query.triggerConfigs.findFirst({
    where: and(eq(triggerConfigs.id, id), eq(triggerConfigs.userId, userId)),
  });
  return row ?? null;
}

export async function updateTriggerConfig(
  userId: string,
  id: string,
  patch: TriggerConfigUpdate,
): Promise<TriggerConfigRow | null> {
  const existing = await getTriggerConfig(userId, id);
  if (!existing) return null;

  const set: Partial<TriggerConfigRow> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.kind !== undefined) {
    if (!VALID_KINDS.has(patch.kind)) {
      throw new TriggerConfigServiceError(
        `Unknown trigger kind "${patch.kind}"`,
        "INVALID_KIND",
      );
    }
    set.kind = patch.kind;
  }
  if (patch.filter !== undefined) set.filter = JSON.stringify(patch.filter);
  if (patch.agentProvider !== undefined) {
    if (!VALID_PROVIDERS.has(patch.agentProvider as never)) {
      throw new TriggerConfigServiceError(
        `Unknown agent provider "${patch.agentProvider}"`,
        "INVALID_PROVIDER",
      );
    }
    set.agentProvider = patch.agentProvider;
  }
  if (patch.agentFlags !== undefined)
    set.agentFlags = JSON.stringify(patch.agentFlags);
  if (patch.promptTemplate !== undefined)
    set.promptTemplate = patch.promptTemplate;
  if (patch.worktreeType !== undefined)
    set.worktreeType = patch.worktreeType ?? null;
  if (patch.profileId !== undefined) set.profileId = patch.profileId ?? null;
  if (patch.githubRepoId !== undefined)
    set.githubRepoId = patch.githubRepoId ?? null;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;

  const [row] = await db
    .update(triggerConfigs)
    .set(set)
    .where(and(eq(triggerConfigs.id, id), eq(triggerConfigs.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteTriggerConfig(
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .delete(triggerConfigs)
    .where(and(eq(triggerConfigs.id, id), eq(triggerConfigs.userId, userId)));
  return affectedRows(result) > 0;
}
