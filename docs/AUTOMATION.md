# Agent Automation & Orchestration

> Epic **remote-dev-oyej**. Takes automation to the next level on the supervisor + k3s
> base: scheduled *agent runs*, GitHub-webhook-triggered runs, Crown best-of-N
> run-and-compare, a golden dev-env image, warm pools, scale-to-zero, and a
> supervisor agent-launch + cross-instance delegation API.

This page covers the three tiers end-to-end. The supervisor lifecycle primitives
(`instance` table, the `requested→provisioning→ready↔suspended→terminating→deleted`
state machine, suspend/resume, StatefulSet scaling) are owned by epic
**remote-dev-jvcx** (see `docs/MULTI_INSTANCE.md` + `docs/SUPERVISOR_DEPLOY.md`);
the warm pool / scale-to-zero pieces here **reuse** those primitives, they do not
re-implement them.

---

## 1. Agent schedules — cron + prompt → REAL agent launch

An **agent run** is a *real* non-interactive agent launch: it creates a fresh
`terminalType:"agent"` session (`autoLaunchAgent`), optionally in a git worktree,
then delivers a prompt to the agent. This is **distinct** from the keystroke-only
`sessionSchedules`/`scheduleCommands` (which send keystrokes to an *existing*
session and whose "success" only means the keystrokes were sent). Distinct
lifecycle → distinct tables (`agentSchedules`, `agentRuns`).

**Run state machine:** `pending → running → completed | failed`, plus
`superseded` for an older run replaced by a newer same-key delivery
(see triggers below).

| Table | Purpose |
|-------|---------|
| `agentSchedules` | Cron/one-time schedule + launch template (provider, flags, prompt, worktree). Cron columns mirror `sessionSchedules`. |
| `agentRuns` | One run instance from any source (`schedule`/`trigger`/`manual`/`crown`) + its provenance + the session it created + status. |

The cron loop runs in the **terminal server** (`agentSchedulerOrchestrator`,
sibling of the keystroke `schedulerOrchestrator`); it loads enabled schedules at
boot and fires `AgentRunService.launchAgentRun()`. The launch reuses the same
`SessionService.createSessionWithDedupFlag` path an interactive agent session
uses, then delivers the prompt via tmux `send-keys` with `\r` (the Claude/Codex
TUI requires the carriage return to submit) after a pane-quiescent wait.

**API**

| Method | Route | Notes |
|--------|-------|-------|
| `GET`/`POST` | `/api/agent-schedules` | list / create (`?projectId` filter). Create notifies the orchestrator fire-and-forget. |
| `GET`/`PATCH`/`DELETE` | `/api/agent-schedules/:id` | update / delete + notify. |
| `GET` | `/api/agent-runs` | list runs (`?scheduleId`/`?triggerConfigId`/`?status`). |
| `POST` | `/api/agent-runs` | immediate **manual** launch (`source:"manual"`). |

All routes use `withApiAuth` (dual browser-session / API-key). The **Triggers**
settings tab provides a UI shell for trigger configs (below).

---

## 2. GitHub-webhook triggers

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

### Per-head-SHA dedupe

`agentRuns` has a **unique `(triggerConfigId, headSha)`** index. GitHub redelivers
events, so a duplicate delivery for the same head SHA hits `ON CONFLICT` — the
`TriggerService` catches the unique violation, skips the second run, and marks
older non-terminal same-key runs `superseded`. The index is nullable-composite:
schedule/manual runs (`headSha IS NULL`) never collide (NULLs are distinct in
SQLite and Postgres).

**API:** `GET`/`POST` `/api/trigger-configs`, `GET`/`PATCH`/`DELETE`
`/api/trigger-configs/:id` (`withApiAuth`). Each matched event is logged in
`triggerEvents` (audit + dedupe support).

---

## 3. Crown — best-of-N run-and-compare

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
   terminal (same exit-state signal `teams wait` uses), bounded by a timeout
   (default 30 min, `--timeout`).
3. **Diff collection** (`crown-diff-collector`) — `git diff <base>...<branch>`
   per candidate, excluding lockfiles / `node_modules` / build output / binary
   hunks, truncated to ~64KB.
4. **Judge** (`crown-judge`) — an LLM judge picks a winner and a one-sentence
   reason. The model call routes through the **existing model-key proxy**
   (`litellm-process-manager` / `litellm-service`, the same plumbing agent
   sessions use for `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` — the **aehq**
   cross-link). **No model configured → deterministic fallback** (largest
   non-trivial diff wins), so Crown never hard-fails on a missing key.
5. **Auto-PR** — `gh pr create --head <winnerBranch> --base <base>` (the runtime
   image ships `gh`); the PR URL is stored on the run.

**Manual override:** `POST /api/crown/:id {action:"pr", candidateId}` opens a PR
for an operator-chosen candidate regardless of the judge's pick.

**API:** `GET`/`POST` `/api/crown` (list / start — async, returns `crownRunId`);
`GET` `/api/crown/:id` (status + candidates + diffs + judge result); `POST`
`/api/crown/:id` (manual override).

**CLI:** `rdv crown start --project-id <id> --count N --provider <p> --prompt "…"
[--judge-model M]`, `rdv crown status <id>`, `rdv crown pr <id> --candidate <cid>`.

---

## 4. Golden dev-env image

The runtime image is a **golden dev-env**: it already bakes all 5 agent CLIs
(`claude`, `codex`, `gemini`, `opencode`, best-effort `agy`) onto the system
PATH, plus `sudo` + functional `apt`, `python3`/`venv`/`pipx`, and `gh`, with a
build-time `command -v` smoke gate.

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

## 5. Warm pool + scale-to-zero (supervisor — extends jvcx)

> **jvcx boundary:** the warm pool adds a `warmPool` table, a reconciler *arm*,
> and a reaper. It **reuses** jvcx's create path (insert a `requested` `instance`
> row) and terminate path, and only *requests* `suspended` for scale-to-zero —
> jvcx's `reconcileSteadyState` does the StatefulSet scaling. It does **not**
> re-implement provisioning, scaling, or the state machine.

**Warm pool** (`warm_pool` table, status `provisioning → ready → claimed →
terminating`):

- `prewarm(size)` — create the deficit toward `SUPERVISOR_WARM_POOL_SIZE`
  (default **0** = disabled) via jvcx's create path + a paired `provisioning`
  pool row.
- Promotion — the reconciler arm flips `provisioning → ready` (+ `ttlExpiresAt`)
  once a pooled instance's `instance.status` reaches `ready`.
- `claimReady(runId)` — single-statement atomic claim of the oldest `ready` row
  (two racing claims can't take the same row); returns null when none → caller
  cold-starts.
- `gcExpired()` — request `terminating` + delete the pool row for unclaimed
  `ready` rows past their TTL (`SUPERVISOR_WARM_POOL_TTL_MS`).

The arm runs from `reconcileInstances` after the per-instance loop, isolated so a
warm-pool error never aborts the instance reconcile.

**Scale-to-zero** (`idle-detector` + reaper):

- `isInstanceIdle` — idle when reachable, zero active terminal sessions, and last
  activity older than `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS`. **Fail-safe:** an
  unreachable instance is treated as *not* idle (never suspend on a failed probe).
- Idle claimed agent-run envs are *requested* `suspended` → jvcx scales the
  StatefulSet to 0 (PVC retained). **Wake-on-traffic:** the supervisor
  agent-launch / delegation API resumes a suspended instance before dispatching;
  the brief router blip on resume (~10–30s, 502/503) is accepted (same class as
  jvcx's §9 image-rollout blip).
- **Reaper:** `POST /api/internal/reaper` (gated by `SUPERVISOR_REAPER_SECRET`,
  mirroring `/api/internal/routes` — refuses unauthenticated in prod) runs the
  idle-suspend sweep + warm-pool GC once and returns counts. A CronJob
  (`deploy/k8s/supervisor/reaper-cronjob.yaml`, every 5 min) curls it so the
  sweep runs on a schedule even when the 30s reconciler is conservative.

---

## 6. Supervisor agent-launch + cross-instance delegation

**Per-instance agent launch** — `POST /api/instances/:id/agent` (operator):
proxies into the instance's REAL agent-run launcher (`POST /<slug>/api/agent-runs`)
via `instance-proxy`. Owner-scoped (**404, not 403**, when missing/not visible —
matches the existing instance routes). A suspended instance is woken first
(wake-on-traffic); a terminating/provisioning instance → `409`. Returns the
proxied run handle.

**Cross-instance delegation** — `POST /api/delegate` (operator):
`{toSlug, projectId, prompt, agentProvider?, provisionIfMissing?}`. Resolves the
target by slug; if missing and `provisionIfMissing`, creates it via jvcx's create
path and returns `202 {status:"provisioning", instanceId}` (poll until ready); if
`ready`/`suspended`, delegates via the **same** shared `dispatchAgentRun` helper
the agent-launch route uses.

**CLI:** `rdv delegate --to <slug> --project-id <id> --prompt "…" [--provider X]
[--provision-if-missing]` (supervisor base URL + token from `RDV_SUPERVISOR_URL` /
`RDV_SUPERVISOR_TOKEN`).

> **Instance API key:** the proxy presents `SUPERVISOR_INSTANCE_API_KEY` (the
> single-key homelab model); per-instance keys are the documented upgrade path.

---

## Environment variables

| Var | Where | Purpose |
|-----|-------|---------|
| `GITHUB_WEBHOOK_SECRET` | main app | HMAC secret for `/api/webhooks/github` (unset → 503). |
| `RDV_IMAGE_FLAVOR` | image | self-identify the dev-env flavor (default `dev-env`). |
| `AGENT_AUTO_UPDATE` | image entrypoint | `1` (default) refresh agent CLIs on boot; `0` to skip. |
| `SUPERVISOR_WARM_POOL_SIZE` | supervisor | warm-pool target size (default **0** = disabled). |
| `SUPERVISOR_WARM_POOL_TTL_MS` | supervisor | unclaimed `ready` env GC TTL (default 30 min). |
| `SUPERVISOR_WARM_POOL_OWNER_ID` | supervisor | `supervisor_user.id` warm-pool instances are owned by. |
| `SUPERVISOR_AGENT_IDLE_TIMEOUT_MS` | supervisor | idle → scale-to-zero threshold (default 30 min). |
| `SUPERVISOR_REAPER_SECRET` | supervisor | shared secret gating `/api/internal/reaper` (refuses unauthenticated in prod). |
| `SUPERVISOR_INSTANCE_API_KEY` | supervisor | instance credential for the agent-launch proxy. |
| `RDV_SUPERVISOR_URL` / `RDV_SUPERVISOR_TOKEN` | `rdv` CLI | supervisor base URL + operator token for `rdv delegate`. |

## See also

- `docs/MULTI_INSTANCE.md`, `docs/SUPERVISOR_DEPLOY.md` — the supervisor platform (jvcx).
- `docs/RDV_CLI.md` — `rdv crown`, `rdv delegate`.
- `docs/API.md`, `docs/openapi.yaml` — full route reference.
