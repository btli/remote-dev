# `rdv` CLI Reference

`rdv` is the Rust CLI agents use to interact with the Remote Dev terminal and API
servers. It replaces an MCP protocol layer for most operations — agents call `rdv`
via Bash. This document is the **human/reference companion**; for the agent-usage
angle (when and how an agent should reach for each command), see the agent-facing
skill at [`skills/rdv/SKILL.md`](../skills/rdv/SKILL.md).

> Source of truth: the Rust crate at [`crates/rdv/`](../crates/rdv/) — the top-level
> `Command` enum in [`crates/rdv/src/main.rs`](../crates/rdv/src/main.rs) and the
> modules under `crates/rdv/src/commands/`.

---

## Output, build, and discovery

**Output format.** JSON by default; pass the global `--human` flag for tables /
human-readable output. (A handful of write-only commands print nothing on success.)

**Build.** `cargo build` (or `cargo install --path crates/rdv`) inside
`crates/rdv/`. The binary is also auto-installed during server startup and as a step
of the production deploy, so agents normally find `rdv` already on `PATH`.

**Server discovery (env vars).** The CLI talks to **two** servers — the Next.js
**API** server (`/api/*`) and the **terminal** server (`/internal/*`) — resolving
each from env vars, then auto-detected sockets, then a localhost port fallback
(see [`crates/rdv/src/config.rs`](../crates/rdv/src/config.rs)):

| Var | Purpose |
|-----|---------|
| `RDV_SESSION_ID` | Current session UUID (required by context-aware commands) |
| `RDV_TERMINAL_SOCKET` | Terminal server Unix socket path (prod) |
| `RDV_TERMINAL_PORT` | Terminal server port (dev, default 6002) |
| `RDV_API_SOCKET` | Next.js API server Unix socket path (prod) |
| `RDV_API_PORT` | Next.js API server port (default 6001) |
| `RDV_API_KEY` | Bearer token for API auth (falls back to `~/.remote-dev/rdv/.local-key`) |

Resolution order per server: explicit `*_SOCKET` → explicit `*_PORT` (TCP
`localhost:<port>`) → auto-detected `~/.remote-dev/run/{nextjs,terminal}.sock` →
fallback `localhost:6001` / `localhost:6002`.

> **Not part of this CLI:** `rdv mail`, `rdv escalate`, and `rdv learn` (referenced in
> some orchestrator docs) **do not exist** in this binary. Use `rdv peer` / `rdv
> channel` for messaging and `rdv notification` for notifications.

---

## Command groups at a glance

Top-level commands from `main.rs`:

| Command | Purpose |
|---------|---------|
| [`session`](#session) | Manage terminal sessions |
| [`worktree`](#worktree) | Manage git worktrees |
| [`agent`](#agent) | Manage AI agent sessions |
| [`group`](#group) | Manage project groups (containers) |
| [`project`](#project) | Manage projects (leaves: sessions/tasks/channels) |
| [`hook`](#hook) | Handle Claude Code lifecycle hooks |
| [`status`](#status) | System dashboard / report agent status |
| [`system`](#system) | Updates and service control |
| [`context`](#context) | Show the current session's context |
| [`notification`](#notification) | List / read / delete notifications |
| [`browser`](#browser) | Browser-session automation |
| [`send`](#send) | Send text or keystrokes to a session PTY |
| [`screen`](#screen) | Capture a session's screen content |
| [`set-status` / `clear-status`](#status-indicators) | Per-session status indicator |
| [`set-progress` / `clear-progress`](#status-indicators) | Per-session progress bar |
| [`log`](#status-indicators) | Write a per-session structured log entry |
| [`peer`](#peer) | Communicate with peer agents in the same project |
| [`channel`](#channel) | Chat channels in the project |
| [`teams`](#teams) | Multi-agent team orchestration |
| [`tmux`](#tmux) | tmux compatibility layer |

---

## session

Manage terminal sessions.

| Subcommand | Purpose |
|------------|---------|
| `rdv session list` | List all sessions |
| `rdv session create [--name <n>] [--folder-id <id>] [--working-dir <path>] [--type <shell\|agent\|browser>]` | Create a session |
| `rdv session close <id>` | Close (delete) a session |
| `rdv session suspend <id>` | Suspend a session |
| `rdv session resume <id>` | Resume a suspended session |
| `rdv session exec <id> <cmd>` | Run a command in a session (fire-and-forget) |
| `rdv session git-status <id>` | Git status for a session's working directory |
| `rdv session title <kebab-title>` | Set the current session's title (3–5 kebab-case words; uses `RDV_SESSION_ID`) |

## worktree

Manage git worktrees.

| Subcommand | Purpose |
|------------|---------|
| `rdv worktree create --repo <path> --branch <name>` | Create a worktree |
| `rdv worktree list --repo <path>` | List worktrees for a repo |
| `rdv worktree remove --worktree-path <p> --project-path <p> [--force]` | Remove a worktree directory (no branch cleanup) |
| `rdv worktree cleanup [--force]` | Full cleanup: verify merge, remove worktree, delete branches, close the current session (uses `RDV_SESSION_ID`) |

## agent

Manage AI agent sessions. (Provider, profile, and config behavior is documented in
[`AGENTS.md`](./AGENTS.md).)

| Subcommand | Purpose |
|------------|---------|
| `rdv agent start --project-id <id> [--worktree <branch>]` | Start an agent session in a project (alias `--folder-id`) |
| `rdv agent list` | List active agent sessions |
| `rdv agent stop <id>` | Stop (suspend) an agent session |

## group

Manage project groups (containers; preferences only, no own sessions).

| Subcommand | Purpose |
|------------|---------|
| `rdv group list` | List groups |
| `rdv group create --name <n> [--parent-group-id <id>]` | Create a group |
| `rdv group update <id> [--name <n>] [--collapsed <bool>]` | Rename / update a group |
| `rdv group move <id> [--new-parent-group-id <id>]` | Reparent a group |
| `rdv group delete <id> [--force]` | Delete a group (`--force` when it has descendants) |

## project

Manage projects (leaf nodes that own sessions, tasks, and channels).

| Subcommand | Purpose |
|------------|---------|
| `rdv project list [--group-id <id>]` | List projects |
| `rdv project create --group-id <id> --name <n>` | Create a project in a group |
| `rdv project update <id> [--name <n>] [--collapsed <bool>]` | Rename / update a project |
| `rdv project move <id> --new-group-id <id>` | Move a project to another group |
| `rdv project delete <id>` | Delete a project |

## hook

Handle Claude Code lifecycle hooks. These are wired into a profile's
`.claude/settings.json` automatically; you rarely call them by hand.

| Subcommand | Purpose |
|------------|---------|
| `rdv hook pre-tool-use` | PreToolUse: report `running` status (also drives peer-message fallback / git-identity guard) |
| `rdv hook post-tool-use` | PostToolUse: post-`git push` peer broadcast (reads stdin) |
| `rdv hook pre-compact` | PreCompact: report `compacting` status |
| `rdv hook notification` | Notification: report `waiting` status |
| `rdv hook stop [--agent <name>] [--reason <r>]` | Stop: report idle, check tasks, create notification |
| `rdv hook subagent-stop` | SubagentStop: parent still running, **no** notification (suppresses subagent noise) |
| `rdv hook session-end` | SessionEnd: report `ended` status |
| `rdv hook notify <event> [--body <msg>]` | Send a notification for a lifecycle event |
| `rdv hook validate` | Validate hooks: check server connectivity + auto-repair |
| `rdv hook claude <event> [--agent <name>] [--reason <r>]` | Unified Claude hook dispatcher (e.g. `session-start`, `stop`, `notification`, `compacting`, `prompt-submit`, `post-tool-use`, `session-end`) |

## status

System dashboard, or report agent status (the bare form prints the dashboard).

| Form | Purpose |
|------|---------|
| `rdv status [--human]` | System dashboard: sessions, tasks, deploy state |
| `rdv status report <status>` | Report agent status (used by hooks; e.g. `idle`, `working`, `error`) |

## system

Updates and service control. (See [`DEPLOYMENT.md`](./DEPLOYMENT.md) §3 for the
poll-based auto-update path.)

| Form | Purpose |
|------|---------|
| `rdv system update` | Show current/latest version + update state |
| `rdv system update check` | Poll GitHub Releases for a new release now |
| `rdv system update apply` | Download + apply the available update, then restart the service |

## context

```bash
rdv context [--human]
```

Show the current session's context — id, name, status, type, project/group, working
directory, and tmux session name. Requires `RDV_SESSION_ID`. Good first command in a
new agent session.

## notification

| Subcommand | Purpose |
|------------|---------|
| `rdv notification list [--unread] [--limit <n>]` | List notifications |
| `rdv notification read [<ids>…] [--all]` | Mark notifications read |
| `rdv notification delete [<ids>…] [--all]` | Delete notifications |

## browser

Automate a `browser`-type session. Every subcommand takes the target `<session-id>`
as its first positional argument.

| Subcommand | Purpose |
|------------|---------|
| `rdv browser navigate <id> <url>` | Navigate to a URL |
| `rdv browser screenshot <id> [--output <file>]` | Save a screenshot (default `screenshot.png`) |
| `rdv browser snapshot <id>` | Accessibility snapshot |
| `rdv browser click <id> <x> <y>` | Click at coordinates |
| `rdv browser type <id> <text> [--selector <css>]` | Type text (optionally into a selector) |
| `rdv browser evaluate <id> <expr>` | Evaluate JavaScript |
| `rdv browser back <id>` / `rdv browser forward <id>` | History navigation |

## send

Send raw input to another session's PTY.

| Subcommand | Purpose |
|------------|---------|
| `rdv send text <id> <text…>` | Send text to a session's PTY (args joined with spaces) |
| `rdv send key <id> <key>` | Send a keystroke (`Enter`, `C-c`, `Tab`, `Escape`, `Up`, `Down`, …) |

## screen

```bash
rdv screen <session-id> [--human]
```

Capture another session's current screen content. With `--human`, prints the screen
text directly; otherwise returns the JSON payload.

## Status indicators

Per-session UI indicators (status chips, a progress bar, and structured log lines).
The first positional argument is always the target `<session-id>`.

| Command | Purpose |
|---------|---------|
| `rdv set-status <id> <key> <value…> [--icon <name>] [--color <c>]` | Set a named status indicator (e.g. icon `bolt.fill`, color `#4C8DFF`) |
| `rdv clear-status <id> <key>` | Clear a named status indicator |
| `rdv set-progress <id> <value 0.0–1.0> [--label <text>]` | Set the session progress bar |
| `rdv clear-progress <id>` | Clear the session progress bar |
| `rdv log <id> <message…> [--level debug\|info\|warn\|error] [--source <s>]` | Write a per-session structured log entry (default level `info`) |

## peer

Inter-agent communication scoped to the current project (see [`AGENTS.md`](./AGENTS.md)
§5). Read paths use the CLI; the push/write paths also flow through the `rdv` MCP
server.

| Subcommand | Purpose |
|------------|---------|
| `rdv peer list` | List peer agents in the same project |
| `rdv peer send <body> [--to <session-id>]` | Send a message (omit `--to` to broadcast) |
| `rdv peer messages [--since <iso-ts>]` | Poll for new peer messages |
| `rdv peer summary <text>` | Set your work summary visible to peers |

## channel

Chat channels within the project (GFM markdown, threading).

| Subcommand | Purpose |
|------------|---------|
| `rdv channel list` | List channels in the current project |
| `rdv channel create <name> [--topic <text>]` | Create a channel (lowercase, hyphens allowed) |
| `rdv channel send <channel> <body> [--reply-to <message-id>]` | Send a message (optionally threaded) |
| `rdv channel messages <channel> [--limit <n>]` | Read messages (default 20) |

## teams

Multi-agent team orchestration — launch and coordinate child agent sessions.

| Subcommand | Purpose |
|------------|---------|
| `rdv teams launch [--folder-id <id>] [--count <n>] [--provider <claude\|codex\|gemini>] [--name-prefix <p>] [--project-path <path>]` | Launch N coordinated agent sessions (default count 2, provider `claude`); children are parented to the current session |
| `rdv teams list [--parent-id <id>]` | List agent sessions grouped by parent |
| `rdv teams wait <parent-id> [--timeout <seconds>]` | Wait for child sessions to finish (default 300 s) |
| `rdv teams broadcast <parent-id> <text…>` | Send text to all children of a parent |

## tmux

A tmux compatibility layer for tools that speak tmux. `send-keys` and `capture-pane`
are intercepted and routed to the matching rdv session (when the `-t` target is an
`rdv-<uuid>` name or a bare UUID); all other subcommands pass through to the real
`tmux` binary.

```bash
rdv tmux send-keys -t <rdv-session> "<keys>"
rdv tmux capture-pane -t <rdv-session> [--human]
rdv tmux <anything-else>            # exec's the system tmux
```

---

## See also

- [`skills/rdv/SKILL.md`](../skills/rdv/SKILL.md) — agent-facing usage skill (when/why to use each command)
- [`AGENTS.md`](./AGENTS.md) — agent providers, profiles, and peer communication
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — two-server model and internal endpoints the CLI calls
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — `rdv system update` and the production deploy model
- [`README.md`](./README.md) — documentation index
