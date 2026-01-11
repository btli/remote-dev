# Remote Dev SDK

Internal SDK for building and extending the Remote Dev platform. This SDK is **not published to npm** - it's integrated directly into the application.

## Architecture: Three-Perspective Design (AX/UX/DX)

The SDK follows a "Three-Perspective Architecture" inspired by Confucian philosophy:

```
┌─────────────────────────────────────────────────────────────┐
│                     Remote Dev SDK                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Agent (AX)    │    User (UX)    │    Developer (DX)       │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Memory        │ • Dashboard     │ • Extensions            │
│ • Tools         │ • Insights      │ • Tool Builder          │
│ • Context       │ • Sessions      │ • Templates             │
│                 │ • Knowledge     │ • API                   │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### Agent Experience (AX)
Optimizes how AI agents interact with the system:
- **Memory**: Hierarchical three-tier memory (short-term, working, long-term)
- **Tools**: Tool registry for available tools and execution
- **Context**: Task and project context management

### User Experience (UX)
Optimizes human interaction with the system:
- **Dashboard**: Orchestrator monitoring and status
- **Insights**: Notification system for stall detection and suggestions
- **Sessions**: Session management and control
- **Knowledge**: Project knowledge browser

### Developer Experience (DX)
Enables extension and customization:
- **Extensions**: Load/unload custom extensions
- **Tool Builder**: Fluent API for creating tools
- **Templates**: Configuration template engine
- **API**: Direct HTTP and programmatic access

## Quick Start

```typescript
import { createRemoteDevSDK } from "@/sdk";

const sdk = createRemoteDevSDK({
  userId: "user-123",
  apiBaseUrl: "http://localhost:6001",
});

await sdk.initialize();

// Agent Experience (AX)
await sdk.ax.memory.remember("Important context");
const tools = sdk.ax.tools.getAll();

// User Experience (UX)
const sessions = await sdk.ux.sessions.getActiveSessions();
const insights = await sdk.ux.insights.getUnread();

// Developer Experience (DX)
const extensions = await sdk.dx.extensions.list();
sdk.dx.tools.register(myCustomTool);

await sdk.shutdown();
```

## Directory Structure

```
src/sdk/
├── index.ts           # Main entry point - exports createRemoteDevSDK
├── core/              # Core SDK implementation
│   ├── sdk.ts         # Main SDK factory (createRemoteDevSDK)
│   ├── config.ts      # Configuration utilities
│   ├── http-client.ts # HTTP client for API calls
│   └── *.test.ts      # Unit tests
├── types/             # TypeScript type definitions
│   ├── index.ts       # Main types (775+ lines)
│   ├── memory.ts      # Memory system types
│   ├── meta-agent.ts  # Meta-agent types
│   └── extensions.ts  # Extension system types
├── extensions/        # Extension system (placeholder)
├── memory/            # Memory system (placeholder)
├── meta-agent/        # Meta-agent system (placeholder)
├── services/          # Service implementations (placeholder)
└── utils/             # Utility functions (placeholder)
```

## SDK Configuration

```typescript
interface SDKConfig {
  databasePath: string;      // Default: "sqlite.db"
  apiBaseUrl: string;        // Default: "http://localhost:6001"
  userId: string;            // Required
  folderId?: string;         // Optional folder scope
  projectPath?: string;      // Optional project path

  memory: {
    shortTermTtl: number;    // Default: 3600 (1 hour)
    maxWorkingEntries: number; // Default: 100
    consolidationInterval: number; // Default: 300 (5 min)
  };

  metaAgent: {
    maxIterations: number;   // Default: 3
    targetScore: number;     // Default: 0.9
    autoOptimize: boolean;   // Default: false
  };

  orchestrator: {
    monitoringInterval: number; // Default: 30
    stallThreshold: number;  // Default: 300 (5 min)
    autoIntervention: boolean; // Default: false
  };
}
```

## React Hooks

The SDK provides React hooks for common operations:

```typescript
import { useSessionMemory } from "@/hooks/useSessionMemory";
import { useNotes } from "@/hooks/useNotes";
import { useMetaAgent } from "@/hooks/useMetaAgent";
import { useExtensions } from "@/hooks/useExtensions";
import { useSdkInsights } from "@/hooks/useSdkInsights";
```

### useSessionMemory
Manages session-scoped memory queries and actions.

```typescript
const {
  memories,        // Grouped by tier
  allMemories,     // Flat list
  loading,
  error,
  refresh,
  pinToWorking,
  dismiss,
  deleteMemory,
  promoteToLongTerm,
  storeMemory,
  counts,
} = useSessionMemory({ sessionId, folderId });
```

### useNotes
Full CRUD operations for session notes.

```typescript
const {
  notes,
  loading,
  error,
  refresh,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  toggleArchive,
  counts,
} = useNotes({ sessionId, folderId });
```

### useMetaAgent
Meta-agent operations for building and optimizing agent configurations.

```typescript
const {
  loading,
  error,
  build,          // Build config from task/context
  test,           // Test against benchmark
  improve,        // Improve based on results
  optimize,       // Iterative optimization
  getSuggestions, // Get refinement suggestions
  applySuggestion,
  getTemplates,
  createBenchmark,
} = useMetaAgent();
```

### useExtensions
Extension management for loading and configuring extensions.

```typescript
const {
  extensions,     // Loaded extensions
  available,      // Available but not loaded
  loading,
  error,
  load,
  unload,
  enable,
  disable,
  updateConfig,
  register,
  tools,          // All tools from extensions
  prompts,        // All prompts
  uiComponents,   // All UI components
  getTool,
  getPrompt,
  hasPermission,
} = useExtensions();
```

## Services Layer

The SDK exposes core services:

```typescript
sdk.services.orchestrator   // Orchestrator control
sdk.services.sessions       // Session management
sdk.services.memory         // Hierarchical memory
sdk.services.metaAgent      // Meta-agent system
sdk.services.notes          // Note-taking service
```

## API-Backed Implementation

All SDK operations are backed by REST API calls:

| SDK Method | API Endpoint |
|------------|--------------|
| `ax.memory.remember()` | `POST /api/sdk/memory` |
| `ax.memory.recall()` | `POST /api/sdk/memory/query` |
| `ux.sessions.list()` | `GET /api/sessions` |
| `ux.insights.getUnread()` | `GET /api/sdk/insights?read=false` |
| `dx.extensions.load()` | `POST /api/sdk/extensions/:id/load` |
| `services.notes.capture()` | `POST /api/sdk/notes` |

## Testing

The SDK includes comprehensive unit tests:

```bash
# Run SDK tests
bun test src/sdk

# Run with coverage
bun test src/sdk --coverage
```

Test files:
- `src/sdk/core/sdk.test.ts` - Main SDK tests (900+ lines)
- `src/sdk/core/config.test.ts` - Configuration tests
- `src/sdk/core/http-client.test.ts` - HTTP client tests

## Type Exports

All types are re-exported from `src/sdk/types`:

```typescript
// Core SDK types
export type {
  RemoteDevSDK,
  SDKConfig,
  CreateSDKOptions,
  SDKServices,
} from "@/sdk";

// Perspective types
export type {
  AgentExperience,
  UserExperience,
  DeveloperExperience,
} from "@/sdk";

// Memory types
export type {
  IHierarchicalMemory,
  IMemoryStore,
  MemoryResult,
  ShortTermEntry,
  WorkingEntry,
  LongTermEntry,
} from "@/sdk";

// Meta-agent types
export type {
  IMetaAgent,
  TaskSpec,
  ProjectContext,
  AgentConfig,
  Benchmark,
  BenchmarkResult,
  OptimizationResult,
} from "@/sdk";

// Extension types
export type {
  IExtensionRegistry,
  ToolDefinition,
  PromptTemplate,
  ExtensionManifest,
  LoadedExtension,
} from "@/sdk";
```

## Internal Use Only

This SDK is designed for internal use within Remote Dev. It is:
- Not published to npm
- Tightly integrated with the Remote Dev API
- Uses the same database and authentication

For external integrations, use the REST API directly or the MCP server.
