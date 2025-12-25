/**
 * Windows Platform Adapter
 *
 * Handles Windows-specific dependency detection via WSL.
 * Since Remote Dev requires tmux, Windows support is through WSL only.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import {
  PlatformAdapter,
  PackageManager,
  DependencyCheck,
} from "../types";
import {
  getWslInfo,
  getDefaultDistribution,
  wslCommandExists,
  runInWsl,
  testWslConnection,
} from "../wsl-service";
import { getDependencyInfo } from "../platform-service";

const execFileAsync = promisify(execFile);

export class WindowsAdapter implements PlatformAdapter {
  private wslDistribution: string | null = null;

  /**
   * Set the WSL distribution to use for commands
   */
  setDistribution(distro: string): void {
    this.wslDistribution = distro;
  }

  /**
   * Get the current WSL distribution (or default)
   */
  async getDistribution(): Promise<string | null> {
    if (this.wslDistribution) {
      return this.wslDistribution;
    }
    return await getDefaultDistribution();
  }

  async detectPackageManager(): Promise<PackageManager | null> {
    // Check for Windows package managers
    try {
      await execFileAsync("winget", ["--version"], { timeout: 5000 });
      return "winget";
    } catch {
      try {
        await execFileAsync("choco", ["--version"], { timeout: 5000 });
        return "choco";
      } catch {
        return null;
      }
    }
  }

  /**
   * Detect package manager inside WSL
   */
  async detectWslPackageManager(distro: string): Promise<PackageManager | null> {
    const managers: { cmd: string; manager: PackageManager }[] = [
      { cmd: "apt", manager: "apt" },
      { cmd: "dnf", manager: "dnf" },
      { cmd: "pacman", manager: "pacman" },
    ];

    for (const { cmd, manager } of managers) {
      const exists = await wslCommandExists(distro, cmd);
      if (exists) {
        return manager;
      }
    }

    return null;
  }

  async checkDependency(name: string): Promise<DependencyCheck> {
    const info = getDependencyInfo(name);
    const check: DependencyCheck = {
      name,
      displayName: info.displayName || name,
      required: info.required ?? false,
      installed: false,
      status: "checking",
      downloadUrl: info.downloadUrl,
    };

    // For Windows, we need to check inside WSL
    const distro = await this.getDistribution();

    if (!distro) {
      // WSL not available - check if it's a Windows-native tool
      if (name === "git") {
        return this.checkWindowsNativeDependency(name, check);
      }

      check.status = "error";
      check.error = "WSL is required but not installed";
      check.installCommand = "wsl --install";
      return check;
    }

    try {
      const exists = await wslCommandExists(distro, name);

      if (exists) {
        check.installed = true;
        check.status = "installed";

        // Get version from WSL
        try {
          const { stdout } = await runInWsl(distro, name, ["--version"]);
          const match = stdout.match(/(\d+\.\d+\.?\d*)/);
          check.version = match ? match[1] : undefined;
        } catch {
          // Version check failed, but command exists
        }
      } else {
        check.status = "missing";
        check.installCommand = await this.getWslInstallCommand(distro, name);
      }
    } catch (error) {
      check.status = "error";
      check.error = error instanceof Error ? error.message : String(error);
    }

    return check;
  }

  /**
   * Check for Windows-native dependencies (like Git for Windows)
   */
  private async checkWindowsNativeDependency(
    name: string,
    check: DependencyCheck
  ): Promise<DependencyCheck> {
    try {
      const { stdout } = await execFileAsync(name, ["--version"], {
        timeout: 5000,
      });
      check.installed = true;
      check.status = "installed";
      const match = stdout.match(/(\d+\.\d+\.?\d*)/);
      check.version = match ? match[1] : undefined;
    } catch {
      check.status = "missing";
      check.installCommand = this.getInstallCommand(name);
    }

    return check;
  }

  async installDependency(
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    const distro = await this.getDistribution();

    if (!distro) {
      return {
        success: false,
        error: "WSL is required but not installed. Run: wsl --install",
      };
    }

    // Get the package manager in WSL
    const pm = await this.detectWslPackageManager(distro);
    if (!pm) {
      return {
        success: false,
        error: "No package manager found in WSL",
      };
    }

    const installCmd = this.getWslInstallCommandParts(pm, name);

    try {
      await runInWsl(distro, installCmd[0], installCmd.slice(1), {
        timeout: 300000,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Installation failed. Try running manually in WSL: ${await this.getWslInstallCommand(distro, name)}`,
      };
    }
  }

  getInstallCommand(name: string): string {
    // This is for Windows-native installation
    const mapping: Record<string, string> = {
      git: "winget install Git.Git",
      cloudflared: "winget install Cloudflare.cloudflared",
    };

    return mapping[name] || `winget install ${name}`;
  }

  /**
   * Get WSL install command for a dependency
   */
  private async getWslInstallCommand(
    distro: string,
    name: string
  ): Promise<string> {
    const pm = await this.detectWslPackageManager(distro);

    switch (pm) {
      case "apt":
        return `wsl -d ${distro} -- sudo apt install -y ${name}`;
      case "dnf":
        return `wsl -d ${distro} -- sudo dnf install -y ${name}`;
      case "pacman":
        return `wsl -d ${distro} -- sudo pacman -S --noconfirm ${name}`;
      default:
        return `wsl -d ${distro} -- # Install ${name} using your package manager`;
    }
  }

  /**
   * Get install command parts for running in WSL
   */
  private getWslInstallCommandParts(
    pm: PackageManager,
    name: string
  ): string[] {
    switch (pm) {
      case "apt":
        return ["sudo", "apt", "install", "-y", name];
      case "dnf":
        return ["sudo", "dnf", "install", "-y", name];
      case "pacman":
        return ["sudo", "pacman", "-S", "--noconfirm", name];
      default:
        return ["echo", `Install ${name}`];
    }
  }

  /**
   * Check WSL installation status
   */
  async checkWslStatus(): Promise<{
    installed: boolean;
    hasDistribution: boolean;
    defaultDistribution: string | null;
    error?: string;
  }> {
    const wslInfo = await getWslInfo();

    return {
      installed: wslInfo.installed,
      hasDistribution: wslInfo.distributions.length > 0,
      defaultDistribution: wslInfo.defaultDistribution,
    };
  }

  /**
   * Get WSL installation guide
   */
  getWslInstallGuide(): string[] {
    return [
      "Windows Subsystem for Linux (WSL) is required for Remote Dev.",
      "",
      "Quick Install (Windows 11 or Windows 10 version 2004+):",
      "1. Open PowerShell as Administrator",
      "2. Run: wsl --install",
      "3. Restart your computer",
      "4. Complete Ubuntu setup when prompted",
      "",
      "Manual Install (older Windows 10):",
      "See: https://learn.microsoft.com/en-us/windows/wsl/install-manual",
    ];
  }

  /**
   * Test WSL connectivity with current distribution
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const distro = await this.getDistribution();
    if (!distro) {
      return { success: false, error: "No WSL distribution available" };
    }
    return await testWslConnection(distro);
  }
}
