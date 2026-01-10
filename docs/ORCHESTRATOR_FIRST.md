# Orchestrator-First Architecture

> Transform Remote Dev from a terminal manager into an autonomous project orchestrator.

## Overview

The orchestrator-first model makes Master Control the **primary user interface**. Users describe tasks in natural language to the orchestrator, which spawns sessions, creates worktrees, assigns agents, and coordinates work autonomously.

### Current vs. Orchestrator-First Model

**Current Model:**
```
User → Terminal Session → Manual Commands → tmux/shell
                ↓
         Master Control (monitoring only)
```

**Orchestrator-First Model:**
```
User → Orchestrator Session (natural language) → Task Planner
                                                       ↓
                          ┌─────────────────────────────┴──────────────────────┐
                          ↓                                                     ↓
                    Task Executor                                    Project Knowledge Base
                          ↓                                                     ↑
         ┌────────────────┼────────────────┐                                  │
         ↓                ↓                ↓                                  │
   Spawn Session    Create Worktree   Assign Agent                           │
         │                │                │                                  │
         └────────────────┴────────────────┴──> Post-Mortem Analysis ────────┘
                                                       ↓
                                              Design New Tools/Agents
```

## Core Capabilities

1. **Spawn Sessions**: Create terminal sessions on demand for delegated tasks
2. **Create Worktrees**: Set up git worktrees for task isolation
3. **Assign Agents**: Auto-select from Claude, Codex, Gemini, OpenCode
4. **Inject Context**: Send task specs and relevant context to spawned sessions
5. **Monitor Progress**: Track spawned sessions and collect results
6. **Learn & Adapt**: Update project config based on completed work
7. **Post-Mortem Analysis**: Assess tasks and design new tools/agents

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interaction | Orchestrator terminal session | Natural conversation flow |
| Task Format | Natural language | Lower barrier, LLM parsing |
| Agent Selection | Auto-select | Orchestrator has project knowledge |
| Autonomy | Configurable (manual/confirm/full) | Per-project flexibility |

---

## Domain Model

### Task Entity

Represents a single unit of delegated work.

```typescript
interface Task {
  id: string;
  orchestratorId: string;
  userId: string;
  description: string;
  type: TaskType;           // feature, bug, refactor, test, documentation
  status: TaskStatus;       // queued, planning, executing, monitoring, completed, failed, cancelled
  confidence: number;       // 0-1 from LLM parsing
  estimatedDuration?: number;
  assignedAgent?: AgentProvider;
  createdAt: Date;
  completedAt?: Date;
}
```

**State Machine:**
```
queued → planning → executing → monitoring → completed
                                           → failed
                                           → cancelled
```

### Delegation Entity

Links task execution to session and worktree.

```typescript
interface Delegation {
  id: string;
  taskId: string;
  sessionId: string;
  worktreeId?: string;
  agentProvider: AgentProvider;
  status: DelegationStatus;    // spawning, injecting_context, running, monitoring, completed, failed
  contextInjected: string;
  executionLogs: LogEntry[];
  result?: TaskResult;
  error?: TaskError;
}
```

### ProjectKnowledge Entity

Stores learned information about the project.

```typescript
interface ProjectKnowledge {
  id: string;
  folderId: string;
  techStack: string[];
  conventions: string[];
  agentPerformance: Record<TaskType, Record<AgentProvider, number>>;
  pastTasks: TaskOutcome[];
  toolDefinitions: ToolDefinition[];
  agentTemplates: AgentTemplate[];
  lastScannedAt: Date;
}
```

---

## Post-Mortem Analysis System

The post-mortem system creates a feedback loop for continuous improvement.

### Workflow

```
Task Completes
      ↓
PostMortemAnalysisService
      ├─> Analyze execution logs
      ├─> Identify repeated patterns
      ├─> Detect automation opportunities
      └─> Generate recommendations
              ↓
ToolingDesignService
      ├─> Design new MCP tools
      ├─> Create agent templates
      └─> Generate config updates
              ↓
ProjectConfigUpdater
      ├─> Update CLAUDE.md
      ├─> Add command aliases
      └─> Document gotchas
              ↓
Present to User (or auto-apply if autonomy=full)
```

### Pattern Detection

The system analyzes task execution to identify:

1. **Repeated Command Sequences**: Same commands run across multiple tasks
2. **Manual Recovery Steps**: Error handling patterns that could be automated
3. **File Access Patterns**: Commonly accessed files that should be in context
4. **Time Sinks**: Phases that take disproportionate time

### Tool Definition Schema

When patterns are detected, the system can design new MCP tools:

```typescript
interface ToolDefinition {
  name: string;                    // e.g., "run_tests_with_coverage"
  description: string;
  inputSchema: JSONSchema;
  implementation: {
    type: 'command' | 'script' | 'api';
    command?: string;              // Shell command template
    script?: string;               // Script content
    endpoint?: string;             // API endpoint
  };
  triggers: string[];              // NL patterns that should invoke this tool
  confidence: number;              // How confident we are this tool is useful
  evidence: PatternEvidence[];     // Tasks that led to this recommendation
}
```

**Example Generated Tool:**
```typescript
{
  name: "run_type_check_and_fix",
  description: "Run TypeScript type checker and auto-fix common issues",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", default: "." }
    }
  },
  implementation: {
    type: "command",
    command: "bun run typecheck && bun run lint --fix"
  },
  triggers: [
    "check types",
    "fix type errors",
    "run typecheck"
  ],
  confidence: 0.85,
  evidence: [
    { taskId: "task-123", pattern: "Ran `bun run typecheck` followed by `bun run lint --fix` 5 times" }
  ]
}
```

### Agent Template Schema

For specialized tasks, the system can generate agent configurations:

```typescript
interface AgentTemplate {
  name: string;                    // e.g., "test_writer"
  provider: AgentProvider;         // claude, codex, gemini, opencode
  specialization: string;          // "Writing unit tests for React components"
  configOverrides: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };
  contextInjection: string;        // Context to inject on spawn
  exitConditions: string[];        // When to consider task complete
  confidence: number;
  evidence: PatternEvidence[];
}
```

**Example Generated Agent Template:**
```typescript
{
  name: "api_endpoint_builder",
  provider: "claude",
  specialization: "Creating REST API endpoints with validation",
  configOverrides: {
    systemPrompt: "You are an expert at building REST APIs with proper validation, error handling, and tests."
  },
  contextInjection: `
    Project uses: Next.js App Router, Drizzle ORM, Zod validation
    API conventions: See src/app/api for examples
    Always include: Input validation, error responses, tests
  `,
  exitConditions: [
    "API endpoint created and tested",
    "Tests pass",
    "TypeScript compiles"
  ],
  confidence: 0.78,
  evidence: [
    { taskId: "task-456", pattern: "Created 3 similar API endpoints with same validation pattern" }
  ]
}
```

### Config File Updates

The system updates project configuration files:

**CLAUDE.md Updates:**
```markdown
## Commands (Auto-discovered)

### Testing
- `bun run test` - Run all tests
- `bun run test:coverage` - Run tests with coverage report

### Database
- `bun run db:push` - Push schema changes (detected frequent use)

## Patterns (Learned from tasks)

### API Endpoint Creation
1. Create route file in `src/app/api/`
2. Add Zod schema for validation
3. Implement handler with try/catch
4. Add integration test

### Common Gotchas (Learned)
- Always run `bun run typecheck` before commit
- Drizzle migrations require `db:generate` then `db:migrate`
```

### Cross-Project Pattern Promotion

When Master Control detects patterns across multiple projects:

1. Pattern appears in 2+ folders with >0.8 confidence
2. Master Control aggregates evidence
3. Promotes to `~/.claude/CLAUDE.md` global config
4. Notifies user of promotion

---

## Data Flow

### End-to-End Task Execution

```
┌──────────────────────────────────────────────────────────────┐
│ 1. User Input (Orchestrator Chat Interface)                 │
│    "Add dark mode support to the settings page"             │
└────────────────┬─────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. Parse Task (OrchestratorLLMService)                      │
│    - Extract: type=feature, confidence=0.9                  │
│    - Create Task entity (status=queued)                     │
└────────────────┬─────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. Plan Execution (PlanTaskExecution)                       │
│    - Query ProjectKnowledge                                 │
│    - Select agent: Claude Code (best for UI features)       │
│    - Isolation: worktree (safe for new feature)             │
│    - Generate context injection                             │
└────────────────┬─────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. Execute Task (ExecuteTask)                               │
│    a. Create worktree: feat/dark-mode-settings              │
│    b. Spawn session: rdv-task-{uuid}                        │
│    c. Inject: claude --task "Add dark mode..."              │
│    d. Create Delegation entity                              │
└────────────────┬─────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. Monitor Progress (Background loop every 10s)             │
│    - Capture scrollback via TmuxService                     │
│    - Detect completion markers                              │
│    - Emit task_progress event to UI                         │
└────────────────┬─────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. Complete Task + Post-Mortem                              │
│    - Extract learnings from delegation                      │
│    - Run PostMortemAnalysisService                          │
│    - Generate tool/agent recommendations                    │
│    - Update ProjectKnowledge                                │
│    - Update CLAUDE.md if patterns found                     │
└──────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Task Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orchestrators/:id/tasks` | Submit task |
| GET | `/api/orchestrators/:id/tasks` | List tasks |
| GET | `/api/orchestrators/:id/tasks/:taskId` | Task status |
| POST | `/api/orchestrators/:id/tasks/:taskId/execute` | Confirm execution |
| DELETE | `/api/orchestrators/:id/tasks/:taskId` | Cancel task |

### Project Knowledge

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/folders/:folderId/knowledge` | Get knowledge |
| PATCH | `/api/folders/:folderId/knowledge` | Update knowledge |

### Post-Mortem & Recommendations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orchestrators/:id/post-mortems` | List analyses |
| GET | `/api/orchestrators/:id/post-mortems/:taskId` | Get analysis |
| POST | `/api/orchestrators/:id/post-mortems/:taskId/apply` | Apply recommendations |
| GET | `/api/orchestrators/:id/recommendations/tools` | Tool recommendations |
| GET | `/api/orchestrators/:id/recommendations/agents` | Agent recommendations |

---

## Database Schema

### New Tables

```sql
-- Tasks table
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  orchestrator_id TEXT NOT NULL REFERENCES orchestrator_sessions(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL,
  estimated_duration INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Delegations table
CREATE TABLE delegations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES terminal_session(id),
  worktree_id TEXT,
  agent_provider TEXT NOT NULL,
  status TEXT NOT NULL,
  context_injected TEXT,
  execution_logs TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Project knowledge table
CREATE TABLE project_knowledge (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES session_folder(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  tech_stack TEXT NOT NULL,
  conventions TEXT NOT NULL,
  agent_performance TEXT NOT NULL,
  past_tasks TEXT NOT NULL,
  tool_definitions TEXT NOT NULL,
  agent_templates TEXT NOT NULL,
  metadata TEXT NOT NULL,
  last_scanned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(folder_id)
);
```

### Modified Tables

```sql
ALTER TABLE orchestrator_sessions
  ADD COLUMN orchestrator_mode TEXT DEFAULT 'monitoring',
  ADD COLUMN autonomy_level TEXT DEFAULT 'confirm',
  ADD COLUMN llm_model TEXT DEFAULT 'claude-sonnet-4-5';

ALTER TABLE session_folder
  ADD COLUMN orchestrator_mode_enabled BOOLEAN DEFAULT 0,
  ADD COLUMN default_autonomy_level TEXT DEFAULT 'confirm';
```

---

## Implementation Phases

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 1 | Domain Foundation (entities, value objects) | None |
| 2 | Application Layer (use cases) | Phase 1 |
| 3 | Infrastructure (services, repositories) | Phase 2 |
| 4 | Database Schema | Phase 1 |
| 5 | API Layer | Phases 3, 4 |
| 6 | UI Components | Phase 5 |
| 7 | MCP Integration | Phase 5 |
| 8 | Background Workers | Phase 3 |
| **Post-Mortem** | Task analysis & tooling design | Phases 2, 3 |
| 9 | Testing & Documentation | Phases 6, 7, 8, Post-Mortem |
| 10 | Migration & Rollout | Phase 9 |

---

## Security Considerations

### Command Injection Prevention
- Reuse existing `CommandInjector` validation (8 dangerous patterns)
- Sanitize user input before LLM
- Validate LLM-generated commands

### API Key Security
- Store `ANTHROPIC_API_KEY` in environment
- Per-folder secrets config for agent keys
- Validate on orchestrator initialization

### Worktree Isolation
- Restrict to user's repository directories
- Validate branch names
- Clean up after completion

### Rate Limiting
- 10 tasks/minute per user
- 100 LLM calls/hour per folder
- Exponential backoff on limits

---

## Beads Tracking

Epic: `remote-dev-8c7` - Orchestrator-First Architecture

| Task | ID | Priority | Status |
|------|-----|----------|--------|
| Phase 1: Domain Foundation | `remote-dev-n6r` | P2 | Ready |
| Phase 2: Application Layer | `remote-dev-n5b` | P2 | Blocked |
| Phase 3: Infrastructure | `remote-dev-51q` | P2 | Blocked |
| Phase 4: Database Schema | `remote-dev-zr8` | P2 | Blocked |
| Phase 5: API Layer | `remote-dev-bpz` | P2 | Blocked |
| Phase 6: UI Components | `remote-dev-b22` | P2 | Blocked |
| Phase 7: MCP Integration | `remote-dev-5wa` | P2 | Blocked |
| Phase 8: Background Workers | `remote-dev-0ib` | P2 | Blocked |
| Post-Mortem System | `remote-dev-l1l` | P1 | Blocked |
| Phase 9: Testing | `remote-dev-tol` | P3 | Blocked |
| Phase 10: Rollout | `remote-dev-5td` | P3 | Blocked |

Start with `bd update remote-dev-n6r --status=in_progress` to begin Phase 1.
