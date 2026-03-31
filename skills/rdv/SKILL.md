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

## Session Naming

**IMPORTANT: Set a descriptive title for your session as one of your first actions** so peers can identify your work:

```bash
rdv session title fix-auth-token-refresh
rdv session title implement-payment-webhook
rdv session title debug-memory-leak-api
```

**Rules:**
- 3-5 words, hyphen-separated (kebab-case)
- Lowercase letters and hyphens only
- Describe the work, not the agent (e.g. "add-user-pagination" not "my-session-3")
- Set this within your first few tool uses

If you don't call `rdv session title`, the system auto-generates a title from your first message — but prefer setting it explicitly for clarity.

## Starting Parallel Agents

Launch a new agent session in a folder (uses the folder's configured agent provider):

**IMPORTANT: Always use worktrees when spawning subagents or working in agent teams.** Worktrees provide branch isolation that prevents merge conflicts between parallel agents working on the same codebase.

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

# Remove a worktree (directory only, no branch cleanup)
rdv worktree remove --worktree-path /path/to/worktree --project-path /path/to/repo [--force]

# Full cleanup: verify merge, remove worktree, delete branches, close session
# This is the preferred way to clean up when you're done with a worktree.
# It works even when your CWD is inside the worktree being removed.
rdv worktree cleanup [--force]
```

### Worktree Cleanup Flow

When you finish work in a worktree (commits pushed, PR merged), use `rdv worktree cleanup`:

1. **Merge verification**: Checks that your branch is merged into main/master. Returns an error if not merged (use `--force` to skip).
2. **Worktree removal**: Removes the worktree directory via server-side git commands (CWD-safe).
3. **Branch deletion**: Deletes both the local and remote branch.
4. **Session close**: Kills the tmux session and marks the session as closed.

```bash
# After your PR is merged, clean up everything:
rdv worktree cleanup

# If you want to discard unmerged work:
rdv worktree cleanup --force
```

**Note**: `rdv worktree cleanup` requires `RDV_SESSION_ID` to be set (automatically set in agent sessions). It uses the session's metadata to find the worktree path and branch.

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

# Notify about a lifecycle event
rdv hook notify task_complete
rdv hook notify error --body "Build failed"

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

### 4. Complete work in a worktree and clean up
```bash
# Do your work, commit, push, create/merge PR
git add . && git commit -m "feat: my changes"
git push origin feature/my-branch
gh pr create --fill && gh pr merge --auto

# Clean up worktree, branches, and session
rdv worktree cleanup
```

### 5. Orchestrate parallel agents with children
```bash
rdv session spawn <my-session-id> --agent-provider claude --name "backend-work"
rdv session spawn <my-session-id> --agent-provider claude --name "frontend-work"
rdv session children <my-session-id>   # Monitor child sessions
rdv notification list --unread         # Check for notifications
```

### 6. Coordinate with peer agents
```bash
rdv session title implement-auth-flow     # Name your session first
rdv peer list                             # See what other agents are working on
rdv peer send --broadcast "rebased on main, ready for integration"
rdv peer summary "finishing OAuth implementation, will push to main soon"
```
