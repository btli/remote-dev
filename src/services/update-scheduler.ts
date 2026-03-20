/**
 * Update Scheduler
 *
 * Periodically checks for new releases from GitHub.
 * Configurable via UPDATE_CHECK_INTERVAL_HOURS env var (default: 4 hours).
 *
 * When auto-update is enabled, notifies the AutoUpdateOrchestrator
 * when a new version is detected so it can schedule the update.
 */

import { checkForUpdatesUseCase, autoUpdateOrchestrator } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";

const log = createLogger("UpdateScheduler");

const DEFAULT_INTERVAL_HOURS = 4;

class UpdateScheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private initialCheckHandle: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.intervalHandle) {
      return; // Already running
    }

    const intervalHours = parseInt(
      process.env.UPDATE_CHECK_INTERVAL_HOURS || String(DEFAULT_INTERVAL_HOURS),
      10
    );
    const intervalMs = intervalHours * 60 * 60 * 1000;

    log.info("Update check interval configured", { intervalHours });

    // Perform initial check after 30 seconds (let server fully start)
    this.initialCheckHandle = setTimeout(() => {
      this.initialCheckHandle = null;
      this.check();
    }, 30_000);

    // Set up periodic checks
    this.intervalHandle = setInterval(() => {
      this.check();
    }, intervalMs);
  }

  stop(): void {
    if (this.initialCheckHandle) {
      clearTimeout(this.initialCheckHandle);
      this.initialCheckHandle = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    log.info("Stopped");
  }

  private async check(): Promise<void> {
    try {
      const result = await checkForUpdatesUseCase.execute({ force: false });
      if (result.state.isAvailable() && result.latestVersion) {
        log.info("Update available", { version: result.latestVersion });

        // Notify the auto-update orchestrator (no-op if auto-update is disabled)
        await autoUpdateOrchestrator.onUpdateDetected(result.latestVersion);
      }
    } catch (error) {
      log.error("Check failed", { error: String(error) });
    }
  }
}

export const updateScheduler = new UpdateScheduler();
