# Remote Dev SDK: Confucius-Inspired Architecture

## Overview

This document proposes an SDK architecture inspired by the Confucius Code Agent (CCA) paper,
adapted for Remote Dev's multi-agent orchestration system.

## Three-Perspective Design (AX/UX/DX)

### Agent Experience (AX)
Components that optimize how AI agents interact with the system.

```typescript
interface AgentExperience {
  // Hierarchical Working Memory
  memory: {
    shortTerm: ShortTermMemory;      // Current task context
    workingMemory: WorkingMemory;    // Active reasoning state
    episodic: EpisodicMemory;        // Session history
    semantic: SemanticMemory;        // Project knowledge
  };

  // Tool access and capabilities
  tools: ToolRegistry;

  // Context management
  context: ContextManager;
}
```

### User Experience (UX)
Components that optimize human interaction with the system.

```typescript
interface UserExperience {
  // Real-time visibility
  dashboard: OrchestratorDashboard;

  // Insight notifications
  insights: InsightNotificationSystem;

  // Session control
  sessions: SessionManager;

  // Knowledge browser
  knowledge: KnowledgeBrowser;
}
```

### Developer Experience (DX)
Components that enable extension and customization.

```typescript
interface DeveloperExperience {
  // Plugin/extension system
  extensions: ExtensionRegistry;

  // Custom tool definitions
  tools: ToolBuilder;

  // Config templates
  templates: ConfigTemplateEngine;

  // SDK APIs
  api: SDKApi;
}
```

## Hierarchical Working Memory

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Long-Term Memory                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Project Knowledge│  │   Conventions   │  │   Patterns   │ │
│  │  (semantic)      │  │   (learned)     │  │  (extracted) │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ consolidation
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Working Memory                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  Current Task   │  │  Active Files   │  │   Hypotheses │ │
│  │   Context       │  │   & Changes     │  │   & Plans    │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ attention
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Short-Term Memory                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Recent Commands │  │  Tool Results   │  │  Observations│ │
│  │   & Outputs     │  │  & Errors       │  │  & Notes     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// Memory hierarchy with automatic promotion/demotion
class HierarchicalMemory {
  private shortTerm: MemoryStore<ShortTermEntry>;
  private working: MemoryStore<WorkingEntry>;
  private longTerm: MemoryStore<LongTermEntry>;

  // Automatic consolidation based on relevance and recency
  async consolidate(): Promise<ConsolidationResult> {
    // Promote frequently accessed short-term to working
    // Consolidate stable working memory patterns to long-term
    // Prune irrelevant entries
  }

  // Context-aware retrieval
  async retrieve(query: string, context: TaskContext): Promise<MemoryResult[]> {
    // Search across all levels with relevance weighting
    // Prioritize working memory for current task
    // Include semantic matches from long-term
  }
}
```

## Meta-Agent: Build-Test-Improve Loop

### Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      Meta-Agent                            │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│  │  BUILD   │───▶│   TEST   │───▶│ IMPROVE  │────┐       │
│  │          │    │          │    │          │    │       │
│  │ Generate │    │ Evaluate │    │ Refine   │    │       │
│  │ Config   │    │ Results  │    │ Config   │    │       │
│  └──────────┘    └──────────┘    └──────────┘    │       │
│       ▲                                           │       │
│       └───────────────────────────────────────────┘       │
└───────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
interface MetaAgent {
  // Build: Generate agent configurations
  build(task: TaskSpec, context: ProjectContext): Promise<AgentConfig>;

  // Test: Evaluate configuration effectiveness
  test(config: AgentConfig, benchmark: Benchmark): Promise<TestResult>;

  // Improve: Refine based on results
  improve(config: AgentConfig, results: TestResult): Promise<AgentConfig>;

  // Full loop
  optimize(
    task: TaskSpec,
    context: ProjectContext,
    maxIterations: number
  ): Promise<OptimizedConfig>;
}

class MetaAgentImpl implements MetaAgent {
  async optimize(task, context, maxIterations = 3) {
    let config = await this.build(task, context);

    for (let i = 0; i < maxIterations; i++) {
      const result = await this.test(config, this.createBenchmark(task));

      if (result.score >= this.threshold) {
        return { config, iterations: i + 1, finalScore: result.score };
      }

      config = await this.improve(config, result);
    }

    return { config, iterations: maxIterations, finalScore: result.score };
  }
}
```

## Persistent Note-Taking System

### Cross-Session Continual Learning

```typescript
interface NoteTakingSystem {
  // Session notes
  notes: {
    capture(content: string, tags: string[]): Promise<Note>;
    search(query: string): Promise<Note[]>;
    summarize(sessionId: string): Promise<SessionSummary>;
  };

  // Cross-session insights
  insights: {
    extract(notes: Note[]): Promise<Insight[]>;
    consolidate(insights: Insight[]): Promise<Knowledge>;
    apply(knowledge: Knowledge, context: TaskContext): Promise<Guidance>;
  };

  // Learning loop
  learn: {
    fromSuccess(session: Session): Promise<LearnedPattern>;
    fromFailure(session: Session, error: Error): Promise<Gotcha>;
    fromFeedback(session: Session, feedback: UserFeedback): Promise<Preference>;
  };
}
```

### Storage Schema

```typescript
interface Note {
  id: string;
  sessionId: string;
  timestamp: Date;
  content: string;
  tags: string[];
  context: {
    projectPath?: string;
    folderId?: string;
    taskType?: string;
    agentProvider?: string;
  };
  embeddings?: number[]; // For semantic search
}

interface Insight {
  id: string;
  type: 'pattern' | 'convention' | 'gotcha' | 'skill';
  confidence: number;
  sourceNotes: string[];
  content: string;
  applicability: {
    projectTypes?: string[];
    taskTypes?: string[];
    conditions?: string[];
  };
}
```

## Modular Extension System

### Plugin Architecture

```typescript
interface Extension {
  id: string;
  name: string;
  version: string;

  // Lifecycle hooks
  onLoad(sdk: SDK): Promise<void>;
  onUnload(): Promise<void>;

  // Extension points
  tools?: ToolDefinition[];
  prompts?: PromptTemplate[];
  memory?: MemoryProvider[];
  ui?: UIComponent[];
}

class ExtensionRegistry {
  private extensions: Map<string, Extension> = new Map();

  async register(extension: Extension): Promise<void> {
    await extension.onLoad(this.sdk);
    this.extensions.set(extension.id, extension);

    // Register tools
    extension.tools?.forEach(t => this.sdk.tools.register(t));

    // Register prompts
    extension.prompts?.forEach(p => this.sdk.prompts.register(p));
  }

  async unregister(extensionId: string): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (ext) {
      await ext.onUnload();
      this.extensions.delete(extensionId);
    }
  }
}
```

### Tool Builder

```typescript
// Fluent API for defining tools
const myTool = SDK.tool('analyze-dependencies')
  .description('Analyze project dependencies for vulnerabilities')
  .input({
    projectPath: z.string().describe('Path to project'),
    depth: z.number().optional().default(3),
  })
  .output({
    vulnerabilities: z.array(VulnerabilitySchema),
    outdated: z.array(OutdatedPackageSchema),
  })
  .handler(async (input, context) => {
    // Implementation
  })
  .build();
```

## SDK API Design

### Core SDK Interface

```typescript
interface RemoteDevSDK {
  // Three perspectives
  ax: AgentExperience;
  ux: UserExperience;
  dx: DeveloperExperience;

  // Core services
  orchestrator: OrchestratorService;
  sessions: SessionService;
  memory: HierarchicalMemory;
  meta: MetaAgent;
  notes: NoteTakingSystem;

  // Extension system
  extensions: ExtensionRegistry;
  tools: ToolRegistry;

  // Configuration
  config: SDKConfig;
}

// Usage example
const sdk = createRemoteDevSDK({
  database: 'sqlite.db',
  orchestrator: {
    monitoringInterval: 30,
    stallThreshold: 300,
  },
});

// Register custom extension
await sdk.extensions.register(myExtension);

// Use meta-agent to optimize for a task
const optimizedConfig = await sdk.meta.optimize(
  { type: 'feature', description: 'Add user authentication' },
  { projectPath: '/path/to/project' },
  3 // max iterations
);

// Create session with optimized config
const session = await sdk.sessions.create({
  name: 'Auth Feature',
  config: optimizedConfig.config,
});
```

## New Features to Add

Based on CCA, here are priority features for Remote Dev:

### 1. Hierarchical Working Memory (Priority: HIGH)
- Structured context management across sessions
- Automatic consolidation and pruning
- Semantic search across memory levels

### 2. Meta-Agent (Priority: HIGH)
- Build-test-improve loop for config optimization
- Automated CLAUDE.md refinement
- Task-specific configuration generation

### 3. Enhanced Note-Taking (Priority: MEDIUM)
- Structured notes with embeddings
- Cross-session insight extraction
- Automatic knowledge consolidation

### 4. Extension System (Priority: MEDIUM)
- Plugin architecture for custom tools
- Fluent API for tool definition
- Hot-reload support for development

### 5. Three-Perspective SDK (Priority: LOW)
- Clean separation of AX/UX/DX concerns
- Optimized APIs for each perspective
- Comprehensive TypeScript types

## Implementation Phases

### Phase 1: Hierarchical Memory (2-3 weeks)
1. Design memory schema and storage
2. Implement memory stores with SQLite
3. Add consolidation logic
4. Integrate with existing knowledge system

### Phase 2: Meta-Agent (2-3 weeks)
1. Design config generation templates
2. Implement build-test-improve loop
3. Add benchmark framework
4. Integrate with orchestrator

### Phase 3: Enhanced Learning (1-2 weeks)
1. Add structured note-taking
2. Implement embedding-based search
3. Add insight extraction
4. Create knowledge browser UI

### Phase 4: Extension System (2 weeks)
1. Design plugin architecture
2. Implement extension registry
3. Create tool builder API
4. Add hot-reload support

### Phase 5: SDK Packaging (1 week)
1. Clean API design
2. TypeScript types
3. Documentation
4. npm package publishing

## Directory Structure

```
crates/
  rdv-sdk/              # Rust SDK core
    src/
      lib.rs
      memory/           # Hierarchical memory
      meta/             # Meta-agent
      extensions/       # Extension system

packages/
  @remote-dev/sdk/      # TypeScript SDK
    src/
      index.ts
      ax/               # Agent Experience
      ux/               # User Experience
      dx/               # Developer Experience
      memory/
      meta/
      extensions/
```

## References

- [Confucius Code Agent Paper](https://arxiv.org/abs/2512.10398)
- [SWE-Bench Pro Benchmark](https://www.swebench.com/)
- [Remote Dev Architecture](../ARCHITECTURE.md)
