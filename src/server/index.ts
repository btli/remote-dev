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
import { createTerminalServer, shutdownTerminalConnections } from "./terminal.js";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
import { updateScheduler } from "../services/update-scheduler.js";
import { autoUpdateOrchestrator } from "../infrastructure/container.js";
import { execFile } from "../lib/exec.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../lib/logger.js";
import { closeLogDatabase } from "../infrastructure/logging/LogDatabase.js";
import { acquireInstanceLock, releaseInstanceLock } from "../lib/instance-lock.js";
import { withTimeout } from "../lib/with-timeout.js";

const log = createLogger("Server");

config({ path: ".env.local" });

// Acquire the data-dir instance lock before anything writes to it.
// Two processes against the same RDV_DATA_DIR corrupts SQLite + tmux state;
// fail fast here. See src/lib/instance-lock.ts for the sentinel scheme.
try {
  acquireInstanceLock();
} catch (err) {
  log.error("Failed to acquire instance lock — exiting", { error: String(err) });
  process.exit(1);
}

const TERMINAL_SOCKET = process.env.TERMINAL_SOCKET;
const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "6002");

/**
 * Guards against a second signal racing the shutdown already in flight. The
 * first SIGTERM/SIGINT/SIGHUP runs the (bounded) cleanup; a second one short-
 * circuits straight to exit so we can't double-run cleanup or hang.
 */
let shuttingDown = false;

/**
 * Hard ceiling on async cleanup during shutdown. The deploy stop phase
 * (`scripts/deploy.ts` `PROCESS_STOP_TIMEOUT_MS`) SIGKILLs us at 10s; a
 * SIGKILL can't release the instance lock or sockets. Cap cleanup well under
 * that so we always reach the explicit `releaseInstanceLock()` + `exit(0)`.
 */
const SHUTDOWN_CLEANUP_TIMEOUT_MS = 7_000;

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
    // A second signal while we're already tearing down must not re-run
    // cleanup or wedge — force an immediate exit instead.
    if (shuttingDown) {
      log.warn("Second shutdown signal received during teardown — exiting now", { signal });
      process.exit(0);
    }
    shuttingDown = true;
    log.info("Shutdown signal received", { signal });

    // Synchronous stops — cheap, no awaits. Guarded so a synchronous throw
    // here can't escape as an unhandledRejection (shutdown is async, invoked
    // fire-and-forget from the signal handler) and skip the graceful tail
    // below (terminal teardown + lock release + exit).
    try {
      updateScheduler.stop();
      autoUpdateOrchestrator.stop();
    } catch (err) {
      log.error("Error during synchronous shutdown stops", { error: String(err) });
    }

    // Bound the async cleanup so we ALWAYS reach the lock release + exit
    // below within the deploy's 10s stop window. If a hung scheduler / proxy
    // teardown blows past SHUTDOWN_CLEANUP_TIMEOUT_MS we stop waiting and
    // proceed to exit anyway. A timeout here is far less harmful than being
    // SIGKILLed (which orphans the instance lock + sockets).
    const cleanup = (async () => {
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

      // Drain the Postgres sidecar write buffers (logs + analytics) before
      // closing the sidecar pool. No-op on SQLite (nothing is buffered and the
      // sidecar pool is never created). On Postgres this flushes any in-memory
      // log/analytics rows that the async buffers have not yet written.
      try {
        const { flushSidecarStores } = await import(
          "../infrastructure/persistence/sidecar-factory.js"
        );
        await flushSidecarStores();
        const { closeSidecarPool } = await import(
          "../infrastructure/persistence/pg/sidecar-db.js"
        );
        await closeSidecarPool();
      } catch (error) {
        log.error("Error flushing/closing Postgres sidecar stores", {
          error: String(error),
        });
      }
    })();

    const { timedOut } = await withTimeout(cleanup, SHUTDOWN_CLEANUP_TIMEOUT_MS);
    if (timedOut) {
      log.warn("Shutdown cleanup exceeded timeout — exiting without finishing cleanup", {
        timeoutMs: SHUTDOWN_CLEANUP_TIMEOUT_MS,
      });
    }

    // Tear down terminal connections (destroy PTYs, close WebSockets; tmux
    // sessions are preserved). Synchronous + fast, so it runs OUTSIDE the
    // bounded async race — this guarantees PTY teardown even if the async
    // cleanup above timed out. terminal.ts no longer self-exits or traps
    // signals; index.ts is the single shutdown authority (remote-dev-i85i).
    try {
      shutdownTerminalConnections();
    } catch (e) {
      log.error("Error during terminal connection cleanup", { error: String(e) });
    }

    // Always run these, even if cleanup timed out. `instance-lock.ts` also
    // releases on `process.on("exit")`, so exit(0) is a backstop — but call
    // it explicitly so a hung exit listener can't leave the lock orphaned.
    closeLogDatabase();
    releaseInstanceLock();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  // Exit cleanly on tty hangup (e.g. controlling shell closes). Without
  // this, the server's default behaviour for SIGHUP depends on whether
  // anyone else has installed a listener; explicit shutdown is safer.
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

startServer();
