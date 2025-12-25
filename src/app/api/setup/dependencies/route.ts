import { NextResponse } from "next/server";
import { platform } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface DependencyCheck {
  name: string;
  displayName: string;
  required: boolean;
  installed: boolean;
  version?: string;
  status: "checking" | "installed" | "missing" | "error";
  installCommand?: string;
  downloadUrl?: string;
  error?: string;
}

const DEPENDENCIES = [
  {
    name: "tmux",
    displayName: "tmux",
    required: true,
    downloadUrl: "https://github.com/tmux/tmux",
  },
  {
    name: "git",
    displayName: "Git",
    required: false,
    downloadUrl: "https://git-scm.com/downloads",
  },
  {
    name: "bun",
    displayName: "Bun",
    required: true,
    downloadUrl: "https://bun.sh",
  },
  {
    name: "cloudflared",
    displayName: "cloudflared",
    required: false,
    downloadUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
  },
];

/**
 * Check if a command exists on the system
 */
async function commandExists(command: string): Promise<boolean> {
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
async function getVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], {
      timeout: 5000,
    });
    const match = stdout.match(/(\d+\.\d+\.?\d*)/);
    return match ? match[1] : stdout.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

/**
 * Get install command for a dependency based on platform
 */
function getInstallCommand(name: string, packageManager?: string): string {
  const os = platform();

  if (name === "bun") {
    return "curl -fsSL https://bun.sh/install | bash";
  }

  if (os === "darwin") {
    if (packageManager === "brew") {
      return `brew install ${name}`;
    }
    return `# Install Homebrew first: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;
  }

  if (os === "linux") {
    switch (packageManager) {
      case "apt":
        return `sudo apt install -y ${name}`;
      case "dnf":
        return `sudo dnf install -y ${name}`;
      case "yum":
        return `sudo yum install -y ${name}`;
      case "pacman":
        return `sudo pacman -S --noconfirm ${name}`;
      case "zypper":
        return `sudo zypper install -y ${name}`;
      case "apk":
        return `sudo apk add ${name}`;
      default:
        return `# Install ${name} using your package manager`;
    }
  }

  if (os === "win32") {
    // WSL commands
    return `wsl -- sudo apt install -y ${name}`;
  }

  return `# Install ${name} manually`;
}

/**
 * GET /api/setup/dependencies
 * Checks all required dependencies
 *
 * This route is public (no auth) for first-run setup.
 */
export async function GET() {
  try {
    // Detect package manager first
    let packageManager: string | undefined;
    const os = platform();

    if (os === "darwin") {
      if (await commandExists("brew")) {
        packageManager = "brew";
      }
    } else if (os === "linux") {
      const managers = ["apt", "dnf", "yum", "pacman", "zypper", "apk"];
      for (const manager of managers) {
        if (await commandExists(manager)) {
          packageManager = manager;
          break;
        }
      }
    } else if (os === "win32") {
      if (await commandExists("winget")) {
        packageManager = "winget";
      } else if (await commandExists("choco")) {
        packageManager = "choco";
      }
    }

    // Check each dependency
    const results: DependencyCheck[] = await Promise.all(
      DEPENDENCIES.map(async (dep) => {
        const check: DependencyCheck = {
          ...dep,
          installed: false,
          status: "checking",
        };

        try {
          const exists = await commandExists(dep.name);
          if (exists) {
            check.installed = true;
            check.status = "installed";
            check.version = await getVersion(dep.name);
          } else {
            check.status = "missing";
            check.installCommand = getInstallCommand(dep.name, packageManager);
          }
        } catch (error) {
          check.status = "error";
          check.error = error instanceof Error ? error.message : String(error);
        }

        return check;
      })
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error("Dependency check failed:", error);
    return NextResponse.json(
      { error: "Failed to check dependencies" },
      { status: 500 }
    );
  }
}
