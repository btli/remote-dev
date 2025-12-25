/**
 * macOS Platform Adapter
 *
 * Handles macOS-specific dependency detection and installation via Homebrew.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import {
  PlatformAdapter,
  PackageManager,
  DependencyCheck,
} from "../types";
import { getDependencyInfo, getCommandVersion, commandExists } from "../platform-service";

const execFileAsync = promisify(execFile);

export class MacOSAdapter implements PlatformAdapter {
  private hasHomebrew: boolean | null = null;

  async detectPackageManager(): Promise<PackageManager | null> {
    if (this.hasHomebrew === null) {
      try {
        await execFileAsync("brew", ["--version"], { timeout: 5000 });
        this.hasHomebrew = true;
      } catch {
        this.hasHomebrew = false;
      }
    }
    return this.hasHomebrew ? "brew" : null;
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

    try {
      const exists = await commandExists(name);
      if (exists) {
        check.installed = true;
        check.status = "installed";
        check.version = (await getCommandVersion(name)) ?? undefined;
      } else {
        check.status = "missing";
        check.installCommand = this.getInstallCommand(name);
      }
    } catch (error) {
      check.status = "error";
      check.error = error instanceof Error ? error.message : String(error);
    }

    return check;
  }

  async installDependency(
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    const hasHomebrew = await this.detectPackageManager();

    if (!hasHomebrew) {
      return {
        success: false,
        error:
          "Homebrew is not installed. Please install Homebrew first: https://brew.sh",
      };
    }

    const brewName = this.getBrewPackageName(name);

    try {
      await execFileAsync("brew", ["install", brewName], {
        timeout: 300000, // 5 minutes
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getInstallCommand(name: string): string {
    const brewName = this.getBrewPackageName(name);
    return `brew install ${brewName}`;
  }

  /**
   * Map dependency name to Homebrew package name
   */
  private getBrewPackageName(name: string): string {
    const mapping: Record<string, string> = {
      tmux: "tmux",
      git: "git",
      bun: "oven-sh/bun/bun",
      node: "node",
      cloudflared: "cloudflare/cloudflare/cloudflared",
    };
    return mapping[name] || name;
  }

  /**
   * Get installation guide for macOS
   */
  getInstallGuide(name: string): string[] {
    const steps: string[] = [];

    // Check if Homebrew is needed
    if (!this.hasHomebrew) {
      steps.push(
        'Install Homebrew first: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
      );
    }

    steps.push(this.getInstallCommand(name));

    return steps;
  }
}
