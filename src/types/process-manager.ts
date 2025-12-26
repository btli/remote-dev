/**
 * Process Manager Type Definitions
 *
 * Types for the DevServerProcessManager which handles direct process spawning
 * for dev server sessions (bypassing tmux for better PID tracking and log capture).
 */

/**
 * Configuration for spawning a dev server process
 */
export interface ProcessConfig {
  sessionId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * A single log entry from stdout or stderr
 */
export interface LogEntry {
  /** Monotonic timestamp (Date.now()) */
  timestamp: number;
  /** Which stream produced this output */
  stream: "stdout" | "stderr";
  /** Raw output data */
  data: string;
}

/**
 * Current state of a managed process
 */
export interface ProcessState {
  /** Process ID (null if not yet spawned or already exited) */
  pid: number | null;
  /** Current lifecycle status */
  status: ProcessStatus;
  /** Exit code if process has exited */
  exitCode: number | null;
  /** Signal that killed the process (e.g., "SIGTERM") */
  exitSignal: string | null;
  /** When the process was started (monotonic timestamp) */
  startedAt: number;
  /** Error message if process failed to start */
  errorMessage: string | null;
}

/**
 * Process lifecycle status
 */
export type ProcessStatus = "starting" | "running" | "crashed" | "stopped";

/**
 * Callback for receiving log entries
 */
export type LogListener = (entry: LogEntry) => void;

/**
 * Callback for receiving process state changes
 */
export type StateListener = (state: ProcessState) => void;

/**
 * WebSocket message types for dev server log streaming
 */
export interface DevServerWsMessages {
  /** Server → Client: Historical log entries on connect */
  "log-history": {
    type: "log-history";
    entries: LogEntry[];
  };

  /** Server → Client: Real-time log output */
  "log-output": {
    type: "log-output";
    stream: "stdout" | "stderr";
    data: string;
    timestamp: number;
  };

  /** Server → Client: Process exited */
  "process-exit": {
    type: "process-exit";
    exitCode: number | null;
    signal: string | null;
  };

  /** Server → Client: Process error (failed to start) */
  "process-error": {
    type: "process-error";
    message: string;
  };

  /** Server → Client: Ready with initial state */
  "dev-server-ready": {
    type: "dev-server-ready";
    sessionId: string;
    state: ProcessState;
  };

  /** Client → Server: Request to stop process */
  "stop": {
    type: "stop";
    signal?: "SIGTERM" | "SIGKILL";
  };

  /** Client → Server: Request to clear logs */
  "clear-logs": {
    type: "clear-logs";
  };
}

/**
 * Error thrown by DevServerProcessManager
 */
export class DevServerProcessError extends Error {
  constructor(
    message: string,
    public readonly code: DevServerProcessErrorCode,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "DevServerProcessError";
  }
}

/**
 * Error codes for DevServerProcessError
 */
export type DevServerProcessErrorCode =
  | "SPAWN_FAILED"
  | "PROCESS_NOT_FOUND"
  | "ALREADY_RUNNING"
  | "INVALID_PATH"
  | "COMMAND_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "TIMEOUT";
