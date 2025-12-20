/**
 * Safe execution utilities using execFile to prevent shell injection
 */
import { execFile as execFileCallback, spawn } from "child_process";
import { promisify } from "util";

const execFilePromise = promisify(execFileCallback);

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
    const { stdout, stderr } = await execFilePromise(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
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
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
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
