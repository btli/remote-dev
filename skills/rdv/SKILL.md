---
name: rdv
description: Remote Dev CLI for managing terminal sessions, worktrees, agents, teams, tasks, and more. Use when you need to interact with Remote Dev.
---

# Remote Dev CLI (`rdv`)

You are running inside a Remote Dev terminal session. Use the `rdv` CLI to interact with the system.

All commands output JSON by default. Add `--human` for human-readable tables. Use `rdv --help` or `rdv <command> --help` for full usage details.

---

## 1. Getting Started

Discover your session context first:

```bash
rdv context                    # Show session ID, folder, project path, tmux name
rdv status --human             # System dashboard: sessions, tasks, deploy info
```

**Key environment variables** (set automatically in agent sessions):
- `RDV_SESSION_ID` -- Your session UUID
- `RDV_TERMINAL_PORT` -- Terminal server port (dev, default 6002)
- `RDV_API_PORT` -- API server port (default 6001)
- `RDV_API_KEY` -- Bearer token for API authentication

---

## 2. Session Management

```bash
rdv session list                                          # List all sessions
rdv session create --name "my-session" --folder-id <id>   # Create a new session
rdv session create --working-dir /path --type agent       # Create with type
rdv session exec <session-id> "echo hello"                # Execute command (fire-and-forget)
rdv session suspend <session-id>                          # Suspend a session
rdv session resume <session-id>                           # Resume a suspended session
rdv session close <session-id>                            # Close (delete) a session
rdv session git-status <session-id>                       # Get git status for session
```

### Session Naming

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

---

## 3. Agent & Team Orchestration

### Agent Sessions

**IMPORTANT: Always use worktrees when spawning subagents or working in agent teams.** Worktrees provide branch isolation that prevents merge conflicts between parallel agents working on the same codebase.

```bash
rdv agent start <folder-id>                        # Start agent in folder (uses folder's provider)
rdv agent start <folder-id> --worktree feature/x   # Start agent with worktree isolation
rdv agent list                                     # List active agent sessions
rdv agent stop <session-id>                        # Stop (suspend) an agent session
```

### Team Orchestration

Launch and manage coordinated multi-agent sessions:

```bash
# Launch multiple agent sessions
rdv teams launch --folder-id <id> --count 3 --provider claude --name-prefix "worker"

# List sessions grouped by parent
rdv teams list --parent-id <parent-session-id>

# Wait for all child sessions to complete (polls every 2s)
rdv teams wait <parent-session-id> --timeout 300

# Broadcast text to all child sessions
rdv teams broadcast <parent-session-id> "Please wrap up your current task"
```

---

## 4. Worktree Management

Create isolated git worktrees for branch work:

```bash
rdv worktree create --repo /path/to/repo --branch feature/my-branch
rdv worktree list --repo /path/to/repo
rdv worktree remove --worktree-path /path/to/wt --project-path /path/to/repo [--force]

# Full cleanup: verify merge, remove worktree, delete branches, close session
# Works even when CWD is inside the worktree. Requires RDV_SESSION_ID.
rdv worktree cleanup [--force]
```

### Cleanup Flow

When done with a worktree (commits pushed, PR merged):

1. Verifies branch is merged into main/master (use `--force` to skip)
2. Removes worktree directory (server-side, CWD-safe)
3. Deletes local and remote branch
4. Closes the tmux session

```bash
rdv worktree cleanup           # Safe cleanup (checks merge status)
rdv worktree cleanup --force   # Force cleanup (skip merge check)
```

---

## 5. Task Management

```bash
rdv task list                                         # List tasks for current session
rdv task create "Implement auth" --priority high      # Create a task
rdv task create "Fix bug" --description "Details..."  # Create with description
rdv task update <id> --status in_progress             # Update status (todo/in_progress/done/cancelled)
rdv task update <id> --title "New title"              # Update title
rdv task update <id> --priority urgent                # Update priority (low/medium/high/urgent)
rdv task complete <id>                                # Mark task as done
rdv task check                                        # Check incomplete tasks (used by stop hook)
rdv task sync                                         # Sync PostToolUse JSON from stdin
```

---

## 6. Peer Communication

Communicate with other agents in the same project folder:

```bash
rdv peer list                                    # List peer agents in same folder
rdv peer send "I finished the API layer" --to <session-id>   # Direct message
rdv peer send "Starting integration tests"       # Broadcast to all peers
rdv peer messages                                # Check for new messages
rdv peer messages --since "2025-01-01T00:00:00Z" # Messages since timestamp
rdv peer summary "Working on auth module"        # Set work summary visible to peers
```

---

## 7. Browser Automation

Control headless browser sessions:

```bash
rdv browser navigate <session-id> https://example.com
rdv browser screenshot <session-id> --output ./screenshot.png
rdv browser snapshot <session-id>                     # Accessibility snapshot
rdv browser click <session-id> 100 200                # Click at (x, y)
rdv browser type <session-id> "hello" --selector "#input"
rdv browser evaluate <session-id> "document.title"
rdv browser back <session-id>
rdv browser forward <session-id>
```

---

## 8. Terminal I/O

### Send Text & Keystrokes

```bash
rdv send text <session-id> "ls -la"              # Send text to session PTY
rdv send key <session-id> Enter                   # Send keystroke (Enter, C-c, Tab, Escape, Up, Down, etc.)
rdv send key <session-id> C-c                     # Send Ctrl+C
```

### Capture Screen

```bash
rdv screen <session-id>                           # Capture terminal screen content (JSON)
rdv screen <session-id> --human                   # Print screen content as plain text
```

### tmux Compatibility Layer

Drop-in replacement for common tmux commands, routing through rdv when targeting rdv sessions:

```bash
rdv tmux send-keys -t <target> "text" Enter       # Send keys (routes via rdv for rdv-* targets)
rdv tmux capture-pane -t <target> -p               # Capture pane output
rdv tmux <any-other-command>                       # Passes through to real tmux
```

---

## 9. Session UI (Status, Progress, Log)

### Status Indicators

Set custom status badges on sessions visible in the UI:

```bash
rdv set-status <session-id> <key> <value> [--icon bolt.fill] [--color "#4C8DFF"]
rdv clear-status <session-id> <key>
```

### Progress Bar

```bash
rdv set-progress <session-id> 0.5 --label "Building..."   # Set progress (0.0 to 1.0)
rdv clear-progress <session-id>                            # Clear progress bar
```

### Session Log

Write structured log entries for a session:

```bash
rdv log <session-id> "Deployment complete" --level info --source deploy
rdv log <session-id> "Build failed" --level error
```

Log levels: `debug`, `info` (default), `warn`, `error`.

---

## 10. Notifications

```bash
rdv notification list --unread                    # List unread notifications
rdv notification list --limit 10                  # List recent (max 10)
rdv notification read <id1> <id2>                 # Mark specific as read
rdv notification read --all                       # Mark all as read
rdv notification delete <id1> <id2>               # Delete specific
rdv notification delete --all                     # Delete all
```

---

## 11. System & Folders

### Folders

```bash
rdv folder list                                   # List all folders (with IDs)
```

### System Updates

```bash
rdv system update                                 # Show update status
rdv system update check                           # Check GitHub for new release
rdv system update apply                           # Download and apply update (restarts service)
```

---

## 12. Lifecycle Hooks

Commands designed for Claude Code hook integration (usually called automatically):

```bash
# Individual hook handlers
rdv hook pre-tool-use        # Report "running", check peer messages, auto-title, git identity guard
rdv hook post-tool-use       # Sync task/todo data from stdin
rdv hook pre-compact         # Report "compacting" status
rdv hook notification        # Report "waiting" status
rdv hook stop                # Report idle, check tasks, create notification
rdv hook notify <event>      # Send notification (e.g. task_complete, error)
rdv hook session-end         # Report "ended" status
rdv hook validate            # Validate hook connectivity + auto-repair

# Unified Claude Code handler (recommended for hooks.json)
rdv hook claude <event>      # Events: active, stop, notification, compacting,
                             #         post-tool-use, session-end
```

---

## 13. Common Workflows

### Discover context and start working
```bash
rdv context                    # Learn your session info
rdv task list                  # Check existing tasks
```

### Start a parallel agent for a subtask
```bash
rdv agent start <folder-id> --worktree feature/subtask
```

### Orchestrate a team of agents
```bash
rdv teams launch --folder-id <id> --count 3 --provider claude --name-prefix "worker"
rdv teams wait <my-session-id> --timeout 600
rdv teams broadcast <my-session-id> "Time to wrap up"
```

### Create isolated work with worktrees
```bash
rdv worktree create --repo . --branch feature/experiment
rdv session create --name "experiment" --working-dir /path/to/worktree
```

### Complete worktree work and clean up
```bash
git add . && git commit -m "feat: my changes"
git push origin feature/my-branch
gh pr create --fill && gh pr merge --auto
rdv worktree cleanup              # Remove worktree, branches, close session
```

### Coordinate with peer agents
```bash
rdv peer list                                    # See who else is working
rdv peer send "I'm done with the API" --to <id> # Notify a specific peer
rdv peer send "Starting deploy"                  # Broadcast to all
```

### Monitor and interact with other sessions
```bash
rdv screen <session-id> --human          # See what another session is doing
rdv send text <session-id> "ls -la"      # Send a command to it
rdv send key <session-id> Enter          # Press Enter
```

### 6. Coordinate with peer agents
```bash
rdv session title implement-auth-flow     # Name your session first
rdv peer list                             # See what other agents are working on
rdv peer send --broadcast "rebased on main, ready for integration"
rdv peer summary "finishing OAuth implementation, will push to main soon"
```
