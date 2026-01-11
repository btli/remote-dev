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
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const PID_DIR = join(PROJECT_ROOT, ".pids");
const NEXT_PID_FILE = join(PID_DIR, "next.pid");
const TERMINAL_PID_FILE = join(PID_DIR, "terminal.pid");
const MODE_FILE = join(PID_DIR, "mode");
const STANDALONE_DIR = join(PROJECT_ROOT, ".next", "standalone");

// Standard directory for all Remote Dev runtime files
const REMOTE_DEV_DIR = process.env.REMOTE_DEV_DIR || join(process.env.HOME || "~", ".remote-dev");
const SOCKET_DIR = join(REMOTE_DEV_DIR, "run");
const RDV_SERVER_DIR = join(REMOTE_DEV_DIR, "server");

// rdv-server (Rust backend) paths
const RDV_SERVER_BINARY = join(PROJECT_ROOT, "crates", "target", "release", "rdv-server");
const RDV_SERVER_PID_FILE = join(RDV_SERVER_DIR, "server.pid");
const RDV_SERVER_SOCKET = join(SOCKET_DIR, "api.sock");

const CONFIG = {
  dev: {
    type: "port" as const,
    nextPort: 6001,
    terminalPort: 6002,
    nextCmd: ["bun", "run", "next", "dev", "--turbopack", "-p", "6001"],
  },
  prod: {
    type: "socket" as const,
    nextSocket: join(SOCKET_DIR, "nextjs.sock"),
    terminalSocket: join(SOCKET_DIR, "terminal.sock"),
    rdvServerSocket: RDV_SERVER_SOCKET,
    nextCmd: ["node", "scripts/standalone-server.js"],
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

function ensureRdvServerDir(): void {
  if (!existsSync(RDV_SERVER_DIR)) {
    console.log(`Creating rdv-server directory: ${RDV_SERVER_DIR}`);
    try {
      mkdirSync(RDV_SERVER_DIR, { recursive: true, mode: 0o755 });
    } catch {
      console.error(`Failed to create rdv-server directory. Try: sudo mkdir -p ${RDV_SERVER_DIR} && sudo chown $(whoami) ${RDV_SERVER_DIR}`);
      process.exit(1);
    }
  }
}

function checkRdvServerBinary(): boolean {
  if (!existsSync(RDV_SERVER_BINARY)) {
    console.warn(`\nWarning: rdv-server binary not found at ${RDV_SERVER_BINARY}`);
    console.warn(`Build it with: cd crates && cargo build --release`);
    return false;
  }
  return true;
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

  // Copy native module libraries that Next.js standalone doesn't include
  // onnxruntime-node requires the dylib to be in the same directory as the .node file
  const onnxruntimeSrc = join(
    PROJECT_ROOT,
    "node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib"
  );
  const onnxruntimeDest = join(
    STANDALONE_DIR,
    "node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib"
  );
  if (existsSync(onnxruntimeSrc) && !existsSync(onnxruntimeDest)) {
    console.log("Copying onnxruntime native library for standalone mode...");
    copyFileSync(onnxruntimeSrc, onnxruntimeDest);
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
    console.log(`  Terminal: ws://localhost:${config.terminalPort}\n`);

    // Start terminal server first
    const terminalProc = await startServer(
      "Terminal Server",
      ["bun", "run", "tsx", "src/server/index.ts"],
      { TERMINAL_PORT: config.terminalPort.toString() },
      TERMINAL_PID_FILE
    );

    console.log("Waiting for terminal server to initialize...");
    await Bun.sleep(1500);

    // Start Next.js
    const nextProc = await startServer(
      "Next.js",
      [...config.nextCmd],
      {
        PORT: config.nextPort.toString(),
        NEXT_PUBLIC_TERMINAL_PORT: config.terminalPort.toString(),
      },
      NEXT_PID_FILE
    );

    await waitForExit(mode, terminalProc, nextProc, null);
  } else {
    // Prod mode: use Unix sockets
    ensureSocketDir();
    ensureRdvServerDir();
    prepareStandalone();

    // Clean up stale sockets
    cleanupSocket(config.nextSocket);
    cleanupSocket(config.terminalSocket);
    cleanupSocket(config.rdvServerSocket);

    // Use project root database for both dev and prod (shared database)
    const prodDatabaseUrl = `file:${join(PROJECT_ROOT, "sqlite.db")}`;

    console.log(`\nStarting Remote Dev in ${mode.toUpperCase()} mode (Unix sockets)`);
    console.log(`  rdv-server: ${config.rdvServerSocket}`);
    console.log(`  Next.js:    ${config.nextSocket}`);
    console.log(`  Terminal:   ${config.terminalSocket}`);
    console.log(`  Database:   ${join(PROJECT_ROOT, "sqlite.db")}\n`);

    // Start rdv-server (Rust backend) first if available
    let rdvServerProc: SpawnedProcess | null = null;
    if (checkRdvServerBinary()) {
      rdvServerProc = await startServer(
        "rdv-server",
        [RDV_SERVER_BINARY],
        {
          REMOTE_DEV_DIR: REMOTE_DEV_DIR,
        },
        RDV_SERVER_PID_FILE
      );
      console.log("Waiting for rdv-server to initialize...");
      await Bun.sleep(1000);
    }

    // Start terminal server
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

    // Start Next.js with socket
    const nextProc = await startServer(
      "Next.js",
      [...config.nextCmd],
      {
        SOCKET_PATH: config.nextSocket,
        TERMINAL_SOCKET: config.terminalSocket,
        RDV_SERVER_SOCKET: config.rdvServerSocket,
        DATABASE_URL: prodDatabaseUrl,
      },
      NEXT_PID_FILE
    );

    await waitForExit(mode, terminalProc, nextProc, rdvServerProc);
  }
}

async function waitForExit(
  mode: Mode,
  terminalProc: SpawnedProcess | null,
  nextProc: SpawnedProcess | null,
  rdvServerProc: SpawnedProcess | null
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
  if (rdvServerProc) {
    exitPromises.push(rdvServerProc.exited.then((code) => ({
      name: "rdv-server",
      code,
    })));
  }
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
  const stoppedRdvServer = stopProcess(RDV_SERVER_PID_FILE, "rdv-server");

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
    cleanupSocket(prodConfig.rdvServerSocket);
  }

  if (!stoppedNext && !stoppedTerminal && !stoppedRdvServer) {
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
  const rdvServerPid = readPid(RDV_SERVER_PID_FILE);
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
  const prodRdvServerRunning = existsSync(prodConfig.rdvServerSocket);
  const prodRunning = prodNextRunning || prodTerminalRunning || prodRdvServerRunning;

  if (devRunning) {
    console.log(`\nDEV Mode (ports ${devConfig.nextPort}, ${devConfig.terminalPort}):`);
    console.log(`  Next.js:   ${devNextPid ? `RUNNING (PID: ${devNextPid})` : "STOPPED"}`);
    console.log(`  Terminal:  ${devTerminalPid ? `RUNNING (PID: ${devTerminalPid})` : "STOPPED"}`);
  }

  if (prodRunning || runningMode === "prod") {
    console.log("\nPROD Mode (Unix sockets):");
    console.log(`  rdv-server: ${prodRdvServerRunning ? `RUNNING (${prodConfig.rdvServerSocket})` : "STOPPED"}`);
    console.log(`  Next.js:    ${prodNextRunning ? `RUNNING (${prodConfig.nextSocket})` : "STOPPED"}`);
    console.log(`  Terminal:   ${prodTerminalRunning ? `RUNNING (${prodConfig.terminalSocket})` : "STOPPED"}`);
    if (rdvServerPid && isProcessRunning(rdvServerPid)) {
      console.log(`  rdv-server PID: ${rdvServerPid}`);
    }
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
  if (rdvServerPid && !isProcessRunning(rdvServerPid)) removePid(RDV_SERVER_PID_FILE);
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
  prod  Production  (Unix sockets)
        - rdv-server: ${CONFIG.prod.rdvServerSocket}
        - Next.js:    ${CONFIG.prod.nextSocket}
        - Terminal:   ${CONFIG.prod.terminalSocket}

Examples:
  bun run rdv start          # Start dev servers
  bun run rdv start prod     # Start prod servers
  bun run rdv stop           # Stop all servers
  bun run rdv restart        # Restart in current mode
  bun run rdv status         # Check status
`);
}
