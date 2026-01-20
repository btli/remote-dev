import { config } from "dotenv";
import { createTerminalServer } from "./terminal.js";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
import { initializeMCPServer, shutdownMCPServer } from "../mcp/index.js";

config({ path: ".env.local" });

const TERMINAL_SOCKET = process.env.TERMINAL_SOCKET;
const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "6002");
const MCP_ENABLED = process.env.MCP_ENABLED === "true";

async function startServer(): Promise<void> {
  createTerminalServer(TERMINAL_SOCKET ? { socket: TERMINAL_SOCKET } : { port: TERMINAL_PORT });

  try {
    await schedulerOrchestrator.start();
    console.log(`[Server] Scheduler started with ${schedulerOrchestrator.getJobCount()} jobs`);
  } catch (error) {
    console.error("[Server] Failed to start scheduler:", error);
  }

  if (MCP_ENABLED) {
    try {
      await initializeMCPServer();
      console.error("[Server] MCP server started on stdio");
    } catch (error) {
      console.error("[Server] Failed to start MCP server:", error);
    }
  }

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

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
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
