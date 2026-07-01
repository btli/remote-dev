# Remote Dev

A modern, web-based terminal workspace for AI-assisted development. Run persistent terminal sessions in your browser, organize them into projects, and drive multiple AI coding agents — Claude Code, Codex, Gemini, Antigravity, and OpenCode — from one place, on desktop or mobile.

[![Version][version-badge]][version-link]
[![License][license-badge]][license-link]
[![Next.js][nextjs-badge]][nextjs-link]
[![React][react-badge]][react-link]
[![TypeScript][typescript-badge]][typescript-link]
[![GitHub Sponsors][sponsors-badge]][sponsors-link]
[![Ko-fi][kofi-badge]][kofi-link]

![Remote Dev Terminal Interface](docs/assets/remote-dev-terminal.png)

---

## What It Does

Coding agents live in the terminal. Remote Dev gives that terminal a home you can reach from any
device: sessions survive disconnects via tmux, agents run in isolated profiles with their own
identities, and a two-level project tree keeps everything organized. Open it in a browser tab,
install it as a PWA, or run the native desktop and mobile apps — your work follows you.

Under the hood it runs **two servers** — a Next.js 16 web app and a WebSocket terminal server that
attaches PTYs to tmux — backed by Drizzle ORM over SQLite (PostgreSQL optional). A Rust `rdv` CLI
lets agents drive the whole system from the shell.

## Features

Each capability below is tagged with its maturity so you know exactly what to expect:

- **Shipped** — implemented, wired end to end, in daily use.
- **Beta** — works, but incomplete or rough in ways called out in the Notes.
- **Experimental** — flag-gated off by default, or scaffolding that isn't wired to a UI yet
  (see [Experimental / in progress](#experimental--in-progress)).

### Terminals & sessions

| Feature | Status | Notes |
|---------|--------|-------|
| Persistent sessions | Shipped | Multiple terminals backed by tmux; survive refreshes, disconnects, and server restarts. |
| Suspend & resume | Shipped | Detach a session and reattach later with full scrollback intact. |
| Terminal types | Shipped | Five session kinds — `shell`, `agent`, `file` (a real CodeMirror editor, many languages), `browser` (screenshot-based headless automation), and `ssh` (tmux-backed remote shells). |
| Recording & playback | Shipped | Capture terminal sessions on desktop web; play recordings back everywhere. |
| Trash & restore | Shipped | Soft-delete for **worktree** sessions with 30-day retention and worktree-aware restore. |
| Session templates | Beta | Save and restore a session's **name and working directory**; startup command and appearance are not yet re-applied. |

### AI coding agents

| Feature | Status | Notes |
|---------|--------|-------|
| Five agents, one workspace | Shipped | First-class Claude Code, OpenAI Codex, Gemini CLI, Antigravity, and OpenCode. Antigravity has no public installer and no session resume. |
| Agent profiles & isolation | Shipped | Each profile is a fully isolated environment — its own `HOME`, agent config, git identity, and per-profile theming. |
| Live status & exit handling | Shipped | Agent sessions report running/idle/waiting state and show a restart screen on exit. |
| Session resume | Shipped | Reattach to prior agent sessions for four of five providers (Antigravity relaunches fresh). |
| Claude usage-limit management | Shipped | Per-profile 5h/7d limit state, reactive limit detection from output, group-inherited primary + fallback pools with auto-rotation, and server-side auto-apply at session creation. |
| Peer messaging | Beta | Durable push + poll delivery **for Claude Code**; other agents pull messages with `rdv peer`. At-least-once delivery with idempotent de-duplication. |
| Claude auto-relaunch on limit | Beta | Opt-in `auto` relaunch works; `notify` mode raises a notification (no inline one-click relaunch button yet). |

### Organization & collaboration

| Feature | Status | Notes |
|---------|--------|-------|
| Project tree & inheritance | Shipped | Two-level group + project hierarchy; preferences inherit Default → User → Group chain → Project. |
| Tasks | Beta | Manual per-project tasks with priorities, labels, subtasks, dependencies, due dates, and group roll-ups. No automatic agent-TodoWrite sync. |
| Channels | Shipped | Slack-style channel groups, channels, and DMs with GitHub-flavored markdown, threads, and unread tracking. |
| Notifications | Shipped | Coalescing (60s), actionable notifications with toast integration and FCM push. |

### Git & GitHub

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-account GitHub | Shipped | Link multiple accounts and bind one per project. Browse/clone repos and branches; **view and create issues** (no commenting or PR writes). |
| Git worktrees | Shipped | Isolated worktrees for branch-per-task workflows, with trash/restore and `git worktree repair`. |

### Platform & operations

| Feature | Status | Notes |
|---------|--------|-------|
| SSH connections | Shipped | Saved, encrypted SSH targets: paste/upload key, generated ed25519 keypair, password/agent/system auth, and a rate-limited connectivity probe. |
| External MCP server management | Shipped | Database-backed registry with per-project/global inheritance and a settings UI; lifecycle = enable/disable, spawn-for-discovery, and health timestamps (not a long-running daemon). |
| LiteLLM proxy & analytics | Shipped | Opt-in managed LiteLLM process with a settings panel — the closest thing to a usage dashboard today. |
| Secrets | Beta | Phase.dev secrets integration (single provider) that injects credentials into agent environments. |
| Multi-instance hosting | Shipped | Run several isolated instances behind one domain via a runtime URL base path (`RDV_BASE_PATH`). |
| Blue/green deploys | Shipped | Slot-swap production deploys with rollback and an optional HMAC-signed deploy webhook. |
| PostgreSQL backend | Shipped | Optional dual backend via `DATABASE_URL` (SQLite is the default); migrate-on-boot. |
| Server-to-server migration | Shipped | `rdv migrate` moves an instance between servers (projects land at the tree root; groups aren't preserved). |
| Structured logging | Shipped | Server-side structured logs in a separate SQLite database with retention and an in-app Logs viewer. |

### Automation & multi-tenant control plane

| Feature | Status | Notes |
|---------|--------|-------|
| Triggered agent runs | Shipped | HMAC-verified GitHub webhook runs with per-commit de-duplication and a settings UI — the most complete automation tier. |
| Supervisor platform (Phase 0–2) | Shipped | k8s control plane + stateless router for multi-tenant hosting (Shape B): provisioning, RBAC, lifecycle, audit UI. Kubernetes is mocked in tests — no real-cluster e2e. |
| Supervisor agent-launch & delegation | Shipped | Dispatch agent runs and delegate work over HTTP / `rdv delegate` (API/CLI only, no dedicated UI). |
| Scheduled agent runs | Beta | Cron-driven launch works, but run-completion state is never written (history can read as stuck "running"); API/CLI only. |
| Crown (best-of-N + judge + auto-PR) | Beta | Full pipeline with a real judge and `gh pr create`, but **every run waits the full timeout before judging**; no UI. |

### Clients

| Feature | Status | Notes |
|---------|--------|-------|
| Web + installable PWA | Shipped | Works in any modern browser; installs standalone with a genuine offline shell. |
| Mobile app (`mobile/`, Flutter) | Shipped | The primary mobile client (CI builds AAB + IPA). A few secondary tabs still carry TODOs. |
| Mobile web UI | Shipped | Touch-friendly terminal with a native-style input bar; a few context-menu actions are placeholders. |
| Desktop (Electron) | Shipped | Native tray, auto-updater, and embedded Cloudflare tunnel (macOS, Linux, Windows). Maintained, not actively iterated; CI does not build installers. |
| `rdv` CLI | Shipped | Rust CLI (25 command groups) that lets agents and humans drive sessions, tasks, channels, peers, worktrees, and the browser from the shell. |

### Authentication

| Feature | Status | Notes |
|---------|--------|-------|
| Dual / triple auth | Shipped | Email credentials for localhost, Cloudflare Access JWT validation for remote/LAN, and hashed API keys for programmatic access. |

### Experimental / in progress

These are present in the codebase but **off by default, inert, or unwired** — do not treat them as
finished features. See [docs/ENHANCEMENTS.md](docs/ENHANCEMENTS.md) for the full breakdown.

- **Model-key proxy + token/cost metering** — behind `RDV_MODEL_PROXY_ENABLED` (returns 404 when off); cost tables cover Claude models only.
- **Claude usage poller** — proactive Anthropic poller behind `RDV_CLAUDE_USAGE_POLL_ENABLED` (default off); reactive detection is the shipped default.
- **Warm pool & scale-to-zero** — supervisor scaffolding not yet wired to launch instances.
- **Generic agent-activity dashboard** — service and tables exist, but the ingest path is never called and there is no UI.
- **Planned:** k3s worker machines + capacity controller (Supervisor Phase 3–4), outbound lifecycle webhooks, deeper editor/IDE integration.

## Installation

```bash
git clone https://github.com/btli/remote-dev.git
cd remote-dev
./scripts/init.sh --email you@example.com --port 6001 --terminal-port 6002
```

The guided script checks prerequisites, installs dependencies, writes `.env.local`, initializes the
database, seeds your user, and offers to start the dev server.

**Full guide (prerequisites, manual setup, verification, GitHub OAuth): [INSTALL.md](INSTALL.md).**

## Quick Start

Once setup is complete:

```bash
bun run dev
```

This starts the Next.js web UI and the terminal WebSocket server concurrently. Open
[http://localhost:6001](http://localhost:6001), sign in with your authorized email, and create your
first session from the sidebar.

## Common Commands

```bash
# Development
bun run dev            # Web UI + terminal server (concurrent)
bun run dev:next       # Next.js only (port $PORT)
bun run dev:terminal   # Terminal server only (port $TERMINAL_PORT)

# Process manager (background)
bun run rdv:dev        # Start both servers in dev mode
bun run rdv:prod       # Start both servers in prod mode
bun run rdv:status     # Show server status
bun run rdv:restart    # Restart servers

# Quality
bun run lint           # ESLint
bun run typecheck      # TypeScript
bun run test:run       # Vitest (single run)

# Database
bun run db:push        # Apply schema to SQLite
bun run db:studio      # Open Drizzle Studio
bun run db:seed        # Seed authorized users

# Production / deploy
bun run build
bun run start          # Next.js
bun run start:terminal # Terminal server
bun run deploy         # Blue/green production deploy

# Desktop app
bun run electron:dev       # Web + terminal + Electron
bun run electron:dist:mac  # Build a macOS distributable
```

## Architecture at a Glance

Remote Dev runs **two servers**:

| Server | Default port | Responsibility |
|--------|--------------|----------------|
| Next.js | `6001` | Web UI, authentication, API routes, static assets |
| Terminal server | `6002` | WebSocket + node-pty + tmux session management |

```
Browser (xterm.js) <--WebSocket--> Terminal Server (node-pty) <--> tmux <--> Shell
```

A WebSocket disconnect detaches from tmux but keeps the session alive; reconnecting reattaches with
full history. Business logic follows a clean, layered architecture (domain → application →
infrastructure → interface), and persistence sits behind repository ports over Drizzle ORM (SQLite
by default, PostgreSQL optional). Route protection lives in `src/proxy.ts` (the Next.js 16 auth
boundary).

For the deep dive, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| Document | What's inside |
|----------|----------------|
| [docs/README.md](docs/README.md) | Documentation index — start here |
| [INSTALL.md](INSTALL.md) | Full installation guide |
| [docs/SETUP.md](docs/SETUP.md) | Environment variables, GitHub OAuth, OIDC, PostgreSQL, remote access |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Contributor setup, quality gates, and the schema codegen + worktree workflow |
| [docs/API.md](docs/API.md) | REST API reference (see also [docs/openapi.yaml](docs/openapi.yaml)) |
| [docs/AGENTS.md](docs/AGENTS.md) | Multi-agent CLI support, profiles, and isolation |
| [docs/AUTOMATION.md](docs/AUTOMATION.md) | Scheduled/triggered runs, Crown, and the supervisor |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production blue/green deploys and the deploy webhook |
| [docs/MULTI_INSTANCE.md](docs/MULTI_INSTANCE.md) | Hosting multiple isolated instances via `RDV_BASE_PATH` |
| [docs/MOBILE_ARCHITECTURE.md](docs/MOBILE_ARCHITECTURE.md) | Mobile app and the PWA |
| [docs/ENHANCEMENTS.md](docs/ENHANCEMENTS.md) | Honest capabilities ledger and roadmap |

## Development

Contributions are welcome.

1. Fork the repository and create a feature branch: `git checkout -b feature/amazing-feature`
2. Make your change (Bun is the toolchain; do not disable linters or type checks to silence findings)
3. Run the quality gates locally: `bun run lint && bun run typecheck && bun run test:run`
4. Commit, push, and open a Pull Request

Schema changes go through the single source of truth (`src/db/schema.def.ts`) plus
`bun run db:codegen` — never hand-edit the generated dialect files. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Support

- **Documentation:** start at [docs/README.md](docs/README.md).
- **Bugs & questions:** open an issue at [github.com/btli/remote-dev/issues](https://github.com/btli/remote-dev/issues).

## Support Development

If Remote Dev is useful to you, consider supporting continued development:

- **GitHub Sponsors:** [github.com/sponsors/btli](https://github.com/sponsors/btli)
- **Ko-fi:** [ko-fi.com/bryanli](https://ko-fi.com/bryanli)

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
Copyright © Bryan Li.

## Acknowledgments

- [xterm.js](https://xtermjs.org/) — Terminal emulator
- [Next.js](https://nextjs.org/) — React framework
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [Drizzle ORM](https://orm.drizzle.team/) — Type-safe SQL
- [tmux](https://github.com/tmux/tmux) — Terminal multiplexer

<!-- Badge link references -->
[version-badge]: https://img.shields.io/badge/version-0.3.18-green?style=for-the-badge
[version-link]: CHANGELOG.md
[license-badge]: https://img.shields.io/badge/License-MIT-blue?style=for-the-badge
[license-link]: LICENSE
[nextjs-badge]: https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white
[nextjs-link]: https://nextjs.org
[react-badge]: https://img.shields.io/badge/React-19-149eca?style=for-the-badge&logo=react&logoColor=white
[react-link]: https://react.dev
[typescript-badge]: https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-link]: https://www.typescriptlang.org
[sponsors-badge]: https://img.shields.io/badge/Sponsor-GitHub-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white
[sponsors-link]: https://github.com/sponsors/btli
[kofi-badge]: https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white
[kofi-link]: https://ko-fi.com/bryanli
