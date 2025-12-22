# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote Dev is a web-based terminal interface built with **Next.js 16**, **React 19**, **xterm.js**, and **NextAuth v5**. It provides:
- Multiple persistent terminal sessions via tmux
- GitHub OAuth integration with repository browsing
- Git worktree support for branch isolation
- Session recording and playback
- Session templates for reusable configurations
- Hierarchical folder organization with preference inheritance
- Split pane terminal layouts
- Modern glassmorphism UI with shadcn/ui components

## Commands

```bash
# Development (runs Next.js + terminal server concurrently)
bun run dev

# Or run separately
bun run dev:next      # Next.js dev server with Turbopack (port 3000)
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
5. **Suspend**: `POST /api/sessions/:id/suspend` detaches and marks session suspended
6. **Resume**: `POST /api/sessions/:id/resume` reattaches to existing tmux session
7. **Close**: `DELETE /api/sessions/:id` kills tmux and marks session closed

### Authentication Flow

- **Dual auth model**:
  - **Localhost** (`127.0.0.1`): Email-only credentials auth for local dev
  - **Remote/LAN**: Cloudflare Access JWT validation (via `CF_Authorization` cookie)
- **NextAuth v5** with JWT session strategy
- **Credentials provider** restricted to localhost only (security)
- **GitHub OAuth** for repository access (optional)
- Middleware in `src/middleware.ts` protects all routes except `/login` and `/api`
- Auth configuration in `src/auth.ts` exports `auth`, `signIn`, `signOut`, `handlers`
- Auth utilities in `src/lib/auth-utils.ts` handle CF Access JWT validation

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
| `terminal_session` | Session metadata, tmux names, status, worktree info |
| `github_repository` | Cached repository data with local paths |
| `session_folder` | Hierarchical folder organization |
| `folder_preferences` | Per-folder preference overrides |
| `user_settings` | User-level preferences |
| `session_template` | Reusable session configurations |
| `session_recording` | Terminal session recordings |

### Service Layer

Located in `src/services/`:

| Service | Purpose |
|---------|---------|
| `SessionService` | Session CRUD, status management |
| `TmuxService` | tmux session lifecycle, commands |
| `GitHubService` | GitHub API, repository operations |
| `WorktreeService` | Git worktree management |
| `FolderService` | Folder CRUD, hierarchy management |
| `PreferencesService` | User settings and folder preferences |
| `TemplateService` | Session template management |
| `RecordingService` | Session recording storage |

**Security**: All shell commands use `execFile` with array arguments (no shell interpolation).

### UI Components

- **shadcn/ui** components in `src/components/ui/`
- **Tailwind CSS v4** with CSS variables for theming
- **Tokyo Night** terminal theme with glassmorphism effects
- **22 Nerd Fonts** self-hosted in WOFF2 format for optimal mobile loading

**Key UI Components:**

| Component | Purpose |
|-----------|---------|
| `Terminal.tsx` | xterm.js wrapper with WebSocket and recording support |
| `TerminalWithKeyboard.tsx` | Terminal with mobile keyboard support |
| `SplitPane.tsx` | Resizable split pane layouts |
| `RecordingPlayer.tsx` | Playback recorded terminal sessions |
| `Sidebar.tsx` | Session/folder tree with context menus |
| `SessionManager.tsx` | Main orchestrator with keyboard shortcuts |
| `NewSessionWizard.tsx` | Multi-step session creation flow |
| `SaveTemplateModal.tsx` | Save session as reusable template |
| `RecordingsModal.tsx` | Browse and manage recordings |
| `SaveRecordingModal.tsx` | Save current recording |
| `FolderPreferencesModal.tsx` | Per-folder preference overrides |
| `UserSettingsModal.tsx` | User-level preferences |

### State Management

React Contexts in `src/contexts/`:

| Context | Purpose |
|---------|---------|
| `SessionContext` | Session state with optimistic updates |
| `FolderContext` | Folder tree state and operations |
| `PreferencesContext` | User settings + folder preferences with inheritance |
| `TemplateContext` | Session templates state |
| `RecordingContext` | Recording state management |

**Preference Inheritance**: Default → User Settings → Folder Preferences

## Key Files

| File | Purpose |
|------|---------|
| `src/server/terminal.ts` | WebSocket + PTY + tmux terminal server |
| `src/server/index.ts` | Terminal server entry point |
| `src/components/terminal/Terminal.tsx` | xterm.js React wrapper |
| `src/components/session/Sidebar.tsx` | Session/folder sidebar UI |
| `src/contexts/SessionContext.tsx` | Session state management |
| `src/contexts/PreferencesContext.tsx` | Preferences with inheritance |
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
- `DELETE /api/sessions/:id` - Close session
- `POST /api/sessions/:id/suspend` - Suspend session
- `POST /api/sessions/:id/resume` - Resume session
- `POST /api/sessions/:id/folder` - Move session to folder
- `GET /api/sessions/:id/token` - Get session WebSocket token
- `POST /api/sessions/reorder` - Reorder tabs

### Folders
- `GET /api/folders` - List user's folders
- `POST /api/folders` - Create folder
- `PATCH /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder

### Preferences
- `GET /api/preferences` - Get user settings + all folder preferences
- `PATCH /api/preferences` - Update user settings
- `PUT /api/preferences/folders/:folderId` - Set folder preferences
- `DELETE /api/preferences/folders/:folderId` - Reset folder preferences
- `POST /api/preferences/active-folder` - Set active folder

### Templates
- `GET /api/templates` - List session templates
- `POST /api/templates` - Create template
- `GET /api/templates/:id` - Get template
- `PATCH /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### Recordings
- `GET /api/recordings` - List recordings
- `POST /api/recordings` - Save recording
- `GET /api/recordings/:id` - Get recording
- `DELETE /api/recordings/:id` - Delete recording

### GitHub
- `GET /api/github/repositories` - List repos from GitHub
- `GET /api/github/repositories/:id` - Get cached repo
- `POST /api/github/repositories/:id` - Clone repo
- `GET /api/github/repositories/:id/branches` - List branches
- `GET /api/github/repositories/:id/folders` - Get folder structure
- `POST /api/github/worktrees` - Create worktree
- `DELETE /api/github/worktrees` - Remove worktree
- `POST /api/github/worktrees/check` - Check worktree status
- `GET /api/auth/github/link` - Start OAuth flow
- `GET /api/auth/github/callback` - OAuth callback

### Git
- `GET /api/git/validate` - Validate git repository path

### Images
- `POST /api/images` - Upload and save image

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
- `docs/openapi.yaml` - OpenAPI 3.0 specification (45 endpoints)
