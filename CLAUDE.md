# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote Dev is a web-based terminal interface built with Next.js 16, xterm.js, and NextAuth. It runs locally on a laptop and provides authenticated terminal access through the web.

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
1. **Next.js** (port 3000) - Web UI, authentication, static assets
2. **Terminal Server** (port 3001) - WebSocket server with PTY processes (runs via `tsx` for node-pty compatibility)

### Terminal Flow
```
Browser (xterm.js) <--WebSocket--> Terminal Server (ws + node-pty) <--> Shell Process
```

- `src/server/terminal.ts` - WebSocket server that spawns PTY processes
- `src/components/terminal/Terminal.tsx` - xterm.js React component with WebSocket client
- Messages are JSON: `{type: "input"|"output"|"resize"|"ready"|"exit", ...}`

### Authentication Flow
- **NextAuth v5** with JWT session strategy
- Credentials provider checks against `authorized_user` table
- Middleware in `src/middleware.ts` protects all routes except `/login` and `/api`
- Auth configuration in `src/auth.ts` exports `auth`, `signIn`, `signOut`, `handlers`

### Database Layer
- **Drizzle ORM** with **libsql** (SQLite-compatible, works in both Bun and Node.js)
- Schema in `src/db/schema.ts`: `users`, `accounts`, `sessions`, `verificationTokens`, `authorizedUsers`
- Only emails in `authorized_user` table can authenticate
- Database file: `sqlite.db` (gitignored)

### UI Components
- shadcn/ui components in `src/components/ui/`
- Tailwind CSS v4 with CSS variables for theming
- Tokyo Night terminal theme

## Key Files

| File | Purpose |
|------|---------|
| `src/server/terminal.ts` | WebSocket + PTY terminal server |
| `src/components/terminal/Terminal.tsx` | xterm.js React wrapper |
| `src/auth.ts` | NextAuth configuration |
| `src/middleware.ts` | Route protection |
| `src/db/schema.ts` | Drizzle schema definitions |

## Adding Authorized Users

Edit `src/db/seed.ts` to add emails, then run:
```bash
bun run db:seed
```

## Environment Variables

Required in `.env.local`:
```
AUTH_SECRET=<generate with: openssl rand -base64 32>
```

Optional:
```
TERMINAL_PORT=3001  # WebSocket server port
```
