#!/usr/bin/env bun
/**
 * Remote Dev Process Manager
 *
 * Usage:
 *   bun run scripts/rdv.ts <command> [mode]
 *
 * Commands: start, stop, restart, status
 * Modes: dev (default), prod
 *
 * Examples:
 *   bun run scripts/rdv.ts start dev     # Start dev servers (ports 6001, 6002)
 *   bun run scripts/rdv.ts start prod    # Start prod servers (Unix sockets)
 *   bun run scripts/rdv.ts stop          # Stop all servers
 *   bun run scripts/rdv.ts restart prod  # Restart prod servers
 *   bun run scripts/rdv.ts status        # Show running processes
 */

import { spawn, spawnSync } from "bun";
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PROJECT_ROOT = join(import.meta.dir, "..");
const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const PID_DIR = join(DATA_DIR, "server");
const NEXT_PID_FILE = join(PID_DIR, "next.pid");
const TERMINAL_PID_FILE = join(PID_DIR, "terminal.pid");
const MODE_FILE = join(PID_DIR, "mode");
const STANDALONE_DIR = join(PROJECT_ROOT, ".next", "standalone");
const SOCKET_DIR = join(DATA_DIR, "run");

const CONFIG = {
  dev: {
    type: "port" as const,
    nextPort: 6001,
    terminalPort: 6002,
    nextCmd: ["bun", "run", "next", "dev", "--turbopack", "-p", "6001"],
    // Local development URL - credentials auth works here
    nextAuthUrl: "http://localhost:6001",
  },
  prod: {
    type: "socket" as const,
    nextSocket: join(SOCKET_DIR, "nextjs.sock"),
    terminalSocket: join(SOCKET_DIR, "terminal.sock"),
    nextCmd: ["node", "scripts/standalone-server.js"],
    // Production URL - accessed via Cloudflare tunnel
    nextAuthUrl: "https://dev.bryanli.net",
  },
} as const;

type Mode = keyof typeof CONFIG;
type SpawnedProcess = ReturnType<typeof spawn>;

function ensurePidDir(): void {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
}

function ensureSocketDir(): void {
  if (!existsSync(SOCKET_DIR)) {
    console.log(`Creating socket directory: ${SOCKET_DIR}`);
    try {
      mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o755 });
    } catch {
      console.error(`Failed to create socket directory. Try: sudo mkdir -p ${SOCKET_DIR} && sudo chown $(whoami) ${SOCKET_DIR}`);
      process.exit(1);
    }
  }
}

function cleanupSocket(socketPath: string): void {
  if (existsSync(socketPath)) {
    console.log(`Removing stale socket: ${socketPath}`);
    try {
      unlinkSync(socketPath);
    } catch (err) {
      console.error(`Failed to remove socket ${socketPath}:`, err);
    }
  }
}

function prepareStandalone(): void {
  // Next.js standalone mode requires static files to be copied/symlinked
  const staticSrc = join(PROJECT_ROOT, ".next", "static");
  const staticDest = join(STANDALONE_DIR, ".next", "static");
  const publicSrc = join(PROJECT_ROOT, "public");
  const publicDest = join(STANDALONE_DIR, "public");

  // Create symlink for .next/static
  if (existsSync(staticSrc) && !existsSync(staticDest)) {
    console.log("Linking static files for standalone mode...");
    symlinkSync(staticSrc, staticDest);
  }

  // Create symlink for public
  if (existsSync(publicSrc) && !existsSync(publicDest)) {
    console.log("Linking public files for standalone mode...");
    symlinkSync(publicSrc, publicDest);
  }
}

function readPid(file: string): number | null {
  try {
    if (existsSync(file)) {
      const pid = parseInt(readFileSync(file, "utf-8").trim());
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

function writePid(file: string, pid: number): void {
  writeFileSync(file, pid.toString());
}

function removePid(file: string): void {
  try {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  } catch {
    // Ignore errors
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessOnPort(port: number): number | null {
  const result = spawnSync(["lsof", "-ti", `:${port}`]);
  if (result.stdout) {
    const output = result.stdout.toString().trim();
    if (output) {
      const pid = parseInt(output.split("\n")[0]);
      return isNaN(pid) ? null : pid;
    }
  }
  return null;
}

function killProcessOnPort(port: number): boolean {
  const pid = getProcessOnPort(port);
  if (pid) {
    console.log(`Killing process on port ${port} (PID: ${pid})...`);
    try {
      process.kill(pid, "SIGTERM");

      let attempts = 0;
      while (getProcessOnPort(port) && attempts < 50) {
        spawnSync(["sleep", "0.1"]);
        attempts++;
      }

      const remainingPid = getProcessOnPort(port);
      if (remainingPid) {
        console.log(`Force killing process on port ${port}...`);
        process.kill(remainingPid, "SIGKILL");
        attempts = 0;
        while (getProcessOnPort(port) && attempts < 20) {
          spawnSync(["sleep", "0.1"]);
          attempts++;
        }
      }

      return true;
    } catch (err) {
      console.error(`Failed to kill process on port ${port}:`, err);
      return false;
    }
  }
  return false;
}

function waitForPortFree(port: number, timeoutMs: number = 5000): boolean {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!getProcessOnPort(port)) {
      return true;
    }
    spawnSync(["sleep", "0.1"]);
  }
  return false;
}

function getRunningMode(): Mode | null {
  try {
    if (existsSync(MODE_FILE)) {
      const mode = readFileSync(MODE_FILE, "utf-8").trim();
      if (mode === "dev" || mode === "prod") {
        return mode;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

function saveMode(mode: Mode): void {
  writeFileSync(MODE_FILE, mode);
}

function clearMode(): void {
  removePid(MODE_FILE);
}

function stopProcess(pidFile: string, name: string): boolean {
  const pid = readPid(pidFile);
  if (pid && isProcessRunning(pid)) {
    console.log(`Stopping ${name} (PID: ${pid})...`);
    try {
      process.kill(pid, "SIGTERM");

      let attempts = 0;
      while (isProcessRunning(pid) && attempts < 50) {
        spawnSync(["sleep", "0.1"]);
        attempts++;
      }

      if (isProcessRunning(pid)) {
        console.log(`Force killing ${name}...`);
        process.kill(pid, "SIGKILL");
      }

      removePid(pidFile);
      return true;
    } catch (err) {
      console.error(`Failed to stop ${name}:`, err);
      removePid(pidFile);
      return false;
    }
  } else if (pid) {
    console.log(`${name} not running (stale PID file)`);
    removePid(pidFile);
  }
  return false;
}

async function startServer(
  name: string,
  cmd: string[],
  env: Record<string, string>,
  pidFile: string
): Promise<SpawnedProcess | null> {
  console.log(`Starting ${name}...`);

  const proc = spawn({
    cmd,
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });

  if (proc.pid) {
    writePid(pidFile, proc.pid);
    console.log(`${name} started (PID: ${proc.pid})`);
    return proc;
  }

  console.error(`Failed to start ${name}`);
  return null;
}

async function start(mode: Mode): Promise<void> {
  ensurePidDir();

  const config = CONFIG[mode];

  if (config.type === "port") {
    // Dev mode: check if ports are in use
    const nextPortPid = getProcessOnPort(config.nextPort);
    const terminalPortPid = getProcessOnPort(config.terminalPort);

    if (nextPortPid || terminalPortPid) {
      console.error(`\nPorts already in use:`);
      if (nextPortPid) {
        console.error(`  Port ${config.nextPort}: PID ${nextPortPid}`);
      }
      if (terminalPortPid) {
        console.error(`  Port ${config.terminalPort}: PID ${terminalPortPid}`);
      }
      console.error("\nRun 'bun run rdv:stop' first or 'bun run rdv restart' to restart");
      process.exit(1);
    }

    console.log(`\nStarting Remote Dev in ${mode.toUpperCase()} mode`);
    console.log(`  Next.js:  http://localhost:${config.nextPort}`);
    console.log(`  Terminal: ws://localhost:${config.terminalPort}`);
    console.log(`  Auth URL: ${config.nextAuthUrl}\n`);

    // Start terminal server first
    const terminalProc = await startServer(
      "Terminal Server",
      ["bun", "run", "tsx", "src/server/index.ts"],
      { TERMINAL_PORT: config.terminalPort.toString() },
      TERMINAL_PID_FILE
    );

    console.log("Waiting for terminal server to initialize...");
    await Bun.sleep(1500);

    // Start Next.js with correct NEXTAUTH_URL for local dev
    const nextProc = await startServer(
      "Next.js",
      [...config.nextCmd],
      {
        PORT: config.nextPort.toString(),
        NEXT_PUBLIC_TERMINAL_PORT: config.terminalPort.toString(),
        NEXTAUTH_URL: config.nextAuthUrl,
        AUTH_URL: config.nextAuthUrl, // NextAuth v5 also checks AUTH_URL
      },
      NEXT_PID_FILE
    );

    await waitForExit(mode, terminalProc, nextProc);
  } else {
    // Prod mode: use Unix sockets
    ensureSocketDir();
    prepareStandalone();

    // Clean up stale sockets
    cleanupSocket(config.nextSocket);
    cleanupSocket(config.terminalSocket);

    // Use centralized database at ~/.remote-dev/sqlite.db for all modes
    const prodDatabaseUrl = `file:${join(DATA_DIR, "sqlite.db")}`;

    console.log(`\nStarting Remote Dev in ${mode.toUpperCase()} mode (Unix sockets)`);
    console.log(`  Next.js:  ${config.nextSocket}`);
    console.log(`  Terminal: ${config.terminalSocket}`);
    console.log(`  Auth URL: ${config.nextAuthUrl}`);
    console.log(`  Database: ${join(DATA_DIR, "sqlite.db")}\n`);

    // Start terminal server first
    const terminalProc = await startServer(
      "Terminal Server",
      ["bun", "run", "tsx", "src/server/index.ts"],
      {
        TERMINAL_SOCKET: config.terminalSocket,
        DATABASE_URL: prodDatabaseUrl,
      },
      TERMINAL_PID_FILE
    );

    console.log("Waiting for terminal server to initialize...");
    await Bun.sleep(1500);

    // Start Next.js with socket and correct NEXTAUTH_URL for prod
    const nextProc = await startServer(
      "Next.js",
      [...config.nextCmd],
      {
        SOCKET_PATH: config.nextSocket,
        TERMINAL_SOCKET: config.terminalSocket,
        DATABASE_URL: prodDatabaseUrl,
        NEXTAUTH_URL: config.nextAuthUrl,
        AUTH_URL: config.nextAuthUrl, // NextAuth v5 also checks AUTH_URL
      },
      NEXT_PID_FILE
    );

    await waitForExit(mode, terminalProc, nextProc);
  }
}

async function waitForExit(
  mode: Mode,
  terminalProc: SpawnedProcess | null,
  nextProc: SpawnedProcess | null
): Promise<void> {
  saveMode(mode);

  console.log(`\nRemote Dev started in ${mode.toUpperCase()} mode`);
  console.log("Press Ctrl+C to stop all servers\n");

  let shuttingDown = false;
  const shutdown = (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n\n${reason}, shutting down...`);
    stop(mode);
    process.exit(exitCode);
  };

  process.on("SIGINT", () => shutdown("Received SIGINT", 0));
  process.on("SIGTERM", () => shutdown("Received SIGTERM", 0));

  const exitPromises: Promise<{ name: string; code: number | null }>[] = [];
  if (terminalProc) {
    exitPromises.push(terminalProc.exited.then((code) => ({
      name: "Terminal Server",
      code,
    })));
  }
  if (nextProc) {
    exitPromises.push(nextProc.exited.then((code) => ({
      name: "Next.js",
      code,
    })));
  }

  if (exitPromises.length === 0) {
    shutdown("No servers started", 1);
    return;
  }

  const { name, code } = await Promise.race(exitPromises);
  shutdown(`${name} exited (code: ${code ?? "unknown"})`, code ?? 1);
}

function stop(mode?: Mode): void {
  console.log("\nStopping Remote Dev...\n");

  // Stop by PID file first
  let stoppedNext = stopProcess(NEXT_PID_FILE, "Next.js");
  let stoppedTerminal = stopProcess(TERMINAL_PID_FILE, "Terminal Server");

  const targetMode = mode || getRunningMode();

  // For dev mode, also check and kill by port
  if (!targetMode || targetMode === "dev") {
    const devConfig = CONFIG.dev;
    if (killProcessOnPort(devConfig.nextPort)) stoppedNext = true;
    if (killProcessOnPort(devConfig.terminalPort)) stoppedTerminal = true;

    console.log("Verifying ports are released...");
    waitForPortFree(devConfig.nextPort, 3000);
    waitForPortFree(devConfig.terminalPort, 3000);
  }

  // For prod mode, clean up sockets
  if (targetMode === "prod") {
    const prodConfig = CONFIG.prod;
    cleanupSocket(prodConfig.nextSocket);
    cleanupSocket(prodConfig.terminalSocket);
  }

  if (!stoppedNext && !stoppedTerminal) {
    console.log("No servers were running");
  } else {
    console.log("\nAll servers stopped");
  }

  clearMode();
}

async function restart(mode?: Mode): Promise<void> {
  const currentMode = mode || getRunningMode() || "dev";
  console.log(`Restarting in ${currentMode.toUpperCase()} mode...\n`);
  stop(currentMode);
  await Bun.sleep(1000);
  await start(currentMode);
}

function status(): void {
  ensurePidDir();

  const nextPid = readPid(NEXT_PID_FILE);
  const terminalPid = readPid(TERMINAL_PID_FILE);
  const runningMode = getRunningMode();

  console.log("\nRemote Dev Status");
  console.log("─".repeat(40));

  // Check dev mode (ports)
  const devConfig = CONFIG.dev;
  const devNextPid = getProcessOnPort(devConfig.nextPort);
  const devTerminalPid = getProcessOnPort(devConfig.terminalPort);
  const devRunning = devNextPid || devTerminalPid;

  // Check prod mode (sockets)
  const prodConfig = CONFIG.prod;
  const prodNextRunning = existsSync(prodConfig.nextSocket);
  const prodTerminalRunning = existsSync(prodConfig.terminalSocket);
  const prodRunning = prodNextRunning || prodTerminalRunning;

  if (devRunning) {
    console.log(`\nDEV Mode (ports ${devConfig.nextPort}, ${devConfig.terminalPort}):`);
    console.log(`  Next.js:   ${devNextPid ? `RUNNING (PID: ${devNextPid})` : "STOPPED"}`);
    console.log(`  Terminal:  ${devTerminalPid ? `RUNNING (PID: ${devTerminalPid})` : "STOPPED"}`);
  }

  if (prodRunning || runningMode === "prod") {
    console.log("\nPROD Mode (Unix sockets):");
    console.log(`  Next.js:   ${prodNextRunning ? `RUNNING (${prodConfig.nextSocket})` : "STOPPED"}`);
    console.log(`  Terminal:  ${prodTerminalRunning ? `RUNNING (${prodConfig.terminalSocket})` : "STOPPED"}`);
    if (nextPid && isProcessRunning(nextPid)) {
      console.log(`  Next.js PID: ${nextPid}`);
    }
    if (terminalPid && isProcessRunning(terminalPid)) {
      console.log(`  Terminal PID: ${terminalPid}`);
    }
  }

  if (!devRunning && !prodRunning && runningMode !== "prod") {
    console.log("\nNo servers running");
  }

  // Clean up stale PID files
  if (nextPid && !isProcessRunning(nextPid)) removePid(NEXT_PID_FILE);
  if (terminalPid && !isProcessRunning(terminalPid)) removePid(TERMINAL_PID_FILE);
  if (!devRunning && !prodRunning) clearMode();

  console.log("");
}

// Main
const [command, modeArg] = process.argv.slice(2);
const mode = (modeArg === "prod" ? "prod" : "dev") as Mode;

switch (command) {
  case "start":
    await start(mode);
    break;
  case "stop":
    stop();
    break;
  case "restart":
    await restart(modeArg as Mode | undefined);
    break;
  case "status":
    status();
    break;
  default:
    console.log(`
Remote Dev Process Manager

Usage: bun run scripts/rdv.ts <command> [mode]

Commands:
  start [dev|prod]   Start servers (default: dev)
  stop               Stop all servers
  restart [dev|prod] Restart servers
  status             Show server status

Modes:
  dev   Development (ports 6001, 6002)
  prod  Production  (Unix sockets: ${CONFIG.prod.nextSocket}, ${CONFIG.prod.terminalSocket})

Examples:
  bun run rdv start          # Start dev servers
  bun run rdv start prod     # Start prod servers
  bun run rdv stop           # Stop all servers
  bun run rdv restart        # Restart in current mode
  bun run rdv status         # Check status
`);
}
