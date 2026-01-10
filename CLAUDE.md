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
- **Multi-agent CLI support** (Claude Code, Codex, Gemini, OpenCode)
- **Agent profiles** with isolated environments and per-profile theming
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

### Master Control System

**Agent-agnostic autonomous monitoring and intervention system** that detects stalled terminal sessions and suggests recovery actions. Supports all coding agents (Claude Code, Codex, Gemini, OpenCode).

**Architecture:**
- **Master Control**: Monitors ALL terminal sessions for a user (agent-agnostic)
- **Folder Control**: Monitor sessions within specific folders (higher priority than Master Control)
- **Clean Architecture**: Domain → Application → Infrastructure → Interface layers
- **Stall Detection**: MD5 hash comparison of tmux scrollback buffer
- **Auto-initialization**: Master Control created automatically on first session
- **Persistent Monitoring**: Survives server restarts

**Key Components:**
| Component | Purpose |
|-----------|---------|
| **Domain Layer** | Immutable entities (Orchestrator, OrchestratorInsight, OrchestratorAuditLog) |
| **Use Cases** | Business logic (CreateOrchestrator, DetectStalledSessions, InjectCommand) |
| **Repositories** | Persistence interfaces (IOrchestratorRepository, IInsightRepository) |
| **Gateways** | External operations (IScrollbackMonitor, ICommandInjector) |
| **Monitoring Service** | Automated cycles (runs every 30s by default) |
| **MCP Integration** | 6 tools for AI agent access (see MCP Tools below) |

**MCP Tools:**
| Tool | Purpose |
|------|---------|
| `session_send_input` | Inject command into session via orchestrator |
| `session_get_insights` | Get insights for a session |
| `orchestrator_status` | Get orchestrator status and stats |
| `session_analyze` | Analyze session scrollback to understand agent activity |
| `session_agent_info` | Get agent provider info (claude, codex, gemini, opencode) |
| `project_metadata_detect` | Detect project stack, framework, dependencies |

**Stall Detection Logic:**
- Captures tmux scrollback buffer via `tmux capture-pane`
- Compares MD5 hash with previous snapshot
- Calculates confidence score: `0.7 + (0.05 × extra_minutes_beyond_threshold)`
- Reduces confidence by 50% if buffer has < 5 lines
- Default threshold: 5 minutes (300 seconds)

**Command Injection Safety:**
- Validates against 8 dangerous patterns (rm -rf /, fork bombs, disk operations)
- 7 caution patterns allowed with warnings (rm -rf, sudo rm, chmod, chown)
- Max command length: 10,000 characters
- Null byte detection
- Audit log for all injections

**Lifecycle Flow:**
```
User creates first session
  → Master Control auto-created with dedicated session
  → Monitoring starts automatically (30s interval)
  → Captures scrollback snapshots every cycle
  → Compares with previous snapshot via MD5 hash
  → If stalled > threshold: Generate OrchestratorInsight
  → Insight includes severity, context, suggested actions
  → User can execute actions via UI or auto-intervention
  → Audit log tracks all actions
```

**Database Tables:**
- `orchestrator_sessions` - Orchestrator metadata and configuration
- `orchestrator_insights` - Generated insights with severity and suggested actions
- `orchestrator_audit_logs` - Complete audit trail of all orchestrator actions

**Key Files:**
| File | Purpose |
|------|---------|
| `src/domain/entities/Orchestrator.ts` | Orchestrator domain entity with state machine |
| `src/application/use-cases/orchestrator/*.ts` | 6 use cases for orchestrator operations |
| `src/infrastructure/external/tmux/*.ts` | Scrollback monitor and command injector |
| `src/services/monitoring-service.ts` | Automated monitoring cycles |
| `src/components/orchestrator/*.ts` | 8 UI components for orchestrator management |

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
| `orchestrator_sessions` | Orchestrator agents with monitoring configuration |
| `orchestrator_insights` | Generated insights with severity and suggested actions |
| `orchestrator_audit_logs` | Complete audit trail of orchestrator actions |

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
| `OrchestratorService` | Master Control and Folder Control management |
| `InsightService` | Insight generation, resolution, retrieval |
| `MonitoringService` | Automated monitoring cycles, stall detection |

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

### rdv CLI (Rust Orchestration Tool)

The `rdv` CLI is a Rust-based tool for multi-agent orchestration. It uses **direct SQLite database access** (no HTTP API) and **tmux** for session management.

**Location:** `crates/rdv/`

**Build and Install:**
```bash
cd crates/rdv
cargo build --release
# Binary at target/release/rdv
```

**Commands:**

| Command | Description |
|---------|-------------|
| `rdv master init` | Initialize Master Control |
| `rdv master start [--foreground]` | Start Master Control |
| `rdv master stop` | Stop Master Control |
| `rdv master status` | Show Master Control status |
| `rdv master attach` | Attach to Master Control session |
| `rdv folder init [path]` | Initialize folder orchestrator |
| `rdv folder start [path]` | Start folder orchestrator |
| `rdv folder stop [path]` | Stop folder orchestrator |
| `rdv folder status [path]` | Show folder orchestrator status |
| `rdv folder list` | List all folder orchestrators |
| `rdv session spawn <folder> [-a agent]` | Spawn task session |
| `rdv session list [-f folder]` | List sessions |
| `rdv session attach <id>` | Attach to session |
| `rdv session inject <id> <context>` | Inject context |
| `rdv session scrollback <id>` | Get scrollback content |
| `rdv task create <desc> [-f folder]` | Create task (with beads) |
| `rdv task list [--status]` | List tasks |
| `rdv task execute <id>` | Execute planned task |
| `rdv monitor start [--foreground]` | Start monitoring service |
| `rdv monitor status` | Show monitoring status |
| `rdv monitor check <session>` | Check session health |
| `rdv status [--json]` | System status dashboard |
| `rdv doctor` | Run diagnostics |

**Database Integration:**
- Direct SQLite access via `rusqlite` (no HTTP API)
- Reads/writes same `sqlite.db` as Next.js
- Uses `RDV_DATABASE_PATH` env or auto-discovers `sqlite.db`

**Monitoring Integration:**
- Captures tmux scrollback and computes MD5 hash
- Detects stalls via hash comparison (threshold: 5 minutes)
- Creates insights directly in `orchestrator_insight` table
- Updates `terminal_session.last_activity_at` for heartbeats
- Confidence scoring: `0.7 + (0.05 × extra_minutes)`, reduced 50% if < 5 lines

**Beads Integration:**
- Tasks can link to beads issues (`bd` CLI)
- Auto-creates beads issues on task creation
- Updates beads status on task completion

**Key Files:**
| File | Purpose |
|------|---------|
| `crates/rdv/src/db.rs` | Direct SQLite database operations |
| `crates/rdv/src/tmux.rs` | tmux session management |
| `crates/rdv/src/commands/monitor.rs` | Monitoring service with DB integration |
| `crates/rdv/src/commands/master.rs` | Master Control commands |
| `crates/rdv/src/commands/folder.rs` | Folder orchestrator commands |
| `crates/rdv/src/commands/session.rs` | Session management commands |
| `crates/rdv/src/commands/task.rs` | Task lifecycle commands |
| `crates/rdv/src/config.rs` | Configuration management |

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
| `OrchestratorStatusIndicator.tsx` | Header brain icon showing Master Control status |
| `InsightNotificationInbox.tsx` | Bell icon notification center for insights |
| `StalledSessionBadge.tsx` | Session tab indicator for stall detection |
| `SubOrchestratorConfigModal.tsx` | Create/configure Folder Control |
| `InsightDetailView.tsx` | Full insight card with context and actions |
| `CommandInjectionDialog.tsx` | Confirm command injection dialog |
| `AuditLogSidebar.tsx` | View orchestrator audit trail |
| `SidebarOrchestratorStatus.tsx` | Folder sidebar orchestrator status widget |

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
| `OrchestratorContext` | Orchestrator state, insights, monitoring status |

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
| `src/domain/entities/Orchestrator.ts` | Orchestrator domain entity with state machine |
| `src/application/use-cases/orchestrator/*.ts` | 6 orchestrator use cases |
| `src/infrastructure/external/tmux/*.ts` | Scrollback monitor and command injector |
| `src/services/monitoring-service.ts` | Automated monitoring cycles |
| `src/contexts/OrchestratorContext.tsx` | Orchestrator state management |
| `src/components/orchestrator/*.tsx` | 8 orchestrator UI components |

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
- `GET /api/folders/:id/orchestrator` - Get Folder Control agent
- `POST /api/folders/:id/orchestrator` - Create/get Folder Control agent
- `DELETE /api/folders/:id/orchestrator` - Delete Folder Control agent

### Orchestrators
- `GET /api/orchestrators` - List user's orchestrators (master + sub)
- `POST /api/orchestrators` - Create orchestrator
- `GET /api/orchestrators/:id` - Get orchestrator details
- `PATCH /api/orchestrators/:id` - Update orchestrator config
- `DELETE /api/orchestrators/:id` - Delete orchestrator
- `POST /api/orchestrators/:id/pause` - Pause orchestrator monitoring
- `POST /api/orchestrators/:id/resume` - Resume orchestrator monitoring
- `GET /api/orchestrators/:id/insights` - Get orchestrator insights
- `POST /api/orchestrators/:id/insights/:insightId/resolve` - Resolve insight
- `POST /api/orchestrators/:id/commands` - Inject command into session
- `GET /api/orchestrators/:id/audit` - Get audit log entries

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

### Agent CLI
- `GET /api/agent-cli/status` - Get all CLI installation statuses (version, path, install instructions)

### Agent Profiles
- `GET /api/profiles/:id/appearance` - Get profile appearance settings
- `PUT /api/profiles/:id/appearance` - Update profile appearance (mode, schemes, terminal settings)
- `DELETE /api/profiles/:id/appearance` - Reset profile appearance to defaults

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
