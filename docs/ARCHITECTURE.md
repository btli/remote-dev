# Architecture

This document describes the technical architecture of Remote Dev.

## Overview

Remote Dev is a web-based terminal interface that provides:
- Multiple persistent terminal sessions via tmux
- GitHub repository integration with worktree support
- Modern React-based UI with real-time terminal emulation
- Session recording and playback
- Reusable session templates
- Hierarchical folder organization with preference inheritance
- Split pane terminal layouts
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
│  - folders       │  │  - Detachable    │
│  - templates     │  │                  │
│  - recordings    │  │                  │
│  - repositories  │  │                  │
│  - preferences   │  │                  │
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

### FolderService (`src/services/folder-service.ts`)

Manages hierarchical folder organization:

```typescript
// Create folder
createFolder(userId, { name, parentId?, color? })

// List user's folders
listFolders(userId)

// Update folder
updateFolder(folderId, userId, updates)

// Delete folder
deleteFolder(folderId, userId)

// Move folder
moveFolder(folderId, userId, parentId)
```

### PreferencesService (`src/services/preferences-service.ts`)

Manages user settings and folder preferences with inheritance:

```typescript
// Get user settings
getUserSettings(userId)

// Update user settings
updateUserSettings(userId, settings)

// Get folder preferences
getFolderPreferences(userId, folderId)

// Set folder preferences
setFolderPreferences(userId, folderId, preferences)

// Get effective preferences (with inheritance)
getEffectivePreferences(userId, folderId?)
```

Preference inheritance order: Default → User Settings → Folder Preferences

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

### SplitService (`src/services/split-service.ts`)

Manages split terminal pane groups:

```typescript
// Create split from session
createSplit(userId, { sourceSessionId, direction, newSessionName? })

// Add session to split group
addToSplit(userId, splitGroupId, { sessionId?, newSessionName? })

// Remove session from split group
removeFromSplit(userId, splitGroupId, sessionId)

// Update pane layout (sizes)
updateLayout(userId, splitGroupId, layout[])

// Get split containing session
getSplitForSession(userId, sessionId)

// List user's splits
listSplits(userId)

// Delete split group
deleteSplit(userId, splitGroupId)
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
  status, tabOrder, folderId, lastActivityAt, createdAt, updatedAt
)

-- Cached GitHub Repositories
github_repository (
  id, userId, githubId, name, fullName,
  cloneUrl, defaultBranch, localPath, isPrivate,
  addedAt, updatedAt
)

-- Session Folders
session_folder (
  id, userId, name, parentId, color, sortOrder, createdAt, updatedAt
)

-- User Settings (with font and startup preferences)
user_settings (
  id, userId, defaultWorkingDirectory, theme,
  fontSize, fontFamily, notificationsEnabled,
  isRecording, startupCommand, createdAt, updatedAt
)

-- Folder Preferences (inheritable per-folder overrides)
folder_preferences (
  id, folderId, userId, fontSize, fontFamily,
  notificationsEnabled, isRecording, startupCommand,
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

-- Split Pane Groups
split_group (
  id, userId, direction, createdAt, updatedAt
)
-- Note: Session membership stored via splitGroupId, splitOrder, splitSize
-- fields in terminal_session table
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
| `SplitPane.tsx` | In-session split pane container for multiple terminals |
| `SplitPaneLayout.tsx` | Cross-session split layout (multiple sessions side-by-side) |
| `ResizeHandle.tsx` | Draggable resize handle for split panes |
| `RecordingPlayer.tsx` | Playback recorded terminal sessions with seek controls |
| `Sidebar.tsx` | Session/folder tree with context menus and drag-drop |
| `SessionManager.tsx` | Main orchestrator with keyboard shortcuts |
| `NewSessionWizard.tsx` | Multi-step session creation flow |
| `SaveTemplateModal.tsx` | Save session as reusable template |
| `FolderPreferencesModal.tsx` | Per-folder preference overrides |
| `UserSettingsModal.tsx` | User-level preferences |

### React Contexts

| Context | Purpose |
|---------|---------|
| `SessionContext` | Session state with optimistic updates |
| `FolderContext` | Folder tree state and operations |
| `PreferencesContext` | User settings + folder preferences with inheritance |
| `TemplateContext` | Session templates state |
| `RecordingContext` | Recording state management |
| `SplitContext` | Split pane groups with active pane tracking |

### Preference Inheritance

```
Default Settings (hardcoded)
       ↓
User Settings (user_settings table)
       ↓
Folder Preferences (folder_preferences table)
       ↓
Effective Preferences (computed at runtime)
```

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
