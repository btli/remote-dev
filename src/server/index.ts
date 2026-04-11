// Mark this process as the terminal server for log source detection
process.env.RDV_SERVER_SOURCE = "terminal";

// Ensure locale environment variables are set BEFORE any PTY operations.
// When the server is started via the deploy webhook chain (GitHub Actions →
// /api/deploy → deploy.ts → login shell → rdv.ts), locale vars like LANG
// can get lost despite being set in the initial clean env. Without UTF-8
// locale, node-pty defaults to the C/ASCII locale and multi-byte characters
// (Nerd Font glyphs, Unicode symbols) render as '_' in terminal sessions.
if (!process.env.LANG) process.env.LANG = "en_US.UTF-8";
if (!process.env.LC_CTYPE) process.env.LC_CTYPE = "en_US.UTF-8";
if (!process.env.TERM) process.env.TERM = "xterm-256color";

import { config } from "dotenv";
import { createTerminalServer } from "./terminal.js";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
import { updateScheduler } from "../services/update-scheduler.js";
import { autoUpdateOrchestrator } from "../infrastructure/container.js";
import { execFile } from "../lib/exec.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../lib/logger.js";
import { closeLogDatabase } from "../infrastructure/logging/LogDatabase.js";

const log = createLogger("Server");

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
    log.info("rdv CLI found", { version: stdout.trim() });
  } catch {
    // rdv not found, try to install from local crate
    const cratePath = resolve(PROJECT_ROOT, "crates", "rdv");
    try {
      log.info("rdv CLI not found, installing from crates/rdv/...");
      await execFile("cargo", ["install", "--path", cratePath], { timeout: 300_000 });
      const { stdout } = await execFile("rdv", ["--version"]);
      log.info("rdv CLI installed", { version: stdout.trim() });
    } catch {
      log.warn("rdv CLI not available (cargo not found or build failed), hooks will use curl fallback");
    }
  }
}

async function startServer(): Promise<void> {
  createTerminalServer(TERMINAL_SOCKET ? { socket: TERMINAL_SOCKET } : { port: TERMINAL_PORT });

  // Check rdv CLI availability (non-blocking, logs status)
  ensureRdvCli().catch((e) => log.warn("rdv CLI check failed", { error: String(e) }));

  try {
    await schedulerOrchestrator.start();
    log.info("Scheduler started", { jobCount: schedulerOrchestrator.getJobCount() });
  } catch (error) {
    log.error("Failed to start scheduler", { error: String(error) });
  }

  // Start update checker (polls GitHub Releases on a configurable interval)
  try {
    updateScheduler.start();
    log.info("Update scheduler started");
  } catch (error) {
    log.error("Failed to start update scheduler", { error: String(error) });
  }

  // Start auto-update orchestrator (recovers pending deployments, handles scheduled updates)
  try {
    await autoUpdateOrchestrator.start();
    log.info("Auto-update orchestrator started");
  } catch (error) {
    log.error("Failed to start auto-update orchestrator", { error: String(error) });
  }

  // Auto-start LiteLLM proxy if configured (non-blocking)
  import("../services/litellm-service.js")
    .then(async (LiteLLMService) => {
      const autoConfig = await LiteLLMService.getAutoStartConfig();
      if (autoConfig) {
        await LiteLLMService.start(autoConfig.userId);
        log.info("LiteLLM proxy auto-started", { port: autoConfig.port });
      }
    })
    .catch((error) => log.error("Failed to auto-start LiteLLM", { error: String(error) }));

  async function shutdown(signal: string): Promise<void> {
    log.info("Shutdown signal received", { signal });

    updateScheduler.stop();
    autoUpdateOrchestrator.stop();

    try {
      await schedulerOrchestrator.stop();
      log.info("Scheduler stopped");
    } catch (error) {
      log.error("Error stopping scheduler", { error: String(error) });
    }

    try {
      const { litellmProcessManager } = await import("../services/litellm-process-manager.js");
      await litellmProcessManager.stop();
    } catch (error) {
      log.error("Error stopping LiteLLM", { error: String(error) });
    }

    try {
      const { closeAnalyticsDatabase } = await import("../infrastructure/analytics/AnalyticsDatabase.js");
      closeAnalyticsDatabase();
    } catch { /* ignore */ }

    closeLogDatabase();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
