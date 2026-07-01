# Development

This is the contributor guide for Remote Dev: how to get a local checkout running,
the commands you will use day to day, the quality gates to run before you commit,
and the two workflows that trip people up most — the database schema codegen and the
git-worktree bootstrap.

> **See also:** [`docs/README.md`](./README.md) (docs index) ·
> [`../INSTALL.md`](../INSTALL.md) (install guide) ·
> [`docs/SETUP.md`](./SETUP.md) (env/config reference) ·
> [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) (system design)

## Prerequisites

| Tool | Why | Notes |
|------|-----|-------|
| **bun** | JS/TS toolchain (install, scripts, tests) | The web app builds/runs under Bun + Turbopack. Use `bun`, not `npm`/`yarn`/`pnpm`. |
| **Node.js 20+** | Terminal server | The terminal server runs under `tsx`/Node because Bun does not fully support the `node-pty` native bindings. |
| **tmux** | Session persistence | Terminal sessions are backed by tmux so they survive disconnects and restarts. |
| **git** | Version control + worktrees | The development workflow uses git worktrees (see below). |
| Rust toolchain (`cargo`) | *Optional* | Only needed to build the `rdv` CLI in `crates/rdv`. |
| Docker | *Optional* | Only needed for the Postgres test suite (`test:pg`, Testcontainers) and the supervisor/router E2E. |
| PostgreSQL | *Optional* | Only if you run on the [PostgreSQL backend](./ARCHITECTURE.md) instead of the default SQLite. |

## Getting Started

```bash
git clone https://github.com/btli/remote-dev.git
cd remote-dev
bun install
```

Create a `.env.local` at the repo root. The minimum for local dev:

```bash
AUTH_SECRET=<generate with: openssl rand -base64 32>
PORT=6001
TERMINAL_PORT=6002
NEXT_PUBLIC_TERMINAL_PORT=6002   # must match TERMINAL_PORT (client-side WebSocket)
AUTH_URL=http://localhost:6001
```

Then start both servers:

```bash
bun run dev
```

`bun run dev` runs the **Next.js app (port 6001)** and the **terminal server
(port 6002)** concurrently. Open <http://localhost:6001>.

The full environment reference (GitHub OAuth, multi-instance, Cloudflare Access,
secrets) lives in [`../INSTALL.md`](../INSTALL.md) and [`docs/SETUP.md`](./SETUP.md).

## Common Commands

```bash
# Development (Next.js + terminal server concurrently)
bun run dev

# Production
bun run build          # next build
bun run start          # Next.js server
bun run start:terminal # Terminal server

# Process manager (background prod/dev)
bun run rdv:prod       # Start both servers (prod, background)
bun run rdv:restart    # Restart all servers
bun run rdv:status     # Show server status

# Quality gates
bun run lint           # eslint
bun run typecheck      # tsc --noEmit
bun run test:run       # vitest run (once)

# Tests (other modes)
bun run test           # vitest watch
bun run test:ui        # vitest UI
bun run test:coverage  # coverage report
bun run test:pg        # Postgres suite (Testcontainers; needs Docker)

# Database
bun run db:codegen     # regenerate dialect schema files (after editing schema.def.ts)
bun run db:push        # push SQLite schema changes
bun run db:studio      # open Drizzle Studio
```

The complete script list is in `package.json`.

## Quality Gates

Run these three before every commit — they are the authoritative pre-merge checks:

```bash
bun run lint
bun run typecheck
bun run test:run
```

**Do not silence findings** by disabling lint or type rules (`eslint-disable`,
`@ts-ignore`, and similar). Fix the root cause; if a rule is genuinely wrong for the
project, change it project-wide.

> **CI caveat (read this).** The Vitest suites are **not run in GitHub Actions**. CI
> is build/release-oriented — `release.yml` builds and publishes, and
> `supervisor-router-e2e.yml` is the only workflow that executes tests (a Docker E2E
> smoke of the supervisor + router). Because CI does not gate on the unit/integration
> suite, running the local gates above is on you.

## Database Schema Workflow (codegen)

The database has a **single source of truth**: `src/db/schema.def.ts`. It supports
two backends — **SQLite (libsql, default)** and **PostgreSQL** (opt-in via
`DATABASE_URL`). The dialect files are **generated**; do **not** hand-edit
`schema.sqlite.ts`, `schema.pg.ts`, or the `schema.ts` barrel.

To change the schema:

1. Edit `src/db/schema.def.ts`.
2. Regenerate the dialect files:
   ```bash
   bun run db:codegen
   ```
3. Apply the change to your backend:
   ```bash
   bun run db:push          # SQLite (dev): push the schema directly
   bun run db:generate:pg   # PostgreSQL: generate a migration into drizzle/pg/
   bun run db:push:pg       # PostgreSQL: push directly (alternative to generate)
   ```

The SQLite migrations live in `drizzle/` (config `drizzle.config.ts`); the Postgres
migrations live in `drizzle/pg/` (config `drizzle.pg.config.ts`) and are applied on
boot (`src/db/migrate.ts`). Two guard tests keep the generated files honest and will
fail your build if you skip step 2:

- **codegen-in-sync** — regenerated output must byte-match the committed files.
- **`$inferSelect` parity** — per-table row types must be identical across dialects.

The `apps/supervisor` app has the **same** setup: its own `schema.def.ts`,
`db:codegen`, and dual drizzle configs. Full details:
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) ("Dual database backend").

## Worktree Workflow

Code changes are made inside a **git worktree**, not the main checkout (see the
"Development Workflow" rule in the root `CLAUDE.md`). Fresh worktrees start with no
`node_modules`, and there are three pitfalls to avoid:

1. **Do not symlink** `node_modules` to the main checkout. Turbopack 16 rejects a
   top-level symlink that points outside the worktree's filesystem root
   (`Symlink node_modules is invalid, it points out of the filesystem root`), which
   breaks `bun run build` and `bun run dev`.
2. **Avoid a cold `bun install`** — it can take 9+ minutes on this codebase.
3. **Do not edit source in the main checkout** to work around the above; that breaks
   worktree isolation.

Instead, clone `node_modules` into the worktree with the helper:

```bash
./scripts/worktree-warm.sh            # auto-detects the main checkout
./scripts/worktree-warm.sh /path/to/main/repo
```

It uses APFS `cp -cR` (copy-on-write clonefile) to materialize a real
`node_modules/` inside the worktree in ~30 seconds. bun's isolated layout uses
relative internal symlinks, so they stay valid after the clone and Turbopack accepts
the tree. On non-APFS filesystems it falls back to `rsync --links`, then to
`bun install`.

## Logging

Server-side code **must** use the structured logger — direct `console.*` is
prohibited server-side:

```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("MyNamespace");

log.info("Session created", { sessionId, userId });
log.error("Something failed", { error: String(err), sessionId });
```

Client-side React code may use `console.error` directly (the logger is server-only).
Levels (`error`/`warn`/`info`/`debug`/`trace`) are gated by `LOG_LEVEL`. See the
"Logging" section of [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for conventions.

## Issue Tracking

The project tracks work with **bd (beads)** rather than ad-hoc TODO lists:

```bash
bd ready              # find available work
bd show <id>          # view an issue
bd update <id> --claim  # claim work
bd close <id>         # complete work
```

Run `bd prime` for the full command reference and session-close protocol.

## Before You Commit

1. Run the three quality gates (`lint`, `typecheck`, `test:run`).
2. If you touched `src/db/schema.def.ts`, run `bun run db:codegen` (and generate the
   Postgres migration).
3. Record notable changes in `CHANGELOG.md` under `## [Unreleased]`
   ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format).
