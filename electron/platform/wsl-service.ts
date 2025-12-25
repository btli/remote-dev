/**
 * WSL Service
 *
 * Handles Windows Subsystem for Linux detection, management, and path translation.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import { WslInfo, WslDistribution, PlatformError } from "./types";

const execFileAsync = promisify(execFile);

// Cache WSL info to avoid repeated calls
let wslInfoCache: { info: WslInfo; timestamp: number } | null = null;
const WSL_INFO_TTL = 300000; // 5 minutes

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return platform() === "win32";
}

/**
 * Get WSL installation info
 */
export async function getWslInfo(): Promise<WslInfo> {
  if (!isWindows()) {
    return {
      installed: false,
      available: false,
      distributions: [],
      defaultDistribution: null,
      version: 0,
    };
  }

  // Check cache
  if (wslInfoCache && Date.now() - wslInfoCache.timestamp < WSL_INFO_TTL) {
    return wslInfoCache.info;
  }

  try {
    // Run wsl --list --verbose to get distributions
    const { stdout } = await execFileAsync("wsl.exe", ["--list", "--verbose"], {
      timeout: 10000,
      windowsHide: true,
    });

    const distributions = parseWslListOutput(stdout);
    const defaultDistro = distributions.find((d) => d.isDefault)?.name ?? null;
    const maxVersion = Math.max(...distributions.map((d) => d.version), 0);

    const info: WslInfo = {
      installed: true,
      available: distributions.length > 0,
      distributions,
      defaultDistribution: defaultDistro,
      version: maxVersion,
    };

    wslInfoCache = { info, timestamp: Date.now() };
    return info;
  } catch (error) {
    // WSL not installed or not in PATH
    const info: WslInfo = {
      installed: false,
      available: false,
      distributions: [],
      defaultDistribution: null,
      version: 0,
    };
    wslInfoCache = { info, timestamp: Date.now() };
    return info;
  }
}

/**
 * Parse the output of `wsl --list --verbose`
 *
 * Example output:
 *   NAME            STATE           VERSION
 * * Ubuntu-24.04    Running         2
 *   Debian          Stopped         2
 */
function parseWslListOutput(output: string): WslDistribution[] {
  const distributions: WslDistribution[] = [];

  // Handle UTF-16 encoding from wsl.exe
  const cleanOutput = output
    .replace(/\0/g, "")
    .replace(/\r/g, "")
    .trim();

  const lines = cleanOutput.split("\n").slice(1); // Skip header

  for (const line of lines) {
    if (!line.trim()) continue;

    // Check for default marker (*)
    const isDefault = line.startsWith("*");
    const cleanLine = line.replace(/^\*\s*/, "").trim();

    // Parse columns: NAME STATE VERSION
    const parts = cleanLine.split(/\s{2,}/);
    if (parts.length >= 3) {
      const name = parts[0].trim();
      const state = parts[1].trim() as WslDistribution["state"];
      const version = parseInt(parts[2].trim()) || 2;

      if (name && name !== "NAME") {
        distributions.push({
          name,
          version,
          isDefault,
          state: ["Running", "Stopped", "Installing"].includes(state)
            ? (state as WslDistribution["state"])
            : "Unknown",
        });
      }
    }
  }

  return distributions;
}

/**
 * List all installed WSL distributions
 */
export async function listDistributions(): Promise<WslDistribution[]> {
  const info = await getWslInfo();
  return info.distributions;
}

/**
 * Get the default WSL distribution
 */
export async function getDefaultDistribution(): Promise<string | null> {
  const info = await getWslInfo();
  return info.defaultDistribution;
}

/**
 * Validate that a distribution exists
 */
export async function validateDistribution(name: string): Promise<boolean> {
  const distributions = await listDistributions();
  return distributions.some(
    (d) => d.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Translate a Windows path to WSL path
 * C:\Users\Bryan\Projects -> /mnt/c/Users/Bryan/Projects
 */
export function windowsToWslPath(windowsPath: string): string {
  if (!windowsPath) return windowsPath;

  // Handle UNC paths - not supported
  if (windowsPath.startsWith("\\\\")) {
    throw new PlatformError(
      "Network paths (UNC) are not supported in WSL. Use a local directory.",
      "PATH_TRANSLATION_FAILED"
    );
  }

  // Handle drive letter paths: C:\... -> /mnt/c/...
  const driveMatch = windowsPath.match(/^([A-Za-z]):(\\|\/)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    const restOfPath = windowsPath.slice(3).replace(/\\/g, "/");
    return `/mnt/${driveLetter}/${restOfPath}`;
  }

  // Handle relative paths or already-unix paths
  return windowsPath.replace(/\\/g, "/");
}

/**
 * Translate a WSL path to Windows path
 * /mnt/c/Users/Bryan/Projects -> C:\Users\Bryan\Projects
 */
export function wslToWindowsPath(wslPath: string): string {
  if (!wslPath) return wslPath;

  // Handle /mnt/X/... paths
  const mntMatch = wslPath.match(/^\/mnt\/([a-z])\/(.*)/i);
  if (mntMatch) {
    const driveLetter = mntMatch[1].toUpperCase();
    const restOfPath = mntMatch[2].replace(/\//g, "\\");
    return `${driveLetter}:\\${restOfPath}`;
  }

  // Handle WSL internal paths (e.g., /home/user) - prepend \\wsl$
  if (wslPath.startsWith("/")) {
    // These would need the distro name, return as-is for now
    return wslPath;
  }

  return wslPath.replace(/\//g, "\\");
}

/**
 * Get the home directory inside WSL for the current user
 */
export async function getWslHomeDirectory(
  distribution: string
): Promise<string> {
  if (!isWindows()) {
    throw new PlatformError(
      "WSL is only available on Windows",
      "WSL_NOT_INSTALLED"
    );
  }

  try {
    const { stdout } = await execFileAsync(
      "wsl.exe",
      ["-d", distribution, "-e", "sh", "-c", "echo $HOME"],
      {
        timeout: 10000,
        windowsHide: true,
      }
    );

    return stdout.replace(/\0/g, "").trim() || "/home";
  } catch (error) {
    throw new PlatformError(
      `Failed to get home directory for ${distribution}: ${error}`,
      "DISTRO_NOT_FOUND"
    );
  }
}

/**
 * Get the username inside WSL
 */
export async function getWslUsername(distribution: string): Promise<string> {
  if (!isWindows()) {
    throw new PlatformError(
      "WSL is only available on Windows",
      "WSL_NOT_INSTALLED"
    );
  }

  try {
    const { stdout } = await execFileAsync(
      "wsl.exe",
      ["-d", distribution, "-e", "whoami"],
      {
        timeout: 10000,
        windowsHide: true,
      }
    );

    return stdout.replace(/\0/g, "").trim();
  } catch (error) {
    throw new PlatformError(
      `Failed to get username for ${distribution}: ${error}`,
      "DISTRO_NOT_FOUND"
    );
  }
}

/**
 * Test WSL connectivity by running a simple command
 */
export async function testWslConnection(
  distribution: string
): Promise<{ success: boolean; error?: string }> {
  if (!isWindows()) {
    return { success: false, error: "WSL is only available on Windows" };
  }

  try {
    const { stdout } = await execFileAsync(
      "wsl.exe",
      ["-d", distribution, "-e", "echo", "WSL_TEST_SUCCESS"],
      {
        timeout: 10000,
        windowsHide: true,
      }
    );

    const output = stdout.replace(/\0/g, "").trim();
    if (output === "WSL_TEST_SUCCESS") {
      return { success: true };
    }
    return { success: false, error: `Unexpected output: ${output}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a command exists in WSL
 */
export async function wslCommandExists(
  distribution: string,
  command: string
): Promise<boolean> {
  if (!isWindows()) return false;

  try {
    await execFileAsync(
      "wsl.exe",
      ["-d", distribution, "-e", "which", command],
      {
        timeout: 10000,
        windowsHide: true,
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command in WSL and return the output
 */
export async function runInWsl(
  distribution: string,
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  if (!isWindows()) {
    throw new PlatformError(
      "WSL is only available on Windows",
      "WSL_NOT_INSTALLED"
    );
  }

  const wslArgs = ["-d", distribution];

  // Add working directory if specified
  if (options.cwd) {
    const wslCwd = windowsToWslPath(options.cwd);
    wslArgs.push("--cd", wslCwd);
  }

  // Add the command
  wslArgs.push("-e", command, ...args);

  try {
    const { stdout, stderr } = await execFileAsync("wsl.exe", wslArgs, {
      timeout: options.timeout ?? 30000,
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : undefined,
    });

    return {
      stdout: stdout.replace(/\0/g, ""),
      stderr: stderr.replace(/\0/g, ""),
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    throw new PlatformError(
      `WSL command failed: ${err.message ?? error}`,
      "EXEC_FAILED"
    );
  }
}

/**
 * Clear the WSL info cache
 */
export function clearWslCache(): void {
  wslInfoCache = null;
}

/**
 * Build WSLENV string for environment variable passing
 * See: https://devblogs.microsoft.com/commandline/share-environment-vars-between-wsl-and-windows/
 */
export function buildWslEnv(
  env: Record<string, string>,
  translatePaths: string[] = []
): string {
  const parts: string[] = [];

  for (const key of Object.keys(env)) {
    if (translatePaths.includes(key)) {
      parts.push(`${key}/p`); // /p flag translates paths
    } else {
      parts.push(key);
    }
  }

  return parts.join(":");
}
