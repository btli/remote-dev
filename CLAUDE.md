# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.
This file is intentionally lean — detailed docs live in `docs/` (start at `docs/README.md`).

## Project Overview

Remote Dev (v0.3.18) is a web-based terminal interface built with **Next.js 16**, **React 19**, **xterm.js**, **NextAuth v5**, and **Drizzle ORM + libsql**, with a Rust `rdv` CLI for agents. It provides:

- Persistent terminal sessions backed by **tmux** (survive disconnects, refreshes, restarts)
- **5 agent CLIs** (Claude Code, Codex, Gemini, Antigravity, OpenCode) with isolated **profiles** + per-profile theming
- Two-level **project group + project** tree with preference inheritance
- **Tasks, channels, notifications**, and inter-agent peer messaging
- **Multi-GitHub-account** linking with per-project binding; git **worktree** isolation
- Pluggable terminal types: **shell, agent, file, browser, ssh**
- **Mobile (Flutter) + PWA** clients, **multi-instance** hosting, and an **Electron** desktop wrapper

## Commands

```bash
# Development (Next.js + terminal server concurrently)
bun run dev

# Production
bun run build
bun run start          # Next.js server
bun run start:terminal # Terminal server

# Process manager (background prod/dev)
bun run rdv:prod       # Start both servers (prod, background)
bun run rdv:restart    # Restart all servers
bun run rdv:status     # Show server status

# Code quality
bun run lint
bun run typecheck
bun run test:run       # Run tests once (Vitest)

# Database
bun run db:push        # Push schema changes to SQLite
bun run db:studio      # Open Drizzle Studio
```

Full script list: `package.json`; setup details: `docs/SETUP.md`.

## Logging (NON-NEGOTIABLE)

**NEVER use `console.log`, `console.error`, `console.warn`, or `console.debug` directly in server-side code.**

All server-side logging MUST use the structured logger:

```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("MyNamespace");

log.error("Something failed", { error: String(err), sessionId });
log.warn("Deprecation notice", { feature: "oldApi" });
log.info("Session created", { sessionId, userId });
log.debug("Connection details", { cols, rows, tmuxName });
log.trace("Raw data received", { bytes: data.length });
```

### Log Level Guidelines
- **error**: Failures that need attention (DB errors, crashes, auth failures)
- **warn**: Non-critical issues (deprecated usage, fallback behavior, retry)
- **info**: Important state changes (server start/stop, session create/close, job execution)
- **debug**: Routine operational details (connection requests, tmux attach, resize)
- **trace**: Very verbose output (raw data, internal state dumps)

### Conventions
- Namespace: PascalCase service/module name (e.g., `"SessionService"`, `"Terminal"`, `"Scheduler"`)
- API routes: use path format (e.g., `"api/sessions"`, `"api/github"`)
- Pass structured data as second argument — don't interpolate into message strings
- Error objects: always stringify with `{ error: String(error) }` or `{ error: err.message }`
- The `LOG_LEVEL` env var controls minimum level (default: `info` in dev, `warn` in prod)

### Exceptions
- Client-side code (React components, contexts in browser) may use `console.error` directly since the logger is server-only
- The logger itself (`src/infrastructure/logging/`) uses `console.*` internally

### Storage
- Logs are stored in a separate SQLite database at `~/.remote-dev/logs/logs.db`
- 7-day retention, pruned on startup
- Viewable in Settings → Logs tab

## Architecture at a Glance

**Two-server model:**
1. **Next.js** (port `$PORT`, default **6001**) — Web UI, auth, API routes, static assets
2. **Terminal Server** (port `$TERMINAL_PORT`, default **6002**) — WebSocket + PTY/tmux (runs via `tsx` for node-pty compatibility)

**Terminal flow (tmux persistence):**

```
Browser (xterm.js) <--WebSocket--> Terminal Server (node-pty) <--> tmux <--> Shell
```

WebSocket disconnect detaches from tmux but keeps the session alive; reconnect reattaches with full history.

**Session lifecycle:** `POST /api/sessions` creates a DB row + tmux session (`rdv-{uuid}`) → WS attaches a PTY → disconnect detaches (tmux lives on) → suspend/resume detach/reattach → `DELETE` kills tmux and marks closed.

**Auth model:** `src/proxy.ts` (Next.js 16 route-protection boundary; renamed from the old `middleware.ts`) gates all routes except `/login` and `/api`. Localhost uses email-only **NextAuth v5** credentials; remote/LAN validates a **Cloudflare Access** JWT (`CF_Authorization` cookie); programmatic callers use **API keys** (Bearer). The `withApiAuth` wrapper in `src/lib/api.ts` handles dual session/API-key auth.

**Clean Architecture:** business logic is layered `domain/` (entities, value objects) → `application/` (use cases, ports) → `infrastructure/` (repositories, gateways, `container.ts` DI) → `interface/` (presenters). Entities are immutable; persistence sits behind repository ports.

Full architecture: `docs/ARCHITECTURE.md`.

## Subsystem Map

| Subsystem | What it is | Doc |
|-----------|-----------|-----|
| REST API + WebSocket protocol | 296 operations across 51 route groups | `docs/API.md` (+ `docs/openapi.yaml`) |
| Agent CLIs & profiles | 5 providers, profile isolation, appearance, CLI verification | `docs/AGENTS.md` |
| `rdv` CLI | Rust CLI agents use via Bash (sessions, agents, peers, hooks, browser…) | `docs/RDV_CLI.md` |
| Production deploy | Blue/green slot swap + HMAC auto-deploy webhook, rollback | `docs/DEPLOYMENT.md` |
| Multi-instance hosting | Two shapes — Shape A routerless (`RDV_BASE_PATH` at root) and Shape B supervisor + router single front door (k3s) | `docs/MULTI_INSTANCE.md`, `docs/SUPERVISOR_DEPLOY.md` |
| Automation & orchestration | Scheduled/triggered real agent runs, Crown best-of-N + judge + auto-PR, warm pool, scale-to-zero, supervisor agent-launch + delegation | `docs/AUTOMATION.md` |
| Mobile & PWA | Flutter `mobile/`, Expo `packages/mobile/`, PWA architecture | `docs/MOBILE_ARCHITECTURE.md` |
| Services / DB schema / plugins / peer comms | 54 services, 59 tables, terminal-type plugins, inter-agent messaging | `docs/ARCHITECTURE.md` |
| Setup & environment | Install, env vars, GitHub OAuth, multi-instance env | `docs/SETUP.md` |
| Capabilities & roadmap | Delivered vs planned platform features | `docs/ENHANCEMENTS.md` |

## Key Entry-Point Files

| Path | Purpose |
|------|---------|
| `src/proxy.ts` | Route protection / auth boundary (Next.js 16) |
| `src/auth.ts` | NextAuth v5 configuration |
| `src/db/schema.def.ts` | Drizzle schema source of truth (generates `schema.{sqlite,pg}.ts` + the `schema.ts` barrel — see "Database schema codegen") |
| `src/server/terminal.ts` | WebSocket + PTY + tmux terminal server |
| `src/lib/base-path.ts` | Single source of truth for `RDV_BASE_PATH` |
| `src/lib/terminal-plugins/` | Terminal type plugin registry + built-in plugins |
| `src/lib/logger.ts` | Logger re-export (`createLogger` factory) |
| `src/services/` | Business logic services |
| `crates/rdv/` | Rust CLI for agent interaction |
| `src/contexts/` | React contexts (session, project tree, preferences, …) |

### Database schema codegen (dual SQLite / PostgreSQL backend)

The DB supports two backends (SQLite default, optional PostgreSQL via
`DATABASE_URL`). The schema has a **single source of truth**:
`src/db/schema.def.ts`. Do **not** edit the generated files
(`schema.sqlite.ts`, `schema.pg.ts`, or the `schema.ts` barrel).

To change the schema:

1. Edit `src/db/schema.def.ts`.
2. Regenerate the dialect files: `bun run db:codegen`.
3. Generate **both** migration sets when the schema changes:
   - `bun run db:generate` (SQLite, `drizzle/`)
   - `bun run db:generate:pg` (PostgreSQL, `drizzle/pg/`)

A `codegen-in-sync` test fails if the committed generated files don't match the
def (so always run `db:codegen` after editing). `apps/supervisor` has the **same
setup** — its own `schema.def.ts` + `db:codegen`, with `drizzle.config.ts` /
`drizzle.pg.config.ts` for its two migration folders. Full details:
`docs/ARCHITECTURE.md` ("Dual database backend").

## Environment Variables

Required in `.env.local`:

```bash
AUTH_SECRET=<generate with: openssl rand -base64 32>
PORT=6001
TERMINAL_PORT=6002
NEXT_PUBLIC_TERMINAL_PORT=6002  # Must match TERMINAL_PORT (client-side WebSocket)
AUTH_URL=http://localhost:6001  # NextAuth v5; legacy NEXTAUTH_URL still accepted
```

GitHub OAuth (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`) and multi-instance hosting (`RDV_BASE_PATH`) are optional. Full reference: `docs/SETUP.md` and `docs/MULTI_INSTANCE.md`.

## Changelog & Releases

Track all notable changes in `CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format (Added / Changed / Deprecated / Removed / Fixed / Security), under `## [Unreleased]`.

To release: move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, bump `package.json` version, tag (`git tag -a vX.Y.Z`), push the tag, then add a fresh `[Unreleased]` section.

## Worktree Setup

Agent worktrees start with no `node_modules`. Three pitfalls to avoid:

1. **Do not symlink** `node_modules` to the main checkout. Turbopack 16 rejects symlinks that point outside the worktree's filesystem root with `Symlink node_modules is invalid, it points out of the filesystem root`, breaking `bun run build` and `bun run dev`.
2. **Do not run a cold `bun install` if you can avoid it.** It can take 5–10 minutes on this codebase.
3. **Do not edit source files in the main checkout** to work around the above — that violates the worktree-isolation rule above.

Instead, **clone `node_modules` into the worktree** with the helper script:

```bash
./scripts/worktree-warm.sh
```

It uses APFS `cp -cR` (copy-on-write clonefile) to materialize a real `node_modules/` directory inside the worktree in ~30 seconds. Internal symlinks in bun's isolated layout are relative, so they stay valid post-clone and Turbopack accepts the tree. Total cold-start to a successful `bun run build`: under a minute.

The script falls back to `rsync --links` on non-APFS filesystems and to `bun install` if neither path is available.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Development Workflow

**All development work MUST be performed by a subagent inside a git worktree.** The main conversation coordinates; it does not edit source files directly.

- Spawn a subagent (e.g. `general-purpose`, `feature-dev:*`, `frontend-developer`, etc.) with `isolation: "worktree"` for any task that writes or edits code under `src/`, `crates/`, `electron/`, or other implementation directories.
- The main agent may still read files, investigate, and answer questions directly — the rule applies to *changes*, not reads.
- Trivial exceptions: CLAUDE.md / changelog / doc-only edits requested explicitly in-conversation may be done in the main tree.
- After the subagent finishes, review the returned worktree path + branch, then merge/PR from there rather than editing in the main tree.

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
