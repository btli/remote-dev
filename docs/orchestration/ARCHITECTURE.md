# Remote Dev Orchestration Architecture

> Inspired by [Gastown](https://github.com/steveyegge/gastown), adapted for Remote Dev's terminal-first multi-agent system with **self-improvement capabilities**.

## Executive Summary

Remote Dev's orchestration system coordinates multiple AI agents (Claude, Codex, Gemini, OpenCode) working on software development tasks. It extends Gastown's patterns with:

1. **Two-level hierarchy**: Master Control (system-wide) + Folder Orchestrators (per-project)
2. **Self-improvement loop**: Transcript analysis → Learning extraction → Agent instrumentation
3. **Terminal-first design**: All agents run in isolated tmux sessions
4. **Beads integration**: `bd` as the primary work coordination interface

## Concept Mapping: Gastown → Remote Dev

| Gastown Concept | Remote Dev Equivalent | Notes |
|-----------------|----------------------|-------|
| **Town** | User workspace | All folders/projects for a user |
| **Mayor** | Master Control | System-wide orchestrator |
| **Witness** | Folder Orchestrator | Per-folder monitoring agent |
| **Polecats** | Task Sessions | Ephemeral agents for specific tasks |
| **Crew** | Named Sessions | Persistent human-supervised sessions |
| **Hooks** | Git worktrees + beads | Persistent work state |
| **Convoys** | Beads epics | Bundled related issues |
| **MEOW** | Task Lifecycle | Our orchestration workflow |
| **Deacon** | Monitoring Service | Background health monitoring |
| **Dogs** | Maintenance Workers | Infrastructure utilities |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MASTER CONTROL                               │
│  (One per user - system-wide orchestrator)                          │
│                                                                      │
│  Responsibilities:                                                   │
│  • Cross-project coordination                                        │
│  • Agent pool management                                             │
│  • Escalation handling                                               │
│  • Self-improvement coordination                                     │
│  • Transcript analysis pipeline                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│ FOLDER ORCHESTRATOR│ │ FOLDER ORCHESTRATOR│ │ FOLDER ORCHESTRATOR│
│   (Project A)      │ │   (Project B)      │ │   (Project C)      │
│                    │ │                    │ │                    │
│ • Task management  │ │ • Task management  │ │ • Task management  │
│ • Session monitoring│ │ • Session monitoring│ │ • Session monitoring│
│ • Stall detection  │ │ • Stall detection  │ │ • Stall detection  │
│ • Local learnings  │ │ • Local learnings  │ │ • Local learnings  │
└────────┬───────────┘ └────────┬───────────┘ └────────┬───────────┘
         │                      │                      │
    ┌────┴────┐            ┌────┴────┐            ┌────┴────┐
    ▼         ▼            ▼         ▼            ▼         ▼
┌───────┐ ┌───────┐    ┌───────┐ ┌───────┐    ┌───────┐ ┌───────┐
│Session│ │Session│    │Session│ │Session│    │Session│ │Session│
│(Claude)│ │(Codex)│    │(Claude)│ │(Gemini)│   │(Claude)│ │(OpenCode)│
└───────┘ └───────┘    └───────┘ └───────┘    └───────┘ └───────┘
```

## Core Components

### 1. Master Control (System-Level Orchestrator)

The Master Control is the central coordinator for all orchestration activities across a user's workspace.

**Responsibilities:**
- Cross-project task coordination
- Agent pool management (which agents are available)
- Escalation handling from Folder Orchestrators
- Self-improvement pipeline coordination
- Global project knowledge aggregation

**Implementation:**
- Runs in a dedicated tmux session: `rdv-master-{user_id}`
- Persists state in `~/.remote-dev/master-control/`
- Communicates via beads messages

### 2. Folder Orchestrator (Project-Level)

Each folder/project can have its own orchestrator for localized task management.

**Responsibilities:**
- Task parsing and execution within the folder
- Session monitoring and stall detection
- Local learning extraction from transcripts
- Escalation to Master Control when needed

**Implementation:**
- Runs in a dedicated tmux session: `rdv-folder-{folder_id}`
- Persists state in `{folder_path}/.remote-dev/orchestrator/`
- Project knowledge stored in `.remote-dev/knowledge/`

### 3. Task Sessions (Ephemeral Workers)

Similar to Gastown's Polecats, these are short-lived sessions spawned for specific tasks.

**Lifecycle:**
1. **Spawn**: Create worktree + tmux session
2. **Prime**: Inject context via `bd prime`
3. **Execute**: Run task with GUPP (execute immediately)
4. **Complete**: Signal completion, trigger analysis
5. **Cleanup**: Remove worktree, close session

### 4. Named Sessions (Persistent Workers)

Long-running sessions for human-supervised work.

**Characteristics:**
- Persistent identity (survives restarts)
- Full clone (not worktree)
- Manual work assignment

## The `rdv` CLI

The orchestration logic is implemented in Rust as the `rdv` (Remote Dev) CLI.

### Command Structure

```bash
# Master Control
rdv master start              # Start Master Control
rdv master stop               # Stop Master Control
rdv master status             # Show status
rdv master attach             # Attach to Master Control session

# Folder Orchestrators
rdv folder init [path]        # Initialize folder orchestrator
rdv folder start [path]       # Start folder orchestrator
rdv folder stop [path]        # Stop folder orchestrator
rdv folder status [path]      # Show folder status

# Task Management
rdv task create "<description>"  # Create task from natural language
rdv task plan <task_id>          # Generate execution plan
rdv task execute <task_id>       # Execute task
rdv task cancel <task_id>        # Cancel task
rdv task list                    # List tasks

# Session Management
rdv session spawn <folder> --agent <agent>  # Spawn task session
rdv session list                            # List sessions
rdv session attach <session_id>             # Attach to session
rdv session inject <session_id> "<context>" # Inject context
rdv session close <session_id>              # Close session

# Monitoring
rdv monitor start              # Start monitoring service
rdv monitor status             # Show monitoring status
rdv peek <session_id>          # Check session health

# Self-Improvement
rdv learn analyze <session_id>  # Analyze session transcript
rdv learn extract <folder>      # Extract learnings from folder
rdv learn apply <folder>        # Apply learnings to agent configs

# Communication (integrates with beads)
rdv mail inbox                  # Show messages
rdv mail send <target> "<msg>"  # Send message
rdv nudge <session_id> "<msg>"  # Real-time nudge

# Escalation
rdv escalate "<topic>"          # Escalate to Master Control
rdv escalate -s CRITICAL "<msg>" # Critical escalation
```

## Work Coordination: Beads Integration

We use `bd` (beads) as the primary work coordination interface, extending Gastown's pattern.

### Bead Types for Orchestration

| Type | Purpose |
|------|---------|
| `task` | Individual work items |
| `epic` | Grouped related tasks (convoy equivalent) |
| `message` | Inter-agent communication |
| `event` | State transitions (immutable audit) |
| `insight` | Generated insights from analysis |
| `learning` | Extracted learnings from transcripts |

### Task Lifecycle via Beads

```bash
# Create task
bd create --title="Implement user auth" --type=task --priority=2

# Assign to session (hook equivalent)
rdv task assign <task_id> <session_id>

# Execute with propulsion (GUPP)
# Agent discovers work via: bd ready
# Agent executes immediately
# Agent completes: bd close <task_id>

# Track convoy/epic
bd create --title="Auth Feature" --type=epic
bd dep add <task_id> <epic_id>
```

## Self-Improvement Loop

This is where Remote Dev extends beyond Gastown. After each task completion:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SELF-IMPROVEMENT LOOP                         │
└─────────────────────────────────────────────────────────────────┘

1. TASK COMPLETION
   └─→ Session ends (user close, agent done, timeout)

2. TRANSCRIPT CAPTURE
   └─→ Collect .jsonl conversation history
   └─→ Capture final scrollback state

3. ANALYSIS (via LLM)
   └─→ Success/failure determination
   └─→ Pattern extraction (what worked, what didn't)
   └─→ Convention detection (coding patterns used)
   └─→ Gotcha identification (common pitfalls)

4. LEARNING EXTRACTION
   └─→ Create `learning` beads
   └─→ Update ProjectKnowledge entity
   └─→ Store in LanceDB for retrieval

5. AGENT INSTRUMENTATION
   └─→ Update CLAUDE.md / AGENTS.md
   └─→ Generate new skills/plugins
   └─→ Create MCP tools
   └─→ Update agent configs

6. NEXT SESSION BENEFITS
   └─→ Learnings injected via `bd prime`
   └─→ Better context, fewer mistakes
```

### Learning Storage (LanceDB)

```
~/.remote-dev/knowledge/
├── embeddings.lance          # Vector embeddings
├── conventions.jsonl         # Coding conventions
├── patterns.jsonl            # Success/failure patterns
├── skills.jsonl              # Generated skills
└── tools.jsonl               # Generated MCP tools
```

## State Persistence

Following Gastown's "git as database" pattern:

### Master Control State
```
~/.remote-dev/master-control/
├── .beads/                   # Master-level beads (hq-* prefix)
├── config.toml               # Master configuration
├── agents.toml               # Available agent definitions
└── sessions.jsonl            # Active session tracking
```

### Folder Orchestrator State
```
{folder}/.remote-dev/
├── .beads/                   # Folder-level beads
├── orchestrator/
│   ├── config.toml           # Folder orchestrator config
│   └── state.json            # Current state
├── knowledge/
│   ├── conventions.jsonl     # Project conventions
│   ├── patterns.jsonl        # Learned patterns
│   └── skills/               # Project-specific skills
└── sessions/
    └── {session_id}.jsonl    # Session metadata
```

## Monitoring Architecture

Three-tier monitoring (adapted from Gastown):

```
┌─────────────────────────────────────────────────────────────────┐
│ TIER 1: MECHANICAL DAEMON (Go/Rust process)                     │
│ • Runs every 30 seconds                                         │
│ • Checks tmux session existence                                 │
│ • Checks heartbeat file timestamps                              │
│ • No AI, pure mechanical checks                                 │
└───────────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ TIER 2: LIGHTWEIGHT TRIAGE (Short-lived AI)                     │
│ • Spawned by daemon when anomaly detected                       │
│ • Binary decision: wake orchestrator or not                     │
│ • Exits immediately after deciding                              │
│ • Minimal token usage                                           │
└───────────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ TIER 3: ORCHESTRATOR (Long-running AI)                          │
│ • Master Control or Folder Orchestrator                         │
│ • Full analysis and decision making                             │
│ • Intervention execution                                        │
│ • Self-healing mechanisms                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Stall Detection

```rust
// Pseudocode for stall detection
fn check_session_health(session: &Session) -> HealthStatus {
    let scrollback = capture_tmux_pane(session.tmux_name);
    let hash = md5(scrollback);

    if hash == session.last_hash {
        let stall_duration = now() - session.last_change;
        if stall_duration > STALL_THRESHOLD {
            return HealthStatus::Stalled {
                duration: stall_duration,
                confidence: calculate_confidence(stall_duration),
            };
        }
    }

    session.last_hash = hash;
    session.last_change = now();
    HealthStatus::Healthy
}
```

## Communication Protocol

### Message Types

| Message | Sender | Receiver | Purpose |
|---------|--------|----------|---------|
| `TASK_ASSIGNED` | Orchestrator | Session | Work assignment |
| `TASK_COMPLETE` | Session | Orchestrator | Completion signal |
| `TASK_FAILED` | Session | Orchestrator | Failure signal |
| `STALL_DETECTED` | Monitor | Orchestrator | Stall alert |
| `INTERVENTION` | Orchestrator | Session | Recovery command |
| `ESCALATE` | Folder Orch | Master Control | Need help |
| `LEARNING_READY` | Analyzer | Orchestrator | Transcript analyzed |
| `NUDGE` | Any | Session | Real-time message |

### Message Delivery

```bash
# Via beads
bd create --type=message --title="TASK_COMPLETE" --body="..."

# Real-time nudge (tmux send-keys)
rdv nudge <session_id> "Please complete step 3"
```

## Integration with Existing Remote Dev

### API Integration

The `rdv` CLI communicates with the Next.js backend via REST API:

```
POST /api/orchestrators           # Create orchestrator
GET  /api/orchestrators/:id       # Get orchestrator
POST /api/orchestrators/:id/tasks # Create task
POST /api/sessions                # Spawn session
GET  /api/sessions/:id/scrollback # Get scrollback
POST /api/sessions/:id/inject     # Inject context
```

### Database Schema

New tables for orchestration:

```sql
-- Tasks table
CREATE TABLE orchestrator_tasks (
  id TEXT PRIMARY KEY,
  orchestrator_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  assigned_agent TEXT,
  delegation_id TEXT,
  beads_issue_id TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Delegations table
CREATE TABLE orchestrator_delegations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  worktree_id TEXT,
  agent_provider TEXT NOT NULL,
  status TEXT NOT NULL,
  context_injected TEXT,
  transcript_path TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Project Knowledge table
CREATE TABLE project_knowledge (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tech_stack TEXT, -- JSON array
  conventions TEXT, -- JSON array
  patterns TEXT, -- JSON array
  skills TEXT, -- JSON array
  tools TEXT, -- JSON array
  last_scanned_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Learnings table
CREATE TABLE orchestrator_learnings (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT NOT NULL, -- 'convention', 'pattern', 'skill', 'tool'
  content TEXT NOT NULL, -- JSON
  confidence REAL,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP
);
```

## Implementation Phases

### Phase 1: Core Infrastructure (Rust CLI)
- [ ] Create `rdv` Rust project structure
- [ ] Implement CLI argument parsing (clap)
- [ ] Implement config management
- [ ] Implement tmux integration

### Phase 2: Master Control
- [ ] Implement Master Control lifecycle
- [ ] Implement session management
- [ ] Implement basic monitoring

### Phase 3: Folder Orchestrators
- [ ] Implement Folder Orchestrator lifecycle
- [ ] Implement task management
- [ ] Implement stall detection

### Phase 4: Beads Integration
- [ ] Implement beads message types
- [ ] Implement work assignment flow
- [ ] Implement convoy/epic tracking

### Phase 5: Self-Improvement
- [ ] Implement transcript analysis
- [ ] Implement learning extraction
- [ ] Implement agent instrumentation
- [ ] Implement LanceDB storage

### Phase 6: Frontend Integration
- [ ] API endpoints for orchestration
- [ ] UI components for orchestrator management
- [ ] Real-time status updates

## Security Considerations

- Command injection prevention (validated input)
- Dangerous command filtering (rm -rf, etc.)
- Rate limiting for interventions
- Audit logging for all orchestrator actions
- Session isolation via worktrees

## References

- [Gastown Repository](https://github.com/steveyegge/gastown)
- [Beads Documentation](https://github.com/steveyegge/beads)
- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code)
