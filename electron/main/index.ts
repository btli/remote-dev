/**
 * Electron Main Process Entry Point
 *
 * Initializes the application, creates the system tray, and manages
 * the lifecycle of the Next.js and Terminal servers.
 */

import { app, ipcMain, shell, Menu, dialog } from "electron";
import { platform, arch, homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import Config from "./config";
import ProcessManager, { ServerStatus } from "./process-manager";
import { createTray, destroyTray, showMainWindow, getMainWindow } from "./tray";
import AutoUpdater from "./auto-updater";
import { CloudflaredService, CloudflaredInfo, TunnelInfo } from "./cloudflared";

const execFileAsync = promisify(execFile);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus our window
    showMainWindow();
  });
}

// App lifecycle
async function initialize(): Promise<void> {
  console.log("[Main] Initializing Remote Dev...");
  console.log(`[Main] Platform: ${Config.platform}`);
  console.log(`[Main] Arch: ${Config.arch}`);
  console.log(`[Main] Packaged: ${Config.isPackaged}`);
  console.log(`[Main] User Data: ${Config.userDataPath}`);

  // Create system tray
  createTray();

  // Start servers in development mode by default
  const mode = Config.isDev ? "dev" : "prod";
  try {
    await ProcessManager.start(mode);
  } catch (error) {
    console.error("[Main] Failed to start servers:", error);
    // Don't quit - allow user to retry via tray menu
  }

  // Initialize auto-updater
  AutoUpdater.init(getMainWindow() ?? undefined);

  // Set up IPC handlers
  setupIpcHandlers();

  // Forward server events to renderer
  setupEventForwarding();
}

function setupIpcHandlers(): void {
  // Server management
  ipcMain.handle("get-server-status", () => {
    return ProcessManager.getStatus();
  });

  ipcMain.handle("start-servers", async (_event, mode?: "dev" | "prod") => {
    await ProcessManager.start(mode);
  });

  ipcMain.handle("stop-servers", async () => {
    await ProcessManager.stop();
  });

  ipcMain.handle("restart-servers", async (_event, mode?: "dev" | "prod") => {
    await ProcessManager.restart(mode);
  });

  // Navigation
  ipcMain.handle("open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("open-in-browser", async () => {
    const status = ProcessManager.getStatus();
    if (status.nextjs.running) {
      await shell.openExternal(`http://localhost:${status.nextjs.port}`);
    }
  });

  // Window management
  ipcMain.on("show-window", () => {
    showMainWindow();
  });

  ipcMain.on("hide-window", () => {
    const window = getMainWindow();
    if (window) {
      window.hide();
    }
  });

  ipcMain.on("close-window", () => {
    const window = getMainWindow();
    if (window) {
      window.close();
    }
  });

  // App info
  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("is-packaged", () => {
    return app.isPackaged;
  });

  // Updates
  ipcMain.handle("check-for-updates", async () => {
    await AutoUpdater.checkForUpdates();
  });

  ipcMain.on("install-update", () => {
    AutoUpdater.quitAndInstall();
  });

  // Setup wizard handlers
  ipcMain.handle("detect-platform", async () => {
    const os = platform();
    const cpuArch = arch();
    const home = homedir();
    const shell = process.env.SHELL || (os === "win32" ? "cmd.exe" : "/bin/sh");

    let isWSL = false;
    let wslDistros: Array<{
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
              wslDistros.push({ name, version, isDefault, state });
            }
          }
        }
        isWSL = wslDistros.length > 0;
      } catch {
        // WSL not installed
      }

      // Check for package managers
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
      try {
        await execFileAsync("brew", ["--version"], { timeout: 5000 });
        packageManager = "brew";
      } catch {
        // Homebrew not installed
      }
    } else if (os === "linux") {
      const managers = ["apt", "dnf", "yum", "pacman", "zypper", "apk"];
      for (const manager of managers) {
        try {
          await execFileAsync("which", [manager], { timeout: 5000 });
          packageManager = manager;
          break;
        } catch {
          // Continue
        }
      }
    }

    return {
      os,
      arch: cpuArch,
      isWSL,
      wslDistros: isWSL ? wslDistros : undefined,
      packageManager,
      shell,
      homeDirectory: home,
    };
  });

  ipcMain.handle("check-dependencies", async () => {
    const deps = [
      { name: "tmux", displayName: "tmux", required: true, downloadUrl: "https://github.com/tmux/tmux" },
      { name: "git", displayName: "Git", required: false, downloadUrl: "https://git-scm.com/downloads" },
      { name: "bun", displayName: "Bun", required: true, downloadUrl: "https://bun.sh" },
      { name: "cloudflared", displayName: "cloudflared", required: false, downloadUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" },
    ];

    const os = platform();
    type DependencyStatus = "checking" | "installed" | "missing" | "installing" | "error";

    const results = await Promise.all(
      deps.map(async (dep) => {
        const result: {
          name: string;
          displayName: string;
          required: boolean;
          downloadUrl: string;
          installed: boolean;
          version: string | undefined;
          status: DependencyStatus;
          installCommand: string | undefined;
        } = {
          ...dep,
          installed: false,
          version: undefined,
          status: "checking",
          installCommand: undefined,
        };

        try {
          const cmd = os === "win32" ? "where" : "which";
          await execFileAsync(cmd, [dep.name], { timeout: 5000 });
          result.installed = true;
          result.status = "installed";

          try {
            const { stdout } = await execFileAsync(dep.name, ["--version"], { timeout: 5000 });
            const match = stdout.match(/(\d+\.\d+\.?\d*)/);
            result.version = match ? match[1] : undefined;
          } catch {
            // Version check failed
          }
        } catch {
          result.status = "missing";
          // Add install command based on platform
          if (dep.name === "bun") {
            result.installCommand = "curl -fsSL https://bun.sh/install | bash";
          }
        }

        return result;
      })
    );

    return results;
  });

  ipcMain.handle("install-dependency", async (_event, name: string) => {
    // For security, we don't auto-install. Return instructions instead.
    return {
      success: false,
      error: `Please install ${name} manually using the provided command or download link.`,
    };
  });

  ipcMain.handle("select-directory", async () => {
    const window = getMainWindow();
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory"],
      title: "Select Working Directory",
    };

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("save-setup-config", async (_event, config) => {
    // In a real implementation, this would save to a config file or database
    console.log("[Main] Saving setup config:", config);
    // For now, just log it - the web app handles actual persistence
  });

  ipcMain.handle("get-setup-config", async () => {
    // Check if setup is complete
    return { isComplete: false };
  });

  // Cloudflared handlers
  ipcMain.handle("cloudflared-detect", async (): Promise<CloudflaredInfo> => {
    return CloudflaredService.detect();
  });

  ipcMain.handle("cloudflared-download", async () => {
    await CloudflaredService.downloadBundled();
  });

  ipcMain.handle("cloudflared-start-tunnel", async (_event, port: number, name?: string): Promise<TunnelInfo> => {
    return CloudflaredService.startQuickTunnel(port, name);
  });

  ipcMain.handle("cloudflared-stop-tunnel", async (_event, name: string) => {
    await CloudflaredService.stopTunnel(name);
  });

  ipcMain.handle("cloudflared-get-tunnels", () => {
    return CloudflaredService.getActiveTunnels();
  });

  ipcMain.handle("cloudflared-check-update", async () => {
    return CloudflaredService.checkForUpdate();
  });

  ipcMain.handle("cloudflared-update", async () => {
    await CloudflaredService.updateBundled();
  });
}

function setupEventForwarding(): void {
  // Forward status changes to renderer
  ProcessManager.on("status-change", (status: ServerStatus) => {
    const window = getMainWindow();
    if (window) {
      window.webContents.send("status-change", status);
    }
  });

  // Forward server logs to renderer
  ProcessManager.on("nextjs-stdout", (data: string) => {
    const window = getMainWindow();
    if (window) {
      window.webContents.send("server-log", {
        source: "nextjs",
        type: "stdout",
        message: data,
      });
    }
  });

  ProcessManager.on("nextjs-stderr", (data: string) => {
    const window = getMainWindow();
    if (window) {
      window.webContents.send("server-log", {
        source: "nextjs",
        type: "stderr",
        message: data,
      });
    }
  });

  ProcessManager.on("terminal-stdout", (data: string) => {
    const window = getMainWindow();
    if (window) {
      window.webContents.send("server-log", {
        source: "terminal",
        type: "stdout",
        message: data,
      });
    }
  });

  ProcessManager.on("terminal-stderr", (data: string) => {
    const window = getMainWindow();
    if (window) {
      window.webContents.send("server-log", {
        source: "terminal",
        type: "stderr",
        message: data,
      });
    }
  });
}

function createMacOSAppMenu(): void {
  if (!Config.isMac) return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { type: "separator" },
        { role: "window" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: async () => {
            await shell.openExternal("https://github.com/btli/remote-dev");
          },
        },
        {
          label: "Report Issue",
          click: async () => {
            await shell.openExternal(
              "https://github.com/btli/remote-dev/issues"
            );
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App event handlers
app.on("ready", async () => {
  createMacOSAppMenu();
  await initialize();
});

app.on("window-all-closed", () => {
  // On macOS, keep the app running in the tray
  // On other platforms, also keep running in tray
  // User must explicitly quit via tray menu
});

app.on("activate", () => {
  // On macOS, re-create window when dock icon is clicked
  showMainWindow();
});

app.on("before-quit", async () => {
  console.log("[Main] Application quitting...");
  await ProcessManager.stop();
  destroyTray();
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("[Main] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled rejection:", reason);
});
