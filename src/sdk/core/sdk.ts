/**
 * Remote Dev SDK Implementation
 *
 * Main SDK class that ties together all three perspectives (AX/UX/DX).
 */

import type {
  RemoteDevSDK,
  SDKConfig,
  CreateSDKOptions,
  SDKServices,
  AgentExperience,
  UserExperience,
  DeveloperExperience,
  // Services
  OrchestratorService,
  SessionService,
  NoteTakingService,
  // AX components
  ToolRegistry,
  ContextManager,
  TaskContext,
  ToolDefinition,
  ToolExecutionOptions,
  ToolExecutionResult,
  ToolContext,
  JSONSchema,
  ExtensionPermission,
  // UX components
  OrchestratorDashboard,
  InsightNotificationSystem,
  SessionManager,
  KnowledgeBrowser,
  DashboardState,
  OrchestratorStatus,
  Insight,
  InsightQueryOptions,
  InsightPage,
  SessionInfo,
  CreateSessionOptions,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeEntry,
  KnowledgeStats,
  SessionListOptions,
  Note,
  InsightExtraction,
  // DX components
  ToolBuilderAPI,
  ConfigTemplateEngine,
  SDKAPI,
  IToolBuilder,
  ConfigTemplateInfo,
  AgentConfig,
  ToolExample,
  ToolHandler,
  // Memory
  IHierarchicalMemory,
  IMemoryStore,
  MemoryResult,
  RecallContext,
  MemoryStats,
  StoreMemoryInput,
  MemoryQuery,
  ShortTermEntry,
  WorkingEntry,
  LongTermEntry,
  ConsolidationResult,
  RememberOptions,
  HoldOptions,
  LearnInput,
  PruneOptions,
  // Meta-agent
  IMetaAgent,
  TaskSpec,
  ProjectContext,
  Benchmark,
  BenchmarkResult,
  OptimizationResult,
  OptimizationOptions,
  RefinementSuggestion,
  // Extensions
  IExtensionRegistry,
  ExtensionManifest,
  LoadedExtension,
  PromptTemplate,
} from "../types";

import { createConfig, validateConfig } from "./config";
import { createHttpClient } from "./http-client";

/**
 * Create a new Remote Dev SDK instance.
 */
export function createRemoteDevSDK(options: CreateSDKOptions): RemoteDevSDK {
  const config = createConfig(options);
  validateConfig(config);

  const httpClient = createHttpClient(config.apiBaseUrl);

  // Internal state
  let initialized = false;
  let taskContext: TaskContext | null = null;
  let projectContext: ProjectContext | null = null;
  const registeredTools: Map<string, ToolDefinition> = new Map();
  const insightSubscribers: Set<(insight: Insight) => void> = new Set();
  const sessionSubscribers: Set<(sessions: SessionInfo[]) => void> = new Set();
  const dashboardSubscribers: Set<(state: DashboardState) => void> = new Set();

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory Implementation (API-based)
  // ─────────────────────────────────────────────────────────────────────────────

  const memoryStore: IMemoryStore = {
    async store(input: StoreMemoryInput): Promise<ShortTermEntry | WorkingEntry | LongTermEntry> {
      return httpClient.post<ShortTermEntry | WorkingEntry | LongTermEntry>("/api/sdk/memory", input);
    },

    async get(id: string): Promise<ShortTermEntry | WorkingEntry | LongTermEntry | null> {
      try {
        return await httpClient.get<ShortTermEntry | WorkingEntry | LongTermEntry>(`/api/sdk/memory/${id}`);
      } catch {
        return null;
      }
    },

    async retrieve(query: MemoryQuery): Promise<MemoryResult[]> {
      return httpClient.post<MemoryResult[]>("/api/sdk/memory/query", query);
    },

    async update(
      id: string,
      updates: Partial<ShortTermEntry | WorkingEntry | LongTermEntry>
    ): Promise<ShortTermEntry | WorkingEntry | LongTermEntry> {
      return httpClient.patch<ShortTermEntry | WorkingEntry | LongTermEntry>(`/api/sdk/memory/${id}`, updates);
    },

    async delete(id: string): Promise<void> {
      await httpClient.delete(`/api/sdk/memory/${id}`);
    },

    async recordAccess(id: string): Promise<void> {
      await httpClient.post(`/api/sdk/memory/${id}/access`, {});
    },

    async promote(
      id: string,
      targetTier: "short_term" | "working" | "long_term"
    ): Promise<ShortTermEntry | WorkingEntry | LongTermEntry> {
      return httpClient.post<ShortTermEntry | WorkingEntry | LongTermEntry>(`/api/sdk/memory/${id}/promote`, {
        targetTier,
      });
    },

    async consolidate(
      userId: string,
      folderId?: string
    ): Promise<ConsolidationResult> {
      return httpClient.post<ConsolidationResult>("/api/sdk/memory/consolidate", {
        userId,
        folderId,
      });
    },

    async prune(
      userId: string,
      options?: PruneOptions
    ): Promise<number> {
      const result = await httpClient.post<{ pruned: number }>("/api/sdk/memory/prune", {
        userId,
        ...options,
      });
      return result.pruned;
    },

    async getStats(userId: string, folderId?: string): Promise<MemoryStats> {
      const params: Record<string, string> = { userId };
      if (folderId) params.folderId = folderId;
      return httpClient.get<MemoryStats>("/api/sdk/memory/stats", { params });
    },
  };

  const hierarchicalMemory: IHierarchicalMemory = {
    async remember(content: string, options?: RememberOptions): Promise<ShortTermEntry> {
      const entry = await memoryStore.store({
        sessionId: "",
        userId: config.userId,
        folderId: config.folderId,
        tier: "short_term",
        contentType: options?.contentType ?? "observation",
        content,
        ttl: options?.ttl ?? config.memory.shortTermTtl,
        metadata: options?.metadata as Record<string, unknown> | undefined,
      });
      return entry as ShortTermEntry;
    },

    async hold(content: string, options?: HoldOptions): Promise<WorkingEntry> {
      const entry = await memoryStore.store({
        sessionId: "",
        userId: config.userId,
        folderId: config.folderId,
        tier: "working",
        contentType: options?.contentType ?? "file_context",
        content,
        taskId: options?.taskId,
        priority: options?.priority,
        confidence: options?.confidence,
        metadata: options?.metadata as Record<string, unknown> | undefined,
      });
      return entry as WorkingEntry;
    },

    async learn(input: LearnInput): Promise<LongTermEntry> {
      const entry = await memoryStore.store({
        sessionId: "",
        userId: config.userId,
        folderId: config.folderId,
        tier: "long_term",
        contentType: input.contentType,
        content: input.content,
        name: input.name,
        description: input.description,
        confidence: input.confidence,
        metadata: input.metadata as Record<string, unknown> | undefined,
      });
      return entry as LongTermEntry;
    },

    async recall(
      query: string,
      context: RecallContext = {}
    ): Promise<MemoryResult[]> {
      return memoryStore.retrieve({
        query,
        userId: config.userId,
        folderId: config.folderId,
        taskId: context.taskId,
        minScore: context.minScore,
        limit: context.limitPerTier,
      });
    },

    async getTaskContext(taskId: string): Promise<MemoryResult[]> {
      return memoryStore.retrieve({
        userId: config.userId,
        folderId: config.folderId,
        taskId,
        tiers: ["working", "short_term"],
      });
    },

    async getFileContext(filePath: string): Promise<MemoryResult[]> {
      return memoryStore.retrieve({
        query: filePath,
        userId: config.userId,
        folderId: config.folderId,
      });
    },

    async consolidate(): Promise<ConsolidationResult> {
      return memoryStore.consolidate(config.userId, config.folderId);
    },

    async clearTask(taskId: string): Promise<number> {
      const response = await httpClient.post<{ cleared: number }>(
        "/api/sdk/memory/clear-task",
        { taskId }
      );
      return response.cleared;
    },

    async getStats(): Promise<MemoryStats> {
      return memoryStore.getStats(config.userId, config.folderId);
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Meta-Agent Implementation (API-based)
  // ─────────────────────────────────────────────────────────────────────────────

  const metaAgent: IMetaAgent = {
    async build(task: TaskSpec, context: ProjectContext): Promise<AgentConfig> {
      return httpClient.post<AgentConfig>("/api/sdk/meta-agent/build", {
        task,
        context,
      });
    },

    async test(
      agentConfig: AgentConfig,
      benchmark: Benchmark
    ): Promise<BenchmarkResult> {
      return httpClient.post<BenchmarkResult>("/api/sdk/meta-agent/test", {
        config: agentConfig,
        benchmark,
      });
    },

    async improve(
      agentConfig: AgentConfig,
      results: BenchmarkResult
    ): Promise<AgentConfig> {
      return httpClient.post<AgentConfig>("/api/sdk/meta-agent/improve", {
        config: agentConfig,
        results,
      });
    },

    async optimize(
      task: TaskSpec,
      context: ProjectContext,
      options?: OptimizationOptions
    ): Promise<OptimizationResult> {
      return httpClient.post<OptimizationResult>(
        "/api/sdk/meta-agent/optimize",
        { task, context, options }
      );
    },

    async createBenchmark(
      task: TaskSpec,
      context: ProjectContext
    ): Promise<Benchmark> {
      return httpClient.post<Benchmark>(
        "/api/sdk/meta-agent/create-benchmark",
        { task, context }
      );
    },

    async getSuggestions(
      agentConfig: AgentConfig,
      results: BenchmarkResult
    ): Promise<RefinementSuggestion[]> {
      return httpClient.post<RefinementSuggestion[]>(
        "/api/sdk/meta-agent/suggestions",
        { config: agentConfig, results }
      );
    },

    async applySuggestion(
      agentConfig: AgentConfig,
      suggestion: RefinementSuggestion
    ): Promise<AgentConfig> {
      return httpClient.post<AgentConfig>(
        "/api/sdk/meta-agent/apply-suggestion",
        { config: agentConfig, suggestion }
      );
    },

    async learnFromSuccess(
      agentConfig: AgentConfig,
      results: BenchmarkResult
    ): Promise<void> {
      await httpClient.post("/api/sdk/meta-agent/learn", {
        config: agentConfig,
        results,
      });
    },

    async getTemplates(projectType: string): Promise<AgentConfig[]> {
      return httpClient.get<AgentConfig[]>("/api/sdk/meta-agent/templates", {
        params: { projectType },
      });
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Extension Registry Implementation (API-based)
  // ─────────────────────────────────────────────────────────────────────────────

  // Local cache for loaded extensions
  const loadedExtensions: Map<string, LoadedExtension> = new Map();

  const extensionRegistry: IExtensionRegistry = {
    async register(manifest: ExtensionManifest): Promise<void> {
      await httpClient.post("/api/sdk/extensions", manifest);
    },

    async load(extensionId: string): Promise<LoadedExtension> {
      const extension = await httpClient.post<LoadedExtension>(
        `/api/sdk/extensions/${extensionId}/load`,
        {}
      );
      loadedExtensions.set(extensionId, extension);
      return extension;
    },

    async unload(extensionId: string): Promise<void> {
      await httpClient.post(`/api/sdk/extensions/${extensionId}/unload`, {});
      loadedExtensions.delete(extensionId);
    },

    async enable(extensionId: string): Promise<void> {
      await httpClient.post(`/api/sdk/extensions/${extensionId}/enable`, {});
    },

    async disable(extensionId: string): Promise<void> {
      await httpClient.post(`/api/sdk/extensions/${extensionId}/disable`, {});
    },

    list(): LoadedExtension[] {
      return Array.from(loadedExtensions.values());
    },

    get(extensionId: string): LoadedExtension | undefined {
      return loadedExtensions.get(extensionId);
    },

    getTools(): ToolDefinition[] {
      const tools: ToolDefinition[] = [];
      for (const ext of loadedExtensions.values()) {
        if (ext.tools) {
          tools.push(...ext.tools);
        }
      }
      return tools;
    },

    getTool(name: string): ToolDefinition | undefined {
      for (const ext of loadedExtensions.values()) {
        const tool = ext.tools?.find((t) => t.name === name);
        if (tool) return tool;
      }
      return undefined;
    },

    getPrompts(): PromptTemplate[] {
      const prompts: PromptTemplate[] = [];
      for (const ext of loadedExtensions.values()) {
        if (ext.prompts) {
          prompts.push(...ext.prompts);
        }
      }
      return prompts;
    },

    getPrompt(name: string): PromptTemplate | undefined {
      for (const ext of loadedExtensions.values()) {
        const prompt = ext.prompts?.find((p) => p.name === name);
        if (prompt) return prompt;
      }
      return undefined;
    },

    getUIComponents() {
      const components = [];
      for (const ext of loadedExtensions.values()) {
        if (ext.uiComponents) {
          components.push(...ext.uiComponents);
        }
      }
      return components;
    },

    hasPermission(extensionId: string, permission: ExtensionPermission): boolean {
      const ext = loadedExtensions.get(extensionId);
      if (!ext) return false;
      return ext.manifest.permissions?.includes(permission) ?? false;
    },

    async updateConfig(
      extensionId: string,
      newConfig: Record<string, unknown>
    ): Promise<void> {
      await httpClient.patch(`/api/sdk/extensions/${extensionId}/config`, newConfig);
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Experience (AX) Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  const toolRegistry: ToolRegistry = {
    getAll(): ToolDefinition[] {
      return Array.from(registeredTools.values());
    },

    get(name: string): ToolDefinition | undefined {
      return registeredTools.get(name);
    },

    async execute(
      name: string,
      input: Record<string, unknown>,
      options?: ToolExecutionOptions
    ): Promise<ToolExecutionResult> {
      const tool = registeredTools.get(name);
      const startTime = Date.now();

      if (!tool) {
        return {
          success: false,
          error: `Tool not found: ${name}`,
          durationMs: Date.now() - startTime,
          toolName: name,
        };
      }

      try {
        const result = await httpClient.post<{ data: unknown }>(
          "/api/sdk/tools/execute",
          {
            toolName: name,
            input,
            sessionId: options?.sessionId,
          },
          { timeoutMs: options?.timeoutMs, signal: options?.signal }
        );

        return {
          success: true,
          data: result.data,
          durationMs: Date.now() - startTime,
          toolName: name,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          durationMs: Date.now() - startTime,
          toolName: name,
        };
      }
    },

    register(tool: ToolDefinition): void {
      registeredTools.set(tool.name, tool);
    },

    unregister(name: string): void {
      registeredTools.delete(name);
    },
  };

  const contextManager: ContextManager = {
    getTaskContext(): TaskContext | null {
      return taskContext;
    },

    setTaskContext(context: TaskContext): void {
      taskContext = context;
    },

    clearTaskContext(): void {
      taskContext = null;
    },

    async getRelevantMemory(
      options?: RecallContext
    ): Promise<MemoryResult[]> {
      const query = taskContext?.taskSpec.description ?? "";
      return hierarchicalMemory.recall(query, {
        taskId: taskContext?.taskId,
        ...options,
      });
    },

    getProjectContext(): ProjectContext | null {
      return projectContext;
    },

    setProjectContext(context: ProjectContext): void {
      projectContext = context;
    },
  };

  const ax: AgentExperience = {
    memory: hierarchicalMemory,
    tools: toolRegistry,
    context: contextManager,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // User Experience (UX) Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  const dashboard: OrchestratorDashboard = {
    async getState(): Promise<DashboardState> {
      return httpClient.get<DashboardState>("/api/sdk/dashboard");
    },

    subscribe(callback: (state: DashboardState) => void): () => void {
      dashboardSubscribers.add(callback);
      return () => dashboardSubscribers.delete(callback);
    },

    async getOrchestratorStatus(
      orchestratorId: string
    ): Promise<OrchestratorStatus> {
      return httpClient.get<OrchestratorStatus>(
        `/api/orchestrators/${orchestratorId}`
      );
    },

    async getAllOrchestratorStatuses(): Promise<OrchestratorStatus[]> {
      return httpClient.get<OrchestratorStatus[]>("/api/orchestrators");
    },
  };

  const insightSystem: InsightNotificationSystem = {
    async getUnread(): Promise<Insight[]> {
      return httpClient.get<Insight[]>("/api/sdk/insights", {
        params: { read: "false" },
      });
    },

    async getAll(options?: InsightQueryOptions): Promise<InsightPage> {
      const params: Record<string, string> = {};
      if (options?.read !== undefined) params.read = String(options.read);
      if (options?.resolved !== undefined)
        params.resolved = String(options.resolved);
      if (options?.severity) params.severity = options.severity.join(",");
      if (options?.orchestratorId)
        params.orchestratorId = options.orchestratorId;
      if (options?.sessionId) params.sessionId = options.sessionId;
      if (options?.limit) params.limit = String(options.limit);
      if (options?.offset) params.offset = String(options.offset);

      return httpClient.get<InsightPage>("/api/sdk/insights", { params });
    },

    async markAsRead(insightId: string): Promise<void> {
      await httpClient.patch(`/api/sdk/insights/${insightId}`, { read: true });
    },

    async resolve(insightId: string, resolution?: string): Promise<void> {
      await httpClient.patch(`/api/sdk/insights/${insightId}`, {
        resolved: true,
        resolution,
      });
    },

    subscribe(callback: (insight: Insight) => void): () => void {
      insightSubscribers.add(callback);
      return () => insightSubscribers.delete(callback);
    },
  };

  const sessionManager: SessionManager = {
    async getActiveSessions(): Promise<SessionInfo[]> {
      return httpClient.get<SessionInfo[]>("/api/sessions", {
        params: { status: "active" },
      });
    },

    async getSession(sessionId: string): Promise<SessionInfo | null> {
      try {
        return await httpClient.get<SessionInfo>(`/api/sessions/${sessionId}`);
      } catch {
        return null;
      }
    },

    async createSession(options: CreateSessionOptions): Promise<SessionInfo> {
      return httpClient.post<SessionInfo>("/api/sessions", options);
    },

    async suspendSession(sessionId: string): Promise<void> {
      await httpClient.post(`/api/sessions/${sessionId}/suspend`, {});
    },

    async resumeSession(sessionId: string): Promise<void> {
      await httpClient.post(`/api/sessions/${sessionId}/resume`, {});
    },

    async closeSession(sessionId: string): Promise<void> {
      await httpClient.delete(`/api/sessions/${sessionId}`);
    },

    subscribe(callback: (sessions: SessionInfo[]) => void): () => void {
      sessionSubscribers.add(callback);
      return () => sessionSubscribers.delete(callback);
    },
  };

  const knowledgeBrowser: KnowledgeBrowser = {
    async search(
      query: string,
      options?: KnowledgeSearchOptions
    ): Promise<KnowledgeSearchResult> {
      const params: Record<string, string> = { query };
      if (options?.types) params.types = options.types.join(",");
      if (options?.minConfidence !== undefined)
        params.minConfidence = String(options.minConfidence);
      if (options?.limit) params.limit = String(options.limit);

      return httpClient.get<KnowledgeSearchResult>("/api/sdk/knowledge/search", {
        params,
      });
    },

    async getByType(type: string): Promise<KnowledgeEntry[]> {
      return httpClient.get<KnowledgeEntry[]>("/api/sdk/knowledge", {
        params: { type },
      });
    },

    async getForFile(filePath: string): Promise<KnowledgeEntry[]> {
      return httpClient.get<KnowledgeEntry[]>("/api/sdk/knowledge", {
        params: { filePath },
      });
    },

    async getAll(): Promise<KnowledgeEntry[]> {
      return httpClient.get<KnowledgeEntry[]>("/api/sdk/knowledge");
    },

    async getStats(): Promise<KnowledgeStats> {
      return httpClient.get<KnowledgeStats>("/api/sdk/knowledge/stats");
    },
  };

  const ux: UserExperience = {
    dashboard,
    insights: insightSystem,
    sessions: sessionManager,
    knowledge: knowledgeBrowser,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Developer Experience (DX) Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  const toolBuilder: ToolBuilderAPI = {
    create(name: string): IToolBuilder {
      const tool: Partial<ToolDefinition> & { examples?: ToolExample[] } = { name };

      const builder: IToolBuilder = {
        description(desc: string) {
          tool.description = desc;
          return builder;
        },
        input<T>(schema: JSONSchema): IToolBuilder<T, unknown> {
          tool.inputSchema = schema;
          return builder as IToolBuilder<T, unknown>;
        },
        output<T>(schema: JSONSchema): IToolBuilder<unknown, T> {
          tool.outputSchema = schema;
          return builder as IToolBuilder<unknown, T>;
        },
        handler(fn: ToolHandler) {
          tool.handler = fn;
          return builder;
        },
        example(ex: ToolExample) {
          if (!tool.examples) tool.examples = [];
          tool.examples.push(ex);
          return builder;
        },
        dangerous(isDangerous = true) {
          tool.dangerous = isDangerous;
          return builder;
        },
        timeout(ms: number) {
          tool.timeoutMs = ms;
          return builder;
        },
        permissions(...perms: ExtensionPermission[]) {
          tool.permissions = perms;
          return builder;
        },
        build(): ToolDefinition {
          if (!tool.name || !tool.description || !tool.inputSchema || !tool.handler) {
            throw new Error(
              "Tool must have name, description, inputSchema, and handler"
            );
          }
          const definition: ToolDefinition = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            handler: tool.handler,
          };
          if (tool.outputSchema) definition.outputSchema = tool.outputSchema;
          if (tool.permissions) definition.permissions = tool.permissions;
          if (tool.examples) definition.examples = tool.examples;
          if (tool.dangerous !== undefined) definition.dangerous = tool.dangerous;
          if (tool.timeoutMs !== undefined) definition.timeoutMs = tool.timeoutMs;
          return definition;
        },
      };

      return builder;
    },

    register(tool: ToolDefinition): void {
      registeredTools.set(tool.name, tool);
    },

    unregister(name: string): void {
      registeredTools.delete(name);
    },

    getAll(): ToolDefinition[] {
      return Array.from(registeredTools.values());
    },
  };

  const templateEngine: ConfigTemplateEngine = {
    async getAll(): Promise<ConfigTemplateInfo[]> {
      return httpClient.get<ConfigTemplateInfo[]>("/api/sdk/templates");
    },

    async get(templateId: string): Promise<ConfigTemplateInfo | null> {
      try {
        return await httpClient.get<ConfigTemplateInfo>(
          `/api/sdk/templates/${templateId}`
        );
      } catch {
        return null;
      }
    },

    async apply(
      templateId: string,
      variables: Record<string, unknown>
    ): Promise<AgentConfig> {
      return httpClient.post<AgentConfig>(
        `/api/sdk/templates/${templateId}/apply`,
        { variables }
      );
    },

    async createFromConfig(
      agentConfig: AgentConfig,
      name: string
    ): Promise<ConfigTemplateInfo> {
      return httpClient.post<ConfigTemplateInfo>("/api/sdk/templates", {
        config: agentConfig,
        name,
      });
    },

    async delete(templateId: string): Promise<void> {
      await httpClient.delete(`/api/sdk/templates/${templateId}`);
    },
  };

  const sdkApi: SDKAPI = {
    memory: memoryStore,
    metaAgent,
    extensions: extensionRegistry,
    http: httpClient,
  };

  const dx: DeveloperExperience = {
    extensions: extensionRegistry,
    tools: toolBuilder,
    templates: templateEngine,
    api: sdkApi,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Services Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  const orchestratorService: OrchestratorService = {
    async startMasterControl(): Promise<void> {
      await httpClient.post("/api/sdk/orchestrator/master/start", {});
    },

    async stopMasterControl(): Promise<void> {
      await httpClient.post("/api/sdk/orchestrator/master/stop", {});
    },

    async getMasterControlStatus(): Promise<OrchestratorStatus | null> {
      try {
        return await httpClient.get<OrchestratorStatus>(
          "/api/sdk/orchestrator/master"
        );
      } catch {
        return null;
      }
    },

    async startFolderOrchestrator(folderId: string): Promise<void> {
      await httpClient.post(`/api/folders/${folderId}/orchestrator`, {});
    },

    async stopFolderOrchestrator(folderId: string): Promise<void> {
      await httpClient.delete(`/api/folders/${folderId}/orchestrator`);
    },
  };

  const sessionService: SessionService = {
    async list(options?: SessionListOptions): Promise<SessionInfo[]> {
      const params: Record<string, string> = {};
      if (options?.status) params.status = options.status;
      if (options?.folderId) params.folderId = options.folderId;
      if (options?.agentProvider) params.agentProvider = options.agentProvider;
      if (options?.limit) params.limit = String(options.limit);

      return httpClient.get<SessionInfo[]>("/api/sessions", { params });
    },

    async get(sessionId: string): Promise<SessionInfo | null> {
      try {
        return await httpClient.get<SessionInfo>(`/api/sessions/${sessionId}`);
      } catch {
        return null;
      }
    },

    async create(options: CreateSessionOptions): Promise<SessionInfo> {
      return httpClient.post<SessionInfo>("/api/sessions", options);
    },

    async update(
      sessionId: string,
      updates: Partial<CreateSessionOptions>
    ): Promise<SessionInfo> {
      return httpClient.patch<SessionInfo>(`/api/sessions/${sessionId}`, updates);
    },

    async delete(sessionId: string): Promise<void> {
      await httpClient.delete(`/api/sessions/${sessionId}`);
    },

    async getScrollback(sessionId: string, lines = 100): Promise<string> {
      const response = await httpClient.get<{ scrollback: string }>(
        `/api/sessions/${sessionId}/scrollback`,
        { params: { lines: String(lines) } }
      );
      return response.scrollback;
    },
  };

  const noteService: NoteTakingService = {
    async capture(content: string, tags?: string[]): Promise<Note> {
      return httpClient.post<Note>("/api/sdk/notes", { content, tags });
    },

    async search(query: string): Promise<Note[]> {
      return httpClient.get<Note[]>("/api/sdk/notes", { params: { query } });
    },

    async summarizeSession(sessionId: string): Promise<string> {
      const response = await httpClient.get<{ summary: string }>(
        `/api/sdk/notes/summarize/${sessionId}`
      );
      return response.summary;
    },

    async extractInsights(noteIds: string[]): Promise<InsightExtraction[]> {
      return httpClient.post<InsightExtraction[]>(
        "/api/sdk/notes/extract-insights",
        { noteIds }
      );
    },
  };

  const services: SDKServices = {
    orchestrator: orchestratorService,
    sessions: sessionService,
    memory: hierarchicalMemory,
    metaAgent,
    notes: noteService,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Main SDK Object
  // ─────────────────────────────────────────────────────────────────────────────

  return {
    ax,
    ux,
    dx,
    services,
    config,

    async initialize(): Promise<void> {
      if (initialized) {
        return;
      }

      // Load registered tools from extensions
      const tools = await extensionRegistry.getTools();
      for (const tool of tools) {
        registeredTools.set(tool.name, tool);
      }

      // Detect project context if projectPath is provided
      if (config.projectPath) {
        try {
          projectContext = await httpClient.post<ProjectContext>(
            "/api/sdk/project/detect",
            { projectPath: config.projectPath }
          );
        } catch {
          // Project detection failed, context remains null
        }
      }

      initialized = true;
    },

    async shutdown(): Promise<void> {
      if (!initialized) {
        return;
      }

      // Clear state
      taskContext = null;
      projectContext = null;
      registeredTools.clear();
      insightSubscribers.clear();
      sessionSubscribers.clear();
      dashboardSubscribers.clear();

      initialized = false;
    },

    isInitialized(): boolean {
      return initialized;
    },
  };
}
