# Remote Dev Documentation

Documentation for Remote Dev. For agent-initialization guidance, see the root [`../CLAUDE.md`](../CLAUDE.md).

## Start Here

- **New to the project?** → [SETUP.md](SETUP.md)
- **Understanding the system?** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **Using the API?** → [API.md](API.md)
- **Deploying to production?** → [DEPLOYMENT.md](DEPLOYMENT.md)

## Reference

### Core

| Doc | Description |
|-----|-------------|
| [SETUP.md](SETUP.md) | Installation and configuration: env vars, GitHub OAuth, multi-instance environment |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture: two-server model, services, DB schema, terminal plugins, peer comms, Clean Architecture, state management |
| [API.md](API.md) | REST API reference (296 operations across 51 route groups) + WebSocket protocol |
| [openapi.yaml](openapi.yaml) | OpenAPI 3.1 specification (machine-readable) |

### Agents & CLI

| Doc | Description |
|-----|-------------|
| [AGENTS.md](AGENTS.md) | The 5 agent CLIs (Claude Code, Codex, Gemini, Antigravity, OpenCode), profile isolation, appearance, CLI verification |
| [RDV_CLI.md](RDV_CLI.md) | Full `rdv` Rust CLI command reference |

### Operations

| Doc | Description |
|-----|-------------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deploy: blue/green slot swap, HMAC auto-deploy webhook, rollback, operator gotchas |
| [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) | Runbook for migrating an existing SQLite install to the optional PostgreSQL backend (offline `db:migrate-to-postgres` CLI) |
| [MIGRATION.md](MIGRATION.md) | Server-to-server project migration: peer registry, what travels (DB rows, files, secrets, agent settings), the job lifecycle, and the `rdv migrate` / UI flows |
| [MULTI_INSTANCE.md](MULTI_INSTANCE.md) | Multi-instance hosting — the two deployment shapes (Shape A routerless; Shape B supervisor + router single front door) and the hand-rolled k8s manifests |
| [SUPERVISOR_DEPLOY.md](SUPERVISOR_DEPLOY.md) | k3s supervisor-platform deploy runbook (Shape B): the Supervisor + router single front door |

### Mobile

| Doc | Description |
|-----|-------------|
| [MOBILE_ARCHITECTURE.md](MOBILE_ARCHITECTURE.md) | Mobile (Flutter `mobile/`, Expo `packages/mobile/`) + PWA architecture |

> Mobile companions: [MOBILE_TERMINAL_SCROLL.md](MOBILE_TERMINAL_SCROLL.md), [NATIVE_APP_RESEARCH.md](NATIVE_APP_RESEARCH.md), [mobile-deep-links.md](mobile-deep-links.md), [mobile-firebase-setup.md](mobile-firebase-setup.md), [mobile-store-submission.md](mobile-store-submission.md), [mobile-bridge-spike-test-plan.md](mobile-bridge-spike-test-plan.md).

### Roadmap

| Doc | Description |
|-----|-------------|
| [ENHANCEMENTS.md](ENHANCEMENTS.md) | Platform capabilities & roadmap (Delivered vs Planned) |

## Historical / Working Notes (not maintained)

These are point-in-time working artifacts kept for reference; they are not kept up to date:

- [`plans/`](plans/) — design and implementation plans, including the **DRAFT** [k3s supervisor platform plan](plans/2026-05-30-k3s-supervisor-platform.md)
- [`superpowers/`](superpowers/) — exploratory notes
- [`reports/`](reports/) — session and analysis reports
- [`claude/`](claude/) — Claude Code activity notes
