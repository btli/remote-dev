/**
 * DevServerProcessManager - Direct process spawning for dev servers
 *
 * This service manages dev server processes by spawning them directly
 * (without tmux), capturing stdout/stderr, and providing direct PID access
 * for CPU/memory monitoring.
 *
 * Key benefits over tmux approach:
 * - Direct PID tracking (no process tree traversal)
 * - Clean log capture (no terminal escape codes)
 * - Lower overhead (no PTY allocation)
 * - Simpler crash detection (single process exit)
 */

import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { resolve as pathResolve } from "path";
import type {
  ProcessConfig,
  ProcessState,
  ProcessStatus,
  LogEntry,
  LogListener,
  StateListener,
} from "@/types/process-manager";
import { DevServerProcessError } from "@/types/process-manager";

/**
 * Maximum number of log lines to keep in memory per process
 */
const DEFAULT_MAX_LOG_LINES = 10_000;

/**
 * Timeout for graceful shutdown before SIGKILL (ms)
 */
const GRACEFUL_SHUTDOWN_TIMEOUT = 5_000;

/**
 * Circular buffer for storing log entries
 * Efficiently stores the last N entries and evicts oldest when full
 */
class CircularLogBuffer {
  private buffer: LogEntry[];
  private head: number = 0;
  private size: number = 0;
  private readonly capacity: number;

  constructor(maxLines: number = DEFAULT_MAX_LOG_LINES) {
    this.capacity = maxLines;
    this.buffer = new Array(maxLines);
  }

  append(entry: LogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  getRecent(lines: number): LogEntry[] {
    const count = Math.min(lines, this.size);
    if (count === 0) return [];

    const result: LogEntry[] = [];

    // Calculate start position (head - count, wrapping)
    let pos = (this.head - count + this.capacity) % this.capacity;

    for (let i = 0; i < count; i++) {
      result.push(this.buffer[pos]);
      pos = (pos + 1) % this.capacity;
    }

    return result;
  }

  getAll(): LogEntry[] {
    return this.getRecent(this.size);
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}

/**
 * Internal representation of a managed process
 */
interface ManagedProcess {
  process: ChildProcess;
  config: ProcessConfig;
  state: ProcessState;
  logBuffer: CircularLogBuffer;
  logListeners: Set<LogListener>;
  stateListeners: Set<StateListener>;
}

/**
 * Singleton process manager for dev servers
 */
class DevServerProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();

  /**
   * Start a new dev server process
   */
  async startProcess(config: ProcessConfig): Promise<ProcessState> {
    // Check if process already exists
    if (this.processes.has(config.sessionId)) {
      throw new DevServerProcessError(
        `Process already running for session ${config.sessionId}`,
        "ALREADY_RUNNING",
        config.sessionId
      );
    }

    // Validate path
    const cwd = this.validatePath(config.cwd);

    // Prepare environment
    const env = this.sanitizeEnv({
      ...process.env,
      ...config.env,
    });

    // Create initial state
    const state: ProcessState = {
      pid: null,
      status: "starting",
      exitCode: null,
      exitSignal: null,
      startedAt: Date.now(),
      errorMessage: null,
    };

    try {
      // Spawn the child process
      // SECURITY: Never use shell: true to prevent command injection
      const spawnOptions: SpawnOptions = {
        cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"], // stdin ignored, capture stdout/stderr
        detached: false, // Don't create process group
      };

      const child = spawn(config.command, config.args, spawnOptions) as ChildProcess;

      state.pid = child.pid ?? null;

      // Create managed process
      const managed: ManagedProcess = {
        process: child,
        config,
        state,
        logBuffer: new CircularLogBuffer(),
        logListeners: new Set(),
        stateListeners: new Set(),
      };

      this.processes.set(config.sessionId, managed);

      // Set up stdout handler
      child.stdout?.on("data", (data: Buffer) => {
        const entry: LogEntry = {
          timestamp: Date.now(),
          stream: "stdout",
          data: data.toString(),
        };
        managed.logBuffer.append(entry);
        this.broadcastLog(config.sessionId, entry);
      });

      // Set up stderr handler
      child.stderr?.on("data", (data: Buffer) => {
        const entry: LogEntry = {
          timestamp: Date.now(),
          stream: "stderr",
          data: data.toString(),
        };
        managed.logBuffer.append(entry);
        this.broadcastLog(config.sessionId, entry);
      });

      // Handle process spawn error
      child.on("error", (error: Error) => {
        console.error(`[ProcessManager] Spawn error for ${config.sessionId}:`, error.message);
        this.updateState(config.sessionId, "crashed", null, null, error.message);
      });

      // Handle process exit
      child.on("exit", (code: number | null, signal: string | null) => {
        console.log(`[ProcessManager] Process ${config.sessionId} exited: code=${code}, signal=${signal}`);

        // Determine if this was a crash or intentional stop
        const currentState = managed.state.status;
        const newStatus: ProcessStatus = currentState === "stopped" ? "stopped" : "crashed";

        this.updateState(config.sessionId, newStatus, code, signal);
      });

      console.log(`[ProcessManager] Started process ${config.sessionId} (PID: ${state.pid})`);

      return { ...state };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      // Determine error type
      let code: "SPAWN_FAILED" | "COMMAND_NOT_FOUND" | "PERMISSION_DENIED" = "SPAWN_FAILED";
      if (message.includes("ENOENT")) {
        code = "COMMAND_NOT_FOUND";
      } else if (message.includes("EACCES")) {
        code = "PERMISSION_DENIED";
      }

      throw new DevServerProcessError(message, code, config.sessionId);
    }
  }

  /**
   * Stop a running process
   */
  async stopProcess(
    sessionId: string,
    signal: NodeJS.Signals = "SIGTERM"
  ): Promise<void> {
    const managed = this.processes.get(sessionId);
    if (!managed) {
      throw new DevServerProcessError(
        `No process found for session ${sessionId}`,
        "PROCESS_NOT_FOUND",
        sessionId
      );
    }

    // Mark as stopping
    this.updateState(sessionId, "stopped");

    // Send signal
    managed.process.kill(signal);

    // Wait for graceful exit or timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running
        if (!managed.process.killed) {
          console.log(`[ProcessManager] Force killing ${sessionId} after timeout`);
          managed.process.kill("SIGKILL");
        }
        resolve();
      }, GRACEFUL_SHUTDOWN_TIMEOUT);

      managed.process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    console.log(`[ProcessManager] Stopped process ${sessionId}`);
  }

  /**
   * Get the current state of a process
   */
  getProcessState(sessionId: string): ProcessState | null {
    const managed = this.processes.get(sessionId);
    return managed ? { ...managed.state } : null;
  }

  /**
   * Get the PID of a process (for health monitoring)
   */
  getPid(sessionId: string): number | null {
    const managed = this.processes.get(sessionId);
    return managed?.state.pid ?? null;
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(sessionId: string, lines: number): LogEntry[] {
    const managed = this.processes.get(sessionId);
    return managed?.logBuffer.getRecent(lines) ?? [];
  }

  /**
   * Get all log entries
   */
  getAllLogs(sessionId: string): LogEntry[] {
    const managed = this.processes.get(sessionId);
    return managed?.logBuffer.getAll() ?? [];
  }

  /**
   * Clear log buffer
   */
  clearLogs(sessionId: string): void {
    const managed = this.processes.get(sessionId);
    managed?.logBuffer.clear();
  }

  /**
   * Attach a listener for new log entries
   */
  attachLogListener(sessionId: string, callback: LogListener): void {
    const managed = this.processes.get(sessionId);
    managed?.logListeners.add(callback);
  }

  /**
   * Detach a log listener
   */
  detachLogListener(sessionId: string, callback: LogListener): void {
    const managed = this.processes.get(sessionId);
    managed?.logListeners.delete(callback);
  }

  /**
   * Attach a listener for state changes
   */
  attachStateListener(sessionId: string, callback: StateListener): void {
    const managed = this.processes.get(sessionId);
    managed?.stateListeners.add(callback);
  }

  /**
   * Detach a state listener
   */
  detachStateListener(sessionId: string, callback: StateListener): void {
    const managed = this.processes.get(sessionId);
    managed?.stateListeners.delete(callback);
  }

  /**
   * Check if a process exists
   */
  hasProcess(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  /**
   * Remove a process from tracking (after it has exited)
   */
  removeProcess(sessionId: string): void {
    const managed = this.processes.get(sessionId);
    if (managed) {
      managed.logListeners.clear();
      managed.stateListeners.clear();
      this.processes.delete(sessionId);
      console.log(`[ProcessManager] Removed process ${sessionId} from tracking`);
    }
  }

  /**
   * Get count of active processes
   */
  getActiveCount(): number {
    let count = 0;
    for (const [, managed] of this.processes) {
      if (managed.state.status === "starting" || managed.state.status === "running") {
        count++;
      }
    }
    return count;
  }

  /**
   * Mark a process as running (called by health checker when server responds)
   */
  markRunning(sessionId: string): void {
    const managed = this.processes.get(sessionId);
    if (managed && managed.state.status === "starting") {
      this.updateState(sessionId, "running");
    }
  }

  /**
   * Validate and resolve a path
   */
  private validatePath(path: string): string {
    // Must be absolute
    if (!path.startsWith("/")) {
      throw new DevServerProcessError(
        "Path must be absolute",
        "INVALID_PATH"
      );
    }

    // Resolve to canonical path (prevents ../.. escapes)
    const resolved = pathResolve(path);

    // Must be within home or /tmp
    const home = process.env.HOME || "/tmp";
    if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
      throw new DevServerProcessError(
        "Path must be within home directory",
        "INVALID_PATH"
      );
    }

    return resolved;
  }

  /**
   * Sanitize environment variables
   */
  private sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    // Remove potentially dangerous variables
    const dangerous = new Set([
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
    ]);

    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined && !dangerous.has(key)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Update process state and notify listeners
   */
  private updateState(
    sessionId: string,
    status: ProcessStatus,
    exitCode?: number | null,
    exitSignal?: string | null,
    errorMessage?: string | null
  ): void {
    const managed = this.processes.get(sessionId);
    if (!managed) return;

    managed.state.status = status;
    if (exitCode !== undefined) managed.state.exitCode = exitCode;
    if (exitSignal !== undefined) managed.state.exitSignal = exitSignal;
    if (errorMessage !== undefined) managed.state.errorMessage = errorMessage;

    // Notify state listeners
    for (const listener of managed.stateListeners) {
      try {
        listener({ ...managed.state });
      } catch (error) {
        console.error(`[ProcessManager] State listener error:`, error);
      }
    }
  }

  /**
   * Broadcast a log entry to listeners
   */
  private broadcastLog(sessionId: string, entry: LogEntry): void {
    const managed = this.processes.get(sessionId);
    if (!managed) return;

    for (const listener of managed.logListeners) {
      try {
        listener(entry);
      } catch (error) {
        console.error(`[ProcessManager] Log listener error:`, error);
      }
    }
  }
}

// Export singleton instance
let instance: DevServerProcessManager | null = null;

export function getDevServerProcessManager(): DevServerProcessManager {
  if (!instance) {
    instance = new DevServerProcessManager();
  }
  return instance;
}

// Export class for testing
export { DevServerProcessManager, CircularLogBuffer };
