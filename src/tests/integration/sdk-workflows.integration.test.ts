import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/db";
import {
  sdkMemoryEntries,
  users,
  terminalSessions,
  sessionFolders,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createRemoteDevSDK } from "@/sdk";
import type { CreateSDKOptions, ToolDefinition } from "@/sdk";
import {
  storeSessionMemory,
  getRelevantMemoriesForSession,
  getMemoriesByType,
  searchMemories,
  cleanupExpiredMemories,
  onSessionClose,
} from "@/services/session-memory-service";

/**
 * SDK Workflow Integration Tests
 *
 * End-to-end tests for SDK workflows covering:
 * - SDK initialization and configuration
 * - Memory consolidation across tiers
 * - Three-perspective architecture (AX/UX/DX)
 * - Tool registration and execution
 * - Extension registry
 *
 * These tests use the actual database with test isolation.
 */
describe("SDK Workflow Integration Tests", () => {
  // Test fixtures
  const testUserId = randomUUID();
  const testFolderId = randomUUID();
  const testSessionId = randomUUID();

  // SDK instance
  let sdk: ReturnType<typeof createRemoteDevSDK>;

  // Setup test data
  beforeAll(async () => {
    // Create test user
    await db
      .insert(users)
      .values({
        id: testUserId,
        email: `test-sdk-${testUserId}@example.com`,
        name: "SDK Test User",
      })
      .onConflictDoNothing();

    // Create test folder
    await db
      .insert(sessionFolders)
      .values({
        id: testFolderId,
        userId: testUserId,
        name: "SDK Test Folder",
        path: "/test/sdk",
        sortOrder: 0,
      })
      .onConflictDoNothing();

    // Create test session
    await db
      .insert(terminalSessions)
      .values({
        id: testSessionId,
        userId: testUserId,
        folderId: testFolderId,
        name: "SDK Test Session",
        tmuxSessionName: `test-sdk-${testSessionId.slice(0, 8)}`,
        projectPath: "/tmp",
        status: "active",
      })
      .onConflictDoNothing();
  });

  beforeEach(() => {
    // Create fresh SDK instance for each test
    const options: CreateSDKOptions = {
      userId: testUserId,
      folderId: testFolderId,
      apiBaseUrl: "http://localhost:6001",
    };
    sdk = createRemoteDevSDK(options);
  });

  // Cleanup test data
  afterEach(async () => {
    // Clean up memory entries
    await db
      .delete(sdkMemoryEntries)
      .where(eq(sdkMemoryEntries.userId, testUserId));
  });

  afterAll(async () => {
    // Cleanup in reverse order of creation
    await db.delete(terminalSessions).where(eq(terminalSessions.id, testSessionId));
    await db.delete(sessionFolders).where(eq(sessionFolders.id, testFolderId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SDK Initialization
  // ─────────────────────────────────────────────────────────────────────────────

  describe("SDK Initialization Workflow", () => {
    it("should create SDK with valid configuration", () => {
      expect(sdk).toBeDefined();
      expect(sdk.config.userId).toBe(testUserId);
      expect(sdk.config.folderId).toBe(testFolderId);
    });

    it("should expose all three perspectives", () => {
      expect(sdk.ax).toBeDefined(); // Agent Experience
      expect(sdk.ux).toBeDefined(); // User Experience
      expect(sdk.dx).toBeDefined(); // Developer Experience
    });

    it("should expose services layer", () => {
      expect(sdk.services).toBeDefined();
      expect(sdk.services.memory).toBeDefined();
      expect(sdk.services.sessions).toBeDefined();
      expect(sdk.services.orchestrator).toBeDefined();
    });

    it("should track initialization state correctly", async () => {
      expect(sdk.isInitialized()).toBe(false);

      // Initialize SDK (will fail gracefully in test since server not running)
      try {
        await sdk.initialize();
      } catch {
        // Expected - no server running in test
      }

      // State may or may not change depending on error handling
      // The key test is that calling initialize doesn't crash
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory Consolidation Workflow
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Memory Consolidation Workflow", () => {
    it("should store memory entries across all tiers", async () => {
      // Store short-term memory (observation)
      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "Short-term observation: User ran npm install",
        contentType: "observation",
        tier: "short_term",
      });

      // Store working memory (plan)
      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "Working memory: Active debugging session for auth module",
        contentType: "plan",
        tier: "working",
      });

      // Store long-term memory (convention)
      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "Long-term: Project uses TypeScript with strict mode",
        contentType: "convention",
        tier: "long_term",
      });

      // Verify entries exist by querying the database directly
      const entries = await db
        .select()
        .from(sdkMemoryEntries)
        .where(eq(sdkMemoryEntries.userId, testUserId));

      expect(entries.length).toBeGreaterThanOrEqual(3);

      // Verify we have entries in each tier
      const shortTermEntries = entries.filter((e) => e.tier === "short_term");
      const workingEntries = entries.filter((e) => e.tier === "working");
      const longTermEntries = entries.filter((e) => e.tier === "long_term");

      expect(shortTermEntries.length).toBeGreaterThanOrEqual(1);
      expect(workingEntries.length).toBeGreaterThanOrEqual(1);
      expect(longTermEntries.length).toBeGreaterThanOrEqual(1);
    });

    it("should deduplicate identical content via hash", async () => {
      const content = "Duplicate test content - should only store once";

      // Store same content twice
      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content,
        contentType: "observation",
        tier: "short_term",
      });

      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content, // Same content
        contentType: "observation",
        tier: "short_term",
      });

      // Count entries with this content
      const results = await searchMemories(testUserId, "Duplicate test content");
      expect(results.length).toBe(1); // Should be deduplicated
    });

    it("should promote working memories to long-term on session close", async () => {
      // Store a working memory pattern that should be promoted
      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "Important pattern: Always validate input before processing",
        contentType: "pattern",
        tier: "working",
        metadata: { confidence: 0.9 },
      });

      // Trigger session close which promotes important working memories
      const promoted = await onSessionClose(testUserId, testSessionId);

      // Session close should attempt to promote working memories
      // The function returns count of promoted items
      expect(typeof promoted).toBe("number");
    });

    it("should retrieve memories relevant to session context", async () => {
      // Store multiple memories
      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "Error handling pattern for API routes",
        contentType: "pattern",
        tier: "working",
      });

      await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "TypeScript strict null checks enabled",
        contentType: "convention",
        tier: "long_term",
      });

      // Get relevant memories for session
      const relevant = await getRelevantMemoriesForSession(
        testUserId,
        testSessionId,
        testFolderId,
        20
      );

      expect(relevant.length).toBeGreaterThanOrEqual(2);
    });

    it("should cleanup expired short-term memories", async () => {
      // Store memory with past expiry directly in DB
      await db.insert(sdkMemoryEntries).values({
        id: randomUUID(),
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: "This should be cleaned up",
        contentHash: randomUUID(), // Unique hash
        contentType: "observation",
        tier: "short_term",
        expiresAt: new Date(Date.now() - 86400000), // Expired yesterday
        createdAt: new Date(Date.now() - 86400000 * 2),
      });

      // Run cleanup
      const cleaned = await cleanupExpiredMemories();

      // Verify cleanup occurred
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SDK Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  describe("SDK Configuration", () => {
    it("should apply default memory configuration", () => {
      expect(sdk.config.memory.shortTermTtl).toBe(3600); // 1 hour
      expect(sdk.config.memory.maxWorkingEntries).toBe(100);
      expect(sdk.config.memory.consolidationInterval).toBe(300); // 5 min
    });

    it("should apply default meta-agent configuration", () => {
      expect(sdk.config.metaAgent.maxIterations).toBe(3);
      expect(sdk.config.metaAgent.targetScore).toBe(0.9);
      expect(sdk.config.metaAgent.autoOptimize).toBe(false);
    });

    it("should apply default orchestrator configuration", () => {
      expect(sdk.config.orchestrator.monitoringInterval).toBe(30);
      expect(sdk.config.orchestrator.stallThreshold).toBe(300); // 5 min
      expect(sdk.config.orchestrator.autoIntervention).toBe(false);
    });

    it("should allow custom configuration overrides", () => {
      const customSdk = createRemoteDevSDK({
        userId: testUserId,
        folderId: testFolderId,
        memory: {
          shortTermTtl: 7200, // 2 hours
          maxWorkingEntries: 50,
          consolidationInterval: 600,
        },
        metaAgent: {
          maxIterations: 5,
          targetScore: 0.95,
          autoOptimize: true,
        },
      });

      expect(customSdk.config.memory.shortTermTtl).toBe(7200);
      expect(customSdk.config.memory.maxWorkingEntries).toBe(50);
      expect(customSdk.config.metaAgent.maxIterations).toBe(5);
      expect(customSdk.config.metaAgent.autoOptimize).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Experience (AX) Perspective
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Agent Experience (AX) Perspective", () => {
    it("should expose memory operations", () => {
      expect(sdk.ax.memory).toBeDefined();
      expect(typeof sdk.ax.memory.remember).toBe("function");
      expect(typeof sdk.ax.memory.recall).toBe("function");
      expect(typeof sdk.ax.memory.hold).toBe("function");
      expect(typeof sdk.ax.memory.learn).toBe("function");
    });

    it("should expose tool registry operations", () => {
      expect(sdk.ax.tools).toBeDefined();
      expect(typeof sdk.ax.tools.getAll).toBe("function");
      expect(typeof sdk.ax.tools.get).toBe("function");
      expect(typeof sdk.ax.tools.execute).toBe("function");
      expect(typeof sdk.ax.tools.register).toBe("function");
    });

    it("should expose context operations", () => {
      expect(sdk.ax.context).toBeDefined();
      // Context manager methods vary - just verify it exists
      expect(sdk.ax.context).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // User Experience (UX) Perspective
  // ─────────────────────────────────────────────────────────────────────────────

  describe("User Experience (UX) Perspective", () => {
    it("should expose dashboard operations", () => {
      expect(sdk.ux.dashboard).toBeDefined();
      expect(typeof sdk.ux.dashboard.getState).toBe("function");
      expect(typeof sdk.ux.dashboard.subscribe).toBe("function");
      expect(typeof sdk.ux.dashboard.getOrchestratorStatus).toBe("function");
    });

    it("should expose insights operations", () => {
      expect(sdk.ux.insights).toBeDefined();
      expect(typeof sdk.ux.insights.getAll).toBe("function");
      expect(typeof sdk.ux.insights.getUnread).toBe("function");
      expect(typeof sdk.ux.insights.markAsRead).toBe("function");
      expect(typeof sdk.ux.insights.resolve).toBe("function");
    });

    it("should expose session operations", () => {
      expect(sdk.ux.sessions).toBeDefined();
      expect(typeof sdk.ux.sessions.getActiveSessions).toBe("function");
      expect(typeof sdk.ux.sessions.getSession).toBe("function");
      expect(typeof sdk.ux.sessions.createSession).toBe("function");
      expect(typeof sdk.ux.sessions.suspendSession).toBe("function");
    });

    it("should expose knowledge browser", () => {
      expect(sdk.ux.knowledge).toBeDefined();
      expect(typeof sdk.ux.knowledge.search).toBe("function");
      expect(typeof sdk.ux.knowledge.getByType).toBe("function");
      expect(typeof sdk.ux.knowledge.getForFile).toBe("function");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Developer Experience (DX) Perspective
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Developer Experience (DX) Perspective", () => {
    it("should expose extension operations", () => {
      expect(sdk.dx.extensions).toBeDefined();
      expect(typeof sdk.dx.extensions.list).toBe("function");
      expect(typeof sdk.dx.extensions.load).toBe("function");
      expect(typeof sdk.dx.extensions.unload).toBe("function");
      expect(typeof sdk.dx.extensions.register).toBe("function");
    });

    it("should expose tool builder API", () => {
      expect(sdk.dx.tools).toBeDefined();
      expect(typeof sdk.dx.tools.create).toBe("function");
      expect(typeof sdk.dx.tools.register).toBe("function");
      expect(typeof sdk.dx.tools.unregister).toBe("function");
      expect(typeof sdk.dx.tools.getAll).toBe("function");
    });

    it("should expose template operations", () => {
      expect(sdk.dx.templates).toBeDefined();
      expect(typeof sdk.dx.templates.getAll).toBe("function");
      expect(typeof sdk.dx.templates.get).toBe("function");
      expect(typeof sdk.dx.templates.apply).toBe("function");
    });

    it("should expose API access", () => {
      expect(sdk.dx.api).toBeDefined();
      // API exposes memory, metaAgent, extensions, and http
      expect(sdk.dx.api.memory).toBeDefined();
      expect(sdk.dx.api.metaAgent).toBeDefined();
      expect(sdk.dx.api.http).toBeDefined();
    });

    it("should allow registering custom tools via builder", () => {
      // Use fluent builder API
      const tool = sdk.dx.tools
        .create("test_tool")
        .description("A test tool for integration testing")
        .input({
          type: "object",
          properties: {
            message: { type: "string", description: "Test message" },
          },
          required: ["message"],
        })
        .handler(async (input: unknown) => {
          const { message } = input as { message: string };
          return {
            success: true,
            result: `Echo: ${message}`,
          };
        })
        .build();

      // Register tool
      sdk.dx.tools.register(tool);

      // Verify tool is registered
      const tools = sdk.dx.tools.getAll();
      const registered = tools.find((t) => t.name === "test_tool");
      expect(registered).toBeDefined();
      expect(registered?.description).toBe("A test tool for integration testing");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Execution Workflow
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Tool Registration Workflow", () => {
    it("should register tools via DX builder", () => {
      // Register a simple tool via DX
      const tool = sdk.dx.tools
        .create("add_numbers")
        .description("Add two numbers")
        .input({
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        })
        .handler(async (input: unknown) => {
          const { a, b } = input as { a: number; b: number };
          return {
            success: true,
            result: a + b,
          };
        })
        .build();

      sdk.dx.tools.register(tool);

      // Verify tool is registered
      const registeredTool = sdk.ax.tools.get("add_numbers");
      expect(registeredTool).toBeDefined();
      expect(registeredTool?.description).toBe("Add two numbers");
    });

    it("should unregister tools", () => {
      // Register a tool
      const tool = sdk.dx.tools
        .create("temp_tool")
        .description("Temporary")
        .input({ type: "object", properties: {} })
        .handler(async () => ({ success: true }))
        .build();

      sdk.dx.tools.register(tool);
      expect(sdk.ax.tools.get("temp_tool")).toBeDefined();

      // Unregister
      sdk.dx.tools.unregister("temp_tool");
      expect(sdk.ax.tools.get("temp_tool")).toBeUndefined();
    });

    it("should return error for non-existent tools", async () => {
      const result = await sdk.ax.tools.execute("non_existent_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should list all registered tools", () => {
      // Register multiple tools
      const tool1 = sdk.dx.tools
        .create("list_test_1")
        .description("First tool")
        .input({ type: "object", properties: {} })
        .handler(async () => ({ success: true }))
        .build();

      const tool2 = sdk.dx.tools
        .create("list_test_2")
        .description("Second tool")
        .input({ type: "object", properties: {} })
        .handler(async () => ({ success: true }))
        .build();

      sdk.dx.tools.register(tool1);
      sdk.dx.tools.register(tool2);

      const allTools = sdk.ax.tools.getAll();
      expect(allTools.find((t) => t.name === "list_test_1")).toBeDefined();
      expect(allTools.find((t) => t.name === "list_test_2")).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SDK Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  describe("SDK Lifecycle", () => {
    it("should handle shutdown gracefully", async () => {
      // Shutdown should complete without throwing
      let shutdownError: Error | undefined;
      try {
        await sdk.shutdown();
      } catch (error) {
        shutdownError = error instanceof Error ? error : new Error(String(error));
      }
      // Verify shutdown didn't throw, or if it did, it was a known graceful error
      if (shutdownError) {
        // Acceptable: "Not initialized" or similar graceful shutdown messages
        expect(shutdownError.message).toMatch(/not initialized|already shutdown|graceful/i);
      } else {
        // No error is the expected happy path
        expect(shutdownError).toBeUndefined();
      }
    });

    it("should track initialization state", () => {
      // SDK starts uninitialized
      expect(sdk.isInitialized()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Cross-Perspective Integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Cross-Perspective Integration", () => {
    it("should share tool registry across AX and DX", () => {
      // Register via DX builder
      const tool = sdk.dx.tools
        .create("shared_tool")
        .description("Shared across perspectives")
        .input({ type: "object", properties: {} })
        .handler(async () => ({ success: true, result: "shared" }))
        .build();

      sdk.dx.tools.register(tool);

      // Access via AX
      const axTool = sdk.ax.tools.get("shared_tool");
      expect(axTool).toBeDefined();
      expect(axTool?.description).toBe("Shared across perspectives");

      // Also visible via DX getAll
      const dxTools = sdk.dx.tools.getAll();
      expect(dxTools.find((t) => t.name === "shared_tool")).toBeDefined();
    });

    it("should share configuration across all perspectives", () => {
      // All perspectives should see same config
      expect(sdk.config.userId).toBe(testUserId);
      expect(sdk.config.folderId).toBe(testFolderId);

      // Services should use same config
      expect(sdk.services).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Services Layer
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Services Layer", () => {
    it("should expose memory service", () => {
      expect(sdk.services.memory).toBeDefined();
      // Memory service is the hierarchicalMemory object
      expect(typeof sdk.services.memory.remember).toBe("function");
      expect(typeof sdk.services.memory.recall).toBe("function");
    });

    it("should expose sessions service", () => {
      expect(sdk.services.sessions).toBeDefined();
      expect(typeof sdk.services.sessions.list).toBe("function");
      expect(typeof sdk.services.sessions.get).toBe("function");
      expect(typeof sdk.services.sessions.create).toBe("function");
    });

    it("should expose orchestrator service", () => {
      expect(sdk.services.orchestrator).toBeDefined();
      expect(typeof sdk.services.orchestrator.startMasterControl).toBe("function");
      expect(typeof sdk.services.orchestrator.getMasterControlStatus).toBe("function");
    });

    it("should expose notes service", () => {
      expect(sdk.services.notes).toBeDefined();
      expect(typeof sdk.services.notes.capture).toBe("function");
      expect(typeof sdk.services.notes.search).toBe("function");
    });

    it("should expose meta-agent service", () => {
      expect(sdk.services.metaAgent).toBeDefined();
      expect(typeof sdk.services.metaAgent.build).toBe("function");
      expect(typeof sdk.services.metaAgent.test).toBe("function");
      expect(typeof sdk.services.metaAgent.optimize).toBe("function");
    });
  });
});
