# Agent Automation & Orchestration

> Real, non-interactive agent runs layered on the supervisor platform: schedule a
> prompt, fire one from a GitHub webhook, or fan a prompt out to N agents and let
> an LLM judge pick a winner and open the PR. **Maturity varies by tier** — the
> table below says at a glance what is production-ready, what is Beta with a known
> gap, and what is still scaffolding.

An **agent run** is a *real* non-interactive agent launch: it creates a fresh
`terminalType:"agent"` session (`autoLaunchAgent`), optionally in a git worktree,
then delivers a prompt to the agent. This is **distinct** from the keystroke-only
`sessionSchedules`/`scheduleCommands` path (which sends keystrokes to an *existing*
session and whose "success" only means the keystrokes were sent). Distinct
lifecycle → distinct tables (`agentSchedules`, `agentRuns`).

The supervisor lifecycle primitives this page builds on (the `instance` table, the
`requested→provisioning→ready↔suspended→terminating→deleted` state machine,
suspend/resume, StatefulSet scaling) are documented in `docs/MULTI_INSTANCE.md` +
`docs/SUPERVISOR_DEPLOY.md`. The warm pool / scale-to-zero pieces here **reuse**
those primitives; they do not re-implement them.

---

## Maturity at a glance

| Status | Meaning |
|--------|---------|
| **Shipped** | Wired end-to-end and in use. |
| **Beta** | Core path works, but a specific gap is called out inline. |
| **Experimental (inert)** | Flag-gated off by default or scaffolding with no live consumer — not usable as delivered. |
| **Planned** | Not built yet (stub / `501`). |

| Capability | Status | Interface | Notes |
|------------|--------|-----------|-------|
| Triggered agent runs — GitHub webhook (§2) | **Shipped** | API + Settings UI | HMAC-verified webhook; per-delivery + per-commit dedup. The most complete tier. |
| Scheduled agent runs (§1) | **Beta** | API only | Cron launch works; a run is **never marked `completed`**, so run history reads as stuck "running". No UI. |
| Crown — best-of-N + judge + auto-PR (§3) | **Beta** | API + CLI | Full pipeline + real judge + `gh` auto-PR, but **every run waits the full ~30-min timeout** before judging. No UI. |
| Supervisor agent-launch + delegation (§6) | **Shipped** | API + CLI | `POST /api/instances/:id/agent`, `POST /api/delegate`, `rdv delegate`. No UI. |
| Golden dev-env image (§4) | **Shipped** | Image build | Bakes all 5 agent CLIs; opt-out background auto-update. |
| Warm pool (§5) | **Experimental (inert)** | — | `SUPERVISOR_WARM_POOL_SIZE=0` by default; `claimReady` has **no production caller**, so pooled envs are never consumed. |
| Scale-to-zero (§5) | **Experimental (inert)** | — | The reaper only evaluates **claimed** warm-pool rows → **zero candidates** in practice. |
| k3s worker machines + capacity control | **Planned** | — | Supervisor Phase 3-4; `/api/nodes` → `501`. |

---

## 1. Scheduled agent runs — cron + prompt → real agent launch

**Status: Beta.** Cron-driven launch works end-to-end; run-completion tracking does
not (see the gap below). API only — there is no CLI command and no settings UI for
schedules.

| Table | Purpose |
|-------|---------|
| `agentSchedules` | Cron/one-time schedule + launch template (provider, flags, prompt, worktree). Cron columns mirror `sessionSchedules`. |
| `agentRuns` | One run instance from any source (`schedule`/`trigger`/`manual`/`crown`) + its provenance + the session it created + status. |

The cron loop runs in the **terminal server** (`agentSchedulerOrchestrator`,
sibling of the keystroke `schedulerOrchestrator`); it loads enabled schedules at
boot via [`croner`](https://www.npmjs.com/package/croner) and fires
`AgentRunService.launchAgentRun()`. The launch reuses the same
`SessionService.createSessionWithDedupFlag` path an interactive agent session
uses, then delivers the prompt via tmux `send-keys` with `\r` (the Claude/Codex
TUI requires the carriage return to submit) after a pane-quiescent wait.

**Run state machine — as implemented.** `launchAgentRun` inserts a run as
`pending`, then — once the agent session is created and the prompt delivered —
transitions it to `running`. A launch failure goes to `failed` (with the error and
`completedAt`). A trigger redelivery can mark an older same-key run `superseded`.

> **Known gap (why this tier is Beta).** There is **no code path that writes
> `completed`.** The schema defines a `completed` status and a `completedAt`
> column, and the source comments describe `pending → running → completed |
> failed`, but nothing watches the launched agent session to closure. A run that
> launches successfully stays `running` **indefinitely**, so `GET /api/agent-runs`
> history reads as perpetually in-flight. Read `running` as "launched OK", not
> "still working"; only `failed` is an observed terminal state on the success
> path's failure. Completion tracking is not yet wired
> (`src/services/agent-run-service.ts`).

**API**

| Method | Route | Notes |
|--------|-------|-------|
| `GET`/`POST` | `/api/agent-schedules` | list / create (`?projectId` filter). Create notifies the orchestrator fire-and-forget. |
| `GET`/`PATCH`/`DELETE` | `/api/agent-schedules/:id` | update / delete + notify. |
| `GET` | `/api/agent-runs` | list runs (`?scheduleId`/`?triggerConfigId`/`?status`). |
| `POST` | `/api/agent-runs` | immediate **manual** launch (`source:"manual"`). |

All routes use `withApiAuth` (dual browser-session / API-key). There is no
dedicated `rdv` command for schedules or runs and no Settings section — the only
automation settings UI is the **Triggers** tab (§2).

---

## 2. Triggered runs — GitHub webhooks

**Status: Shipped.** This is the most complete automation tier: an HMAC-verified
webhook, two layers of de-duplication, and a real settings UI
(`src/components/settings/sections/TriggersSection.tsx`, surfaced as the
**Triggers** tab in Settings).

A **trigger config** binds a GitHub event kind + filter to an agent-launch
template; a matching inbound webhook event fires a real agent run.

### Webhook endpoint

`POST /api/webhooks/github` — HMAC-SHA256, structurally mirroring `/api/deploy`:

- Set `GITHUB_WEBHOOK_SECRET` (unset → `503`).
- GitHub sends `X-Hub-Signature-256: sha256=<hex>` over the raw body; verified in
  constant time (same verifier as the deploy webhook).
- `ping` → `200 {message:"pong"}`; tampered body → `401`; non-JSON → `400`.
- On success it answers `202` immediately and dispatches the trigger match
  **fire-and-forget**, so GitHub's ~10s delivery budget is never blocked on an
  agent launch.

Configure a repo webhook → `https://<host>/api/webhooks/github`, content-type
`application/json`, secret = `GITHUB_WEBHOOK_SECRET`, events: pull requests,
issues, check suites.

### Supported event kinds

| `kind` | Fires on | Filter |
|--------|----------|--------|
| `pr_labeled` | `pull_request` / `labeled` | requires `{ "label": "<name>" }` |
| `issue_opened` | `issues` / `opened` | — |
| `ci_failed` | `check_suite` / `completed` with `conclusion: failure` | — |

The prompt template substitutes `{{repo}}`, `{{prNumber}}`, `{{issueNumber}}`.

### De-duplication (two layers)

GitHub redelivers events (manual replay + its own retries), so the dispatcher
dedupes at two levels (`TriggerService`):

1. **Per-delivery UUID** — each `X-GitHub-Delivery` id is claimed atomically in
   `webhookDeliveries` (`INSERT … ON CONFLICT DO NOTHING … RETURNING`). A
   redelivery loses the claim and no-ops. This covers events that carry **no head
   SHA** (issues / labels), which the per-SHA guard below cannot dedupe.
2. **Per-head-SHA** — `agentRuns` has a **unique `(triggerConfigId, headSha)`**
   index. A duplicate delivery for the same head SHA hits `ON CONFLICT`; the
   service catches the unique violation, skips the second run, and marks older
   non-terminal same-key runs `superseded`. The index is nullable-composite, so
   schedule/manual runs (`headSha IS NULL`) never collide (NULLs are distinct in
   SQLite and Postgres).

A trigger config only matches when the event's repo resolves to a known
`githubRepositories` row bound to that config — an event for an unknown/unbound
repo dispatches **zero** runs (cross-repo / cross-tenant guard).

**API:** `GET`/`POST` `/api/trigger-configs`, `GET`/`PATCH`/`DELETE`
`/api/trigger-configs/:id` (`withApiAuth`). Each matched event is logged in
`triggerEvents` (audit + dedupe support). The Triggers tab lists, creates,
toggles, and deletes configs against these routes.

---

## 3. Crown — best-of-N run-and-compare

**Status: Beta.** The whole pipeline is real — fan-out, diff collection, a real
LLM judge (with a deterministic fallback), and an auto-PR via `gh` — but it is
gated by the same run-completion gap as §1, so **every run waits the full timeout
before judging**. Driven from the API or `rdv crown`; there is no UI.

Crown = **same prompt → N agents → N worktree branches → collect filtered diffs →
LLM judge picks a winner → auto-PR the winner.** It builds on the same fan-out
primitive `rdv teams` uses, driven server-side via N
`AgentRunService.launchAgentRun({ source:"crown", worktreeType:"feature" })` calls
sharing a `crownRunId`.

**Run lifecycle:** `running → judging → completed | failed`.

| Table | Purpose |
|-------|---------|
| `crownRuns` | The run: prompt, candidate count, judge model, winner, reason, PR URL, status. |
| `crownCandidates` | Each candidate: its branch, worktree path, filtered diff, diff stats. |

1. **Fan-out** — N candidates, each in its own worktree branch.
2. **Wait** — `waitForCandidates` polls each candidate's `agentRuns.status` until
   terminal, bounded by a timeout (default 30 min, `--timeout`).
3. **Diff collection** (`crown-diff-collector`) — `git diff <base>...<branch>`
   per candidate, excluding lockfiles / `node_modules` / build output / binary
   hunks, truncated to ~64KB.
4. **Judge** (`crown-judge`) — an LLM judge picks a winner and a one-sentence
   reason. The model call routes through the existing model-key proxy
   (`litellm-process-manager` / `litellm-service`, the same plumbing agent
   sessions use for `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`). **No model
   configured → deterministic fallback** (largest non-trivial diff wins), so Crown
   never hard-fails on a missing key.
5. **Auto-PR** — `gh pr create --head <winnerBranch> --base <base>` (the runtime
   image ships `gh`); the PR URL is stored on the run.

> **Known gap (why this tier is Beta).** Step 2's wait returns early only once
> **every** candidate reaches a terminal `agentRuns.status` (`completed` /
> `failed` / `superseded`). But per §1, a candidate that runs successfully **never
> reaches `completed`** — so in practice the wait loop always runs to its deadline
> and Crown judges only **after the full timeout (default 30 min) on every run**,
> even when the agents finished quickly. The judge, diff collection, and auto-PR
> themselves work; the run simply isn't gated on the agents actually signalling
> completion (`src/services/crown-service.ts`, `waitForCandidates`).

**Manual override:** `POST /api/crown/:id {action:"pr", candidateId}` opens a PR
for an operator-chosen candidate regardless of the judge's pick.

**API:** `GET`/`POST` `/api/crown` (list / start — async, returns `crownRunId`);
`GET` `/api/crown/:id` (status + candidates + diffs + judge result); `POST`
`/api/crown/:id` (manual override).

**CLI:** `rdv crown start --project-id <id> --count N --provider <p> --prompt "…"
[--judge-model M]`, `rdv crown status <id>`, `rdv crown pr <id> --candidate <cid>`.

---

## 4. Golden dev-env image

**Status: Shipped.** The runtime image is a **golden dev-env**: it already bakes
all 5 agent CLIs (`claude`, `codex`, `gemini`, `opencode`, best-effort `agy`) onto
the system PATH, plus `sudo` + functional `apt`, `python3`/`venv`/`pipx`, and `gh`,
with a build-time `command -v` smoke gate.

- **Flavor self-identification:** `ARG RDV_IMAGE_FLAVOR=dev-env` → `ENV
  RDV_IMAGE_FLAVOR` so the image self-identifies (the warm pool can confirm a node
  can run agent runs). Base images are intentionally **not pinned** (global Docker
  auto-update policy).
- **Opt-out agent auto-update:** the entrypoint refreshes the baked agent CLIs in
  the background after the servers are up. `AGENT_AUTO_UPDATE` gates it —
  default `1` (refresh on boot); set `AGENT_AUTO_UPDATE=0` to skip the npm refresh
  + `agy` retry (fast-boot / pinned-version instances). It runs fully backgrounded
  so it never delays readiness either way.

Build: `docker build --build-arg RDV_IMAGE_FLAVOR=dev-env -t rdv-devenv:test .`
(CI builds on Node 24 to match bun's native ABI).

---

## 5. Warm pool + scale-to-zero (supervisor)

**Status: Experimental (inert).** Both are implemented and unit-tested as
supervisor mechanics, but **neither is connected to a live consumer**, so with the
default configuration they do nothing useful. Documented here as forward-looking
scaffolding, not a delivered feature.

- The warm pool is **disabled by default** (`SUPERVISOR_WARM_POOL_SIZE=0`;
  `reconcileWarmPool` returns immediately). More fundamentally, **nothing ever
  claims a warm env**: `warm-pool.ts:claimReady()` has no production caller (only
  tests), so even when sized, pooled instances are provisioned, promoted, and
  TTL-GC'd but never handed to an agent run.
- Scale-to-zero's reaper only considers instances paired with a **`claimed`**
  warm-pool row. Since no row ever reaches `claimed` (see above), the idle-suspend
  sweep has **zero candidates** in practice; only the warm-pool TTL-GC does any
  work.

> **jvcx boundary:** the warm pool adds a `warm_pool` table, a reconciler *arm*,
> and a reaper. It **reuses** the supervisor's create path (insert a `requested`
> `instance` row) and terminate path, and only *requests* `suspended` for
> scale-to-zero — the supervisor's `reconcileSteadyState` does the StatefulSet
> scaling. It does **not** re-implement provisioning, scaling, or the state
> machine.

**Warm pool** (`warm_pool` table, status `provisioning → ready → claimed →
terminating`) — the mechanics that exist:

- `prewarm(size)` — create the deficit toward `SUPERVISOR_WARM_POOL_SIZE` via the
  create path + a paired `provisioning` pool row. Size `0` (default) is a no-op.
- Promotion — the reconciler arm flips `provisioning → ready` (+ `ttlExpiresAt`)
  once a pooled instance's `instance.status` reaches `ready`.
- `claimReady(runId)` — atomic guarded claim of the oldest `ready` row (two racing
  claims can't take the same row); returns null when none. **No production code
  calls this**, which is why the pool is inert.
- `gcExpired()` — request `terminating` + delete the pool row for unclaimed
  `ready` rows past their TTL (`SUPERVISOR_WARM_POOL_TTL_MS`).

The arm runs from `reconcileInstances` after the per-instance loop, isolated so a
warm-pool error never aborts the instance reconcile.

**Scale-to-zero** (`idle-detector` + reaper) — the mechanics that exist:

- `isInstanceIdle` — idle when reachable, zero active terminal sessions, and last
  activity older than `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS`. **Fail-safe:** an
  unreachable instance is treated as *not* idle (never suspend on a failed probe).
- Idle **claimed** agent-run envs would be *requested* `suspended` → the
  supervisor scales the StatefulSet to 0 (PVC retained). Because no env ever
  reaches `claimed`, this branch is never entered.
- **Reaper:** `POST /api/internal/reaper` (gated by `SUPERVISOR_REAPER_SECRET`,
  mirroring `/api/internal/routes` — refuses unauthenticated in prod) runs the
  idle-suspend sweep + warm-pool GC once and returns counts. A CronJob
  (`deploy/k8s/supervisor/reaper-cronjob.yaml`, every 5 min) curls it. Today it
  only ever does warm-pool TTL-GC work.

**Wake-on-traffic** (the intended resume path once a consumer exists): the
supervisor agent-launch / delegation API (§6) resumes a suspended instance before
dispatching; the brief router blip on resume (~10–30s, 502/503) is accepted (same
class as the supervisor's image-rollout blip).

---

## 6. Supervisor agent-launch + cross-instance delegation

**Status: Shipped (API + CLI, no UI).** Both routes funnel through one shared
`dispatchAgentRun` helper (`apps/supervisor/src/lib/agent-dispatch.ts`).

**Per-instance agent launch** — `POST /api/instances/:id/agent` (operator):
proxies into the instance's real agent-run launcher (`POST /<slug>/api/agent-runs`)
via `instance-proxy`. Owner-scoped (**404, not 403**, when missing/not visible —
matches the existing instance routes). A suspended instance is woken first
(wake-on-traffic); a terminating/provisioning instance → `409`. Returns the
proxied run handle.

**Cross-instance delegation** — `POST /api/delegate` (operator):
`{toSlug, projectId, prompt, agentProvider?, provisionIfMissing?}`. Resolves the
target by slug; if missing and `provisionIfMissing`, creates it via the
supervisor's create path and returns `202 {status:"provisioning", instanceId}`
(poll until ready); if `ready`/`suspended`, delegates via the **same**
`dispatchAgentRun` helper the agent-launch route uses.

**CLI:** `rdv delegate --to <slug> --project-id <id> --prompt "…" [--provider X]
[--provision-if-missing]` (supervisor base URL + token from `RDV_SUPERVISOR_URL` /
`RDV_SUPERVISOR_TOKEN`).

> **Instance API key:** the proxy presents `SUPERVISOR_INSTANCE_API_KEY` (the
> single-key homelab model); per-instance keys are the documented upgrade path.

> **Not yet: k3s worker machines + capacity control (Planned).** Node listing and
> capacity-aware placement are Supervisor Phase 3-4 — `/api/nodes` currently
> returns `501` (`PHASE1_PENDING`). See `docs/MULTI_INSTANCE.md`.

---

## Environment variables

| Var | Where | Purpose |
|-----|-------|---------|
| `GITHUB_WEBHOOK_SECRET` | main app | HMAC secret for `/api/webhooks/github` (unset → 503). |
| `RDV_IMAGE_FLAVOR` | image | self-identify the dev-env flavor (default `dev-env`). |
| `AGENT_AUTO_UPDATE` | image entrypoint | `1` (default) refresh agent CLIs on boot; `0` to skip. |
| `SUPERVISOR_WARM_POOL_SIZE` | supervisor | warm-pool target size (default **0** = disabled; the pool is also inert regardless — see §5). |
| `SUPERVISOR_WARM_POOL_TTL_MS` | supervisor | unclaimed `ready` env GC TTL (default 30 min). |
| `SUPERVISOR_WARM_POOL_OWNER_ID` | supervisor | `supervisor_user.id` warm-pool instances are owned by. |
| `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS` | supervisor | idle → scale-to-zero threshold (default 30 min). |
| `SUPERVISOR_REAPER_SECRET` | supervisor | shared secret gating `/api/internal/reaper` (refuses unauthenticated in prod). |
| `SUPERVISOR_INSTANCE_API_KEY` | supervisor | instance credential for the agent-launch proxy. |
| `RDV_SUPERVISOR_URL` / `RDV_SUPERVISOR_TOKEN` | `rdv` CLI | supervisor base URL + operator token for `rdv delegate`. |

## See also

- `docs/MULTI_INSTANCE.md`, `docs/SUPERVISOR_DEPLOY.md` — the supervisor platform.
- `docs/RDV_CLI.md` — `rdv crown`, `rdv delegate`.
- `docs/API.md`, `docs/openapi.yaml` — full route reference.
