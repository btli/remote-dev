/**
 * Platform Service
 *
 * Detects platform information and provides unified access to platform-specific functionality.
 */

import { platform, arch, homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  PlatformInfo,
  PlatformOS,
  PlatformArch,
  PackageManager,
  DependencyCheck,
} from "./types";
import { getWslInfo } from "./wsl-service";
import { MacOSAdapter } from "./adapters/macos";
import { LinuxAdapter } from "./adapters/linux";
import { WindowsAdapter } from "./adapters/windows";

const execFileAsync = promisify(execFile);

// Cache platform info
let platformInfoCache: PlatformInfo | null = null;

/**
 * Detect current platform information
 */
export async function detectPlatform(): Promise<PlatformInfo> {
  if (platformInfoCache) {
    return platformInfoCache;
  }

  const os = platform() as PlatformOS;
  const archName = arch() as PlatformArch;
  const home = homedir();
  const shell = process.env.SHELL || (os === "win32" ? "cmd.exe" : "/bin/sh");

  let isWSL = false;
  let wslDistros = undefined;
  let packageManager: PackageManager | undefined;

  if (os === "win32") {
    const wslInfo = await getWslInfo();
    isWSL = wslInfo.available;
    wslDistros = wslInfo.distributions;
    packageManager = await detectWindowsPackageManager();
  } else if (os === "darwin") {
    packageManager = await detectMacOSPackageManager();
  } else if (os === "linux") {
    packageManager = await detectLinuxPackageManager();
  }

  const info: PlatformInfo = {
    os,
    arch: archName,
    isWSL,
    wslDistros,
    packageManager,
    shell,
    homeDirectory: home,
  };

  platformInfoCache = info;
  return info;
}

/**
 * Detect package manager on macOS
 */
async function detectMacOSPackageManager(): Promise<PackageManager | undefined> {
  try {
    await execFileAsync("brew", ["--version"], { timeout: 5000 });
    return "brew";
  } catch {
    return undefined;
  }
}

/**
 * Detect package manager on Linux
 */
async function detectLinuxPackageManager(): Promise<PackageManager | undefined> {
  const managers: { cmd: string; manager: PackageManager }[] = [
    { cmd: "apt", manager: "apt" },
    { cmd: "dnf", manager: "dnf" },
    { cmd: "yum", manager: "yum" },
    { cmd: "pacman", manager: "pacman" },
    { cmd: "zypper", manager: "zypper" },
    { cmd: "apk", manager: "apk" },
  ];

  for (const { cmd, manager } of managers) {
    try {
      await execFileAsync("which", [cmd], { timeout: 5000 });
      return manager;
    } catch {
      // Continue to next
    }
  }

  return undefined;
}

/**
 * Detect package manager on Windows
 */
async function detectWindowsPackageManager(): Promise<PackageManager | undefined> {
  // Check for winget first (built into Windows 11)
  try {
    await execFileAsync("winget", ["--version"], { timeout: 5000 });
    return "winget";
  } catch {
    // Check for Chocolatey
    try {
      await execFileAsync("choco", ["--version"], { timeout: 5000 });
      return "choco";
    } catch {
      return undefined;
    }
  }
}

/**
 * Get the appropriate platform adapter
 */
export function getAdapter(): MacOSAdapter | LinuxAdapter | WindowsAdapter {
  const os = platform();

  switch (os) {
    case "darwin":
      return new MacOSAdapter();
    case "linux":
      return new LinuxAdapter();
    case "win32":
      return new WindowsAdapter();
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/**
 * Check all required dependencies
 */
export async function checkAllDependencies(): Promise<DependencyCheck[]> {
  const adapter = getAdapter();
  const dependencies = ["tmux", "git", "bun", "cloudflared"];
  const results: DependencyCheck[] = [];

  for (const dep of dependencies) {
    const check = await adapter.checkDependency(dep);
    results.push(check);
  }

  return results;
}

/**
 * Get dependency info by name
 */
export function getDependencyInfo(name: string): Partial<DependencyCheck> {
  const deps: Record<string, Partial<DependencyCheck>> = {
    tmux: {
      displayName: "tmux",
      required: true,
      downloadUrl: "https://github.com/tmux/tmux",
    },
    git: {
      displayName: "Git",
      required: false,
      downloadUrl: "https://git-scm.com/downloads",
    },
    bun: {
      displayName: "Bun",
      required: true,
      downloadUrl: "https://bun.sh",
    },
    node: {
      displayName: "Node.js",
      required: false,
      downloadUrl: "https://nodejs.org",
    },
    cloudflared: {
      displayName: "cloudflared",
      required: false,
      downloadUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    },
  };

  return deps[name] || { displayName: name, required: false };
}

/**
 * Clear platform cache
 */
export function clearPlatformCache(): void {
  platformInfoCache = null;
}

/**
 * Check if a command exists on the system
 */
export async function commandExists(command: string): Promise<boolean> {
  const os = platform();

  try {
    if (os === "win32") {
      await execFileAsync("where", [command], { timeout: 5000 });
    } else {
      await execFileAsync("which", [command], { timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get command version
 */
export async function getCommandVersion(
  command: string,
  versionFlag = "--version"
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, [versionFlag], {
      timeout: 5000,
    });
    // Extract version number from output
    const match = stdout.match(/(\d+\.\d+\.?\d*)/);
    return match ? match[1] : stdout.trim().split("\n")[0];
  } catch {
    return null;
  }
}
