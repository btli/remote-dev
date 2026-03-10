import { config } from "dotenv";
import { createTerminalServer } from "./terminal.js";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
import { updateScheduler } from "../services/update-scheduler.js";
import { execFile } from "../lib/exec.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: ".env.local" });

const TERMINAL_SOCKET = process.env.TERMINAL_SOCKET;
const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "6002");

/**
 * Check if the rdv CLI is installed and accessible.
 * If not, attempt to install from crates/rdv/ using cargo.
 * Logs status but does not block server startup.
 */
/** Project root resolved from this file's location (src/server/index.ts → ../..) */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function ensureRdvCli(): Promise<void> {
  try {
    const { stdout } = await execFile("rdv", ["--version"]);
    console.log(`[Server] rdv CLI: ${stdout.trim()}`);
  } catch {
    // rdv not found, try to install from local crate
    const cratePath = resolve(PROJECT_ROOT, "crates", "rdv");
    try {
      console.log("[Server] rdv CLI not found, installing from crates/rdv/...");
      await execFile("cargo", ["install", "--path", cratePath], { timeout: 300_000 });
      const { stdout } = await execFile("rdv", ["--version"]);
      console.log(`[Server] rdv CLI installed: ${stdout.trim()}`);
    } catch {
      console.warn("[Server] rdv CLI not available (cargo not found or build failed), hooks will use curl fallback");
    }
  }
}

async function startServer(): Promise<void> {
  createTerminalServer(TERMINAL_SOCKET ? { socket: TERMINAL_SOCKET } : { port: TERMINAL_PORT });

  // Check rdv CLI availability (non-blocking, logs status)
  ensureRdvCli().catch((e) => console.warn("[Server] rdv CLI check failed:", e));

  try {
    await schedulerOrchestrator.start();
    console.log(`[Server] Scheduler started with ${schedulerOrchestrator.getJobCount()} jobs`);
  } catch (error) {
    console.error("[Server] Failed to start scheduler:", error);
  }

  // Start update checker (polls GitHub Releases on a configurable interval)
  try {
    updateScheduler.start();
    console.log("[Server] Update scheduler started");
  } catch (error) {
    console.error("[Server] Failed to start update scheduler:", error);
  }

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

    updateScheduler.stop();

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
