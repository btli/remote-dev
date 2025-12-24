import { config } from "dotenv";
import { createTerminalServer } from "./terminal";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator";

// Load .env.local to match Next.js environment
config({ path: ".env.local" });

const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "3001");

async function startServer() {
  // Start the terminal WebSocket server
  createTerminalServer(TERMINAL_PORT);

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

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

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
