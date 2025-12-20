# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote Dev is a web-based terminal interface built with Next.js 16, xterm.js, and NextAuth. It runs locally on a laptop and provides authenticated terminal access through the web.

## Commands

```bash
# Development
bun run dev          # Start dev server with Turbopack
bun run build        # Production build
bun run start        # Start production server
bun run lint         # Run ESLint
bun run typecheck    # Run TypeScript type checking

# Database
bun run db:push      # Push schema changes to SQLite
bun run db:generate  # Generate migration files
bun run db:migrate   # Run migrations
bun run db:studio    # Open Drizzle Studio
bun run db:seed      # Seed database with initial data
```

## Architecture

### Authentication Flow
- **NextAuth v5** with JWT session strategy (not database sessions)
- Credentials provider checks against `authorized_user` table
- Middleware in `src/middleware.ts` protects all routes except `/login` and `/api`
- Auth configuration in `src/auth.ts` exports `auth`, `signIn`, `signOut`, `handlers`

### Database Layer
- **Drizzle ORM** with **libsql** (SQLite-compatible, works in both Bun and Node.js)
- Schema in `src/db/schema.ts` includes: `users`, `accounts`, `sessions`, `verificationTokens`, `authorizedUsers`
- Only emails in `authorized_user` table can authenticate
- Database file: `sqlite.db` (gitignored)

### Terminal Component
- `src/components/terminal/Terminal.tsx` wraps xterm.js
- Uses `@xterm/addon-fit` for responsive sizing
- Uses `@xterm/addon-web-links` for clickable links
- Tokyo Night theme configured

### UI Components
- shadcn/ui components in `src/components/ui/`
- Tailwind CSS v4 with CSS variables for theming
- Dark mode enabled by default

## Key Files

| File | Purpose |
|------|---------|
| `src/auth.ts` | NextAuth configuration and exports |
| `src/middleware.ts` | Route protection |
| `src/db/schema.ts` | Drizzle schema definitions |
| `src/db/seed.ts` | Database seeding script |
| `drizzle.config.ts` | Drizzle Kit configuration |

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
