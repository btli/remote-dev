/**
 * Preload Script
 *
 * Provides a secure bridge between the renderer process and main process.
 * Uses contextBridge to expose safe APIs to the web content.
 */

import { contextBridge, ipcRenderer } from "electron";

export interface ServerStatus {
  nextjs: {
    running: boolean;
    port: number;
    pid?: number;
  };
  terminal: {
    running: boolean;
    port: number;
    pid?: number;
  };
}

export interface PlatformInfo {
  os: "darwin" | "linux" | "win32";
  arch: "x64" | "arm64" | "arm";
  isWSL: boolean;
  wslDistros?: Array<{
    name: string;
    version: number;
    isDefault: boolean;
    state: string;
  }>;
  packageManager?: string;
  shell: string;
  homeDirectory: string;
}

export interface DependencyStatus {
  name: string;
  displayName: string;
  required: boolean;
  installed: boolean;
  version?: string;
  status: "checking" | "installed" | "missing" | "installing" | "error";
  error?: string;
  installCommand?: string;
  downloadUrl?: string;
}

export interface SetupConfiguration {
  workingDirectory: string;
  nextPort: number;
  terminalPort: number;
  wslDistribution?: string;
  autoStart: boolean;
  checkForUpdates: boolean;
}

export interface ElectronAPI {
  // Server management
  getServerStatus: () => Promise<ServerStatus>;
  startServers: (mode?: "dev" | "prod") => Promise<void>;
  stopServers: () => Promise<void>;
  restartServers: (mode?: "dev" | "prod") => Promise<void>;

  // Navigation
  openExternal: (url: string) => Promise<void>;
  openInBrowser: () => Promise<void>;

  // Window management
  showWindow: () => void;
  hideWindow: () => void;
  closeWindow: () => void;

  // Events
  onStatusChange: (callback: (status: ServerStatus) => void) => () => void;
  onServerLog: (
    callback: (data: { source: string; type: string; message: string }) => void
  ) => () => void;

  // App info
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;
  isPackaged: () => Promise<boolean>;

  // Updates
  checkForUpdates: () => Promise<void>;
  onUpdateAvailable: (callback: (info: { version: string }) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  installUpdate: () => void;

  // Setup wizard
  detectPlatform: () => Promise<PlatformInfo>;
  checkDependencies: () => Promise<DependencyStatus[]>;
  installDependency: (name: string) => Promise<{ success: boolean; error?: string }>;
  selectDirectory: () => Promise<string | null>;
  saveSetupConfig: (config: SetupConfiguration) => Promise<void>;
  getSetupConfig: () => Promise<{ isComplete: boolean; config?: SetupConfiguration }>;

  // Cloudflared
  cloudflaredDetect: () => Promise<CloudflaredInfo>;
  cloudflaredDownload: () => Promise<void>;
  cloudflaredStartTunnel: (port: number, name?: string) => Promise<TunnelInfo>;
  cloudflaredStopTunnel: (name: string) => Promise<void>;
  cloudflaredGetTunnels: () => Promise<TunnelInfo[]>;
  cloudflaredCheckUpdate: () => Promise<{ available: boolean; version?: string }>;
  cloudflaredUpdate: () => Promise<void>;
  onCloudflaredProgress: (callback: (percent: number) => void) => () => void;
  onTunnelStarted: (callback: (info: TunnelInfo) => void) => () => void;
  onTunnelStopped: (callback: (name: string) => void) => () => void;
}

export interface CloudflaredInfo {
  mode: "system" | "bundled" | "none";
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

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  // Server management
  getServerStatus: () => ipcRenderer.invoke("get-server-status"),
  startServers: (mode) => ipcRenderer.invoke("start-servers", mode),
  stopServers: () => ipcRenderer.invoke("stop-servers"),
  restartServers: (mode) => ipcRenderer.invoke("restart-servers", mode),

  // Navigation
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openInBrowser: () => ipcRenderer.invoke("open-in-browser"),

  // Window management
  showWindow: () => ipcRenderer.send("show-window"),
  hideWindow: () => ipcRenderer.send("hide-window"),
  closeWindow: () => ipcRenderer.send("close-window"),

  // Events
  onStatusChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ServerStatus) => {
      callback(status);
    };
    ipcRenderer.on("status-change", handler);
    return () => {
      ipcRenderer.removeListener("status-change", handler);
    };
  },

  onServerLog: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { source: string; type: string; message: string }
    ) => {
      callback(data);
    };
    ipcRenderer.on("server-log", handler);
    return () => {
      ipcRenderer.removeListener("server-log", handler);
    };
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => process.platform,
  isPackaged: () => ipcRenderer.invoke("is-packaged"),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  onUpdateAvailable: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { version: string }
    ) => {
      callback(info);
    };
    ipcRenderer.on("update-available", handler);
    return () => {
      ipcRenderer.removeListener("update-available", handler);
    };
  },
  onUpdateDownloaded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("update-downloaded", handler);
    return () => {
      ipcRenderer.removeListener("update-downloaded", handler);
    };
  },
  installUpdate: () => ipcRenderer.send("install-update"),

  // Setup wizard
  detectPlatform: () => ipcRenderer.invoke("detect-platform"),
  checkDependencies: () => ipcRenderer.invoke("check-dependencies"),
  installDependency: (name) => ipcRenderer.invoke("install-dependency", name),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  saveSetupConfig: (config) => ipcRenderer.invoke("save-setup-config", config),
  getSetupConfig: () => ipcRenderer.invoke("get-setup-config"),

  // Cloudflared
  cloudflaredDetect: () => ipcRenderer.invoke("cloudflared-detect"),
  cloudflaredDownload: () => ipcRenderer.invoke("cloudflared-download"),
  cloudflaredStartTunnel: (port, name) =>
    ipcRenderer.invoke("cloudflared-start-tunnel", port, name),
  cloudflaredStopTunnel: (name) => ipcRenderer.invoke("cloudflared-stop-tunnel", name),
  cloudflaredGetTunnels: () => ipcRenderer.invoke("cloudflared-get-tunnels"),
  cloudflaredCheckUpdate: () => ipcRenderer.invoke("cloudflared-check-update"),
  cloudflaredUpdate: () => ipcRenderer.invoke("cloudflared-update"),

  onCloudflaredProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, percent: number) => {
      callback(percent);
    };
    ipcRenderer.on("cloudflared-download-progress", handler);
    return () => {
      ipcRenderer.removeListener("cloudflared-download-progress", handler);
    };
  },

  onTunnelStarted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, info: TunnelInfo) => {
      callback(info);
    };
    ipcRenderer.on("tunnel-started", handler);
    return () => {
      ipcRenderer.removeListener("tunnel-started", handler);
    };
  },

  onTunnelStopped: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, name: string) => {
      callback(name);
    };
    ipcRenderer.on("tunnel-stopped", handler);
    return () => {
      ipcRenderer.removeListener("tunnel-stopped", handler);
    };
  },
};

// Expose in the main world
contextBridge.exposeInMainWorld("electron", electronAPI);

// Type declaration for TypeScript
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
