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
 *   bun run scripts/rdv.ts start dev     # Start dev servers (ports 3000, 3001)
 *   bun run scripts/rdv.ts start prod    # Start prod servers (ports 6001, 6002)
 *   bun run scripts/rdv.ts stop          # Stop all servers
 *   bun run scripts/rdv.ts restart prod  # Restart prod servers
 *   bun run scripts/rdv.ts status        # Show running processes
 */

import { spawn, spawnSync } from "bun";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const PID_DIR = join(PROJECT_ROOT, ".pids");
const NEXT_PID_FILE = join(PID_DIR, "next.pid");
const TERMINAL_PID_FILE = join(PID_DIR, "terminal.pid");
const MODE_FILE = join(PID_DIR, "mode");

const CONFIG = {
  dev: {
    nextPort: 3000,
    terminalPort: 3001,
    nextCmd: ["bun", "run", "next", "dev", "--turbopack"],
  },
  prod: {
    nextPort: 6001,
    terminalPort: 6002,
    nextCmd: ["bun", "run", "next", "start", "-p", "6001"],
  },
} as const;

type Mode = keyof typeof CONFIG;
type SpawnedProcess = ReturnType<typeof spawn>;

function ensurePidDir(): void {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
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
      // lsof can return multiple PIDs, take the first one
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

      // Wait for process to exit (up to 5 seconds)
      let attempts = 0;
      while (getProcessOnPort(port) && attempts < 50) {
        spawnSync(["sleep", "0.1"]);
        attempts++;
      }

      // Force kill if still running
      const remainingPid = getProcessOnPort(port);
      if (remainingPid) {
        console.log(`Force killing process on port ${port}...`);
        process.kill(remainingPid, "SIGKILL");
        // Wait for port to be released after SIGKILL
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
      // Send SIGTERM for graceful shutdown
      process.kill(pid, "SIGTERM");

      // Wait up to 5 seconds for process to exit
      let attempts = 0;
      while (isProcessRunning(pid) && attempts < 50) {
        spawnSync(["sleep", "0.1"]);
        attempts++;
      }

      // Force kill if still running
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

  // Check if ports are in use
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

  // Wait for terminal server to be ready
  console.log("Waiting for terminal server to initialize...");
  await Bun.sleep(1500);

  // Start Next.js
  const nextProc = await startServer(
    "Next.js",
    [...config.nextCmd],
    {
      NEXT_PUBLIC_TERMINAL_PORT:
        process.env.NEXT_PUBLIC_TERMINAL_PORT ?? config.terminalPort.toString(),
    },
    NEXT_PID_FILE
  );

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

  // Handle Ctrl+C gracefully
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

  // Also check and kill by port (handles processes not started by rdv)
  const targetMode = mode || getRunningMode();

  // Check both dev and prod ports if no mode specified
  const portsToCheck = targetMode
    ? [CONFIG[targetMode].nextPort, CONFIG[targetMode].terminalPort]
    : [CONFIG.dev.nextPort, CONFIG.dev.terminalPort, CONFIG.prod.nextPort, CONFIG.prod.terminalPort];

  for (const port of portsToCheck) {
    if (port && killProcessOnPort(port)) {
      if (port === CONFIG.dev.nextPort || port === CONFIG.prod.nextPort) {
        stoppedNext = true;
      } else {
        stoppedTerminal = true;
      }
    }
  }

  // Verify ports are actually free
  if (targetMode) {
    const config = CONFIG[targetMode];
    console.log("Verifying ports are released...");
    const nextFree = waitForPortFree(config.nextPort, 3000);
    const terminalFree = waitForPortFree(config.terminalPort, 3000);

    if (!nextFree) {
      console.warn(`Warning: Port ${config.nextPort} still in use`);
    }
    if (!terminalFree) {
      console.warn(`Warning: Port ${config.terminalPort} still in use`);
    }
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

  console.log("\nRemote Dev Status");
  console.log("─".repeat(40));

  // Check both dev and prod ports
  const devNextPid = getProcessOnPort(CONFIG.dev.nextPort);
  const devTerminalPid = getProcessOnPort(CONFIG.dev.terminalPort);
  const prodNextPid = getProcessOnPort(CONFIG.prod.nextPort);
  const prodTerminalPid = getProcessOnPort(CONFIG.prod.terminalPort);

  const devRunning = devNextPid || devTerminalPid;
  const prodRunning = prodNextPid || prodTerminalPid;

  if (devRunning) {
    console.log("\nDEV Mode (ports 3000, 3001):");
    if (devNextPid) {
      console.log(`  Next.js:   RUNNING (PID: ${devNextPid})`);
    } else {
      console.log("  Next.js:   STOPPED");
    }
    if (devTerminalPid) {
      console.log(`  Terminal:  RUNNING (PID: ${devTerminalPid})`);
    } else {
      console.log("  Terminal:  STOPPED");
    }
  }

  if (prodRunning) {
    console.log("\nPROD Mode (ports 6001, 6002):");
    if (prodNextPid) {
      console.log(`  Next.js:   RUNNING (PID: ${prodNextPid})`);
    } else {
      console.log("  Next.js:   STOPPED");
    }
    if (prodTerminalPid) {
      console.log(`  Terminal:  RUNNING (PID: ${prodTerminalPid})`);
    } else {
      console.log("  Terminal:  STOPPED");
    }
  }

  if (!devRunning && !prodRunning) {
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
  dev   Development (Next.js: 3000, Terminal: 3001)
  prod  Production  (Next.js: 6001, Terminal: 6002)

Examples:
  bun run rdv start          # Start dev servers
  bun run rdv start prod     # Start prod servers
  bun run rdv stop           # Stop all servers
  bun run rdv restart        # Restart in current mode
  bun run rdv status         # Check status
`);
}
