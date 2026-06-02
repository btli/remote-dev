# Platform Capabilities & Roadmap

Remote Dev started as a web terminal and grew into a workspace for running and coordinating
multiple AI coding agents. This document summarizes **what has shipped** and **what is planned
next**. It is a narrative overview, not a status board.

> **Authoritative status lives in beads (`bd`), not here.** For what is in-flight, ready, or
> blocked at any moment, run `bd ready` / `bd list` or `bd show <id>`. This file is a map of the
> territory; beads is the live tracker.

See also: [Documentation index](./README.md) · [Architecture](./ARCHITECTURE.md)

---

## Delivered

Everything in this section is implemented and in the product today.

### Multi-agent CLI support

First-class, unified management for five AI coding agents:

| Agent | CLI | Config file |
|-------|-----|-------------|
| Claude Code | `claude` | `CLAUDE.md` |
| OpenAI Codex | `codex` | `AGENTS.md` |
| Gemini CLI | `gemini` | `GEMINI.md` |
| Antigravity | `agy` | `ANTIGRAVITY.md` |
| OpenCode | `opencode` | `OPENCODE.md` |

- CLI installation detection and version checking per provider (`AgentCLIService`), surfaced in
  the settings UI.
- Config-file templates per provider and project type (`AgentConfigTemplateService`).
- Agent sessions run as a dedicated terminal type with a state machine
  (running / exited / restarting / closed), exit codes, restart counts, and a custom exit screen
  with a one-click restart.
- Resumable Claude Code session discovery from on-disk `.jsonl` history.

### Agent profiles & isolation

- Profiles provide fully isolated agent environments by overlaying `HOME` and the agent-specific
  config directories, so each profile carries its own credentials, agent config, and git identity.
- Per-profile **git identity** via an isolated `.gitconfig` (including a `[credential]` section).
- Per-profile **appearance/theming** (mode toggle, color schemes, terminal settings).
- Per-project profile binding, so opening an agent in a project uses the right identity
  automatically.

### Agent peer communication

Project-scoped, push-first messaging that lets agents in the same project find each other and
coordinate:

- An `rdv` MCP server is auto-registered into each agent's settings at session creation.
- The terminal server pushes events over a per-session Unix socket; the MCP server relays them to
  the agent as push notifications.
- A `PreToolUse` hook polls as a reliable fallback (deduplicated via a sentinel file).
- Direct and broadcast messages, work summaries visible to peers, and channel posts, all stored in
  SQLite with a short TTL. Read operations are also available through the `rdv` CLI.

### Tasks, channels & notifications

- **Tasks** — Per-project task tracking with priorities, labels, subtasks, dependencies
  (blocked-by relationships), and due dates. Group-level views roll up tasks across all descendant
  projects. Agent `TodoWrite`/task tools sync into project tasks via a `PostToolUse` hook.
- **Channels** — Slack-style channel groups, channels, and DMs with GitHub-flavored markdown,
  threaded replies, and per-user unread tracking.
- **Notifications** — Debounced, actionable notifications with toast integration, plus
  read/delete management (and `rdv notification …` CLI access).

### Project organization & preferences

- A two-level **project group + project** tree: groups are nestable containers; projects are the
  leaves that own sessions, tasks, channels, secrets, and repo bindings.
- **Preference inheritance**: Default → User settings → Group preferences (walking up the group
  tree) → Project preferences.
- An **active node** (group or project); when a group is active, project-scoped views aggregate
  across every descendant project.

### Terminal types

A pluggable terminal-type system powers several session kinds beyond a plain shell:

- `shell` — standard bash/zsh terminal.
- `agent` — an AI agent as a managed process (see above).
- `file` — a file viewer/editor (rendered markdown + CodeMirror) for editing config files.
- `browser` — headless browser automation (navigate, click, type, screenshot, snapshot, evaluate).
- `ssh` — tmux-backed remote shells over saved SSH connections.

### Sessions

- Persistent tmux-backed sessions that survive disconnects, refreshes, and server restarts.
- Suspend/resume, reorder, recording & playback, and reusable session templates.
- Soft-delete **trash** with 30-day retention and restore (including worktree-aware restore).

### Git & GitHub

- **Multi-GitHub-account** linking with per-project account binding.
- Repository listing, cloning, branch/folder browsing, and issue/comment viewing.
- **Git worktrees** for branch-per-task isolation, with worktree-aware trash.

### SSH connections

- User-scoped SSH connection definitions with host/port/user and multiple auth types
  (paste/upload key, generated ed25519 keypair, password, agent, or system).
- Encrypted password storage, strict key-file permissions, a connectivity probe (rate-limited),
  and public-key export for `authorized_keys`. Connections can optionally be pinned to a project.

### Secrets

- Per-project secrets provider configuration that fetches credentials and injects them into agent
  session environments, with a header status indicator for connection state.

### Operations & deployment

- **Multi-instance hosting** — Run several isolated instances behind one domain. `RDV_BASE_PATH`
  is a runtime URL prefix, so one image can serve many slugs (see
  [MULTI_INSTANCE.md](./MULTI_INSTANCE.md)).
- **Blue/green production deploys** — A slot-based deploy script with active/inactive swapping,
  rollback, and an optional HMAC-signed deploy webhook (see [DEPLOYMENT.md](./DEPLOYMENT.md)).
- **Structured logging** — Server-side structured logs with level gating, stored in a separate
  SQLite database with retention, viewable in an in-app Logs tab.

### Clients

- **Web + installable PWA** — A standalone-capable progressive web app.
- **Desktop (Electron)** — Native tray, auto-updater, embedded process manager, and Cloudflare
  tunnel integration for remote access (macOS, Linux, Windows).
- **Mobile** — A touch-friendly terminal with a native input bar (autocorrect, predictive text,
  voice dictation) and dedicated mobile app projects.
- **rdv CLI** — A Rust CLI that lets agents (and humans) drive sessions, agents, groups/projects,
  worktrees, tasks, channels, peers, notifications, and the browser from the shell, plus the hook
  handlers that report agent lifecycle status.

### Authentication & access

- Dual auth: localhost email credentials, Cloudflare Access JWT validation for remote/LAN, and API
  keys for programmatic access (SHA-256 hashed, constant-time comparison, optional expiry).

---

## In progress / Planned

These items are **in progress or planned** (the k3s supervisor platform below has shipped Phases
0–2; everything else here is forward-looking). Consult beads for current status.

### k3s "supervisor platform" (Phase 0–2 shipped; Phase 3–4 planned)

The largest platform initiative is a multi-tenant **control plane** that provisions and manages many
single-tenant Remote Dev instances from one slug-aware image. This is **Shape B** of the two
deployment shapes (Shape A is the original single-instance / "routerless" app at root).

- **Status:** **Phase 0 + 1 + 2 have shipped.** The standalone control-plane service
  (`apps/supervisor`) and the stateless data-plane **router** (`apps/supervisor-router`) exist:
  slug-aware image materialization, instance provisioning, live storage-target discovery, RBAC +
  Deployments, and lifecycle depth (suspend/resume, logs/events, image rollout, PVC resize, audit
  UI). Deploy it with [`docs/SUPERVISOR_DEPLOY.md`](./SUPERVISOR_DEPLOY.md); design in
  [`docs/plans/2026-05-30-k3s-supervisor-platform.md`](./plans/2026-05-30-k3s-supervisor-platform.md).
  Phases **3–4** (on-demand k3s worker **machines** + a capacity controller) remain planned.
- **Shape:** deploy Remote Dev on **k3s** as N independent single-tenant instances. The
  supervisor-owned router is the **single external front door** (Option C): **one hostname, one
  Cloudflare Access app**. It routes `dev.example.com/<slug>/…` to the matching instance with **no**
  prefix stripping (the image materializes its base path at runtime), and proxies every
  **non-instance** path — `/`, `/login`, `/api/*`, assets — to the **Supervisor dashboard** on the
  same host (so the dashboard needs no separate hostname or second CF Access app). A **Supervisor**
  service (its own auth, roles, and DB) talks to the Kubernetes API to provision, suspend, and
  delete instances, with an operator dashboard and a storage-target selector populated from live
  cluster discovery.
- **Remaining phasing:** Phases 3–4 add on-demand k3s worker **machines** with a capacity
  controller. The runtime base-path materialization this builds on (Phase 0) is the foundation
  described under multi-instance hosting above.

### Other forward-looking ideas

Earlier roadmap drafts and design notes describe additional directions that are partly explored or
proposed but not delivered as product features. Treat these as candidates, not commitments:

- **MCP server management** — a database-backed registry and lifecycle manager for arbitrary MCP
  servers (per-project/global inheritance, start/stop/health, tool discovery). Note: the built-in
  `rdv` MCP server for peer communication already ships; this is about managing *external* servers.
- **Usage & cost insight** — token-budget tracking, per-provider cost estimation, and an agent
  activity dashboard.
- **Deeper editor/IDE integration** and event-driven outbound webhooks (session/agent lifecycle
  events to external systems).

---

*For authoritative, up-to-date status of any item above, use the beads tracker (`bd`).*
