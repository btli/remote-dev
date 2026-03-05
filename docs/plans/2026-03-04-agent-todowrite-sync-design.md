# Agent TodoWrite Sync Design

**Date**: 2026-03-04
**Status**: Approved

## Goal

Mirror Claude Code's internal TodoWrite task list into remote-dev's Task Sidebar ("Agent Tasks" section) in real-time, so users can see what each agent session is working on.

## Data Flow

```
Claude Code (TodoWrite tool)
  → PostToolUse hook fires (matcher: "TodoWrite")
  → Hook reads task data from stdin JSON
  → Hook POSTs to terminal server: /internal/agent-todos?sessionId=<uuid>
  → Terminal server:
      1. Looks up session → gets userId, folderId
      2. Diffs incoming tasks against existing agent tasks for this session
      3. Creates/updates/completes project_task records (source: "agent")
      4. Broadcasts "agent_todos_updated" via WebSocket
  → Frontend receives WebSocket message → refreshes TaskContext
  → Task Sidebar "Agent Tasks" section updates in real-time
```

## Schema Changes

Add `sessionId` column (nullable UUID) to `project_task` table. Links agent-created tasks to the originating session for lifecycle management.

## Hook Configuration

PostToolUse hook matching `"TodoWrite"`, installed by `AgentProfileService.installAgentHooks()` alongside existing agent-status hooks. Follows the same pattern: extract tmux env vars, POST to terminal server with full TodoWrite JSON body on stdin.

## Terminal Server Endpoint

`POST /internal/agent-todos?sessionId=<uuid>`

Request body is the raw PostToolUse stdin JSON from Claude Code:
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
1. Look up session → get userId, folderId
2. Fetch existing agent tasks for this session (via sessionId column)
3. Diff and sync: new IDs → create, changed status → update, removed IDs → cancel
4. Status mapping: `in_progress` → `in_progress`, `completed` → `done`, `pending` → `open`
5. Broadcast `agent_todos_updated` via WebSocket

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
