/**
 * SDK Core Types - Three-Perspective Architecture (AX/UX/DX)
 *
 * This module defines the core SDK interfaces following the Confucius-inspired
 * three-perspective design:
 *
 * - Agent Experience (AX): Optimizes how AI agents interact with the system
 * - User Experience (UX): Optimizes human interaction with the system
 * - Developer Experience (DX): Enables extension and customization
 */

// Re-export all type modules
export * from "./memory";
export * from "./meta-agent";
export * from "./extensions";

import type {
  IHierarchicalMemory,
  IMemoryStore,
  MemoryStats,
  RecallContext,
  MemoryResult,
} from "./memory";
import type {
  IMetaAgent,
  AgentConfig,
  TaskSpec,
  ProjectContext,
  OptimizationResult,
  OptimizationOptions,
} from "./meta-agent";
import type {
  IExtensionRegistry,
  ToolDefinition,
  PromptTemplate,
  UIComponentDefinition,
  IToolBuilder,
} from "./extensions";

// ─────────────────────────────────────────────────────────────────────────────
// Agent Experience (AX) Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent Experience (AX) - Components that optimize AI agent interaction.
 *
 * Provides:
 * - Hierarchical memory for context management
 * - Tool access and capabilities
 * - Context management
 */
export interface AgentExperience {
  /** Hierarchical working memory system */
  memory: IHierarchicalMemory;

  /** Tool registry for available tools */
  tools: ToolRegistry;

  /** Context manager for session context */
  context: ContextManager;
}

/** Registry of available tools for agents */
export interface ToolRegistry {
  /** Get all registered tools */
  getAll(): ToolDefinition[];

  /** Get a tool by name */
  get(name: string): ToolDefinition | undefined;

  /** Execute a tool */
  execute(
    name: string,
    input: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult>;

  /** Register a new tool */
  register(tool: ToolDefinition): void;

  /** Unregister a tool */
  unregister(name: string): void;
}

export interface ToolExecutionOptions {
  /** Session ID context */
  sessionId?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Result data */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Execution duration in ms */
  durationMs: number;
  /** Tool name that was executed */
  toolName: string;
}

/** Context manager for agent sessions */
export interface ContextManager {
  /** Get current task context */
  getTaskContext(): TaskContext | null;

  /** Set current task context */
  setTaskContext(context: TaskContext): void;

  /** Clear current task context */
  clearTaskContext(): void;

  /** Get relevant memory for current context */
  getRelevantMemory(options?: RecallContext): Promise<MemoryResult[]>;

  /** Get project context */
  getProjectContext(): ProjectContext | null;

  /** Update project context */
  setProjectContext(context: ProjectContext): void;
}

export interface TaskContext {
  /** Task ID */
  taskId: string;
  /** Task specification */
  taskSpec: TaskSpec;
  /** Current state */
  state: "pending" | "in_progress" | "completed" | "failed";
  /** Current step/phase */
  currentStep?: string;
  /** Files being worked on */
  activeFiles: string[];
  /** Notes/observations */
  notes: string[];
  /** Started at */
  startedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Experience (UX) Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User Experience (UX) - Components that optimize human interaction.
 *
 * Provides:
 * - Dashboard for monitoring
 * - Insight notifications
 * - Session control
 * - Knowledge browser
 */
export interface UserExperience {
  /** Dashboard for monitoring orchestrators */
  dashboard: OrchestratorDashboard;

  /** Insight notification system */
  insights: InsightNotificationSystem;

  /** Session manager */
  sessions: SessionManager;

  /** Knowledge browser */
  knowledge: KnowledgeBrowser;
}

/** Dashboard for monitoring orchestrators */
export interface OrchestratorDashboard {
  /** Get dashboard state */
  getState(): Promise<DashboardState>;

  /** Subscribe to state changes */
  subscribe(callback: (state: DashboardState) => void): () => void;

  /** Get orchestrator status */
  getOrchestratorStatus(orchestratorId: string): Promise<OrchestratorStatus>;

  /** Get all orchestrator statuses */
  getAllOrchestratorStatuses(): Promise<OrchestratorStatus[]>;
}

export interface DashboardState {
  /** Total active sessions */
  activeSessions: number;
  /** Sessions by status */
  sessionsByStatus: Record<string, number>;
  /** Active orchestrators */
  activeOrchestrators: number;
  /** Pending insights */
  pendingInsights: number;
  /** Recent activity */
  recentActivity: DashboardActivity[];
}

export interface DashboardActivity {
  /** Activity ID */
  id: string;
  /** Activity type */
  type: "session_created" | "session_closed" | "insight_generated" | "task_completed";
  /** Description */
  description: string;
  /** Timestamp */
  timestamp: Date;
  /** Related entity ID */
  entityId?: string;
}

export interface OrchestratorStatus {
  /** Orchestrator ID */
  id: string;
  /** Orchestrator type */
  type: "master" | "folder";
  /** Current status */
  status: "running" | "paused" | "stopped" | "error";
  /** Monitored sessions count */
  monitoredSessions: number;
  /** Pending insights count */
  pendingInsights: number;
  /** Last activity */
  lastActivityAt: Date | null;
}

/** Insight notification system */
export interface InsightNotificationSystem {
  /** Get unread insights */
  getUnread(): Promise<Insight[]>;

  /** Get all insights with pagination */
  getAll(options?: InsightQueryOptions): Promise<InsightPage>;

  /** Mark insight as read */
  markAsRead(insightId: string): Promise<void>;

  /** Mark insight as resolved */
  resolve(insightId: string, resolution?: string): Promise<void>;

  /** Subscribe to new insights */
  subscribe(callback: (insight: Insight) => void): () => void;
}

export interface Insight {
  /** Insight ID */
  id: string;
  /** Orchestrator that generated this */
  orchestratorId: string;
  /** Session this is about (if applicable) */
  sessionId?: string;
  /** Severity level */
  severity: "info" | "warning" | "error" | "critical";
  /** Insight title */
  title: string;
  /** Detailed message */
  message: string;
  /** Suggested actions */
  suggestedActions?: string[];
  /** Whether this has been read */
  read: boolean;
  /** Resolution status */
  resolved: boolean;
  /** Resolution message */
  resolution?: string;
  /** Created at */
  createdAt: Date;
}

export interface InsightQueryOptions {
  /** Filter by read status */
  read?: boolean;
  /** Filter by resolved status */
  resolved?: boolean;
  /** Filter by severity */
  severity?: string[];
  /** Filter by orchestrator */
  orchestratorId?: string;
  /** Filter by session */
  sessionId?: string;
  /** Limit */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface InsightPage {
  /** Insights on this page */
  items: Insight[];
  /** Total count */
  total: number;
  /** Has more pages */
  hasMore: boolean;
}

/** Session manager for UX */
export interface SessionManager {
  /** Get active sessions */
  getActiveSessions(): Promise<SessionInfo[]>;

  /** Get session by ID */
  getSession(sessionId: string): Promise<SessionInfo | null>;

  /** Create a new session */
  createSession(options: CreateSessionOptions): Promise<SessionInfo>;

  /** Suspend a session */
  suspendSession(sessionId: string): Promise<void>;

  /** Resume a session */
  resumeSession(sessionId: string): Promise<void>;

  /** Close a session */
  closeSession(sessionId: string): Promise<void>;

  /** Subscribe to session changes */
  subscribe(callback: (sessions: SessionInfo[]) => void): () => void;
}

export interface SessionInfo {
  /** Session ID */
  id: string;
  /** Session name */
  name: string;
  /** Status */
  status: "active" | "suspended" | "closed";
  /** Project path */
  projectPath: string | null;
  /** Folder ID */
  folderId: string | null;
  /** Agent provider */
  agentProvider: string | null;
  /** Created at */
  createdAt: Date;
  /** Last activity */
  lastActivityAt: Date;
}

export interface CreateSessionOptions {
  /** Session name */
  name: string;
  /** Project path */
  projectPath?: string;
  /** Folder ID */
  folderId?: string;
  /** Agent provider */
  agentProvider?: string;
  /** Initial command to run */
  initialCommand?: string;
}

/** Knowledge browser for exploring project knowledge */
export interface KnowledgeBrowser {
  /** Search knowledge */
  search(query: string, options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult>;

  /** Get knowledge by type */
  getByType(type: string): Promise<KnowledgeEntry[]>;

  /** Get knowledge for a file */
  getForFile(filePath: string): Promise<KnowledgeEntry[]>;

  /** Get all knowledge entries */
  getAll(): Promise<KnowledgeEntry[]>;

  /** Get knowledge statistics */
  getStats(): Promise<KnowledgeStats>;
}

export interface KnowledgeSearchOptions {
  /** Filter by type */
  types?: string[];
  /** Minimum confidence */
  minConfidence?: number;
  /** Maximum results */
  limit?: number;
}

export interface KnowledgeSearchResult {
  /** Matching entries */
  entries: Array<{
    entry: KnowledgeEntry;
    score: number;
  }>;
  /** Total matches */
  total: number;
}

export interface KnowledgeEntry {
  /** Entry ID */
  id: string;
  /** Entry type */
  type: "convention" | "pattern" | "gotcha" | "skill";
  /** Name */
  name: string;
  /** Description */
  description: string;
  /** Content */
  content: string;
  /** Confidence score */
  confidence: number;
  /** Source sessions */
  sourceSessions: string[];
  /** Created at */
  createdAt: Date;
}

export interface KnowledgeStats {
  /** Total entries */
  total: number;
  /** Entries by type */
  byType: Record<string, number>;
  /** Average confidence */
  avgConfidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Developer Experience (DX) Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Developer Experience (DX) - Components that enable extension and customization.
 *
 * Provides:
 * - Extension registry
 * - Tool builder
 * - Config templates
 * - SDK APIs
 */
export interface DeveloperExperience {
  /** Extension registry */
  extensions: IExtensionRegistry;

  /** Tool builder for creating custom tools */
  tools: ToolBuilderAPI;

  /** Configuration template engine */
  templates: ConfigTemplateEngine;

  /** SDK API for programmatic access */
  api: SDKAPI;
}

/** Tool builder API */
export interface ToolBuilderAPI {
  /** Create a new tool builder */
  create(name: string): IToolBuilder;

  /** Register a tool definition */
  register(tool: ToolDefinition): void;

  /** Unregister a tool */
  unregister(name: string): void;

  /** Get all registered tools */
  getAll(): ToolDefinition[];
}

/** Configuration template engine */
export interface ConfigTemplateEngine {
  /** Get all templates */
  getAll(): Promise<ConfigTemplateInfo[]>;

  /** Get template by ID */
  get(templateId: string): Promise<ConfigTemplateInfo | null>;

  /** Apply a template to generate a config */
  apply(templateId: string, variables: Record<string, unknown>): Promise<AgentConfig>;

  /** Create a template from an existing config */
  createFromConfig(config: AgentConfig, name: string): Promise<ConfigTemplateInfo>;

  /** Delete a template */
  delete(templateId: string): Promise<void>;
}

export interface ConfigTemplateInfo {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Description */
  description: string;
  /** Project types this applies to */
  projectTypes: string[];
  /** Task types this is good for */
  taskTypes: string[];
  /** Variables that can be customized */
  variables: TemplateVariableInfo[];
  /** Created at */
  createdAt: Date;
  /** Use count */
  useCount: number;
}

export interface TemplateVariableInfo {
  /** Variable name */
  name: string;
  /** Description */
  description: string;
  /** Default value */
  defaultValue: unknown;
  /** Whether required */
  required: boolean;
}

/** SDK API for programmatic access */
export interface SDKAPI {
  /** Memory API */
  memory: IMemoryStore;

  /** Meta-agent API */
  metaAgent: IMetaAgent;

  /** Extension API */
  extensions: IExtensionRegistry;

  /** HTTP client for custom requests */
  http: HTTPClient;
}

export interface HTTPClient {
  /** Make a GET request */
  get<T>(path: string, options?: HTTPRequestOptions): Promise<T>;

  /** Make a POST request */
  post<T>(path: string, body: unknown, options?: HTTPRequestOptions): Promise<T>;

  /** Make a PUT request */
  put<T>(path: string, body: unknown, options?: HTTPRequestOptions): Promise<T>;

  /** Make a PATCH request */
  patch<T>(path: string, body: unknown, options?: HTTPRequestOptions): Promise<T>;

  /** Make a DELETE request */
  delete<T>(path: string, options?: HTTPRequestOptions): Promise<T>;
}

export interface HTTPRequestOptions {
  /** Request headers */
  headers?: Record<string, string>;
  /** Query parameters */
  params?: Record<string, string>;
  /** Timeout in ms */
  timeoutMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main SDK Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remote Dev SDK - Main Entry Point
 *
 * Provides access to all three perspectives (AX/UX/DX) and core services.
 */
export interface RemoteDevSDK {
  /** Agent Experience (AX) */
  ax: AgentExperience;

  /** User Experience (UX) */
  ux: UserExperience;

  /** Developer Experience (DX) */
  dx: DeveloperExperience;

  /** Core services */
  services: SDKServices;

  /** SDK configuration */
  config: SDKConfig;

  /** Initialize the SDK */
  initialize(): Promise<void>;

  /** Shutdown the SDK */
  shutdown(): Promise<void>;

  /** Check if SDK is initialized */
  isInitialized(): boolean;
}

/** Core SDK services */
export interface SDKServices {
  /** Orchestrator service */
  orchestrator: OrchestratorService;

  /** Session service */
  sessions: SessionService;

  /** Memory service */
  memory: IHierarchicalMemory;

  /** Meta-agent service */
  metaAgent: IMetaAgent;

  /** Note-taking service */
  notes: NoteTakingService;
}

export interface OrchestratorService {
  /** Start master control */
  startMasterControl(): Promise<void>;

  /** Stop master control */
  stopMasterControl(): Promise<void>;

  /** Get master control status */
  getMasterControlStatus(): Promise<OrchestratorStatus | null>;

  /** Start folder orchestrator */
  startFolderOrchestrator(folderId: string): Promise<void>;

  /** Stop folder orchestrator */
  stopFolderOrchestrator(folderId: string): Promise<void>;
}

export interface SessionService {
  /** List sessions */
  list(options?: SessionListOptions): Promise<SessionInfo[]>;

  /** Get session */
  get(sessionId: string): Promise<SessionInfo | null>;

  /** Create session */
  create(options: CreateSessionOptions): Promise<SessionInfo>;

  /** Update session */
  update(sessionId: string, updates: Partial<CreateSessionOptions>): Promise<SessionInfo>;

  /** Delete session */
  delete(sessionId: string): Promise<void>;

  /** Get session scrollback */
  getScrollback(sessionId: string, lines?: number): Promise<string>;
}

export interface SessionListOptions {
  /** Filter by status */
  status?: string;
  /** Filter by folder */
  folderId?: string;
  /** Filter by agent provider */
  agentProvider?: string;
  /** Limit */
  limit?: number;
}

export interface NoteTakingService {
  /** Capture a note */
  capture(content: string, tags?: string[]): Promise<Note>;

  /** Search notes */
  search(query: string): Promise<Note[]>;

  /** Summarize session notes */
  summarizeSession(sessionId: string): Promise<string>;

  /** Extract insights from notes */
  extractInsights(noteIds: string[]): Promise<InsightExtraction[]>;
}

export interface Note {
  /** Note ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Content */
  content: string;
  /** Tags */
  tags: string[];
  /** Created at */
  createdAt: Date;
}

export interface InsightExtraction {
  /** Insight type */
  type: "convention" | "pattern" | "gotcha" | "skill";
  /** Name */
  name: string;
  /** Description */
  description: string;
  /** Confidence */
  confidence: number;
  /** Source notes */
  sourceNotes: string[];
}

/** SDK configuration */
export interface SDKConfig {
  /** Database path */
  databasePath: string;

  /** API base URL */
  apiBaseUrl: string;

  /** User ID */
  userId: string;

  /** Folder ID (optional) */
  folderId?: string;

  /** Project path (optional) */
  projectPath?: string;

  /** Memory configuration */
  memory: {
    /** Short-term TTL in seconds */
    shortTermTtl: number;
    /** Max working memory entries */
    maxWorkingEntries: number;
    /** Consolidation interval in seconds */
    consolidationInterval: number;
  };

  /** Meta-agent configuration */
  metaAgent: {
    /** Max optimization iterations */
    maxIterations: number;
    /** Target score */
    targetScore: number;
    /** Enable auto-optimization */
    autoOptimize: boolean;
  };

  /** Orchestrator configuration */
  orchestrator: {
    /** Monitoring interval in seconds */
    monitoringInterval: number;
    /** Stall threshold in seconds */
    stallThreshold: number;
    /** Enable auto-intervention */
    autoIntervention: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Factory
// ─────────────────────────────────────────────────────────────────────────────

/** Options for creating the SDK */
export interface CreateSDKOptions {
  /** Database path */
  databasePath?: string;

  /** API base URL */
  apiBaseUrl?: string;

  /** User ID (required) */
  userId: string;

  /** Folder ID */
  folderId?: string;

  /** Project path */
  projectPath?: string;

  /** Memory configuration overrides */
  memory?: Partial<SDKConfig["memory"]>;

  /** Meta-agent configuration overrides */
  metaAgent?: Partial<SDKConfig["metaAgent"]>;

  /** Orchestrator configuration overrides */
  orchestrator?: Partial<SDKConfig["orchestrator"]>;
}

/**
 * Create a new Remote Dev SDK instance.
 */
export type CreateSDKFunction = (options: CreateSDKOptions) => RemoteDevSDK;
