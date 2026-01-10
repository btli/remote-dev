# rdv - Remote Dev Orchestration Skill

Use this skill when working in a session managed by Remote Dev's multi-agent orchestration system. This skill provides commands for inter-agent communication, escalation, and self-improvement.

## Context Detection

You are likely in an rdv-managed session if:
- Your tmux session name starts with `rdv-` (check with `echo $TMUX`)
- There's a `.remote-dev/` directory in the project root
- Environment variable `RDV_IDENTITY` is set

## Quick Reference

### Session Management
```bash
# Check your session
rdv peek $(tmux display-message -p '#S')

# View all sessions
rdv session list

# Get scrollback from another session
rdv session scrollback <session-id> --lines 100
```

### Inter-Agent Communication
```bash
# Check inbox
rdv mail inbox --unread

# Read a message
rdv mail read <message-id>

# Send message to Master Control
rdv mail send master "Status Update" "Work completed on feature X"

# Send message to folder orchestrator
rdv mail send folder:myproject "Question" "Need clarification on API design"

# Send message to specific session
rdv mail send session:rdv-task-abc123 "Info" "FYI - found a related bug"
```

### Escalation (to Master Control)
```bash
# Critical escalation
rdv escalate --severity CRITICAL --topic "Production issue" --message "Database connection failing"

# High priority
rdv escalate --severity HIGH --topic "Blocked on dependency" --issue beads-abc123

# Normal escalation
rdv escalate --severity MEDIUM --topic "Design decision needed"
```

### Self-Improvement
```bash
# Analyze your session for learnings
rdv learn analyze $(tmux display-message -p '#S') --save

# Extract learnings from all transcripts
rdv learn extract .

# Apply learnings to CLAUDE.md
rdv learn apply . --dry-run  # Preview
rdv learn apply .             # Apply

# View project knowledge
rdv learn show .
```

## When to Escalate

**CRITICAL** - Use when:
- Security vulnerability discovered
- Production system affected
- Data loss risk
- Blocking multiple agents

**HIGH** - Use when:
- Blocked on external dependency
- Need human decision for architecture
- Conflicting instructions from different sources
- Resource conflicts with other agents

**MEDIUM** - Use when:
- Design clarification needed
- Non-urgent questions
- Status updates for long-running tasks

**LOW** - Use when:
- FYI notifications
- Documentation updates
- Non-blocking information sharing

## Communication Patterns

### Reporting Progress to Master Control
```bash
rdv mail send master "Progress: Feature X" "Completed 3 of 5 tasks. ETA 30 min for remaining work."
```

### Requesting Help from Folder Orchestrator
```bash
rdv mail send folder:myproject "Help Needed" "Getting test failures in auth module. Tried X and Y. Need guidance."
```

### Coordinating with Other Sessions
```bash
# Check if another session exists
rdv peek rdv-task-other

# Send coordination message
rdv mail send session:rdv-task-other "Sync Request" "About to modify shared module X. Please hold changes."
```

## Learning Types

When analyzing sessions, learnings are categorized as:

| Type | Description | Example |
|------|-------------|---------|
| `convention` | Code style decisions | "Always use absolute imports" |
| `pattern` | Reusable solutions | "Error handling pattern for API routes" |
| `skill` | Verified code snippets | "Validated tmux session creation code" |
| `tool` | Automation scripts | "Pre-commit hook for linting" |
| `gotcha` | Things that broke | "Node 18 required for node-pty" |

## Beads Integration

Messages and escalations use [beads](https://github.com/steveyegge/beads) for persistence:

```bash
# View all escalations
bd list --type=escalation

# View all messages
bd list --type=message

# Check related work
bd show <beads-id>
```

## Best Practices

1. **Check messages regularly** - Run `rdv mail inbox --unread` at session start and periodically
2. **Escalate early** - Don't spin on problems; escalate after 2-3 attempts
3. **Save learnings** - Use `--save` flag when analyzing sessions
4. **Coordinate changes** - Notify other sessions before modifying shared code
5. **Report completion** - Send status to Master Control when done

## Diagnostics

```bash
# Full system check
rdv doctor

# System status
rdv status

# Check specific session health
rdv peek <session-id>
```
