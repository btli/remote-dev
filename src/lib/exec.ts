/**
 * Safe execution utilities using execFile to prevent shell injection
 */
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFilePromise = promisify(execFileCallback);

/**
 * Get a clean environment with framework internal variables filtered out.
 * These variables should not leak into child processes.
 */
function getCleanProcessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Filter out Next.js internal variables
    if (key.startsWith("__NEXT_PRIVATE_")) continue;
    if (key.startsWith("__NEXT_ACTION_")) continue;
    // Filter out other framework internals
    if (key.startsWith("__VITE_")) continue;
    if (key.startsWith("__TURBOPACK_")) continue;
    env[key] = value;
  }
  return env;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecError extends Error {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Safely execute a command with arguments (no shell injection risk)
 * @param command - The command to execute (e.g., "git", "tmux")
 * @param args - Array of arguments (each arg is properly escaped)
 * @param options - Execution options
 */
export async function execFile(
  command: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  }
): Promise<ExecResult> {
  try {
    // Use clean environment to prevent framework internal vars from leaking
    const cleanEnv = getCleanProcessEnv();
    const { stdout, stderr } = await execFilePromise(command, args, {
      cwd: options?.cwd,
      env: { ...cleanEnv, ...options?.env } as NodeJS.ProcessEnv,
      timeout: options?.timeout ?? 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error) {
    const execError = error as Error & { code?: number; stdout?: string; stderr?: string };
    const err = new Error(execError.message) as ExecError;
    err.stdout = execError.stdout?.trim() ?? "";
    err.stderr = execError.stderr?.trim() ?? "";
    err.exitCode = typeof execError.code === "number" ? execError.code : 1;
    throw err;
  }
}

/**
 * Execute a command and return true/false based on exit code
 */
export async function execFileCheck(
  command: string,
  args: string[] = [],
  cwd?: string
): Promise<boolean> {
  try {
    await execFile(command, args, { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute without throwing - returns result with exit code
 */
export async function execFileNoThrow(
  command: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  }
): Promise<ExecResult> {
  try {
    return await execFile(command, args, options);
  } catch (error) {
    const execError = error as ExecError;
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.exitCode ?? 1,
    };
  }
}

export interface CappedExecResult {
  /** Captured stdout, truncated to at most `maxBytes` bytes (never throws on overflow). */
  stdout: string;
  exitCode: number;
  /** True when stdout exceeded `maxBytes` and was cut off, or the process timed out. */
  truncated: boolean;
  /** Total stdout bytes seen before truncation (>= stdout byte length when truncated). */
  bytes: number;
}

/**
 * Run a command capturing stdout up to a hard byte cap, without ever throwing on
 * overflow. Unlike {@link execFile}'s `maxBuffer` (which throws and discards all
 * stdout), this returns whatever was captured plus a `truncated` flag, so callers
 * can surface a "too large" response instead of an empty/failed one.
 *
 * Bounds the work two ways: a wall-clock `timeout` (kills the process) and a
 * `maxBytes` output cap (stops buffering and kills the process once reached).
 */
export function execFileCapped(
  command: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxBytes?: number;
  }
): Promise<CappedExecResult> {
  const maxBytes = options?.maxBytes ?? 10 * 1024 * 1024; // 10MB
  const timeout = options?.timeout ?? 30000;

  return new Promise((resolve, reject) => {
    const cleanEnv = getCleanProcessEnv();
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...cleanEnv, ...options?.env } as NodeJS.ProcessEnv,
      // No shell: true - arguments are passed directly
    });

    const chunks: Buffer[] = [];
    let bytes = 0;
    let captured = 0;
    let truncated = false;
    let settled = false;

    const timer = setTimeout(() => {
      truncated = true;
      proc.kill("SIGKILL");
    }, timeout);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(chunks, captured).toString(),
        exitCode,
        truncated,
        bytes,
      });
    };

    proc.stdout.on("data", (data: Buffer) => {
      bytes += data.length;
      if (captured >= maxBytes) {
        // Already at the cap; keep counting bytes but stop buffering + stop the process.
        if (!truncated) {
          truncated = true;
          proc.kill("SIGKILL");
        }
        return;
      }
      const remaining = maxBytes - captured;
      if (data.length > remaining) {
        chunks.push(data.subarray(0, remaining));
        captured += remaining;
        truncated = true;
        proc.kill("SIGKILL");
      } else {
        chunks.push(data);
        captured += data.length;
      }
    });

    // Drain stderr so the pipe can't fill and stall the child; we don't surface it.
    proc.stderr.on("data", () => {});

    proc.on("close", (code) => finish(code ?? 0));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Spawn a long-running process and stream output
 */
export function spawnProcess(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use clean environment to prevent framework internal vars from leaking
    const cleanEnv = getCleanProcessEnv();
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...cleanEnv, ...options?.env } as NodeJS.ProcessEnv,
      // No shell: true - arguments are passed directly
    });

    proc.stdout.on("data", (data: Buffer) => {
      options?.onStdout?.(data.toString());
    });

    proc.stderr.on("data", (data: Buffer) => {
      options?.onStderr?.(data.toString());
    });

    proc.on("close", (code) => {
      resolve(code ?? 0);
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}
