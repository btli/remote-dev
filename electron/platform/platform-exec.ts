/**
 * Platform-Aware Execution
 *
 * Provides a unified interface for executing commands that automatically
 * delegates to WSL on Windows when enabled.
 */

import { execFile, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import { ExecOptions, ExecResult, PlatformError, WslConfig } from "./types";
import {
  isWindows,
  windowsToWslPath,
  validateDistribution,
  buildWslEnv,
} from "./wsl-service";

const execFileAsync = promisify(execFile);

// In-memory WSL config cache (in real app, would be fetched from DB)
const wslConfigCache = new Map<string, { config: WslConfig; timestamp: number }>();
const CONFIG_TTL = 60000; // 1 minute

/**
 * Get WSL configuration for a user
 * In production, this would fetch from the database
 */
export async function getWslConfig(userId?: string): Promise<WslConfig | null> {
  // For now, return null (WSL disabled) or check cache
  if (!userId) return null;

  const cached = wslConfigCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CONFIG_TTL) {
    return cached.config;
  }

  // In production: fetch from database
  // const settings = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  // return settings?.wslEnabled ? { enabled: true, distribution: settings.wslDistribution, ... } : null;

  return null;
}

/**
 * Set WSL configuration for a user
 */
export function setWslConfig(userId: string, config: WslConfig): void {
  wslConfigCache.set(userId, { config, timestamp: Date.now() });
}

/**
 * Check if execution should use WSL
 */
export async function shouldUseWsl(
  options?: ExecOptions
): Promise<boolean> {
  // Not on Windows = no WSL
  if (!isWindows()) return false;

  // Forced native execution
  if (options?.forceNative) return false;

  // Check if user has WSL enabled
  const config = await getWslConfig(options?.userId);
  return config?.enabled ?? false;
}

/**
 * Platform-aware execFile
 * On Windows with WSL enabled, delegates to wsl.exe
 */
export async function platformExecFile(
  command: string,
  args: string[] = [],
  options?: ExecOptions
): Promise<ExecResult> {
  const useWsl = await shouldUseWsl(options);

  if (!useWsl) {
    // Native execution
    return nativeExecFile(command, args, options);
  }

  // WSL execution
  return wslExecFile(command, args, options);
}

/**
 * Native command execution
 */
async function nativeExecFile(
  command: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      timeout: options?.timeout ?? 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        exitCode: err.code ?? 1,
      };
    }
    throw new PlatformError(
      `Command failed: ${command} ${args.join(" ")}: ${err.message}`,
      "EXEC_FAILED"
    );
  }
}

/**
 * Execute command in WSL
 */
async function wslExecFile(
  command: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  const config = await getWslConfig(options?.userId);
  if (!config) {
    throw new PlatformError("WSL not configured", "WSL_NOT_ENABLED");
  }

  const distribution = options?.wslDistribution || config.distribution;

  // Validate distribution exists
  const valid = await validateDistribution(distribution);
  if (!valid) {
    throw new PlatformError(
      `WSL distribution "${distribution}" not found`,
      "DISTRO_NOT_FOUND"
    );
  }

  // Build WSL command
  const wslArgs: string[] = ["-d", distribution];

  // Add working directory if specified
  if (options?.cwd) {
    const wslCwd = windowsToWslPath(options.cwd);
    wslArgs.push("--cd", wslCwd);
  }

  // Add the actual command
  wslArgs.push("-e", command, ...args);

  // Build environment
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options?.env) {
    Object.assign(env, options.env);
    // Set WSLENV to pass environment variables
    // Filter out undefined values for buildWslEnv
    const definedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== undefined) {
        definedEnv[key] = value;
      }
    }
    const wslEnv = buildWslEnv(definedEnv);
    if (wslEnv) {
      env.WSLENV = wslEnv;
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync("wsl.exe", wslArgs, {
      env,
      timeout: options?.timeout ?? 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    return {
      stdout: stdout.replace(/\0/g, ""),
      stderr: stderr.replace(/\0/g, ""),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return {
        stdout: (err.stdout || "").replace(/\0/g, ""),
        stderr: (err.stderr || "").replace(/\0/g, ""),
        exitCode: err.code ?? 1,
      };
    }
    throw new PlatformError(
      `WSL command failed: ${command} ${args.join(" ")}: ${err.message}`,
      "EXEC_FAILED"
    );
  }
}

/**
 * Platform-aware spawn for long-running processes
 * Returns a ChildProcess that can be used for PTY or streaming output
 */
export function platformSpawn(
  command: string,
  args: string[],
  options?: ExecOptions & { stdio?: "pipe" | "inherit" | "ignore" }
): ChildProcess {
  // For now, always use native spawn
  // WSL spawning would need to wrap with wsl.exe -d <distro> -e
  // This is more complex for PTY and will be handled in the terminal server

  const spawnOptions = {
    cwd: options?.cwd,
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    stdio: options?.stdio ?? ("pipe" as const),
  };

  return spawn(command, args, spawnOptions);
}

/**
 * Get the platform-appropriate shell
 */
export function getShell(): string {
  if (platform() === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/sh";
}

/**
 * Get the WSL shell (for Windows)
 */
export async function getWslShell(distribution: string): Promise<string> {
  const config = await getWslConfig();
  if (config) {
    // Get the default shell from WSL
    try {
      const result = await wslExecFile("sh", ["-c", "echo $SHELL"], {
        wslDistribution: distribution,
        forceNative: false,
      });
      return result.stdout.trim() || "/bin/bash";
    } catch {
      return "/bin/bash";
    }
  }
  return "/bin/bash";
}
