# Agent Automation & Orchestration Platform — Implementation Plan

> **For agentic workers.** Execute this with `superpowers:subagent-driven-development` — one subagent per `### Task` below, each in its own git worktree (`./scripts/worktree-warm.sh`), per-step TDD added at execution time (`superpowers:test-driven-development`). The main agent coordinates and merges; it does not edit `src/`, `apps/`, `crates/`, or `deploy/` directly (CLAUDE.md worktree rule).

**Goal:** Take automation to the next level on the supervisor+k3s base — scheduled *agent runs* (cron+prompt, not keystrokes), GitHub-webhook-triggered runs, Crown best-of-N run-and-compare with an LLM judge + auto-PR, a golden dev-env image, warm pools, scale-to-zero, a supervisor agent-launch API, and cross-instance delegation. Epic **remote-dev-oyej** (12 children). Infra pieces (.7/.8/.9) **cross-link** epic **remote-dev-jvcx** (supervisor lifecycle) — they extend it, do not duplicate it.

**Architecture:** Three tiers. (1) **Main app** (Next.js + terminal server): new `agentSchedules`/`agentRuns` tables + an `AgentRunService` that performs a *real* non-interactive agent launch by POSTing the same `CreateSessionInput` (`terminalType:"agent"`, `autoLaunchAgent:true`, `agentFlags`) the existing session-create path consumes; a `SchedulerOrchestrator`-style cron loop and an HMAC GitHub-event webhook (mirroring `/api/deploy`) drive those launches; Crown extends the `rdv teams` fan-out with a diff collector + LLM judge + `gh pr create`. (2) **Supervisor** (`apps/supervisor`): a per-instance agent-launch API that proxies into an instance's data plane, a `warm_pool` table + reconciler arm that pre-provisions/claims/GCs envs, a scale-to-zero reaper, and a cross-instance delegation API. (3) **Image/k8s** (`deploy/k8s/supervisor`, root `Dockerfile`): the golden dev-env image (already bakes 5 agents + sudo/apt + gh — formalized + auto-update) and a reaper CronJob.

**Tech Stack:** TypeScript, Next.js 16 / React 19, Drizzle ORM + libsql (main app `src/db/schema.ts`; supervisor `apps/supervisor/src/db/schema.ts`), croner, Vitest, `@kubernetes/client-node` (supervisor), Rust + clap (`crates/rdv`), Bun. Server logging is `createLogger` from `@/lib/logger` **only** — never `console.*`.

---

## File Structure

### Main app — schedules & triggered runs (Group A)
| Path | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/db/schema.ts` | Modify | Add `agentSchedules`, `agentRuns`, `triggerConfigs`, `triggerEvents` tables + inferred types; `bun run db:push`. |
| `src/types/agent-run.ts` | Create | `AgentRunStatus`, `AgentScheduleInput`, `AgentRun`, `TriggerConfig`, `TriggerKind`, mappers' DTO types. |
| `src/services/agent-run-service.ts` | Create | Core: `launchAgentRun()` (real session launch via SessionService), run state machine (`pending→running→completed/failed/superseded`), per-head-SHA dedupe, CRUD. |
| `src/services/agent-schedule-service.ts` | Create | CRUD + croner validation for `agentSchedules` (reuses `validateCronExpression`/`calculateNextRun` from `schedule-service.ts`). |
| `src/services/agent-scheduler-orchestrator.ts` | Create | Singleton cron loop in the terminal server: loads enabled `agentSchedules` at boot, `Map<id, Cron>`, fires `launchAgentRun()` (mirrors `scheduler-orchestrator.ts`). |
| `src/server/index.ts` | Modify | Start `agentSchedulerOrchestrator` alongside the existing `schedulerOrchestrator` on terminal-server boot. |
| `src/lib/scheduler-client.ts` | Modify | Add `notifyAgentScheduleCreated/Updated/Deleted` (same socket/port + Bearer AUTH_SECRET transport as `notifyScheduleCreated`). |
| `src/server/scheduler-control.ts` | Modify | Add the agent-schedule notify handlers to the terminal server's internal control endpoint (sibling of the existing schedule handlers). |
| `src/app/api/agent-schedules/route.ts` | Create | `GET`/`POST` (`withApiAuth`) — list/create agent schedules; fire-and-forget `notifyAgentScheduleCreated`. |
| `src/app/api/agent-schedules/[id]/route.ts` | Create | `GET`/`PATCH`/`DELETE` (`withApiAuth`) — update/delete + notify. |
| `src/app/api/agent-runs/route.ts` | Create | `GET` (`withApiAuth`) — list runs (filter by scheduleId/triggerConfigId/status); `POST` — manual launch. |
| `src/app/api/webhooks/github/route.ts` | Create | HMAC-SHA256 GitHub-event webhook (oyej.2); verifies sig, parses event, hands to `TriggerService`. Mirrors `/api/deploy`. |
| `src/lib/github-webhook-auth.ts` | Create | Re-exports `verifySignature` from `deploy-webhook-auth.ts` + `parseGithubEvent(headers, rawBody)`. |
| `src/services/trigger-service.ts` | Create | Match an inbound GitHub event against `triggerConfigs`, write a `triggerEvents` row, dedupe per head-SHA, dispatch `launchAgentRun()` (oyej.3/.4). |
| `src/app/api/trigger-configs/route.ts` | Create | `GET`/`POST` (`withApiAuth`) — CRUD for trigger configs. |
| `src/app/api/trigger-configs/[id]/route.ts` | Create | `GET`/`PATCH`/`DELETE` (`withApiAuth`). |
| `src/app/(dashboard)/settings/triggers/page.tsx` | Create | Trigger-config UI (event kind + filter + agent template). (UI shell only; wired to the API.) |

### Main app — Crown best-of-N (Group B)
| Path | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/db/schema.ts` | Modify | Add `crownRuns`, `crownCandidates` tables; `bun run db:push`. |
| `src/types/crown.ts` | Create | `CrownRunStatus`, `CrownCandidate`, `CrownJudgeResult` (`{winner, reason}`), `CrownInput`. |
| `src/services/crown-service.ts` | Create | Fan-out N agent launches into N worktree branches (extends `rdv teams`), poll completion, collect filtered diffs, invoke judge, store `crownReason`, `gh pr create` winner, manual override. |
| `src/services/crown-diff-collector.ts` | Create | Per-candidate `git diff` (filtered: excludes lockfiles/`node_modules`/binaries; truncates) via `execFile` + `worktree-service`. |
| `src/services/crown-judge.ts` | Create | LLM judge call routed through the model-key proxy (`resolveProxyEnv` / `litellm-service`); returns `{winner, reason}`; deterministic fallback when no model configured. |
| `src/app/api/crown/route.ts` | Create | `GET`/`POST` (`withApiAuth`) — start a Crown run, list runs. |
| `src/app/api/crown/[id]/route.ts` | Create | `GET` (status + candidates + diffs); `POST` `{action:"pr", candidateId}` manual override. |
| `crates/rdv/src/commands/crown.rs` | Create | `rdv crown start --project-id --count N --provider X --prompt … [--judge-model M]`, `crown status <id>`, `crown pr <id> --candidate <cid>`. |
| `crates/rdv/src/commands/mod.rs` | Modify | Register the `crown` subcommand. |
| `crates/rdv/src/main.rs` | Modify | Wire `Crown` into the top-level `Commands` enum + dispatch. |

### Infra — golden image, warm pool, scale-to-zero (Group C — **extends jvcx**)
| Path | Create/Modify | Responsibility |
|------|---------------|----------------|
| `Dockerfile` | Modify | Formalize the golden dev-env image: build-arg `RDV_IMAGE_FLAVOR=dev-env`, assert all 5 agent CLIs (incl. best-effort `agy`) + toolchains + sudo/apt + an auto-update hook; **the 5-agent install already exists** — this hardens it. |
| `docker/entrypoint.sh` | Modify | Add an opt-in agent-CLI auto-update step (`AGENT_AUTO_UPDATE=1`) on boot (npm `-g` refresh of the 4 npm agents, best-effort `agy`). |
| `apps/supervisor/src/db/schema.ts` | Modify | Add `warmPool` table (slug-template, status `provisioning|ready|claimed|terminating`, `claimedByRunId`, `ttlExpiresAt`, timestamps); `bun run db:push`. |
| `apps/supervisor/src/lib/warm-pool.ts` | Create | `prewarm()`, `claimReady()`, `gcExpired()` — drive warm-pool rows through their state machine. |
| `apps/supervisor/src/controller/reconciler.ts` | Modify | Add a `reconcileWarmPool(deps)` arm + scale-to-zero idle reaper (suspend idle `ready` agent-run instances), invoked from `reconcileInstances`. |
| `apps/supervisor/src/lib/idle-detector.ts` | Create | Decide whether an instance is idle (last-activity probe via the instance's data plane) for scale-to-zero. |
| `deploy/k8s/supervisor/reaper-cronjob.yaml` | Create | k8s `CronJob` that calls the supervisor's internal reaper endpoint to suspend idle agent envs + GC expired warm-pool rows. |
| `deploy/k8s/supervisor/supervisor.yaml` | Modify | Add warm-pool + reaper env vars (`SUPERVISOR_WARM_POOL_SIZE`, `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS`, `SUPERVISOR_REAPER_SECRET`). |

### Supervisor — agent-launch & delegation APIs (Group D)
| Path | Create/Modify | Responsibility |
|------|---------------|----------------|
| `apps/supervisor/src/lib/instance-proxy.ts` | Create | Authenticated server-to-server fetch into an instance's data plane (`https://<host>/<slug>/api/...`) with the instance's API key / internal secret. |
| `apps/supervisor/src/app/api/instances/[id]/agent/route.ts` | Create | `POST` (operator, oyej.10) — launch an agent run on instance `:id` by proxying to its `/api/agent-runs`. Returns the run handle. |
| `apps/supervisor/src/app/api/delegate/route.ts` | Create | `POST` (operator, oyej.11) — cross-instance delegation: resolve-or-provision a target instance, then dispatch an agent run (depends .10). |
| `apps/supervisor/src/app/api/internal/reaper/route.ts` | Create | `POST` gated by `SUPERVISOR_REAPER_SECRET` (mirrors `/api/internal/routes` auth) — run idle-suspend + warm-pool GC; called by the CronJob. |
| `crates/rdv/src/commands/delegate.rs` | Create | `rdv delegate --to <slug> --project-id … --prompt …` (and `--provision-if-missing`) hitting the supervisor delegation API. |

### Tests & docs (Group E — oyej.12)
| Path | Create | Responsibility |
|------|--------|----------------|
| `src/services/__tests__/agent-run-service.test.ts` | Create | State machine + per-head-SHA dedupe + launch wiring. |
| `src/services/__tests__/agent-schedule-service.test.ts` | Create | Cron validation, nextRun, CRUD. |
| `src/services/__tests__/trigger-service.test.ts` | Create | Event matching, filters, dedupe, dispatch. |
| `src/app/api/webhooks/github/__tests__/route.test.ts` | Create | HMAC accept/reject, event filtering, 202. |
| `src/services/__tests__/crown-service.test.ts` | Create | Fan-out, diff collection, judge wiring, auto-PR, manual override. |
| `src/services/__tests__/crown-judge.test.ts` | Create | Judge parse `{winner,reason}`, fallback. |
| `apps/supervisor/src/lib/__tests__/warm-pool.test.ts` | Create | prewarm/claim/GC state transitions. |
| `apps/supervisor/src/controller/__tests__/reconciler.test.ts` | Modify | Add warm-pool + idle-reaper convergence cases. |
| `apps/supervisor/src/app/api/instances/[id]/agent/__tests__/route.test.ts` | Create | Agent-launch proxy auth + dispatch. |
| `apps/supervisor/src/app/api/delegate/__tests__/route.test.ts` | Create | Delegation resolve-or-provision + dispatch. |
| `docs/AUTOMATION.md` | Create | Schedules, triggers, Crown, warm pool, supervisor agent-launch + delegation; cross-links `docs/MULTI_INSTANCE.md` + jvcx. |
| `docs/API.md`, `docs/openapi.yaml`, `docs/RDV_CLI.md`, `CHANGELOG.md` | Modify | Document the new routes, the `rdv crown`/`rdv delegate` commands, and the changelog entries. |

---

## Build Sequence

Dependency order from the bead graph (`oyej.4` deps `.3,.1`; `.3` deps `.2`; `.6` deps `.5`; `.8` deps `.7`; `.11` deps `.10`):

- **Group A — Schedules + Triggers** (sequential within, parallel-safe vs B/C/D after schema lands):
  1. **oyej.1** agent schedules → real launch (foundation for `.4`).
  2. **oyej.2** GitHub webhook endpoint (HMAC).
  3. **oyej.3** trigger config (model + UI) — *after* `.2`.
  4. **oyej.4** triggered-run executor + state machine + per-head-SHA dedupe — *after* `.3` and `.1`.
- **Group B — Crown** (parallel to A after the shared run scaffolding; B reuses `AgentRunService` only loosely — it has its own tables):
  5. **oyej.5** Crown fan-out (extends `rdv teams`).
  6. **oyej.6** Crown judge + auto-PR — *after* `.5`.
- **Group C — Infra / warm pool** (jvcx-adjacent; parallel to A/B):
  7. **oyej.7** golden dev-env image.
  8. **oyej.8** warm pool — *after* `.7`.
  9. **oyej.9** scale-to-zero + reaper CronJob.
- **Group D — Supervisor APIs** (parallel to A/B/C):
  10. **oyej.10** supervisor agent-launch API.
  11. **oyej.11** cross-instance delegation — *after* `.10`.
- **Group E — Tests + docs:** **oyej.12** lands incrementally with each task's TDD; the doc pages + changelog are written last.

---

## Group A — Schedules & Triggers

### Task — agentSchedules: cron + prompt → real agent launch
**Bead:** remote-dev-oyej.1
**Files:**
- Create: `src/types/agent-run.ts`, `src/services/agent-run-service.ts`, `src/services/agent-schedule-service.ts`, `src/services/agent-scheduler-orchestrator.ts`, `src/app/api/agent-schedules/route.ts`, `src/app/api/agent-schedules/[id]/route.ts`, `src/app/api/agent-runs/route.ts`
- Modify: `src/db/schema.ts`, `src/lib/scheduler-client.ts`, `src/server/scheduler-control.ts`, `src/server/index.ts`
- Test: `src/services/__tests__/agent-run-service.test.ts`, `src/services/__tests__/agent-schedule-service.test.ts`

**Why a new table (not `sessionSchedules`):** `sessionSchedules`+`scheduleCommands` send **keystrokes via tmux** to an *existing* session (fire-and-forget; "success" only means the keystrokes were sent — see the EXECUTION MODEL block at `src/services/schedule-service.ts:556-585`). An agent *run* must **create a fresh session** with `terminalType:"agent"`, `autoLaunchAgent:true`, an optional worktree, and a prompt delivered to the agent. Distinct lifecycle → distinct tables.

**Steps:**
1. **Schema** (`src/db/schema.ts`, after the scheduled-commands block ~line 831). Reuse the column conventions verified in `sessionSchedules` (`scheduleType`, `cronExpression`, `timezone`, `enabled`, `status`, `maxRetries`, `nextRunAt`, `consecutiveFailures`):

```ts
export type AgentRunStatus =
  | "pending" | "running" | "completed" | "failed" | "superseded";

/** Scheduled REAL agent launches (distinct from keystroke-only sessionSchedules). */
export const agentSchedules = sqliteTable(
  "agent_schedule",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Launch template
    agentProvider: text("agent_provider").notNull().default("claude"),
    agentFlags: text("agent_flags").notNull().default("[]"), // JSON string[]
    prompt: text("prompt").notNull(),                         // delivered to the agent after launch
    worktreeType: text("worktree_type"),                      // null => no worktree
    baseBranch: text("base_branch"),
    // Cron (mirrors sessionSchedules)
    scheduleType: text("schedule_type").$type<ScheduleType>().notNull().default("recurring"),
    cronExpression: text("cron_expression"),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
    timezone: text("timezone").notNull().default("America/Los_Angeles"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").$type<ScheduleStatus>().notNull().default("active"),
    maxRetries: integer("max_retries").notNull().default(0),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("agent_schedule_user_idx").on(t.userId),
    index("agent_schedule_next_run_idx").on(t.enabled, t.nextRunAt),
  ],
);

/** One agent-run instance, regardless of trigger source (schedule | webhook | manual | crown). */
export const agentRuns = sqliteTable(
  "agent_run",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    // Provenance — exactly one of these is set (others null).
    scheduleId: text("schedule_id").references(() => agentSchedules.id, { onDelete: "set null" }),
    triggerConfigId: text("trigger_config_id").references(() => triggerConfigs.id, { onDelete: "set null" }),
    source: text("source").$type<"schedule" | "trigger" | "manual" | "crown">().notNull(),
    // Launch params snapshot
    agentProvider: text("agent_provider").notNull(),
    agentFlags: text("agent_flags").notNull().default("[]"),
    prompt: text("prompt").notNull(),
    // The session this run created (null until launched).
    sessionId: text("session_id").references(() => terminalSessions.id, { onDelete: "set null" }),
    // Dedupe key for trigger runs: the GitHub head SHA (null for schedule/manual).
    headSha: text("head_sha"),
    status: text("status").$type<AgentRunStatus>().notNull().default("pending"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("agent_run_user_idx").on(t.userId),
    index("agent_run_schedule_idx").on(t.scheduleId),
    index("agent_run_trigger_idx").on(t.triggerConfigId),
    index("agent_run_status_idx").on(t.status),
    // Per-(triggerConfig, headSha) dedupe — see TriggerService.
    uniqueIndex("agent_run_trigger_head_idx").on(t.triggerConfigId, t.headSha),
  ],
);

export type AgentScheduleRow = typeof agentSchedules.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
```
> The `agent_run_trigger_head_idx` unique index is **nullable-composite**: in libsql/SQLite, rows where `headSha IS NULL` (schedule/manual runs) do **not** collide (NULLs are distinct), so the index only enforces dedupe for trigger runs. This is the per-head-SHA dedupe primitive `.4` relies on. Run `bun run db:push`.

2. **`agent-run-service.ts` — the real launch + state machine.** The launch reuses the **existing** session-create path (verified at `src/services/session-service.ts:483-497` + `src/app/api/sessions/route.ts:54-151`), so the agent CLI is started exactly as an interactive agent session, then the prompt is sent:

```ts
import { createLogger } from "@/lib/logger";
import { db } from "@/db";
import { agentRuns, type AgentRunRow } from "@/db/schema";
import * as SessionService from "./session-service";
import * as TmuxService from "./tmux-service";
import { eq } from "drizzle-orm";

const log = createLogger("AgentRun");

export interface LaunchAgentRunInput {
  userId: string;
  projectId: string;
  source: AgentRunRow["source"];
  agentProvider: string;
  agentFlags: string[];
  prompt: string;
  worktreeType?: string | null;
  baseBranch?: string | null;
  scheduleId?: string | null;
  triggerConfigId?: string | null;
  headSha?: string | null;
}

/** pending → running → completed|failed (and superseded by a newer same-key run). */
export async function launchAgentRun(input: LaunchAgentRunInput): Promise<AgentRunRow> {
  const [run] = await db.insert(agentRuns).values({
    userId: input.userId, projectId: input.projectId, source: input.source,
    agentProvider: input.agentProvider, agentFlags: JSON.stringify(input.agentFlags),
    prompt: input.prompt, scheduleId: input.scheduleId ?? null,
    triggerConfigId: input.triggerConfigId ?? null, headSha: input.headSha ?? null,
    status: "pending",
  }).returning();

  try {
    // REAL launch — same input the interactive create path consumes.
    const { session } = await SessionService.createSessionWithDedupFlag(input.userId, {
      name: `run/${input.source}/${run.id.slice(0, 8)}`,
      projectId: input.projectId,
      terminalType: "agent",
      agentProvider: input.agentProvider as never,
      autoLaunchAgent: true,
      agentFlags: input.agentFlags,
      createWorktree: !!input.worktreeType,
      worktreeType: input.worktreeType as never,
      baseBranch: input.baseBranch ?? undefined,
    });

    // Deliver the prompt once the agent CLI is up. tmux sendKeys uses \r (NOT \n)
    // — the Claude/Codex TUI requires \r to submit (see project memory).
    await waitForPaneReady(session.tmuxSessionName);
    await TmuxService.sendKeys(session.tmuxSessionName, input.prompt, true);

    const [running] = await db.update(agentRuns)
      .set({ status: "running", sessionId: session.id, startedAt: new Date() })
      .where(eq(agentRuns.id, run.id)).returning();
    log.info("agent run launched", { runId: run.id, sessionId: session.id, source: input.source });
    return running;
  } catch (err) {
    await db.update(agentRuns)
      .set({ status: "failed", errorMessage: String(err), completedAt: new Date() })
      .where(eq(agentRuns.id, run.id));
    log.error("agent run launch failed", { runId: run.id, error: String(err) });
    throw err;
  }
}

/** Mark older non-terminal runs with the same dedupe key superseded (per-head-SHA). */
export async function supersedePriorRuns(triggerConfigId: string, headSha: string, keepRunId: string): Promise<number> { /* UPDATE … status='superseded' WHERE triggerConfigId=? AND headSha=? AND id<>? AND status IN ('pending','running') */ }
```
`waitForPaneReady` polls `TmuxService.capturePane` for a quiescent prompt before sending the prompt — this is the same pane-quiescent guard the project added in `createSession` (memory: `startup_cmd_first_char` — a shell-init prompt ate the first keystroke). Do **not** skip it.

3. **`agent-schedule-service.ts`** — CRUD; import `validateCronExpression`/`calculateNextRun` from `schedule-service.ts` (already exported, verified `:54-81`). On create with `enabled`, compute `nextRunAt`. Validate the agent provider against `agent-providers` and reject unknown providers.

4. **`agent-scheduler-orchestrator.ts`** — clone the shape of `scheduler-orchestrator.ts` (`Map<id, Cron>`, `start/stop/addJob/removeJob/updateJob`), but the cron callback calls `AgentRunService.launchAgentRun()` instead of `executeSchedule`. Export a singleton `agentSchedulerOrchestrator`. Start it in `src/server/index.ts` next to `schedulerOrchestrator.start()`.

5. **API routes** — `withApiAuth` (dual session/API-key, verified `src/lib/api.ts:95-137`). `POST /api/agent-schedules` validates + `notifyAgentScheduleCreated(id)` fire-and-forget (mirror `src/app/api/schedules/route.ts:73-77`). `POST /api/agent-runs` does an immediate `launchAgentRun({source:"manual"})`.

**Test command:** `bun run test:run src/services/__tests__/agent-run-service.test.ts src/services/__tests__/agent-schedule-service.test.ts`
**Expected:** all pass. Cases: launch inserts `pending`→`running`, sets `sessionId`; launch failure → `failed` with `errorMessage`; `supersedePriorRuns` flips only matching non-terminal rows; cron validation rejects bad expressions; `nextRunAt` computed for recurring. Mock `SessionService.createSessionWithDedupFlag` + `TmuxService` (no real tmux). Then `bun run lint && bun run typecheck`.

---

### Task — GitHub event webhook endpoint (HMAC)
**Bead:** remote-dev-oyej.2
**Files:**
- Create: `src/app/api/webhooks/github/route.ts`, `src/lib/github-webhook-auth.ts`
- Test: `src/app/api/webhooks/github/__tests__/route.test.ts`

**Steps:**
1. **`github-webhook-auth.ts`** — reuse the existing constant-time verifier (verified `src/lib/deploy-webhook-auth.ts:11-22`); add a typed event parser:

```ts
export { verifySignature } from "@/lib/deploy-webhook-auth";

export interface GithubEvent {
  event: string;                 // X-GitHub-Event: pull_request | issues | check_suite | …
  action?: string;               // labeled | opened | completed | …
  repoFullName?: string;         // owner/name
  headSha?: string;              // PR head sha / check_suite head_sha (dedupe key)
  prNumber?: number;
  issueNumber?: number;
  labels: string[];
  conclusion?: string;           // check_suite/check_run: success | failure | …
}

export function parseGithubEvent(headers: Headers, body: unknown): GithubEvent { /* read X-GitHub-Event + body shape; normalize labels[]; pull head sha from pull_request.head.sha | check_suite.head_sha */ }
```

2. **`route.ts`** — structurally mirror `/api/deploy` (verified `src/app/api/deploy/route.ts:40-170`): raw-body read **before** JSON parse, HMAC over the raw bytes, env-secret gate. Hand the parsed event to `TriggerService.handleEvent` (oyej.3). Always answer fast (202) — dispatch is async/detached so GitHub's 10s delivery budget is never blocked.

```ts
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { verifySignature, parseGithubEvent } from "@/lib/github-webhook-auth";
import * as TriggerService from "@/services/trigger-service";

const log = createLogger("api/webhooks/github");

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) { log.error("GITHUB_WEBHOOK_SECRET not configured"); return NextResponse.json({ error: "Webhooks not configured" }, { status: 503 }); }

  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(secret, rawBody, signature)) {
    log.warn("Invalid webhook signature", { ip: request.headers.get("x-forwarded-for") ?? "unknown" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const eventName = request.headers.get("x-github-event") ?? "";
  if (eventName === "ping") return NextResponse.json({ message: "pong" });

  let body: unknown;
  try { body = JSON.parse(rawBody.toString("utf-8")); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const event = parseGithubEvent(request.headers, body);
  // Fire-and-forget so GitHub's delivery isn't blocked on agent launch.
  void TriggerService.handleEvent(event).catch((err) =>
    log.error("trigger dispatch failed", { error: String(err), event: event.event, action: event.action }));

  return NextResponse.json({ message: "accepted", event: event.event, action: event.action ?? null }, { status: 202 });
}
```

**Test command:** `bun run test:run src/app/api/webhooks/github/__tests__/route.test.ts`
**Expected:** valid sig + `pull_request`/`labeled` → 202 and `TriggerService.handleEvent` called once (mocked); tampered body → 401; missing secret → 503; `ping` → 200 `pong`; non-JSON → 400. Use a known secret + `crypto.createHmac("sha256", secret).update(raw).digest("hex")` to build a valid header.

---

### Task — GitHub trigger config (model + UI)
**Bead:** remote-dev-oyej.3 — **depends:** oyej.2
**Files:**
- Create: `src/app/api/trigger-configs/route.ts`, `src/app/api/trigger-configs/[id]/route.ts`, `src/app/(dashboard)/settings/triggers/page.tsx`
- Modify: `src/db/schema.ts` (add `triggerConfigs`, `triggerEvents`)
- Test: covered by `trigger-service.test.ts` in oyej.4

**Steps:**
1. **Schema** (`src/db/schema.ts`, near the GitHub tables `:501-689`, since these reference `githubRepositories`):

```ts
export type TriggerKind = "pr_labeled" | "issue_opened" | "ci_failed";

export const triggerConfigs = sqliteTable(
  "trigger_config",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    githubRepoId: text("github_repo_id").references(() => githubRepositories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<TriggerKind>().notNull(),
    // Filter: e.g. {label:"agent:fix"} for pr_labeled. JSON.
    filter: text("filter").notNull().default("{}"),
    // Agent launch template fired when the trigger matches.
    agentProvider: text("agent_provider").notNull().default("claude"),
    agentFlags: text("agent_flags").notNull().default("[]"),
    promptTemplate: text("prompt_template").notNull(), // {{repo}} {{prNumber}} {{issueNumber}} placeholders
    worktreeType: text("worktree_type"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("trigger_config_user_idx").on(t.userId), index("trigger_config_repo_idx").on(t.githubRepoId)],
);

/** Append-only log of inbound matched events (audit + dedupe support). */
export const triggerEvents = sqliteTable(
  "trigger_event",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    triggerConfigId: text("trigger_config_id").notNull().references(() => triggerConfigs.id, { onDelete: "cascade" }),
    eventKind: text("event_kind").notNull(),
    action: text("action"),
    headSha: text("head_sha"),
    matched: integer("matched", { mode: "boolean" }).notNull().default(false),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("trigger_event_config_idx").on(t.triggerConfigId)],
);

export type TriggerConfigRow = typeof triggerConfigs.$inferSelect;
export type TriggerEventRow = typeof triggerEvents.$inferSelect;
```
> **Forward-reference note:** `agentRuns` (oyej.1) references `triggerConfigs`, and `triggerEvents` references `agentRuns`. Land **all four tables in the same `db:push`** (do oyej.1 + oyej.3 schema together if executed in parallel) to avoid an FK-ordering failure. `bun run db:push`.

2. **API routes** — `withApiAuth`; CRUD with project ownership checks. Validate `kind` against the `TriggerKind` union and `filter` shape per kind (`pr_labeled` requires a `label`).

3. **UI** (`settings/triggers/page.tsx`) — list/create/toggle trigger configs (event kind dropdown, filter input, agent template: provider + flags + prompt template + worktree type). Client components may use `console.error` (CLAUDE.md exception). Wire to the API routes; no business logic in the component.

**Test command:** validated via oyej.4's `trigger-service.test.ts` + `bun run typecheck`.
**Expected:** typecheck clean; schema pushes.

---

### Task — Triggered-run executor + state machine (per-head-SHA dedupe)
**Bead:** remote-dev-oyej.4 — **depends:** oyej.3, oyej.1
**Files:**
- Create: `src/services/trigger-service.ts`
- Modify: `src/services/agent-run-service.ts` (use `supersedePriorRuns`)
- Test: `src/services/__tests__/trigger-service.test.ts`

**Steps:**
1. **`trigger-service.ts` — match → dedupe → dispatch:**

```ts
import { createLogger } from "@/lib/logger";
import { db } from "@/db";
import { triggerConfigs, triggerEvents, githubRepositories, type TriggerConfigRow } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import * as AgentRunService from "./agent-run-service";
import type { GithubEvent } from "@/lib/github-webhook-auth";

const log = createLogger("Trigger");

const KIND_FOR: Record<string, (e: GithubEvent) => boolean> = {
  pr_labeled: (e) => e.event === "pull_request" && e.action === "labeled",
  issue_opened: (e) => e.event === "issues" && e.action === "opened",
  ci_failed: (e) => e.event === "check_suite" && e.action === "completed" && e.conclusion === "failure",
};

function filterMatches(cfg: TriggerConfigRow, e: GithubEvent): boolean {
  const f = JSON.parse(cfg.filter) as { label?: string };
  if (cfg.kind === "pr_labeled" && f.label) return e.labels.includes(f.label);
  return true;
}

export async function handleEvent(e: GithubEvent): Promise<void> {
  // Resolve repo → enabled configs whose kind+filter match.
  const repo = e.repoFullName
    ? await db.query.githubRepositories.findFirst({ where: eq(githubRepositories.fullName, e.repoFullName) })
    : null;
  const configs = await db.select().from(triggerConfigs)
    .where(and(eq(triggerConfigs.enabled, true), repo ? eq(triggerConfigs.githubRepoId, repo.id) : undefined as never));

  for (const cfg of configs) {
    const matched = (KIND_FOR[cfg.kind]?.(e) ?? false) && filterMatches(cfg, e);
    if (!matched) { await record(cfg.id, e, false, null); continue; }

    // Per-head-SHA dedupe: the unique (triggerConfigId, headSha) index means a
    // duplicate delivery (GitHub redelivers) hits ON CONFLICT → we skip + supersede.
    try {
      const run = await AgentRunService.launchAgentRun({
        userId: cfg.userId, projectId: cfg.projectId, source: "trigger",
        triggerConfigId: cfg.id, headSha: e.headSha ?? null,
        agentProvider: cfg.agentProvider, agentFlags: JSON.parse(cfg.agentFlags),
        prompt: renderTemplate(cfg.promptTemplate, e), worktreeType: cfg.worktreeType,
      });
      if (e.headSha) await AgentRunService.supersedePriorRuns(cfg.id, e.headSha, run.id);
      await record(cfg.id, e, true, run.id);
    } catch (err) {
      if (/unique/i.test(String(err))) { log.info("duplicate trigger delivery ignored", { cfg: cfg.id, headSha: e.headSha }); await record(cfg.id, e, true, null); }
      else throw err;
    }
  }
}
```
`renderTemplate` substitutes `{{repo}}`/`{{prNumber}}`/`{{issueNumber}}` in `promptTemplate`. `record(...)` inserts a `triggerEvents` row.

**Test command:** `bun run test:run src/services/__tests__/trigger-service.test.ts`
**Expected:** `pr_labeled` with matching label dispatches one run + writes a matched `triggerEvents` row; wrong label → no dispatch, `matched:false`; same `headSha` redelivered → second `launchAgentRun` rejects on the unique index → caught, no second run; `ci_failed` only fires on `conclusion:"failure"`. Mock `AgentRunService` + DB. Then `bun run lint && bun run typecheck`.

---

## Group B — Crown best-of-N

### Task — Crown best-of-N fan-out
**Bead:** remote-dev-oyej.5
**Files:**
- Create: `src/types/crown.ts`, `src/services/crown-service.ts`, `src/services/crown-diff-collector.ts`, `src/app/api/crown/route.ts`, `crates/rdv/src/commands/crown.rs`
- Modify: `src/db/schema.ts`, `crates/rdv/src/commands/mod.rs`, `crates/rdv/src/main.rs`
- Test: `src/services/__tests__/crown-service.test.ts`

**Concept:** Crown = **same prompt → N agents → N worktree branches → collect filtered diffs**. It builds on the `rdv teams` fan-out primitive (verified `crates/rdv/src/commands/teams.rs`: launches N `terminalType:"agent"` sessions sharing a `parentSessionId`; `teams wait` polls `agentExitState` until all `exited`/`closed`). Crown drives that fan-out server-side via N `AgentRunService.launchAgentRun()` calls sharing a `crownRunId`, each with its own worktree branch.

**Steps:**
1. **Schema:**
```ts
export type CrownRunStatus = "running" | "judging" | "completed" | "failed";

export const crownRuns = sqliteTable("crown_run", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  agentProvider: text("agent_provider").notNull().default("claude"),
  candidateCount: integer("candidate_count").notNull(),
  judgeModel: text("judge_model"),
  status: text("status").$type<CrownRunStatus>().notNull().default("running"),
  winnerCandidateId: text("winner_candidate_id"),
  crownReason: text("crown_reason"),     // judge's {reason}
  prUrl: text("pr_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const crownCandidates = sqliteTable("crown_candidate", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  crownRunId: text("crown_run_id").notNull().references(() => crownRuns.id, { onDelete: "cascade" }),
  runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  branch: text("branch").notNull(),
  worktreePath: text("worktree_path"),
  diff: text("diff"),                    // filtered, truncated
  diffStats: text("diff_stats"),         // JSON {files, additions, deletions}
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export type CrownRunRow = typeof crownRuns.$inferSelect;
export type CrownCandidateRow = typeof crownCandidates.$inferSelect;
```
`bun run db:push`.

2. **`crown-service.ts`** — `startCrown({userId, projectId, prompt, count, provider, judgeModel})`:
   - Insert `crownRuns` (`running`).
   - For `i in 0..count`: `launchAgentRun({source:"crown", worktreeType:"feature", prompt})` — each gets its own worktree branch (worktree creation is verified in `session-service.ts:447-468` + `worktree-service.createBranchWithWorktree`). Record a `crownCandidates` row with the branch + worktree path.
   - Caller-side completion: a `waitForCandidates(crownRunId, timeoutMs)` that polls the candidates' `agentRuns.status` (the same exit-state semantics `teams wait` uses) until all terminal.
3. **`crown-diff-collector.ts`** — for each candidate worktree, `git diff <baseBranch>...<branch>` via `execFile("git", …)` (verified safe-exec helper at `src/lib/exec.ts:45`). Filter: drop `*.lock`/`bun.lockb`/`node_modules/`/binary hunks; truncate to ~64KB. Store `diff` + `diffStats`.
4. **`api/crown/route.ts`** — `POST` starts a Crown run (async; returns the `crownRunId`); `GET` lists runs.
5. **`crates/rdv/src/commands/crown.rs`** — model on `agent.rs`/`teams.rs` (`Client::post_json`, `RDV_API_KEY`, `--json`/human). `crown start` POSTs `/api/crown`; `crown status <id>` GETs `/api/crown/:id`.

**Test command:** `bun run test:run src/services/__tests__/crown-service.test.ts` then `cargo test -p rdv` (in worktree) and `cargo build --release -p rdv`.
**Expected:** `startCrown(count:3)` inserts 1 `crownRuns` + 3 `crownCandidates`, each with a distinct branch and a `launchAgentRun` call; diff collector filters lockfiles and truncates oversize diffs; `cargo build` succeeds and `rdv crown --help` lists subcommands. Mock `AgentRunService` + `execFile`.

---

### Task — Crown judge + auto-PR winner
**Bead:** remote-dev-oyej.6 — **depends:** oyej.5
**Files:**
- Create: `src/services/crown-judge.ts`, `src/app/api/crown/[id]/route.ts`
- Modify: `src/services/crown-service.ts` (judge + PR step), `crates/rdv/src/commands/crown.rs` (`crown pr`)
- Test: `src/services/__tests__/crown-judge.test.ts`, extend `crown-service.test.ts`

**Steps:**
1. **`crown-judge.ts` — LLM judge, routed through the model-key proxy.** The judge model call **must** route via the existing model-key proxy that agent sessions already use (`resolveProxyEnv` → `litellm-process-manager`/`litellm-service`, verified `src/services/session-service.ts:74-113`) — this is the realization of the aehq cross-link (`remote-dev-aehq`, "Centralized model-key proxy"). Resolve `ANTHROPIC_BASE_URL` + key from `litellm-service.getActiveDefaultModel(userId)`; if no model is configured, fall back deterministically (largest non-trivial diff wins) so Crown never hard-fails on missing keys.

```ts
export interface CrownJudgeResult { winner: string; reason: string; } // winner = candidateId

export async function judge(opts: {
  userId: string; prompt: string;
  candidates: { id: string; branch: string; diff: string }[];
  model?: string;
}): Promise<CrownJudgeResult> {
  const { resolveJudgeEndpoint } = await import("./crown-judge-endpoint"); // wraps litellm-service
  const endpoint = await resolveJudgeEndpoint(opts.userId, opts.model);
  if (!endpoint) return fallbackJudge(opts.candidates); // no model configured

  const system = "You are a senior engineer judging candidate patches for the SAME task. Reply ONLY as compact JSON {\"winner\":\"<candidateId>\",\"reason\":\"<one sentence>\"}.";
  const user = renderJudgePrompt(opts.prompt, opts.candidates); // task + each candidate's id + filtered diff
  const res = await fetch(`${endpoint.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": endpoint.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: endpoint.model, max_tokens: 512, system, messages: [{ role: "user", content: user }] }),
  });
  return parseJudgeJson(await res.text(), opts.candidates); // tolerant parse; throws → fallbackJudge
}
```

2. **`crown-service.ts`** — after `waitForCandidates`: set `judging`, call `judge(...)`, store `winnerCandidateId` + `crownReason`, then **auto-PR the winner**: `gh pr create --head <winnerBranch> --base <base> --title … --body "<crownReason>"` via `execFile("gh", …)` (the runtime image already ships `gh` — verified `Dockerfile:205-210`). Store `prUrl`, set `completed`.
3. **`api/crown/[id]/route.ts`** — `GET` returns the run + candidates + diffs + judge result; `POST {action:"pr", candidateId}` is the **manual override** (open a PR for an operator-chosen candidate regardless of the judge).
4. **`crown pr <id> --candidate <cid>`** in `crown.rs` → the override POST.

**Test command:** `bun run test:run src/services/__tests__/crown-judge.test.ts src/services/__tests__/crown-service.test.ts`
**Expected:** judge parses well-formed `{winner,reason}`; malformed model output → `fallbackJudge` (no throw); no model configured → fallback; `gh pr create` invoked with the winner's branch (mock `execFile`); manual-override POST opens a PR for the specified candidate and ignores the judge's winner. Then `bun run lint && bun run typecheck`.

---

## Group C — Infra / warm pool (extends jvcx)

> **jvcx boundary (call it out in the PR):** the supervisor lifecycle (`instance` table, the `requested→provisioning→ready↔suspended→terminating→deleted` state machine in `reconciler.ts`, `provisionInstance`/`setStatefulSetReplicas`/`terminateInstance`) is **owned by epic remote-dev-jvcx**. oyej.7/.8/.9 **reuse** those primitives — they add a `warmPool` table, a reconciler *arm*, and a reaper, but **must not** re-implement provisioning, scaling, or the state machine. Suspend/resume already exist (`reconcileSteadyState(deps,row,clients,0|1)`, verified `reconciler.ts:583-678`); scale-to-zero just *requests* `suspended` on idle instances and lets jvcx's existing convergence scale the StatefulSet to 0.

### Task — Golden dev-env image
**Bead:** remote-dev-oyej.7 — **relates:** jvcx
**Files:**
- Modify: `Dockerfile`, `docker/entrypoint.sh`
- Modify: `docs/MULTI_INSTANCE.md` (document the flavor + auto-update)

**Reality check:** the current runtime stage **already** bakes all 5 agent CLIs onto the system PATH (`@anthropic-ai/claude-code`, `@openai/codex`, `@google/gemini-cli`, `opencode-ai` + best-effort `agy`), with a build-time smoke gate, **sudo + functional apt**, `python3`/`venv`/`pipx`, and `gh` (verified `Dockerfile:192-269`). This task **formalizes + hardens**, it does not start from scratch.

**Steps:**
1. **`Dockerfile`** — add `ARG RDV_IMAGE_FLAVOR=dev-env` and an `ENV RDV_IMAGE_FLAVOR=${RDV_IMAGE_FLAVOR}` so the image self-identifies (used by the warm pool to confirm a node can run agent runs). Keep the existing 5-agent install + smoke gate exactly; do not pin (global Docker auto-update policy). Add `node`/`npm` global toolchains the agents commonly need (`typescript`, `tsx`) only if a smoke test shows they're missing.
2. **`docker/entrypoint.sh`** — add an opt-in boot step: when `AGENT_AUTO_UPDATE=1`, run `npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli opencode-ai` (best-effort, logged, never fatal) + retry the `agy` installer. This is the "auto-update" the bead asks for; default **off** so normal instances don't pay the boot cost.
3. **Doc** — note the flavor + `AGENT_AUTO_UPDATE` in `docs/MULTI_INSTANCE.md` under instance provisioning.

**Test command:** `docker build --build-arg RDV_IMAGE_FLAVOR=dev-env -t rdv-devenv:test .` (the in-Dockerfile smoke gate `command -v claude && … && command -v opencode` is the assertion).
**Expected:** build succeeds; the existing native-ABI + `rdv --version` + agent-CLI smoke gates pass. (CI builds this on Node 24 to match bun's ABI — memory: release-node24.)

---

### Task — Warm pool for agent-run envs
**Bead:** remote-dev-oyej.8 — **depends:** oyej.7 — **relates:** jvcx
**Files:**
- Create: `apps/supervisor/src/lib/warm-pool.ts`
- Modify: `apps/supervisor/src/db/schema.ts`, `apps/supervisor/src/controller/reconciler.ts`, `deploy/k8s/supervisor/supervisor.yaml`
- Test: `apps/supervisor/src/lib/__tests__/warm-pool.test.ts`, extend `reconciler.test.ts`

**Steps:**
1. **Schema** (`apps/supervisor/src/db/schema.ts`, after `instanceSeed` ~line 181):
```ts
export type WarmPoolStatus = "provisioning" | "ready" | "claimed" | "terminating";

export const warmPool = sqliteTable(
  "warm_pool",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    instanceId: text("instance_id").notNull().unique().references(() => instance.id, { onDelete: "cascade" }),
    status: text("status").$type<WarmPoolStatus>().notNull().default("provisioning"),
    imageTag: text("image_tag"),               // pinned dev-env flavor tag
    claimedByRunId: text("claimed_by_run_id"), // opaque main-app agentRun id
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    ttlExpiresAt: integer("ttl_expires_at", { mode: "timestamp_ms" }), // GC after this if unclaimed
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index("warm_pool_status_idx").on(t.status)],
);
export type WarmPoolRow = typeof warmPool.$inferSelect;
```
`bun run db:push` (in `apps/supervisor`).

2. **`warm-pool.ts`:**
   - `prewarm(deps, targetSize)` — count `ready`+`provisioning` rows; for the deficit, **create instances via jvcx's existing path** (insert a `requested` `instance` row exactly like `POST /api/instances`, verified `apps/supervisor/src/app/api/instances/route.ts:146-181`) and a paired `warmPool` row (`provisioning`). Do **not** reimplement provisioning.
   - Promotion: in the reconciler arm, when a pooled instance's `instance.status` becomes `ready`, flip its `warmPool` row `provisioning→ready` and set `ttlExpiresAt = now + SUPERVISOR_WARM_POOL_TTL_MS`.
   - `claimReady(deps, runId)` — atomic claim: `UPDATE warm_pool SET status='claimed', claimedByRunId=?, claimedAt=now WHERE id=(SELECT id FROM warm_pool WHERE status='ready' ORDER BY createdAt LIMIT 1) RETURNING *` (single-statement so two racing claims can't take the same row); returns the claimed instance or null (caller cold-starts).
   - `gcExpired(deps)` — for `ready` rows past `ttlExpiresAt`, request `terminating` via jvcx's terminate path; delete the `warmPool` row.

3. **`reconciler.ts`** — add `reconcileWarmPool(deps)` and call it from `reconcileInstances` after the per-instance loop. It runs `prewarm` toward `SUPERVISOR_WARM_POOL_SIZE`, promotes ready pooled instances, and `gcExpired`. Mirror the existing "no write on a no-op tick" + per-error-isolation discipline (`reconciler.ts:686-752`).

4. **`supervisor.yaml`** — add `SUPERVISOR_WARM_POOL_SIZE` (default 0 = disabled), `SUPERVISOR_WARM_POOL_TTL_MS`.

**Test command:** `bun run test:run` (in `apps/supervisor`) targeting `warm-pool.test.ts` + `reconciler.test.ts`.
**Expected:** `prewarm` with size 2 and 0 ready creates 2 `requested` instances + 2 `provisioning` pool rows; `claimReady` returns exactly one row and a concurrent second call returns null; `gcExpired` terminates only past-TTL unclaimed rows; reconciler arm promotes a pool row when its instance hits `ready`. Inject mocked DB + provisioner (the reconciler's `ReconcilerDeps` already supports this, verified `reconciler.ts:84-116`). Then `bun run lint && bun run typecheck` in `apps/supervisor`.

---

### Task — Scale-to-zero + wake-on-traffic for idle agent envs
**Bead:** remote-dev-oyej.9 — **relates:** jvcx
**Files:**
- Create: `apps/supervisor/src/lib/idle-detector.ts`, `apps/supervisor/src/app/api/internal/reaper/route.ts`, `deploy/k8s/supervisor/reaper-cronjob.yaml`
- Modify: `apps/supervisor/src/controller/reconciler.ts`, `deploy/k8s/supervisor/supervisor.yaml`
- Test: extend `apps/supervisor/src/controller/__tests__/reconciler.test.ts`

**Steps:**
1. **`idle-detector.ts`** — `isInstanceIdle(row, nowMs)`: an instance is idle when it has no active terminal sessions and its last activity is older than `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS`. Probe the instance data plane via `instance-proxy.ts` (oyej.10) `GET /<slug>/api/sessions?status=active`; treat an unreachable instance as **not idle** (never suspend on a failed probe — fail safe).
2. **Scale-to-zero** — in the reconciler's `ready` arm, when `isInstanceIdle` and the instance is a scale-to-zero candidate (a `warmPool`-claimed or labeled agent-run env), **request** `suspended`. jvcx's `reconcileSteadyState(...,0)` then scales the StatefulSet to 0 with the PVC retained (verified `reconciler.ts:556-619`). **Wake-on-traffic:** the supervisor agent-launch / delegation API (oyej.10/.11) requests `resume` (→ jvcx scales back to 1) before dispatching; the existing router blip on resume (~10-30s, 502/503) is **accepted** (same class as jvcx's §9 image-rollout blip — documented at `reconciler.ts:560-569`).
3. **`api/internal/reaper/route.ts`** — `POST` gated by `SUPERVISOR_REAPER_SECRET` (copy the `authorizeInternalRequest` pattern verified `apps/supervisor/src/app/api/internal/routes/route.ts:50-83`; refuse unauthenticated in prod). Runs idle-suspend + `warmPool.gcExpired` once and returns counts. This lets the suspend/GC sweep run on a schedule even if the 30s reconciler is conservative.
4. **`reaper-cronjob.yaml`** — k8s `CronJob` (every 5 min) that curls the reaper endpoint with the shared secret:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: rdv-reaper
  namespace: rdv-system
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: reaper
              image: curlimages/curl:latest   # auto-update tag (Docker policy)
              command: ["sh", "-c"]
              args:
                - >
                  curl -fsS -X POST
                  -H "x-supervisor-internal-secret: $REAPER_SECRET"
                  http://supervisor.rdv-system.svc.cluster.local:6003/api/internal/reaper
              env:
                - name: REAPER_SECRET
                  valueFrom:
                    secretKeyRef: { name: rdv-supervisor, key: reaper-secret }
```
5. **`supervisor.yaml`** — add `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS` + `SUPERVISOR_REAPER_SECRET` (from the `rdv-supervisor` Secret).

**Test command:** `bun run test:run` (in `apps/supervisor`) targeting `reconciler.test.ts`; `kubectl apply --dry-run=client -f deploy/k8s/supervisor/reaper-cronjob.yaml`.
**Expected:** an idle `ready` agent-run instance is transitioned toward `suspended` (audited); a busy or unreachable instance is left `ready`; the manifest validates. Mock the idle probe.

---

## Group D — Supervisor APIs

### Task — Supervisor agent-launch API (per-instance slug)
**Bead:** remote-dev-oyej.10
**Files:**
- Create: `apps/supervisor/src/lib/instance-proxy.ts`, `apps/supervisor/src/app/api/instances/[id]/agent/route.ts`
- Test: `apps/supervisor/src/app/api/instances/[id]/agent/__tests__/route.test.ts`

**Steps:**
1. **`instance-proxy.ts`** — `instanceFetch(row, path, init)`: build `https://${SUPERVISOR_INSTANCE_HOST}/${row.slug}${path}` (the instance image is slug-aware, serving under `/<slug>` — verified by the router design `apps/supervisor-router/src/index.ts:1-13`), attach the instance's programmatic credential as `Authorization: Bearer <key>`. The instance API key is provisioned per instance; resolve it from a supervisor-held secret/env (`SUPERVISOR_INSTANCE_API_KEY` for the homelab single-key model) and document the per-instance-key upgrade path.
2. **`api/instances/[id]/agent/route.ts`:**
```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import { instanceFetch } from "@/lib/instance-proxy";
import { requestResume } from "@/lib/lifecycle-actions";

export const POST = withSupervisorAuth("operator", async (request, { user, params }) => {
  const row = await db.query.instance.findFirst({ where: eq(instance.id, params!.id) });
  if (!row || !canManageInstance(user, row)) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 }); // 404 not 403 (owner-scope, matches existing routes)
  const body = await request.json() as { projectId: string; prompt: string; agentProvider?: string; agentFlags?: string[]; worktreeType?: string };
  if (row.status === "suspended") await requestResume(user, row.id);   // wake-on-traffic
  if (row.status !== "ready" && row.status !== "suspended")
    return NextResponse.json({ error: `instance not launchable (${row.status})`, code: "NOT_READY" }, { status: 409 });
  // Proxy into the instance's REAL agent-run launcher (oyej.1).
  const res = await instanceFetch(row, "/api/agent-runs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "manual", ...body }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
});
```
Uses `withSupervisorAuth("operator")` + `canManageInstance` (owner-scope, 404 not 403 — verified in the existing instance routes) and `requestResume` (verified `apps/supervisor/src/lib/lifecycle-actions.ts`, used by `/resume`).

**Test command:** `bun run test:run` (in `apps/supervisor`) targeting the new route test.
**Expected:** operator launches → 202 with the proxied run handle; viewer → 403; non-owner → 404; suspended instance → `requestResume` called then proxied; terminating instance → 409. Mock `instanceFetch` + `lifecycle-actions`. Then `bun run lint && bun run typecheck` in `apps/supervisor`.

---

### Task — Cross-instance delegation API
**Bead:** remote-dev-oyej.11 — **depends:** oyej.10
**Files:**
- Create: `apps/supervisor/src/app/api/delegate/route.ts`, `crates/rdv/src/commands/delegate.rs`
- Modify: `crates/rdv/src/commands/mod.rs`, `crates/rdv/src/main.rs`
- Test: `apps/supervisor/src/app/api/delegate/__tests__/route.test.ts`

**Steps:**
1. **`api/delegate/route.ts`** — `POST {toSlug, projectId, prompt, agentProvider?, agentFlags?, provisionIfMissing?}` (operator). Resolve the target `instance` by slug. If missing and `provisionIfMissing`, **create it via jvcx's create path** (insert `requested` — do not reimplement), return `202 {status:"provisioning", instanceId}` so the caller polls. If `ready`/`suspended`, delegate by calling the **same logic as oyej.10** (factor the proxy+resume into a shared `dispatchAgentRun(user,row,body)` helper used by both routes). This is the agent→supervisor→dispatch/provision flow.
2. **`delegate.rs`** — `rdv delegate --to <slug> --project-id <id> --prompt <text> [--provider X] [--provision-if-missing]`: POST to the supervisor delegation API (the supervisor base URL + token from env, `RDV_SUPERVISOR_URL`/`RDV_SUPERVISOR_TOKEN`). Register in `mod.rs` + `main.rs` like the other commands.

**Test command:** `bun run test:run` (in `apps/supervisor`) targeting the delegate route test; `cargo build --release -p rdv` (in worktree).
**Expected:** delegate to a `ready` instance → proxied 202; delegate to a missing slug without `provisionIfMissing` → 404; with it → 202 `provisioning` + a new `requested` instance row; `cargo build` succeeds and `rdv delegate --help` lists flags. Mock the shared dispatch helper + DB.

---

## Group E — Tests + docs

### Task — Tests + docs: schedules, triggers, Crown, warm pool
**Bead:** remote-dev-oyej.12
**Files:** all `__tests__` listed above (land with each task's TDD); plus
- Create: `docs/AUTOMATION.md`
- Modify: `docs/API.md`, `docs/openapi.yaml`, `docs/RDV_CLI.md`, `CHANGELOG.md`, `CLAUDE.md` (Subsystem Map row)

**Steps:**
1. Ensure each prior task shipped its unit tests (this bead is the coverage backstop, not a place to defer testing).
2. **`docs/AUTOMATION.md`** — end-to-end: agent schedules vs keystroke schedules (and *why* they're separate), the GitHub webhook setup (`GITHUB_WEBHOOK_SECRET`, `X-Hub-Signature-256`, supported events), trigger configs, Crown (fan-out → judge → auto-PR, manual override, the model-key-proxy/aehq dependency), warm pool + scale-to-zero (with the explicit **jvcx boundary**), and the supervisor agent-launch + delegation APIs + `rdv crown`/`rdv delegate`.
3. **`docs/API.md` + `openapi.yaml`** — add the new main-app routes (`/api/agent-schedules`, `/api/agent-runs`, `/api/webhooks/github`, `/api/trigger-configs`, `/api/crown`) and supervisor routes (`/api/instances/:id/agent`, `/api/delegate`, `/api/internal/reaper`).
4. **`docs/RDV_CLI.md`** — `rdv crown` + `rdv delegate`.
5. **`CHANGELOG.md`** under `## [Unreleased]` → Added: the platform features. **`CLAUDE.md`** Subsystem Map → one row pointing at `docs/AUTOMATION.md`.

**Test command (full gate, run once at the end in the integration worktree):**
```bash
bun run lint && bun run typecheck && bun run test:run
( cd apps/supervisor && bun run lint && bun run typecheck && bun run test:run )
( cd apps/supervisor-router && bun run typecheck )
cargo build --release -p rdv && cargo test -p rdv
docker build --build-arg RDV_IMAGE_FLAVOR=dev-env -t rdv-devenv:test .
kubectl apply --dry-run=client -f deploy/k8s/supervisor/reaper-cronjob.yaml
```
**Expected:** all green; docker smoke gates pass; manifest validates.

---

## Risks & Open Questions

1. **Model-call routing for the judge (aehq).** oyej.6's judge call routes through the **existing** model-key proxy (`litellm-process-manager`/`litellm-service` + `resolveProxyEnv`, verified `session-service.ts:74-113`) — the same plumbing agent sessions use for `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`. This *is* the aehq cross-link (`remote-dev-aehq`). If aehq lands a dedicated server-side `model.complete(...)` port, swap `crown-judge-endpoint.ts` to it (isolated seam). **Decision needed:** is the judge billed to the run's owner's configured model (current plan) or a system judge key? Plan assumes owner's model with a deterministic fallback so Crown never hard-fails.
2. **Webhook + agent-launch API security.** The GitHub webhook reuses the **constant-time** HMAC verifier (`deploy-webhook-auth.ts`), refuses unconfigured (`503`) — same posture as `/api/deploy`. The supervisor agent-launch/delegation APIs are `withSupervisorAuth("operator")` + owner-scope (404-not-403). The reaper endpoint copies the `/api/internal/routes` shared-secret gate (refuse unauthenticated in prod). **Open:** per-instance API keys vs a single `SUPERVISOR_INSTANCE_API_KEY` for the instance proxy — plan ships the single-key homelab model with a documented per-instance upgrade path.
3. **jvcx overlap boundary.** oyej.7/.8/.9 **must not** re-implement provisioning, scaling, suspend/resume, or the state machine — they add a `warmPool` table, a reconciler arm, a reaper, and a golden flavor. Suspend/resume + StatefulSet scaling are jvcx's `reconcileSteadyState`/`lifecycle-actions`; scale-to-zero only *requests* `suspended`. **Risk:** a future jvcx refactor of `ReconcilerDeps` could break the warm-pool arm — mitigated by injecting through the same `ReconcilerDeps` interface and adding the arm's cases to the shared `reconciler.test.ts`.
4. **Cost of warm pools.** A pre-warmed instance holds a PVC + (until idle-suspended) a running pod = real spend. Mitigations baked in: `SUPERVISOR_WARM_POOL_SIZE` defaults to **0** (opt-in); `ttlExpiresAt` GCs unclaimed envs; scale-to-zero suspends idle claimed envs (PVC retained, pod gone). **Open:** should claimed-but-finished envs be torn down or returned to the pool? Plan tears down (simpler; warm-pool rows are single-use) — revisit if cold-start latency dominates.
5. **Run completion detection.** Like the keystroke scheduler, an agent run's "done" is inferred from the session's `agentExitState` (same signal `rdv teams wait` uses), not a real exit code — long-running agents may sit `running` until the TUI exits. Crown's `waitForCandidates` therefore needs a timeout (default 30 min) after which un-exited candidates are judged on their diff-so-far or marked `failed`. **Open:** expose the timeout per Crown run (plan: yes, `--timeout`).
6. **`headSha` dedupe + nullable unique index.** The per-(triggerConfigId, headSha) unique index relies on SQLite treating NULLs as distinct (so schedule/manual runs with `headSha IS NULL` never collide). Verified behavior for libsql/SQLite; the `trigger-service.test.ts` redelivery case locks it in.

---

## Self-Review (writing-plans)

**Coverage vs all 12 beads:** oyej.1 (agent schedules → real launch) ✓ · oyej.2 (HMAC webhook) ✓ · oyej.3 (trigger config + UI) ✓ · oyej.4 (executor + state machine + per-head-SHA dedupe) ✓ · oyej.5 (Crown fan-out) ✓ · oyej.6 (judge + auto-PR + override) ✓ · oyej.7 (golden image) ✓ · oyej.8 (warm pool) ✓ · oyej.9 (scale-to-zero + reaper CronJob) ✓ · oyej.10 (supervisor agent-launch API) ✓ · oyej.11 (cross-instance delegation) ✓ · oyej.12 (tests + docs) ✓. Dependency edges respected in Build Sequence (.4 after .3+.1; .3 after .2; .6 after .5; .8 after .7; .11 after .10).

**Placeholder scan:** No `TODO`/`FIXME`/`...`/`<placeholder>` in code sketches. Every `### Task` has explicit Create/Modify/Test paths, concrete steps, real Drizzle/handler/manifest code, and a real test command + expected result. The fenced bodies marked with `/* … */` (`supersedePriorRuns`, `parseGithubEvent`, `renderTemplate`/`record`, `crown-diff-collector` internals) are intentionally-elided **bodies of fully-specified signatures** whose behavior is pinned by the adjacent prose + the test's expected cases — not unspecified work.

**Type-name consistency (fixed inline during review):**
- Run status union is `AgentRunStatus = "pending"|"running"|"completed"|"failed"|"superseded"` everywhere (schema, `agent-run.ts`, service).
- Tables: `agentSchedules`/`agent_schedule`, `agentRuns`/`agent_run`, `triggerConfigs`/`trigger_config`, `triggerEvents`/`trigger_event`, `crownRuns`/`crown_run`, `crownCandidates`/`crown_candidate`, `warmPool`/`warm_pool` — camelCase export + snake_case SQL, matching the repo convention (`sessionSchedules`/`session_schedule`).
- Crown judge result is `CrownJudgeResult { winner: string /* candidateId */; reason: string }`; stored as `crownRuns.winnerCandidateId` + `crownRuns.crownReason` (the bead's `crownReason`).
- Env vars consistent: `GITHUB_WEBHOOK_SECRET`, `SUPERVISOR_WARM_POOL_SIZE`, `SUPERVISOR_WARM_POOL_TTL_MS`, `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS`, `SUPERVISOR_REAPER_SECRET`, `SUPERVISOR_INSTANCE_API_KEY`, `AGENT_AUTO_UPDATE`, `RDV_IMAGE_FLAVOR`.
- **Cross-app schema caveat (fixed):** `agentSchedules`/`agentRuns`/`triggerConfigs`/`triggerEvents`/`crownRuns`/`crownCandidates` live in the **main app** `src/db/schema.ts`; `warmPool` lives in **`apps/supervisor/src/db/schema.ts`** (separate Drizzle SQLite app). Each is pushed with its own `bun run db:push` in its own app root. The four interdependent main-app tables (FK edges agentRuns↔triggerConfigs↔triggerEvents) are pushed together to avoid FK-ordering failure — noted in oyej.1 and oyej.3.
