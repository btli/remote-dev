/**
 * Ccflare Process Manager
 *
 * Singleton class managing the better-ccflare child process lifecycle.
 * Handles spawning, monitoring, health checks, and graceful shutdown
 * of the Anthropic API proxy server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  accessSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import { getServerDir, getCcflareDir } from "@/lib/paths";
import type { CcflareStatus } from "@/types/ccflare";

const log = createLogger("CcflareProcess");

const GRACEFUL_SHUTDOWN_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const READY_POLL_INTERVAL_MS = 200;
const READY_TIMEOUT_MS = 10000;
const DEFAULT_HOST = "127.0.0.1";

class CcflareProcessManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private startTime: number | null = null;
  private starting = false;
  private stopping = false;
  private cachedBinaryPath: string | null | undefined = undefined;

  /**
   * Resolve the path to the better-ccflare binary.
   * Prefers the local node_modules/.bin version, falls back to PATH.
   */
  private resolveBinaryPath(): string | null {
    if (this.cachedBinaryPath !== undefined) return this.cachedBinaryPath;

    // Try local node_modules first
    const localPath = join(
      process.cwd(),
      "node_modules",
      ".bin",
      "better-ccflare"
    );
    try {
      accessSync(localPath, constants.X_OK);
      this.cachedBinaryPath = localPath;
      return localPath;
    } catch {
      // Not found or not executable locally
    }

    // Don't cache negative result — binary may be installed later
    return null;
  }

  private getPidFilePath(): string {
    return join(getServerDir(), "ccflare.pid");
  }

  private getDbPath(): string {
    return join(getCcflareDir(), "better-ccflare.db");
  }

  private ensureDirectories(): void {
    const serverDir = getServerDir();
    if (!existsSync(serverDir)) {
      mkdirSync(serverDir, { recursive: true });
    }
    const ccflareDir = getCcflareDir();
    if (!existsSync(ccflareDir)) {
      mkdirSync(ccflareDir, { recursive: true });
    }
  }

  private writePid(pid: number): void {
    writeFileSync(this.getPidFilePath(), pid.toString());
  }

  private readPid(): number | null {
    try {
      const pid = parseInt(readFileSync(this.getPidFilePath(), "utf-8").trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  private removePid(): void {
    try {
      unlinkSync(this.getPidFilePath());
    } catch {
      // File may not exist
    }
  }

  /**
   * Check if a process with the given PID is running.
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private resetState(): void {
    this.process = null;
    this.port = null;
    this.startTime = null;
    this.removePid();
  }

  /**
   * Clean up any stale PID file from a previous run.
   */
  private async cleanupStalePid(): Promise<void> {
    const pid = this.readPid();
    if (pid === null) return;

    if (!this.isProcessAlive(pid)) {
      log.info("Cleaning up stale PID file", { stalePid: pid });
      this.removePid();
      return;
    }

    // Kill orphaned process and wait for it to release the port
    log.warn("Killing orphaned ccflare process from previous session", { pid });
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      this.removePid();
      return;
    }

    const deadline = Date.now() + GRACEFUL_SHUTDOWN_MS;
    while (Date.now() < deadline && this.isProcessAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.isProcessAlive(pid)) {
      log.warn("Force killing orphaned ccflare process", { pid });
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    this.removePid();
  }

  /**
   * Start the ccflare proxy server.
   */
  async start(config: { port: number }): Promise<void> {
    if (this.starting) {
      log.warn("Start already in progress, ignoring duplicate call");
      return;
    }
    if (this.process !== null) {
      log.warn("Ccflare is already running", {
        pid: this.process.pid,
        port: this.port,
      });
      return;
    }

    this.starting = true;

    try {
      this.ensureDirectories();
      await this.cleanupStalePid();

      const binaryPath = this.resolveBinaryPath();
      if (!binaryPath) {
        throw new Error("better-ccflare binary not found");
      }

      const dbPath = this.getDbPath();
      const port = config.port;

      log.info("Starting ccflare proxy", {
        binaryPath,
        port,
        host: DEFAULT_HOST,
        dbPath,
      });

      const spawnEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: String(port),
        BETTER_CCFLARE_HOST: DEFAULT_HOST,
        BETTER_CCFLARE_DB_PATH: dbPath,
      };

      const child: ChildProcess = spawn(binaryPath, ["--serve"], {
        env: spawnEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      } as import("node:child_process").SpawnOptions);

      // Attach error/exit listeners immediately to prevent unhandled ENOENT
      child.on("error", (err: Error) => {
        log.error("Ccflare process error", { error: String(err) });
        this.resetState();
      });

      // Handle process exit
      child.on("exit", (code: number | null, signal: string | null) => {
        log.info("Ccflare process exited", {
          code,
          signal,
          pid: child.pid,
        });
        this.resetState();
      });

      if (!child.pid) {
        throw new Error("Failed to spawn ccflare process — no PID assigned");
      }

      this.process = child;
      this.port = port;
      this.startTime = Date.now();
      this.writePid(child.pid);

      log.info("Ccflare process spawned", { pid: child.pid, port });

      // Pipe stdout/stderr to structured logger
      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          log.debug("stdout", { output: text });
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          log.warn("stderr", { output: text });
        }
      });

      // Wait for proxy to be ready before returning
      await this.waitForReady();
    } finally {
      this.starting = false;
    }
  }

  /**
   * Poll the health endpoint until the proxy is accepting connections.
   */
  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.process === null) {
        log.warn("Ccflare process exited before becoming ready");
        return;
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
        const response = await fetch(`http://${DEFAULT_HOST}:${this.port}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          log.debug("Ccflare proxy ready");
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    log.warn("Ccflare proxy did not become ready within timeout", {
      timeoutMs: READY_TIMEOUT_MS,
    });
  }

  /**
   * Stop the ccflare proxy server.
   * Sends SIGTERM and waits up to 5 seconds before SIGKILL.
   */
  async stop(): Promise<void> {
    if (this.stopping) {
      log.warn("Stop already in progress, ignoring duplicate call");
      return;
    }

    this.stopping = true;

    try {
      const pid = this.process?.pid ?? this.readPid();
      if (pid === null || pid === undefined) {
        log.debug("No ccflare process to stop");
        this.resetState();
        return;
      }

      if (!this.isProcessAlive(pid)) {
        log.debug("Ccflare process already exited", { pid });
        this.resetState();
        return;
      }

      log.info("Stopping ccflare process", { pid });

      // Send SIGTERM for graceful shutdown
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited
        this.resetState();
        return;
      }

      // Wait for graceful shutdown
      const deadline = Date.now() + GRACEFUL_SHUTDOWN_MS;
      while (Date.now() < deadline && this.isProcessAlive(pid)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Force kill if still alive
      if (this.isProcessAlive(pid)) {
        log.warn("Force killing ccflare process", { pid });
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone
        }
      }

      this.process = null;
      this.port = null;
      this.startTime = null;
      this.removePid();

      log.info("Ccflare process stopped", { pid });
    } finally {
      this.stopping = false;
    }
  }

  /**
   * Restart the ccflare proxy server.
   */
  async restart(config: { port: number }): Promise<void> {
    await this.stop();
    await this.start(config);
  }

  /**
   * Check if the ccflare process is currently running.
   */
  isRunning(): boolean {
    if (this.process !== null && this.process.pid !== undefined) {
      return this.isProcessAlive(this.process.pid);
    }

    // Check PID file as fallback (process may have been started externally)
    const pid = this.readPid();
    if (pid !== null && this.isProcessAlive(pid)) {
      return true;
    }

    return false;
  }

  /**
   * Get the current port ccflare is listening on.
   */
  getPort(): number | null {
    return this.port;
  }

  /**
   * Get the full status of the ccflare process.
   */
  getStatus(): CcflareStatus {
    const running = this.isRunning();
    const pid = this.process?.pid ?? this.readPid();

    return {
      installed: this.resolveBinaryPath() !== null,
      running,
      port: running ? this.port : null,
      pid: running && pid ? pid : null,
      version: null, // Populated by ccflare-service via checkInstallation
      uptime:
        running && this.startTime !== null
          ? Math.floor((Date.now() - this.startTime) / 1000)
          : null,
    };
  }

  /**
   * Perform a health check by hitting the /health endpoint.
   * Returns true if the server responds successfully.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isRunning() || this.port === null) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS
      );

      const response = await fetch(
        `http://${DEFAULT_HOST}:${this.port}/health`,
        {
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the binary path for use by other services (e.g., key registration).
   */
  getBinaryPath(): string | null {
    return this.resolveBinaryPath();
  }

  /**
   * Get the database path for use by other services.
   */
  getDatabasePath(): string {
    return this.getDbPath();
  }
}

export const ccflareProcessManager = new CcflareProcessManager();
