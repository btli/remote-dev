/**
 * Electron Configuration
 *
 * Central configuration for paths, ports, and platform detection.
 *
 * Data Directory:
 * All application data is stored in ~/.remote-dev by default.
 * This can be overridden with RDV_DATA_DIR environment variable.
 */

import { app } from "electron";
import { join } from "path";
import { platform, arch, homedir } from "os";

export type Platform = "darwin" | "linux" | "win32";
export type Mode = "dev" | "prod";

export interface PortConfig {
  nextjs: number;
  terminal: number;
}

export const Config = {
  // App info
  appName: "Remote Dev",
  appId: "dev.remote.app",

  // Environment detection
  isDev: !app.isPackaged,
  isPackaged: app.isPackaged,

  // Platform detection
  platform: platform() as Platform,
  arch: arch(),
  isMac: platform() === "darwin",
  isLinux: platform() === "linux",
  isWindows: platform() === "win32",

  // Paths
  get resourcesPath(): string {
    return app.isPackaged
      ? process.resourcesPath
      : join(__dirname, "../..");
  },

  get appPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "app")
      : join(__dirname, "../..");
  },

  /**
   * Get the data directory - centralized at ~/.remote-dev
   * Can be overridden with RDV_DATA_DIR environment variable
   */
  get dataDir(): string {
    return process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
  },

  get userDataPath(): string {
    // Use centralized data directory instead of platform-specific app data
    return this.dataDir;
  },

  get logsPath(): string {
    return join(this.dataDir, "logs");
  },

  get pidDir(): string {
    return join(this.dataDir, "server");
  },

  get dbPath(): string {
    return join(this.dataDir, "sqlite.db");
  },

  // Port configuration
  ports: {
    dev: {
      nextjs: 3000,
      terminal: 3001,
    },
    prod: {
      nextjs: 6001,
      terminal: 6002,
    },
  } as Record<Mode, PortConfig>,

  getPortConfig(mode: Mode): PortConfig {
    return this.ports[mode];
  },

  // Server commands
  getNextJsCommand(mode: Mode): string[] {
    if (mode === "dev") {
      return ["bun", "run", "next", "dev", "--turbopack"];
    }
    // Production: use standalone server if packaged
    if (app.isPackaged) {
      return ["node", join(this.appPath, ".next/standalone/server.js")];
    }
    return ["bun", "run", "next", "start", "-p", String(this.ports.prod.nextjs)];
  },

  getTerminalCommand(): string[] {
    if (app.isPackaged) {
      return ["node", join(this.appPath, "dist-terminal/index.js")];
    }
    return ["bun", "run", "tsx", "src/server/index.ts"];
  },

  // Tray icons
  get trayIconPath(): string {
    const iconName = this.isMac ? "trayTemplate.png" : "tray.png";
    return join(this.resourcesPath, "electron/resources/tray", iconName);
  },

  get trayActiveIconPath(): string {
    const iconName = this.isMac ? "tray-activeTemplate.png" : "tray-active.png";
    return join(this.resourcesPath, "electron/resources/tray", iconName);
  },

  // Auto-update
  autoUpdate: {
    enabled: true,
    checkOnStartup: true,
    allowPrerelease: false,
  },
} as const;

export default Config;
