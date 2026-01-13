# Hierarchical Memory System Design

> **Status**: Design Document
> **Based on**: Confucius Code Agent (arXiv:2512.10398)
> **Last Updated**: 2025-01-13

## Executive Summary

This document defines the complete design for Remote Dev's hierarchical memory system, enabling AI coding agents to learn from past sessions, maintain context across conversations, and access relevant knowledge on-demand. The design is based on the Confucius Code Agent (CCA) paper while adapting to our multi-agent architecture.

**Key Goals:**
1. Enable agents to store and retrieve memories during sessions
2. Automatically promote valuable learnings to long-term storage
3. Reconstitute relevant context after compaction or new session start
4. Teach agents how to effectively use the memory system

---

## 1. Memory Tier Architecture

### 1.1 Three-Tier Design

```
┌─────────────────────────────────────────────────────────────────┐
│                      LONG-TERM MEMORY                           │
│  • Permanent storage (no TTL)                                   │
│  • Project conventions, validated patterns, gotchas, skills     │
│  • Semantic search enabled                                      │
│  • Cross-session retrieval                                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                    Promotion │ (high confidence + access)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       WORKING MEMORY                            │
│  • 24-hour TTL (extended on access)                             │
│  • Current task context, hypotheses, plans, file context        │
│  • Task-scoped (linked to specific work units)                  │
│  • Active reasoning artifacts                                   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                    Promotion │ (relevance threshold)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      SHORT-TERM MEMORY                          │
│  • 1-hour TTL (auto-expire)                                     │
│  • Terminal output, commands, observations                      │
│  • Ephemeral, high volume                                       │
│  • Auto-captured from scrollback                                │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Tier Characteristics

| Tier | TTL | Content Types | Scope | Purpose |
|------|-----|---------------|-------|---------|
| **Short-term** | 1 hour | `command`, `tool_result`, `observation`, `error` | Session | Recent activity, ephemeral observations |
| **Working** | 24 hours | `file_context`, `hypothesis`, `plan`, `task_context` | Task | Current work context, active reasoning |
| **Long-term** | Permanent | `convention`, `pattern`, `gotcha`, `skill`, `reference` | Folder/User | Validated learnings, project knowledge |

### 1.3 Content Type Definitions

**Short-term Types:**
- `command`: Shell commands executed in terminal
- `tool_result`: Output from tool invocations
- `observation`: Agent observations about code/errors
- `error`: Captured errors with context

**Working Types:**
- `file_context`: Files being actively worked on
- `hypothesis`: Theories about bugs/solutions
- `plan`: Multi-step execution plans
- `task_context`: Current task description and goals

**Long-term Types:**
- `convention`: Coding style, architecture decisions
- `pattern`: Reusable solutions, common workflows
- `gotcha`: Known pitfalls with resolutions
- `skill`: Procedures, commands, techniques
- `reference`: Documentation, API usage

---

## 2. Memory Lifecycle & Migration

### 2.1 Automatic Capture (Short-term)

```
Terminal Activity
      ↓
┌─────────────────────────────────────────┐
│ MonitoringService (every 30s)           │
│ • Capture tmux scrollback               │
│ • Detect error patterns (72+ patterns)  │
│ • Extract observations                  │
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Auto-Store as Short-term Memory         │
│ • contentType: observation/error        │
│ • ttl: 3600 seconds (1 hour)           │
│ • relevance: 0.5 (default)             │
│ • confidence: 0.5 (default)            │
└─────────────────────────────────────────┘
```

### 2.2 Promotion Logic (Short → Working)

**Trigger:** Agent explicitly stores OR automatic detection

**Criteria:**
```typescript
interface PromotionToWorking {
  // Any of these triggers promotion:
  explicitStore: boolean;        // Agent uses sdk:memory_store with tier=working
  highRelevance: boolean;        // relevance >= 0.7
  repeatedAccess: boolean;       // accessCount >= 2 within 1 hour
  errorWithResolution: boolean;  // Error followed by success pattern
}
```

**Automatic Promotion Events:**
- Error detected → Resolution found within 10 minutes → Promote as `gotcha`
- File opened → Multiple edits → Promote as `file_context`
- Plan created → Steps executed → Promote as validated `plan`

### 2.3 Promotion Logic (Working → Long-term)

**Trigger:** Session close OR consolidation cycle

**Criteria:**
```typescript
interface PromotionToLongTerm {
  // ALL of these required:
  confidence: number >= 0.8;
  accessCount: number >= 3;
  contentType: ['pattern', 'gotcha', 'convention', 'skill'];

  // Plus ONE of these:
  agentValidated: boolean;      // Agent explicitly marked as valuable
  crossSessionUse: boolean;     // Used in multiple sessions
  userFeedback: 'positive';     // User thumbs-up
}
```

**Promotion Process:**
1. Identify candidates meeting criteria
2. Generate embedding if missing
3. Update tier to `long_term`
4. Clear TTL (permanent)
5. Set `sourceSessionsJson` for provenance

### 2.4 Demotion Logic

**Criteria for Long-term → Working:**
- relevance < 0.3 AND confidence < 0.4
- No access in 90 days
- User explicit demotion

**Criteria for Working → Short-term:**
- No access in 24 hours (beyond TTL)
- relevance < 0.2
- Task completed with no reuse

### 2.5 Consolidation Scheduler

```typescript
// Every 4 hours
async function scheduledConsolidation() {
  // 1. Cleanup expired short-term
  await cleanupExpiredMemories();

  // 2. Promote working → long-term
  const promoted = await promoteHighValueWorking();

  // 3. Demote stale long-term
  const demoted = await demoteUnusedLongTerm();

  // 4. Compact working memory (summarize similar entries)
  const compacted = await compactWorkingMemory();

  // 5. Update embeddings for new long-term entries
  await generateMissingEmbeddings();
}
```

---

## 3. Agent Memory Awareness

### 3.1 Teaching Agents to Use Memory

**Problem:** Agents don't know the memory system exists unless told.

**Solution:** Multi-layered awareness injection

#### Layer 1: Session Start Context (Automatic)

When a session starts, inject memory awareness via `.remote-dev/context.md`:

```markdown
# Remote Dev Memory System

You have access to a hierarchical memory system. Use it to:
- Store important observations: `rdv memory remember "observation"`
- Store working context: `rdv memory remember -t working "context"`
- Store permanent learnings: `rdv memory remember -t long "learning"`
- Search past knowledge: `rdv memory search "query"`
- Create notes: `rdv note add "title" "content"`

## Retrieved Context (Relevant to Current Project)

### Known Gotchas
- [gotcha content from semantic search]

### Project Conventions
- [conventions from long-term memory]

### Recent Observations
- [recent relevant observations]
```

#### Layer 2: MCP Tools (Direct Access)

Agents with MCP access get direct tools:

```
sdk:memory_store   - Store observation, context, or learning
sdk:memory_search  - Semantic search across all memories
sdk:note_capture   - Quick note with type classification
sdk:insight_extract - Extract and store insight
```

#### Layer 3: Compaction Hook (Context Reconstitution)

When context is compacted, inject a system reminder:

```markdown
<system-reminder>
Context was compacted. Key memories preserved:

## Working Context
- [current task description]
- [open TODOs]
- [recent decisions]

## Relevant Long-term Knowledge
- [semantically similar patterns]
- [applicable gotchas]

Use `rdv memory search "query"` to retrieve more context.
</system-reminder>
```

#### Layer 4: CLAUDE.md Section (Permanent Reference)

Add to project CLAUDE.md:

```markdown
## Memory System

This project uses Remote Dev's hierarchical memory system.

**Automatic:** Errors and observations are captured automatically.

**Manual Commands:**
- `rdv memory remember "text"` - Store short-term observation
- `rdv memory remember -t working "text"` - Store working context
- `rdv memory remember -t long "text"` - Store permanent learning
- `rdv memory search "query"` - Search memories
- `rdv note add "title" "content"` - Create persistent note
- `rdv insights list` - View learned insights

**Best Practices:**
- Store gotchas when you encounter non-obvious issues
- Store conventions when you learn project patterns
- Store skills when you discover useful procedures
- Search memories when starting unfamiliar work
```

### 3.2 Agent Memory Usage Patterns

**Pattern 1: Error Resolution**
```
1. Agent encounters error
2. Auto-captured as short-term observation
3. Agent solves error
4. Agent stores: rdv memory remember -t working "Error X fixed by doing Y"
5. If pattern repeats → promote to long-term gotcha
```

**Pattern 2: Task Context**
```
1. Agent starts new task
2. Query: rdv memory search "similar task keywords"
3. Retrieve relevant patterns/gotchas
4. Store working context: rdv memory remember -t working "Task: implement X"
5. On completion → promote valuable learnings
```

**Pattern 3: Knowledge Discovery**
```
1. Agent discovers project convention
2. Store immediately: rdv memory remember -t long "Convention: always use X for Y"
3. Future agents retrieve via semantic search
```

---

## 4. Semantic Retrieval System

### 4.1 Embedding Pipeline

```
Memory Content
      ↓
┌─────────────────────────────────────────┐
│ EmbeddingService (all-MiniLM-L6-v2)     │
│ • 384-dimensional vectors               │
│ • Local inference (no API calls)        │
│ • Batch processing for efficiency       │
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Vector Storage                          │
│ • embeddingId stored in memory record   │
│ • LanceDB for vector similarity search  │
│ • Indexed by user + folder scope        │
└─────────────────────────────────────────┘
```

### 4.2 Retrieval Strategy

**Context Injection Query Construction:**
```typescript
function buildContextQuery(session: Session): string {
  const parts = [
    `Project: ${session.folder.name}`,
    `Language: ${detectLanguage(session.workingPath)}`,
    `Task: ${session.currentTask || 'general development'}`,
    `Branch: ${session.gitBranch}`,
  ];
  return parts.join('. ');
}
```

**Semantic Search Flow:**
```
Query String
      ↓
Generate Query Embedding
      ↓
Search Long-term Memories (cosine similarity > 0.7)
      ↓
Search Notes (cosine similarity > 0.6)
      ↓
Search Insights (cosine similarity > 0.6)
      ↓
Merge & Re-rank by:
  • Semantic similarity (50%)
  • Tier weight (20%): long_term=1.0, working=0.8, short=0.6
  • Content type weight (15%): gotcha=1.0, pattern=0.9, convention=0.85
  • Recency weight (15%): decay over time
      ↓
Return Top-K Results (default K=10)
```

### 4.3 Cross-Session Learning

**On Error Detection:**
```typescript
async function onErrorDetected(error: DetectedError) {
  // Search for similar past errors
  const similarGotchas = await semanticSearch({
    query: `${error.language} ${error.message}`,
    contentTypes: ['gotcha'],
    minSimilarity: 0.75,
    limit: 3
  });

  if (similarGotchas.length > 0) {
    // Inject known resolutions into agent context
    await injectSystemReminder(`
      Similar error found in past sessions:
      ${similarGotchas.map(g => `- ${g.content}`).join('\n')}
    `);
  }
}
```

---

## 5. MCP Tools Specification

### 5.1 Tool Definitions

```typescript
// sdk:memory_store
{
  name: 'sdk:memory_store',
  description: 'Store a memory entry in the hierarchical memory system',
  inputSchema: {
    tier: { enum: ['short_term', 'working', 'long_term'], required: true },
    contentType: { enum: ['observation', 'file_context', 'hypothesis', 'plan', 'task_context', 'convention', 'pattern', 'gotcha', 'skill'], required: true },
    content: { type: 'string', required: true },
    name: { type: 'string', description: 'Short name for the memory' },
    confidence: { type: 'number', min: 0, max: 1 },
    metadata: { type: 'object' }
  }
}

// sdk:memory_search
{
  name: 'sdk:memory_search',
  description: 'Semantic search across memories, notes, and insights',
  inputSchema: {
    query: { type: 'string', required: true },
    tiers: { type: 'array', items: { enum: ['short_term', 'working', 'long_term'] } },
    contentTypes: { type: 'array' },
    minSimilarity: { type: 'number', default: 0.5 },
    limit: { type: 'number', default: 10 }
  }
}

// sdk:note_capture
{
  name: 'sdk:note_capture',
  description: 'Capture a persistent note',
  inputSchema: {
    type: { enum: ['todo', 'reminder', 'question', 'observation', 'warning', 'decision'], required: true },
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    tags: { type: 'array', items: { type: 'string' } }
  }
}

// sdk:insight_extract
{
  name: 'sdk:insight_extract',
  description: 'Extract and store a project insight',
  inputSchema: {
    type: { enum: ['convention', 'pattern', 'anti_pattern', 'gotcha', 'skill', 'tool'], required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    content: { type: 'string' },
    confidence: { type: 'number', default: 0.7 }
  }
}
```

### 5.2 Tool Implementation Location

```
src/mcp/tools/
├── memory/
│   ├── store.ts          # sdk:memory_store
│   ├── search.ts         # sdk:memory_search
│   └── index.ts          # Registry
├── notes/
│   ├── capture.ts        # sdk:note_capture
│   └── index.ts
└── insights/
    ├── extract.ts        # sdk:insight_extract
    └── index.ts
```

---

## 6. Async Trajectory Distillation

### 6.1 Design

Based on CCA paper's async note-taking agent:

```
┌─────────────────────────────────────────────────────────────────┐
│                  TrajectoryDistillationService                   │
│                                                                  │
│  Runs asynchronously alongside agent sessions                   │
│  Does NOT interrupt agent - watches and learns                  │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ ScrollbackWatcher │  │ DecisionTracker │  │ OutcomeAnalyzer │
│ • Commands run     │  │ • Why X over Y   │  │ • Success/fail  │
│ • Errors seen      │  │ • Trade-offs     │  │ • Resolution    │
│ • Files touched    │  │ • Reasoning      │  │ • Time taken    │
└───────────────┘     └───────────────┘     └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌─────────────────────┐
                    │ LearningExtractor   │
                    │ • Gotchas           │
                    │ • Patterns          │
                    │ • Skills            │
                    │ • Conventions       │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ AsyncNoteCreator    │
                    │ • Creates notes     │
                    │ • No agent interrupt│
                    │ • Background only   │
                    └─────────────────────┘
```

### 6.2 Distillation Triggers

| Event | Action |
|-------|--------|
| Error → Resolution (< 10 min) | Create hindsight note |
| Task completion | Extract key decisions |
| Session end | Full trajectory analysis |
| 30 minutes elapsed | Incremental checkpoint |

### 6.3 Hindsight Note Format

```markdown
# Gotcha: [Error Type] in [Language]

## Problem
```
[original error message]
```

## Context
- File: [file path]
- Line: [line number]
- Task: [what agent was trying to do]

## Resolution
```bash
[commands that fixed it]
```

## Key Insight
[Why this happened and how to avoid it]

## Related Files
- [files that were relevant]

---
*Auto-generated from session [session-id] on [date]*
*Confidence: [0.0-1.0]*
```

---

## 7. Context Compression Strategy

### 7.1 When to Compress

- Working memory > 50 entries
- Session duration > 2 hours
- Context window > 70% capacity
- User triggers manual compaction

### 7.2 Compression Algorithm

```typescript
async function compactWorkingMemory(sessionId: string) {
  const memories = await getWorkingMemories(sessionId);

  // 1. Group by semantic similarity
  const clusters = await clusterBySimilarity(memories, threshold: 0.8);

  // 2. For each cluster, create summary
  const summaries = await Promise.all(clusters.map(async cluster => {
    if (cluster.length === 1) return cluster[0];

    return await llm.complete({
      prompt: `Summarize these related observations into a single, actionable memory:
        ${cluster.map(m => m.content).join('\n---\n')}
      `,
      maxTokens: 200
    });
  }));

  // 3. Replace cluster entries with summary
  await replaceWithSummaries(clusters, summaries);

  // 4. Preserve high-value entries unchanged
  // (confidence >= 0.9 OR accessCount >= 5)
}
```

### 7.3 Preserved Information Categories

Per CCA paper, always preserve:
1. **Task goals** - What the agent is trying to accomplish
2. **Decisions made** - Key choices and their rationale
3. **Open TODOs** - Incomplete work items
4. **Error traces** - Critical errors with resolution status

---

## 8. Implementation Roadmap

### Phase 1: Core Memory Operations (Week 1-2)

- [ ] Implement MCP tools (`sdk:memory_store`, `sdk:memory_search`)
- [ ] Wire embedding generation on memory storage
- [ ] Enable semantic search in context injection
- [ ] Add memory awareness to session start hook

### Phase 2: Agent Teaching (Week 2-3)

- [ ] Create CLAUDE.md memory section generator
- [ ] Implement compaction hook with context reconstitution
- [ ] Add memory usage examples to agent prompts
- [ ] Test with all agent providers (Claude, Codex, Gemini, OpenCode)

### Phase 3: Cross-Session Learning (Week 3-4)

- [ ] Implement error → similar gotcha retrieval
- [ ] Add note search to context injection
- [ ] Create insight application tracking
- [ ] Build feedback collection UI

### Phase 4: Async Intelligence (Week 4-5)

- [ ] Implement TrajectoryDistillationService
- [ ] Build hindsight note auto-generation
- [ ] Add decision tracking
- [ ] Create outcome analysis

### Phase 5: Consolidation & Compression (Week 5-6)

- [ ] Implement consolidation scheduler
- [ ] Build working memory compaction
- [ ] Add relevance decay algorithm
- [ ] Create pruning policies

---

## 9. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Context reconstitution time | < 2s | Time from session start to context available |
| Cross-session retrieval accuracy | > 80% | Relevant gotcha found for known error patterns |
| Token savings from compression | 30%+ | (before - after) / before |
| Agent memory usage rate | > 50% | Sessions where agent stores 1+ memories |
| Hindsight note utility | > 70% | User thumbs-up on auto-generated notes |

---

## 10. Open Questions

1. **Embedding storage**: Use LanceDB for all embeddings or keep separate stores per content type?
2. **Multi-agent consistency**: How do we handle multiple agents writing to same folder's memory?
3. **Privacy**: Should memories be shareable across users?
4. **Versioning**: How do we handle memory schema changes?
5. **Quotas**: Should we limit memory storage per user/folder?

---

## References

- [Confucius Code Agent (arXiv:2512.10398)](https://arxiv.org/abs/2512.10398)
- Remote Dev SDK Design: `docs/claude/SDK_DESIGN_PROPOSAL.md`
- Rust Backend Architecture: `docs/claude/RUST_BACKEND_ARCHITECTURE.md`
