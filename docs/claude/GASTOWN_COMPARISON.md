# Gastown vs Remote Dev: Feature Comparison

**Date:** 2025-01-09
**Purpose:** Document feature gaps between Gastown and Remote Dev orchestration systems

## Overview

| Aspect | Gastown | Remote Dev |
|--------|---------|------------|
| **Primary Language** | Go (98.7%) | TypeScript/Rust |
| **Architecture** | CLI-first with web dashboard | Web-first with CLI companion |
| **Agent Support** | Claude, Codex, Gemini, Cursor | Claude, Codex, Gemini, OpenCode |
| **Persistence** | Git worktrees + Beads | SQLite + tmux + Beads |
| **Orchestration Model** | Mayor (single coordinator) | Master + Folder Orchestrators (hierarchical) |

## Feature-by-Feature Comparison

### 1. Agent Orchestration Model

| Feature | Gastown | Remote Dev | Gap |
|---------|---------|------------|-----|
| Coordinator agent | Mayor (single) | Master Control + Folder Controls | **Remote Dev has hierarchical model** |
| Worker agents | Polecats (ephemeral) | Task sessions (persistent) | Different philosophy |
| Work persistence | Git hooks (worktrees) | tmux sessions + SQLite | Both persist, different mechanisms |
| Agent spawning | `gt sling` | `rdv session spawn` | Equivalent |
| Agent communication | Mail via hooks | Mail via beads + nudge | **Remote Dev has real-time nudge** |

**Gap Analysis:** Remote Dev's hierarchical model (Master → Folder → Task) is more sophisticated than Gastown's flat Mayor model. However, Gastown's hook-based persistence is more elegant for git-centric workflows.

### 2. Work Tracking

| Feature | Gastown | Remote Dev | Gap |
|---------|---------|------------|-----|
| Issue tracking | Beads (native) | Beads (integration) | Equivalent |
| Work bundles | Convoys | Folders | Similar concept |
| Progress visibility | Convoy status | Orchestrator insights | **Remote Dev has ML-based insights** |
| Stall detection | Manual convoy refresh | Automated MD5 hash monitoring | **Remote Dev is automated** |

**Gap Analysis:** Remote Dev's automated stall detection with confidence scoring is more advanced. Gastown requires manual intervention.

### 3. Learning & Self-Improvement

| Feature | Gastown | Remote Dev | Gap |
|---------|---------|------------|-----|
| Knowledge extraction | None | `rdv learn analyze` | **Remote Dev has this** |
| Pattern storage | None | ProjectKnowledge entity | **Remote Dev has this** |
| Convention tracking | None | Per-folder conventions | **Remote Dev has this** |
| Tech stack detection | None | Automatic detection | **Remote Dev has this** |
| Skill library | None | Skill definitions with steps | **Remote Dev has this** |
| Agent performance metrics | None | Per-task-type tracking | **Remote Dev has this** |
| Formula system | `bd formula` + `bd cook` | None | **Gastown has this** |

**Gap Analysis:** Remote Dev has a significantly more sophisticated learning system. However, Gastown's Formula system for repeatable workflows is missing from Remote Dev.

### 4. UI/Dashboard

| Feature | Gastown | Remote Dev | Gap |
|---------|---------|------------|-----|
| Web dashboard | `gt dashboard --port 8080` | Full Next.js web app | **Remote Dev is more complete** |
| Terminal interface | External terminal | Built-in xterm.js | **Remote Dev is integrated** |
| Real-time updates | WebSocket | WebSocket | Equivalent |
| Split panes | External (tmux) | Built-in | **Remote Dev is integrated** |
| Mobile support | None | Responsive + keyboard | **Remote Dev has this** |
| Recordings | None | Session recording/playback | **Remote Dev has this** |

**Gap Analysis:** Remote Dev's UI is significantly more sophisticated with full terminal integration, mobile support, and recording capabilities.

### 5. CLI Commands

| Category | Gastown | Remote Dev |
|----------|---------|------------|
| **Workspace** | `gt install`, `gt rig add` | N/A (web-based) |
| **Projects** | `gt rig list/add` | `rdv folder init/start/stop` |
| **Agents** | `gt mayor attach`, `gt sling` | `rdv master start`, `rdv session spawn` |
| **Work** | `gt convoy create/list/show` | `rdv task create/list` |
| **Communication** | (via hooks) | `rdv mail inbox/send` |
| **Escalation** | (manual) | `rdv escalate --severity` |
| **Learning** | None | `rdv learn analyze/extract/apply` |
| **Diagnostics** | `gt hooks list/repair` | `rdv doctor`, `rdv peek`, `rdv status` |

### 6. Persistence Architecture

| Aspect | Gastown | Remote Dev |
|--------|---------|------------|
| Primary storage | Git worktrees | SQLite database |
| Session state | Hook files | `terminal_session` table |
| Work items | Beads ledger | Beads + `orchestrator_insight` |
| Configuration | `settings/config.json` | `.remote-dev/` + preferences |
| Rollback | Git history | SQLite + git |

### 7. Multi-Runtime Support

| Runtime | Gastown | Remote Dev |
|---------|---------|------------|
| Claude Code | Yes | Yes |
| Codex | Yes | Yes |
| Gemini | Yes | Yes |
| Cursor | Yes | No |
| OpenCode | No | Yes |

## Critical Gaps in Remote Dev

### 1. Formula System (HIGH PRIORITY)

Gastown's `bd formula` system provides repeatable workflows:
```bash
bd formula list           # List available formulas
bd cook release --var version=1.2.0  # Execute formula
```

**What's Missing:**
- No template/recipe system for common workflows
- No parameterized workflow execution
- No `cook` equivalent for executing predefined sequences

**Recommendation:** Create a `rdv formula` or `rdv recipe` system.

### 2. Convoy Concept (MEDIUM PRIORITY)

Gastown bundles work into "convoys" for visibility:
```bash
gt convoy create "Bug Fixes" --human
gt convoy add-issue convoy-123 issue-456
gt convoy show convoy-123
```

**What's Missing:**
- No explicit work bundling mechanism
- Folders approximate this but aren't workflow-focused
- No convoy-style progress tracking

**Recommendation:** Add `rdv convoy` or enhance task grouping.

### 3. Hook Lifecycle (LOW PRIORITY)

Gastown tracks hooks through: Created → Active → Suspended → Completed → Archived

**What's Missing:**
- Remote Dev sessions don't have explicit lifecycle states
- No "suspended but resumable" state in UI
- Archive functionality is via trash, not explicit state

**Current State:** Remote Dev has `active`, `suspended`, `closed` but less granular.

## Critical Gaps in Learning System Integration

### Problem: Learning System is Disconnected from UI

The learning system has a complete backend but **no UI integration**:

| Layer | Status | Issue |
|-------|--------|-------|
| Domain Entity | Complete | - |
| Service Layer | Complete | - |
| API Routes | Complete | - |
| React Hook | Complete | - |
| UI Component | Exists | **Not accessible from main UI** |
| Task Integration | Missing | **No automatic learning trigger** |
| CLI Commands | Documented | **Not implemented** |

### Specific Issues

1. **No Navigation to Knowledge Panel**
   - `ProjectKnowledgePanel.tsx` exists
   - Not reachable from sidebar, settings, or any menu
   - User cannot access their project knowledge

2. **No Automatic Learning Trigger**
   - `updateFromTaskAnalysis()` exists in service
   - Never called after task completion
   - Session analysis services exist but not wired

3. **No Learning Notifications**
   - When knowledge is extracted, no toast/notification
   - User unaware that learning occurred

4. **No Knowledge CRUD UI**
   - Can display knowledge but cannot:
     - Add new conventions manually
     - Edit existing patterns
     - Verify skills
     - Delete outdated knowledge

5. **No Search Interface**
   - `search()` function in hook exists
   - No search input in UI

6. **CLI Commands Not Implemented**
   - `rdv learn analyze` - documented but not working
   - `rdv learn extract` - documented but not working
   - `rdv learn apply` - documented but not working

## Recommendations

### Immediate Actions (Week 1)

1. **Expose ProjectKnowledgePanel in UI**
   - Add to folder context menu in sidebar
   - Add "Knowledge" tab to folder preferences modal
   - Add route `/folders/[id]/knowledge`

2. **Wire Task Analysis → Learning**
   - In session close handler, call `updateFromTaskAnalysis()`
   - Show toast: "Learned 3 new patterns from session"

3. **Add Knowledge Notifications**
   - Toast on new learning extracted
   - Badge on sidebar for new knowledge

### Short-term Actions (Week 2-3)

4. **Implement Knowledge Management UI**
   - Add convention dialog
   - Edit pattern modal
   - Verify skill button
   - Delete with confirmation

5. **Add Search to Knowledge Panel**
   - Search input at top
   - Filter by type/category
   - Semantic search toggle

6. **Implement rdv learn CLI commands**
   - `rdv learn analyze` - call TranscriptEvaluatorService
   - `rdv learn extract` - batch process folder transcripts
   - `rdv learn apply` - update CLAUDE.md from knowledge

### Medium-term Actions (Week 4-6)

7. **Add Formula/Recipe System**
   - `rdv recipe create "deploy" --steps "..."`
   - `rdv recipe run deploy --var env=staging`
   - UI for recipe management

8. **Add Convoy-like Work Bundling**
   - Group tasks into "sprints" or "batches"
   - Progress tracking at batch level
   - Dashboard for batch status

9. **Knowledge Sharing Across Folders**
   - Global skill library
   - Copy convention to other folders
   - "Core conventions" that apply everywhere

## Architecture Comparison Diagram

```
GASTOWN                          REMOTE DEV
========                         ==========

   User                             User
     │                                │
     ▼                                ▼
  [Mayor]                      [Master Control]
     │                           /    │    \
     │                          /     │     \
     ▼                         ▼      ▼      ▼
 [Polecats]               [Folder] [Folder] [Folder]
   │ │ │                      │       │       │
   │ │ │                      ▼       ▼       ▼
   ▼ ▼ ▼                  [Tasks] [Tasks] [Tasks]
 [Hooks]                      │       │       │
     │                        ▼       ▼       ▼
     ▼                     [Sessions in tmux]
 [Git Worktrees]                    │
     │                              ▼
     ▼                          [SQLite]
  [Beads]                           │
                                    ▼
                                 [Beads]
```

## Remote Dev Architectural Vision

Remote Dev intentionally differs from Gastown in key ways:

### rdv-First Architecture

Unlike Gastown where Claude Code instances are spawned directly, Remote Dev uses **rdv as the primary session orchestrator**:

```
┌─────────────────────────────────────────────────────────────────┐
│                       MASTER CONTROL                             │
│  (rdv instance - system-wide learning, global coordination)     │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ FOLDER ORCH     │  │ FOLDER ORCH     │  │ FOLDER ORCH     │
│ (rdv instance)  │  │ (rdv instance)  │  │ (rdv instance)  │
│ Project A       │  │ Project B       │  │ Project C       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                   │                   │
    ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
    ▼           ▼       ▼           ▼       ▼           ▼
┌───────┐   ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│ rdv   │   │ rdv   │ │ rdv   │ │ rdv   │ │ rdv   │ │ rdv   │
│ task  │   │ task  │ │ task  │ │ task  │ │ task  │ │ task  │
└───────┘   └───────┘ └───────┘ └───────┘ └───────┘ └───────┘
    │           │         │         │         │         │
    ▼           ▼         ▼         ▼         ▼         ▼
┌───────┐   ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│Claude │   │Codex  │ │Claude │ │Gemini │ │Claude │ │OpenCd │
│(child)│   │(child)│ │(child)│ │(child)│ │(child)│ │(child)│
└───────┘   └───────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

### Key Differences from Gastown

| Aspect | Gastown | Remote Dev Vision |
|--------|---------|-------------------|
| Primary process | Claude Code | rdv (Rust binary) |
| Coding agents | Direct spawns | Child processes of rdv |
| Orchestrators | Mayor only | Master + Folder + Task |
| Learning | None | Per-orchestrator + global |
| Monitoring | Manual convoy refresh | Automated rdv monitoring |
| Session context | Hook files | RDV_* environment variables |

### rdv Session Environment

Every rdv session should set and expose:

```bash
# Core identity
RDV_SESSION_ID=rdv-task-abc123
RDV_SESSION_TYPE=task|folder|master
RDV_ORCHESTRATOR_ID=orch-xyz789

# Project context
RDV_PROJECT_NAME=remote-dev
RDV_PROJECT_PATH=/Users/bryan/Projects/btli/remote-dev
RDV_FOLDER_ID=folder-123

# Git context
RDV_WORKTREE_PATH=/Users/bryan/.rdv/worktrees/remote-dev-feature-x
RDV_BRANCH=feature/learning-integration
RDV_BASE_BRANCH=master

# Agent context
RDV_AGENT_PROVIDER=claude|codex|gemini|opencode
RDV_AGENT_PID=12345
```

### rdv Responsibilities

Each rdv instance handles:

1. **Monitoring** - Stall detection, health checks
2. **Learning** - Extract knowledge from child agent sessions
3. **Communication** - Mail, escalation, nudge
4. **Process Management** - Spawn/manage child coding agents
5. **Context Injection** - Pass RDV_* vars to child processes
6. **UI Integration** - Report status to web dashboard

### Child Agent Lifecycle

```
rdv task spawn
  │
  ├─► Set RDV_* environment variables
  ├─► Create tmux session
  ├─► Start monitoring loop
  │
  └─► Spawn coding agent as child process
        │
        ├─► Agent receives RDV_* context
        ├─► Agent works on task
        ├─► rdv monitors scrollback
        │
        └─► On completion:
              ├─► rdv captures transcript
              ├─► rdv extracts learnings
              ├─► rdv reports to orchestrator
              └─► rdv cleans up
```

### UI Visibility Requirements

The web UI should display for each session:

- Session type (master/folder/task)
- Project name and path
- Worktree (if applicable)
- Current branch
- Agent provider
- Agent process status (running/stalled/complete)
- Learning count (new learnings from this session)
- Orchestrator hierarchy

## Conclusion

Remote Dev has significant advantages in:
- Hierarchical orchestration (Master → Folder → Task)
- Automated stall detection with ML insights
- Sophisticated learning/knowledge system (backend)
- Integrated web terminal with recording
- Mobile support

Remote Dev needs work on:
- **Learning UI integration** (critical - backend exists, UI disconnected)
- **rdv-first architecture** (rdv as orchestrator, agents as children)
- **Session context (RDV_* vars)** for full project/git visibility
- Formula/recipe system for repeatable workflows
- Convoy-like work bundling
- CLI command implementation

Gastown has advantages in:
- Git-centric workflow (hooks in worktrees)
- Formula system for repeatable workflows
- Convoy work bundling
- Simpler mental model (Mayor + Polecats)

Sources:
- [Gastown GitHub](https://github.com/steveyegge/gastown)
- [Steve Yegge's Gas Town Introduction](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04)
