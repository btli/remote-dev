#!/usr/bin/env bun
/**
 * Blue-Green Deploy Script
 *
 * Performs zero-downtime-ish deployments by building into an inactive slot
 * while the active slot serves traffic, then swapping.
 *
 * Usage:
 *   bun run scripts/deploy.ts              # Deploy latest main
 *   bun run scripts/deploy.ts --rollback   # Rollback to previous slot
 *   bun run scripts/deploy.ts --status     # Show deploy state
 *   bun run scripts/deploy.ts --init       # Initialize deploy state from current running instance
 *
 * Directory structure:
 *   ~/.remote-dev/deploy/
 *   ├── state.json       # Active slot, commit SHA, timestamps
 *   ├── deploy.lock      # PID-based concurrent deploy prevention
 *   └── deploy.log       # Append-only deploy history
 *
 *   ~/.remote-dev/builds/
 *   ├── blue/             # Build A standalone output
 *   └── green/            # Build B standalone output
 */

import { spawn, spawnSync } from "bun";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  cpSync,
  rmSync,
  appendFileSync,
  openSync,
  writeSync,
  closeSync,
  renameSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(import.meta.dir, "..");
const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const DEPLOY_DIR = join(DATA_DIR, "deploy");
const BUILDS_DIR = join(DATA_DIR, "builds");
const SOCKET_DIR = join(DATA_DIR, "run");
const SERVER_DIR = join(DATA_DIR, "server");
const STATE_FILE = join(DEPLOY_DIR, "state.json");
const LOCK_FILE = join(DEPLOY_DIR, "deploy.lock");
const LOG_FILE = join(DEPLOY_DIR, "deploy.log");

const NEXTJS_SOCKET = join(SOCKET_DIR, "nextjs.sock");
const TERMINAL_SOCKET = join(SOCKET_DIR, "terminal.sock");

const EXTERNAL_URL =
  process.env.DEPLOY_EXTERNAL_URL || "https://dev.bryanli.net";
const HEALTH_CHECK_TIMEOUT_MS = 90_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;
const PROCESS_STOP_TIMEOUT_MS = 10_000;

type Slot = "blue" | "green";

interface DeployState {
  activeSlot: Slot;
  activeCommit: string;
  deployedAt: string;
  previousSlot: Slot;
  previousCommit: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

function logDeploy(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Log file write failed, continue anyway
  }
}

function logError(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ERROR: ${message}`;
  console.error(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Log file write failed, continue anyway
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory setup
// ─────────────────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [
    DEPLOY_DIR,
    BUILDS_DIR,
    join(BUILDS_DIR, "blue"),
    join(BUILDS_DIR, "green"),
    SOCKET_DIR,
    SERVER_DIR,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy state
// ─────────────────────────────────────────────────────────────────────────────

function readDeployState(): DeployState | null {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {
    logError("Failed to read deploy state");
  }
  return null;
}

function writeDeployState(state: DeployState): void {
  const tmpFile = STATE_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  // Atomic rename
  renameSync(tmpFile, STATE_FILE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock management
// ─────────────────────────────────────────────────────────────────────────────

function acquireLock(): boolean {
  // Check for stale locks first
  if (existsSync(LOCK_FILE)) {
    try {
      const lockPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim());
      if (!isNaN(lockPid)) {
        try {
          process.kill(lockPid, 0);
          // Process is alive — lock is held
          logError(`Deploy already in progress (PID: ${lockPid})`);
          return false;
        } catch {
          // Process is dead — stale lock, remove it
          logDeploy(`Removing stale lock (PID: ${lockPid} is dead)`);
          unlinkSync(LOCK_FILE);
        }
      } else {
        unlinkSync(LOCK_FILE);
      }
    } catch {
      try { unlinkSync(LOCK_FILE); } catch { /* Ignore */ }
    }
  }

  // Atomic lock acquisition using O_EXCL (kernel-level exclusive create)
  try {
    const fd = openSync(LOCK_FILE, "wx"); // O_WRONLY | O_CREAT | O_EXCL
    writeSync(fd, process.pid.toString());
    closeSync(fd);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
      // Another process acquired the lock between our check and create
      logError("Deploy lock acquired by another process");
      return false;
    }
    throw err;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      // Only release if we own the lock
      const lockPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim());
      if (isNaN(lockPid) || lockPid === process.pid) {
        unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // Ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process management
// ─────────────────────────────────────────────────────────────────────────────

function readPid(file: string): number | null {
  try {
    if (existsSync(file)) {
      const pid = parseInt(readFileSync(file, "utf-8").trim());
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // Ignore
  }
  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopCurrentServers(): void {
  logDeploy("Stopping current servers...");

  const nextPid = readPid(join(SERVER_DIR, "next.pid"));
  const terminalPid = readPid(join(SERVER_DIR, "terminal.pid"));

  const pidsToStop: Array<{ pid: number; name: string }> = [];
  if (nextPid && isProcessRunning(nextPid)) {
    pidsToStop.push({ pid: nextPid, name: "Next.js" });
  }
  if (terminalPid && isProcessRunning(terminalPid)) {
    pidsToStop.push({ pid: terminalPid, name: "Terminal Server" });
  }

  // Send SIGTERM to all
  for (const { pid, name } of pidsToStop) {
    logDeploy(`Sending SIGTERM to ${name} (PID: ${pid})`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      logDeploy(`${name} already stopped`);
    }
  }

  // Wait for all to exit
  const deadline = Date.now() + PROCESS_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const stillRunning = pidsToStop.filter((p) => isProcessRunning(p.pid));
    if (stillRunning.length === 0) break;
    spawnSync(["sleep", "0.2"]);
  }

  // SIGKILL any stragglers
  for (const { pid, name } of pidsToStop) {
    if (isProcessRunning(pid)) {
      logDeploy(`Force killing ${name} (PID: ${pid})`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already dead
      }
    }
  }

  // Clean up stale sockets
  for (const sock of [NEXTJS_SOCKET, TERMINAL_SOCKET]) {
    if (existsSync(sock)) {
      try {
        unlinkSync(sock);
      } catch {
        // Ignore
      }
    }
  }

  // Clean up PID files
  for (const pidFile of ["next.pid", "terminal.pid"]) {
    const file = join(SERVER_DIR, pidFile);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // Ignore
    }
  }

  logDeploy("Servers stopped");
}

async function startServers(slot: Slot): Promise<boolean> {
  const buildDir = join(BUILDS_DIR, slot);
  const standaloneDir = join(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    logError(`No standalone build found at ${standaloneDir}`);
    return false;
  }

  const prodDatabaseUrl = `file:${join(DATA_DIR, "sqlite.db")}`;

  logDeploy(`Starting servers from ${slot} slot...`);

  // Ensure stale sockets are cleaned up before starting new servers.
  // The previous stopCurrentServers() should have done this, but there can be
  // a race if the old process took time to release the socket file.
  for (const sock of [NEXTJS_SOCKET, TERMINAL_SOCKET]) {
    if (existsSync(sock)) {
      try {
        unlinkSync(sock);
        logDeploy(`Cleaned up stale socket: ${sock}`);
      } catch {
        // Ignore
      }
    }
  }

  // Start terminal server from source (not from slot build).
  // The terminal server uses tsx + node-pty native bindings and doesn't have
  // a standalone build. This means rollback doesn't cover the terminal server.
  // In practice this is acceptable: the terminal server rarely has breaking
  // protocol changes, and tmux sessions survive server restarts.
  const terminalProc = spawn({
    cmd: ["bun", "run", "tsx", "src/server/index.ts"],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      TERMINAL_SOCKET: TERMINAL_SOCKET,
      DATABASE_URL: prodDatabaseUrl,
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  if (terminalProc.pid) {
    writeFileSync(join(SERVER_DIR, "terminal.pid"), terminalProc.pid.toString());
    logDeploy(`Terminal Server started (PID: ${terminalProc.pid})`);
  } else {
    logError("Failed to start Terminal Server");
    return false;
  }

  // Wait for terminal server to initialize
  await Bun.sleep(2000);

  // Start Next.js from the slot's build
  const nextProc = spawn({
    cmd: ["node", join(PROJECT_ROOT, "scripts", "standalone-server.js")],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SOCKET_PATH: NEXTJS_SOCKET,
      TERMINAL_SOCKET: TERMINAL_SOCKET,
      DATABASE_URL: prodDatabaseUrl,
      NEXTAUTH_URL: EXTERNAL_URL,
      AUTH_URL: EXTERNAL_URL,
      STANDALONE_DIR: standaloneDir,
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  if (nextProc.pid) {
    writeFileSync(join(SERVER_DIR, "next.pid"), nextProc.pid.toString());
    logDeploy(`Next.js started (PID: ${nextProc.pid})`);
  } else {
    logError("Failed to start Next.js");
    return false;
  }

  // Save mode file so rdv status works
  writeFileSync(join(SERVER_DIR, "mode"), "prod");

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

function runCommand(
  cmd: string[],
  cwd: string,
  description: string
): boolean {
  logDeploy(`Running: ${description}`);
  const result = spawnSync(cmd, {
    cwd,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    logError(`${description} failed with exit code ${result.exitCode}`);
    return false;
  }
  return true;
}

function getGitCommit(): string {
  const result = spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    cwd: PROJECT_ROOT,
  });
  return result.stdout?.toString().trim() || "unknown";
}

function getGitCommitFull(): string {
  const result = spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: PROJECT_ROOT,
  });
  return result.stdout?.toString().trim() || "unknown";
}

function buildSlot(slot: Slot): boolean {
  const buildDir = join(BUILDS_DIR, slot);
  const standaloneDir = join(buildDir, "standalone");
  const startTime = Date.now();

  logDeploy(`Building into ${slot} slot...`);

  // Step 1: Git pull
  if (!runCommand(["git", "fetch", "origin"], PROJECT_ROOT, "git fetch")) {
    return false;
  }
  if (
    !runCommand(
      ["git", "merge", "--ff-only", "origin/master"],
      PROJECT_ROOT,
      "git merge --ff-only origin/main"
    )
  ) {
    return false;
  }

  // Step 2: Install dependencies
  if (
    !runCommand(
      ["bun", "install", "--frozen-lockfile"],
      PROJECT_ROOT,
      "bun install"
    )
  ) {
    return false;
  }

  // Step 3: Build Next.js
  if (!runCommand(["bun", "run", "build"], PROJECT_ROOT, "bun run build")) {
    return false;
  }

  // Step 4: Copy build output to slot directory
  logDeploy(`Copying build to ${slot} slot...`);

  // Clean previous build in this slot
  if (existsSync(standaloneDir)) {
    rmSync(standaloneDir, { recursive: true, force: true });
  }
  mkdirSync(standaloneDir, { recursive: true });

  // Copy .next/standalone
  const srcStandalone = join(PROJECT_ROOT, ".next", "standalone");
  if (!existsSync(srcStandalone)) {
    logError("No .next/standalone directory found after build");
    return false;
  }
  cpSync(srcStandalone, standaloneDir, { recursive: true });

  // Copy static assets into standalone
  const srcStatic = join(PROJECT_ROOT, ".next", "static");
  const destStatic = join(standaloneDir, ".next", "static");
  if (existsSync(srcStatic)) {
    cpSync(srcStatic, destStatic, { recursive: true });
  }

  // Copy public directory
  const srcPublic = join(PROJECT_ROOT, "public");
  const destPublic = join(standaloneDir, "public");
  if (existsSync(srcPublic)) {
    cpSync(srcPublic, destPublic, { recursive: true });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logDeploy(`Build completed in ${elapsed}s (commit: ${getGitCommit()})`);

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database migration (runs between stop and start for safety)
// ─────────────────────────────────────────────────────────────────────────────

function runMigration(): boolean {
  logDeploy("Running database migration...");
  const prodDatabaseUrl = `file:${join(DATA_DIR, "sqlite.db")}`;
  const result = spawnSync(["bun", "run", "db:push"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: prodDatabaseUrl },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    logError("Database migration failed");
    return false;
  }
  logDeploy("Database migration completed");
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health checks
// ─────────────────────────────────────────────────────────────────────────────

function waitForSocket(
  socketPath: string,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (existsSync(socketPath)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function httpGetOverSocket(
  socketPath: string,
  path: string,
  headers?: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        socketPath,
        path,
        headers: { host: "localhost", ...headers },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      }
    );
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

async function healthCheckLocal(): Promise<boolean> {
  logDeploy("Health check: waiting for sockets...");

  // Wait for sockets to appear
  const [nextReady, terminalReady] = await Promise.all([
    waitForSocket(NEXTJS_SOCKET, HEALTH_CHECK_TIMEOUT_MS),
    waitForSocket(TERMINAL_SOCKET, HEALTH_CHECK_TIMEOUT_MS),
  ]);

  if (!nextReady) {
    logError("Health check failed: Next.js socket not ready");
    return false;
  }
  if (!terminalReady) {
    logError("Health check failed: Terminal socket not ready");
    return false;
  }

  logDeploy("Health check: sockets ready, checking HTTP...");

  // Wait for HTTP to respond
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Read local API key for authenticated request
      const keyFile = join(DATA_DIR, "rdv", ".local-key");
      const apiKey = existsSync(keyFile)
        ? readFileSync(keyFile, "utf-8").trim()
        : "";

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const result = await httpGetOverSocket(
        NEXTJS_SOCKET,
        "/api/sessions",
        headers
      );

      if (result.statusCode === 200) {
        // Verify we got valid JSON with no errors
        try {
          const data = JSON.parse(result.body);
          if (Array.isArray(data) || (data && !data.error)) {
            logDeploy(
              `Health check: local HTTP OK (${result.statusCode})`
            );
            return true;
          }
          logError(
            `Health check: API returned error: ${JSON.stringify(data.error)}`
          );
        } catch {
          logError("Health check: invalid JSON response from /api/sessions");
        }
      } else if (result.statusCode === 401) {
        // Auth issue — the server is up but we can't authenticate.
        // This is OK for liveness, the API key may not be provisioned yet.
        logDeploy(
          `Health check: local HTTP responding (${result.statusCode}, auth pending)`
        );
        return true;
      } else {
        logDeploy(
          `Health check: got ${result.statusCode}, retrying...`
        );
      }
    } catch {
      // Connection refused or timeout — server still starting
    }

    await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  logError("Health check failed: local HTTP not responding");
  return false;
}

async function healthCheckExternal(): Promise<boolean> {
  logDeploy(`Health check: checking external URL ${EXTERNAL_URL}...`);

  const deadline = Date.now() + 30_000; // 30s for external
  while (Date.now() < deadline) {
    try {
      const keyFile = join(DATA_DIR, "rdv", ".local-key");
      const apiKey = existsSync(keyFile)
        ? readFileSync(keyFile, "utf-8").trim()
        : "";

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${EXTERNAL_URL}/api/sessions`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        // CF Access may return a 200 HTML login page instead of JSON.
        // Check content-type to distinguish.
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (Array.isArray(data) || (data && !data.error)) {
            logDeploy(
              `Health check: external URL OK (${response.status})`
            );
            return true;
          }
          logError(
            `Health check: external API returned error: ${JSON.stringify(data.error)}`
          );
        } else {
          // Got a response (likely CF Access login page) — server is reachable
          logDeploy(
            `Health check: external URL reachable (${response.status}, CF Access intercepted)`
          );
          return true;
        }
      } else if (response.status === 401 || response.status === 403) {
        // CF Access blocking our request — server is reachable
        logDeploy(
          `Health check: external URL reachable (${response.status}, CF Access blocking)`
        );
        return true;
      } else {
        logDeploy(
          `Health check: external got ${response.status}, retrying...`
        );
      }
    } catch (err) {
      logDeploy(
        `Health check: external URL not reachable (${err instanceof Error ? err.message : String(err)}), retrying...`
      );
    }

    await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  logError("Health check failed: external URL not reachable");
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy orchestration
// ─────────────────────────────────────────────────────────────────────────────

async function deploy(): Promise<void> {
  ensureDirs();

  if (!acquireLock()) {
    process.exit(1);
  }

  try {
    const state = readDeployState();
    const activeSlot = state?.activeSlot || "blue";
    const inactiveSlot: Slot = activeSlot === "blue" ? "green" : "blue";
    const previousCommit = state?.activeCommit || getGitCommitFull();

    logDeploy(`=== Deploy started ===`);
    logDeploy(`Active slot: ${activeSlot}, building into: ${inactiveSlot}`);

    // Build into inactive slot
    if (!buildSlot(inactiveSlot)) {
      logError("Build failed, aborting deploy");
      releaseLock();
      process.exit(1);
    }

    const newCommit = getGitCommitFull();
    logDeploy(`Swapping from ${activeSlot} to ${inactiveSlot}...`);

    // Stop current servers
    stopCurrentServers();

    // Run database migration while servers are stopped (safe: no running code using old schema)
    if (!runMigration()) {
      logError("Migration failed, restarting previous slot...");
      await rollbackTo(activeSlot);
      releaseLock();
      process.exit(1);
    }

    // Start new servers from the new slot's build
    const started = await startServers(inactiveSlot);
    if (!started) {
      logError("Failed to start new servers, rolling back...");
      await rollbackTo(activeSlot);
      releaseLock();
      process.exit(1);
    }

    // Local health check
    const localHealthy = await healthCheckLocal();
    if (!localHealthy) {
      logError("Local health check failed, rolling back...");
      stopCurrentServers();
      await rollbackTo(activeSlot);
      releaseLock();
      process.exit(1);
    }

    // External health check
    const externalHealthy = await healthCheckExternal();
    if (!externalHealthy) {
      logError("External health check failed, rolling back...");
      stopCurrentServers();
      await rollbackTo(activeSlot);
      releaseLock();
      process.exit(1);
    }

    // Update deploy state
    writeDeployState({
      activeSlot: inactiveSlot,
      activeCommit: newCommit,
      deployedAt: new Date().toISOString(),
      previousSlot: activeSlot,
      previousCommit: previousCommit,
    });

    logDeploy(
      `=== Deploy successful === (${activeSlot} -> ${inactiveSlot}, commit: ${getGitCommit()})`
    );
  } finally {
    releaseLock();
  }
}

async function rollbackTo(slot: Slot): Promise<void> {
  logDeploy(`Rolling back to ${slot} slot...`);

  const started = await startServers(slot);
  if (!started) {
    logError(`CRITICAL: Rollback to ${slot} failed! Manual intervention needed.`);
    return;
  }

  const localHealthy = await healthCheckLocal();
  if (localHealthy) {
    logDeploy(`Rollback to ${slot} successful`);
  } else {
    logError(`CRITICAL: Rollback health check failed! Manual intervention needed.`);
  }
}

async function rollback(): Promise<void> {
  ensureDirs();

  const state = readDeployState();
  if (!state) {
    logError("No deploy state found, cannot rollback");
    process.exit(1);
  }

  if (!acquireLock()) {
    process.exit(1);
  }

  try {
    logDeploy(`=== Rollback started ===`);
    logDeploy(
      `Rolling back from ${state.activeSlot} to ${state.previousSlot} (commit: ${state.previousCommit.slice(0, 7)})`
    );

    stopCurrentServers();
    await rollbackTo(state.previousSlot);

    // Swap state
    writeDeployState({
      activeSlot: state.previousSlot,
      activeCommit: state.previousCommit,
      deployedAt: new Date().toISOString(),
      previousSlot: state.activeSlot,
      previousCommit: state.activeCommit,
    });

    logDeploy(`=== Rollback complete ===`);
  } finally {
    releaseLock();
  }
}

function showStatus(): void {
  const state = readDeployState();
  if (!state) {
    console.log("No deploy state found. Run with --init to initialize.");
    return;
  }

  console.log("\nDeploy Status");
  console.log("─".repeat(50));
  console.log(`  Active Slot:     ${state.activeSlot}`);
  console.log(`  Active Commit:   ${state.activeCommit.slice(0, 7)}`);
  console.log(`  Deployed At:     ${state.deployedAt}`);
  console.log(`  Previous Slot:   ${state.previousSlot}`);
  console.log(`  Previous Commit: ${state.previousCommit.slice(0, 7) || "(none)"}`);
  console.log(
    `  Blue Build:      ${existsSync(join(BUILDS_DIR, "blue", "standalone")) ? "exists" : "empty"}`
  );
  console.log(
    `  Green Build:     ${existsSync(join(BUILDS_DIR, "green", "standalone")) ? "exists" : "empty"}`
  );

  const lockExists = existsSync(LOCK_FILE);
  if (lockExists) {
    const lockPid = readFileSync(LOCK_FILE, "utf-8").trim();
    console.log(`  Lock:            held by PID ${lockPid}`);
  } else {
    console.log(`  Lock:            free`);
  }
  console.log();
}

async function init(): Promise<void> {
  ensureDirs();

  const existing = readDeployState();
  if (existing) {
    console.log("Deploy state already exists. Current state:");
    showStatus();
    return;
  }

  const commit = getGitCommitFull();

  // Copy current build into blue slot
  const srcStandalone = join(PROJECT_ROOT, ".next", "standalone");
  const blueDir = join(BUILDS_DIR, "blue", "standalone");

  if (existsSync(srcStandalone)) {
    logDeploy("Copying current build into blue slot...");
    if (existsSync(blueDir)) {
      rmSync(blueDir, { recursive: true, force: true });
    }
    mkdirSync(blueDir, { recursive: true });
    cpSync(srcStandalone, blueDir, { recursive: true });

    // Copy static assets
    const srcStatic = join(PROJECT_ROOT, ".next", "static");
    const destStatic = join(blueDir, ".next", "static");
    if (existsSync(srcStatic)) {
      cpSync(srcStatic, destStatic, { recursive: true });
    }

    // Copy public
    const srcPublic = join(PROJECT_ROOT, "public");
    const destPublic = join(blueDir, "public");
    if (existsSync(srcPublic)) {
      cpSync(srcPublic, destPublic, { recursive: true });
    }
  }

  writeDeployState({
    activeSlot: "blue",
    activeCommit: commit,
    deployedAt: new Date().toISOString(),
    previousSlot: "green",
    previousCommit: "",
  });

  logDeploy(`Deploy state initialized (blue slot, commit: ${commit.slice(0, 7)})`);
  showStatus();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--rollback")) {
  await rollback();
} else if (args.includes("--status")) {
  showStatus();
} else if (args.includes("--init")) {
  await init();
} else {
  await deploy();
}
