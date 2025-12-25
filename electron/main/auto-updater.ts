/**
 * Auto-Updater
 *
 * Handles automatic application updates using electron-updater.
 */

import { autoUpdater, UpdateInfo } from "electron-updater";
import { dialog, BrowserWindow } from "electron";
import Config from "./config";

let updateDownloaded = false;
let mainWindow: BrowserWindow | null = null;

export function initAutoUpdater(window?: BrowserWindow): void {
  mainWindow = window ?? null;

  if (!Config.autoUpdate.enabled) {
    console.log("[AutoUpdater] Auto-update is disabled");
    return;
  }

  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = Config.autoUpdate.allowPrerelease;

  // Set up event handlers
  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    console.log(`[AutoUpdater] Update available: ${info.version}`);

    // Notify renderer if window exists
    if (mainWindow) {
      mainWindow.webContents.send("update-available", {
        version: info.version,
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[AutoUpdater] No updates available");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(
      `[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`
    );
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    console.log(`[AutoUpdater] Update downloaded: ${info.version}`);
    updateDownloaded = true;

    // Notify renderer if window exists
    if (mainWindow) {
      mainWindow.webContents.send("update-downloaded");
    }

    // Show dialog to prompt user
    showUpdateDialog(info);
  });

  autoUpdater.on("error", (error) => {
    console.error("[AutoUpdater] Error:", error.message);
  });

  // Check for updates on startup if enabled
  if (Config.autoUpdate.checkOnStartup && Config.isPackaged) {
    // Wait a bit before checking to let the app fully initialize
    setTimeout(() => {
      checkForUpdates();
    }, 5000);
  }
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!Config.isPackaged) {
    console.log("[AutoUpdater] Skipping update check in development mode");
    return null;
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo ?? null;
  } catch (error) {
    console.error("[AutoUpdater] Failed to check for updates:", error);
    return null;
  }
}

export function quitAndInstall(): void {
  if (updateDownloaded) {
    autoUpdater.quitAndInstall(false, true);
  }
}

export function isUpdateDownloaded(): boolean {
  return updateDownloaded;
}

async function showUpdateDialog(info: UpdateInfo): Promise<void> {
  const response = await dialog.showMessageBox({
    type: "info",
    title: "Update Ready",
    message: `Version ${info.version} has been downloaded.`,
    detail: "Would you like to restart the application to install the update?",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response.response === 0) {
    quitAndInstall();
  }
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export default {
  init: initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  isUpdateDownloaded,
  setMainWindow,
};
