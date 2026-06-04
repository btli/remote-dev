/**
 * TriggerService — match an inbound GitHub event against `triggerConfigs`,
 * write a `triggerEvents` audit row, dedupe per head-SHA, and dispatch a REAL
 * agent run (epic remote-dev-oyej.4).
 *
 * Per-head-SHA dedupe: `agentRuns` has a UNIQUE (triggerConfigId, headSha)
 * index. GitHub redelivers events, so a second delivery for the same head SHA
 * makes the second `launchAgentRun` insert hit ON CONFLICT — we catch the
 * unique violation, skip the duplicate, and record it as matched-but-no-new-run.
 *
 * Testability: the DB lookups + AgentRunService are injected via TriggerDeps
 * (defaulting to the real implementations) so matching/dispatch are unit-testable.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  triggerConfigs,
  triggerEvents,
  githubRepositories,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import * as AgentRunService from "./agent-run-service";
import type { GithubEvent } from "@/lib/github-webhook-auth";
import type { TriggerKind } from "@/types/agent-run";

const log = createLogger("Trigger");

/** The subset of a trigger config the matcher needs. */
export interface TriggerConfigLike {
  id: string;
  userId: string;
  projectId: string;
  githubRepoId: string | null;
  kind: TriggerKind;
  filter: string;
  agentProvider: string;
  agentFlags: string;
  promptTemplate: string;
  worktreeType: string | null;
  enabled: boolean;
}

/** Injectable dependencies for the matcher. */
export interface TriggerDeps {
  resolveRepoId(repoFullName: string): Promise<string | null>;
  findEnabledConfigs(repoId: string | null): Promise<TriggerConfigLike[]>;
  launchAgentRun(input: {
    userId: string;
    projectId: string;
    source: "trigger";
    triggerConfigId: string;
    headSha: string | null;
    agentProvider: string;
    agentFlags: string[];
    prompt: string;
    worktreeType: string | null;
  }): Promise<{ id: string }>;
  supersedePriorRuns(
    triggerConfigId: string,
    headSha: string,
    keepRunId: string,
  ): Promise<number>;
  record(
    configId: string,
    event: GithubEvent,
    matched: boolean,
    runId: string | null,
  ): Promise<void>;
}

/** Per-kind event-shape predicates (kind ↔ GitHub event/action). */
const KIND_FOR: Record<TriggerKind, (e: GithubEvent) => boolean> = {
  pr_labeled: (e) => e.event === "pull_request" && e.action === "labeled",
  issue_opened: (e) => e.event === "issues" && e.action === "opened",
  ci_failed: (e) =>
    e.event === "check_suite" &&
    e.action === "completed" &&
    e.conclusion === "failure",
};

/** Apply a config's filter to an event (e.g. label match for pr_labeled). */
function filterMatches(cfg: TriggerConfigLike, e: GithubEvent): boolean {
  let f: { label?: string };
  try {
    f = JSON.parse(cfg.filter) as { label?: string };
  } catch {
    f = {};
  }
  if (cfg.kind === "pr_labeled" && f.label) {
    return e.labels.includes(f.label);
  }
  return true;
}

/** Substitute {{repo}} / {{prNumber}} / {{issueNumber}} in a template. */
export function renderTemplate(template: string, e: GithubEvent): string {
  return template
    .replaceAll("{{repo}}", e.repoFullName ?? "")
    .replaceAll("{{prNumber}}", e.prNumber !== undefined ? String(e.prNumber) : "")
    .replaceAll(
      "{{issueNumber}}",
      e.issueNumber !== undefined ? String(e.issueNumber) : "",
    );
}

function defaultDeps(): TriggerDeps {
  return {
    resolveRepoId: async (repoFullName) => {
      const repo = await db.query.githubRepositories.findFirst({
        where: eq(githubRepositories.fullName, repoFullName),
      });
      return repo?.id ?? null;
    },
    findEnabledConfigs: async (repoId) => {
      // SECURITY: a webhook event whose repo does NOT resolve to a known
      // `githubRepositories` row (repoId === null) must match ZERO configs.
      // `triggerConfigs.githubRepoId` is nullable, so selecting on enabled-only
      // would let a config bound to repo A fire on repo B's (or a foreign
      // tenant's) event — cross-repo / cross-tenant trigger leakage. Require an
      // exact repo binding.
      if (!repoId) return [];
      const rows = await db
        .select()
        .from(triggerConfigs)
        .where(
          and(
            eq(triggerConfigs.enabled, true),
            eq(triggerConfigs.githubRepoId, repoId),
          ),
        );
      return rows as TriggerConfigLike[];
    },
    launchAgentRun: async (input) => {
      const run = await AgentRunService.launchAgentRun(input);
      return { id: run.id };
    },
    supersedePriorRuns: (configId, headSha, keepRunId) =>
      AgentRunService.supersedePriorRuns(configId, headSha, keepRunId),
    record: async (configId, event, matched, runId) => {
      await db.insert(triggerEvents).values({
        triggerConfigId: configId,
        eventKind: event.event,
        action: event.action ?? null,
        headSha: event.headSha ?? null,
        matched,
        runId,
      });
    },
  };
}

/**
 * Handle one normalized GitHub event: for each enabled config bound to the
 * event's repo, match kind+filter, and on a match dispatch a deduped agent run.
 */
export async function handleEvent(
  e: GithubEvent,
  injectedDeps?: TriggerDeps,
): Promise<void> {
  const deps = injectedDeps ?? defaultDeps();

  const repoId = e.repoFullName
    ? await deps.resolveRepoId(e.repoFullName)
    : null;
  // SECURITY: an event whose repo doesn't resolve to a known repository row must
  // match NO trigger configs (a config bound to repo A must never fire on repo
  // B's event). Short-circuit so we never fan out across tenants. findEnabledConfigs
  // also enforces this defensively (returns [] when repoId is null).
  if (!repoId) {
    log.debug("trigger event for unknown/unbound repo; dispatching zero runs", {
      repo: e.repoFullName ?? null,
      event: e.event,
    });
    return;
  }
  const configs = await deps.findEnabledConfigs(repoId);

  for (const cfg of configs) {
    const matched =
      (KIND_FOR[cfg.kind]?.(e) ?? false) && filterMatches(cfg, e);
    if (!matched) {
      await deps.record(cfg.id, e, false, null);
      continue;
    }

    try {
      const run = await deps.launchAgentRun({
        userId: cfg.userId,
        projectId: cfg.projectId,
        source: "trigger",
        triggerConfigId: cfg.id,
        headSha: e.headSha ?? null,
        agentProvider: cfg.agentProvider,
        agentFlags: JSON.parse(cfg.agentFlags) as string[],
        prompt: renderTemplate(cfg.promptTemplate, e),
        worktreeType: cfg.worktreeType,
      });
      if (e.headSha) {
        await deps.supersedePriorRuns(cfg.id, e.headSha, run.id);
      }
      await deps.record(cfg.id, e, true, run.id);
    } catch (err) {
      // A duplicate GitHub delivery hits the UNIQUE (triggerConfigId, headSha)
      // index → skip the second run, but still record the matched event.
      if (/unique/i.test(String(err))) {
        log.info("duplicate trigger delivery ignored", {
          cfg: cfg.id,
          headSha: e.headSha,
        });
        await deps.record(cfg.id, e, true, null);
      } else {
        throw err;
      }
    }
  }
}
