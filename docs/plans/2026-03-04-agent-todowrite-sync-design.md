# Agent Task Sync Design

**Date**: 2026-03-04
**Status**: Approved
**Updated**: 2026-03-05 — Adapted to Claude Code v2.1.69+ TaskCreate/TaskUpdate API

## Goal

Mirror Claude Code's internal task list into remote-dev's Task Sidebar ("Agent Tasks" section) in real-time, so users can see what each agent session is working on.

## Data Flow

```
Claude Code (TaskCreate/TaskUpdate tools)
  → PostToolUse hook fires (matcher: "TaskCreate|TaskUpdate|TodoWrite")
  → Hook reads task data from stdin JSON
  → Hook POSTs to terminal server: /internal/agent-todos?sessionId=<uuid>
  → Terminal server:
      1. Parses PostToolUse payload (tool_name + tool_input)
      2. Looks up session → gets userId, folderId
      3. Creates or updates project_task records (source: "agent")
      4. Broadcasts "agent_todos_updated" via WebSocket
  → Frontend receives WebSocket message → refreshes TaskContext
  → Task Sidebar "Agent Tasks" section updates in real-time
```

## Schema Changes

Add `sessionId` column (nullable UUID) to `project_task` table. Links agent-created tasks to the originating session for lifecycle management.

## Hook Configuration

PostToolUse hook matching `"TaskCreate|TaskUpdate|TodoWrite"`, installed by `AgentProfileService.installAgentHooks()` alongside existing agent-status hooks. Follows the same pattern: extract tmux env vars, POST to terminal server with full PostToolUse JSON body on stdin.

## Terminal Server Endpoint

`POST /internal/agent-todos?sessionId=<uuid>`

Request body is the raw PostToolUse stdin JSON from Claude Code.

### TaskCreate (Claude Code v2.1.69+)
```json
{
  "tool_name": "TaskCreate",
  "tool_input": {
    "subject": "Fix login bug",
    "description": "Fix the authentication issue in auth.ts",
    "activeForm": "Fixing login"
  }
}
```

### TaskUpdate (Claude Code v2.1.69+)
```json
{
  "tool_name": "TaskUpdate",
  "tool_input": {
    "taskId": "1",
    "status": "completed"
  }
}
```

### Legacy TodoWrite (pre-v2.1.69)
```json
{
  "tool_name": "TodoWrite",
  "tool_input": {
    "todos": [
      {"id": "1", "content": "Read auth module", "status": "in_progress"},
      {"id": "2", "content": "Fix login bug", "status": "completed"}
    ]
  }
}
```

Server logic:
1. Parse PostToolUse payload → extract tool_name and tool_input
2. Look up session → get userId, folderId
3. For TaskCreate: create new project_task with dedup via description marker
4. For TaskUpdate: match task by position index, update status/title
5. Status mapping: `in_progress` → `in_progress`, `completed` → `done`, `pending` → `open`
6. Broadcast `agent_todos_updated` via WebSocket

## Frontend Changes

1. WebSocket handler: listen for `agent_todos_updated` → call `refreshTasks()`
2. Session close handler: auto-archive completed agent tasks (hide from default view). In-progress tasks remain visible.

## Task Scoping

- Tasks are folder-scoped via the session's folderId
- Each session's todos are isolated by the sessionId column
- Existing "Agent Tasks" section and Bot badge handle display

## Lifecycle

- **Session active**: Tasks sync in real-time via PostToolUse hook
- **Session close**: Completed tasks auto-archived, in-progress tasks remain visible
- **Manual cleanup**: Users can delete archived agent tasks manually
