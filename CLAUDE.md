# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote Dev is a web-based terminal interface built with Next.js 15, xterm.js, and NextAuth v5. It provides:
- Multiple persistent terminal sessions via tmux
- GitHub OAuth integration with repository browsing
- Git worktree support for branch isolation
- Modern glassmorphism UI with shadcn/ui components

## Commands

```bash
# Development (runs Next.js + terminal server concurrently)
bun run dev

# Or run separately
bun run dev:next      # Next.js dev server (port 3000)
bun run dev:terminal  # Terminal WebSocket server (port 3001)

# Production
bun run build
bun run start          # Next.js server
bun run start:terminal # Terminal server

# Code quality
bun run lint
bun run typecheck

# Database
bun run db:push      # Push schema changes to SQLite
bun run db:generate  # Generate migration files
bun run db:migrate   # Run migrations
bun run db:studio    # Open Drizzle Studio
bun run db:seed      # Seed authorized users
```

## Architecture

### Two-Server Model

The application runs two servers:
1. **Next.js** (port 3000) - Web UI, authentication, API routes, static assets
2. **Terminal Server** (port 3001) - WebSocket server with PTY/tmux (runs via `tsx` for node-pty compatibility)

### Terminal Flow with tmux Persistence

```
Browser (xterm.js) <--WebSocket--> Terminal Server (node-pty) <--> tmux <--> Shell
```

- WebSocket disconnection detaches from tmux but keeps the session alive
- Reconnecting reattaches to existing tmux session with full history
- Sessions persist across browser refreshes and server restarts

### Session Lifecycle

1. **Create**: `POST /api/sessions` creates DB record + tmux session (`rdv-{uuid}`)
2. **Connect**: WebSocket attaches PTY to tmux session
3. **Disconnect**: PTY terminates, tmux session continues
4. **Reconnect**: New PTY reattaches to existing tmux session
5. **Close**: `DELETE /api/sessions/:id` kills tmux and removes DB record

### Authentication Flow

- **NextAuth v5** with JWT session strategy
- **Credentials provider** checks against `authorized_user` table
- **GitHub OAuth** for repository access (optional)
- Middleware in `src/middleware.ts` protects all routes except `/login` and `/api`
- Auth configuration in `src/auth.ts` exports `auth`, `signIn`, `signOut`, `handlers`

### Database Layer

- **Drizzle ORM** with **libsql** (SQLite-compatible, works in both Bun and Node.js)
- Schema in `src/db/schema.ts`
- Database file: `sqlite.db` (gitignored)

**Core Tables:**
| Table | Purpose |
|-------|---------|
| `user` | NextAuth users |
| `account` | OAuth accounts (GitHub) |
| `authorized_user` | Email allowlist |
| `terminal_session` | Session metadata, tmux names, status |
| `github_repository` | Cached repository data |
| `user_settings` | User preferences |

### Service Layer

Located in `src/services/`:

| Service | Purpose |
|---------|---------|
| `SessionService` | Session CRUD, status management |
| `TmuxService` | tmux session lifecycle, commands |
| `GitHubService` | GitHub API, repository operations |
| `WorktreeService` | Git worktree management |

**Security**: All shell commands use `execFile` with array arguments (no shell interpolation).

### UI Components

- **shadcn/ui** components in `src/components/ui/`
- **Tailwind CSS v4** with CSS variables for theming
- **Tokyo Night** terminal theme with glassmorphism effects

**Key UI Components:**
| Component | Purpose |
|-----------|---------|
| `Terminal.tsx` | xterm.js wrapper with WebSocket |
| `TabBar.tsx` | Session tabs with drag reorder |
| `SessionManager.tsx` | Session list sidebar |
| `NewSessionWizard.tsx` | Create session flow |
| `RepositoryPicker.tsx` | GitHub repo browser |
| `BranchPicker.tsx` | Branch selection with worktree |

### State Management

- **SessionContext** (`src/contexts/SessionContext.tsx`) - React Context with useReducer
- Actions: `SET_SESSIONS`, `ADD_SESSION`, `UPDATE_SESSION`, `REMOVE_SESSION`, `SET_ACTIVE_SESSION`, `REORDER_SESSIONS`
- Optimistic updates for tab operations

## Key Files

| File | Purpose |
|------|---------|
| `src/server/terminal.ts` | WebSocket + PTY + tmux terminal server |
| `src/components/terminal/Terminal.tsx` | xterm.js React wrapper |
| `src/contexts/SessionContext.tsx` | Session state management |
| `src/auth.ts` | NextAuth configuration |
| `src/middleware.ts` | Route protection |
| `src/db/schema.ts` | Drizzle schema definitions |
| `src/services/*.ts` | Business logic services |

## API Routes

### Sessions
- `GET /api/sessions` - List user's sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `PATCH /api/sessions/:id` - Update session
- `DELETE /api/sessions/:id` - Delete session
- `POST /api/sessions/:id/suspend` - Suspend session
- `POST /api/sessions/:id/resume` - Resume session
- `POST /api/sessions/reorder` - Reorder tabs

### GitHub
- `GET /api/github/repositories` - List repos from GitHub
- `GET /api/github/repositories/:id` - Get cached repo
- `POST /api/github/repositories/:id` - Clone repo
- `GET /api/github/repositories/:id/branches` - List branches
- `GET /api/github/repositories/:id/folders` - Get folder structure
- `POST /api/github/worktrees` - Create worktree
- `DELETE /api/github/worktrees` - Remove worktree
- `GET /api/auth/github/link` - Start OAuth flow
- `GET /api/auth/github/callback` - OAuth callback

## Adding Authorized Users

Edit `src/db/seed.ts` to add emails, then run:
```bash
bun run db:seed
```

## Environment Variables

Required in `.env.local`:
```bash
AUTH_SECRET=<generate with: openssl rand -base64 32>
```

Optional (for GitHub integration):
```bash
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
TERMINAL_PORT=3001
NEXTAUTH_URL=http://localhost:3000
```

## Documentation

See the `docs/` directory for detailed documentation:
- `docs/ARCHITECTURE.md` - System architecture deep dive
- `docs/SETUP.md` - Installation and configuration guide
- `docs/API.md` - Complete API reference
