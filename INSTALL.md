# Installation

This guide walks you from a clean checkout to a running Remote Dev instance on your machine. For
the deep environment and configuration reference, see [docs/SETUP.md](docs/SETUP.md); for production
deployment, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Prerequisites

| Requirement | Why | Install |
|-------------|-----|---------|
| [Bun](https://bun.sh/) (latest) | Package manager and JS/TS runtime | `curl -fsSL https://bun.sh/install \| bash` |
| [tmux](https://github.com/tmux/tmux) | Backs persistent terminal sessions | macOS: `brew install tmux` · Debian/Ubuntu: `sudo apt install tmux` · Fedora: `sudo dnf install tmux` |
| [Git](https://git-scm.com/) | Clone and worktree features | Preinstalled on most systems |

**Platforms:** macOS, Linux, or Windows via WSL. Verify your tooling before continuing:

```bash
bun --version
tmux -V
git --version
```

## 1. Clone and install

```bash
git clone https://github.com/btli/remote-dev.git
cd remote-dev
bun install
```

## 2. Set up — guided or manual

### Option A: Guided script (recommended)

`scripts/init.sh` checks prerequisites, installs dependencies, writes `.env.local` (with a freshly
generated `AUTH_SECRET`), initializes the database, seeds your authorized user, runs a build check,
and offers to start the dev server.

```bash
./scripts/init.sh --email you@example.com --port 6001 --terminal-port 6002
```

Useful flags:

| Flag | Effect |
|------|--------|
| `--email EMAIL` | Authorize this email at seed time |
| `--port PORT` | Next.js port (default `6001`) |
| `--terminal-port PORT` | Terminal server port (default `6002`) |
| `--defaults` | Accept defaults, skip all prompts |
| `--base-path PATH` | Set `RDV_BASE_PATH` for multi-instance hosting (e.g. `/alpha`) |
| `--skip-start` | Don't launch the dev server at the end |

If you used the guided script, skip to [Verify](#5-verify).

### Option B: Manual setup

Create `.env.local` in the project root:

```bash
# Required — generate with: openssl rand -base64 32
AUTH_SECRET=your-secret-here

# Ports
PORT=6001                       # Next.js web UI
TERMINAL_PORT=6002              # Terminal WebSocket server
NEXT_PUBLIC_TERMINAL_PORT=6002  # Must match TERMINAL_PORT (used by the browser)

# NextAuth v5 base URL (legacy NEXTAUTH_URL is still accepted)
AUTH_URL=http://localhost:6001
```

`NEXT_PUBLIC_TERMINAL_PORT` is read by the browser to open the terminal WebSocket, so it **must**
match `TERMINAL_PORT`. The full environment-variable reference lives in
[docs/SETUP.md](docs/SETUP.md).

## 3. Initialize the database

Push the schema to a local SQLite database (the default backend):

```bash
bun run db:push
```

## 4. Authorize your user

Only allowlisted emails can sign in. Seed yours (comma-separate to add several):

```bash
AUTHORIZED_USERS="you@example.com" bun run db:seed
```

## 5. Run

```bash
bun run dev
```

This starts the Next.js web UI and the terminal WebSocket server concurrently.

## 6. Verify

Open [http://localhost:6001](http://localhost:6001) and sign in with the email you authorized above.
Create a session from the sidebar and confirm a shell prompt appears — that round-trip exercises
both servers and tmux.

If the terminal never connects, the most common cause is a `NEXT_PUBLIC_TERMINAL_PORT` that doesn't
match `TERMINAL_PORT`.

## Optional: Cursor TUI

Local installations launch agent CLIs from the terminal server host's `PATH`.
To use Cursor, install its CLI and authenticate once as the same OS user that
runs Remote Dev:

```bash
curl https://cursor.com/install -fsS | bash
export PATH="$HOME/.local/bin:$PATH"  # only needed if agent is not already found

agent --version
agent login
agent status
```

Browser login is recommended. `CURSOR_API_KEY` is supported for automation but
is not required by Remote Dev. After installation, check **Settings → Agents**,
then launch **Pick Agent ▸ → Cursor** from a project. Container deployments using
the repository's golden dev-env image already include `agent` system-wide.

For resume behavior, dangerous-flag handling, storage paths, and troubleshooting,
see the [Cursor TUI quick start](docs/AGENTS.md#cursor-tui-quick-start).

## Optional: Kimi CLI

Local installations launch agent CLIs from the terminal server host's `PATH`.
To use Kimi, install its CLI and authenticate once as the same OS user that
runs Remote Dev:

```bash
curl -LsSf https://code.kimi.com/install.sh | bash   # native installer (recommended)
# or: npm install -g @moonshot-ai/kimi-code

kimi --version
kimi login   # OAuth device-code flow
```

With the native installer the binary lives at `~/.kimi-code/bin/kimi`; Remote Dev
probes that well-known location as well as `PATH`, so detection works even
though launchd services don't source shell rc files.

Authentication is OAuth (`kimi login`) or an API key in `config.toml`; no
environment variable is required. After installation, check **Settings → Agents**,
then launch **Pick Agent ▸ → Kimi** from a project. Container deployments using
the repository's golden dev-env image already include `kimi` system-wide.

For resume behavior, lifecycle hooks, dangerous-flag handling, and
troubleshooting, see the [Kimi CLI quick start](docs/AGENTS.md#kimi-cli-quick-start).

## Optional: GitHub OAuth

GitHub repository browsing, cloning, and account linking require an OAuth app. Create one at
[GitHub Developer Settings](https://github.com/settings/developers) and register **both** callback
URLs (sign-in and account-linking use different handlers):

```
http://localhost:6001/api/auth/callback/github   # Sign-in (NextAuth)
http://localhost:6001/api/auth/github/callback    # Account linking
```

Then add the credentials to `.env.local`:

```bash
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

Full walkthrough (scopes, per-instance callbacks, testing): [docs/SETUP.md](docs/SETUP.md).

## Next steps

- **Configuration reference** — environment variables, OIDC SSO, and the optional PostgreSQL
  backend: [docs/SETUP.md](docs/SETUP.md).
- **Production deployment** — blue/green slot swaps and the HMAC deploy webhook:
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Multi-instance hosting** — several isolated instances behind one domain:
  [docs/MULTI_INSTANCE.md](docs/MULTI_INSTANCE.md).
- **Agent CLIs (Cursor TUI, Kimi CLI, and more)** — installation, authentication, provider
  isolation, and resume behavior: [docs/AGENTS.md](docs/AGENTS.md).
- **Everything else** — start at the [documentation index](docs/README.md).
