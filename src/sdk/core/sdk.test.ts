/**
 * SDK Main Module Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRemoteDevSDK } from "./sdk";
import type {
  CreateSDKOptions,
  ToolDefinition,
  TaskContext,
  TaskSpec,
  ToolResult,
  ProjectContext,
  ToolContext,
} from "../types";

// Type for our mock fetch function
type MockFetch = ReturnType<typeof vi.fn> & typeof fetch;

describe("createRemoteDevSDK", () => {
  const originalFetch = global.fetch;
  let mockFetch: MockFetch;

  // Helper to create a typed mock fetch
  function createMockFetch(): MockFetch {
    const mock = vi.fn() as MockFetch;
    mock.preconnect = vi.fn();
    return mock;
  }

  const defaultOptions: CreateSDKOptions = {
    userId: "user-123",
    folderId: "folder-456",
    apiBaseUrl: "http://localhost:6001",
  };

  beforeEach(() => {
    mockFetch = createMockFetch();
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({}),
    });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("SDK creation", () => {
    it("should create SDK with valid options", () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      expect(sdk).toBeDefined();
      expect(sdk.ax).toBeDefined();
      expect(sdk.ux).toBeDefined();
      expect(sdk.dx).toBeDefined();
      expect(sdk.services).toBeDefined();
      expect(sdk.config).toBeDefined();
    });

    it("should throw on invalid config (missing userId)", () => {
      expect(() => createRemoteDevSDK({ userId: "" })).toThrow("requires a userId");
    });

    it("should apply default config values", () => {
      const sdk = createRemoteDevSDK({ userId: "user-123" });

      expect(sdk.config.databasePath).toBe("sqlite.db");
      expect(sdk.config.apiBaseUrl).toBe("http://localhost:6001");
      expect(sdk.config.memory.shortTermTtl).toBe(3600);
    });

    it("should not be initialized on creation", () => {
      const sdk = createRemoteDevSDK(defaultOptions);
      expect(sdk.isInitialized()).toBe(false);
    });
  });

  describe("initialize", () => {
    it("should set initialized state", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve([]), // Empty tools list
      });

      const sdk = createRemoteDevSDK(defaultOptions);

      expect(sdk.isInitialized()).toBe(false);
      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);
    });

    it("should be idempotent", async () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      await sdk.initialize();
      await sdk.initialize(); // Second call should not throw

      expect(sdk.isInitialized()).toBe(true);
    });

    it("should detect project context if projectPath provided", async () => {
      const projectContext: ProjectContext = {
        projectPath: "/my/project",
        projectType: "web",
        language: "typescript",
        frameworks: ["next.js"],
        packageManager: "bun",
        hasCI: false,
      };
      mockFetch.mockImplementation(async (url: string) => ({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(
          url.includes("/project/detect") ? projectContext : []
        ),
      }));

      const sdk = createRemoteDevSDK({
        ...defaultOptions,
        projectPath: "/my/project",
      });

      await sdk.initialize();

      expect(sdk.ax.context.getProjectContext()).toEqual(projectContext);
    });

    it("should handle project detection failure gracefully", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/project/detect")) {
          return {
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            text: () => Promise.resolve("Detection failed"),
          };
        }
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve([]),
        };
      });

      const sdk = createRemoteDevSDK({
        ...defaultOptions,
        projectPath: "/my/project",
      });

      // Should not throw
      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);
      expect(sdk.ax.context.getProjectContext()).toBeNull();
    });
  });

  describe("shutdown", () => {
    it("should clear initialized state", async () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);

      await sdk.shutdown();
      expect(sdk.isInitialized()).toBe(false);
    });

    it("should clear all state", async () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      // Initialize first (shutdown only clears state if initialized)
      await sdk.initialize();

      // Setup some state
      const taskSpec: TaskSpec = {
        id: "task-1",
        description: "Test task",
        complexity: 5,
        type: "feature",
      };
      const taskContext: TaskContext = {
        taskId: "task-1",
        taskSpec,
        state: "in_progress",
        activeFiles: [],
        notes: [],
        startedAt: new Date(),
      };
      sdk.ax.context.setTaskContext(taskContext);
      sdk.ax.tools.register({
        name: "test-tool",
        description: "Test tool",
        inputSchema: { type: "object" },
        handler: async (): Promise<ToolResult> => ({ success: true }),
      });

      await sdk.shutdown();

      expect(sdk.ax.context.getTaskContext()).toBeNull();
      expect(sdk.ax.tools.getAll()).toHaveLength(0);
    });

    it("should be safe to call when not initialized", async () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      // Should not throw
      await sdk.shutdown();
      expect(sdk.isInitialized()).toBe(false);
    });
  });

  describe("Agent Experience (AX)", () => {
    describe("memory", () => {
      it("should have hierarchical memory interface", () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const memory = sdk.ax.memory;

        expect(memory.remember).toBeDefined();
        expect(memory.hold).toBeDefined();
        expect(memory.learn).toBeDefined();
        expect(memory.recall).toBeDefined();
        expect(memory.getTaskContext).toBeDefined();
        expect(memory.getFileContext).toBeDefined();
        expect(memory.consolidate).toBeDefined();
        expect(memory.clearTask).toBeDefined();
        expect(memory.getStats).toBeDefined();
      });

      it("should call API for remember operation", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const entry = { id: "mem-1", tier: "short_term", content: "test" };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(entry),
        });

        await sdk.ax.memory.remember("Test observation");

        expect(mockFetch).toHaveBeenCalled();
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain("/api/sdk/memory");
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.content).toBe("Test observation");
        expect(body.tier).toBe("short_term");
      });

      it("should call API for hold operation", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const entry = { id: "mem-2", tier: "working", content: "file context" };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(entry),
        });

        await sdk.ax.memory.hold("File context", { taskId: "task-1" });

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain("/api/sdk/memory");
        const body = JSON.parse(options.body);
        expect(body.tier).toBe("working");
        expect(body.taskId).toBe("task-1");
      });

      it("should call API for learn operation", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const entry = { id: "mem-3", tier: "long_term", content: "pattern" };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(entry),
        });

        await sdk.ax.memory.learn({
          content: "Pattern description",
          contentType: "pattern",
          name: "Error handling pattern",
          description: "How to handle errors properly",
          confidence: 0.9,
        });

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain("/api/sdk/memory");
        const body = JSON.parse(options.body);
        expect(body.tier).toBe("long_term");
        expect(body.contentType).toBe("pattern");
      });
    });

    describe("tools", () => {
      it("should register and retrieve tools", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool: ToolDefinition = {
          name: "my-tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: { input: { type: "string" } } },
          handler: async (): Promise<ToolResult> => ({ success: true, data: { result: "success" } }),
        };

        sdk.ax.tools.register(tool);

        expect(sdk.ax.tools.get("my-tool")).toEqual(tool);
        expect(sdk.ax.tools.getAll()).toContain(tool);
      });

      it("should unregister tools", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool: ToolDefinition = {
          name: "temp-tool",
          description: "Temporary",
          inputSchema: { type: "object" },
          handler: async (): Promise<ToolResult> => ({ success: true }),
        };

        sdk.ax.tools.register(tool);
        expect(sdk.ax.tools.get("temp-tool")).toBeDefined();

        sdk.ax.tools.unregister("temp-tool");
        expect(sdk.ax.tools.get("temp-tool")).toBeUndefined();
      });

      it("should execute tools via API", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool: ToolDefinition = {
          name: "api-tool",
          description: "API tool",
          inputSchema: { type: "object" },
          handler: async (): Promise<ToolResult> => ({ success: true }),
        };
        sdk.ax.tools.register(tool);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ data: { result: "executed" } }),
        });

        const result = await sdk.ax.tools.execute("api-tool", { input: "test" });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: "executed" });
        expect(result.toolName).toBe("api-tool");
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });

      it("should return error for unknown tool", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const result = await sdk.ax.tools.execute("unknown-tool", {});

        expect(result.success).toBe(false);
        expect(result.error).toContain("Tool not found");
      });

      it("should handle tool execution failure", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool: ToolDefinition = {
          name: "failing-tool",
          description: "Fails",
          inputSchema: { type: "object" },
          handler: async (): Promise<ToolResult> => ({ success: false, error: "Failed" }),
        };
        sdk.ax.tools.register(tool);

        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("Tool execution failed"),
        });

        const result = await sdk.ax.tools.execute("failing-tool", {});

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe("context", () => {
      it("should manage task context", () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const context = sdk.ax.context;

        expect(context.getTaskContext()).toBeNull();

        const taskSpec: TaskSpec = {
          id: "task-123",
          description: "Implement feature",
          complexity: 8,
          type: "feature",
        };
        const taskContext: TaskContext = {
          taskId: "task-123",
          taskSpec,
          state: "in_progress",
          currentStep: "planning",
          activeFiles: ["src/feature.ts"],
          notes: ["Started implementation"],
          startedAt: new Date(),
        };

        context.setTaskContext(taskContext);
        expect(context.getTaskContext()).toEqual(taskContext);

        context.clearTaskContext();
        expect(context.getTaskContext()).toBeNull();
      });

      it("should manage project context", () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const context = sdk.ax.context;

        expect(context.getProjectContext()).toBeNull();

        const projectContext: ProjectContext = {
          projectPath: "/path/to/project",
          projectType: "web",
          language: "typescript",
          frameworks: ["next.js", "tailwind"],
          packageManager: "bun",
          hasCI: true,
        };

        context.setProjectContext(projectContext);
        expect(context.getProjectContext()).toEqual(projectContext);
      });

      it("should retrieve relevant memory", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const memories = [
          { id: "m1", content: "relevant memory", score: 0.9 },
        ];
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(memories),
        });

        const taskSpec: TaskSpec = {
          id: "task-1",
          description: "Find bugs",
          complexity: 5,
          type: "bugfix",
        };
        const taskContext: TaskContext = {
          taskId: "task-1",
          taskSpec,
          state: "in_progress",
          activeFiles: [],
          notes: [],
          startedAt: new Date(),
        };
        sdk.ax.context.setTaskContext(taskContext);

        const result = await sdk.ax.context.getRelevantMemory();

        expect(result).toEqual(memories);
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe("User Experience (UX)", () => {
    describe("dashboard", () => {
      it("should get dashboard state via API", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const dashboardState = {
          activeSessions: 5,
          sessionsByStatus: { active: 3, suspended: 2 },
          activeOrchestrators: 2,
          pendingInsights: 3,
          recentActivity: [],
        };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(dashboardState),
        });

        const state = await sdk.ux.dashboard.getState();

        expect(state).toEqual(dashboardState);
      });

      it("should support subscriptions", () => {
        const sdk = createRemoteDevSDK(defaultOptions);
        const callback = vi.fn();

        const unsubscribe = sdk.ux.dashboard.subscribe(callback);

        expect(typeof unsubscribe).toBe("function");
        unsubscribe(); // Should not throw
      });
    });

    describe("insights", () => {
      it("should get unread insights", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const insights = [
          { id: "i1", title: "Session stalled", severity: "warning", read: false },
        ];
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(insights),
        });

        const result = await sdk.ux.insights.getUnread();

        expect(result).toEqual(insights);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain("read=false");
      });

      it("should mark insight as read", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({}),
        });

        await sdk.ux.insights.markAsRead("insight-123");

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain("/api/sdk/insights/insight-123");
        expect(options.method).toBe("PATCH");
        const body = JSON.parse(options.body);
        expect(body.read).toBe(true);
      });

      it("should resolve insight", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({}),
        });

        await sdk.ux.insights.resolve("insight-123", "Fixed the issue");

        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.resolved).toBe(true);
        expect(body.resolution).toBe("Fixed the issue");
      });
    });

    describe("sessions", () => {
      it("should get active sessions", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const sessions = [
          { id: "s1", name: "Session 1", status: "active" },
        ];
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(sessions),
        });

        const result = await sdk.ux.sessions.getActiveSessions();

        expect(result).toEqual(sessions);
      });

      it("should create session", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const newSession = { id: "new-session", name: "My Session", status: "active" };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(newSession),
        });

        const result = await sdk.ux.sessions.createSession({
          name: "My Session",
          projectPath: "/my/project",
        });

        expect(result).toEqual(newSession);
      });

      it("should suspend session", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({}),
        });

        await sdk.ux.sessions.suspendSession("session-123");

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain("/api/sessions/session-123/suspend");
        expect(options.method).toBe("POST");
      });
    });

    describe("knowledge", () => {
      it("should search knowledge", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const searchResult = {
          entries: [{ entry: { id: "k1", type: "pattern" }, score: 0.9 }],
          total: 1,
        };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(searchResult),
        });

        const result = await sdk.ux.knowledge.search("error handling");

        expect(result).toEqual(searchResult);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain("query=error+handling");
      });

      it("should get knowledge stats", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const stats = {
          total: 100,
          byType: { pattern: 40, convention: 30, gotcha: 20, skill: 10 },
          avgConfidence: 0.85,
        };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(stats),
        });

        const result = await sdk.ux.knowledge.getStats();

        expect(result).toEqual(stats);
      });
    });
  });

  describe("Developer Experience (DX)", () => {
    describe("tool builder", () => {
      it("should create tools using fluent API", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool = sdk.dx.tools
          .create("my-custom-tool")
          .description("A custom tool")
          .input({ type: "object", properties: { message: { type: "string" } } })
          .output({ type: "object", properties: { result: { type: "string" } } })
          .handler(async (_input: unknown, _context: ToolContext): Promise<ToolResult> => ({
            success: true,
            data: { result: "Processed" },
          }))
          .build();

        expect(tool.name).toBe("my-custom-tool");
        expect(tool.description).toBe("A custom tool");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
      });

      it("should throw if tool is incomplete", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        expect(() => {
          sdk.dx.tools.create("incomplete").build();
        }).toThrow("must have name, description, inputSchema, and handler");
      });

      it("should support dangerous flag", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool = sdk.dx.tools
          .create("danger-tool")
          .description("Dangerous operation")
          .input({ type: "object" })
          .handler(async (): Promise<ToolResult> => ({ success: true }))
          .dangerous(true)
          .build();

        expect(tool.dangerous).toBe(true);
      });

      it("should support timeout configuration", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const tool = sdk.dx.tools
          .create("slow-tool")
          .description("Slow operation")
          .input({ type: "object" })
          .handler(async (): Promise<ToolResult> => ({ success: true }))
          .timeout(30000)
          .build();

        expect(tool.timeoutMs).toBe(30000);
      });
    });

    describe("extensions", () => {
      it("should track loaded extensions", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        // Initially empty
        expect(sdk.dx.extensions.list()).toHaveLength(0);
      });

      it("should get tools from extensions", () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        // Initially no tools from extensions
        expect(sdk.dx.extensions.getTools()).toHaveLength(0);
      });
    });

    describe("templates", () => {
      it("should get all templates", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const templates = [
          { id: "t1", name: "TypeScript Template" },
        ];
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(templates),
        });

        const result = await sdk.dx.templates.getAll();

        expect(result).toEqual(templates);
      });

      it("should apply template", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const agentConfig = { model: "claude-3-opus", temperature: 0.7 };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(agentConfig),
        });

        const result = await sdk.dx.templates.apply("template-1", {
          projectName: "my-app",
        });

        expect(result).toEqual(agentConfig);
      });
    });
  });

  describe("Services", () => {
    describe("orchestrator service", () => {
      it("should start master control", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({}),
        });

        await sdk.services.orchestrator.startMasterControl();

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain("/api/sdk/orchestrator/master/start");
        expect(options.method).toBe("POST");
      });

      it("should get master control status", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const status = {
          id: "master-1",
          type: "master",
          status: "running",
          monitoredSessions: 5,
        };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(status),
        });

        const result = await sdk.services.orchestrator.getMasterControlStatus();

        expect(result).toEqual(status);
      });

      it("should return null if master control not found", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: () => Promise.resolve("Not found"),
        });

        const result = await sdk.services.orchestrator.getMasterControlStatus();

        expect(result).toBeNull();
      });
    });

    describe("session service", () => {
      it("should list sessions with filters", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const sessions = [{ id: "s1", status: "active" }];
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(sessions),
        });

        const result = await sdk.services.sessions.list({
          status: "active",
          folderId: "folder-1",
          limit: 10,
        });

        expect(result).toEqual(sessions);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain("status=active");
        expect(url).toContain("folderId=folder-1");
        expect(url).toContain("limit=10");
      });

      it("should get session scrollback", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ scrollback: "$ echo hello\nhello" }),
        });

        const result = await sdk.services.sessions.getScrollback("session-1", 100);

        expect(result).toBe("$ echo hello\nhello");
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain("lines=100");
      });
    });

    describe("notes service", () => {
      it("should capture note", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        const note = { id: "n1", content: "Important finding", tags: ["bug"] };
        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(note),
        });

        const result = await sdk.services.notes.capture("Important finding", ["bug"]);

        expect(result).toEqual(note);
        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.content).toBe("Important finding");
        expect(body.tags).toEqual(["bug"]);
      });

      it("should summarize session", async () => {
        const sdk = createRemoteDevSDK(defaultOptions);

        mockFetch.mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ summary: "Session implemented feature X" }),
        });

        const result = await sdk.services.notes.summarizeSession("session-1");

        expect(result).toBe("Session implemented feature X");
      });
    });
  });

  describe("API access", () => {
    it("should expose memory store API", () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      expect(sdk.dx.api.memory).toBeDefined();
      expect(sdk.dx.api.memory.store).toBeDefined();
      expect(sdk.dx.api.memory.get).toBeDefined();
      expect(sdk.dx.api.memory.retrieve).toBeDefined();
      expect(sdk.dx.api.memory.delete).toBeDefined();
    });

    it("should expose meta-agent API", () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      expect(sdk.dx.api.metaAgent).toBeDefined();
      expect(sdk.dx.api.metaAgent.build).toBeDefined();
      expect(sdk.dx.api.metaAgent.test).toBeDefined();
      expect(sdk.dx.api.metaAgent.improve).toBeDefined();
    });

    it("should expose HTTP client", () => {
      const sdk = createRemoteDevSDK(defaultOptions);

      expect(sdk.dx.api.http).toBeDefined();
      expect(sdk.dx.api.http.get).toBeDefined();
      expect(sdk.dx.api.http.post).toBeDefined();
      expect(sdk.dx.api.http.put).toBeDefined();
      expect(sdk.dx.api.http.patch).toBeDefined();
      expect(sdk.dx.api.http.delete).toBeDefined();
    });
  });
});
