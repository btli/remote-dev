# Orchestrator-as-Agent Architecture

## Overview

The orchestrator is a **real Claude Code session** that monitors and coordinates other agent sessions. It has full project knowledge, MCP tools for session control, and event-driven activation.

## Key Principles

1. **Orchestrator IS an Agent** - Not a passive monitor, but an intelligent Claude Code session
2. **Project Knowledge Loaded** - Full context from ProjectKnowledge entity
3. **MCP Tools Available** - Can introspect and control other sessions
4. **Event-Driven** - Wakes on events, not polling
5. **Hierarchical** - Master Control → Folder Control → Agent Sessions

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Master Control                            │
│  (Claude Code session with global project knowledge)            │
│  - Monitors all folders                                          │
│  - Escalation target for folder controls                        │
│  - Can spawn new folder controls                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Events (heartbeat, stall, error)
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Folder Control  │ │ Folder Control  │ │ Folder Control  │
│ (remote-dev)    │ │ (my-app)        │ │ (api-server)    │
│                 │ │                 │ │                 │
│ Claude Code w/  │ │ Claude Code w/  │ │ Claude Code w/  │
│ folder-specific │ │ folder-specific │ │ folder-specific │
│ project knowl.  │ │ project knowl.  │ │ project knowl.  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
    ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
    ▼         ▼         ▼         ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│Session│ │Session│ │Session│ │Session│ │Session│ │Session│
│Claude │ │Codex  │ │Gemini │ │Claude │ │Claude │ │Codex  │
└───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

## Components

### 1. OrchestratorBootstrapService

Creates and initializes orchestrator Claude Code sessions.

```typescript
interface OrchestratorBootstrapService {
  // Create Master Control for a user
  bootstrapMasterControl(userId: string): Promise<{
    orchestratorId: string;
    sessionId: string;
    tmuxSessionName: string;
  }>;

  // Create Folder Control for a specific folder
  bootstrapFolderControl(
    userId: string,
    folderId: string,
    projectPath: string
  ): Promise<{
    orchestratorId: string;
    sessionId: string;
    tmuxSessionName: string;
  }>;

  // Wake up a dormant orchestrator
  wakeOrchestrator(orchestratorId: string): Promise<void>;
}
```

### 2. OrchestratorInstructionGenerator

Generates the CLAUDE.md for orchestrator sessions.

```typescript
interface OrchestratorInstructionGenerator {
  // Generate full CLAUDE.md content for orchestrator
  generateInstructions(params: {
    type: 'master' | 'folder';
    projectKnowledge?: ProjectKnowledge;
    folderName?: string;
    availableTools: string[];  // MCP tool names
    customInstructions?: string;
  }): string;
}
```

**Generated CLAUDE.md Structure:**

```markdown
# Orchestrator Instructions

You are the **{Folder Name} Control** orchestrator for Remote Dev.
Your role is to monitor agent sessions, detect issues, and coordinate work.

## Your Capabilities

### MCP Tools Available
- `session_list` - List all sessions in your scope
- `session_analyze` - Analyze session scrollback
- `session_send_input` - Inject commands to unstuck agents
- `session_get_insights` - Get insights for sessions
- `project_metadata_detect` - Understand project stack

### Project Knowledge
{Injected from ProjectKnowledge entity}

## Your Duties

1. **Monitor Sessions** - Watch for stalled or erroring agents
2. **Provide Context** - When agents ask, provide project knowledge
3. **Coordinate Work** - Suggest task delegation between agents
4. **Intervene When Needed** - Unstick stalled agents with hints

## Event Handling

When you receive an event notification:
- `task_complete` - Agent finished, check if related work exists
- `stalled` - Analyze session, provide hints or escalate
- `error` - Capture error, suggest fixes, log insight

## Do NOT

- Take over agent work (only guide/hint)
- Make destructive changes without confirmation
- Ignore security warnings
```

### 3. Event-Driven Activation

Orchestrators wake on events, not polling.

**Event Flow:**
```
Agent Hook (SessionSubmit)
  → POST /api/orchestrators/agent-event
  → Find responsible orchestrator (folder or master)
  → Wake orchestrator if dormant
  → Inject event notification to orchestrator session
```

**Wake Mechanism:**
```typescript
async function wakeOrchestrator(orchestratorId: string): Promise<void> {
  const orc = await getOrchestrator(orchestratorId);

  // Check if Claude Code is running in session
  const scrollback = await TmuxService.captureOutput(orc.tmuxSessionName, 50);

  if (!scrollback.includes('claude') && !scrollback.includes('❯')) {
    // Start Claude Code in the session
    await TmuxService.sendKeys(orc.tmuxSessionName, 'claude --resume', true);
  }

  // Update status
  await updateOrchestratorStatus(orchestratorId, 'monitoring');
}
```

### 4. Auto-Spin on First Session

When a session is created in a folder, check if Folder Control exists.

```typescript
// In CreateSessionUseCase or session-service
async function createSession(userId, input) {
  const session = await actuallyCreateSession(userId, input);

  // Check if folder has control
  if (input.folderId) {
    const folderControl = await findFolderControl(userId, input.folderId);

    if (!folderControl) {
      // Auto-create folder control
      await bootstrapService.bootstrapFolderControl(
        userId,
        input.folderId,
        input.projectPath
      );
    }
  }

  return session;
}
```

## Database Changes

### orchestrator_session table additions

```sql
ALTER TABLE orchestrator_session ADD COLUMN claude_md_path TEXT;
ALTER TABLE orchestrator_session ADD COLUMN last_wake_at INTEGER;
ALTER TABLE orchestrator_session ADD COLUMN wake_count INTEGER DEFAULT 0;
```

## Implementation Plan

### Phase 1: Bootstrap System
1. Create `OrchestratorBootstrapService`
2. Create `OrchestratorInstructionGenerator`
3. Add orchestrator CLAUDE.md generation

### Phase 2: Event-Driven Wake
1. Update agent-event route to wake orchestrators
2. Add wake mechanism via tmux
3. Inject event notifications

### Phase 3: Auto-Spin Integration
1. Hook into session creation
2. Auto-create folder controls
3. Add UI for enabling/disabling

### Phase 4: Project Knowledge Integration
1. Inject project knowledge into CLAUDE.md
2. Keep CLAUDE.md updated when knowledge changes
3. Add refresh mechanism

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/services/orchestrator-bootstrap-service.ts` | Create | Bootstrap orchestrators |
| `src/services/orchestrator-instruction-generator.ts` | Create | Generate CLAUDE.md |
| `src/app/api/orchestrators/agent-event/route.ts` | Modify | Add wake logic |
| `src/services/session-service.ts` | Modify | Auto-spin on create |
| `src/db/schema.ts` | Modify | Add new columns |

## Open Questions

1. **Should orchestrators run continuously or on-demand?**
   - Current design: On-demand (wake on event)
   - Alternative: Always running with idle detection

2. **How to handle orchestrator crashes?**
   - Detect via tmux session health
   - Auto-restart with context recovery

3. **Multiple folders = multiple Claude Code sessions?**
   - Yes, one per folder for isolation
   - Master Control can coordinate across folders
