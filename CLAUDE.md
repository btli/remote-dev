# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote Dev is a web-based terminal interface built with **Next.js 16**, **React 19**, **xterm.js**, and **NextAuth v5**. It provides:
- Multiple persistent terminal sessions via tmux
- GitHub OAuth integration with repository browsing
- **Multi-GitHub account** linking with per-folder account binding
- Git worktree support for branch isolation
- Session recording and playback
- Session templates for reusable configurations
- Hierarchical folder organization with preference inheritance
- Split pane terminal layouts
- **Multi-agent CLI support** (Claude Code, Codex, Gemini, OpenCode)
- **Agent profiles** with isolated environments and per-profile theming
- Modern glassmorphism UI with shadcn/ui components

## Commands

```bash
# Development (runs Next.js + terminal server concurrently)
bun run dev

# Or run separately (ports come from .env.local)
bun run dev:next      # Next.js dev server with Turbopack (port $PORT, default 6001)
bun run dev:terminal  # Terminal WebSocket server (port $TERMINAL_PORT, default 6002)

# Production
bun run build
bun run start          # Next.js server
bun run start:terminal # Terminal server

# Process manager (alternative to bun run dev)
bun run rdv            # Interactive CLI: start/stop/restart/status
bun run rdv:dev        # Start both servers in dev mode (background)
bun run rdv:prod       # Start both servers in prod mode (background)
bun run rdv:stop       # Stop all servers
bun run rdv:restart    # Restart all servers
bun run rdv:status     # Show server status

# Code quality
bun run lint
bun run typecheck

# Testing (Vitest)
bun run test           # Run tests in watch mode
bun run test:run       # Run tests once
bun run test:ui        # Open Vitest UI
bun run test:coverage  # Run tests with coverage

# MCP

# Database
bun run db:push      # Push schema changes to SQLite
bun run db:studio    # Open Drizzle Studio
bun run db:seed      # Seed authorized users
bun run db:migrate-agents  # One-time agent session migration
bun run db:migrate-github-accounts  # Backfill GitHub account metadata from existing OAuth accounts
```

## Architecture

### Two-Server Model

The application runs two servers:
1. **Next.js** (port `$PORT`, default 6001) - Web UI, authentication, API routes, static assets
2. **Terminal Server** (port `$TERMINAL_PORT`, default 6002) - WebSocket server with PTY/tmux (runs via `tsx` for node-pty compatibility)

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

### Terminal Type Plugin System

Sessions have a `terminalType` field that determines their behavior. The plugin architecture allows extensible terminal types:

**Built-in Terminal Types:**
| Type | Description | Use Case |
|------|-------------|----------|
| `shell` | Standard terminal with bash/zsh | General command-line work |
| `agent` | AI agent as shell process | Claude Code, Codex, Gemini sessions |
| `file` | File viewer/editor (no terminal) | Editing CLAUDE.md configs |
| `browser` | Headless browser automation | Web scraping, testing, screenshots |

**Plugin Architecture:**
```
src/lib/terminal-plugins/
├── registry.ts        # TerminalTypeRegistry singleton
├── event-bus.ts       # SessionEventBus for lifecycle events
├── init.ts            # Initializes built-in plugins
└── plugins/
    ├── shell-plugin.tsx   # Default terminal plugin
    ├── agent-plugin.tsx   # AI agent plugin with exit screen
    └── file-viewer-plugin.tsx  # File viewer/editor plugin (rendered markdown + CodeMirror)
```

**Plugin Interface:**
Each plugin implements `TerminalTypePlugin` interface:
- `createSession()` - Returns shell command, environment, and metadata
- `renderContent()` - Renders the terminal/editor UI
- `onSessionExit()` - Defines exit behavior (show exit screen, auto-close, etc.)
- `onSessionRestart()` - Handles restart logic for agent sessions
- `renderExitScreen()` - Custom exit UI (agent exit screen with restart option)

**Database Columns (terminal_session):**
- `terminal_type` - Plugin type identifier (shell/agent/file)
- `agent_exit_state` - For agent type: running/exited/restarting/closed
- `agent_exit_code` - Exit code when agent process exits
- `agent_restarted_at` - Timestamp of last restart
- `agent_restart_count` - Number of times restarted
- `type_metadata` - JSON blob for plugin-specific data

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

### rdv CLI

Rust CLI for agent interaction with the terminal server. Agents use `rdv` commands via Bash instead of an MCP protocol layer.

**Location:** `crates/rdv/`

**Key Commands:**
| Command | Description |
|---------|-------------|
| `rdv session list` | List active sessions |
| `rdv session create` | Create new session |
| `rdv session exec <id> <cmd>` | Run command in session |
| `rdv agent start <folder-id>` | Start agent session using folder's preferred provider |
| `rdv agent list` | List agent sessions |
| `rdv worktree create` | Create git worktree |
| `rdv task list` | List tasks for current session |
| `rdv task create <title>` | Create task |
| `rdv task check` | Check for incomplete tasks (used by stop hook) |
| `rdv task sync` | Sync PostToolUse JSON from stdin |
| `rdv notification list` | List notifications |
| `rdv notification read` | Mark notifications as read |
| `rdv notification delete` | Delete notifications |
| `rdv browser navigate` | Navigate browser session to URL |
| `rdv browser screenshot` | Take browser screenshot |
| `rdv browser snapshot` | Get accessibility snapshot |
| `rdv browser click` | Click at coordinates |
| `rdv browser type` | Type text in browser |
| `rdv browser evaluate` | Evaluate JavaScript |
| `rdv session git-status` | Get git status for session |
| `rdv hook stop` | Handle Stop hook: report idle, check tasks, notify |
| `rdv hook notify <event>` | Send notification for lifecycle event |
| `rdv hook session-end` | Handle SessionEnd hook: report ended status |
| `rdv status` | System dashboard |
| `rdv context` | Show current session context |

**Server Discovery (env vars):**
- `RDV_SESSION_ID` — Current session UUID
- `RDV_TERMINAL_SOCKET` — Unix socket path (prod)
- `RDV_TERMINAL_PORT` — Port number (dev, default 6002)
- `RDV_API_SOCKET` — Unix socket path for Next.js API server
- `RDV_API_PORT` — Port number for Next.js API server (default 6001)
- `RDV_API_KEY` — Bearer token for API authentication

**Output:** JSON by default, `--human` flag for tables.

**Build:** `cargo build` in `crates/rdv/` or auto-installed on server startup.

### Claude Code Plugin

Plugin structure for marketplace distribution:

| Path | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin metadata |
| `.claude-plugin/marketplace.json` | Marketplace config |
| `skills/rdv/SKILL.md` | rdv CLI skill for agents |
| `commands/rdv-status.md` | /rdv-status slash command |
| `hooks/hooks.json` | Hook config for agent status/task sync |

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
| `github_account_metadata` | Linked GitHub account metadata (login, avatar, default flag, config dir) |
| `folder_github_account_link` | Per-folder GitHub account bindings |
| `project_task` | Project tasks with priority, labels, subtasks, dependencies, and due dates |
| `task_dependency` | Junction table for task blocked-by relationships |

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
| `AgentCLIService` | CLI installation verification for all supported agents |
| `AgentProfileService` | Agent profile CRUD, config file management |
| `AgentProfileAppearanceService` | Per-profile appearance settings |
| `AgentConfigTemplateService` | Templates for agent config files (CLAUDE.md, AGENTS.md, etc.) |
| `ClaudeSessionService` | Discover resumable Claude Code sessions from `.jsonl` files |
| `TaskService` | Project task CRUD, folder-scoped queries, dependency management, bulk archival |
| `NotificationService` | Notification CRUD, debounced creation, read/delete management |
| `BrowserService` | Headless browser automation (navigate, click, type, screenshot) |

**Security**: All shell commands use `execFile` with array arguments (no shell interpolation).

### Multi-Agent CLI Support

Remote Dev supports multiple AI coding agents with unified management:

| Agent | CLI Command | Config File | Required Env Vars |
|-------|-------------|-------------|-------------------|
| **Claude Code** | `claude` | `CLAUDE.md` | `ANTHROPIC_API_KEY` |
| **OpenAI Codex** | `codex` | `AGENTS.md` | `OPENAI_API_KEY` |
| **Gemini CLI** | `gemini` | `GEMINI.md` | `GOOGLE_API_KEY` |
| **OpenCode** | `opencode` | `OPENCODE.md` | `OPENAI_API_KEY` |

**Key Files:**
| File | Purpose |
|------|---------|
| `src/services/agent-cli-service.ts` | CLI verification, version checking, install instructions |
| `src/services/agent-profile-service.ts` | Profile directory management, config initialization |
| `src/services/agent-profile-appearance-service.ts` | Per-profile theme settings |
| `src/services/agent-config-template-service.ts` | Config file templates per provider |
| `src/types/agent.ts` | Agent types, provider configs, profile interfaces |

**Agent Profile Isolation:**
```
~/.remote-dev/profiles/{profile-id}/
├── .claude/           # Claude Code config
│   ├── settings.json
│   └── CLAUDE.md
├── .codex/            # Codex CLI config
├── .gemini/           # Gemini CLI config
├── .config/opencode/  # OpenCode config
├── .gitconfig         # Isolated git identity
└── .env               # Secrets from provider
```

### Electron Desktop App

Desktop application wrapper providing native OS integration:
- Tray icon with quick actions
- Auto-updater for seamless updates
- Cloudflare tunnel integration for remote access
- Cross-platform support (macOS, Linux, Windows)
- Embedded process manager for Next.js + terminal server

**Key Scripts:**
```bash
bun run electron:dev         # Dev mode: Next.js + terminal + Electron
bun run electron:dist        # Build distributable for current platform
bun run electron:dist:mac    # Build macOS distributable
bun run electron:dist:linux  # Build Linux distributable
bun run electron:dist:win    # Build Windows distributable
```

**Key Files:**
| File | Purpose |
|------|---------|
| `electron/main/index.ts` | Main process entry point |
| `electron/main/process-manager.ts` | Manages Next.js and terminal server processes |
| `electron/main/cloudflared.ts` | Cloudflare tunnel management |
| `electron/main/tray.ts` | System tray icon and menu |
| `electron/main/auto-updater.ts` | Auto-update logic |
| `electron/main/config.ts` | Electron app configuration |

### Testing

- **Vitest** with **happy-dom** environment
- Config: `vitest.config.ts`

**Commands:**
```bash
bun run test           # Run tests in watch mode
bun run test:run       # Run tests once
bun run test:ui        # Open Vitest UI
bun run test:coverage  # Run tests with coverage
```

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
| `AgentCLIStatusPanel.tsx` | CLI installation status for all supported agents |
| `AgentProfileAppearanceSettings.tsx` | Per-profile theming with mode toggle and color schemes |
| `TaskSidebar.tsx` | Right sidebar for project-scoped task tracking |
| `TaskEditor.tsx` | Inline expandable task editor with subtasks, dependencies, and metadata |

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
| `GitHubAccountContext` | Multi-GitHub account state with folder bindings |
| `TaskContext` | Project tasks state with folder-scoped CRUD |
| `NotificationContext` | Notification state with toast integration and delete operations |

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
| `crates/rdv/` | Rust CLI for agent interaction |
| `src/lib/terminal-plugins/registry.ts` | Terminal type plugin registry |
| `src/lib/terminal-plugins/plugins/*.tsx` | Built-in terminal type plugins |
| `src/types/terminal-type.ts` | Terminal type system interfaces |
| `src/components/terminal/AgentExitScreen.tsx` | Agent exit screen UI |

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
- `GET /api/sessions/:id/git-status` - Get git status
- `POST /api/sessions/:id/browser/navigate` - Navigate browser
- `GET /api/sessions/:id/browser/screenshot` - Take screenshot
- `GET /api/sessions/:id/browser/snapshot` - Get accessibility snapshot
- `POST /api/sessions/:id/browser/click` - Click at coordinates
- `POST /api/sessions/:id/browser/type` - Type text
- `POST /api/sessions/:id/browser/evaluate` - Evaluate JavaScript
- `POST /api/sessions/:id/browser/back` - Navigate back
- `POST /api/sessions/:id/browser/forward` - Navigate forward

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
- `GET /api/github/repositories/:id/issues/:number/comments` - Get issue comments
- `POST /api/github/worktrees` - Create worktree
- `DELETE /api/github/worktrees` - Remove worktree
- `POST /api/github/worktrees/check` - Check worktree status
- `GET /api/auth/github/link` - Start OAuth flow
- `GET /api/auth/github/callback` - OAuth callback
- `GET /api/github/accounts` - List linked GitHub accounts with folder bindings
- `PATCH /api/github/accounts/:accountId` - Set default, bind/unbind folder
- `DELETE /api/github/accounts/:accountId` - Unlink a GitHub account

### API Keys
- `GET /api/keys` - List user's API keys
- `POST /api/keys` - Create new API key
- `GET /api/keys/:id` - Get API key details
- `DELETE /api/keys/:id` - Revoke API key

### Git
- `GET /api/git/validate` - Validate git repository path

### Directories
- `GET /api/directories` - Browse filesystem directories (secure, restricted to allowed paths)

### Files
- `POST /api/files/exists` - Batch check file existence on disk
- `GET /api/files/read` - Read file contents for editor
- `POST /api/files/write` - Write file contents

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

### Agent CLI
- `GET /api/agent-cli/status` - Get all CLI installation statuses (version, path, install instructions)

### Agent Sessions
- `GET /api/agent/claude-sessions` - List resumable Claude Code sessions for a project path

### Agent Profiles
- `GET /api/profiles/:id/appearance` - Get profile appearance settings
- `PUT /api/profiles/:id/appearance` - Update profile appearance (mode, schemes, terminal settings)
- `DELETE /api/profiles/:id/appearance` - Reset profile appearance to defaults

### Notifications
- `GET /api/notifications` - List notifications with unread count
- `PATCH /api/notifications` - Mark notifications read (by ids or all)
- `DELETE /api/notifications` - Delete notifications (by ids or all)

### Tasks
- `GET /api/tasks` - List tasks (optional `?folderId=` filter)
- `POST /api/tasks` - Create task
- `DELETE /api/tasks` - Bulk clear tasks (requires `?folderId=`, optional `?source=&sessionId=&completedOnly=`)
- `GET /api/tasks/:id` - Get task details
- `PATCH /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

## Quick Setup

Use the init script for guided setup:
```bash
./scripts/init.sh
```

Or with options:
```bash
./scripts/init.sh --email your@email.com --port 6001 --terminal-port 6002
```

## Adding Authorized Users

Set the `AUTHORIZED_USERS` environment variable with comma-separated emails:
```bash
AUTHORIZED_USERS="user@example.com,another@example.com" bun run db:seed
```

## Environment Variables

Required in `.env.local`:
```bash
AUTH_SECRET=<generate with: openssl rand -base64 32>
PORT=6001
TERMINAL_PORT=6002
NEXT_PUBLIC_TERMINAL_PORT=6002  # Must match TERMINAL_PORT (client-side WebSocket)
NEXTAUTH_URL=http://localhost:6001
```

Optional (for GitHub integration):
```bash
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
```

For database seeding:
```bash
AUTHORIZED_USERS=user@example.com,another@example.com
```

## Documentation

See the `docs/` directory for detailed documentation:
- `docs/ARCHITECTURE.md` - System architecture deep dive
- `docs/SETUP.md` - Installation and configuration guide
- `docs/API.md` - Complete API reference
- `docs/openapi.yaml` - OpenAPI 3.0 specification (53 endpoints)

## Changelog and Releases

**All notable changes must be tracked in `CHANGELOG.md`** following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

### When to Update CHANGELOG.md

Update the changelog when making changes that are:
- **Added**: New features or capabilities
- **Changed**: Changes to existing functionality
- **Deprecated**: Features marked for removal
- **Removed**: Features that have been removed
- **Fixed**: Bug fixes
- **Security**: Security-related fixes

### Changelog Format

```markdown
## [Unreleased]

### Added
- Description of new feature

### Fixed
- Description of bug fix
```

### Release Process

1. Update `CHANGELOG.md` with all changes under `[Unreleased]`
2. Change `[Unreleased]` to version number with date: `[X.Y.Z] - YYYY-MM-DD`
3. Update `package.json` version
4. Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
5. Push tag: `git push origin vX.Y.Z`
6. Add new `[Unreleased]` section at top for future changes
