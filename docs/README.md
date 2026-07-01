# Remote Dev Documentation

The documentation index for Remote Dev — a web-based terminal interface with
persistent tmux sessions, multi-agent CLI support, and GitHub integration. Start
with the quick links below, or jump to a reference section.

## Start Here

- **Installing?** → [`../INSTALL.md`](../INSTALL.md)
- **Understanding the system?** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **Contributing / running locally?** → [DEVELOPMENT.md](DEVELOPMENT.md)
- **Building against the API?** → [API.md](API.md)
- **Deploying to production?** → [DEPLOYMENT.md](DEPLOYMENT.md)

## Core

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design: the two-server model, `src/proxy.ts` auth boundary, ~87 services, 81-table dual SQLite/PostgreSQL schema, terminal-type plugins, peer comms, Clean Architecture, state management |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Contributor guide: prerequisites, `bun install` / `bun run dev`, the quality gates, the schema codegen workflow, and the git-worktree bootstrap |
| [SETUP.md](SETUP.md) | Environment and configuration reference: env vars, GitHub OAuth, multi-instance variables |
| [API.md](API.md) | REST API reference (53 route groups / 196 route files / 312 operations under `src/app/api`) + the WebSocket protocol |
| [openapi.yaml](openapi.yaml) | OpenAPI specification (machine-readable) |

## Agents & CLI

| Doc | Description |
|-----|-------------|
| [AGENTS.md](AGENTS.md) | The 5 agent CLIs (Claude Code, Codex, Gemini, Antigravity, OpenCode), profile isolation, appearance, CLI verification, and Claude usage-limit handling |
| [RDV_CLI.md](RDV_CLI.md) | Full `rdv` Rust CLI command reference (the client agents drive via Bash) |

## Operations & Hosting

| Doc | Description |
|-----|-------------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deploy: blue/green slot swap, HMAC auto-deploy webhook, rollback, operator gotchas |
| [MULTI_INSTANCE.md](MULTI_INSTANCE.md) | Multi-instance hosting — the two deployment shapes (Shape A routerless; Shape B supervisor + router single front door) |
| [SUPERVISOR_DEPLOY.md](SUPERVISOR_DEPLOY.md) | k3s supervisor-platform deploy runbook (Shape B): the Supervisor + router single front door |
| [AUTOMATION.md](AUTOMATION.md) | Scheduled + triggered agent runs, Crown best-of-N + judge + auto-PR, and supervisor delegation — with honest maturity notes on what is shipped vs scaffolding |
| [MIGRATION.md](MIGRATION.md) | Server-to-server project migration: what travels (DB rows, files, secrets, agent settings), the job lifecycle, and the `rdv migrate` / UI flows |
| [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) | Runbook for migrating an existing SQLite install to the optional PostgreSQL backend |

## Mobile

| Doc | Description |
|-----|-------------|
| [MOBILE_ARCHITECTURE.md](MOBILE_ARCHITECTURE.md) | Mobile + PWA: current state (the active Flutter `mobile/` app, the PWA layer, the superseded Expo experiment) plus the earlier native-terminal design proposal |
| [MOBILE_TERMINAL_SCROLL.md](MOBILE_TERMINAL_SCROLL.md) | Web/PWA terminal scrollback behavior (also embedded by the Flutter app via WebView) |

Setup runbooks: [deep links](mobile-deep-links.md) · [Firebase / FCM push](mobile-firebase-setup.md) · [store submission](mobile-store-submission.md).

## Roadmap

| Doc | Description |
|-----|-------------|
| [ENHANCEMENTS.md](ENHANCEMENTS.md) | Platform capabilities and roadmap — Delivered vs Planned, with honest maturity notes |

## Project Docs (repo root)

| Doc | Description |
|-----|-------------|
| [../README.md](../README.md) | Project overview, feature summary, and quick start |
| [../INSTALL.md](../INSTALL.md) | Full installation guide (links `SETUP.md` for deep configuration) |
| [../CHANGELOG.md](../CHANGELOG.md) | Notable changes, Keep a Changelog + SemVer format |

---

Internal notes, spikes, plans, and session reports live in
[`docs/claude/`](claude/) and are not part of this user-facing doc set.
