/**
 * ProcessServiceRestarter - Restarts the service by sending SIGTERM to managed processes.
 *
 * Relies on the service manager (systemd/launchd) to restart the processes
 * after they exit. Reads PID files from ~/.remote-dev/server/ to find the
 * processes to terminate.
 */

import type { ServiceRestarter } from "@/application/ports/ServiceRestarter";
import { getServerDir } from "@/lib/paths";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

export class ProcessServiceRestarter implements ServiceRestarter {
  restart(delayMs: number = 500): void {
    // Schedule restart after delay to allow HTTP response to flush
    setTimeout(() => {
      this.doRestart();
    }, delayMs);
  }

  isRestartSupported(): boolean {
    // Restart is supported when PID files exist (managed by rdv process manager or service)
    const serverDir = getServerDir();
    const nextPidFile = join(serverDir, "next.pid");
    const terminalPidFile = join(serverDir, "terminal.pid");

    return existsSync(nextPidFile) || existsSync(terminalPidFile);
  }

  private doRestart(): void {
    const serverDir = getServerDir();
    const nextPid = this.readPid(join(serverDir, "next.pid"));
    const terminalPid = this.readPid(join(serverDir, "terminal.pid"));

    console.log("[Restarter] Sending SIGTERM to managed processes...");

    // Kill terminal server first, then Next.js
    if (terminalPid) {
      try {
        process.kill(terminalPid, "SIGTERM");
        console.log(`[Restarter] Sent SIGTERM to terminal server (PID: ${terminalPid})`);
      } catch (error) {
        console.error(`[Restarter] Failed to signal terminal server:`, error);
      }
    }

    if (nextPid) {
      try {
        process.kill(nextPid, "SIGTERM");
        console.log(`[Restarter] Sent SIGTERM to Next.js (PID: ${nextPid})`);
      } catch (error) {
        console.error(`[Restarter] Failed to signal Next.js:`, error);
      }
    }

    // If we can't find PID files, SIGTERM ourselves as a fallback
    if (!nextPid && !terminalPid) {
      console.log("[Restarter] No PID files found, sending SIGTERM to self");
      process.kill(process.pid, "SIGTERM");
    }
  }

  private readPid(pidFile: string): number | null {
    try {
      if (existsSync(pidFile)) {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
        if (!isNaN(pid)) {
          // Verify the process exists
          process.kill(pid, 0);
          return pid;
        }
      }
    } catch {
      // Process doesn't exist or PID file can't be read
    }
    return null;
  }
}
