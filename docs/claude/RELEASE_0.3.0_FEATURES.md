# Release 0.3.0 Features

> **Release Date**: January 2026
> **Commits**: 180+ since v0.2.0
> **Based on**: arXiv 2512.10398v5 Agent UX patterns

This document describes all features implemented since the v0.2.0 release, organized by major feature area.

## Table of Contents

- [Remote Dev SDK](#remote-dev-sdk)
- [Meta-Agent Optimization System](#meta-agent-optimization-system)
- [Hierarchical Memory System](#hierarchical-memory-system)
- [Note-Taking and Knowledge System](#note-taking-and-knowledge-system)
- [Extension System](#extension-system)
- [arXiv 2512.10398v5 UX/DX Improvements](#arxiv-2512.10398v5-uxdx-improvements)
- [Rust Backend (rdv-server)](#rust-backend-rdv-server)
- [UI Enhancements](#ui-enhancements)
- [CLI Enhancements](#cli-enhancements)
- [Testing Infrastructure](#testing-infrastructure)

---

## Remote Dev SDK

A comprehensive SDK providing three-perspective architecture for AI agent integration:

### Architecture Perspectives

| Perspective | Focus | Target Users |
|-------------|-------|--------------|
| **AX (Agent Experience)** | Agent capabilities and tools | AI agents |
| **UX (User Experience)** | Monitoring and control | Human operators |
| **DX (Developer Experience)** | Integration and debugging | Developers |

### Core Components

**TypeScript SDK** (`src/sdk/`):
- `RemoteDevSDK` - Main SDK class with session, memory, and orchestrator APIs
- `HttpClient` - HTTP/REST client with retry logic and error handling
- `useRemoteDevSDK` - React hook for SDK integration
- `useOrchestratorEvents` - Real-time orchestrator event subscription

**SDK Features**:
- Session management (create, suspend, resume, close)
- Memory operations (store, query, consolidate, prune)
- Note taking and insight extraction
- Orchestrator control and monitoring
- Meta-agent optimization integration

**API Routes** (`src/app/api/sdk/`):
| Endpoint | Description |
|----------|-------------|
| `/api/sdk/sessions` | Session CRUD operations |
| `/api/sdk/memory` | Memory store and query |
| `/api/sdk/memory/consolidate` | Consolidation triggers |
| `/api/sdk/memory/query` | Semantic search |
| `/api/sdk/notes` | Note CRUD operations |
| `/api/sdk/meta` | Meta-agent optimization |

### React Hooks

```typescript
// SDK hook with automatic initialization
const { sdk, isReady, error } = useRemoteDevSDK();

// Orchestrator events subscription
const { events, isConnected } = useOrchestratorEvents(orchestratorId);
```

---

## Meta-Agent Optimization System

Self-improving agent configuration through automated testing and refinement.

### Optimization Loop Phases

```
BUILD → TEST → IMPROVE → (repeat)
```

| Phase | Description |
|-------|-------------|
| **BUILD** | Generate provider-specific config from templates |
| **TEST** | Run benchmark suite with scoring |
| **IMPROVE** | Analyze results and refine prompts |

### Components

**MetaAgentOptimizationService** (`src/services/meta-agent-optimization-service.ts`):
- Config version tracking with history
- Automatic rollback on regression
- A/B testing between config versions
- Detailed optimization history

**UI Components** (`src/components/meta-agent/`):
| Component | Description |
|-----------|-------------|
| `MetaAgentOptimizationModal` | Main optimization interface |
| `PromptPlayground` | Interactive prompt testing |
| `BenchmarkComparisonView` | Side-by-side config comparison |
| `RegressionDetector` | Threshold-based regression alerts |

**API Routes**:
| Endpoint | Description |
|----------|-------------|
| `POST /api/sdk/meta` | Start optimization job |
| `GET /api/sdk/meta/status/:id` | Check job status |
| `GET /api/sdk/meta/stream` | SSE event stream |
| `GET /api/sdk/meta/history` | Optimization history |
| `POST /api/sdk/meta/benchmark` | Run benchmarks |
| `POST /api/sdk/meta/prompt-test` | Test individual prompts |

### CLI Commands

```bash
# Start optimization
rdv meta start [--iterations N]

# Check status
rdv meta status

# View history
rdv meta history

# Run benchmarks
rdv meta benchmark
```

---

## Hierarchical Memory System

Three-tier memory architecture for agent context management.

### Memory Tiers

| Tier | TTL | Purpose |
|------|-----|---------|
| **Short-term** | 5 minutes | Recent observations |
| **Working** | 24 hours | Active task context |
| **Long-term** | Permanent | Persistent knowledge |

### Memory Types

| Type | Description |
|------|-------------|
| `observation` | Raw data from scrollback |
| `error` | Detected errors with classification |
| `pattern` | Recurring behaviors |
| `decision` | Key decisions with rationale |
| `gotcha` | Pitfalls and warnings |
| `insight` | Extracted learnings |
| `knowledge` | Consolidated facts |

### Services

**SessionMemoryService** (`src/services/session-memory-service.ts`):
- Store and retrieve memories by type
- Content-hash deduplication
- TTL-based expiration
- Scrollback pattern detection
- Session lifecycle integration

**EpisodicMemoryService** (`src/services/episodic-memory-service.ts`):
- Episode recording for task execution
- Quality scoring and feedback
- Similar episode retrieval
- Context generation for future tasks

### Vector Storage

**LanceDB Integration**:
- Semantic search with embeddings
- Episode similarity matching
- Knowledge retrieval by relevance

**API Routes**:
| Endpoint | Description |
|----------|-------------|
| `GET /api/sdk/memory` | List memories |
| `POST /api/sdk/memory` | Store memory |
| `POST /api/sdk/memory/query` | Semantic search |
| `POST /api/sdk/memory/consolidate` | Consolidate to long-term |
| `POST /api/sdk/memory/prune` | Clean expired entries |
| `GET /api/sdk/memory/stats` | Memory statistics |

---

## Note-Taking and Knowledge System

Structured note capture and insight extraction for AI agents.

### Database Schema

```sql
-- Notes table
CREATE TABLE sdk_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL,
  tags TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- Insights table
CREATE TABLE sdk_insights (
  id TEXT PRIMARY KEY,
  note_id TEXT,
  insight_type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL,
  created_at INTEGER
);
```

### Note Types

| Type | Purpose |
|------|---------|
| `observation` | What happened |
| `decision` | Choice made with rationale |
| `learning` | Knowledge gained |
| `todo` | Action items |
| `question` | Open questions |

### Insight Extraction

**NoteTakingService** extracts insights from notes:
- Pattern detection across notes
- Confidence scoring
- Automatic categorization
- Cross-session aggregation

### UI Components

| Component | Description |
|-----------|-------------|
| `NotesSidebar` | Session notes panel |
| `KnowledgeBrowser` | Unified knowledge access |
| `InsightsDashboardWidget` | Sidebar insights summary |

### CLI Commands

```bash
# Create note
rdv notes create "Title" --type observation

# List notes
rdv notes list [--session ID]

# Extract insights
rdv notes insights [--note-id ID]

# Consolidate knowledge
rdv learn consolidate
```

---

## Extension System

Plugin architecture for custom tools, prompts, and memory providers.

### Rust SDK (`crates/rdv-sdk/src/extensions/`)

**Extension Types**:
| Type | Description |
|------|-------------|
| `Tool` | MCP-compatible tools |
| `Prompt` | Reusable prompt templates |
| `Memory` | Custom memory providers |
| `UI` | Frontend components |

**Builder APIs**:

```rust
use rdv_sdk::extensions::SDK;

// Build a tool
let tool = SDK::tool("search")
    .description("Search for files")
    .input_schema(json!({"type": "object"}))
    .build();

// Build a prompt
let prompt = SDK::prompt("review")
    .description("Code review")
    .template("Review: {{code}}")
    .build();
```

**Composition System** (`composition.rs`):

```rust
use rdv_sdk::extensions::{ExtensionComposer, presets};

// Use preset composition
let stack = presets::development()
    .with_action("custom-tool")
    .build()?;

// Or build custom
let stack = ExtensionComposer::new("my-agent")
    .with_perception("file-reader")
    .with_reasoning("code-analyzer")
    .with_action("shell-executor")
    .with_memory("vector-memory")
    .build()?;
```

**Extension Traits**:
| Trait | Purpose |
|-------|---------|
| `Perception` | Gather information |
| `Reasoning` | Analyze and transform |
| `Action` | Execute operations |
| `Memory` | Store and retrieve |
| `UI` | User interface |
| `Orchestration` | Coordinate extensions |

**Lifecycle Hooks** (`hooks.rs`):
| Hook | When |
|------|------|
| `OnInputMessages` | Before processing input |
| `OnLlmOutput` | After LLM response |
| `PreToolUse` | Before tool execution |
| `PostToolUse` | After tool execution |
| `SessionStart` | Session begins |
| `SessionEnd` | Session ends |
| `OnError` | Error occurred |

### Built-in Extensions

Three example extensions in `crates/rdv-sdk/src/extensions/examples/`:
1. File search tool
2. Shell executor
3. Code analyzer

### CLI Commands

```bash
# List extensions
rdv extension list

# Install extension
rdv extension install <name>

# Enable/disable
rdv extension enable <name>
rdv extension disable <name>
```

---

## arXiv 2512.10398v5 UX/DX Improvements

Implementation of Agent Experience patterns from the research paper.

### Auto-Error Capture Service

**ErrorAutoCaptureService** (`src/services/error-auto-capture-service.ts`):
- Pattern-based error detection
- Multi-language support (TypeScript, Python, Rust, Go, etc.)
- Error classification by category
- Confidence scoring
- Line number and file extraction

**Supported Languages**:
| Language | Patterns |
|----------|----------|
| TypeScript/JavaScript | Compilation errors, runtime errors |
| Python | Tracebacks, syntax errors |
| Rust | Compiler errors, panic messages |
| Go | Build errors, runtime panics |
| Shell | Command failures, exit codes |

### LogViewer Component

**Features**:
- Real-time log streaming via SSE
- Level filtering (debug, info, warn, error)
- Source filtering
- Full-text search with highlighting
- Virtual scrolling for performance
- Copy and export functionality

### TraceViewer Component

**Tool Call Visualization**:
- Timeline view with duration bars
- Call stack visualization
- Dependency graph
- Expandable input/output details
- Zoom and pan controls
- Export to JSON

### Prompt Playground

**Interactive Testing**:
- Variable interpolation (`{{variable}}` syntax)
- Parameter tuning (temperature, maxTokens, topP, etc.)
- Test history with comparison
- Side-by-side result viewing

### Benchmark Comparison View

**Config Testing**:
- Side-by-side config versions
- Score history charts
- Test case comparison tables
- Pass rate tracking
- Token usage analysis

### Regression Detector

**Threshold Monitoring**:
| Metric | Default Threshold |
|--------|-------------------|
| Score drop | 5% |
| Duration increase | 20% |
| Pass rate drop | 10% |
| Token increase | 15% |

**Severity Levels**:
- Critical: Major regression
- Warning: Notable change
- Info: Minor variation

### Hindsight Generator

**HindsightGeneratorService** (`src/services/hindsight-generator-service.ts`):
- Session analysis for learnings
- Pattern extraction
- Confidence scoring
- What worked / what failed analysis
- "Would do differently" suggestions

### Artifact Previews

**CodePreview Component**:
- Syntax highlighting (Prism-based)
- Virtual scrolling for large files
- Line numbers with gutter
- Copy and download
- Expandable modal view

**DiffViewer Component**:
- Unified and split views
- Addition/deletion highlighting
- File statistics
- Copy and download
- Inline commenting support

---

## Rust Backend (rdv-server)

Consolidated Rust service replacing multiple TypeScript services.

### Architecture

```
rdv-server
├── API Server (REST + WebSocket)
├── MCP Server (via rmcp crate)
├── Monitoring Service
├── Learning Extraction
└── Worktree Cleanup
```

### Features

**Session Management**:
- Create with project detection
- Tech stack analysis
- Agent provider identification
- Tmux session lifecycle

**Orchestrator**:
- Master Control auto-initialization
- Folder Control auto-spin
- Stall detection with configurable thresholds
- Command injection with safety validation

**Learning System**:
- Session transcript analysis
- Pattern extraction
- Knowledge consolidation
- CLAUDE.md updates

**MCP Integration**:
- Full MCP protocol support
- Dynamic tool registration
- Resource providers
- Prompt templates

### CLI Token Management

```bash
# Create API token
rdv auth create-token [--name NAME]

# List tokens
rdv auth list-tokens

# Revoke token
rdv auth revoke-token <id>
```

### Socket Communication

**Unix Socket Transport**:
- Path: `/var/run/remote-dev/rdv-server.sock`
- Protocol: HTTP over Unix socket
- Benefits: Lower latency, no port conflicts

### Infrastructure

**Cloudflare Tunnel**:
- Template config in `cloudflared-config.template.yaml`
- Standardized socket paths
- Production deployment ready

---

## UI Enhancements

### New Components

| Component | Location | Description |
|-----------|----------|-------------|
| `MemoryPanel` | Session view | Memory entries for session |
| `MemorySearchResults` | Command palette | Memory search integration |
| `InsightsDashboardWidget` | Sidebar | Insights summary |
| `KnowledgeBrowser` | Modal | Unified knowledge access |
| `NotesSidebar` | Session view | Note management |
| `MetaAgentOptimizationModal` | Session view | Optimization interface |
| `OrchestratorModeToggle` | Settings | Feature flag control |

### Edit Modals and Toast Notifications

- Session edit modal
- Folder edit modal
- Template edit modal
- Consistent toast notifications
- Error display improvements

### Command Palette Integration

- Memory search in palette
- Quick note creation
- Knowledge lookup
- Insight access

---

## CLI Enhancements

### New Commands

**Memory Commands**:
```bash
rdv memory store <content> --type observation
rdv memory list [--type TYPE] [--session ID]
rdv memory query <query> [--limit N]
rdv memory consolidate
rdv memory prune
```

**Note Commands**:
```bash
rdv notes create <title> --type TYPE
rdv notes list [--session ID]
rdv notes show <id>
rdv notes delete <id>
rdv notes insights [--note-id ID]
```

**Knowledge Commands**:
```bash
rdv knowledge list [--folder PATH]
rdv knowledge show <id>
rdv knowledge apply [--dry-run]
```

**Learning Commands**:
```bash
rdv learn analyze <session> [--save]
rdv learn extract [path]
rdv learn apply [path] [--dry-run]
rdv learn consolidate
rdv learn show [path]
```

**Meta-Agent Commands**:
```bash
rdv meta start [--iterations N]
rdv meta status
rdv meta history
rdv meta benchmark
rdv meta rollback <version>
```

**Extension Commands**:
```bash
rdv extension list
rdv extension install <name>
rdv extension enable <name>
rdv extension disable <name>
```

---

## Testing Infrastructure

### Test Suites

| Suite | Tests | Coverage |
|-------|-------|----------|
| Unit | 373 | Services, domain entities |
| Integration | 7 | Database workflows |
| E2E | 6 | Complete user flows |
| Performance | 1 | SDK benchmarks |

### Key Test Files

**Unit Tests**:
- `src/services/*.test.ts` - Service unit tests
- `src/sdk/**/*.test.ts` - SDK client tests
- `src/application/**/*.test.ts` - Use case tests
- `src/lib/*.test.ts` - Utility tests

**Integration Tests** (`src/tests/integration/`):
- `hierarchical-memory.integration.test.ts`
- `episodic-memory.integration.test.ts`
- `note-taking.integration.test.ts`
- `sdk-workflows.integration.test.ts`
- `multi-agent-coordination.integration.test.ts`
- `orchestrator-workflow.integration.test.ts`
- `rdv-server.integration.test.ts`

**E2E Tests** (`src/tests/e2e/`):
- `sdk-workflow.e2e.test.ts`
- `episode-recording-workflow.e2e.test.ts`
- `orchestrator-lifecycle.e2e.test.ts`
- `multi-agent-task-workflow.e2e.test.ts`
- `session-agent-workflow.e2e.test.ts`
- `folder-orchestrator-hierarchy.e2e.test.ts`

**Performance Tests** (`src/tests/performance/`):
- `sdk-benchmarks.perf.test.ts`

### Running Tests

```bash
# All tests
bun test

# Unit tests only
bun test ./src/services/*.test.ts ./src/sdk/**/*.test.ts

# Integration tests (requires database)
bun test ./src/tests/integration/

# E2E tests
bun test ./src/tests/e2e/

# Performance benchmarks
bun test ./src/tests/performance/
```

---

## Summary

Release 0.3.0 represents a major evolution of Remote Dev with:

- **SDK Architecture**: Three-perspective SDK for AX/UX/DX
- **Self-Improvement**: Meta-agent optimization loop
- **Memory**: Hierarchical three-tier memory system
- **Knowledge**: Note-taking with insight extraction
- **Extensions**: Plugin architecture with composition
- **UX/DX**: arXiv-based improvements for agent debugging
- **Backend**: Consolidated Rust server
- **Testing**: Comprehensive test coverage

Total new code: ~15,000+ lines across TypeScript and Rust.
