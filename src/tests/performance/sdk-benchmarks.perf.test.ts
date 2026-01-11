/**
 * SDK Performance Benchmarks
 *
 * Measures performance of SDK operations with target <100ms for common operations.
 * Includes memory usage monitoring and statistical analysis (P50, P95, P99).
 *
 * Run with: bun test src/tests/performance/sdk-benchmarks.perf.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { randomUUID } from "crypto";
import { db } from "@/db";
import {
  sdkMemoryEntries,
  sessionFolders,
  terminalSessions,
  users,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { storeSessionMemory } from "@/services/session-memory-service";
import { createRemoteDevSDK } from "@/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Performance Utilities
// ─────────────────────────────────────────────────────────────────────────────

interface PerformanceMetrics {
  samples: number[];
  min: number;
  max: number;
  mean: number;
  median: number;
  p50: number;
  p95: number;
  p99: number;
  stdDev: number;
  memoryDelta: number;
}

function calculatePercentile(sortedSamples: number[], percentile: number): number {
  const index = Math.ceil((percentile / 100) * sortedSamples.length) - 1;
  return sortedSamples[Math.max(0, index)];
}

function calculateMetrics(samples: number[], memoryDelta: number): PerformanceMetrics {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const squaredDiffs = sorted.map((s) => Math.pow(s - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
  const stdDev = Math.sqrt(variance);

  return {
    samples: sorted,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: calculatePercentile(sorted, 50),
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
    stdDev,
    memoryDelta,
  };
}

function formatMetrics(metrics: PerformanceMetrics, operationName: string): string {
  return [
    `\n📊 ${operationName} (${metrics.samples.length} samples)`,
    `   Min: ${metrics.min.toFixed(2)}ms`,
    `   Max: ${metrics.max.toFixed(2)}ms`,
    `   Mean: ${metrics.mean.toFixed(2)}ms`,
    `   P50: ${metrics.p50.toFixed(2)}ms`,
    `   P95: ${metrics.p95.toFixed(2)}ms`,
    `   P99: ${metrics.p99.toFixed(2)}ms`,
    `   StdDev: ${metrics.stdDev.toFixed(2)}ms`,
    `   Memory Delta: ${(metrics.memoryDelta / 1024).toFixed(2)}KB`,
  ].join("\n");
}

async function benchmark(
  fn: () => Promise<void>,
  iterations: number = 100
): Promise<PerformanceMetrics> {
  const samples: number[] = [];

  // Warm up (3 iterations)
  for (let i = 0; i < 3; i++) {
    await fn();
  }

  // Force GC before measuring (Bun supports this)
  if (typeof Bun !== "undefined" && Bun.gc) {
    Bun.gc(true);
  }

  const memBefore = process.memoryUsage().heapUsed;

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    samples.push(end - start);
  }

  const memAfter = process.memoryUsage().heapUsed;
  const memoryDelta = memAfter - memBefore;

  return calculateMetrics(samples, memoryDelta);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const testUserId = randomUUID();
const testFolderId = randomUUID();
const testSessionId = randomUUID();
const createdMemoryIds: string[] = [];
const BENCHMARK_ITERATIONS = 50; // Reduced for CI but statistically significant

describe("SDK Performance Benchmarks", () => {
  beforeAll(async () => {
    // Create test user
    await db.insert(users).values({
      id: testUserId,
      email: `perf-test-${testUserId}@example.com`,
      name: "Perf Test User",
    });

    // Create test folder
    await db.insert(sessionFolders).values({
      id: testFolderId,
      name: "Perf Test Folder",
      userId: testUserId,
      sortOrder: 0,
    });

    // Create test session
    await db.insert(terminalSessions).values({
      id: testSessionId,
      name: "perf-test-session",
      userId: testUserId,
      folderId: testFolderId,
      tmuxSessionName: `rdv-perf-${testSessionId.slice(0, 8)}`,
      projectPath: "/tmp/perf-test",
      status: "active",
    });

    // Seed some memory entries for recall benchmarks
    for (let i = 0; i < 100; i++) {
      const entryId = await storeSessionMemory({
        userId: testUserId,
        sessionId: testSessionId,
        folderId: testFolderId,
        content: `Benchmark memory entry ${i}: Testing performance of memory operations with varied content length ${i % 10 === 0 ? "with longer text to simulate real-world scenarios" : ""}`,
        contentType: "observation",
        tier: i % 3 === 0 ? "long_term" : i % 2 === 0 ? "working" : "short_term",
      });
      createdMemoryIds.push(entryId);
    }
  });

  afterAll(async () => {
    // Cleanup in reverse order of dependencies
    if (createdMemoryIds.length > 0) {
      await db
        .delete(sdkMemoryEntries)
        .where(inArray(sdkMemoryEntries.id, createdMemoryIds));
    }
    await db.delete(terminalSessions).where(eq(terminalSessions.id, testSessionId));
    await db.delete(sessionFolders).where(eq(sessionFolders.id, testFolderId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory Store Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Memory Store Operations", () => {
    it("storeSessionMemory should complete in <50ms (P95)", async () => {
      const tempIds: string[] = [];

      const metrics = await benchmark(async () => {
        const entryId = await storeSessionMemory({
          userId: testUserId,
          sessionId: testSessionId,
          folderId: testFolderId,
          content: `Performance test entry at ${Date.now()}`,
          contentType: "observation",
          tier: "short_term",
        });
        tempIds.push(entryId);
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "storeSessionMemory"));

      // Cleanup temp entries
      if (tempIds.length > 0) {
        await db.delete(sdkMemoryEntries).where(inArray(sdkMemoryEntries.id, tempIds));
      }

      // Assert P95 < 50ms
      expect(metrics.p95).toBeLessThan(50);
    });

    it("memory retrieval (SELECT) should complete in <20ms (P95)", async () => {
      const targetId = createdMemoryIds[0];

      const metrics = await benchmark(async () => {
        await db.query.sdkMemoryEntries.findFirst({
          where: eq(sdkMemoryEntries.id, targetId),
        });
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "memory retrieval (single)"));

      expect(metrics.p95).toBeLessThan(20);
    });

    it("memory query (multiple) should complete in <50ms (P95)", async () => {
      const metrics = await benchmark(async () => {
        await db.query.sdkMemoryEntries.findMany({
          where: eq(sdkMemoryEntries.userId, testUserId),
          limit: 50,
        });
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "memory query (multiple)"));

      expect(metrics.p95).toBeLessThan(50);
    });

    it("memory update should complete in <30ms (P95)", async () => {
      const targetId = createdMemoryIds[0];

      const metrics = await benchmark(async () => {
        await db
          .update(sdkMemoryEntries)
          .set({ accessCount: Math.floor(Math.random() * 100) })
          .where(eq(sdkMemoryEntries.id, targetId));
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "memory update"));

      expect(metrics.p95).toBeLessThan(30);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SDK Factory Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("SDK Factory Operations", () => {
    it("createRemoteDevSDK should complete in <5ms (P95)", async () => {
      const metrics = await benchmark(async () => {
        const sdk = createRemoteDevSDK({
          userId: testUserId,
          apiBaseUrl: "http://localhost:6001",
        });
        // Don't initialize, just create
        expect(sdk).toBeDefined();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "createRemoteDevSDK"));

      expect(metrics.p95).toBeLessThan(5);
    });

    it("SDK config validation should complete in <1ms (P95)", async () => {
      const metrics = await benchmark(async () => {
        createRemoteDevSDK({
          userId: testUserId,
          apiBaseUrl: "http://localhost:6001",
          folderId: testFolderId,
          projectPath: "/tmp/test",
          memory: {
            shortTermTtl: 3600,
            maxWorkingEntries: 100,
            consolidationInterval: 300,
          },
          metaAgent: {
            maxIterations: 3,
            targetScore: 0.9,
            autoOptimize: false,
          },
          orchestrator: {
            monitoringInterval: 30,
            stallThreshold: 300,
            autoIntervention: false,
          },
        });
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "SDK config validation"));

      expect(metrics.p95).toBeLessThan(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Registry Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Tool Registry Operations", () => {
    it("tool registration should complete in <1ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      let counter = 0;

      const metrics = await benchmark(async () => {
        const tool = sdk.dx.tools
          .create(`benchmark-tool-${counter++}`)
          .description("Benchmark tool for performance testing")
          .input({
            type: "object",
            properties: {
              input: { type: "string" },
            },
            required: ["input"],
          })
          .handler(async (input: unknown) => {
            return { success: true, data: input };
          })
          .build();

        sdk.dx.tools.register(tool);
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "tool registration"));

      expect(metrics.p95).toBeLessThan(1);
    });

    it("tool lookup (getAll) should complete in <0.5ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      // Register 50 tools
      for (let i = 0; i < 50; i++) {
        const tool = sdk.dx.tools
          .create(`lookup-test-tool-${i}`)
          .description(`Tool ${i}`)
          .input({ type: "object", properties: {} })
          .handler(async () => ({ success: true }))
          .build();
        sdk.dx.tools.register(tool);
      }

      const metrics = await benchmark(async () => {
        sdk.dx.tools.getAll();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "tool lookup (getAll - 50 tools)"));

      expect(metrics.p95).toBeLessThan(0.5);
    });

    it("tool lookup (single) should complete in <0.1ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      // Register tools
      for (let i = 0; i < 50; i++) {
        const tool = sdk.dx.tools
          .create(`single-lookup-tool-${i}`)
          .description(`Tool ${i}`)
          .input({ type: "object", properties: {} })
          .handler(async () => ({ success: true }))
          .build();
        sdk.dx.tools.register(tool);
      }

      const metrics = await benchmark(async () => {
        sdk.ax.tools.get("single-lookup-tool-25");
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "tool lookup (single)"));

      expect(metrics.p95).toBeLessThan(0.1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Extension Registry Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Extension Registry Operations", () => {
    it("extension list() should complete in <0.5ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      const metrics = await benchmark(async () => {
        sdk.dx.extensions.list();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "extension list()"));

      expect(metrics.p95).toBeLessThan(0.5);
    });

    it("extension getTools() aggregation should complete in <0.5ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      const metrics = await benchmark(async () => {
        sdk.dx.extensions.getTools();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "extension getTools()"));

      expect(metrics.p95).toBeLessThan(0.5);
    });

    it("extension getPrompts() aggregation should complete in <0.5ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      const metrics = await benchmark(async () => {
        sdk.dx.extensions.getPrompts();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "extension getPrompts()"));

      expect(metrics.p95).toBeLessThan(0.5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Context Manager Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Context Manager Operations", () => {
    it("setTaskContext should complete in <0.1ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      let counter = 0;

      const metrics = await benchmark(async () => {
        sdk.ax.context.setTaskContext({
          taskId: `task-${counter++}`,
          taskSpec: {
            id: `spec-${counter}`,
            description: "Benchmark task",
            complexity: 3,
            type: "feature",
          },
          state: "in_progress",
          activeFiles: [],
          notes: [],
          startedAt: new Date(),
        });
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "setTaskContext"));

      expect(metrics.p95).toBeLessThan(0.1);
    });

    it("getTaskContext should complete in <0.05ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      // Set a task context first
      sdk.ax.context.setTaskContext({
        taskId: "perf-task",
        taskSpec: {
          id: "perf-spec",
          description: "Performance test task",
          complexity: 2,
          type: "test",
        },
        state: "in_progress",
        activeFiles: [],
        notes: [],
        startedAt: new Date(),
      });

      const metrics = await benchmark(async () => {
        sdk.ax.context.getTaskContext();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "getTaskContext"));

      expect(metrics.p95).toBeLessThan(0.05);
    });

    it("setProjectContext should complete in <0.1ms (P95)", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      const metrics = await benchmark(async () => {
        sdk.ax.context.setProjectContext({
          projectPath: "/tmp/perf-test",
          projectType: "typescript",
          language: "TypeScript",
          frameworks: ["Next.js", "React"],
          packageManager: "bun",
          hasCI: true,
        });
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "setProjectContext"));

      expect(metrics.p95).toBeLessThan(0.1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory Usage Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Memory Usage", () => {
    it("SDK creation should use <1MB of heap memory", async () => {
      // Force GC
      if (typeof Bun !== "undefined" && Bun.gc) {
        Bun.gc(true);
      }

      const memBefore = process.memoryUsage().heapUsed;

      // Create 10 SDK instances
      const sdks = [];
      for (let i = 0; i < 10; i++) {
        sdks.push(
          createRemoteDevSDK({
            userId: `mem-test-user-${i}`,
            apiBaseUrl: "http://localhost:6001",
          })
        );
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memPerInstance = (memAfter - memBefore) / 10;

      console.log(`\n📊 Memory per SDK instance: ${(memPerInstance / 1024).toFixed(2)}KB`);

      // Each SDK instance should use < 100KB
      expect(memPerInstance).toBeLessThan(100 * 1024);
    });

    it("registering 100 tools should use <500KB of heap memory", async () => {
      const sdk = createRemoteDevSDK({
        userId: testUserId,
        apiBaseUrl: "http://localhost:6001",
      });

      // Force GC
      if (typeof Bun !== "undefined" && Bun.gc) {
        Bun.gc(true);
      }

      const memBefore = process.memoryUsage().heapUsed;

      // Register 100 tools
      for (let i = 0; i < 100; i++) {
        const tool = sdk.dx.tools
          .create(`mem-test-tool-${i}`)
          .description(`Memory test tool ${i} with a reasonably long description to simulate real-world usage`)
          .input({
            type: "object",
            properties: {
              param1: { type: "string", description: "First parameter" },
              param2: { type: "number", description: "Second parameter" },
              param3: { type: "boolean", description: "Third parameter" },
            },
            required: ["param1"],
          })
          .output({
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "object" },
            },
          })
          .handler(async (input: unknown) => ({ success: true, data: input }))
          .build();

        sdk.dx.tools.register(tool);
      }

      const memAfter = process.memoryUsage().heapUsed;
      const totalMem = memAfter - memBefore;

      console.log(`\n📊 Memory for 100 tools: ${(totalMem / 1024).toFixed(2)}KB`);
      console.log(`   Per tool: ${(totalMem / 100 / 1024).toFixed(2)}KB`);

      expect(totalMem).toBeLessThan(500 * 1024);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Combined Workflow Benchmarks
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Combined Workflow Performance", () => {
    it("typical agent workflow (create SDK + set context + register tools) should complete in <10ms (P95)", async () => {
      const metrics = await benchmark(async () => {
        const sdk = createRemoteDevSDK({
          userId: testUserId,
          apiBaseUrl: "http://localhost:6001",
        });

        // Set project context
        sdk.ax.context.setProjectContext({
          projectPath: "/tmp/workflow-test",
          projectType: "typescript",
          language: "TypeScript",
          frameworks: ["Next.js"],
          packageManager: "bun",
          hasCI: true,
        });

        // Set task context
        sdk.ax.context.setTaskContext({
          taskId: "workflow-task",
          taskSpec: {
            id: "workflow-spec",
            description: "Typical workflow test",
            complexity: 3,
            type: "feature",
          },
          state: "in_progress",
          activeFiles: [],
          notes: [],
          startedAt: new Date(),
        });

        // Register a few tools
        for (let i = 0; i < 5; i++) {
          const tool = sdk.dx.tools
            .create(`workflow-tool-${i}`)
            .description(`Workflow tool ${i}`)
            .input({ type: "object", properties: {} })
            .handler(async () => ({ success: true }))
            .build();
          sdk.dx.tools.register(tool);
        }

        // Get all tools
        sdk.ax.tools.getAll();
      }, BENCHMARK_ITERATIONS);

      console.log(formatMetrics(metrics, "typical agent workflow"));

      expect(metrics.p95).toBeLessThan(10);
    });

    it("memory store + retrieve cycle should complete in <100ms (P95)", async () => {
      const tempIds: string[] = [];

      const metrics = await benchmark(async () => {
        // Store memory
        const entryId = await storeSessionMemory({
          userId: testUserId,
          sessionId: testSessionId,
          folderId: testFolderId,
          content: `Store-retrieve cycle test at ${Date.now()}`,
          contentType: "observation",
          tier: "short_term",
        });
        tempIds.push(entryId);

        // Retrieve it back
        await db.query.sdkMemoryEntries.findFirst({
          where: eq(sdkMemoryEntries.id, entryId),
        });
      }, BENCHMARK_ITERATIONS);

      // Cleanup
      if (tempIds.length > 0) {
        await db.delete(sdkMemoryEntries).where(inArray(sdkMemoryEntries.id, tempIds));
      }

      console.log(formatMetrics(metrics, "memory store + retrieve cycle"));

      expect(metrics.p95).toBeLessThan(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Summary Report
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Performance Summary", () => {
    it("should generate summary report", () => {
      console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                          SDK PERFORMANCE SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Target: <100ms for common operations                                        ║
║  Iterations per benchmark: ${BENCHMARK_ITERATIONS}                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Key Metrics:                                                                 ║
║  • SDK Creation:        <5ms  (P95 target)                                    ║
║  • Memory Store:        <50ms (P95 target)                                    ║
║  • Memory Retrieve:     <20ms (P95 target)                                    ║
║  • Tool Registration:   <1ms  (P95 target)                                    ║
║  • Tool Lookup:         <0.1ms (P95 target)                                   ║
║  • Context Operations:  <0.1ms (P95 target)                                   ║
║  • Full Workflow:       <100ms (P95 target)                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
      expect(true).toBe(true);
    });
  });
});
