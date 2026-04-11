/**
 * LiteLLM Process Manager
 *
 * Singleton class managing the LiteLLM child process lifecycle.
 * Handles spawning, monitoring, health checks, config YAML generation,
 * and graceful shutdown of the LiteLLM AI API proxy server.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import { getServerDir, getLiteLLMDir } from "@/lib/paths";
import type { LiteLLMStatus } from "@/types/litellm";

const log = createLogger("LiteLLMProcess");

const GRACEFUL_SHUTDOWN_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const READY_POLL_INTERVAL_MS = 200;
const READY_TIMEOUT_MS = 10000;
const DEFAULT_HOST = "127.0.0.1";

interface YamlModelEntry {
  modelName: string;
  litellmModel: string;
  apiKey?: string;
  apiBase?: string;
  extraHeaders?: Record<string, string>;
}

interface StartConfig {
  port: number;
  models: YamlModelEntry[];
  masterKey: string;
  webhookSecret?: string;
  nextPort: number;
}

class LiteLLMProcessManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private startTime: number | null = null;
  private starting = false;
  private stopping = false;
  private cachedBinaryPath: string | null | undefined = undefined;

  /**
   * Resolve the path to the litellm binary via `which`.
   * Caches the result on success; returns null (uncached) on failure
   * so subsequent calls retry resolution.
   */
  private resolveBinaryPath(): string | null {
    if (this.cachedBinaryPath !== undefined) return this.cachedBinaryPath;

    try {
      const result = execFileSync("which", ["litellm"], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (result) {
        this.cachedBinaryPath = result;
        return result;
      }
    } catch {
      // Not found on PATH
    }

    // Don't cache negative result -- binary may be installed later
    return null;
  }

  private getPidFilePath(): string {
    return join(getServerDir(), "litellm.pid");
  }

  private getConfigDir(): string {
    return getLiteLLMDir();
  }

  /**
   * Get the path to the generated config.yaml file.
   */
  getConfigYamlPath(): string {
    return join(this.getConfigDir(), "config.yaml");
  }

  private ensureDirectories(): void {
    const serverDir = getServerDir();
    if (!existsSync(serverDir)) {
      mkdirSync(serverDir, { recursive: true });
    }
    const litellmDir = this.getConfigDir();
    if (!existsSync(litellmDir)) {
      mkdirSync(litellmDir, { recursive: true });
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
    log.warn("Killing orphaned litellm process from previous session", { pid });
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
      log.warn("Force killing orphaned litellm process", { pid });
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    this.removePid();
  }

  /**
   * Generate the LiteLLM config.yaml from the given model entries and settings.
   * Writes to `getLiteLLMDir()/config.yaml`.
   */
  private generateConfigYaml(config: StartConfig): string {
    const lines: string[] = [];

    // model_list
    lines.push("model_list:");
    for (const model of config.models) {
      lines.push(`  - model_name: ${yamlQuote(model.modelName)}`);
      lines.push("    litellm_params:");
      lines.push(`      model: ${yamlQuote(model.litellmModel)}`);
      if (model.apiKey) {
        lines.push(`      api_key: ${yamlQuote(model.apiKey)}`);
      }
      if (model.apiBase) {
        lines.push(`      api_base: ${yamlQuote(model.apiBase)}`);
      }
      if (model.extraHeaders && Object.keys(model.extraHeaders).length > 0) {
        lines.push("      extra_headers:");
        for (const [key, value] of Object.entries(model.extraHeaders)) {
          lines.push(`        ${yamlQuote(key)}: ${yamlQuote(value)}`);
        }
      }
    }

    // litellm_settings
    lines.push("");
    lines.push("litellm_settings:");
    lines.push("  forward_client_headers_to_llm_api: true");
    lines.push('  success_callback: ["generic"]');
    lines.push('  failure_callback: ["generic"]');

    // general_settings
    lines.push("");
    lines.push("general_settings:");
    lines.push(`  master_key: ${yamlQuote(config.masterKey)}`);
    lines.push("  alerting_args:");
    lines.push(`    webhook_url: ${yamlQuote(`http://127.0.0.1:${config.nextPort}/api/litellm/webhook`)}`);
    if (config.webhookSecret) {
      lines.push("    webhook_headers:");
      lines.push(`      x-webhook-secret: ${yamlQuote(config.webhookSecret)}`);
    }

    const yaml = lines.join("\n") + "\n";
    const configPath = this.getConfigYamlPath();
    writeFileSync(configPath, yaml, { encoding: "utf-8", mode: 0o600 });
    log.info("Generated LiteLLM config.yaml", { path: configPath, modelCount: config.models.length });
    return configPath;
  }

  /**
   * Start the LiteLLM proxy server.
   */
  async start(config: StartConfig): Promise<void> {
    if (this.starting) {
      log.warn("Start already in progress, ignoring duplicate call");
      return;
    }
    if (this.process !== null) {
      log.warn("LiteLLM is already running", {
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
        throw new Error("litellm binary not found — is it installed? (pip install litellm)");
      }

      const configYamlPath = this.generateConfigYaml(config);
      const port = config.port;

      log.info("Starting LiteLLM proxy", {
        binaryPath,
        port,
        host: DEFAULT_HOST,
        configPath: configYamlPath,
      });

      const child: ChildProcess = spawn(
        binaryPath,
        ["--config", configYamlPath, "--port", String(port), "--host", DEFAULT_HOST],
        {
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        } as import("node:child_process").SpawnOptions,
      );

      // Attach error/exit listeners immediately to prevent unhandled ENOENT
      child.on("error", (err: Error) => {
        log.error("LiteLLM process error", { error: String(err) });
        // Clear cached binary path on exec errors so it re-resolves
        if ((err as NodeJS.ErrnoException).code === "ENOEXEC" || (err as NodeJS.ErrnoException).code === "ENOENT") {
          this.cachedBinaryPath = undefined;
        }
        this.resetState();
      });

      // Handle process exit
      child.on("exit", (code: number | null, signal: string | null) => {
        log.info("LiteLLM process exited", {
          code,
          signal,
          pid: child.pid,
        });
        this.resetState();
      });

      if (!child.pid) {
        throw new Error("Failed to spawn litellm process — no PID assigned");
      }

      this.process = child;
      this.port = port;
      this.startTime = Date.now();
      this.writePid(child.pid);

      log.info("LiteLLM process spawned", { pid: child.pid, port });

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
        log.warn("LiteLLM process exited before becoming ready");
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
          log.debug("LiteLLM proxy ready");
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    log.warn("LiteLLM proxy did not become ready within timeout", {
      timeoutMs: READY_TIMEOUT_MS,
    });
  }

  /**
   * Stop the LiteLLM proxy server.
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
        log.debug("No litellm process to stop");
        this.resetState();
        return;
      }

      if (!this.isProcessAlive(pid)) {
        log.debug("LiteLLM process already exited", { pid });
        this.resetState();
        return;
      }

      log.info("Stopping LiteLLM process", { pid });

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
        log.warn("Force killing LiteLLM process", { pid });
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

      log.info("LiteLLM process stopped", { pid });
    } finally {
      this.stopping = false;
    }
  }

  /**
   * Restart the LiteLLM proxy server.
   */
  async restart(config: StartConfig): Promise<void> {
    await this.stop();
    await this.start(config);
  }

  /**
   * Check if the LiteLLM process is currently running.
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
   * Get the current port LiteLLM is listening on.
   */
  getPort(): number | null {
    return this.port;
  }

  /**
   * Get the full status of the LiteLLM process.
   */
  getStatus(): LiteLLMStatus {
    const running = this.isRunning();
    const pid = this.process?.pid ?? this.readPid();

    return {
      installed: this.resolveBinaryPath() !== null,
      running,
      port: running ? this.port : null,
      pid: running && pid ? pid : null,
      version: null, // Populated by litellm-service via checkInstallation
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
        HEALTH_CHECK_TIMEOUT_MS,
      );

      const response = await fetch(
        `http://${DEFAULT_HOST}:${this.port}/health`,
        {
          signal: controller.signal,
        },
      );

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the binary path for use by other services.
   */
  getBinaryPath(): string | null {
    return this.resolveBinaryPath();
  }
}

/**
 * Quote a YAML value if it contains special characters, or return as-is for simple values.
 */
function yamlQuote(value: string): string {
  // Quote if the value contains characters that could be problematic in YAML
  if (
    value === "" ||
    value.includes(":") ||
    value.includes("#") ||
    value.includes("'") ||
    value.includes('"') ||
    value.includes("{") ||
    value.includes("}") ||
    value.includes("[") ||
    value.includes("]") ||
    value.includes(",") ||
    value.includes("&") ||
    value.includes("*") ||
    value.includes("!") ||
    value.includes("|") ||
    value.includes(">") ||
    value.includes("%") ||
    value.includes("@") ||
    value.includes("`") ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value === "yes" ||
    value === "no"
  ) {
    // Use double quotes and escape internal double quotes, backslashes, and newlines
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
    return `"${escaped}"`;
  }
  // Also quote values containing newlines even if no other special chars
  if (value.includes("\n") || value.includes("\r")) {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
    return `"${escaped}"`;
  }
  return value;
}

export const litellmProcessManager = new LiteLLMProcessManager();
