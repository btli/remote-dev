# Architecture

This document is the technical architecture reference for Remote Dev. It is the
canonical home for the service-layer, database, plugin, and subsystem detail that
used to live in the root `CLAUDE.md`.

> **See also:** [`docs/README.md`](./README.md) (docs index) ·
> [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md) ·
> [`docs/SETUP.md`](./SETUP.md) · [`docs/API.md`](./API.md) ·
> [`docs/RDV_CLI.md`](./RDV_CLI.md) · [`docs/AGENTS.md`](./AGENTS.md) ·
> [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) ·
> [`docs/MULTI_INSTANCE.md`](./MULTI_INSTANCE.md) ·
> [`docs/MOBILE_ARCHITECTURE.md`](./MOBILE_ARCHITECTURE.md)

## Overview

Remote Dev (v0.3.18) is a web-based terminal interface built with **Next.js 16**,
**React 19**, **xterm.js**, **NextAuth v5**, and **Drizzle ORM + libsql**. It provides:

- Multiple persistent terminal sessions via tmux
- Multi-GitHub-account integration with per-project account binding and worktree support
- Multi-agent CLI support (Claude Code, Codex, Gemini, Antigravity, OpenCode) with isolated profiles
- Two-level project group + project organization with preference inheritance
- Session recording (desktop capture) and playback; reusable session templates
- Project tasks, channels, and inter-agent peer messaging (durable delivery for Claude Code; other agents pull via `rdv peer`)
- An extensible terminal-type plugin system — five session kinds (shell, agent, SSH, file, browser) plus utility/admin panels (17 built-in types in total)
- Self-hosted Nerd Fonts with mobile optimization, glassmorphism UI on a Tokyo Night theme

The stack is delivered three ways: the **web app** (PWA-capable), an **Electron
desktop app**, and **native mobile clients** (see
[`docs/MOBILE_ARCHITECTURE.md`](./MOBILE_ARCHITECTURE.md)).

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser                                      │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                 │
│  │  React App    │  │   xterm.js    │  │  SessionCtx   │                 │
│  │  (Next.js)    │  │  (Terminal)   │  │  (State Mgmt)  │                 │
│  └───────┬───────┘  └───────┬───────┘  └───────────────┘                 │
│          │                  │                                            │
│          │ HTTP/RSC         │ WebSocket                                  │
└──────────┼──────────────────┼───────────────────────────────────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌──────────────────┐
│   Next.js App    │  │  Terminal Server │
│   (Port 6001)    │  │   (Port 6002)    │   ← $PORT / $TERMINAL_PORT
│                  │  │                  │
│  ┌────────────┐  │  │  ┌────────────┐  │
│  │ API Routes │  │  │  │  ws Server │  │
│  ├────────────┤  │  │  ├────────────┤  │
│  │ proxy.ts   │  │  │  │  node-pty  │  │   ← auth at the network boundary
│  ├────────────┤  │  │  ├────────────┤  │
│  │ Services   │  │  │  │ tmux mgmt  │  │
│  └────────────┘  │  │  └────────────┘  │
│        │         │  │        │         │
└────────┼─────────┘  └────────┼─────────┘
         │                     │
         ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│     SQLite       │  │      tmux        │
│   (libsql)       │  │   (Sessions)     │
│                  │  │                  │
│  - users         │  │  - rdv-{uuid}    │
│  - sessions      │  │  - Persistent    │
│  - groups        │  │  - Detachable    │
│  - projects      │  │                  │
│  - node_prefs    │  │                  │
│  - …81 tables    │  │                  │
└──────────────────┘  └──────────────────┘
```

Ports come from `.env.local`: **`$PORT` (default 6001)** for Next.js and
**`$TERMINAL_PORT` (default 6002)** for the terminal server. In production both
servers can also bind Unix sockets instead of TCP ports (see
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md)).

## Two-Server Model

### Why Two Servers?

1. **Bun Compatibility**: Bun doesn't fully support `node-pty` native bindings, so the
   terminal server runs under `tsx`/Node.js while the web app runs under Bun/Turbopack.
2. **Isolation**: Terminal processes are isolated from the web server.
3. **Reliability**: A terminal-server crash doesn't take down the web UI.
4. **Independent lifecycle**: The two servers start, stop, and restart independently
   (managed by the `rdv` process manager / Electron process manager).

### Next.js Server (Port 6001, `$PORT`)

Handles React Server Components and SSR, authentication (NextAuth v5 + `proxy.ts`),
all API routes, the secrets/peer internal API, and static assets/client bundles.

Technologies: Next.js 16 (App Router + Turbopack), React 19 (Server Components),
Drizzle ORM with SQLite (libsql), Tailwind CSS v4.

### Terminal Server (Port 6002, `$TERMINAL_PORT`)

Handles WebSocket connections from xterm.js, PTY spawning via node-pty,
tmux session attachment/creation, terminal I/O multiplexing, and the MCP push
socket for inter-agent events.

Technologies: Node.js with `tsx`, `ws` (WebSocket server), `node-pty` (native PTY
bindings), tmux (session persistence). Entry point: `src/server/index.ts`;
implementation: `src/server/terminal.ts`.

## Terminal Flow with tmux Persistence

```
Browser (xterm.js) <--WebSocket--> Terminal Server (node-pty) <--> tmux <--> Shell
```

- WebSocket disconnection detaches from tmux but **keeps the session alive**.
- Reconnecting reattaches to the existing tmux session with full scrollback.
- Sessions persist across browser refreshes and server restarts.

### Session Lifecycle

```
1. Create   POST /api/sessions        → DB record + tmux session (rdv-{uuid})
2. Connect  WebSocket                  → PTY attaches to tmux session
3. Disconnect                          → PTY terminates, tmux keeps running
4. Reconnect WebSocket                 → new PTY reattaches to existing tmux session
5. Suspend  POST /api/sessions/:id/suspend → detach + mark suspended
6. Resume   POST /api/sessions/:id/resume  → reattach to existing tmux session
7. Close    DELETE /api/sessions/:id   → kill tmux + mark closed
```

The terminal-server WebSocket upgrade path is `${BASE_PATH}/ws` (just `/ws` in the
default single-tenant deployment). Upgrades whose path does not match are rejected.

## Authentication

Authentication is enforced **at the network boundary** by `src/proxy.ts` — a
Next.js *proxy* (renamed from `middleware` per the Next.js 16
[middleware-to-proxy](https://nextjs.org/docs/messages/middleware-to-proxy)
convention). It exports `proxy(request)` plus
`export const config = { matcher: ["/((?!_next/static|_next/image).*)"] }`.

There is **no `src/middleware.ts`** — `proxy.ts` is the single entry point.

### Auth model

- **Cloudflare Access JWT** (remote/LAN, via tunnel): the proxy reads the
  `CF_Authorization` cookie and validates it with `validateAccessJWT`
  (`src/lib/cloudflare-access.ts`). On success it forwards `x-cf-user-email` /
  `x-cf-user-id` headers to route handlers; on an invalid token it returns 401.
- **NextAuth v5 session** (localhost / local dev): when no CF token is present the
  proxy falls back to `getToken()`, reading the session cookie by its
  configured name (`getSessionCookieName()` — important under `RDV_BASE_PATH`,
  where the cookie is renamed). JWT session strategy; a credentials provider is
  restricted to localhost for security.
- **API keys** (programmatic/agents): API routes accept a `Bearer` token. The
  proxy lets `Authorization: Bearer …` requests through to the route handler,
  where `withApiAuth` (`src/lib/api.ts`) validates session **or** API key.
- **GitHub OAuth**: optional, for repository access (multi-account, see below).

### Proxy pass-throughs

The proxy always allows static assets and PWA files (`/_next/*`, `/favicon.ico`,
`/sw.js`, `/manifest.json`, `/icons/*`), NextAuth routes (`/api/auth/*`), K8s
health probes (`/api/healthz`, `/api/readyz`), and the deploy webhook
(`/api/deploy`, which carries its own HMAC-SHA256 auth). Unauthenticated page
requests are redirected to `/login` (prefixed via `prefixPath()` under a base
path); authenticated requests to `/login` are redirected home.

### Multi-instance response tagging

When `RDV_INSTANCE_SLUG` is set, every response is tagged with an
`x-rdv-instance` header so operators can tell which pod served a request behind a
shared Cloudflare tunnel. This is a no-op (byte-identical responses) for
single-tenant deployments.

### API key security

- Keys carry 256 bits of cryptographic randomness, hashed with SHA-256
  (appropriate for high-entropy random keys, faster than bcrypt).
- Validation uses constant-time comparison to prevent timing attacks.
- A key prefix is stored separately for identification without exposing the hash.
- Optional expiration dates support time-limited access.

### Command-execution safety

All shell commands use `execFile` (or the `execFileNoThrow` wrapper in
`src/lib/exec.ts`) with **array arguments** — no shell interpolation of user input.

## Clean Architecture (Domain Layer)

The session / project-group / project core follows Clean Architecture for
testability and separation of concerns.

```
src/
  domain/                    # Layer 1: pure business logic (no dependencies)
    entities/                # Session, Group, Project entities
    value-objects/           # SessionStatus, NodeRef, NodePreferences
    errors/                  # domain-specific errors

  application/               # Layer 2: use cases (depends only on domain)
    use-cases/               # CreateSession, SuspendSession, …
    ports/                   # repository & gateway interfaces

  infrastructure/            # Layer 3: implementations (implement ports)
    persistence/
      repositories/          # DrizzleSessionRepository, …
      mappers/               # DB ↔ domain converters
    external/
      tmux/                  # TmuxGateway implementation
      worktree/              # WorktreeGateway implementation
    container.ts             # dependency-injection wiring

  interface/                 # Layer 4: API adapters
    presenters/              # domain → API response transformers
```

**Patterns:** immutable entities (state changes return new instances), value
objects for type-safe domain concepts, the repository pattern, single-responsibility
use cases, and dependency injection via `container.ts`.

| File | Purpose |
|------|---------|
| `src/domain/entities/Session.ts` | Session entity with state machine |
| `src/domain/entities/Group.ts` | Project group entity (container, preferences only) |
| `src/domain/entities/Project.ts` | Project entity (leaf — owns sessions/tasks/channels) |
| `src/domain/value-objects/SessionStatus.ts` | Type-safe session status |
| `src/domain/value-objects/NodeRef.ts` | Polymorphic reference to a group or project |
| `src/domain/value-objects/NodePreferences.ts` | Discriminated preferences (group vs project) |
| `src/application/use-cases/session/*.ts` | Session use cases |
| `src/application/ports/*.ts` | Repository and gateway interfaces |
| `src/infrastructure/container.ts` | DI container with singleton instances |

> Note: not every service has been migrated behind the domain layer. The
> Clean-Architecture core covers session/group/project lifecycle; many feature
> services (below) remain direct service classes that talk to Drizzle.

## Terminal Type Plugin System

Sessions carry a `terminalType` field that selects a plugin. Plugins are split
into **server** and **client** registries (a legacy combined registry is retained
for back-compat). Built-in plugins are wired in
`src/lib/terminal-plugins/init.ts` →
`init-server.ts` / `init-client.ts`.

The registry hosts **17 built-in types** (`init-server.ts` registers 17 server
plugins). Only **five are canonical *session kinds*** — `shell`, `agent`, `ssh`,
`file`, `browser` — that spawn a PTY or own a document view. The remaining twelve
are a `loop-agent` variant plus eleven **utility/admin panels** that render in-app
management UIs (settings, recordings, PRs, issues, profiles, ports, trash, project
prefs, group prefs, secrets, GitHub maintenance). When the docs say "5 terminal
types," they mean the five session kinds, not the full registry.

```
src/lib/terminal-plugins/
├── registry.ts        # legacy combined TerminalTypeRegistry (deprecated)
├── server.ts          # TerminalTypeServerRegistry
├── client.ts          # TerminalTypeClientRegistry
├── event-bus.ts       # SessionEventBus for lifecycle events
├── init.ts            # back-compat entry; calls init-server + init-client
├── init-server.ts     # registers server-side plugins
├── init-client.ts     # registers client-side plugins
└── plugins/           # *-plugin.tsx / *-plugin-server.ts / *-plugin-client.tsx
```

### Registered plugins

**Terminal / session types** (spawn a PTY or own a view):

| Type | Plugin | Purpose |
|------|--------|---------|
| `shell` | ShellPlugin | Standard bash/zsh terminal (the default type) |
| `agent` | AgentPlugin | AI coding agent as a shell process, with an exit screen + restart |
| `ssh` | SshPlugin | Remote shell over SSH (tmux-backed), using saved connections |
| `file` | FileViewerPlugin | File viewer/editor (rendered markdown + CodeMirror), no PTY |
| `browser` | BrowserPlugin | Screenshot-based headless browser automation (navigate/click/type; ~1 fps screenshot polling) |
| `loop-agent` | LoopAgentPlugin | Long-running looping agent variant |

**Panel plugins** (rich non-terminal panes registered server-side):
`SettingsServerPlugin`, `RecordingsServerPlugin`, `PRsServerPlugin`,
`IssuesServerPlugin`, `ProfilesServerPlugin`, `PortManagerServerPlugin`,
`TrashServerPlugin`, `ProjectPrefsServerPlugin`, `GroupPrefsServerPlugin`,
`SecretsServerPlugin`, `GitHubMaintenanceServerPlugin`. These back the
in-app settings/recordings/PRs/issues/profiles/ports/trash/preferences/secrets
panels.

**Plugin interface** (`src/types/terminal-type.ts`): `createSession()` (shell
command, env, metadata), `renderContent()`, `onSessionExit()`,
`onSessionRestart()`, `renderExitScreen()`.

**Relevant `terminal_session` columns:** `terminal_type`, `agent_exit_state`
(running/exited/restarting/closed), `agent_exit_code`, `agent_restarted_at`,
`agent_restart_count`, `type_metadata` (JSON blob for plugin-specific data).

## Service Layer

Roughly **87 service modules** live under `src/services/` (about 80 at the top level
plus a handful in subdirectories). They are plain service classes/functions (the
Clean-Architecture use cases call into a subset of them). The table below is a
representative map, not an exhaustive listing. Grouped by domain:

### Sessions, projects & preferences

| Service | Purpose |
|---------|---------|
| `session-service` | Session CRUD, status management, plugin dispatch |
| `tmux-service` | tmux session lifecycle and commands |
| `worktree-service` | Git worktree management |
| `worktree-trash-service` | Worktree-specific trash + restore logic |
| `group-service` | Project group CRUD, hierarchy, move/delete (force) |
| `project-service` | Project CRUD, group placement, sort order, move |
| `group-scope-service` | Resolve a node ref to its descendant project IDs (group roll-up) |
| `preferences-service` | User settings + polymorphic node preferences + inheritance |
| `template-service` | Reusable session templates (currently restores name + working directory) |
| `recording-service` | Terminal recording storage |
| `trash-service` | Polymorphic trash management, cleanup scheduling |

### GitHub

| Service | Purpose |
|---------|---------|
| `github-service` | GitHub API, repository clone/browse operations |
| `github-account-service` | Multi-account GitHub operations + metadata |
| `github-graphql-service` | Batched GitHub queries via GraphQL |
| `github-stats-service` | High-level repository-stats management |
| `cache-service` | TTL-based caching for GitHub stats |

### Agents, profiles & MCP

| Service | Purpose |
|---------|---------|
| `agent-cli-service` | CLI install verification / version checks for all providers |
| `agent-config-service` | Markdown agent config files (CLAUDE.md / AGENTS.md / …) |
| `agent-config-template-service` | Templates for those config files per provider |
| `agent-profile-service` | Agent-profile directory management + config init |
| `agent-profile-config-service` | Per-profile JSON agent configs (export/import) |
| `agent-profile-appearance-service` | Per-profile appearance/theme settings |
| `agent-mcp-parser-service` | Parse MCP server configs from each agent's config format |
| `agent-title-service` | Agent session titling utilities |
| `claude-session-service` | Discover resumable Claude Code sessions from `.jsonl` files |
| `mcp-discovery-service` | Discover (and persist) tools/resources from MCP servers |
| `session-mcp-discovery-service` | Session-scoped MCP discovery without DB persistence |
| `mcp-registry-service` | Manage MCP server configurations |

### Collaboration (tasks, channels, peers, notifications)

| Service | Purpose |
|---------|---------|
| `task-service` | Project task CRUD, node-scoped queries, dependencies, bulk archival |
| `channel-service` | Channel/group lifecycle, unread tracking, migration support |
| `peer-service` | Project-scoped inter-agent peer discovery + messaging |
| `notification-service` | Notification CRUD, coalescing creation (60s window), read/delete |

### Ports, secrets, SSH & browser

| Service | Purpose |
|---------|---------|
| `port-registry-service` | Port-allocation tracking + conflict detection |
| `port-monitoring-service` | Detect actively listening localhost ports (lsof/netstat) |
| `framework-detection-service` | Detect frameworks/runtimes to suggest ports |
| `secrets-service` | Phase.dev secrets integration (single provider; shells to the `phase` CLI) |
| `ssh-connection-service` | SSH connection CRUD, key files, ed25519 gen, password enc |
| `browser-service` | Screenshot-based headless browser automation via Playwright (navigate/click/type) |

### Scheduling & auto-update

| Service | Purpose |
|---------|---------|
| `schedule-service` | Scheduled command execution for terminal sessions |
| `scheduler-orchestrator` | Singleton managing all active cron jobs |
| `update-scheduler` | Periodic GitHub release checks (`UPDATE_CHECK_INTERVAL_HOURS`) |
| `auto-update-orchestrator` | Coordinates the full auto-update lifecycle |

### LiteLLM (AI API proxy)

| Service | Purpose |
|---------|---------|
| `litellm-service` | LiteLLM config CRUD, model management, YAML generation |
| `litellm-process-manager` | Singleton LiteLLM child-process lifecycle + health checks |
| `litellm-analytics-service` | LiteLLM usage analytics (separate SQLite analytics DB) |

### Platform, appearance & misc

| Service | Purpose |
|---------|---------|
| `api-key-service` | API key management + constant-time validation |
| `appearance-service` | User appearance settings + color schemes |
| `activity-dashboard-service` | Track/analyze agent session activity (experimental; ingestion not yet wired) |
| `beads-service` | Read the `bd` (beads) issue tracker DB (issues, comments, deps) |

> Many services maintain their own data behind dedicated SQLite databases under
> `~/.remote-dev/` (logs, LiteLLM analytics) following the `LogDatabase` pattern,
> keeping high-write side data out of the primary `sqlite.db`.

## Database Layer

- **Drizzle ORM**, defaulting to **libsql** (SQLite-compatible; runs under both Bun and Node.js).
- Schema source of truth: `src/db/schema.def.ts` (**81 tables**); the runtime
  `src/db/schema.ts` is a generated barrel. See "Dual database backend" below.
  (The separate `apps/supervisor` app has its own ~10-table schema.)
- Primary database file: `sqlite.db` (gitignored). Logs and LiteLLM analytics use
  separate databases under `~/.remote-dev/`.
- Optionally runs on **PostgreSQL** instead — opt-in via `DATABASE_URL` (see
  "Dual database backend" below).

### Table overview (by domain)

**Auth & users**

| Table | Purpose |
|-------|---------|
| `user` | NextAuth users |
| `account` | OAuth accounts (GitHub) |
| `session` | NextAuth sessions |
| `verificationToken` | NextAuth email verification tokens |
| `authorized_user` | Email allowlist |
| `user_settings` | User-level preferences incl. `active_node_id` + `active_node_type` |
| `api_key` | API keys for programmatic access |
| `setup_config` | First-run / setup state |

**Sessions & terminal**

| Table | Purpose |
|-------|---------|
| `terminal_session` | Session metadata, tmux name, status, worktree info, `project_id`, agent-exit state |
| `session_template` | Reusable session configurations |
| `session_recording` | Terminal-session recordings |
| `session_memory` | Per-session persisted memory |
| `command_executions` | Records of fire-and-forget command executions |

**Project tree & preferences**

| Table | Purpose |
|-------|---------|
| `project_group` | Nestable grouping containers (preferences only) |
| `project` | Leaf project nodes (own sessions/tasks/channels/secrets/repo) |
| `node_preferences` | Polymorphic per-node prefs keyed by (`ownerType`,`ownerId`) |
| `project_secrets_config` | Per-project secrets-provider configuration |
| `project_github_account_link` | Per-project GitHub-account binding |
| `project_profile_link` | Per-project agent-profile binding |
| `project_repository` | Per-project repo + local clone-path association |

**GitHub & repositories**

| Table | Purpose |
|-------|---------|
| `github_repository` | Cached repository data with local paths |
| `github_account_metadata` | Linked GitHub account metadata (login, avatar, default, config dir) |
| `github_repository_stats` | Cached repository statistics |
| `github_pull_requests` | Cached pull-request data |
| `github_branch_protection` | Cached branch-protection rules |
| `github_stats_preferences` | Per-user GitHub-stats preferences |
| `github_change_notifications` | Repo change notifications |
| `github_issues` | Cached repository issues |

**Agent profiles, configs & MCP**

| Table | Purpose |
|-------|---------|
| `agent_profiles` | Agent profiles (isolated environments) |
| `agent_configs` | Markdown agent config files per profile |
| `agent_profile_json_configs` | JSON agent configs per profile |
| `profile_git_identities` | Per-profile git identity |
| `profile_secrets_config` | Per-profile secrets configuration |
| `profile_appearance_settings` | Per-profile appearance settings |
| `mcp_servers` | MCP server configurations |
| `mcp_discovered_tools` | Discovered MCP tools (persisted) |
| `mcp_discovered_resources` | Discovered MCP resources (persisted) |

**Activity & appearance**

| Table | Purpose |
|-------|---------|
| `agent_activity_events` | Agent session activity events |
| `agent_daily_stats` | Aggregated per-day agent stats |
| `color_schemes` | Saved color schemes |
| `appearance_settings` | User appearance settings |

**Scheduling & updates**

| Table | Purpose |
|-------|---------|
| `session_schedules` | Per-session schedule definitions |
| `schedule_commands` | Commands attached to a schedule |
| `schedule_executions` | Schedule execution history |
| `system_update_cache` | Cached update-check results |

**Tasks, channels, peers & notifications**

| Table | Purpose |
|-------|---------|
| `project_tasks` | Project tasks (priority, labels, subtasks, deps, due dates) |
| `task_dependencies` | Junction for task blocked-by relationships |
| `channel_groups` | Channel-group containers (e.g. Channels, Direct Messages) |
| `channels` | Individual channels within groups |
| `channel_read_state` | Per-user/channel unread tracking |
| `agent_peer_messages` | Project-scoped inter-agent messages (24h TTL) |
| `notification_events` | Notifications |
| `push_tokens` | Web-push subscription tokens |

**Ports, trash, SSH & LiteLLM**

| Table | Purpose |
|-------|---------|
| `port_registry` | Port allocations for env-var conflict detection |
| `trash_item` | Polymorphic trash items (30-day retention) |
| `worktree_trash_metadata` | Worktree-specific trash metadata |
| `ssh_connection` | User-scoped SSH connection definitions |
| `litellm_config` | LiteLLM proxy configuration |
| `litellm_models` | LiteLLM model definitions |

### Dual database backend (SQLite / PostgreSQL)

The same codebase runs on **SQLite (default)** or **PostgreSQL**, chosen once at
boot from the `DATABASE_URL` scheme. SQLite behavior is unchanged when Postgres
is not configured. The supervisor app (`apps/supervisor`) uses the identical
model.

- **Dialect facade.** `src/db/is-postgres.ts` is the single dialect predicate
  (`postgresql://` / `postgres://` → Postgres). `src/db/dialect.ts` constructs
  exactly one backend synchronously at import (`dialect-sqlite.ts` /
  `dialect-pg.ts`); the Postgres builder uses a lazy `pg.Pool` (no I/O at import,
  no top-level await). `db` is exported as a stable `AppDb` type so the ~80
  `import { db } from "@/db"` consumers are dialect-agnostic; a raw-SQL escape
  hatch (`client.execute`) rewrites libsql-style `?` placeholders to `$1..$N` on
  the Postgres side.
- **Schema codegen.** `src/db/schema.def.ts` is a hand-maintained, dialect-neutral
  definition. `bun run db:codegen` (→ `scripts/codegen-schema.ts` →
  `scripts/lib/schema-codegen.ts`) emits three committed files:
  `schema.sqlite.ts` (drizzle `sqlite-core`), `schema.pg.ts` (drizzle `pg-core`),
  and the runtime barrel `schema.ts` (re-exports the active dialect's tables by
  `isPostgres()`). Two drift guards keep these honest: a **codegen-in-sync** test
  (regenerated output must byte-match the committed files) and an
  **`$inferSelect` parity** test (per-table row types must be identical across
  dialects, so the barrel's cast to the SQLite types is sound).
- **Native PG types.** The generator maps neutral kinds to native Postgres types
  — `json → jsonb`, `timestampMs`/`timestampS → timestamptz`, `boolean →
  boolean` — while SQLite keeps the historical `text`/`integer` storage with
  Drizzle column modes, so the JS-side values are identical on both backends.
- **Dual migrations.** `drizzle/` holds the SQLite migrations (config
  `drizzle.config.ts`); `drizzle/pg/` holds the Postgres migrations (config
  `drizzle.pg.config.ts`). The SQLite path keeps using `db:push`; the Postgres
  path applies `drizzle/pg/` via **migrate-on-boot** (`src/db/migrate.ts`,
  invoked from `src/instrumentation.ts`) so a fresh database self-initializes.
- **Dual-backend sidecars.** The logs + LiteLLM-analytics stores are selected by
  `src/infrastructure/persistence/sidecar-factory.ts`: on SQLite, the existing
  synchronous `better-sqlite3` stores (separate `~/.remote-dev/*.db` files); on
  Postgres, async **write-buffered** stores
  (`src/infrastructure/persistence/pg/`) that flush into `logs` / `analytics`
  schemas inside the *same* Postgres database. The buffer never blocks the
  request path and drops (never blocks) under a Postgres outage.

The PostgreSQL backend is **supported and shipped**, not experimental — the same
codegen, migrations, and sidecars all have Postgres paths. One honest caveat: its
Testcontainers suites (`bun run test:pg`) run **locally, not in CI** (see
[`docs/DEVELOPMENT.md`](./DEVELOPMENT.md)).

## Agent Peer Communication

Project-scoped inter-agent messaging lets agents in the same project discover one
another and coordinate. Delivery is **not uniform across providers** — automatic
push/poll delivery is currently a **Claude Code** capability; every other agent
pulls its inbox on demand.

- **Claude Code — durable push + poll.** An `rdv` MCP server is auto-registered in
  the profile's `settings.json` at session creation *only when the provider is
  Claude* (`session-service.ts` gates registration on `provider === "claude"`). The
  terminal server pushes events over a Unix socket (`/tmp/rdv-mcp-{sessionId}.sock`)
  to that MCP server, which relays them to the agent via `sendLoggingMessage()`; a
  poll hook is the fallback path.
- **All other agents (Codex, Gemini, Antigravity, OpenCode) — pull only.** They are
  not auto-wired for push/poll delivery; they read peer messages by running
  `rdv peer` (via Bash) themselves.
- **Delivery is at-least-once with idempotent de-duplication** (a bounded in-memory
  dedup cache), not exactly-once. Read operations (list peers, read channels) always
  go through the `rdv` CLI.

| File | Purpose |
|------|---------|
| `src/mcp/peer-server.ts` | MCP stdio server with push-notification relay |
| `src/server/mcp-push.ts` | Terminal-server Unix-socket push manager |
| `src/services/peer-service.ts` | DB operations for peer messaging |
| `crates/rdv/src/commands/peer.rs` | `rdv peer` CLI for non-MCP agents |

**MCP tools (write only):** `send_message`, `send_to_channel`, `set_summary`.
**Internal API:** `/internal/peers/*` and `/internal/channels/send` on the Next.js server.

See [`docs/RDV_CLI.md`](./RDV_CLI.md) for the full `rdv` command surface and
[`docs/AGENTS.md`](./AGENTS.md) for agent providers and profiles.

## State Management

React contexts live in `src/contexts/`:

| Context | Purpose |
|---------|---------|
| `SessionContext` | Session state with optimistic updates |
| `ProjectTreeContext` | Combined group + project tree, active-node tracking, descendant aggregation |
| `PreferencesContext` | User settings + node preferences with inheritance |
| `TemplateContext` | Session templates |
| `RecordingContext` | Recording state |
| `TrashContext` | Trash items + operations |
| `SecretsContext` | Secrets-provider configs |
| `PortContext` | Port allocations, framework detection, monitoring |
| `GitHubAccountContext` | Multi-account GitHub state + project bindings |
| `TaskContext` | Project tasks (node-scoped CRUD) |
| `NotificationContext` | Notification state + toast integration |
| `ChannelContext` | Channel groups, messages, threads, unread tracking |

### Preference inheritance

```
Default Settings (hardcoded)
       ↓
User Settings (user_settings table)
       ↓
Group Preferences (node_preferences, ownerType="group", walked root→leaf)
       ↓
Project Preferences (node_preferences, ownerType="project")
       ↓
Effective Preferences (computed at runtime)
```

Group preferences accept a restricted subset of fields (no `localRepoPath`);
project preferences accept the full schema.

### Active node and descendant aggregation

`user_settings` carries `active_node_id` + `active_node_type` (`"group" | "project"`),
replacing the legacy `active_folder_id`. When a **project** is active,
project-scoped views (tasks, channels, peer messages) filter to that single project.
When a **group** is active, those same views roll up across every descendant project
— recursively walking the group sub-tree (see `group-scope-service`) — so a group
node acts as a workspace pivot, not just a label.

## Key UI Components

| Component | Purpose |
|-----------|---------|
| `Terminal.tsx` | xterm.js wrapper with WebSocket + recording support |
| `TerminalWithKeyboard.tsx` | Terminal with mobile support (xterm.js + native input bar) |
| `MobileInputBar.tsx` | Native textarea with autocorrect, voice dictation, predictive text |
| `RecordingPlayer.tsx` | Playback recorded sessions with seek controls |
| `Sidebar.tsx` | Sidebar shell hosting the project tree + global controls |
| `ProjectTreeSidebar.tsx` | Group + project tree with context menus, drag/drop, active-node selection |
| `ProjectTreeRow.tsx` | Row renderer for a single group or project node |
| `SessionManager.tsx` | Main orchestrator with keyboard shortcuts |
| `NewSessionWizard.tsx` | Multi-step session creation flow |
| `TaskSidebar.tsx` / `TaskEditor.tsx` | Project-scoped task tracking + inline editor |
| `ChannelSidebar.tsx` / `ChannelView.tsx` / `ThreadPanel.tsx` | Chat channels, messages, thread replies |
| `GroupPreferencesModal.tsx` / `ProjectPreferencesModal.tsx` / `UserSettingsModal.tsx` | Preference editors |

## Logging

Server-side code **must** use the structured logger
(`createLogger("Namespace")` from `src/lib/logger.ts`); direct `console.*` is
prohibited server-side. Levels: error / warn / info / debug / trace, gated by
`LOG_LEVEL` (default `info` in dev, `warn` in prod). Logs are written to console
**and** a separate SQLite database at `~/.remote-dev/logs/logs.db` (7-day
retention, pruned on startup, viewable in Settings → Logs).

| File | Purpose |
|------|---------|
| `src/lib/logger.ts` | `createLogger` factory (re-export) |
| `src/infrastructure/logging/AppLogger.ts` | Logger implementation (level gating, console + DB) |
| `src/infrastructure/logging/LogDatabase.ts` | Separate `logs.db` connection |
| `src/components/system/LogViewer.tsx` | Log viewer UI |

## Performance Considerations

- **Terminal**: direct PTY-to-WebSocket piping; no buffering/processing of output;
  resize events propagated immediately.
- **React**: Server Components for initial load; client-side Context for state;
  optimistic updates for tab operations.
- **Database**: SQLite for low-latency local operations; type-safe Drizzle queries;
  connection handling via libsql; high-write side data kept in dedicated databases.

## Font System

Remote Dev self-hosts 22 Nerd Font families in WOFF2 for optimal terminal rendering.
Default: JetBrainsMono Nerd Font Mono. Fonts are declared via `@font-face` in
`globals.css` with `font-display: swap` and fall back to system monospace.
Self-hosting avoids external-font-service failures on mobile, works offline,
compresses well (WOFF2 ≈ 30% smaller than WOFF), and provides full Nerd Font glyphs.

## Testing and Continuous Integration

The codebase carries a large Vitest suite (unit + integration, `bun run test:run`)
plus a Postgres-only suite (`bun run test:pg`, Testcontainers). **Neither runs in
GitHub Actions today.** The CI workflows are build/release-oriented: `release.yml`
builds and publishes, `deploy.yml` / `dev-env-image.yml` / `mobile-release.yml`
build artifacts, and `supervisor-router-e2e.yml` is the *only* workflow that
executes tests — a Docker E2E smoke of the supervisor + router front door. Treat the
local quality gates (`lint`, `typecheck`, `test:run`) as the authoritative checks
before merging; see [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md).

## Deployment, Hosting & Clients

The detailed operational docs are kept separate; this section summarizes and links.

### Production deployment

Remote Dev **does** support production deployment: a blue/green strategy with an
HMAC-SHA256-authenticated webhook at `POST /api/deploy` (`src/app/api/deploy/route.ts`),
which the proxy lets through under its own auth. The prior claim that there are "no
production deployment considerations" is obsolete. See
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) for the full blue/green flow, restart
resilience, and rollout details.

### Multi-instance / multi-tenant hosting

Multiple path-prefixed instances can run behind a shared Cloudflare tunnel + Access
policy, each as a single-replica StatefulSet with its own database, tmux namespace,
and `AUTH_SECRET`. URL prefixing is driven by **`RDV_BASE_PATH`**, and
`src/lib/base-path.ts` is the **enforced single source of truth** for that env var
(ESLint-guarded; only it and `next.config.ts` may read the variable). It exports
`BASE_PATH`, `INSTANCE_SLUG`, `COOKIE_PATH`, `WS_PATH_PREFIX`, and `prefixPath()`.

There are **two deployment shapes**:

- **Shape A — single-instance ("routerless").** The base app at root
  (`RDV_BASE_PATH=""`), no Supervisor/router — local dev, Electron, self-hosted
  single-tenant prod (the original product).
- **Shape B — multi-instance (Supervisor + router).** The k3s **supervisor
  platform**: a standalone Supervisor (`apps/supervisor`) provisions N
  single-tenant instances, and a stateless **router** (`apps/supervisor-router`)
  is the **single external front door** — one hostname, one Cloudflare Access app.
  The router proxies `/` (and every non-instance path) to the **Supervisor
  dashboard** and `/<slug>/*` to the matching instance, both UNCHANGED (no prefix
  stripping). **Phase 1 + 2 have shipped** (provisioning, storage targets, the
  router, RBAC + Deployments, and lifecycle depth). See
  [`docs/SUPERVISOR_DEPLOY.md`](./SUPERVISOR_DEPLOY.md) and the design in
  [`docs/plans/2026-05-30-k3s-supervisor-platform.md`](./plans/2026-05-30-k3s-supervisor-platform.md).

See [`docs/MULTI_INSTANCE.md`](./MULTI_INSTANCE.md) for both shapes (plus the
hand-rolled Traefik path).

### Multi-agent CLIs & profiles

Five providers are supported (Claude Code, Codex, Gemini, Antigravity, OpenCode),
each with its own CLI command, markdown config file, and isolated profile directory
under `~/.remote-dev/profiles/{profile-id}/`. See [`docs/AGENTS.md`](./AGENTS.md).

### Electron desktop app

A desktop wrapper provides a tray icon, auto-updater, Cloudflare-tunnel integration,
cross-platform builds, and an embedded process manager for the two servers
(`electron/main/*`: `index.ts`, `process-manager.ts`, `cloudflared.ts`, `tray.ts`,
`auto-updater.ts`, `config.ts`).

### rdv CLI (agent interface)

`crates/rdv/` is a Rust CLI agents use (via Bash) to drive the terminal server —
sessions, groups/projects, agents, worktrees, browser, peers, channels,
notifications, and Claude Code lifecycle hooks. It discovers the servers via
`RDV_*` env vars and emits JSON by default (`--human` for tables). See
[`docs/RDV_CLI.md`](./RDV_CLI.md).

### Mobile & PWA

The web app is itself PWA-capable (`public/manifest.json` + `src/app/sw.js/route.ts`,
with mobile web routes under `src/app/m/`). Native clients live in `mobile/` (the
active Flutter app) and `packages/mobile/` (an Expo/React Native app). See
[`docs/MOBILE_ARCHITECTURE.md`](./MOBILE_ARCHITECTURE.md).

### REST API

The HTTP surface spans **53 route groups** and **196 `route.ts` files**
under `src/app/api` (312 exported handlers). It is documented in
[`docs/API.md`](./API.md), with an OpenAPI spec at
[`docs/openapi.yaml`](./openapi.yaml).
