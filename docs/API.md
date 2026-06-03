# API Reference

Complete REST API documentation for Remote Dev (version **0.3.18**).

See also: [Architecture](./ARCHITECTURE.md) · [Setup](./SETUP.md) · [OpenAPI spec](./openapi.yaml)

For a machine-readable contract, see [openapi.yaml](./openapi.yaml) (OpenAPI 3.1).

> **Scope.** Every endpoint documented here is served by the **Next.js** app
> (default port **6001**) under `/api/*`. The codebase exposes **42 route
> groups** / **246 method×path operations** as of this writing.
>
> The **terminal server** (default port **6002**) additionally exposes
> `/internal/*` routes (`/internal/peers/*`, `/internal/channels/*`,
> `/internal/litellm/*`, `/health`, …). Those are **not** part of this public
> HTTP API — they are an in-process control channel between the Next.js app
> and the terminal server and are not authenticated as user endpoints. They
> live in `src/server/` (see `src/server/terminal.ts`) and are out of scope
> for this document.

---

## Authentication

Remote Dev uses a **dual authentication model**. Route protection is enforced
by `src/proxy.ts` (the Next.js 16 proxy, formerly `middleware.ts`), and most
API handlers additionally wrap themselves with one of two helpers from
`src/lib/api.ts`.

### 1. Session cookies (browser)

Browser requests authenticate via **NextAuth v5** session cookies (JWT
strategy). On localhost (`127.0.0.1`) an **email-only credentials** provider is
available for local dev; on remote/LAN deployments a **Cloudflare Access** JWT
(`CF_Authorization` cookie) is validated instead. See
[Architecture → Authentication](./ARCHITECTURE.md) for the full flow.

### 2. API keys (programmatic access)

For automation and coding agents, pass a bearer token:

```http
Authorization: Bearer rdv_<key>
```

API keys are created via the [`/api/keys`](#api-keys) endpoints.

### Which auth applies to which endpoint

Two wrappers gate handlers:

| Wrapper | Accepts | Used by |
|---------|---------|---------|
| `withAuth` | Session cookie **only** | Browser-facing/management endpoints (preferences, profiles, GitHub UI, secrets, dashboard, …) |
| `withApiAuth` | Session cookie **or** API-key bearer token | Agent-facing endpoints (sessions, tasks, channels, notifications, peers, beads, files, schedules, ssh-connections, groups, projects, …) |

Unauthenticated requests to a wrapped handler return **`401 Unauthorized`**
(`{ "error": "Unauthorized", "code": "UNAUTHORIZED" }` for `withApiAuth`).
Throughout this document each endpoint is tagged **[session]** (`withAuth`) or
**[session | key]** (`withApiAuth`). A handful of endpoints use neither wrapper
and authenticate differently — those are flagged explicitly.

### Public / specially-authenticated endpoints

`src/proxy.ts` bypasses auth for a small allowlist; these are **not** protected
by session/key auth:

| Endpoint | Auth mechanism |
|----------|----------------|
| `GET /api/healthz`, `GET /api/readyz` | None (Kubernetes probes) |
| `POST /api/deploy` | HMAC-SHA256 signature (`X-Hub-Signature-256`) |
| `/api/auth/**` (NextAuth, OAuth callback, mobile exchange, signout) | NextAuth / OAuth / CF Access JWT |
| `GET /api/setup/platform`, `GET /api/setup/dependencies`, `GET|POST /api/setup/complete` | None (first-run setup wizard) |
| `POST /api/litellm/webhook` | `x-webhook-secret` header (`LITELLM_WEBHOOK_SECRET`) |
| `POST|GET /api/cron/trash-cleanup`, `POST|GET /api/cron/litellm-cleanup` | `CRON_SECRET` (bearer or `?secret=`) |
| `GET|POST /api/github/stats/:repoId`, `POST /api/github/stats/mark-seen` | Unwrapped (no auth helper) |

---

## Endpoint index

| Domain | Base path | Section |
|--------|-----------|---------|
| Sessions | `/api/sessions` | [Sessions](#sessions) |
| Session — browser automation | `/api/sessions/:id/browser/*` | [Session browser automation](#session-browser-automation) |
| Session — MCP servers | `/api/sessions/:id/mcp-servers` | [Session MCP servers](#session-mcp-servers) |
| Project groups | `/api/groups` | [Project groups](#project-groups) |
| Projects | `/api/projects` | [Projects](#projects) |
| Node preferences | `/api/node-preferences` | [Node preferences](#node-preferences) |
| Preferences | `/api/preferences` | [Preferences](#preferences) |
| Templates | `/api/templates` | [Templates](#templates) |
| Recordings | `/api/recordings` | [Recordings](#recordings) |
| Tasks | `/api/tasks` | [Tasks](#tasks) |
| Channels | `/api/channels` | [Channels](#channels) |
| Notifications | `/api/notifications` | [Notifications](#notifications) |
| Peers | `/api/peers` | [Peers](#peers) |
| GitHub | `/api/github` | [GitHub](#github) |
| GitHub accounts | `/api/github/accounts`, `/api/github/account` | [GitHub accounts](#github-accounts) |
| API keys | `/api/keys` | [API keys](#api-keys) |
| Agent profiles | `/api/profiles` | [Agent profiles](#agent-profiles) |
| Agent CLI status | `/api/agent-cli/status` | [Agent CLI](#agent-cli) |
| Agent providers | `/api/agent-providers` | [Agent providers](#agent-providers) |
| Agent config files | `/api/agent-configs` | [Agent config files](#agent-config-files) |
| Resumable Claude sessions | `/api/agent/claude-sessions` | [Resumable Claude sessions](#resumable-claude-sessions) |
| MCP server registry | `/api/mcp-servers` | [MCP server registry](#mcp-server-registry) |
| Secrets | `/api/secrets` | [Secrets](#secrets) |
| SSH connections | `/api/ssh-connections` | [SSH connections](#ssh-connections) |
| Schedules | `/api/schedules` | [Schedules](#schedules) |
| Ports | `/api/ports` | [Ports](#ports) |
| LiteLLM | `/api/litellm` | [LiteLLM](#litellm) |
| Beads (issue tracker) | `/api/beads` | [Beads](#beads) |
| Trash | `/api/trash` | [Trash](#trash) |
| Appearance | `/api/appearance` | [Appearance](#appearance) |
| Dashboard | `/api/dashboard` | [Dashboard](#dashboard) |
| System | `/api/system` | [System](#system) |
| tmux | `/api/tmux/sessions` | [tmux](#tmux) |
| Files | `/api/files` | [Files](#files) |
| Directories | `/api/directories` | [Directories](#directories) |
| Git | `/api/git/validate` | [Git](#git) |
| Images | `/api/images` | [Images](#images) |
| Config | `/api/config` | [Config](#config) |
| Setup | `/api/setup` | [Setup](#setup) |
| Health probes | `/api/healthz`, `/api/readyz` | [Health probes](#health-probes) |
| Deploy webhook | `/api/deploy` | [Deploy webhook](#deploy-webhook) |
| Cron | `/api/cron/*` | [Cron](#cron) |
| Auth | `/api/auth/*` | [Auth](#auth) |

---

## Sessions

Base path `/api/sessions`. All endpoints **[session | key]** unless noted.

### List sessions

```http
GET /api/sessions
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Comma-separated statuses to filter by: `active`, `suspended`, `closed` |
| `parentSessionId` | string | Only return child sessions of this parent |

**Response:** `{ "sessions": [ Session, … ] }` — see the [Session object](#session-object).

### Create session

```http
POST /api/sessions
```

Creates a DB record plus a tmux session (`rdv-{uuid}`). `projectId` is
**required** (the `terminal_session.project_id` column is `NOT NULL`); the
legacy alias `folderId` is still accepted during the rename window.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | **Yes** | Owning project UUID (alias: `folderId`) |
| `name` | string | No | Display name (default `"Terminal"`) |
| `projectPath` | string | No | Working directory (absolute; path-traversal validated) |
| `terminalType` | enum | No | `shell` \| `agent` \| `ssh` \| `file` \| `browser` \| `loop` |
| `githubRepoId` | string | No | Associated GitHub repository UUID |
| `worktreeBranch` | string | No | Git worktree branch name |
| `createWorktree` | boolean | No | Create a new worktree |
| `baseBranch` | string | No | Base branch for a new worktree |
| `worktreeType` | string | No | Worktree type id (allowlist-validated) |
| `featureDescription` | string | No | Description for a feature branch |
| `filePath` | string | No | File to open (for `file` terminal type) |
| `profileId` | string | No | Agent profile to bind |
| `agentProvider` | string | No | `claude` \| `codex` \| `gemini` \| `opencode` \| … |
| `autoLaunchAgent` | boolean | No | Auto-start the agent CLI |
| `agentFlags` | string[] | No | Extra CLI flags for the agent |
| `parentSessionId` | string | No | Parent session (team orchestration) |
| `loopConfig` | object | No | `{ loopType, intervalSeconds, promptTemplate, maxIterations, autoRestart }` (for `loop` type) |
| `sshConnectionId` | string | No | SSH connection to attach (for `ssh` type) |
| `scopeKey` | string \| null | No | Plugin-level dedup key |
| `typeMetadata` | object | No | Plugin-specific metadata passthrough |

**Response:** `201 Created` with the [Session object](#session-object). If a
`scopeKey` dedup hit reuses an existing session, the status is `200` and the
body includes `"_reused": true`.

### Get session

```http
GET /api/sessions/:id
```

**[session]**. Returns the [Session object](#session-object), or `404`.

### Update session

```http
PATCH /api/sessions/:id
```

**[session]**. Body: any subset of `{ name, tabOrder, status, … }`. Returns the updated session.

### Delete session

```http
DELETE /api/sessions/:id
```

**[session]**. Kills tmux and closes the session.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `deleteWorktree` | `true` | Also delete the git worktree from disk |
| `trash` | `true` | Move to trash instead of hard delete (returns `{ trashItemId }`) |
| `cleanup` | `true` | Run worktree cleanup; returns `{ cleanup }` |
| `force` | `true` | Force deletion despite uncommitted changes |

**Response:** `{ "success": true }`.

### Suspend / Resume

```http
POST /api/sessions/:id/suspend     # [session]
POST /api/sessions/:id/resume      # [session]
```

Suspend detaches from tmux and marks the session `suspended`; resume reattaches.
Both return the [Session object](#session-object). Resume returns `410 Gone`
if the underlying tmux session no longer exists.

### Restart

```http
POST /api/sessions/:id/restart
```

**[session | key]**. Restarts an exited agent session (re-launches the agent
process in the existing tmux session). Returns the [Session object](#session-object).

### Spawn child session

```http
POST /api/sessions/:id/spawn
```

**[session | key]**. Creates a child session linked to `:id` via
`parentSessionId`. Inherits project, working directory, agent provider, profile,
and terminal type from the parent unless overridden.

**Request body (all optional):** `{ name, terminalType, agentProvider, projectId, workingDirectory, profileId }`.

**Response:** `201 Created` with the new [Session object](#session-object).

### Execute command (fire-and-forget)

```http
POST /api/sessions/:id/exec
```

**[session | key]**. Sends a command to the tmux session as keystrokes. For
real-time I/O use the [WebSocket protocol](#websocket-protocol) instead.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes | Command to type into the session |
| `pressEnter` | boolean | No | Append Enter after the command (default `true`) |

**Response:** `{ "success": true, "sessionId", "command", "message" }`.
Errors: `404` (session not found), `400` (`SESSION_CLOSED`), `410` (`TMUX_SESSION_GONE`).

### Get WebSocket token

```http
GET /api/sessions/:id/token
```

**[session | key]**. Returns a short-lived (5 min) token for the terminal
WebSocket.

**Response:**
```json
{ "token": "jwt", "sessionId": "uuid", "tmuxSessionName": "rdv-abc12345", "expiresIn": 300 }
```

### Git status

```http
GET /api/sessions/:id/git-status
```

**[session | key]**. Returns the session worktree's git status (branch, dirty
state, ahead/behind, and open PR info when available).

### Move session to project

```http
PUT /api/sessions/:id/folder
```

**[session]**. The path keeps `/folder` for back-compat, but the column is
`terminal_session.project_id`. Body accepts `projectId` (preferred) or
`folderId` (legacy); set to `null` to detach. Returns `{ "success": true }`.

### Reorder sessions

```http
POST /api/sessions/reorder
```

**[session]**. Body `{ "sessionIds": ["uuid", …] }` sets tab order. Returns `{ "success": true }`.

---

## Session browser automation

For sessions with `terminalType: "browser"`, these drive a headless browser.
All **[session | key]**, base path `/api/sessions/:id/browser`.

| Method & path | Body / query | Description |
|---------------|--------------|-------------|
| `POST /navigate` | `{ url }` | Navigate to a URL |
| `GET /screenshot` | — | Capture a screenshot |
| `GET /snapshot` | — | Accessibility tree snapshot |
| `POST /click` | `{ x, y }` | Click at coordinates |
| `POST /type` | `{ text }` | Type text |
| `POST /evaluate` | `{ expression }` | Evaluate JavaScript |
| `POST /back` | — | Navigate back |
| `POST /forward` | — | Navigate forward |

---

## Session MCP servers

Base path `/api/sessions/:id/mcp-servers`. Reads/writes the MCP server config
for an **agent** session from its project directory (per agent provider).

```http
GET   /api/sessions/:id/mcp-servers              # [session]
PATCH /api/sessions/:id/mcp-servers              # [session]
POST  /api/sessions/:id/mcp-servers/discover     # [session]
```

- **GET** returns `{ sessionId, agentProvider, projectPath, mcpSupported, servers, configFilesChecked, configFilesFound }`. Non-agent sessions return `mcpSupported: false`.
- **PATCH** body `{ serverName, sourceFile, updates }` updates one server's config (`enabled`, `command`, `args`, `env`) and returns the re-parsed config.
- **POST `/discover`** probes the session's configured MCP servers for tools/resources.

---

## Project groups

Project groups are nestable containers holding **preferences only** — they
cannot own sessions, tasks, or channels (those belong to projects).
Base path `/api/groups`. All **[session | key]**.

```http
GET    /api/groups                 # list
POST   /api/groups                 # create { name, parentGroupId, sortOrder? }
GET    /api/groups/:id             # get
PATCH  /api/groups/:id             # update { name?, collapsed?, sortOrder? }
DELETE /api/groups/:id?force=…     # delete (force=true cascades to descendants)
POST   /api/groups/:id/move        # reparent { newParentGroupId }
```

- **Create** body: `name` (string, required), `parentGroupId` (string \| null, required), `sortOrder` (number, optional). Returns `201` `{ group }`.
- **Delete** without `force=true` returns `400` when the group has children.
- **Move** body: `{ "newParentGroupId": "uuid-or-null" }`.

See the [Group object](#group-object).

---

## Projects

Projects are the leaves of the tree. They own sessions, tasks, channels, secrets
configs, GitHub bindings, and repository associations. Base path `/api/projects`.
All **[session | key]**.

```http
GET    /api/projects?groupId=…     # list (omit groupId for all)
POST   /api/projects               # create { groupId, name, sortOrder? }
GET    /api/projects/:id           # get
PATCH  /api/projects/:id           # update { name?, collapsed?, sortOrder? }
DELETE /api/projects/:id           # delete
POST   /api/projects/:id/move      # move to another group { newGroupId }
POST   /api/projects/:id/open      # open the project's default working directory (OS-level)
```

- **Create** returns `201` `{ project }`.
- **Move** body: `{ "newGroupId": "uuid" }`.

See the [Project object](#project-object).

---

## Node preferences

Polymorphic preferences keyed by `(ownerType, ownerId)` where `ownerType` is
`group` or `project`. Group preferences accept a restricted subset (no
`localRepoPath`); project preferences accept the full schema.
All **[session | key]**.

```http
GET    /api/node-preferences/:ownerType/:ownerId
PUT    /api/node-preferences/:ownerType/:ownerId
DELETE /api/node-preferences/:ownerType/:ownerId
```

`:ownerType` ∈ `{ group, project }`. The `PUT` body shape depends on
`ownerType` — see `NodePreferences.forGroup` / `NodePreferences.forProject` in
`src/domain/value-objects/NodePreferences.ts` for the authoritative fields.

---

## Preferences

### Get preferences

```http
GET /api/preferences
```

**[session]**. Returns `{ userSettings, nodePreferences }`.

```json
{
  "userSettings": {
    "id": "uuid", "userId": "uuid",
    "defaultWorkingDirectory": "/Users/me", "defaultShell": "/bin/zsh",
    "theme": "tokyo-night", "fontSize": 14,
    "fontFamily": "'JetBrainsMono Nerd Font Mono', monospace",
    "activeNodeId": "uuid", "activeNodeType": "project",
    "autoFollowActiveSession": true
  },
  "nodePreferences": [
    { "ownerType": "project", "ownerId": "uuid", "userId": "uuid",
      "fields": { "theme": "dracula", "githubRepoId": "uuid", "localRepoPath": "/path" } }
  ]
}
```

### Update user settings

```http
PATCH /api/preferences
```

**[session]**. Body: any subset of user-settings fields. To change the active
node, use the dedicated endpoint below.

### Set active node

```http
POST /api/preferences/active-node
```

**[session | key]**. Tasks, channels, and peer aggregations follow this
selection — group nodes roll up across descendant projects.

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | string \| null | Group/project UUID (or `null` to clear) |
| `nodeType` | `"group"` \| `"project"` \| null | Discriminator (must be present iff `nodeId` is) |
| `pinned` | boolean | When `true`, clears the active selection (pin semantics) |

**Response:** `{ "ok": true }`.

---

## Templates

Reusable session configurations. Base path `/api/templates`. All **[session]**.

```http
GET    /api/templates              # list
POST   /api/templates              # create
GET    /api/templates/:id          # get
PATCH  /api/templates/:id          # update
DELETE /api/templates/:id          # delete
POST   /api/templates/:id          # record usage — body { "action": "use" }
```

**Create body:** `{ name, description?, projectPath?, startupCommand?, theme?, fontSize?, fontFamily? }`.
Returns `201` with the template object.

---

## Recordings

Terminal session recordings. Base path `/api/recordings`. All **[session]**.

```http
GET    /api/recordings             # list
POST   /api/recordings             # create
GET    /api/recordings/:id?parsed= # get (parsed=true returns decoded data)
PATCH  /api/recordings/:id         # update metadata { name?, sessionId? }
DELETE /api/recordings/:id         # delete
```

**Create body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Recording name |
| `data` | string | Yes | Base64-encoded recording data |
| `duration` | number | Yes | Duration in seconds |
| `sessionId` | string | No | Associated session UUID |

---

## Tasks

Project task tracker. Base path `/api/tasks`. All **[session | key]**.

```http
GET    /api/tasks                  # list (see scoping below)
POST   /api/tasks                  # create
DELETE /api/tasks                  # bulk clear (requires ?folderId=)
GET    /api/tasks/:id              # get
PATCH  /api/tasks/:id              # update
DELETE /api/tasks/:id              # delete (204 No Content)
```

**List scoping:** either `?folderId=<projectId>` (single project) **or**
`?nodeId=<id>&nodeType=(group|project)` — group nodes roll up tasks across all
descendant projects.

**Bulk clear** query params: `folderId` (required), `source` (`manual`|`agent`),
`sessionId`, `completedOnly=true`. Returns `{ deleted: <count> }`.

**Create body** (`CreateTaskInput`):

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | **Required** |
| `projectId` | string \| null | Owning project |
| `sessionId` | string \| null | Originating session |
| `description` | string \| null | |
| `status` | enum | `open` \| `in_progress` \| `done` \| `cancelled` |
| `priority` | enum | `critical` \| `high` \| `medium` \| `low` |
| `source` | enum | `manual` \| `agent` |
| `labels` | `{name,color}[]` | Color is hex without `#` |
| `subtasks` | `{id,title,completed}[]` | |
| `instructions` | string \| null | |
| `owner` | string \| null | |
| `dueDate` | string \| null | ISO 8601 |
| `githubIssueUrl` | string \| null | |
| `blockedBy` | string[] | Task IDs that block this one |
| `metadata` | object | Arbitrary |
| `sortOrder` | number | |

See the [Task object](#task-object).

---

## Channels

Project-scoped chat (channel groups → channels → messages, with threads).
Base path `/api/channels`. All **[session | key]**.

```http
GET    /api/channels                                       # list channel groups + unread counts
POST   /api/channels                                       # create channel { projectId, name, topic? }
GET    /api/channels/:channelId                            # channel details
DELETE /api/channels/:channelId                            # archive channel
GET    /api/channels/:channelId/messages?before=&limit=    # list messages (paginated)
POST   /api/channels/:channelId/messages                   # send { body, parentMessageId? }
GET    /api/channels/:channelId/messages/:messageId/thread # thread replies
POST   /api/channels/:channelId/read                       # mark read { messageId }
POST   /api/channels/dm                                    # find/create DM
```

- **List** scoping: `?projectId=` (single project; legacy `?folderId=` alias) **or** `?nodeId=&nodeType=(group|project)` (group aggregates descendants). A stale/unowned id returns `200` with `{ groups: [] }`; a malformed `nodeType` returns `400`.
- **Messages list** `limit` is clamped to 1–200 (default 50); `before` is an ISO date cursor.
- **Send message** body `body` is required, max **8192** chars; `parentMessageId` (optional) must belong to the same channel. Returns `201` `{ messageId, message }`.
- **DM** body: `{ projectId, targetSessionId, fromSessionId }`.

See the [Channel object](#channel-object).

---

## Notifications

Base path `/api/notifications`. All **[session | key]**.

```http
GET    /api/notifications?limit=50&unreadOnly=false   # list + unread count
POST   /api/notifications                             # create { title, type?, body?, sessionId? }
PATCH  /api/notifications                             # mark read { ids?: [], all?: true }
DELETE /api/notifications                             # delete { ids?: [], all?: true }
POST   /api/notifications/push-token                  # register FCM push token
DELETE /api/notifications/push-token                  # unregister FCM push token { token? }
```

- **GET** returns `{ notifications, unreadCount }`; `limit` clamped 1–200.
- **POST** create requires `title`; `type` defaults to `"info"`. Debounced creation may return `{ "debounced": true }`.
- **PATCH/DELETE** require either `ids` (non-empty) or `all: true`.

---

## Peers

Project-scoped inter-agent peer discovery and messaging (the user-facing read
side; agents also use the `rdv peer` CLI). Base path `/api/peers`.
All **[session | key]**.

```http
GET  /api/peers/peers?folderId=<uuid>             # list peers in the project
GET  /api/peers/messages?folderId=<uuid>&limit=200 # list recent peer messages
POST /api/peers/messages                          # send a broadcast user message { folderId, body }
```

> The terminal-server `/internal/peers/*` routes (send/poll/summary/cleanup,
> with MCP socket push) are **not** part of this API — see the scope note at the
> top of this document.

---

## GitHub

Repository integration. Base path `/api/github`.

### Repositories

```http
GET    /api/github/repositories                       # [session] list repos
GET    /api/github/repositories/:id                   # [session] get cached repo
POST   /api/github/repositories/:id                   # [session] clone to disk
DELETE /api/github/repositories/:id                   # [session] remove cached repo
GET    /api/github/repositories/:id/branches          # [session] list branches
GET    /api/github/repositories/:id/folders?maxDepth=3# [session] directory tree
GET    /api/github/repositories/:id/issues            # [session | key] list issues
GET    /api/github/repositories/:id/issues/:number    # [session | key] get one issue
GET    /api/github/repositories/:id/issues/:number/comments # [session | key] issue comments
```

**List repositories** query: `cached` (`true` = cloned only), `page` (default 1),
`perPage` (default 100), `sort` (`updated`|`created`|`pushed`|`full_name`).
Returns `{ repositories, page, hasMore }`. When GitHub is not linked, returns
`{ error: "GitHub not connected", code: "GITHUB_NOT_CONNECTED" }`.

**List issues** query: `state` (`open`|`closed`|`all`, default `open`), `page`,
`per_page` (max 100).

### Worktrees

```http
POST   /api/github/worktrees         # [session] create worktree
DELETE /api/github/worktrees         # [session] remove worktree
POST   /api/github/worktrees/check   # [session] check for uncommitted changes
POST   /api/github/pr-worktree       # [session] create a worktree + session for a PR
```

- **Create** body: `{ repositoryId, branch, createNewBranch?, baseBranch? }` → `{ success, worktreePath, branch }`.
- **Delete** body: `{ repositoryId, worktreePath, force? }`.
- **Check** body: `{ repositoryId, worktreePath }` → `{ hasUncommittedChanges, branch }`.

### Issues (create) and stats

```http
POST /api/github/issues                  # [session | key] create issue
POST /api/github/issues/mark-seen        # [session | key] mark issues seen
GET  /api/github/stats                   # [session] enriched repo list with stats
POST /api/github/stats                   # [session] refresh all repo stats
GET  /api/github/stats/:repoId           # (unwrapped) stats for one repo
POST /api/github/stats/:repoId           # (unwrapped) refresh one repo's stats
POST /api/github/stats/mark-seen         # (unwrapped) mark stat changes seen
```

**Create issue** body: `{ owner, repo, title, body?, labels?, assignees? }`.
`owner`, `repo`, `title` required. Returns `{ success, issue: { id, number, title, htmlUrl, state } }`.

---

## GitHub accounts

Multi-account linking with per-project bindings.

```http
GET    /api/github/accounts                   # [session] list linked accounts + bindings
PATCH  /api/github/accounts/:accountId        # [session] set default / bind / unbind project
DELETE /api/github/accounts/:accountId        # [session] unlink account

GET    /api/github/account                    # [session] current account info + stats
POST   /api/github/account                    # [session] (re)connect / refresh account
DELETE /api/github/account?clearCache=…       # [session] disconnect current account
```

**PATCH** body: `{ action: "set-default" | "bind-project" | "unbind-project", projectId? }`.

> `/api/github/account` (singular) is the older single-account endpoint;
> `/api/github/accounts` (plural) is the multi-account API.

---

## API keys

Manage API keys for programmatic access. Base path `/api/keys`. All **[session]**
(keys are created/managed from a logged-in browser session).

```http
GET    /api/keys              # list (prefixes only)
POST   /api/keys              # create
GET    /api/keys/:id          # get one
DELETE /api/keys/:id          # revoke
```

**Create body:** `{ name, expiresAt? }` (`name` ≤ 100 chars; `expiresAt` is ISO 8601).
**Response** `201`:

```json
{ "id": "uuid", "name": "Orchestrator", "key": "rdv_…", "keyPrefix": "rdv_abcdefgh", "createdAt": "…" }
```

⚠️ The full `key` is returned **once** — store it securely. List/get responses
only ever expose `keyPrefix`. See the [ApiKey object](#apikey-object).

---

## Agent profiles

Isolated agent environments with per-profile config, git identity, secrets, and
appearance. Base path `/api/profiles`. All **[session]** except where noted.

```http
GET    /api/profiles                          # list profiles + folder links
POST   /api/profiles                          # create { name, provider, description?, isDefault? }
GET    /api/profiles/:id                       # get
PATCH  /api/profiles/:id                       # update
DELETE /api/profiles/:id                       # delete

GET    /api/profiles/:id/appearance            # get appearance settings
PUT    /api/profiles/:id/appearance            # update appearance (mode, schemes, terminal)
DELETE /api/profiles/:id/appearance            # reset appearance to defaults

GET    /api/profiles/:id/git-identity          # get git identity
PUT    /api/profiles/:id/git-identity          # set git identity { name, email, … }

GET    /api/profiles/:id/environment           # get env overlay (resolved secrets/vars)

GET    /api/profiles/:id/secrets               # get profile secrets config
PUT    /api/profiles/:id/secrets               # create/update secrets config
PATCH  /api/profiles/:id/secrets               # toggle enabled { enabled }
DELETE /api/profiles/:id/secrets               # delete secrets config

PUT    /api/profiles/folders/:folderId         # link a folder/project to a profile { profileId }
DELETE /api/profiles/folders/:folderId         # unlink
```

**Create** body: `name` (required), `provider` (`claude`|`codex`|`gemini`|`opencode`|`all`,
required), `description?`, `isDefault?`. Returns `201` with the profile.

### Agent profile JSON configs

Manage the **JSON** config files (settings.json-style) inside a profile, keyed by
agent type. Distinct from [agent config files](#agent-config-files) (markdown
`CLAUDE.md`/`AGENTS.md` instructions). Base path `/api/agent-profiles/:id/configs`.
All **[session]** (raw session check; 401 otherwise).

```http
GET    /api/agent-profiles/:id/configs                # all JSON configs for a profile
POST   /api/agent-profiles/:id/configs                # create/update a config for an agent type
DELETE /api/agent-profiles/:id/configs                # delete configs

GET    /api/agent-profiles/:id/configs/:agentType     # get one agent type's config
PUT    /api/agent-profiles/:id/configs/:agentType     # replace
PATCH  /api/agent-profiles/:id/configs/:agentType     # merge/update
DELETE /api/agent-profiles/:id/configs/:agentType     # delete
```

`:agentType` ∈ `{ claude, gemini, opencode, codex }`. A profile that does not
belong to the caller returns `404`; an invalid `agentType` returns `400`.

---

## Agent CLI

```http
GET  /api/agent-cli/status?provider=…   # [session] installation status of all/one CLI
POST /api/agent-cli/status              # [session] verify CLI execution with environment
```

Returns version, resolved path, and install instructions for each supported
agent CLI (Claude Code, Codex, Gemini, OpenCode). The `POST` form runs a live
verification of a CLI with a given environment.

---

## Agent providers

```http
GET /api/agent-providers   # [session]
```

Returns `{ providers, agents }` — the static list of supported AI coding agent
providers and their configs (`agents` excludes the `none` sentinel).

---

## Agent config files

Manage per-scope agent instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`ANTIGRAVITY.md`, `OPENCODE.md`). Base path `/api/agent-configs`. All **[session]**.

```http
GET    /api/agent-configs?folderId=…   # list ("global" or a folder id; omit for all)
POST   /api/agent-configs              # create a config
PATCH  /api/agent-configs/:id          # update content
DELETE /api/agent-configs/:id          # delete
GET    /api/agent-configs/templates    # list available templates
POST   /api/agent-configs/templates    # (template operation)
```

**Templates** query: `projectType` (`typescript`|`python`|`rust`), `provider`
(`claude`|`codex`|`gemini`|…), `tags` (comma-separated).

> Valid providers include `antigravity`; valid config types include
> `ANTIGRAVITY.md`.

---

## Resumable Claude sessions

```http
GET /api/agent/claude-sessions?projectPath=…&profileId=…&limit=20
```

**[session | key]**. Lists resumable Claude Code sessions for a project by
scanning `.jsonl` files under `~/.claude/projects/<encoded-path>/` (or the
profile-isolated equivalent). `projectPath` required; `limit` default 20, max 50.

---

## MCP server registry

User/folder-scoped registry of MCP servers (distinct from a session's on-disk
MCP config). Base path `/api/mcp-servers`. All **[session]**.

```http
GET    /api/mcp-servers?folderId=…&global=…   # list (folder w/ inheritance, or global only)
POST   /api/mcp-servers                       # create a server
GET    /api/mcp-servers/:id                    # get
PATCH  /api/mcp-servers/:id                    # update
DELETE /api/mcp-servers/:id                    # delete
POST   /api/mcp-servers/:id/toggle             # enable/disable { enabled }
GET    /api/mcp-servers/:id/tools              # discovered tools for a server
GET    /api/mcp-servers/:id/resources          # discovered resources for a server
POST   /api/mcp-servers/:id/discover?refresh=  # trigger discovery (refresh=true re-discovers)
DELETE /api/mcp-servers/:id/discover           # clear discovery cache
GET    /api/mcp-servers/discovery              # all discovered tools + resources
POST   /api/mcp-servers/discovery              # trigger discovery across servers
GET    /api/mcp-servers/auto-start             # servers configured to auto-start
GET    /api/mcp-servers/tools/search?q=…       # search discovered tools
```

---

## Secrets

External secrets-manager integration (provider abstraction; the supported
provider type is `phase`). Routes are keyed by `projectId` but retain the
`/folders/` path segment for back-compat. Base path `/api/secrets`.
All **[session]**.

```http
GET    /api/secrets/configs                            # list all project secrets configs
GET    /api/secrets/folders/:projectId                 # get a project's secrets config
PUT    /api/secrets/folders/:projectId                 # create/update { provider, config, enabled? }
PATCH  /api/secrets/folders/:projectId                 # toggle { enabled: boolean }
DELETE /api/secrets/folders/:projectId                 # delete config
GET    /api/secrets/folders/:projectId/secrets         # fetch secret values from provider
POST   /api/secrets/validate                           # validate provider credentials
```

**PUT** body: `{ provider, config: { … }, enabled? }`. Validation errors return
`400` (`INVALID_CONFIG`, `PROVIDER_NOT_SUPPORTED`).

---

## SSH connections

User-scoped SSH connection definitions with optional project pinning.
Base path `/api/ssh-connections`. All **[session | key]**. The encrypted
password (`passwordEnc`) is **never** returned.

```http
GET    /api/ssh-connections?projectId=…        # list (tri-state filter, see below)
POST   /api/ssh-connections                    # create
GET    /api/ssh-connections/:id                # get metadata
PATCH  /api/ssh-connections/:id                # update
DELETE /api/ssh-connections/:id                # delete (also removes ~/.remote-dev/ssh/{id}/)
POST   /api/ssh-connections/:id/test           # connectivity probe (rate-limited 1/5s)
GET    /api/ssh-connections/:id/public-key     # read generated/uploaded public key
```

**List filter:** `?projectId` absent → all; `?projectId=<id>` → that project;
`?projectId=null` (or empty) → unbound (user-level) only.

**Create body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `host` | string | Yes | Hostname/IP |
| `username` | string | Yes | SSH user |
| `authType` | enum | Yes | `key` \| `agent` \| `password` \| `system` |
| `port` | number | No | Default 22 |
| `password` | string | No | Stored encrypted (`password` auth) |
| `hasPassphrase` | boolean | No | Key requires a passphrase |
| `knownHostsPolicy` | enum | No | `strict` \| `accept-new` \| `no` |
| `extraOptions` | string[] | No | Allowlisted `-o` options |
| `projectId` | string \| null | No | Pin to a project |
| `privateKey` | string | No | Paste a key to write (when `authType: key`) |
| `publicKey` | string | No | Optional matching public key |
| `generateKeypair` | boolean | No | Server-generates an ed25519 keypair (when `authType: key` and no `privateKey`) |

**Response:** `201` `{ connection, publicKey }` (`publicKey` is non-null when a
key was written or generated). See the [SshConnection object](#sshconnection-object).

---

## Schedules

Scheduled command execution against a session (one-time or recurring/cron).
Base path `/api/schedules`. All **[session | key]**.

> Execution model: commands are delivered via tmux `sendKeys` (fire-and-forget).
> A `success` execution status means keystrokes were sent, **not** that the
> command itself succeeded.

```http
GET    /api/schedules?sessionId=…          # list (optional session filter)
POST   /api/schedules                      # create
GET    /api/schedules/:id                  # get
PATCH  /api/schedules/:id                  # update
DELETE /api/schedules/:id                  # delete
POST   /api/schedules/:id/execute          # trigger a manual run
GET    /api/schedules/:id/executions?limit=50  # execution history
```

**Create body** (`CreateScheduleInput`): `sessionId` (required), `name`
(required), `commands` (non-empty array, required), `scheduleType`
(`one-time` default | `recurring`). For `recurring`, `cronExpression` is
required; for `one-time`, `scheduledAt` (future ISO datetime) is required.
Optional: `timezone`, `enabled`, `maxRetries`, `retryDelaySeconds`,
`timeoutSeconds`. Returns `201` with the schedule.

---

## Ports

Port-allocation registry, framework detection, and runtime port monitoring.
Base path `/api/ports`. All **[session]**.

```http
GET  /api/ports                       # list port allocations
POST /api/ports/status                # check live status of ports
POST /api/ports/detect-frameworks     # detect web frameworks for a project
POST /api/ports/detect-runtime        # detect runtime/listening ports
```

---

## LiteLLM

Per-user LiteLLM proxy configuration, model management, control, and analytics.
Base path `/api/litellm`.

```http
GET    /api/litellm                       # [session] get config (or defaults)
PATCH  /api/litellm                       # [session] update config
GET    /api/litellm/status                # [session] proxy run status (proxied to terminal server)
POST   /api/litellm/control               # [session] { action: "start" | "stop" | "restart" }
GET    /api/litellm/models                # [session] list models
POST   /api/litellm/models                # [session] add a model
PATCH  /api/litellm/models/:id            # [session] update a model
PUT    /api/litellm/models/:id            # [session] replace a model
DELETE /api/litellm/models/:id            # [session] remove a model
POST   /api/litellm/models/:id/default    # [session] set as default model
GET    /api/litellm/analytics             # [session] usage analytics
POST   /api/litellm/webhook               # (x-webhook-secret) usage webhook receiver
```

**Analytics** query: `type` (`summary` default | `timeseries` | `models` |
`sessions` | `latency`), `start`/`end` (ISO), `model`, `granularity`
(`hourly`|`daily`|`weekly`), `limit`.

**Webhook** does **not** use session/key auth — it is called by the LiteLLM
process and authenticated with the `x-webhook-secret` header
(`LITELLM_WEBHOOK_SECRET`).

---

## Beads

Read-only bridge to the project's [Beads](https://github.com/steveyegge/beads)
(`bd`) issue tracker, scoped to a project path on disk. Base path `/api/beads`.
All **[session | key]**. Every endpoint requires a `?projectPath=` query
parameter, which is validated against the user's authorized paths (a bad path
returns `403`).

```http
GET /api/beads?projectPath=…            # list issues (filter by status/type)
GET /api/beads/:id?projectPath=…        # get one issue
GET /api/beads/:id/comments?projectPath=…  # issue comments
GET /api/beads/config?projectPath=…     # raw .beads/config.yaml content
GET /api/beads/stats?projectPath=…      # issue statistics
```

Valid statuses: `open`, `in_progress`, `closed`, `deferred`. Valid types:
`task`, `bug`, `feature`, `epic`, `chore`, `message`.

---

## Trash

Polymorphic trash with 30-day retention. Base path `/api/trash`. All **[session]**.

```http
GET    /api/trash?type=…           # list trash items (optional resource-type filter)
POST   /api/trash                  # trigger cleanup of expired items
GET    /api/trash/:id              # get item details
DELETE /api/trash/:id              # permanently delete
GET    /api/trash/:id/restore      # check restore availability
POST   /api/trash/:id/restore      # restore { restorePath?, targetFolderId? }
```

---

## Appearance

```http
GET   /api/appearance     # [session] user appearance settings + available color schemes
PATCH /api/appearance     # [session] update appearance settings
```

---

## Dashboard

Activity/usage dashboard. Base path `/api/dashboard`. All **[session]**.

```http
GET  /api/dashboard?days=30           # summary
POST /api/dashboard                   # (dashboard action)
GET  /api/dashboard/errors?limit=50   # recent error events
GET  /api/dashboard/events?limit=50&type=…  # recent activity events
GET  /api/dashboard/providers?days=30 # per-agent-provider stats
```

`days` is clamped 1–365; `limit` is clamped 1–200.

---

## System

Application logs and self-update. Base path `/api/system`. All **[session | key]**.

```http
GET    /api/system/logs                 # query log entries (filter + paginate)
DELETE /api/system/logs                 # clear log entries
GET    /api/system/logs/namespaces      # distinct namespaces (for filters)
GET    /api/system/update               # current update status
POST   /api/system/update               # update action: check | apply | cancel
```

**Logs** filters include `level` (`error`|`warn`|`info`|`debug`|`trace`) and
`source` (`nextjs`|`terminal`), plus namespace/time/pagination params.

---

## tmux

Low-level tmux session inspection and cleanup. Base path `/api/tmux/sessions`.
All **[session]**.

```http
GET    /api/tmux/sessions                # list all tmux sessions (with orphan detection)
DELETE /api/tmux/sessions?name=…         # terminate a single tmux session
DELETE /api/tmux/sessions/orphaned       # terminate all orphaned tmux sessions
```

---

## Files

Read/write/probe files for the in-app editor. SECURITY: paths must resolve
within the user's home directory or `/tmp`; max file size 10 MB.

```http
GET  /api/files/read?path=/abs/path     # [session | key] read file contents
POST /api/files/write                   # [session | key] write file (atomic temp+rename)
POST /api/files/exists                  # [session] batch existence check { paths: [] }
```

**Write** body: `{ path, content }`. **Exists** returns a `path → boolean` map.

---

## Directories

```http
GET  /api/directories?path=…   # [session] browse filesystem directories
GET  /api/directories/roots    # [session] quick-access browse roots
POST /api/directories          # [session] create a folder { path, name }
```

**Browse** returns `{ entries: [{ name, path, isDirectory }] }`, restricted to
allowed paths. Used by the directory-picker UI.

**Roots** returns `{ roots: [{ id, label, path }] }` — quick-access entries
(Home, Projects) that exist on disk and resolve inside the browse allowlist.

**Create** body `{ path, name }` makes a new folder under `path`; returns
`{ entry: { name, path, isDirectory } }`. Errors: `400` invalid name/path,
`403` permission denied, `409` already exists.

---

## Git

```http
GET /api/git/validate?path=…   # [session | key]
```

Checks whether `path` is a git repository. Returns `{ isGitRepo, branches }`.

---

## Images

```http
POST /api/images   # [session]
```

Upload an image and persist it to disk. Accepts `multipart/form-data`
(`image: File`, JPEG/PNG/GIF/WebP, ≤ 5 MB) **or** JSON
`{ data: "<base64>", mediaType: "image/png" }`. Returns `{ path, size, mediaType }`.

---

## Config

```http
GET /api/config   # [session | key]
```

Runtime configuration probe used by ops tooling and the multi-instance smoke
tests. Requires auth (the `instanceSlug` is treated as semi-sensitive).

**Response:**

```json
{ "basePath": "/alpha", "instanceSlug": "alpha", "version": "0.3.18" }
```

| Field | Description |
|-------|-------------|
| `basePath` | `RDV_BASE_PATH` (empty string when unset) |
| `instanceSlug` | `RDV_INSTANCE_SLUG`, defaulted to the last basePath segment |
| `version` | `npm_package_version` at process start, or `"unknown"` |

---

## Setup

First-run setup wizard. These are **public** (no auth) except `install`.

```http
GET  /api/setup/platform        # detect OS/arch/package-manager/WSL (public)
GET  /api/setup/dependencies    # check required dependencies (public)
GET  /api/setup/complete        # read setup state (public)
POST /api/setup/complete        # persist setup configuration (public)
POST /api/setup/install         # [session] return/run an install command for a dependency
```

`POST /api/setup/complete` body is a `SetupConfiguration`
(`{ workingDirectory, nextPort, terminalPort, wslDistribution?, autoStart, checkForUpdates, … }`).

---

## Health probes

Kubernetes-style probes. **Unauthenticated by design** (the proxy bypasses them).

```http
GET /api/healthz   # liveness — always 200 { "status": "ok" } if the event loop is alive
GET /api/readyz    # readiness — 200 when ready, 503 when degraded
```

`GET /api/readyz` checks SQLite (`SELECT 1`), the `tmux` binary, and the
terminal server's loopback `/health`. Response:
`{ ready: boolean, checks: { db, tmux, terminal } }`.

---

## Deploy webhook

```http
POST /api/deploy
```

Receives a GitHub-style push webhook to trigger a blue-green deploy.
**Auth is HMAC-SHA256**, not session/key:

- Header `X-Hub-Signature-256: sha256=<hmac>` verified against `DEPLOY_WEBHOOK_SECRET` (constant-time).
- Header `X-GitHub-Event: push`; only pushes to `refs/heads/master` deploy.
- Returns `202 Accepted` `{ message, commit, pid }` on trigger, `409` if a deploy is already running, `401` on bad signature, `503` if unconfigured.
- Returns `410 Gone` (`WEBHOOK_DEPRECATED`) when `AUTO_UPDATE_ENABLED=true` (poll-based auto-update supersedes the webhook).

---

## Cron

Scheduled-maintenance endpoints. Authenticated with `CRON_SECRET` (either
`Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`). If
`CRON_SECRET` is unset, the endpoints are **disabled**. Both `GET` and `POST`
are accepted (for cron runners that only issue GETs).

```http
POST|GET /api/cron/trash-cleanup      # purge expired trash (30-day retention)
POST|GET /api/cron/litellm-cleanup    # purge old LiteLLM request logs
```

---

## Auth

NextAuth and OAuth endpoints. These are **not** wrapped by `withAuth`/`withApiAuth`.

```http
GET|POST /api/auth/[...nextauth]    # NextAuth.js handler (sign-in, callback, session, csrf, …)
GET      /api/auth/github/link      # [session] start GitHub OAuth account-link flow
GET      /api/auth/github/callback  # GitHub OAuth callback (public; validates OAuth state)
POST     /api/auth/mobile-exchange  # exchange a Cloudflare Access JWT for an API key
POST     /api/auth/signout          # sign out / clear session
```

**`POST /api/auth/mobile-exchange`** body: `{ cfToken }`. Validates the
Cloudflare Access JWT, finds/creates the user, and returns a freshly-minted API
key for the mobile app. `400` if `cfToken` is missing, `401` if invalid.

---

## WebSocket protocol

Real-time terminal I/O is served by the **terminal server** (default port
**6002**), not by the Next.js API.

### Connection

Obtain a short-lived token from
[`GET /api/sessions/:id/token`](#get-websocket-token), then connect:

```
ws://localhost:6002?token={token}&tmuxSession={tmuxSessionName}&cols={cols}&rows={rows}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | string | Token from `/api/sessions/:id/token` (5-min TTL) |
| `tmuxSession` | string | tmux session name (e.g. `rdv-abc12345`) |
| `cols` | number | Terminal columns |
| `rows` | number | Terminal rows |

### Messages (JSON-encoded)

**Client → server:**

```json
{ "type": "input",  "data": "ls -la\r" }
{ "type": "resize", "cols": 120, "rows": 40 }
```

> Submit input with a carriage return (`\r`), not `\n` — agent TUIs expect `\r`.

**Server → client:**

```json
{ "type": "output", "data": "file1.txt  file2.txt\n" }
{ "type": "ready", "sessionId": "rdv-abc12345" }
{ "type": "session_created",  "tmuxSessionName": "rdv-abc12345" }
{ "type": "session_attached", "tmuxSessionName": "rdv-abc12345" }
{ "type": "exit", "code": 0 }
{ "type": "error", "message": "Failed to attach to tmux session" }
```

The terminal server also pushes higher-level events (e.g. `agent_exited`,
channel/notification sync) to connected clients for the owning user.

---

## Schemas

These shapes recur across responses. Field sets are representative, not
exhaustive — see `src/db/schema.ts` and the `src/types/*` definitions for the
authoritative types.

### Session object

```json
{
  "id": "uuid",
  "name": "My Project",
  "tmuxSessionName": "rdv-abc12345",
  "projectPath": "/Users/me/projects/a",
  "projectId": "uuid",
  "githubRepoId": "uuid",
  "worktreeBranch": "feature/new-ui",
  "terminalType": "agent",
  "agentProvider": "claude",
  "agentExitState": "running",
  "status": "active",
  "tabOrder": 0,
  "parentSessionId": null,
  "lastActivityAt": "2024-01-15T10:30:00Z",
  "createdAt": "2024-01-15T09:00:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

`status` ∈ `{ active, suspended, closed }`. `terminalType` ∈
`{ shell, agent, ssh, file, browser, loop }`.

### Group object

```json
{ "id": "uuid", "userId": "uuid", "name": "Work", "parentGroupId": null,
  "sortOrder": 0, "collapsed": false, "createdAt": "…", "updatedAt": "…" }
```

### Project object

```json
{ "id": "uuid", "userId": "uuid", "groupId": "uuid", "name": "remote-dev",
  "sortOrder": 0, "collapsed": false, "createdAt": "…", "updatedAt": "…" }
```

### Task object

```json
{
  "id": "uuid", "userId": "uuid", "projectId": "uuid", "sessionId": null,
  "title": "Fix login bug", "description": null,
  "status": "open", "priority": "high", "source": "manual",
  "labels": [ { "name": "Bug", "color": "e11d48" } ],
  "subtasks": [ { "id": "uuid", "title": "Repro", "completed": false } ],
  "blockedBy": [], "owner": null, "dueDate": null, "githubIssueUrl": null,
  "instructions": null, "metadata": {}, "sortOrder": 0,
  "createdAt": "…", "updatedAt": "…"
}
```

### Channel object

```json
{ "id": "uuid", "projectId": "uuid", "groupId": "uuid", "name": "general",
  "topic": null, "unreadCount": 0, "createdAt": "…", "updatedAt": "…" }
```

### SshConnection object

```json
{ "id": "uuid", "userId": "uuid", "projectId": null,
  "name": "prod-box", "host": "example.com", "port": 22, "username": "deploy",
  "authType": "key", "hasPassphrase": false, "knownHostsPolicy": "accept-new",
  "extraOptions": [], "createdAt": "…", "updatedAt": "…" }
```

`passwordEnc` is never serialized.

### ApiKey object

```json
{ "id": "uuid", "name": "CI Pipeline", "keyPrefix": "rdv_abc12345",
  "lastUsedAt": "…", "expiresAt": null, "createdAt": "…" }
```

The plaintext `key` is only present in the `POST /api/keys` response.

### Error object

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE", "details": "optional" }
```

---

## Error handling

### HTTP status codes

| Status | Meaning |
|--------|---------|
| 200 | OK |
| 201 | Created |
| 202 | Accepted (deploy triggered) |
| 204 | No Content (e.g. task delete) |
| 400 | Bad request / validation error |
| 401 | Unauthorized (no valid session/key) |
| 403 | Forbidden (e.g. unauthorized project path) |
| 404 | Not found |
| 409 | Conflict (e.g. deploy already in progress) |
| 410 | Gone (tmux session gone; deprecated webhook) |
| 500 | Internal server error |
| 503 | Service unavailable (readiness degraded; cron/deploy unconfigured) |

### Error response format

```json
{ "error": "Error message", "code": "ERROR_CODE" }
```

Common machine codes seen across handlers: `UNAUTHORIZED`,
`PROJECT_ID_REQUIRED`, `SESSION_NOT_FOUND`, `SESSION_CLOSED`,
`TMUX_SESSION_GONE`, `INVALID_PATH`, `INVALID_JSON`, `GITHUB_NOT_CONNECTED`,
`GITHUB_API_ERROR`, `INVALID_CONFIG`, `PROVIDER_NOT_SUPPORTED`,
`INVALID_AUTH_TYPE`, `INVALID_POLICY`, `CRON_REQUIRED`,
`SCHEDULED_AT_IN_PAST`, `WEBHOOK_DEPRECATED`.

---

## Rate limits

The application does not implement general rate limiting — it is designed for
single-user/local-LAN deployment. Two exceptions:

- `POST /api/ssh-connections/:id/test` is rate-limited to **1 request / 5 s** per connection.
- GitHub-proxying endpoints are subject to **GitHub's** rate limits (5000 req/hr for authenticated users).
