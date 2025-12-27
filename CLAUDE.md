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
  - **API Keys**: Bearer token auth for programmatic access (agents, automation)
- **NextAuth v5** with JWT session strategy
- **Credentials provider** restricted to localhost only (security)
- **GitHub OAuth** for repository access (optional)
- Middleware in `src/middleware.ts` protects all routes except `/login` and `/api`
- Auth configuration in `src/auth.ts` exports `auth`, `signIn`, `signOut`, `handlers`
- Auth utilities in `src/lib/auth-utils.ts` handle CF Access JWT validation
- API auth wrapper in `src/lib/api.ts` provides `withApiAuth` for dual session/API key auth

### MCP Server (Model Context Protocol)

Optional MCP server for AI agent integration. Enables Claude Desktop, Cursor, and other MCP clients to interact with Remote Dev.

**Architecture:**
- Runs on stdio transport alongside the terminal server
- Uses local trust model (no additional authentication)
- Provides 24 tools, 6 resources, and 5 workflow prompts

**Components:**
| Component | Count | Description |
|-----------|-------|-------------|
| Tools | 24 | Session management, git/worktree operations, folder/preferences |
| Resources | 6 | Read-only access to sessions and folders |
| Prompts | 5 | Workflow templates for common tasks |

**Key Files:**
| File | Purpose |
|------|---------|
| `src/mcp/index.ts` | MCP server initialization and request handlers |
| `src/mcp/registry.ts` | Tool/resource/prompt registration with Zod→JSON Schema |
| `src/mcp/tools/*.ts` | Tool implementations (session, git, folder) |
| `src/mcp/resources/*.ts` | Resource providers (session, folder data) |
| `src/mcp/prompts/*.ts` | Workflow prompt templates |
| `src/mcp/utils/auth.ts` | User context for MCP requests |
| `src/mcp/utils/error-handler.ts` | Error formatting with recovery hints |

**Environment Variables:**
```bash
MCP_ENABLED=true      # Enable MCP server on terminal server startup
MCP_USER_ID=<uuid>    # Override user ID for MCP requests (optional)
```

### Clean Architecture (Domain Layer)

The codebase follows Clean Architecture principles with a domain-driven core for session and folder management. This provides better testability, maintainability, and separation of concerns.

**Layer Structure:**
```
src/
  domain/                    # Layer 1: Pure business logic (no dependencies)
    entities/                # Session, Folder domain entities
    value-objects/           # SessionStatus, TmuxSessionName
    errors/                  # Domain-specific errors

  application/               # Layer 2: Use cases (depends only on domain)
    use-cases/               # CreateSession, SuspendSession, etc.
    ports/                   # Repository & gateway interfaces

  infrastructure/            # Layer 3: Implementations (implements ports)
    persistence/
      repositories/          # DrizzleSessionRepository, etc.
      mappers/               # DB ↔ Domain type converters
    external/
      tmux/                  # TmuxGateway implementation
      worktree/              # WorktreeGateway implementation
    container.ts             # Dependency injection wiring

  interface/                 # Layer 4: API adapters
    presenters/              # Domain → API response transformers
```

**Key Patterns:**
- **Immutable Entities**: Domain entities are immutable; state changes return new instances
- **Value Objects**: Type-safe wrappers for domain concepts (e.g., `SessionStatus`)
- **Repository Pattern**: Abstract persistence behind interfaces for testability
- **Use Cases**: Single-responsibility orchestrators for business operations
- **Dependency Injection**: Infrastructure wired via `container.ts`

**Key Files:**
| File | Purpose |
|------|---------|
| `src/domain/entities/Session.ts` | Session entity with state machine |
| `src/domain/entities/Folder.ts` | Folder entity with hierarchy validation |
| `src/domain/value-objects/SessionStatus.ts` | Type-safe session status |
| `src/application/use-cases/session/*.ts` | Session use cases |
| `src/application/ports/*.ts` | Repository and gateway interfaces |
| `src/infrastructure/container.ts` | DI container with singleton instances |

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
| `api_key` | API keys for programmatic access |
| `split_group` | Split pane groups with direction |
| `trash_item` | Polymorphic trash items with 30-day retention |
| `worktree_trash_metadata` | Worktree-specific trash metadata |
| `port_registry` | Port allocations for environment variable conflict detection |
| `folder_secrets_config` | Per-folder secrets provider configuration |

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
| `ApiKeyService` | API key management and validation |
| `SplitService` | Split pane group management |
| `TrashService` | Polymorphic trash management, cleanup scheduling |
| `WorktreeTrashService` | Worktree-specific trash operations, restore logic |
| `PortRegistryService` | Port allocation tracking and conflict detection |
| `SecretsService` | Secrets provider abstraction, credential management |

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
| `SplitPane.tsx` | In-session split pane container (multiple terminals in one session) |
| `SplitPaneLayout.tsx` | Cross-session split layout (multiple sessions side-by-side) |
| `ResizeHandle.tsx` | Draggable resize handle for split panes |
| `RecordingPlayer.tsx` | Playback recorded terminal sessions |
| `Sidebar.tsx` | Session/folder tree with context menus |
| `SessionManager.tsx` | Main orchestrator with keyboard shortcuts |
| `NewSessionWizard.tsx` | Multi-step session creation flow |
| `SaveTemplateModal.tsx` | Save session as reusable template |
| `RecordingsModal.tsx` | Browse and manage recordings |
| `SaveRecordingModal.tsx` | Save current recording |
| `FolderPreferencesModal.tsx` | Per-folder preference overrides |
| `UserSettingsModal.tsx` | User-level preferences |
| `SecretsConfigModal.tsx` | Configure secrets providers per folder |
| `SecretsStatusButton.tsx` | Header indicator for secrets connection status |
| `DirectoryBrowser.tsx` | Modal for visual filesystem directory navigation |
| `PathInput.tsx` | Text input with browse button for directory selection |

### State Management

React Contexts in `src/contexts/`:

| Context | Purpose |
|---------|---------|
| `SessionContext` | Session state with optimistic updates |
| `FolderContext` | Folder tree state and operations |
| `PreferencesContext` | User settings + folder preferences with inheritance |
| `TemplateContext` | Session templates state |
| `RecordingContext` | Recording state management |
| `SplitContext` | Split pane groups and active pane tracking |
| `TrashContext` | Trash items state and operations |
| `SecretsContext` | Secrets provider configurations and state |
| `PortContext` | Port allocations, framework detection, monitoring |

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
| `src/contexts/SplitContext.tsx` | Split pane state management |
| `src/services/split-service.ts` | Split pane operations |
| `src/components/split/SplitPaneLayout.tsx` | Split layout component |
| `src/mcp/index.ts` | MCP server initialization |
| `src/mcp/registry.ts` | MCP tool/resource registration |

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
- `POST /api/sessions/:id/exec` - Execute command (fire-and-forget)
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
- `GET /api/preferences/folders/:folderId/environment` - Get resolved environment variables
- `POST /api/preferences/folders/:folderId/validate-ports` - Validate port conflicts

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
- `GET /api/github/repositories/:id/issues` - List repository issues
- `POST /api/github/worktrees` - Create worktree
- `DELETE /api/github/worktrees` - Remove worktree
- `POST /api/github/worktrees/check` - Check worktree status
- `GET /api/auth/github/link` - Start OAuth flow
- `GET /api/auth/github/callback` - OAuth callback

### API Keys
- `GET /api/keys` - List user's API keys
- `POST /api/keys` - Create new API key
- `GET /api/keys/:id` - Get API key details
- `DELETE /api/keys/:id` - Revoke API key

### Git
- `GET /api/git/validate` - Validate git repository path

### Directories
- `GET /api/directories` - Browse filesystem directories (secure, restricted to allowed paths)

### Images
- `POST /api/images` - Upload and save image

### Splits
- `GET /api/splits` - List user's split groups
- `POST /api/splits` - Create new split from session
- `GET /api/splits/:id` - Get split group details
- `PATCH /api/splits/:id` - Update split direction
- `DELETE /api/splits/:id` - Dissolve split group
- `POST /api/splits/:id/sessions` - Add session to split
- `DELETE /api/splits/:id/sessions` - Remove session from split
- `PUT /api/splits/:id/layout` - Update pane sizes

### Trash
- `GET /api/trash` - List trash items
- `POST /api/trash` - Trigger cleanup of expired items
- `GET /api/trash/:id` - Get trash item details
- `DELETE /api/trash/:id` - Permanently delete from trash
- `GET /api/trash/:id/restore` - Check restore availability
- `POST /api/trash/:id/restore` - Restore from trash
- `POST /api/cron/trash-cleanup` - Scheduled cleanup endpoint (30-day retention)

### Secrets
- `GET /api/secrets/configs` - List all folder secrets configurations
- `GET /api/secrets/folders/:folderId` - Get folder secrets config
- `PUT /api/secrets/folders/:folderId` - Create/update secrets config
- `PATCH /api/secrets/folders/:folderId` - Toggle secrets enabled
- `DELETE /api/secrets/folders/:folderId` - Delete secrets config
- `GET /api/secrets/folders/:folderId/secrets` - Fetch secret values from provider
- `POST /api/secrets/validate` - Validate provider credentials

## Adding Authorized Users

Set the `AUTHORIZED_USERS` environment variable with comma-separated emails:
```bash
AUTHORIZED_USERS="user@example.com,another@example.com" bun run db:seed
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

For database seeding:
```bash
AUTHORIZED_USERS=user@example.com,another@example.com
```

For MCP server (optional):
```bash
MCP_ENABLED=true      # Enable MCP server on terminal server startup
MCP_USER_ID=<uuid>    # Override default user ID for MCP requests
```

## Documentation

See the `docs/` directory for detailed documentation:
- `docs/ARCHITECTURE.md` - System architecture deep dive
- `docs/SETUP.md` - Installation and configuration guide
- `docs/API.md` - Complete API reference
- `docs/openapi.yaml` - OpenAPI 3.0 specification (53 endpoints)
