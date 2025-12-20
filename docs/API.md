# API Reference

Complete API documentation for Remote Dev.

## Authentication

All API routes require authentication via NextAuth session cookies. Unauthenticated requests return `401 Unauthorized`.

## Sessions API

### List Sessions

Get all terminal sessions for the current user.

```http
GET /api/sessions
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `active`, `suspended`, `closed` |

**Response:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "name": "Project A",
      "tmuxSessionName": "rdv-abc12345",
      "projectPath": "/Users/me/projects/a",
      "githubRepoId": "123456",
      "worktreeBranch": "feature/new-ui",
      "status": "active",
      "tabOrder": 0,
      "lastActivityAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-15T09:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Create Session

Create a new terminal session.

```http
POST /api/sessions
```

**Request Body:**
```json
{
  "name": "My Project",
  "projectPath": "/path/to/project",
  "githubRepoId": "123456",
  "worktreeBranch": "main"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the session |
| `projectPath` | string | No | Working directory path |
| `githubRepoId` | string | No | Associated GitHub repository ID |
| `worktreeBranch` | string | No | Git worktree branch name |

**Response:**
```json
{
  "session": {
    "id": "uuid",
    "name": "My Project",
    "tmuxSessionName": "rdv-abc12345",
    "status": "active",
    ...
  }
}
```

### Get Session

Get a specific session by ID.

```http
GET /api/sessions/:id
```

**Response:**
```json
{
  "session": {
    "id": "uuid",
    "name": "My Project",
    ...
  }
}
```

### Update Session

Update session properties.

```http
PATCH /api/sessions/:id
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "tabOrder": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | New display name |
| `tabOrder` | number | Tab position (0-indexed) |
| `status` | string | Session status |

**Response:**
```json
{
  "session": { ... }
}
```

### Delete Session

Close and delete a session.

```http
DELETE /api/sessions/:id
```

**Response:**
```json
{
  "success": true
}
```

### Suspend Session

Suspend an active session (keeps tmux running).

```http
POST /api/sessions/:id/suspend
```

**Response:**
```json
{
  "session": {
    "status": "suspended",
    ...
  }
}
```

### Resume Session

Resume a suspended session.

```http
POST /api/sessions/:id/resume
```

**Response:**
```json
{
  "session": {
    "status": "active",
    ...
  }
}
```

### Reorder Sessions

Update tab order for multiple sessions.

```http
POST /api/sessions/reorder
```

**Request Body:**
```json
{
  "sessionIds": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:**
```json
{
  "success": true
}
```

## GitHub API

### List Repositories

List user's GitHub repositories.

```http
GET /api/github/repositories
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `perPage` | number | 100 | Results per page |
| `sort` | string | `updated` | Sort by: `updated`, `created`, `pushed`, `full_name` |

**Response:**
```json
{
  "repositories": [
    {
      "id": 123456,
      "name": "my-repo",
      "fullName": "username/my-repo",
      "cloneUrl": "https://github.com/username/my-repo.git",
      "sshUrl": "git@github.com:username/my-repo.git",
      "defaultBranch": "main",
      "isPrivate": false,
      "description": "My awesome project",
      "language": "TypeScript",
      "stargazersCount": 42,
      "forksCount": 5,
      "updatedAt": "2024-01-15T10:00:00Z",
      "owner": {
        "login": "username",
        "avatarUrl": "https://avatars.githubusercontent.com/u/123"
      }
    }
  ],
  "page": 1,
  "hasMore": false
}
```

**Error Responses:**
```json
{
  "error": "GitHub not connected",
  "code": "GITHUB_NOT_CONNECTED"
}
```

### Get Repository

Get details about a cached repository.

```http
GET /api/github/repositories/:id
```

**Response:**
```json
{
  "repository": {
    "id": "uuid",
    "githubId": 123456,
    "name": "my-repo",
    "fullName": "username/my-repo",
    "localPath": "/Users/me/.remote-dev/repos/username/my-repo",
    ...
  }
}
```

### Clone Repository

Clone a repository to local disk.

```http
POST /api/github/repositories/:id
```

**Response:**
```json
{
  "success": true,
  "localPath": "/Users/me/.remote-dev/repos/username/my-repo",
  "alreadyCloned": false
}
```

If already cloned:
```json
{
  "success": true,
  "localPath": "/Users/me/.remote-dev/repos/username/my-repo",
  "alreadyCloned": true
}
```

### List Branches

List branches for a repository.

```http
GET /api/github/repositories/:id/branches
```

**Response:**
```json
{
  "branches": [
    {
      "name": "main",
      "isRemote": false,
      "isDefault": true
    },
    {
      "name": "feature/new-ui",
      "isRemote": false,
      "isDefault": false
    }
  ]
}
```

### Get Folder Structure

Get the folder structure of a cloned repository.

```http
GET /api/github/repositories/:id/folders
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxDepth` | number | 3 | Maximum folder depth |

**Response:**
```json
{
  "folders": [
    {
      "name": "src",
      "path": "/src",
      "type": "directory",
      "children": [
        {
          "name": "components",
          "path": "/src/components",
          "type": "directory",
          "children": []
        }
      ]
    }
  ]
}
```

### Create Worktree

Create a git worktree for a branch.

```http
POST /api/github/worktrees
```

**Request Body:**
```json
{
  "repositoryPath": "/path/to/repo",
  "branchName": "feature/my-feature",
  "baseBranch": "main",
  "createBranch": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repositoryPath` | string | Yes | Path to the git repository |
| `branchName` | string | Yes | Branch name for the worktree |
| `baseBranch` | string | No | Base branch when creating new branch |
| `createBranch` | boolean | No | Create new branch if true |

**Response:**
```json
{
  "success": true,
  "path": "/path/to/repo-worktrees/feature-my-feature",
  "branch": "feature/my-feature"
}
```

### Delete Worktree

Remove a git worktree.

```http
DELETE /api/github/worktrees
```

**Request Body:**
```json
{
  "worktreePath": "/path/to/worktree"
}
```

**Response:**
```json
{
  "success": true
}
```

## WebSocket Protocol

### Connection

Connect to the terminal server:

```
ws://localhost:3001?sessionId={sessionId}&tmuxSession={tmuxSessionName}&cols={cols}&rows={rows}
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Session UUID from database |
| `tmuxSession` | string | tmux session name (e.g., `rdv-abc12345`) |
| `cols` | number | Terminal columns |
| `rows` | number | Terminal rows |

### Messages

All messages are JSON-encoded.

#### Client to Server

**Input (keyboard/paste):**
```json
{
  "type": "input",
  "data": "ls -la\n"
}
```

**Resize:**
```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

#### Server to Client

**Output (terminal data):**
```json
{
  "type": "output",
  "data": "file1.txt  file2.txt\n"
}
```

**Ready (connection established):**
```json
{
  "type": "ready",
  "sessionId": "rdv-abc12345"
}
```

**Session Created:**
```json
{
  "type": "session_created",
  "tmuxSessionName": "rdv-abc12345"
}
```

**Session Attached:**
```json
{
  "type": "session_attached",
  "tmuxSessionName": "rdv-abc12345"
}
```

**Exit (process terminated):**
```json
{
  "type": "exit",
  "code": 0
}
```

**Error:**
```json
{
  "type": "error",
  "message": "Failed to attach to tmux session"
}
```

## Error Handling

### HTTP Errors

| Status | Description |
|--------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Not authorized for resource |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

Common error codes:
- `GITHUB_NOT_CONNECTED` - User hasn't linked GitHub
- `SESSION_NOT_FOUND` - Session doesn't exist
- `REPOSITORY_NOT_FOUND` - Repository not in cache
- `CLONE_FAILED` - Repository clone failed
- `WORKTREE_FAILED` - Worktree creation failed

## Rate Limits

The application doesn't implement rate limiting as it's designed for local use. GitHub API requests are subject to GitHub's rate limits (5000 requests/hour for authenticated users).
