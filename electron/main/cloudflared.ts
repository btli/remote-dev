/**
 * Cloudflared Service
 *
 * Manages cloudflared detection, bundled binary, and tunnel operations.
 * Supports both system-installed and bundled cloudflared binaries.
 */

import { execFile, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  chmodSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import { platform, arch } from "os";
import { app } from "electron";
import * as https from "https";
import * as http from "http";

const execFileAsync = promisify(execFile);

export type CloudflaredMode = "system" | "bundled" | "none";

export interface CloudflaredInfo {
  mode: CloudflaredMode;
  version: string | null;
  path: string | null;
  isRunning: boolean;
}

export interface TunnelInfo {
  name: string;
  id: string;
  url: string;
  status: "running" | "stopped" | "error";
  createdAt: Date;
}

interface CloudflaredEvents {
  "tunnel-started": (info: TunnelInfo) => void;
  "tunnel-stopped": (name: string) => void;
  "tunnel-error": (error: Error) => void;
  "download-progress": (percent: number) => void;
  "download-complete": () => void;
}

// Cloudflare GitHub release API
const CLOUDFLARED_RELEASES_URL =
  "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";

// Platform-specific binary names
function getBinaryName(): string {
  const os = platform();
  const cpuArch = arch();

  if (os === "darwin") {
    return cpuArch === "arm64"
      ? "cloudflared-darwin-arm64"
      : "cloudflared-darwin-amd64";
  } else if (os === "linux") {
    return cpuArch === "arm64"
      ? "cloudflared-linux-arm64"
      : "cloudflared-linux-amd64";
  } else if (os === "win32") {
    return cpuArch === "x64"
      ? "cloudflared-windows-amd64.exe"
      : "cloudflared-windows-386.exe";
  }

  throw new Error(`Unsupported platform: ${os} ${cpuArch}`);
}

class CloudflaredServiceImpl extends EventEmitter {
  private bundledPath: string;
  private activeTunnels: Map<string, ChildProcess> = new Map();
  private tunnelInfo: Map<string, TunnelInfo> = new Map();

  constructor() {
    super();

    // Store bundled binary in app data directory
    const userDataPath = app.getPath("userData");
    const binDir = join(userDataPath, "bin");

    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }

    const binaryName =
      platform() === "win32" ? "cloudflared.exe" : "cloudflared";
    this.bundledPath = join(binDir, binaryName);
  }

  /**
   * Detect cloudflared installation
   */
  async detect(): Promise<CloudflaredInfo> {
    // Check for bundled binary first
    if (existsSync(this.bundledPath)) {
      try {
        const version = await this.getVersion(this.bundledPath);
        return {
          mode: "bundled",
          version,
          path: this.bundledPath,
          isRunning: this.activeTunnels.size > 0,
        };
      } catch {
        // Bundled binary is broken
      }
    }

    // Check for system installation
    try {
      const systemPath = await this.findSystemBinary();
      if (systemPath) {
        const version = await this.getVersion(systemPath);
        return {
          mode: "system",
          version,
          path: systemPath,
          isRunning: this.activeTunnels.size > 0,
        };
      }
    } catch {
      // System binary not found or broken
    }

    return {
      mode: "none",
      version: null,
      path: null,
      isRunning: false,
    };
  }

  /**
   * Find system-installed cloudflared
   */
  private async findSystemBinary(): Promise<string | null> {
    const os = platform();
    const command = os === "win32" ? "where" : "which";

    try {
      const { stdout } = await execFileAsync(command, ["cloudflared"], {
        timeout: 5000,
      });
      return stdout.trim().split("\n")[0];
    } catch {
      return null;
    }
  }

  /**
   * Get cloudflared version
   */
  private async getVersion(binaryPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(binaryPath, ["--version"], {
        timeout: 5000,
      });
      const match = stdout.match(/cloudflared version ([\d.]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Download and install bundled cloudflared
   */
  async downloadBundled(): Promise<void> {
    // Get latest release info
    const release = await this.getLatestRelease();
    const binaryName = getBinaryName();
    const asset = release.assets.find((a: { name: string }) =>
      a.name === binaryName
    );

    if (!asset) {
      throw new Error(
        `No cloudflared binary found for ${platform()} ${arch()}`
      );
    }

    // Download the binary
    const downloadUrl = asset.browser_download_url;
    await this.downloadFile(downloadUrl, this.bundledPath);

    // Make executable on Unix
    if (platform() !== "win32") {
      chmodSync(this.bundledPath, 0o755);
    }

    this.emit("download-complete");
  }

  /**
   * Get latest release from GitHub
   */
  private async getLatestRelease(): Promise<{
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  }> {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          "User-Agent": "Remote-Dev-Electron",
          Accept: "application/vnd.github.v3+json",
        },
      };

      https
        .get(CLOUDFLARED_RELEASES_URL, options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
  }

  /**
   * Download a file with progress
   */
  private async downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Ensure directory exists
      const dir = dirname(dest);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Remove existing file
      if (existsSync(dest)) {
        unlinkSync(dest);
      }

      const file = createWriteStream(dest);
      const protocol = url.startsWith("https") ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          unlinkSync(dest);
          this.downloadFile(response.headers.location, dest)
            .then(resolve)
            .catch(reject);
          return;
        }

        const totalSize = parseInt(
          response.headers["content-length"] || "0",
          10
        );
        let downloadedSize = 0;

        response.on("data", (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            this.emit("download-progress", percent);
          }
        });

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve();
        });
      });

      request.on("error", (err) => {
        file.close();
        if (existsSync(dest)) {
          unlinkSync(dest);
        }
        reject(err);
      });

      file.on("error", (err) => {
        file.close();
        if (existsSync(dest)) {
          unlinkSync(dest);
        }
        reject(err);
      });
    });
  }

  /**
   * Start a quick tunnel (no Cloudflare account needed)
   */
  async startQuickTunnel(
    port: number,
    name: string = "remote-dev"
  ): Promise<TunnelInfo> {
    const info = await this.detect();
    if (!info.path) {
      throw new Error("cloudflared is not installed");
    }

    // Stop existing tunnel with same name
    if (this.activeTunnels.has(name)) {
      await this.stopTunnel(name);
    }

    return new Promise((resolve, reject) => {
      const args = ["tunnel", "--url", `http://localhost:${port}`];

      const proc = spawn(info.path!, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.activeTunnels.set(name, proc);

      let tunnelUrl: string | null = null;
      let startupBuffer = "";

      const handleOutput = (data: Buffer) => {
        const output = data.toString();
        startupBuffer += output;

        // Look for the tunnel URL in the output
        const urlMatch = output.match(
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
        );
        if (urlMatch && !tunnelUrl) {
          tunnelUrl = urlMatch[0];

          const tunnelInfo: TunnelInfo = {
            name,
            id: name,
            url: tunnelUrl,
            status: "running",
            createdAt: new Date(),
          };

          this.tunnelInfo.set(name, tunnelInfo);
          this.emit("tunnel-started", tunnelInfo);
          resolve(tunnelInfo);
        }
      };

      proc.stdout?.on("data", handleOutput);
      proc.stderr?.on("data", handleOutput);

      proc.on("error", (err) => {
        this.activeTunnels.delete(name);
        this.emit("tunnel-error", err);
        reject(err);
      });

      proc.on("exit", (code) => {
        this.activeTunnels.delete(name);
        const info = this.tunnelInfo.get(name);
        if (info) {
          info.status = "stopped";
        }
        this.emit("tunnel-stopped", name);

        // If we never got a URL, this is a startup error
        if (!tunnelUrl) {
          reject(
            new Error(
              `cloudflared exited with code ${code}. Output: ${startupBuffer}`
            )
          );
        }
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!tunnelUrl) {
          proc.kill();
          reject(new Error("Tunnel startup timed out"));
        }
      }, 30000);
    });
  }

  /**
   * Stop a tunnel
   */
  async stopTunnel(name: string): Promise<void> {
    const proc = this.activeTunnels.get(name);
    if (proc) {
      proc.kill("SIGTERM");

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve();
        }, 5000);

        proc.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.activeTunnels.delete(name);
      this.emit("tunnel-stopped", name);
    }
  }

  /**
   * Stop all tunnels
   */
  async stopAllTunnels(): Promise<void> {
    const names = Array.from(this.activeTunnels.keys());
    await Promise.all(names.map((name) => this.stopTunnel(name)));
  }

  /**
   * Get active tunnel info
   */
  getActiveTunnels(): TunnelInfo[] {
    return Array.from(this.tunnelInfo.values()).filter(
      (t) => t.status === "running"
    );
  }

  /**
   * Check if cloudflared update is available
   */
  async checkForUpdate(): Promise<{ available: boolean; version?: string }> {
    const info = await this.detect();
    if (info.mode === "none") {
      return { available: false };
    }

    try {
      const release = await this.getLatestRelease();
      const latestVersion = release.tag_name.replace(/^v/, "");

      if (info.version && this.compareVersions(latestVersion, info.version) > 0) {
        return { available: true, version: latestVersion };
      }
    } catch {
      // Failed to check for updates
    }

    return { available: false };
  }

  /**
   * Compare semantic versions
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) return numA - numB;
    }

    return 0;
  }

  /**
   * Update bundled cloudflared
   */
  async updateBundled(): Promise<void> {
    await this.stopAllTunnels();
    await this.downloadBundled();
  }

  // Type-safe event emitter methods
  on<E extends keyof CloudflaredEvents>(
    event: E,
    listener: CloudflaredEvents[E]
  ): this {
    return super.on(event, listener);
  }

  emit<E extends keyof CloudflaredEvents>(
    event: E,
    ...args: Parameters<CloudflaredEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Export singleton instance
export const CloudflaredService = new CloudflaredServiceImpl();
