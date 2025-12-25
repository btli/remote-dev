import { NextResponse } from "next/server";
import { platform, arch, homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * GET /api/setup/platform
 * Detects platform information (OS, architecture, package manager, WSL)
 *
 * This route is public (no auth) for first-run setup.
 */
export async function GET() {
  try {
    const os = platform();
    const archName = arch();
    const home = homedir();
    const shell = process.env.SHELL || (os === "win32" ? "cmd.exe" : "/bin/sh");

    let isWSL = false;
    const wslDistros: Array<{
      name: string;
      version: number;
      isDefault: boolean;
      state: string;
    }> = [];
    let packageManager: string | undefined;

    if (os === "win32") {
      // Check for WSL
      try {
        const { stdout } = await execFileAsync("wsl.exe", ["--list", "--verbose"], {
          timeout: 10000,
          windowsHide: true,
        });

        // Parse WSL output
        const cleanOutput = stdout.replace(/\0/g, "").replace(/\r/g, "").trim();
        const lines = cleanOutput.split("\n").slice(1);

        for (const line of lines) {
          if (!line.trim()) continue;

          const isDefault = line.startsWith("*");
          const cleanLine = line.replace(/^\*\s*/, "").trim();
          const parts = cleanLine.split(/\s{2,}/);

          if (parts.length >= 3) {
            const name = parts[0].trim();
            const state = parts[1].trim();
            const version = parseInt(parts[2].trim()) || 2;

            if (name && name !== "NAME") {
              wslDistros.push({
                name,
                version,
                isDefault,
                state: ["Running", "Stopped", "Installing"].includes(state)
                  ? state
                  : "Unknown",
              });
            }
          }
        }

        isWSL = wslDistros.length > 0;
      } catch {
        // WSL not installed
      }

      // Check for Windows package managers
      try {
        await execFileAsync("winget", ["--version"], { timeout: 5000 });
        packageManager = "winget";
      } catch {
        try {
          await execFileAsync("choco", ["--version"], { timeout: 5000 });
          packageManager = "choco";
        } catch {
          // No package manager
        }
      }
    } else if (os === "darwin") {
      // Check for Homebrew
      try {
        await execFileAsync("brew", ["--version"], { timeout: 5000 });
        packageManager = "brew";
      } catch {
        // Homebrew not installed
      }
    } else if (os === "linux") {
      // Check for Linux package managers
      const managers = ["apt", "dnf", "yum", "pacman", "zypper", "apk"];
      for (const manager of managers) {
        try {
          await execFileAsync("which", [manager], { timeout: 5000 });
          packageManager = manager;
          break;
        } catch {
          // Continue to next
        }
      }
    }

    return NextResponse.json({
      os,
      arch: archName,
      isWSL,
      wslDistros: isWSL ? wslDistros : undefined,
      packageManager,
      shell,
      homeDirectory: home,
    });
  } catch (error) {
    console.error("Platform detection failed:", error);
    return NextResponse.json(
      { error: "Failed to detect platform" },
      { status: 500 }
    );
  }
}
