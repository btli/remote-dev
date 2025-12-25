/**
 * System Tray Manager
 *
 * Manages the system tray icon and context menu.
 */

import {
  Tray,
  Menu,
  MenuItem,
  nativeImage,
  shell,
  BrowserWindow,
  app,
} from "electron";
import { join } from "path";
import { existsSync } from "fs";
import Config from "./config";
import ProcessManager, { ServerStatus } from "./process-manager";

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

function getTrayIconPath(): string {
  // In development: electron/resources/tray
  // In production: resources/electron/resources/tray
  const devPath = join(__dirname, "../../electron/resources/tray");
  const prodPath = join(Config.resourcesPath, "electron/resources/tray");
  return existsSync(devPath) ? devPath : prodPath;
}

function getTrayIcon(active: boolean = false): string {
  const basePath = getTrayIconPath();
  const prefix = active ? "tray-active" : "tray";

  // Use template images on macOS for dark/light mode support
  if (Config.isMac) {
    const templatePath = join(basePath, `${prefix}Template.png`);
    if (existsSync(templatePath)) {
      return templatePath;
    }
  }

  const iconPath = join(basePath, `${prefix}.png`);
  if (existsSync(iconPath)) {
    return iconPath;
  }

  // Fallback to inactive icon if active not found
  if (active) {
    return getTrayIcon(false);
  }

  throw new Error(`No tray icon found in ${basePath}`);
}

function buildContextMenu(status: ServerStatus): Menu {
  const mode = ProcessManager.getMode();
  const ports = Config.getPortConfig(mode);
  const allRunning = status.nextjs.running && status.terminal.running;

  const template: (MenuItem | Electron.MenuItemConstructorOptions)[] = [
    {
      label: "Remote Dev",
      enabled: false,
    },
    { type: "separator" },
    {
      label: allRunning ? "Open in Browser" : "Open in Browser (servers stopped)",
      enabled: allRunning,
      click: () => {
        shell.openExternal(`http://localhost:${ports.nextjs}`);
      },
    },
    {
      label: "Show Window",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "Server Status",
      submenu: [
        {
          label: `Next.js: ${status.nextjs.running ? "Running" : "Stopped"}${status.nextjs.pid ? ` (PID: ${status.nextjs.pid})` : ""}`,
          enabled: false,
        },
        {
          label: `Terminal: ${status.terminal.running ? "Running" : "Stopped"}${status.terminal.pid ? ` (PID: ${status.terminal.pid})` : ""}`,
          enabled: false,
        },
        { type: "separator" },
        {
          label: `Mode: ${mode.toUpperCase()}`,
          enabled: false,
        },
        {
          label: `Ports: ${ports.nextjs}, ${ports.terminal}`,
          enabled: false,
        },
      ],
    },
    { type: "separator" },
    {
      label: allRunning ? "Restart Servers" : "Start Servers",
      click: async () => {
        try {
          if (allRunning) {
            await ProcessManager.restart();
          } else {
            await ProcessManager.start(mode);
          }
        } catch (error) {
          console.error("Failed to start/restart servers:", error);
        }
      },
    },
    {
      label: "Stop Servers",
      enabled: allRunning,
      click: async () => {
        try {
          await ProcessManager.stop();
        } catch (error) {
          console.error("Failed to stop servers:", error);
        }
      },
    },
    { type: "separator" },
    {
      label: "Switch Mode",
      submenu: [
        {
          label: "Development (3000/3001)",
          type: "radio",
          checked: mode === "dev",
          click: async () => {
            if (mode !== "dev") {
              await ProcessManager.restart("dev");
            }
          },
        },
        {
          label: "Production (6001/6002)",
          type: "radio",
          checked: mode === "prod",
          click: async () => {
            if (mode !== "prod") {
              await ProcessManager.restart("prod");
            }
          },
        },
      ],
    },
    { type: "separator" },
    {
      label: "Quit",
      accelerator: Config.isMac ? "Cmd+Q" : "Ctrl+Q",
      click: () => {
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createMainWindow(): void {
  const status = ProcessManager.getStatus();
  const ports = Config.getPortConfig(ProcessManager.getMode());

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Remote Dev",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  // Load the web UI
  if (status.nextjs.running) {
    mainWindow.loadURL(`http://localhost:${ports.nextjs}`);
  } else {
    // Show a loading page if servers aren't ready
    mainWindow.loadURL(`data:text/html,
      <html>
        <head>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #1a1b26;
              color: #a9b1d6;
            }
            .loading {
              text-align: center;
            }
            .spinner {
              width: 40px;
              height: 40px;
              border: 3px solid #414868;
              border-top-color: #7aa2f7;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto 16px;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="loading">
            <div class="spinner"></div>
            <p>Starting servers...</p>
          </div>
        </body>
      </html>
    `);

    // Reload when servers are ready
    ProcessManager.once("status-change", (newStatus: ServerStatus) => {
      if (newStatus.nextjs.running && mainWindow) {
        mainWindow.loadURL(`http://localhost:${ports.nextjs}`);
      }
    });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

export function createTray(): Tray {
  try {
    const iconPath = getTrayIcon();
    const icon = nativeImage.createFromPath(iconPath);

    // Make template image on macOS
    if (Config.isMac) {
      icon.setTemplateImage(true);
    }

    tray = new Tray(icon);
    tray.setToolTip("Remote Dev");

    // Update menu with initial status
    updateTrayMenu();

    // Listen for status changes
    ProcessManager.on("status-change", updateTrayMenu);

    // Click behavior
    tray.on("click", () => {
      if (Config.isMac) {
        // On macOS, show context menu on click
        if (tray) {
          tray.popUpContextMenu();
        }
      } else {
        // On Windows/Linux, show/hide window
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      }
    });

    // Right-click always shows menu
    tray.on("right-click", () => {
      if (tray) {
        tray.popUpContextMenu();
      }
    });

    return tray;
  } catch (error) {
    console.error("Failed to create tray:", error);
    throw error;
  }
}

export function updateTrayMenu(): void {
  if (!tray) return;
  const status = ProcessManager.getStatus();
  const allRunning = status.nextjs.running && status.terminal.running;

  // Update tray icon based on server status
  const iconPath = getTrayIcon(allRunning);
  const icon = nativeImage.createFromPath(iconPath);
  if (Config.isMac) {
    icon.setTemplateImage(true);
  }
  tray.setImage(icon);

  // Update tooltip with status
  tray.setToolTip(allRunning ? "Remote Dev (Running)" : "Remote Dev");

  // Update context menu
  const menu = buildContextMenu(status);
  tray.setContextMenu(menu);
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

export { createMainWindow };
