---
name: rdv
description: Remote Dev CLI for managing terminal sessions, worktrees, agents, and tasks. Use when you need to interact with Remote Dev.
---

# Remote Dev CLI (`rdv`)

You are running inside a Remote Dev terminal session. Use the `rdv` CLI to interact with the system.

## Discovering Your Context

Always start by discovering your session context:

```bash
rdv context
```

This shows your session ID, folder, project path, and tmux session name.

## Session Management

```bash
# List all active sessions
rdv session list

# Create a new session
rdv session create --name "my-session" --folder-id <id> --working-dir /path/to/project

# Execute a command in another session
rdv session exec <session-id> "echo hello"

# Close a session
rdv session close <session-id>
```

## Starting Parallel Agents

Launch a new agent session in a folder (uses the folder's configured agent provider):

```bash
# Start agent in a folder
rdv agent start <folder-id>

# Start agent with a worktree for branch isolation
rdv agent start <folder-id> --worktree feature/my-branch

# List running agent sessions
rdv agent list
```

## Worktree Management

Create isolated git worktrees for branch work:

```bash
# Create a worktree
rdv worktree create --repo /path/to/repo --branch feature/my-branch

# List worktrees
rdv worktree list --repo /path/to/repo

# Remove a worktree
rdv worktree remove --repo /path/to/repo --branch feature/my-branch
```

## Task Management

Manage tasks for your current session:

```bash
# List tasks for current session
rdv task list

# Create a task
rdv task create "Implement auth module" --priority high

# Update task status
rdv task update <id> --status in_progress

# Mark task complete
rdv task complete <id>

# Check for incomplete tasks (used by stop hook)
rdv task check
```

## Notification Management

```bash
# List unread notifications
rdv notification list --unread

# List recent notifications (limit to 10)
rdv notification list --limit 10

# Mark specific notifications as read
rdv notification read <id1> <id2>

# Mark all notifications as read
rdv notification read --all

# Delete specific notifications
rdv notification delete <id1> <id2>

# Delete all notifications
rdv notification delete --all
```

## Browser Automation

Control headless browser sessions:

```bash
# Navigate to a URL
rdv browser navigate <session-id> https://example.com

# Take a screenshot
rdv browser screenshot <session-id> --output ./screenshot.jpg

# Get accessibility snapshot
rdv browser snapshot <session-id>

# Click at coordinates
rdv browser click <session-id> 100 200

# Type text (optionally with CSS selector)
rdv browser type <session-id> "hello world" --selector "#input-field"

# Evaluate JavaScript
rdv browser evaluate <session-id> "document.title"

# Navigate back/forward
rdv browser back <session-id>
rdv browser forward <session-id>
```

## Session Children & Spawning

Manage child sessions for parallel work:

```bash
# List child sessions
rdv session children <parent-session-id>

# Spawn a child agent session
rdv session spawn <parent-session-id> --agent-provider claude --name "subtask-1"

# Spawn with specific folder and project path
rdv session spawn <parent-id> --folder-id <fid> --project-path /path/to/project

# Get git status for a session
rdv session git-status <session-id>
```

## Lifecycle Hooks

Commands designed for Claude Code hook integration:

```bash
# Stop hook: report idle, check tasks, notify (used by Stop hook)
rdv hook stop --agent claude --reason "task complete"

# Notify about a lifecycle event (used by Stop/PostToolUse hooks)
rdv hook notify task_complete
rdv hook notify error --message "Build failed"

# Session end: report ended status, optionally skip learning (used by SessionEnd hook)
rdv hook session-end
rdv hook session-end --skip-learn
```

## System Status

```bash
# View system dashboard
rdv status

# Report agent status (used by hooks, not usually called directly)
rdv status report running
```

## Output Format

All commands output JSON by default (for piping to `jq`):

```bash
rdv session list | jq '.[].tmuxSessionName'
```

Use `--human` for human-readable table output:

```bash
rdv session list --human
```

## Common Workflows

### 1. Discover context and start working
```bash
rdv context                    # Learn your session info
rdv task list                  # Check existing tasks
```

### 2. Start a parallel agent for a subtask
```bash
rdv agent start <folder-id> --worktree feature/subtask
```

### 3. Create isolated work with worktrees
```bash
rdv worktree create --repo . --branch feature/experiment
rdv session create --name "experiment" --working-dir /path/to/worktree
```

### 4. Orchestrate parallel agents with children
```bash
rdv session spawn <my-session-id> --agent-provider claude --name "backend-work"
rdv session spawn <my-session-id> --agent-provider claude --name "frontend-work"
rdv session children <my-session-id>   # Monitor child sessions
rdv notification list --unread         # Check for notifications
```
