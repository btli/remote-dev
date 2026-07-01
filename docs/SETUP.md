# Setup Guide

Deep environment and configuration reference for Remote Dev — environment
variables, GitHub OAuth, OIDC SSO, remote access, multi-instance hosting, and the
PostgreSQL backend.

> For a quick install, see [`../INSTALL.md`](../INSTALL.md); this doc is the full
> configuration reference and does not repeat the basic clone / install / run steps.

## Prerequisites

### Required Software

1. **Bun** (v1.0+)
   ```bash
   # macOS/Linux
   curl -fsSL https://bun.sh/install | bash

   # Or with Homebrew
   brew install oven-sh/bun/bun
   ```

2. **tmux** (for session persistence)
   ```bash
   # macOS
   brew install tmux

   # Ubuntu/Debian
   sudo apt install tmux

   # Fedora
   sudo dnf install tmux
   ```

3. **Git** (for repository features)
   ```bash
   # Usually pre-installed, verify with:
   git --version
   ```

### Verify Installation

```bash
bun --version    # Should show 1.x.x
tmux -V          # Should show tmux 3.x
git --version    # Should show git 2.x
```

## Configuration

The basic clone → `bun install` → run happy-path lives in
[`../INSTALL.md`](../INSTALL.md). This section covers only the **configuration**
that install references: environment variables, the database, and authorized
users. If you would rather be walked through all of it interactively, jump to
[Quick Setup with Init Script](#quick-setup-with-init-script).

### Configure Environment

Create `.env.local` with your settings:

```bash
# Required: Auth secret (generate with: openssl rand -base64 32)
AUTH_SECRET=<your-generated-secret>

# Server ports (customize as needed)
PORT=6001
TERMINAL_PORT=6002
NEXT_PUBLIC_TERMINAL_PORT=6002  # Must match TERMINAL_PORT (client-side WebSocket)
AUTH_URL=http://localhost:6001

# Optional: GitHub OAuth (see GitHub Setup below)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional: Generic OIDC SSO (see "OIDC Single Sign-On" below)
# All three must be set for the provider + login button to appear.
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_NAME=OIDC                  # Server-side display label
NEXT_PUBLIC_OIDC_NAME=OIDC      # Same label, exposed to the login button
```

> **NextAuth v5 note:** `AUTH_URL` is the canonical env var. Legacy
> `NEXTAUTH_URL` is still read for backward compatibility but new
> configs should prefer `AUTH_URL`.

Or use the init script for guided setup (recommended):

```bash
./scripts/init.sh
```

### Initialize the Database

Push the schema to create tables:

```bash
bun run db:push
```

### Add Authorized Users

Set the `AUTHORIZED_USERS` environment variable with comma-separated emails and run the seed script:

```bash
AUTHORIZED_USERS="your-email@example.com" bun run db:seed
```

For multiple users:

```bash
AUTHORIZED_USERS="user1@example.com,user2@example.com" bun run db:seed
```

### Start the Servers

Starting the app (`bun run dev`, or the production/process-manager variants) is
covered in [`../INSTALL.md`](../INSTALL.md) and under
[Development Workflow](#development-workflow) below. `bun run dev` brings up both
servers using the ports from `.env.local`:

- Next.js on http://localhost:6001 (or `$PORT`)
- Terminal server on ws://localhost:6002 (or `$TERMINAL_PORT`)

## Quick Setup with Init Script

For a streamlined setup experience, use the init script:

```bash
./scripts/init.sh
```

The script will:
1. Check and install prerequisites (bun, tmux)
2. Install dependencies
3. Generate `.env.local` with secure defaults
4. Prompt for GitHub OAuth credentials (optional)
5. Initialize the database
6. Add authorized users
7. Start the development server

### Init Script Options

```bash
# Full interactive setup
./scripts/init.sh

# Skip prompts, use defaults
./scripts/init.sh --defaults

# Specify authorized email directly
./scripts/init.sh --email your@email.com

# Custom ports
./scripts/init.sh --port 6001 --terminal-port 6002

# Multi-instance: write RDV_BASE_PATH + RDV_INSTANCE_SLUG to .env.local
./scripts/init.sh --base-path /alpha --instance-slug alpha
```

## Multi-Instance Deployment

Remote Dev can run multiple isolated instances behind a single domain by
giving each one a URL prefix — for example `https://dev.example.com/alpha/`
and `https://dev.example.com/beta/`. One Cloudflare tunnel, one TLS cert,
one CF Access policy fronts the entire fleet. Each instance keeps its
own SQLite DB, its own tmux namespace, and its own NextAuth identity;
this is a **routing-layer** feature, not multi-tenancy inside a single
process.

For the full spec see
[`docs/plans/multi-instance-basepath.md`](./plans/multi-instance-basepath.md).

### Per-instance env vars

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `RDV_BASE_PATH` | yes (per instance) | `/alpha` | Must start with `/`, must not end with `/`, lowercase + digits + `-` only. Empty string disables the prefix and reverts to single-instance behavior. |
| `RDV_INSTANCE_SLUG` | optional | `alpha` | Defaults to the last segment of `RDV_BASE_PATH`. Used in the `X-RDV-Instance` response header and as a cookie-name suffix. |
| `AUTH_URL` | yes | `https://dev.example.com/alpha` | **Must include the basePath.** NextAuth uses this to build OAuth callback URLs and reachable routes. |
| `AUTH_SECRET` | yes | `<openssl rand -base64 32>` | **MUST be unique per instance.** Two pods sharing a secret can decrypt each other's JWTs, defeating the path-scoped cookies. Provision separately and rotate independently — same rule for `AUTH_SECRET_1` / `_2` / `_3` rotation keys. |
| `RDV_DATA_DIR` | recommended | `/var/lib/rdv-alpha` | Per-instance SQLite + tmux namespace. Two pods sharing a data dir will corrupt each other. |

### GitHub OAuth per instance

GitHub OAuth callbacks are path-scoped, so each instance needs its own
OAuth app (or its own callback URLs registered against a shared app).

**Two callbacks must be registered per instance**:

```
# Sign-in flow (NextAuth handler)
https://dev.example.com/alpha/api/auth/callback/github

# Account-linking flow (custom handler, used for adding extra GitHub
# accounts to an already-signed-in user)
https://dev.example.com/alpha/api/auth/github/callback
```

NextAuth uses the first; the multi-GitHub-account link flow
(`src/app/api/auth/github/callback/route.ts`) uses the second. Both
are required even if you do not use account linking — GitHub OAuth
apps reject requests whose `redirect_uri` is not in the registered
list, so missing the second callback breaks the link flow with a
hard 400.

Add both URLs (per instance) in the OAuth app settings on
[GitHub Developer Settings](https://github.com/settings/developers).

### Same image, different basePath at deploy time

Per NF-4 in the spec, the `.next/standalone/` build artifact does **not**
bake `RDV_BASE_PATH` into the image — `next.config.ts` reads it at
process startup. The build itself, however, applies the basePath to the
client bundle, so the same Docker image needs to be re-built when the
basePath changes. In practice this means one image per slug, not one
image per fleet.

API-only paths (e.g. `/api/config`, `/api/health`) are served by the
same image fine; it's the **client-side router** that needs the prefix
baked in to emit the correct `<Link>` hrefs and asset URLs.

### Quick init

```bash
./scripts/init.sh --base-path /alpha --instance-slug alpha
# then in the same .env.local, set AUTH_URL=http://localhost:6001/alpha
```

## GitHub Integration Setup

GitHub integration enables:
- Browsing your repositories
- One-click cloning
- Automatic worktree creation

### Create OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the form (adjust port if using custom `$PORT`):

| Field | Value |
|-------|-------|
| Application name | `Remote Dev` |
| Homepage URL | `http://localhost:6001` |
| Authorization callback URL | `http://localhost:6001/api/auth/github/callback` |

4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"**
7. Copy the **Client Secret** (shown only once!)

### Configure Credentials

Add to your `.env.local`:

```bash
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
```

### Test Integration

1. Start the app: `bun run dev`
2. Log in with your authorized email
3. Click **"Connect GitHub"** in the header
4. Authorize the application
5. You should be redirected back with "GitHub Connected" status

## OIDC Single Sign-On

A generic, env-driven **OpenID Connect** provider lets you sign in through any
standards-compliant identity provider (Okta, Authentik, Keycloak, Auth0, Azure
AD/Entra, Google Workspace, …) instead of — or alongside — the GitHub and
localhost-email login methods.

### Configure

Set all three of the following in `.env.local` (the provider is registered
**only** when issuer + client id + client secret are all present):

```bash
OIDC_ISSUER=https://idp.example.com        # OIDC issuer (no trailing slash)
OIDC_CLIENT_ID=your_client_id
OIDC_CLIENT_SECRET=your_client_secret
OIDC_NAME=Okta                             # Button label, e.g. "Okta"
NEXT_PUBLIC_OIDC_NAME=Okta                 # Same label, surfaced to the client button
```

Endpoints are auto-discovered from
`${OIDC_ISSUER}/.well-known/openid-configuration`, so no individual
authorization/token/userinfo URLs are required.

Register this **callback (redirect) URL** with your identity provider:

```
https://<your-host>/api/auth/callback/oidc
```

For multi-instance hosting the callback is path-scoped like GitHub's, e.g.
`https://dev.example.com/alpha/api/auth/callback/oidc`.

### Security: default-deny allowlist

OIDC sign-in is **default-denied**: exactly like GitHub, a successful login at
the identity provider is rejected unless the user's email is present in the
`authorizedUsers` allowlist (seed it as described in *Add Authorized Users*
above). A new IdP account that is not on the allowlist cannot get in.

This provider works **alongside Cloudflare Access** — it adds an in-app login
method and does not change the Cloudflare Access / API-key / localhost-email
paths. Remote/LAN access still validates the Cloudflare Access JWT as before.

### Test

1. Set the env vars and restart the app.
2. Open `/login` — a **"Sign in with {OIDC_NAME}"** button appears below the
   email form.
3. Click it, authenticate at your IdP, and you are redirected back signed in
   (only if your email is on the allowlist).

## Database Management

### View Data

Open Drizzle Studio to browse your database:

```bash
bun run db:studio
```

This opens a web UI at http://localhost:4983

### Reset Database

To start fresh:

```bash
rm sqlite.db
bun run db:push
AUTHORIZED_USERS="your-email@example.com" bun run db:seed
```

### Schema Changes

The schema has a single source of truth at `src/db/schema.def.ts`. Edit that
file (not the generated `schema.sqlite.ts` / `schema.pg.ts` / `schema.ts`), then
regenerate the dialect files:

```bash
bun run db:codegen
```

After regenerating, push the SQLite schema:

```bash
bun run db:push
```

(If you target Postgres, also generate the PG migrations — see below.)

## PostgreSQL backend (optional)

SQLite (libsql) is the **default** and requires no extra configuration. Remote
Dev can instead run on **PostgreSQL** — useful for multi-instance / clustered
deployments — by setting a single environment variable. The connection-string
**scheme selects the dialect at boot**; nothing else changes for callers.

```bash
# Opt in — any postgresql:// (or postgres://) URL switches the backend.
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

- **Driver:** [`node-postgres`](https://www.npmjs.com/package/pg) (`pg`). The
  driver and Postgres-specific code are only loaded when `DATABASE_URL` is a
  Postgres URL — a SQLite install never pulls in `pg`.
- **Minimum version:** PostgreSQL **14+** (the CloudNativePG manifests in
  `deploy/k8s/cnpg/` provision **17**).
- **Unset / `file:` URL → SQLite.** Leaving `DATABASE_URL` unset (or pointing it
  at a `file:` path) keeps the default SQLite behavior unchanged.

### Creating the Postgres schema

On the Postgres path the app applies the committed Drizzle migrations
**automatically on boot** (`src/db/migrate.ts`, invoked from
`src/instrumentation.ts`) — a fresh database (e.g. an empty CNPG database) is
brought fully up to schema at startup, idempotently. No manual `db:push` is
needed in production.

For manual/dev use, create or update the schema directly:

```bash
# Apply the current PG schema to a database (drizzle-kit push):
DATABASE_URL=postgresql://user:pass@host:5432/dbname bun run db:push:pg

# Or generate a new PG migration after a schema change (see db:codegen above):
DATABASE_URL=postgresql://user:pass@host:5432/dbname bun run db:generate:pg
```

### Logs + analytics on Postgres

When the backend is Postgres, the **logs** and **LiteLLM analytics** sidecars
live in the *same* Postgres database under dedicated `logs` and `analytics`
schemas (bootstrapped on boot), rather than in separate `~/.remote-dev/*.db`
files. This is transparent to the app — the sidecar factory picks the backend
from `DATABASE_URL`.

To move an existing SQLite install onto Postgres, see
[`docs/POSTGRES_MIGRATION.md`](./POSTGRES_MIGRATION.md).

## Development Workflow

### Running Servers Separately

For debugging, run servers in separate terminals:

```bash
# Terminal 1: Next.js
bun run dev:next

# Terminal 2: Terminal server
bun run dev:terminal
```

### Process Manager

As an alternative to `bun run dev`, you can use the process manager to run servers in the background:

```bash
bun run rdv            # Interactive CLI: start/stop/restart/status
bun run rdv:dev        # Start both servers in dev mode (background)
bun run rdv:prod       # Start both servers in prod mode (background)
bun run rdv:stop       # Stop all servers
bun run rdv:restart    # Restart all servers
bun run rdv:status     # Show server status
```

### Testing

Run tests with Vitest:

```bash
bun run test           # Run tests in watch mode
bun run test:run       # Run tests once
bun run test:ui        # Open Vitest UI
bun run test:coverage  # Run tests with coverage
```

### Code Quality

Before committing:

```bash
bun run lint        # Check for linting errors
bun run typecheck   # Check TypeScript types
```

### Watching for Changes

The dev server automatically reloads on changes:
- Next.js: Hot Module Replacement
- Terminal server: tsx watch mode

## Production Setup

### Build

```bash
bun run build
```

### Start Production Servers

```bash
# Terminal 1: Next.js
bun run start

# Terminal 2: Terminal server
bun run start:terminal
```

### Environment Variables

For production, ensure all variables are set:

```bash
AUTH_SECRET=<strong-random-secret>
PORT=6001
TERMINAL_PORT=6002
NEXT_PUBLIC_TERMINAL_PORT=6002
AUTH_URL=http://localhost:6001  # Should match $PORT (+ basePath if RDV_BASE_PATH is set)
GITHUB_CLIENT_ID=<if-using-github>
GITHUB_CLIENT_SECRET=<if-using-github>

# Multi-instance hosting (optional, see "Multi-Instance Deployment" above)
RDV_BASE_PATH=
RDV_INSTANCE_SLUG=

# Claude usage-limit poller (EXPERIMENTAL — optional, OFF by default). Set to "1"
# to enable the proactive Anthropic usage poller that refreshes each Claude
# profile's usage-limit state on a timer. The shipped default path is REACTIVE
# scrollback detection (a Claude session's recent output is scanned for the
# usage-limit phrase when it goes idle), which works without this flag. The poll
# sweep interval is always registered but is a no-op unless this is "1"; it runs
# on a fixed ~10-minute interval (not configurable). See API.md → "Claude usage
# limits & pools".
RDV_CLAUDE_USAGE_POLL_ENABLED=
```

## Troubleshooting

### "Cannot connect to terminal server"

1. Check if terminal server is running:
   ```bash
   lsof -i :6002   # Or your $TERMINAL_PORT
   ```

2. Start it manually:
   ```bash
   bun run dev:terminal
   ```

3. Check for port conflicts:
   ```bash
   TERMINAL_PORT=6003 bun run dev:terminal
   ```

### "tmux: command not found"

Install tmux:
```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt install tmux
```

### "Unauthorized" after login

1. Check your email is in the authorized users list:
   ```bash
   bun run db:studio
   # Look at authorized_user table
   ```

2. Re-run seed with your email:
   ```bash
   AUTHORIZED_USERS="your-email@example.com" bun run db:seed
   ```

### GitHub OAuth errors

1. Verify callback URL matches your port:
   `http://localhost:6001/api/auth/github/callback`
   (adjust port to match your `$PORT` in `.env.local`)

2. Check credentials in `.env.local`

3. Ensure your GitHub email matches an authorized user

### Sessions not persisting

1. Verify tmux is working:
   ```bash
   tmux new -s test
   # Ctrl+B, D to detach
   tmux list-sessions
   ```

2. Check for orphaned sessions:
   ```bash
   tmux list-sessions | grep rdv-
   ```

3. Kill all Remote Dev sessions:
   ```bash
   tmux list-sessions | grep rdv- | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
   ```

## MCP Server Integration

Remote Dev includes configuration for the Next.js MCP (Model Context Protocol) server, which enables AI coding assistants to interact with your development server.

### Configuration

The `.mcp.json` file at the project root configures the MCP server:

```json
{
  "mcpServers": {
    "next-devtools": {
      "command": "npx",
      "args": ["-y", "next-devtools-mcp@latest"]
    }
  }
}
```

### Usage

When running `bun run dev`, the MCP server automatically:
1. Discovers your running Next.js instance
2. Provides context to AI coding assistants
3. Enables enhanced development workflows

For more details, see the [Next.js MCP documentation](https://nextjs.org/docs/app/guides/mcp).

## File Locations

| File | Purpose |
|------|---------|
| `.env.local` | Environment variables |
| `.mcp.json` | MCP server configuration |
| `sqlite.db` | SQLite database |
| `~/.remote-dev/repos/` | Cloned repositories |

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the codebase
- Read [API.md](API.md) for API documentation
- Check the main [README.md](../README.md) for usage instructions
