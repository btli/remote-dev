# Architecture

This document describes the technical architecture of Remote Dev.

## Overview

Remote Dev is a web-based terminal interface that provides:
- Multiple persistent terminal sessions via tmux
- GitHub repository integration with worktree support
- Modern React-based UI with real-time terminal emulation
- Session recording and playback
- Reusable session templates
- Two-level project group + project organization with preference inheritance
- Self-hosted Nerd Fonts with mobile optimization
- Glassmorphism UI with Tokyo Night theme

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser                                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │
│  │  React App    │  │   xterm.js    │  │  SessionCtx   │               │
│  │  (Next.js)    │  │  (Terminal)   │  │  (State Mgmt) │               │
│  └───────┬───────┘  └───────┬───────┘  └───────────────┘               │
│          │                  │                                           │
│          │ HTTP/RSC         │ WebSocket                                 │
└──────────┼──────────────────┼───────────────────────────────────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌──────────────────┐
│   Next.js App    │  │  Terminal Server │
│   (Port 3000)    │  │   (Port 3001)    │
│                  │  │                  │
│  ┌────────────┐  │  │  ┌────────────┐  │
│  │ API Routes │  │  │  │  ws Server │  │
│  ├────────────┤  │  │  ├────────────┤  │
│  │ Auth (v5)  │  │  │  │  node-pty  │  │
│  ├────────────┤  │  │  ├────────────┤  │
│  │ Services   │  │  │  │ tmux mgmt  │  │
│  └────────────┘  │  │  └────────────┘  │
│        │         │  │        │         │
└────────┼─────────┘  └────────┼─────────┘
         │                     │
         ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│     SQLite       │  │      tmux        │
│   (libsql)       │  │   (Sessions)     │
│                  │  │                  │
│  - users         │  │  - rdv-{uuid}    │
│  - sessions      │  │  - Persistent    │
│  - groups        │  │  - Detachable    │
│  - projects      │  │                  │
│  - node_prefs    │  │                  │
│  - templates     │  │                  │
│  - recordings    │  │                  │
│  - repositories  │  │                  │
└──────────────────┘  └──────────────────┘
```

## Two-Server Model

### Why Two Servers?

1. **Bun Compatibility**: Bun doesn't fully support `node-pty` native bindings
2. **Isolation**: Terminal processes are isolated from the web server
3. **Scalability**: Servers can be scaled independently
4. **Reliability**: Terminal server crash doesn't affect web UI

### Next.js Server (Port 3000)

Handles:
- React Server Components and SSR
- Authentication (NextAuth v5)
- API routes for session and GitHub management
- Static assets and client bundles

Technologies:
- Next.js 16 with App Router and Turbopack
- React 19 with Server Components
- Drizzle ORM with SQLite (libsql)
- Tailwind CSS v4 with CSS variables

### Terminal Server (Port 3001)

Handles:
- WebSocket connections from xterm.js
- PTY (pseudo-terminal) spawning via node-pty
- tmux session attachment/creation
- Terminal I/O multiplexing

Technologies:
- Node.js with tsx (for TypeScript)
- ws (WebSocket server)
- node-pty (native PTY bindings)
- tmux (session persistence)

## Data Flow

### Terminal Session Lifecycle

```
1. User clicks "New Session"
       │
       ▼
2. POST /api/sessions
   - Generate tmux session name (rdv-{uuid})
   - Create DB record
   - Return session metadata
       │
       ▼
3. Frontend connects WebSocket
   ws://localhost:3001?sessionId=X&tmuxSession=rdv-abc
       │
       ▼
4. Terminal Server
   - Check if tmux session exists
   - If not: tmux new-session -d -s rdv-abc
   - Spawn PTY: pty.spawn("tmux", ["attach", "-t", "rdv-abc"])
       │
       ▼
5. Bidirectional I/O
   Browser <--WebSocket--> PTY <---> tmux <---> Shell
       │
       ▼
6. User closes browser
   - WebSocket closes
   - PTY attachment terminates
   - tmux session continues running
       │
       ▼
7. User returns
   - WebSocket reconnects
   - PTY reattaches to existing tmux session
   - Full terminal history restored
```

### GitHub Integration Flow

```
1. User clicks "Connect GitHub"
       │
       ▼
2. GET /api/auth/github/link
   - Redirect to GitHub OAuth
   - Scope: read:user, user:email, repo
       │
       ▼
3. GitHub OAuth callback
   - Exchange code for access token
   - Store in accounts table
   - Link to existing user
       │
       ▼
4. User creates session from GitHub
       │
       ▼
5. GET /api/github/repositories
   - Fetch repos from GitHub API
   - Cache in github_repositories table
       │
       ▼
6. POST /api/github/repositories/:id
   - Clone repo to ~/.remote-dev/repos/{owner}/{repo}
   - Update localPath in DB
       │
       ▼
7. POST /api/github/worktrees (optional)
   - Create git worktree for branch
   - Return worktree path
       │
       ▼
8. Create session with worktree as CWD
```

## Service Layer

### SessionService (`src/services/session-service.ts`)

Manages terminal session CRUD:

```typescript
// Create new session
createSession(userId, { name, projectPath, githubRepoId, worktreeBranch })

// Get user's sessions
listSessions(userId, status?)

// Update session
updateSession(sessionId, userId, updates)

// Close session (marks as closed, kills tmux)
closeSession(sessionId, userId)
```

### TmuxService (`src/services/tmux-service.ts`)

Manages tmux session lifecycle:

```typescript
// Check if tmux is available
isTmuxInstalled()

// Generate unique session name
generateSessionName(sessionId) // -> "rdv-abc12345"

// Create new tmux session
createSession(sessionName, cwd?)

// Check if session exists
sessionExists(sessionName)

// Kill session
killSession(sessionName)

// List all sessions
listSessions()
```

### GitHubService (`src/services/github-service.ts`)

Manages GitHub API integration:

```typescript
// Get access token from DB
getAccessToken(userId)

// List user's repositories
listRepositoriesFromAPI(accessToken, page, perPage, sort)

// Clone repository locally
cloneRepository(accessToken, repoFullName, localPath?)

// Get folder structure
getFolderStructure(localPath, maxDepth)
```

### WorktreeService (`src/services/worktree-service.ts`)

Manages git worktrees:

```typescript
// Create worktree for branch
createWorktree(repoPath, branchName, options?)

// Remove worktree
removeWorktree(worktreePath)

// List worktrees
listWorktrees(repoPath)

// Get branches
getBranches(repoPath)
```

### GroupService (`src/services/group-service.ts`)

Manages project groups (the container layer of the tree). Groups are nestable
and hold preferences only — they cannot own sessions, tasks, or channels.

```typescript
// Create group
GroupService.create({ userId, name, parentGroupId, sortOrder? })

// List user's groups
GroupService.list(userId)

// Get one group
GroupService.get(groupId)

// Update group (name / collapsed / sort)
GroupService.update({ id, name?, collapsed?, sortOrder? })

// Move group to a new parent (or to root with null)
GroupService.move({ id, newParentGroupId })

// Delete group; force=true cascades to descendants
GroupService.delete({ id, force })
```

### ProjectService (`src/services/project-service.ts`)

Manages projects (the leaf layer). Projects own sessions, tasks, channels,
secrets configs, GitHub bindings, and repository associations.

```typescript
// Create project under a group
ProjectService.create({ userId, groupId, name, sortOrder? })

// List by group / by user
ProjectService.listByGroup(groupId)
ProjectService.listByUser(userId)

// Get one project
ProjectService.get(projectId)

// Update project
ProjectService.update({ id, name?, collapsed?, sortOrder? })

// Reparent
ProjectService.move({ id, newGroupId })

// Delete
ProjectService.delete(projectId)
```

### PreferencesService (`src/services/preferences-service.ts`)

Manages user settings and **node preferences** (polymorphic, keyed by an
`(ownerType, ownerId)` pair where `ownerType` is `"group" | "project"`).

```typescript
// User settings
getUserSettings(userId)
updateUserSettings(userId, settings)

// Node preferences (group OR project)
getNodePreferences(ownerRef, userId)
setNodePreferences(ownerRef, userId, preferences)
deleteNodePreferences(ownerRef, userId)

// Effective preferences (walks group ancestry, then applies project)
getEffectivePreferences(userId, projectId?)
```

Preference inheritance order:

```
Default Settings → User Settings → Group Preferences (root → leaf) → Project Preferences
```

Group preferences are restricted to a subset of fields (no `localRepoPath`),
while project preferences accept the full schema.

### TemplateService (`src/services/template-service.ts`)

Manages reusable session templates:

```typescript
// Create template
createTemplate(userId, { name, settings, isDefault? })

// List templates
listTemplates(userId)

// Get template
getTemplate(templateId, userId)

// Update template
updateTemplate(templateId, userId, updates)

// Delete template
deleteTemplate(templateId, userId)
```

### RecordingService (`src/services/recording-service.ts`)

Manages terminal session recordings:

```typescript
// Save recording
saveRecording(userId, { sessionId, name, data, duration })

// List recordings
listRecordings(userId)

// Get recording
getRecording(recordingId, userId)

// Delete recording
deleteRecording(recordingId, userId)
```

### ApiKeyService (`src/services/api-key-service.ts`)

Manages API keys for programmatic access:

```typescript
// Create API key (returns full key once)
createApiKey(userId, name, expiresAt?)

// Validate API key (constant-time comparison)
validateApiKey(key) // -> { userId, keyId } | null

// List user's API keys
listApiKeys(userId)

// Get API key details
getApiKey(keyId, userId)

// Revoke API key
revokeApiKey(keyId, userId)
```

Security notes:
- Keys are hashed with SHA-256 (appropriate for high-entropy random keys)
- Validation uses constant-time comparison to prevent timing attacks
- Key prefix stored separately for efficient lookup without exposing hash

## Database Schema

### Core Tables

```sql
-- Users (NextAuth)
user (id, name, email, emailVerified, image)

-- OAuth Accounts (NextAuth + GitHub)
account (userId, type, provider, providerAccountId, access_token, ...)

-- Authorized Users (allowlist)
authorized_user (id, email, createdAt)

-- Terminal Sessions
terminal_session (
  id, userId, name, tmuxSessionName,
  projectPath, githubRepoId, worktreeBranch,
  status, tabOrder, projectId, lastActivityAt, createdAt, updatedAt
)

-- Cached GitHub Repositories
github_repository (
  id, userId, githubId, name, fullName,
  cloneUrl, defaultBranch, localPath, isPrivate,
  addedAt, updatedAt
)

-- Project Groups (nestable containers, preferences only)
project_group (
  id, userId, name, parentGroupId, sortOrder,
  collapsed, createdAt, updatedAt
)

-- Projects (leaves; own sessions, tasks, channels, secrets, repo)
project (
  id, userId, groupId, name, sortOrder,
  collapsed, createdAt, updatedAt
)

-- User Settings (with font, startup, and active node tracking)
user_settings (
  id, userId, defaultWorkingDirectory, theme,
  fontSize, fontFamily, notificationsEnabled,
  isRecording, startupCommand,
  activeNodeId, activeNodeType,  -- "group" | "project"
  createdAt, updatedAt
)

-- Node Preferences (polymorphic per-node overrides)
node_preferences (
  id, ownerType, ownerId, userId,
  fields,  -- JSON; restricted schema for groups, full schema for projects
  createdAt, updatedAt
)

-- Session Templates (reusable configurations)
session_template (
  id, userId, name, settings, isDefault, createdAt, updatedAt
)

-- Session Recordings (terminal playback data)
session_recording (
  id, userId, sessionId, name, data, duration, createdAt
)

-- API Keys (programmatic access)
api_key (
  id, userId, name, keyPrefix, keyHash,
  lastUsedAt, expiresAt, createdAt
)

```

## Security Considerations

### Authentication

- **Browser**: Email allowlist in `authorized_user` table
- **Programmatic**: API key authentication with Bearer tokens
- JWT session strategy (stateless)
- GitHub OAuth for repository access
- No password storage (credentials are just email verification)

### API Key Security

- Keys generated with 256 bits of cryptographic randomness
- SHA-256 hashing (appropriate for high-entropy keys, faster than bcrypt)
- Constant-time comparison prevents timing attacks
- Key prefix stored for identification without exposing hash
- Optional expiration dates for time-limited access

### Command Execution

- All shell commands use `execFile` with array arguments
- No shell interpolation of user input
- Arguments passed as arrays to prevent injection
- See `src/lib/exec.ts` for the safe execution utilities

### Local-Only Design

- Designed for local development use
- No production deployment considerations
- Database is local SQLite file
- Repositories cloned to user's home directory

## Performance Considerations

### Terminal Performance

- Direct PTY-to-WebSocket piping
- No buffering or processing of terminal output
- Resize events propagated immediately

### React Performance

- Server Components for initial load
- Client-side state management with Context
- Optimistic updates for tab operations

### Database Performance

- SQLite for low-latency local operations
- Drizzle ORM for type-safe queries
- Connection pooling handled by libsql

## UI Architecture

### Key Components

| Component | Purpose |
|-----------|---------|
| `Terminal.tsx` | xterm.js wrapper with WebSocket, resize protection, and recording support |
| `TerminalWithKeyboard.tsx` | Terminal with mobile virtual keyboard support |
| `RecordingPlayer.tsx` | Playback recorded terminal sessions with seek controls |
| `Sidebar.tsx` | Sidebar shell hosting the project tree and global controls |
| `ProjectTreeSidebar.tsx` | Group + project tree with context menus, drag-drop, active-node selection |
| `ProjectTreeRow.tsx` | Row renderer for an individual group or project node |
| `SessionManager.tsx` | Main orchestrator with keyboard shortcuts |
| `NewSessionWizard.tsx` | Multi-step session creation flow |
| `SaveTemplateModal.tsx` | Save session as reusable template |
| `GroupPreferencesModal.tsx` | Per-group preference overrides (subset of fields) |
| `ProjectPreferencesModal.tsx` | Per-project preference overrides (full schema) |
| `UserSettingsModal.tsx` | User-level preferences |

### React Contexts

| Context | Purpose |
|---------|---------|
| `SessionContext` | Session state with optimistic updates |
| `ProjectTreeContext` | Combined group + project tree, active-node tracking, descendant aggregation |
| `PreferencesContext` | User settings + node preferences with inheritance |
| `TemplateContext` | Session templates state |
| `RecordingContext` | Recording state management |

### Preference Inheritance

```
Default Settings (hardcoded)
       ↓
User Settings (user_settings table)
       ↓
Group Preferences (node_preferences, ownerType="group", walked root→leaf)
       ↓
Project Preferences (node_preferences, ownerType="project")
       ↓
Effective Preferences (computed at runtime)
```

### Active Node and Descendant Aggregation

`user_settings` carries `activeNodeId` + `activeNodeType` (`"group" | "project"`).
When a project is active, project-scoped views (tasks, channels, peer messages)
filter to that single project. When a **group** is active, those same views
roll up across every descendant project — recursively walking the group
sub-tree — so a group node serves as a workspace pivot, not just a label.

## Font System

### Self-Hosted Nerd Fonts

Remote Dev self-hosts 22 Nerd Font families in WOFF2 format for optimal terminal rendering:

- **Default**: JetBrainsMono Nerd Font Mono
- **Available**: FiraCode, Hack, SourceCodePro, UbuntuMono, CascadiaCode, Meslo, Inconsolata, RobotoMono, IBMPlexMono, VictorMono, SpaceMono, DroidSansMono, AnonymousPro, DejaVuSansMono, Terminus, Cousine, BitstreamVeraSansMono, DaddyTimeMono, FantasqueSansMono, NotoMono

### Why Self-Hosted?

1. **Mobile Compatibility**: External font services often fail on mobile browsers
2. **Offline Support**: Fonts work without internet connection
3. **Performance**: WOFF2 provides excellent compression (~30% smaller than WOFF)
4. **Nerd Font Icons**: Full glyph support for terminal status lines and dev tools

### Font Loading

Fonts are loaded via `@font-face` declarations in `globals.css` with:
- `font-display: swap` for fast initial render
- Subset-specific unicode ranges where available
- Fallback to system monospace fonts
