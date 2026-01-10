import { config } from "dotenv";
import { homedir } from "os";
import { join } from "path";
import { createTerminalServer } from "./terminal";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator";
import {
  initializeMCPServer,
  shutdownMCPServer,
} from "../mcp/index";
import { initializeMonitoring, stopAllMonitoring } from "../services/monitoring-service";
import { initializeOrchestrators } from "../services/orchestrator-bootstrap-service";
import { workerManager } from "../services/workers/worker-manager";
import { createTaskMonitorWorker } from "../services/workers/task-monitor-worker";
import { createKnowledgeRefreshWorker } from "../services/workers/knowledge-refresh-worker";
import { createOversightWorker } from "../services/workers/oversight-worker";

// Load .env.local to match Next.js environment
config({ path: ".env.local" });

// Standard directory structure: ~/.remote-dev/run/ for sockets
const REMOTE_DEV_DIR = process.env.REMOTE_DEV_DIR || join(homedir(), ".remote-dev");
const DEFAULT_TERMINAL_SOCKET = join(REMOTE_DEV_DIR, "run", "terminal.sock");

// Support both port and socket modes (socket takes precedence)
const TERMINAL_SOCKET = process.env.TERMINAL_SOCKET || (process.env.NODE_ENV === "production" ? DEFAULT_TERMINAL_SOCKET : undefined);
const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "6002");
const MCP_ENABLED = process.env.MCP_ENABLED === "true";

async function startServer() {
  // Start the terminal WebSocket server (socket mode takes precedence)
  if (TERMINAL_SOCKET) {
    createTerminalServer({ socket: TERMINAL_SOCKET });
  } else {
    createTerminalServer({ port: TERMINAL_PORT });
  }

  // Start the scheduler orchestrator
  try {
    await schedulerOrchestrator.start();
    console.log(
      `[Server] Scheduler started with ${schedulerOrchestrator.getJobCount()} jobs`
    );
  } catch (error) {
    console.error("[Server] Failed to start scheduler:", error);
    // Don't fail server startup if scheduler fails - it can be restarted
  }

  // Initialize orchestrator monitoring for all active orchestrators
  try {
    await initializeMonitoring();
    console.log("[Server] Orchestrator monitoring initialized");
  } catch (error) {
    console.error("[Server] Failed to initialize orchestrator monitoring:", error);
    // Don't fail server startup if monitoring fails
  }

  // Bootstrap orchestrators for users with active sessions
  try {
    await initializeOrchestrators();
    console.log("[Server] Orchestrators bootstrapped");
  } catch (error) {
    console.error("[Server] Failed to bootstrap orchestrators:", error);
    // Don't fail server startup if bootstrap fails
  }

  // Register and start background workers
  try {
    workerManager.register(createTaskMonitorWorker());
    workerManager.register(createKnowledgeRefreshWorker());
    workerManager.register(createOversightWorker());
    await workerManager.startAll();
    console.log("[Server] Background workers started:", workerManager.getStatus());
  } catch (error) {
    console.error("[Server] Failed to start background workers:", error);
    // Don't fail server startup if workers fail
  }

  // Start MCP server if enabled
  if (MCP_ENABLED) {
    try {
      await initializeMCPServer();
      console.error("[Server] MCP server started on stdio");
    } catch (error) {
      console.error("[Server] Failed to start MCP server:", error);
      // Don't fail server startup if MCP fails
    }
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

    // Stop all orchestrator monitoring
    try {
      stopAllMonitoring();
      console.log("[Server] Orchestrator monitoring stopped");
    } catch (error) {
      console.error("[Server] Error stopping orchestrator monitoring:", error);
    }

    // Stop background workers
    try {
      await workerManager.stopAll();
      console.log("[Server] Background workers stopped");
    } catch (error) {
      console.error("[Server] Error stopping background workers:", error);
    }

    // Shutdown MCP server if enabled
    if (MCP_ENABLED) {
      try {
        await shutdownMCPServer();
        console.error("[Server] MCP server stopped");
      } catch (error) {
        console.error("[Server] Error stopping MCP server:", error);
      }
    }

    try {
      await schedulerOrchestrator.stop();
      console.log("[Server] Scheduler stopped");
    } catch (error) {
      console.error("[Server] Error stopping scheduler:", error);
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
