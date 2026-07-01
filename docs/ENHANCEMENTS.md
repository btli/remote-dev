# Capabilities & Roadmap

Remote Dev started as a web terminal and grew into a workspace for running and coordinating multiple
AI coding agents. This document is an **honest capabilities ledger**: it groups every notable feature
by maturity — what is production-ready, what is partial, what is flag-gated or inert, what is planned,
and what has been removed. When in doubt, entries under-claim.

> **Live status lives in beads (`bd`), not here.** For what is in-flight, ready, or blocked right
> now, run `bd ready` / `bd list` / `bd show <id>`. This file maps the territory; beads is the tracker.

See also: [Documentation index](./README.md) · [Architecture](./ARCHITECTURE.md) ·
[Automation](./AUTOMATION.md) · [Agents](./AGENTS.md)

_Last updated: 2026-07-01 (v0.3.18)._

Status vocabulary:

- **Delivered** — implemented, wired end to end, in use.
- **Partial** — works, but incomplete or rough in a way the Notes make explicit.
- **Experimental** — flag-gated off by default, or scaffolding not yet wired to a UI or caller.
- **Planned** — skeleton or unbuilt.
- **Deprecated / removed** — dead, superseded, or intentionally removed.

---

## Delivered (production-ready)

### Agents & sessions

| Capability | Notes |
|------------|-------|
| Persistent tmux sessions | Multiple terminals backed by tmux; survive refreshes, disconnects, and server restarts. |
| Suspend / resume | Detach and reattach with full scrollback. |
| Multi-agent CLI support (5) | Claude Code, OpenAI Codex, Gemini CLI, Antigravity, OpenCode — installation detection, version checks, and per-provider config templates. Antigravity has no public installer and no session resume. |
| Agent profiles & isolation | Fully isolated `HOME` + agent config directories per profile: own credentials, git identity, and appearance/theming; per-project profile binding. |
| Live status & exit handling | Agent sessions expose a running/exited/restarting state machine, exit codes, restart counts, and a custom exit screen. |
| Session resume | Reattach to prior agent sessions for four of five providers (Antigravity relaunches fresh). |
| Claude usage-limit management | Per-profile 5h/7d limit state, **reactive** limit detection from terminal output, group-inherited primary + fallback pools with auto-rotation, and server-side auto-apply of the resolved profile at session creation. |
| Recording & playback | Capture on desktop web; play recordings back on any client. |
| Terminal types | Five session kinds — `shell`, `agent`, `file` (a real CodeMirror editor across many languages, path-jailed), `ssh` (tmux-backed remote shells), and `browser`. The `browser` type is functional but thin — screenshot-based (~1fps poll), click/type/navigate only (tracked under Partial). |
| Trash & restore | Soft-delete with 30-day retention for **worktree** sessions, with worktree-aware restore. |

### Organization & collaboration

| Capability | Notes |
|------------|-------|
| Project group + project tree | Two-level hierarchy; groups are nestable containers, projects own sessions/tasks/channels/secrets/bindings. |
| Preference inheritance | Default → User → Group chain → Project; group-active views aggregate across descendant projects. |
| Tasks (manual) | Priorities, labels, subtasks, dependencies (blocked-by), due dates, and group roll-ups via UI/API/CLI. There is **no** automatic agent-TodoWrite sync (see Deprecated). |
| Channels | Slack-style channel groups, channels, and DMs with GitHub-flavored markdown, threads, and per-user unread tracking. |
| Notifications | **Coalescing** (60s window), actionable notifications with toast integration and FCM push; `rdv notification` CLI access. |

### Git, GitHub & SSH

| Capability | Notes |
|------------|-------|
| Multi-account GitHub | Link multiple accounts, bind one per project. Browse/clone repos and branches; **view and create issues**. Write scope is create-issue only — no commenting, issue editing, or PR writes. |
| Git worktrees | Isolated worktrees for branch-per-task workflows, with trash/restore and `git worktree repair`. |
| SSH connections | User-scoped saved targets with paste/upload key, generated ed25519 keypair, password/agent/system auth, encrypted password storage, strict key permissions, a rate-limited connectivity probe, and public-key export. The best-tested operational area. |

### Model routing & MCP

These were previously filed as "planned" — an undersell. They are implemented and, in two cases,
have a settings UI.

| Capability | Notes |
|------------|-------|
| External MCP server management | Database-backed registry for **external** MCP servers with per-project/global inheritance and a settings UI (`MCPServersSection`). "Lifecycle" here means enable/disable, spawn-for-tool-discovery, and health timestamps — not a long-running supervised daemon. (Separate from the built-in `rdv` MCP server used for peer messaging.) |
| LiteLLM proxy & analytics | Opt-in managed LiteLLM process (auto-starts when enabled in the DB) with a settings panel — the closest thing to a usage/analytics dashboard today. |

### Operations & deployment

| Capability | Notes |
|------------|-------|
| Multi-instance hosting (Shape A) | `RDV_BASE_PATH` is a runtime URL prefix, so one image serves many slugs from root. See [MULTI_INSTANCE.md](./MULTI_INSTANCE.md). |
| Blue/green deploys | Slot-based active/inactive swap with rollback and an optional HMAC-signed deploy webhook. See [DEPLOYMENT.md](./DEPLOYMENT.md). |
| PostgreSQL backend | Optional dual backend via `DATABASE_URL` (SQLite default); migrate-on-boot. PostgreSQL test suites run locally via testcontainers — **not in CI**. |
| Server-to-server migration | `rdv migrate` moves an instance between servers via a state machine. Caveat: migrated projects land at the tree root — group structure is not preserved. |
| Structured logging | Server-side structured logs in a separate SQLite database with retention, viewable in an in-app Logs tab. |

### Automation & multi-tenant control plane

| Capability | Notes |
|------------|-------|
| Triggered agent runs | HMAC-verified GitHub webhook runs with per-head-SHA de-duplication and a settings UI (`TriggersSection`). The most complete automation tier. |
| Supervisor platform (Phase 0–2) | Standalone control plane (`apps/supervisor`) + stateless data-plane router (`apps/supervisor-router`) for multi-tenant hosting (**Shape B**): slug-aware image materialization, provisioning, live storage-target discovery, RBAC + Deployments, lifecycle depth (suspend/resume, logs/events, image rollout, PVC resize), and an audit UI. Kubernetes is **mocked in tests** — there is no real-cluster e2e yet. Deploy with [SUPERVISOR_DEPLOY.md](./SUPERVISOR_DEPLOY.md). |
| Supervisor agent-launch & delegation | Real HTTP `dispatchAgentRun` and `rdv delegate`. API/CLI only — no dedicated UI. |

### Clients

| Capability | Notes |
|------------|-------|
| Web + installable PWA | Standalone-capable PWA with a genuine offline shell (service worker) and maskable icons. |
| Mobile app — `mobile/` (Flutter) | The primary, most-developed mobile client (CI builds AAB + IPA). A few secondary tabs (channels/notifications/GitHub accounts) still carry TODOs. |
| Mobile web UI | Touch-friendly terminal with a native-style input bar (autocorrect, predictive text, voice dictation); a few context-menu actions are still placeholders. |
| Desktop (Electron) | Native tray, auto-updater, embedded process manager, and Cloudflare-tunnel integration (macOS, Linux, Windows). Maintained but not actively iterated; CI does **not** build the installers. |
| `rdv` CLI | Rust CLI with ~25 command groups covering sessions, agents, groups/projects, worktrees, tasks, channels, peers, notifications, and the browser, plus the hook handlers that report agent lifecycle status. The flagship agent client. |

### Authentication

| Capability | Notes |
|------------|-------|
| Dual / triple auth | Localhost email credentials, Cloudflare Access JWT validation for remote/LAN, and API keys (SHA-256 hashed, constant-time comparison, optional expiry) for programmatic access. |

---

## Partial / in progress

Works today, but with the specific gaps noted. Do not describe these as finished.

| Capability | Where it stands |
|------------|-----------------|
| Agent peer messaging | Durable **push + poll** delivery is wired **for Claude Code only** — an `rdv` MCP server is auto-registered and a hook polls as a fallback. Other agents (Codex, Gemini, OpenCode, Antigravity) get no automatic delivery and must pull messages with `rdv peer`. Delivery is **at-least-once with idempotent de-duplication** (not exactly-once). |
| Session templates | Saves and restores only a session's **name and working directory**. Startup command is dropped; theme/font/icon are saved but never re-applied. |
| Claude auto-relaunch on limit | Opt-in `auto` relaunch is real; `notify` mode raises a notification but the advertised inline "one-click relaunch" CTA is not wired on the client. |
| Secrets | **Phase.dev only** (single provider), shelling out to a `phase` CLI. Known issue: profile-scoped secret injection can silently fall back to the environment due to a decrypt bug — flagged to engineering. |
| Browser terminal type | Functional but thin: screenshot-based (~1fps poll), click/type/navigate only, no service-level tests. |
| Crown (best-of-N + judge + auto-PR) | Full pipeline with a real judge and `gh pr create`, but **every run waits the full timeout before judging** (candidates are never marked complete). No UI. See [AUTOMATION.md](./AUTOMATION.md). |
| Scheduled agent runs | Cron-driven launch works, but run **completion state is never written**, so history can read as stuck "running." API/CLI only, no UI. |
| Mobile-web context actions | Several context-menu actions are "coming soon" placeholders. |

---

## Experimental (flag-gated / inert)

Present in the codebase but **off by default, inert, or unwired**. Not product features.

| Capability | Why it's not usable yet |
|------------|-------------------------|
| Claude usage poller | Proactive Anthropic poller behind `RDV_CLAUDE_USAGE_POLL_ENABLED` (default off); the api-key path is unwired. Reactive detection is the shipped default. |
| Warm pool | Gated by `SUPERVISOR_WARM_POOL_SIZE=0`; the `claimReady` path has zero callers — scaffolding, not yet wired to launch instances. |
| Scale-to-zero | The reaper only evaluates claimed warm-pool rows, so there are never any candidates — planned/scaffolded. |
| Generic agent-activity dashboard | Service, tables, and `/api/dashboard` exist, but the `trackSession*` ingest path is never called and there is no UI. |
| Model-key proxy + token/cost | Fully implemented (real token/cost metering; cost table covers Claude models only), but **disabled by default** behind `RDV_MODEL_PROXY_ENABLED` — returns 404 when off, and env-only (no UI). |

---

## Planned

Skeleton or unbuilt — candidates, not commitments.

| Capability | Notes |
|------------|-------|
| k3s worker machines + capacity controller | Supervisor **Phase 3–4**: on-demand k3s worker machines with a capacity controller. Tables are intentionally omitted and `/api/nodes` returns `501`. |
| Outbound lifecycle webhooks | Webhooks are inbound only today; emitting session/agent lifecycle events to external systems is not built. |
| Deeper editor / IDE integration | Beyond the current in-app file editor. |

---

## Deprecated / removed

| Item | Status |
|------|--------|
| `archive/mobile-flutter/` | Abandoned; superseded by `mobile/` (`DEPRECATED.md`, 2026-05-08). Reference only, not CI-built. |
| `packages/mobile/` (Expo / React Native) | Superseded experiment — no active product work; not a shipping client. |
| TodoWrite → project-task sync | Removed. The agent hook now only broadcasts git pushes; tasks are manual. |
| Sentinel-file peer de-duplication | Written but never read; superseded by in-DB idempotent de-duplication. |
| `message_replay_cursor` table | Removed. |

---

*For authoritative, up-to-date status of any item above, use the beads tracker (`bd`).*
