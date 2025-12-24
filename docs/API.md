# API Reference

Complete API documentation for Remote Dev. For machine-readable format, see [openapi.yaml](openapi.yaml).

## Authentication

Remote Dev supports two authentication methods:

### 1. Session Cookies (Browser)

All browser-based requests use NextAuth session cookies. Unauthenticated requests return `401 Unauthorized`.

### 2. API Keys (Programmatic Access)

For automation and coding agents, use API key authentication:

```http
Authorization: Bearer rdv_<key>
```

API keys can be created via the `/api/keys` endpoints. They support all session-related operations, enabling workflows like:
1. Create session with worktree for a GitHub issue
2. Connect via WebSocket for terminal I/O
3. Execute commands and capture output

See [API Keys API](#api-keys-api) for key management endpoints.

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
      "githubRepoId": "uuid",
      "worktreeBranch": "feature/new-ui",
      "folderId": "uuid",
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
  "githubRepoId": "uuid",
  "worktreeBranch": "main",
  "folderId": "uuid",
  "startupCommand": "npm run dev",
  "featureDescription": "Feature branch description",
  "createWorktree": true,
  "baseBranch": "main"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Display name (default: folder name or "Terminal") |
| `projectPath` | string | No | Working directory path (must be absolute) |
| `githubRepoId` | string | No | Associated GitHub repository UUID |
| `worktreeBranch` | string | No | Git worktree branch name |
| `folderId` | string | No | Folder UUID to place session in |
| `startupCommand` | string | No | Command to run on session start |
| `featureDescription` | string | No | Description for feature branch |
| `createWorktree` | boolean | No | Create new worktree for branch |
| `baseBranch` | string | No | Base branch for new worktree |

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "My Project",
  "tmuxSessionName": "rdv-abc12345",
  "status": "active",
  ...
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
  "id": "uuid",
  "name": "My Project",
  "tmuxSessionName": "rdv-abc12345",
  "projectPath": "/path/to/project",
  "status": "active",
  ...
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
  "tabOrder": 2,
  "status": "active"
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

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `deleteWorktree` | string | `"true"` to also delete git worktree from disk |

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
  "success": true
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
  "success": true
}
```

**Error Responses:**
- `404 Not Found` - Session doesn't exist
- `410 Gone` - tmux session no longer exists

### Move Session to Folder

Move a session to a folder or remove from folder.

```http
PUT /api/sessions/:id/folder
```

**Request Body:**
```json
{
  "folderId": "uuid"
}
```

Set `folderId` to `null` to remove from folder.

**Response:**
```json
{
  "success": true
}
```

### Get Session Token

Get WebSocket authentication token for session.

```http
GET /api/sessions/:id/token
```

**Response:**
```json
{
  "token": "jwt-token-string"
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

### Execute Command

Execute a command in a session (fire-and-forget). Requires API key authentication.

```http
POST /api/sessions/:id/exec
Authorization: Bearer rdv_<key>
```

**Request Body:**
```json
{
  "command": "npm run build",
  "captureOutput": true,
  "timeout": 5000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes | Command to execute |
| `captureOutput` | boolean | No | Capture tmux pane output after command (default: false) |
| `timeout` | number | No | Wait time in ms before capturing output (default: 1000) |

**Response:**
```json
{
  "success": true,
  "output": "Build completed successfully\n"
}
```

**Notes:**
- Command is sent to the tmux session as keystrokes followed by Enter
- If `captureOutput` is true, waits `timeout` ms then captures visible pane content
- Use WebSocket connection for real-time interactive I/O

---

## Folders API

### List Folders

Get all folders and session-folder mappings for current user.

```http
GET /api/folders
```

**Response:**
```json
{
  "folders": [
    {
      "id": "uuid",
      "name": "Work Projects",
      "parentId": null,
      "collapsed": false,
      "sortOrder": 0,
      "userId": "uuid",
      "createdAt": "2024-01-15T09:00:00Z",
      "updatedAt": "2024-01-15T09:00:00Z"
    }
  ],
  "sessionFolders": [
    {
      "sessionId": "uuid",
      "folderId": "uuid"
    }
  ]
}
```

### Create Folder

Create a new folder.

```http
POST /api/folders
```

**Request Body:**
```json
{
  "name": "New Folder",
  "parentId": "uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Folder name |
| `parentId` | string | No | Parent folder UUID for nesting |

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "New Folder",
  "parentId": "uuid",
  "collapsed": false,
  "sortOrder": 0,
  ...
}
```

### Update Folder

Update folder properties.

```http
PATCH /api/folders/:id
```

**Request Body:**
```json
{
  "name": "Renamed Folder",
  "collapsed": true,
  "sortOrder": 1,
  "parentId": "uuid"
}
```

**Response:** Updated folder object

### Delete Folder

Delete a folder.

```http
DELETE /api/folders/:id
```

**Response:**
```json
{
  "success": true
}
```

---

## Preferences API

### Get Preferences

Get user settings, all folder preferences, and active folder.

```http
GET /api/preferences
```

**Response:**
```json
{
  "userSettings": {
    "id": "uuid",
    "userId": "uuid",
    "defaultWorkingDirectory": "/Users/me",
    "defaultShell": "/bin/zsh",
    "startupCommand": null,
    "theme": "tokyo-night",
    "fontSize": 14,
    "fontFamily": "'JetBrainsMono Nerd Font Mono', monospace",
    "activeFolderId": "uuid",
    "pinnedFolderId": null,
    "autoFollowActiveSession": true,
    "createdAt": "2024-01-15T09:00:00Z",
    "updatedAt": "2024-01-15T09:00:00Z"
  },
  "folderPreferences": [
    {
      "id": "uuid",
      "folderId": "uuid",
      "userId": "uuid",
      "defaultWorkingDirectory": "/path/to/project",
      "theme": "dracula",
      "githubRepoId": "uuid",
      "localRepoPath": "/path/to/repo",
      ...
    }
  ],
  "activeFolder": {
    "id": "uuid",
    "name": "Active Folder"
  }
}
```

### Update User Settings

Update user-level preferences.

```http
PATCH /api/preferences
```

**Request Body:**
```json
{
  "defaultWorkingDirectory": "/Users/me/projects",
  "defaultShell": "/bin/zsh",
  "startupCommand": "clear",
  "theme": "tokyo-night",
  "fontSize": 14,
  "fontFamily": "'FiraCode Nerd Font Mono', monospace",
  "activeFolderId": "uuid",
  "pinnedFolderId": "uuid",
  "autoFollowActiveSession": true
}
```

**Response:** Updated userSettings object

### Set Active Folder

Set the active folder for quick terminal creation.

```http
POST /api/preferences/active-folder
```

**Request Body:**
```json
{
  "folderId": "uuid",
  "pinned": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `folderId` | string | Folder UUID (null to clear) |
| `pinned` | boolean | Pin folder (won't auto-follow) |

**Response:** Updated userSettings object

### Get Folder Preferences

Get preferences for a specific folder.

```http
GET /api/preferences/folders/:folderId
```

**Response:** folderPreferences object

### Set Folder Preferences

Create or update folder-specific preferences.

```http
PUT /api/preferences/folders/:folderId
```

**Request Body:**
```json
{
  "defaultWorkingDirectory": "/path/to/project",
  "defaultShell": "/bin/bash",
  "startupCommand": "npm run dev",
  "theme": "dracula",
  "fontSize": 16,
  "fontFamily": "'Hack Nerd Font Mono', monospace",
  "githubRepoId": "uuid",
  "localRepoPath": "/path/to/repo"
}
```

**Response:** Updated folderPreferences object

### Delete Folder Preferences

Reset folder preferences to inherit from user defaults.

```http
DELETE /api/preferences/folders/:folderId
```

**Response:**
```json
{
  "success": true
}
```

---

## Templates API

### List Templates

Get all session templates.

```http
GET /api/templates
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Dev Server",
    "description": "Start development server",
    "projectPath": "/path/to/project",
    "startupCommand": "npm run dev",
    "theme": "tokyo-night",
    "fontSize": 14,
    "fontFamily": "'JetBrainsMono Nerd Font Mono', monospace",
    "usageCount": 5,
    "userId": "uuid",
    "createdAt": "2024-01-15T09:00:00Z",
    "updatedAt": "2024-01-15T09:00:00Z"
  }
]
```

### Create Template

Create a new session template.

```http
POST /api/templates
```

**Request Body:**
```json
{
  "name": "Dev Server",
  "description": "Start development server",
  "projectPath": "/path/to/project",
  "startupCommand": "npm run dev",
  "theme": "tokyo-night",
  "fontSize": 14,
  "fontFamily": "'JetBrainsMono Nerd Font Mono', monospace"
}
```

**Response:** `201 Created` - Template object

### Get Template

Get a specific template.

```http
GET /api/templates/:id
```

**Response:** Template object

### Update Template

Update template properties.

```http
PATCH /api/templates/:id
```

**Request Body:** Same as create

**Response:** Updated template object

### Delete Template

Delete a template.

```http
DELETE /api/templates/:id
```

**Response:**
```json
{
  "success": true
}
```

### Record Template Usage

Record that a template was used.

```http
POST /api/templates/:id
```

**Request Body:**
```json
{
  "action": "use"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Recordings API

### List Recordings

Get all session recordings.

```http
GET /api/recordings
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Demo Recording",
    "sessionId": "uuid",
    "duration": 120,
    "userId": "uuid",
    "createdAt": "2024-01-15T09:00:00Z",
    "updatedAt": "2024-01-15T09:00:00Z"
  }
]
```

### Create Recording

Save a new terminal recording.

```http
POST /api/recordings
```

**Request Body:**
```json
{
  "name": "Demo Recording",
  "data": "base64-encoded-recording-data",
  "duration": 120,
  "sessionId": "uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Recording name |
| `data` | string | Yes | Base64-encoded recording data |
| `duration` | number | Yes | Duration in seconds |
| `sessionId` | string | No | Associated session UUID |

**Response:** `201 Created` - Recording object

### Get Recording

Get a specific recording with data.

```http
GET /api/recordings/:id
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `parsed` | string | `"true"` to return parsed recording data |

**Response:** Recording object with `data` field

### Update Recording

Update recording metadata.

```http
PATCH /api/recordings/:id
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "sessionId": "uuid"
}
```

**Response:** Updated recording object

### Delete Recording

Delete a recording.

```http
DELETE /api/recordings/:id
```

**Response:**
```json
{
  "success": true
}
```

---

## GitHub API

### List Repositories

List user's GitHub repositories.

```http
GET /api/github/repositories
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cached` | string | - | `"true"` to return only cloned repos |
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

**Path Parameters:**
- `id` - Database UUID or GitHub numeric ID

**Response:** Repository object

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
  "repositoryId": "uuid"
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
      "isDirectory": true,
      "children": [
        {
          "name": "components",
          "path": "/src/components",
          "isDirectory": true,
          "children": []
        }
      ]
    }
  ],
  "rootPath": "/Users/me/.remote-dev/repos/username/my-repo"
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
  "repositoryId": "uuid",
  "branch": "feature/my-feature",
  "createNewBranch": true,
  "baseBranch": "main"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repositoryId` | string | Yes | Repository UUID |
| `branch` | string | Yes | Branch name |
| `createNewBranch` | boolean | No | Create new branch |
| `baseBranch` | string | No | Base branch for new branch |

**Response:**
```json
{
  "success": true,
  "worktreePath": "/path/to/repo-worktrees/feature-my-feature",
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
  "repositoryId": "uuid",
  "worktreePath": "/path/to/worktree",
  "force": false
}
```

**Response:**
```json
{
  "success": true
}
```

### Check Worktree Status

Check for uncommitted changes in a worktree.

```http
POST /api/github/worktrees/check
```

**Request Body:**
```json
{
  "repositoryId": "uuid",
  "worktreePath": "/path/to/worktree"
}
```

**Response:**
```json
{
  "hasUncommittedChanges": true,
  "branch": "feature/my-feature"
}
```

### List Repository Issues

List open issues for a GitHub repository.

```http
GET /api/github/repositories/:id/issues
Authorization: Bearer rdv_<key>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `state` | string | `open` | Issue state: `open`, `closed`, `all` |
| `page` | number | 1 | Page number |
| `per_page` | number | 30 | Results per page (max 100) |

**Response:**
```json
{
  "issues": [
    {
      "number": 42,
      "title": "Add dark mode support",
      "body": "It would be great to have a dark theme...",
      "state": "open",
      "labels": [
        { "name": "enhancement", "color": "a2eeef" }
      ],
      "user": {
        "login": "username",
        "avatar_url": "https://avatars.githubusercontent.com/u/123"
      },
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T12:00:00Z"
    }
  ],
  "page": 1,
  "hasMore": true
}
```

---

## API Keys API

Manage API keys for programmatic access. All endpoints require session authentication.

### List API Keys

Get all API keys for the current user.

```http
GET /api/keys
```

**Response:**
```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "CI Pipeline",
      "keyPrefix": "rdv_abc12345",
      "lastUsedAt": "2024-01-15T10:30:00Z",
      "expiresAt": null,
      "createdAt": "2024-01-01T09:00:00Z"
    }
  ]
}
```

### Create API Key

Create a new API key. The full key is only shown once.

```http
POST /api/keys
```

**Request Body:**
```json
{
  "name": "Orchestrator Agent",
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Friendly name (max 100 chars) |
| `expiresAt` | string | No | ISO 8601 expiration date |

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "Orchestrator Agent",
  "key": "rdv_abcdefghijklmnopqrstuvwxyz123456",
  "keyPrefix": "rdv_abcdefgh",
  "createdAt": "2024-01-15T09:00:00Z"
}
```

⚠️ **Important:** The `key` field contains the full API key and is only returned once. Store it securely.

### Get API Key

Get details about a specific API key.

```http
GET /api/keys/:id
```

**Response:**
```json
{
  "id": "uuid",
  "name": "CI Pipeline",
  "keyPrefix": "rdv_abc12345",
  "lastUsedAt": "2024-01-15T10:30:00Z",
  "expiresAt": null,
  "createdAt": "2024-01-01T09:00:00Z"
}
```

### Revoke API Key

Delete an API key, immediately invalidating it.

```http
DELETE /api/keys/:id
```

**Response:**
```json
{
  "success": true
}
```

---

## Git API

### Validate Repository

Check if a path is a valid git repository.

```http
GET /api/git/validate
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Filesystem path to validate |

**Response:**
```json
{
  "isGitRepo": true,
  "branches": ["main", "develop", "feature/new-ui"]
}
```

---

## Images API

### Upload Image

Upload an image and save to filesystem.

```http
POST /api/images
```

**Content-Type:** `multipart/form-data` or `application/json`

**FormData Request:**
```
image: File (JPEG, PNG, GIF, WebP, max 5MB)
```

**JSON Request:**
```json
{
  "data": "base64-encoded-image-data",
  "mediaType": "image/png"
}
```

**Response:**
```json
{
  "path": "/Users/me/.remote-dev/images/abc123.png",
  "size": 12345,
  "mediaType": "image/png"
}
```

---

## Splits API

Manage split terminal pane groups. Splits allow displaying multiple sessions side-by-side.

### List Split Groups

Get all split groups for the current user.

```http
GET /api/splits
```

**Response:**
```json
{
  "splits": [
    {
      "id": "uuid",
      "userId": "uuid",
      "direction": "horizontal",
      "sessions": [
        {
          "sessionId": "uuid",
          "splitOrder": 0,
          "splitSize": 0.5
        },
        {
          "sessionId": "uuid",
          "splitOrder": 1,
          "splitSize": 0.5
        }
      ],
      "createdAt": "2024-01-15T09:00:00Z",
      "updatedAt": "2024-01-15T09:00:00Z"
    }
  ]
}
```

### Create Split

Create a new split group from an existing session.

```http
POST /api/splits
```

**Request Body:**
```json
{
  "sourceSessionId": "uuid",
  "direction": "horizontal",
  "newSessionName": "New Terminal"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sourceSessionId` | string | Yes | Session UUID to split from |
| `direction` | string | Yes | `"horizontal"` or `"vertical"` |
| `newSessionName` | string | No | Name for the new session |

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "direction": "horizontal",
  "sessions": [
    { "sessionId": "uuid", "splitOrder": 0, "splitSize": 0.5 },
    { "sessionId": "uuid", "splitOrder": 1, "splitSize": 0.5 }
  ],
  ...
}
```

### Get Split Group

Get details about a specific split group.

```http
GET /api/splits/:id
```

**Response:** Split group object with sessions

### Update Split Direction

Change the split direction.

```http
PATCH /api/splits/:id
```

**Request Body:**
```json
{
  "direction": "vertical"
}
```

**Response:** Updated split group object

### Delete Split Group

Dissolve a split group, returning sessions to standalone mode.

```http
DELETE /api/splits/:id
```

**Response:**
```json
{
  "success": true
}
```

### Add Session to Split

Add a session to an existing split group.

```http
POST /api/splits/:id/sessions
```

**Request Body:**
```json
{
  "sessionId": "uuid"
}
```

Or create a new session:
```json
{
  "newSessionName": "Additional Terminal"
}
```

**Response:** Updated split group object

### Remove Session from Split

Remove a session from a split group.

```http
DELETE /api/splits/:id/sessions
```

**Request Body:**
```json
{
  "sessionId": "uuid"
}
```

**Response:** Updated split group object (or deleted if only one session remains)

### Update Pane Layout

Update the sizes of panes in a split group.

```http
PUT /api/splits/:id/layout
```

**Request Body:**
```json
{
  "layout": [
    { "sessionId": "uuid", "size": 0.3 },
    { "sessionId": "uuid", "size": 0.7 }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `layout[].sessionId` | string | Session UUID |
| `layout[].size` | number | Relative size (0-1, should sum to 1) |

**Response:** Updated split group object

---

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

---

## Error Handling

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Not authorized for resource |
| 404 | Not Found - Resource doesn't exist |
| 410 | Gone - Resource no longer available |
| 500 | Internal Server Error |

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Common Error Codes:**
- `GITHUB_NOT_CONNECTED` - User hasn't linked GitHub
- `SESSION_NOT_FOUND` - Session doesn't exist
- `REPOSITORY_NOT_FOUND` - Repository not in cache
- `CLONE_FAILED` - Repository clone failed
- `WORKTREE_FAILED` - Worktree creation failed
- `FOLDER_NOT_FOUND` - Folder doesn't exist
- `TEMPLATE_NOT_FOUND` - Template doesn't exist
- `RECORDING_NOT_FOUND` - Recording doesn't exist
- `API_KEY_NOT_FOUND` - API key doesn't exist or was revoked
- `API_KEY_EXPIRED` - API key has expired
- `NAME_REQUIRED` - API key name is required
- `NAME_TOO_LONG` - API key name exceeds 100 characters

---

## Rate Limits

The application doesn't implement rate limiting as it's designed for local use. GitHub API requests are subject to GitHub's rate limits (5000 requests/hour for authenticated users).
