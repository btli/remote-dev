/**
 * Linux Platform Adapter
 *
 * Handles Linux-specific dependency detection and installation via various package managers.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import {
  PlatformAdapter,
  PackageManager,
  DependencyCheck,
} from "../types";
import { getDependencyInfo, getCommandVersion, commandExists } from "../platform-service";

const execFileAsync = promisify(execFile);

export class LinuxAdapter implements PlatformAdapter {
  private packageManager: PackageManager | null = null;
  private distroId: string | null = null;

  async detectPackageManager(): Promise<PackageManager | null> {
    if (this.packageManager !== null) {
      return this.packageManager;
    }

    // Detect distro first
    this.distroId = await this.detectDistro();

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
        this.packageManager = manager;
        return manager;
      } catch {
        // Continue to next
      }
    }

    return null;
  }

  /**
   * Detect Linux distribution
   */
  private async detectDistro(): Promise<string | null> {
    // Try /etc/os-release first
    if (existsSync("/etc/os-release")) {
      try {
        const content = readFileSync("/etc/os-release", "utf-8");
        const match = content.match(/^ID=(.*)$/m);
        if (match) {
          return match[1].replace(/"/g, "").toLowerCase();
        }
      } catch {
        // Ignore
      }
    }

    // Try lsb_release
    try {
      const { stdout } = await execFileAsync("lsb_release", ["-is"], {
        timeout: 5000,
      });
      return stdout.trim().toLowerCase();
    } catch {
      return null;
    }
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
    const pm = await this.detectPackageManager();

    if (!pm) {
      return {
        success: false,
        error: "No supported package manager found",
      };
    }

    const packageName = this.getPackageName(name, pm);
    const installCmd = this.getInstallCommandParts(pm, packageName);

    try {
      // Note: This requires sudo, which won't work without user interaction
      // In practice, we'd use electron's dialog to show the command to run
      await execFileAsync(installCmd[0], installCmd.slice(1), {
        timeout: 300000,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Installation requires sudo. Run: ${this.getInstallCommand(name)}`,
      };
    }
  }

  getInstallCommand(name: string): string {
    const pm = this.packageManager;
    if (!pm) {
      return `# Install ${name} using your package manager`;
    }

    const packageName = this.getPackageName(name, pm);

    switch (pm) {
      case "apt":
        return `sudo apt install -y ${packageName}`;
      case "dnf":
        return `sudo dnf install -y ${packageName}`;
      case "yum":
        return `sudo yum install -y ${packageName}`;
      case "pacman":
        return `sudo pacman -S --noconfirm ${packageName}`;
      case "zypper":
        return `sudo zypper install -y ${packageName}`;
      case "apk":
        return `sudo apk add ${packageName}`;
      default:
        return `# Install ${packageName} using your package manager`;
    }
  }

  /**
   * Get install command parts for execFile
   */
  private getInstallCommandParts(
    pm: PackageManager,
    packageName: string
  ): string[] {
    switch (pm) {
      case "apt":
        return ["sudo", "apt", "install", "-y", packageName];
      case "dnf":
        return ["sudo", "dnf", "install", "-y", packageName];
      case "yum":
        return ["sudo", "yum", "install", "-y", packageName];
      case "pacman":
        return ["sudo", "pacman", "-S", "--noconfirm", packageName];
      case "zypper":
        return ["sudo", "zypper", "install", "-y", packageName];
      case "apk":
        return ["sudo", "apk", "add", packageName];
      default:
        return ["echo", `Install ${packageName}`];
    }
  }

  /**
   * Map dependency name to package name for different package managers
   */
  private getPackageName(name: string, pm: PackageManager): string {
    const mapping: Record<string, Record<PackageManager, string>> = {
      tmux: {
        apt: "tmux",
        dnf: "tmux",
        yum: "tmux",
        pacman: "tmux",
        zypper: "tmux",
        apk: "tmux",
        brew: "tmux",
        choco: "tmux",
        winget: "tmux",
      },
      git: {
        apt: "git",
        dnf: "git",
        yum: "git",
        pacman: "git",
        zypper: "git",
        apk: "git",
        brew: "git",
        choco: "git",
        winget: "Git.Git",
      },
      bun: {
        apt: "bun", // Needs external repo
        dnf: "bun",
        yum: "bun",
        pacman: "bun",
        zypper: "bun",
        apk: "bun",
        brew: "bun",
        choco: "bun",
        winget: "Oven-sh.Bun",
      },
      cloudflared: {
        apt: "cloudflared",
        dnf: "cloudflared",
        yum: "cloudflared",
        pacman: "cloudflared",
        zypper: "cloudflared",
        apk: "cloudflared",
        brew: "cloudflared",
        choco: "cloudflared",
        winget: "Cloudflare.cloudflared",
      },
    };

    return mapping[name]?.[pm] || name;
  }

  /**
   * Get special installation instructions for dependencies not in default repos
   */
  getSpecialInstallInstructions(name: string): string[] | null {
    if (name === "bun") {
      return [
        "# Install Bun using the official installer",
        "curl -fsSL https://bun.sh/install | bash",
      ];
    }

    if (name === "cloudflared") {
      const distro = this.distroId;
      if (distro === "ubuntu" || distro === "debian") {
        return [
          "# Add Cloudflare GPG key and repository",
          "curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null",
          'echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list',
          "sudo apt update && sudo apt install cloudflared",
        ];
      }
    }

    return null;
  }
}
