/**
 * Process Manager
 *
 * Spawns and manages Next.js and Terminal server processes.
 * Handles graceful startup/shutdown and health monitoring.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { createServer } from "net";
import Config, { Mode } from "./config";

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

class ProcessManagerImpl extends EventEmitter {
  private nextjsProcess: ChildProcess | null = null;
  private terminalProcess: ChildProcess | null = null;
  private mode: Mode = "dev";
  private starting = false;
  private stopping = false;

  constructor() {
    super();
    this.ensurePidDir();
  }

  private ensurePidDir(): void {
    if (!existsSync(Config.pidDir)) {
      mkdirSync(Config.pidDir, { recursive: true });
    }
  }

  private writePid(name: string, pid: number): void {
    writeFileSync(join(Config.pidDir, `${name}.pid`), pid.toString());
  }

  private readPid(name: string): number | null {
    const pidFile = join(Config.pidDir, `${name}.pid`);
    try {
      if (existsSync(pidFile)) {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
        return isNaN(pid) ? null : pid;
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private removePid(name: string): void {
    const pidFile = join(Config.pidDir, `${name}.pid`);
    try {
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
      }
    } catch {
      // Ignore errors
    }
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }

  private async waitForPort(port: number, timeout = 30000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const available = await this.isPortAvailable(port);
      if (!available) {
        // Port is in use = server is running
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  private async stopProcess(
    proc: ChildProcess | null,
    name: string
  ): Promise<void> {
    const pid = proc?.pid ?? this.readPid(name);
    if (!pid) return;

    if (this.isProcessRunning(pid)) {
      console.log(`[ProcessManager] Stopping ${name} (PID: ${pid})...`);
      this.killProcess(pid, "SIGTERM");

      // Wait up to 5 seconds for graceful shutdown
      let attempts = 0;
      while (this.isProcessRunning(pid) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      // Force kill if still running
      if (this.isProcessRunning(pid)) {
        console.log(`[ProcessManager] Force killing ${name}...`);
        this.killProcess(pid, "SIGKILL");
      }
    }

    this.removePid(name);
  }

  async start(mode: Mode = "dev"): Promise<void> {
    if (this.starting) {
      console.log("[ProcessManager] Already starting, ignoring duplicate call");
      return;
    }

    this.starting = true;
    this.mode = mode;
    const ports = Config.getPortConfig(mode);

    console.log(`[ProcessManager] Starting in ${mode.toUpperCase()} mode`);
    console.log(`[ProcessManager] Next.js: http://localhost:${ports.nextjs}`);
    console.log(`[ProcessManager] Terminal: ws://localhost:${ports.terminal}`);

    try {
      // Check if ports are available
      const nextAvailable = await this.isPortAvailable(ports.nextjs);
      const terminalAvailable = await this.isPortAvailable(ports.terminal);

      if (!nextAvailable || !terminalAvailable) {
        const inUse = [];
        if (!nextAvailable) inUse.push(`Port ${ports.nextjs} (Next.js)`);
        if (!terminalAvailable) inUse.push(`Port ${ports.terminal} (Terminal)`);
        throw new Error(`Ports already in use: ${inUse.join(", ")}`);
      }

      // Start terminal server first
      await this.startTerminalServer(ports.terminal);

      // Wait for terminal server to be ready
      console.log("[ProcessManager] Waiting for terminal server...");
      const terminalReady = await this.waitForPort(ports.terminal, 10000);
      if (!terminalReady) {
        throw new Error("Terminal server failed to start");
      }

      // Start Next.js server
      await this.startNextJsServer(mode, ports.nextjs);

      // Wait for Next.js to be ready
      console.log("[ProcessManager] Waiting for Next.js server...");
      const nextReady = await this.waitForPort(ports.nextjs, 30000);
      if (!nextReady) {
        throw new Error("Next.js server failed to start");
      }

      console.log(`[ProcessManager] All servers started successfully`);
      this.emitStatusChange();
    } catch (error) {
      console.error("[ProcessManager] Failed to start servers:", error);
      this.emit("error", error as Error);
      // Clean up any started processes
      await this.stop();
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private async startTerminalServer(port: number): Promise<void> {
    const cmd = Config.getTerminalCommand();
    console.log(`[ProcessManager] Starting terminal server: ${cmd.join(" ")}`);

    this.terminalProcess = spawn(cmd[0], cmd.slice(1), {
      cwd: Config.appPath,
      env: {
        ...process.env,
        TERMINAL_PORT: port.toString(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (this.terminalProcess.pid) {
      this.writePid("terminal", this.terminalProcess.pid);
    }

    this.terminalProcess.stdout?.on("data", (data) => {
      const text = data.toString();
      console.log(`[Terminal] ${text.trim()}`);
      this.emit("terminal-stdout", text);
    });

    this.terminalProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      console.error(`[Terminal] ${text.trim()}`);
      this.emit("terminal-stderr", text);
    });

    this.terminalProcess.on("exit", (code) => {
      console.log(`[ProcessManager] Terminal server exited with code ${code}`);
      this.terminalProcess = null;
      this.removePid("terminal");
      this.emitStatusChange();
    });

    this.terminalProcess.on("error", (err) => {
      console.error("[ProcessManager] Terminal server error:", err);
      this.emit("error", err);
    });
  }

  private async startNextJsServer(mode: Mode, port: number): Promise<void> {
    const cmd = Config.getNextJsCommand(mode);
    console.log(`[ProcessManager] Starting Next.js server: ${cmd.join(" ")}`);

    this.nextjsProcess = spawn(cmd[0], cmd.slice(1), {
      cwd: Config.appPath,
      env: {
        ...process.env,
        PORT: port.toString(),
        NEXT_PUBLIC_TERMINAL_PORT: Config.getPortConfig(mode).terminal.toString(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (this.nextjsProcess.pid) {
      this.writePid("nextjs", this.nextjsProcess.pid);
    }

    this.nextjsProcess.stdout?.on("data", (data) => {
      const text = data.toString();
      console.log(`[Next.js] ${text.trim()}`);
      this.emit("nextjs-stdout", text);
    });

    this.nextjsProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      console.error(`[Next.js] ${text.trim()}`);
      this.emit("nextjs-stderr", text);
    });

    this.nextjsProcess.on("exit", (code) => {
      console.log(`[ProcessManager] Next.js server exited with code ${code}`);
      this.nextjsProcess = null;
      this.removePid("nextjs");
      this.emitStatusChange();
    });

    this.nextjsProcess.on("error", (err) => {
      console.error("[ProcessManager] Next.js server error:", err);
      this.emit("error", err);
    });
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      console.log("[ProcessManager] Already stopping, ignoring duplicate call");
      return;
    }

    this.stopping = true;
    console.log("[ProcessManager] Stopping all servers...");

    try {
      await Promise.all([
        this.stopProcess(this.nextjsProcess, "nextjs"),
        this.stopProcess(this.terminalProcess, "terminal"),
      ]);

      this.nextjsProcess = null;
      this.terminalProcess = null;

      console.log("[ProcessManager] All servers stopped");
      this.emitStatusChange();
    } finally {
      this.stopping = false;
    }
  }

  async restart(mode?: Mode): Promise<void> {
    await this.stop();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.start(mode ?? this.mode);
  }

  getStatus(): ServerStatus {
    const ports = Config.getPortConfig(this.mode);
    return {
      nextjs: {
        running: this.nextjsProcess !== null && this.nextjsProcess.pid !== undefined,
        port: ports.nextjs,
        pid: this.nextjsProcess?.pid,
      },
      terminal: {
        running: this.terminalProcess !== null && this.terminalProcess.pid !== undefined,
        port: ports.terminal,
        pid: this.terminalProcess?.pid,
      },
    };
  }

  getMode(): Mode {
    return this.mode;
  }

  private emitStatusChange(): void {
    this.emit("status-change", this.getStatus());
  }
}

export const ProcessManager = new ProcessManagerImpl();
export default ProcessManager;
