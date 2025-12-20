# Architecture

This document describes the technical architecture of Remote Dev.

## Overview

Remote Dev is a web-based terminal interface that provides:
- Multiple persistent terminal sessions
- GitHub repository integration with worktree support
- Modern React-based UI with real-time terminal emulation

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
│  - repositories  │  │  - Detachable    │
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
- Next.js 15 with App Router
- React 19 with Server Components
- Drizzle ORM with SQLite

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
  status, tabOrder, lastActivityAt, createdAt, updatedAt
)

-- Cached GitHub Repositories
github_repository (
  id, userId, githubId, name, fullName,
  cloneUrl, defaultBranch, localPath, isPrivate,
  addedAt, updatedAt
)

-- User Settings
user_settings (
  id, userId, defaultWorkingDirectory, theme,
  createdAt, updatedAt
)
```

## Security Considerations

### Authentication

- Email allowlist in `authorized_user` table
- JWT session strategy (stateless)
- GitHub OAuth for repository access
- No password storage (credentials are just email verification)

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
