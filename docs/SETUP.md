# Setup Guide

Complete guide for setting up Remote Dev on your local machine.

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

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/btli/remote-dev.git
cd remote-dev
```

### 2. Install Dependencies

```bash
bun install
```

This installs all Node.js dependencies including:
- Next.js and React
- xterm.js for terminal emulation
- node-pty for PTY support
- Drizzle ORM for database
- shadcn/ui components

### 3. Configure Environment

Create `.env.local` with your settings:

```bash
# Required: Auth secret (generate with: openssl rand -base64 32)
AUTH_SECRET=<your-generated-secret>

# Server ports (customize as needed)
PORT=6001
TERMINAL_PORT=6002
NEXTAUTH_URL=http://localhost:6001

# Optional: GitHub OAuth (see GitHub Setup below)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Or use the init script for guided setup (recommended):

```bash
./scripts/init.sh
```

### 4. Initialize Database

Push the schema to create tables:

```bash
bun run db:push
```

### 5. Add Authorized Users

Set the `AUTHORIZED_USERS` environment variable with comma-separated emails and run the seed script:

```bash
AUTHORIZED_USERS="your-email@example.com" bun run db:seed
```

For multiple users:

```bash
AUTHORIZED_USERS="user1@example.com,user2@example.com" bun run db:seed
```

### 6. Start the Application

```bash
bun run dev
```

This starts both servers using ports from `.env.local`:
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
./scripts/init.sh --port 3000 --terminal-port 3001
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

After modifying `src/db/schema.ts`:

```bash
bun run db:push
```

## Development Workflow

### Running Servers Separately

For debugging, run servers in separate terminals:

```bash
# Terminal 1: Next.js
bun run dev:next

# Terminal 2: Terminal server
bun run dev:terminal
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
GITHUB_CLIENT_ID=<if-using-github>
GITHUB_CLIENT_SECRET=<if-using-github>
NEXTAUTH_URL=http://localhost:3000
```

## Troubleshooting

### "Cannot connect to terminal server"

1. Check if terminal server is running:
   ```bash
   lsof -i :3001
   ```

2. Start it manually:
   ```bash
   bun run dev:terminal
   ```

3. Check for port conflicts:
   ```bash
   TERMINAL_PORT=3002 bun run dev:terminal
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
