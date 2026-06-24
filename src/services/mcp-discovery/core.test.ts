// @vitest-environment node
/**
 * Tests for `src/services/mcp-discovery/core.ts` — specifically the stdio
 * discovery process-group teardown (remote-dev-31cn).
 *
 * Regression context: `discoverViaStdio` spawns an MCP server as a child
 * process (in prod typically `npx tsx peer-server.ts`). The previous
 * `child.kill("SIGTERM")` was INEFFECTIVE for two compounding reasons:
 *   1. The spawn was not `detached`, and `child` was the `npx`/`npm exec`
 *      wrapper, which does NOT forward signals to its node grandchild.
 *   2. The real server traps/ignores SIGTERM — only SIGKILL (or a
 *      process-group kill) terminated it.
 * Net effect: every stdio discovery call leaked the full process tree.
 *
 * These tests use REAL OS processes (not mocks) so they prove the spawned
 * process is actually dead after `discoverViaStdio` settles. We assert death
 * via `process.kill(pid, 0)` throwing ESRCH (the OS ground truth) rather than
 * "a mock was called".
 *
 * To exercise the SIGTERM-resistant case faithfully, each stub server installs
 * a no-op SIGTERM handler and keeps a long-lived timer — so ONLY the
 * process-group SIGKILL escalation can reap it. If the fix regressed to a plain
 * `child.kill("SIGTERM")`, the liveness assertion would fail (the process would
 * still be alive past the grace window).
 *
 * Each stub records its own pid to a sidecar file on startup so the test can
 * assert on the exact process discovery spawned, without fragile global scans.
 */

import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverViaStdio, type MCPServerConfig } from "./core";

/** Prologue every stub uses to ignore SIGTERM and record its pid. */
function preamble(pidFile: string): string {
  return [
    `process.on("SIGTERM", () => {/* ignore — only SIGKILL stops us */});`,
    // Keep the event loop alive effectively forever.
    `const __keepAlive = setInterval(() => {}, 1 << 30);`,
    // Record our own pid so the test knows exactly who to watch.
    `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
  ].join("\n");
}

/**
 * A minimal MCP-over-stdio server that answers `initialize`, `tools/list`, and
 * `resources/list` so the happy path of `discoverViaStdio` resolves.
 */
function responsiveServer(pidFile: string): string {
  return `
${preamble(pidFile)}
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === undefined) continue; // notification — no reply
    let result;
    if (msg.method === "initialize") {
      result = { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "stub", version: "1.0.0" } };
    } else if (msg.method === "tools/list") {
      result = { tools: [{ name: "stub_tool", description: "a tool" }] };
    } else if (msg.method === "resources/list") {
      result = { resources: [] };
    } else {
      result = {};
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
  }
});
`;
}

/**
 * A stub that NEVER responds — used to drive the timeout path. It ignores
 * SIGTERM and stays alive so we can prove the timeout teardown reaps it via the
 * SIGKILL escalation.
 */
function unresponsiveServer(pidFile: string): string {
  return `
${preamble(pidFile)}
process.stdin.resume();
`;
}

/** True if a process with `pid` still exists; false once it's gone (ESRCH). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    // EPERM means the process exists but we can't signal it — still "alive".
    return true;
  }
}

/** Poll until `pid` is gone or the deadline elapses. */
async function waitUntilDead(pid: number, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

/** Poll until `path` exists or the deadline elapses. */
async function waitForFile(path: string, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return existsSync(path);
}

interface Stub {
  config: MCPServerConfig;
  /**
   * Resolve the pid the stub recorded for itself. Waits for the sidecar file to
   * appear first, because with a short discovery timeout the teardown can race
   * cold node startup — the stub may not have written its pid yet when we read.
   */
  readPid: () => Promise<number>;
  cleanup: () => void;
}

function makeStub(makeSource: (pidFile: string) => string): Stub {
  const dir = mkdtempSync(join(tmpdir(), "mcp-discovery-test-"));
  const scriptPath = join(dir, "stub-server.cjs");
  const pidFile = join(dir, "stub.pid");
  writeFileSync(scriptPath, makeSource(pidFile));
  return {
    config: {
      command: process.execPath, // node
      args: [scriptPath],
      env: {},
    },
    readPid: async () => {
      const appeared = await waitForFile(pidFile);
      if (!appeared) throw new Error(`stub pid file never appeared: ${pidFile}`);
      return Number(readFileSync(pidFile, "utf8").trim());
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("discoverViaStdio process-group teardown (remote-dev-31cn)", () => {
  it("kills the SIGTERM-ignoring child after a SUCCESSFUL discovery", async () => {
    const stub = makeStub(responsiveServer);
    try {
      const result = await discoverViaStdio(stub.config, 5000);
      expect(result.tools.map((t) => t.name)).toContain("stub_tool");

      const pid = await stub.readPid();
      expect(Number.isInteger(pid)).toBe(true);

      // The child ignored SIGTERM, so only the SIGKILL escalation (~2s grace)
      // can reap it. Allow margin beyond the grace window.
      const dead = await waitUntilDead(pid, 6000);
      expect(dead).toBe(true);
    } finally {
      stub.cleanup();
    }
  }, 15000);

  it("kills the SIGTERM-ignoring child after a TIMEOUT", async () => {
    const stub = makeStub(unresponsiveServer);
    try {
      // Short timeout so the test is fast, but long enough to clear cold node
      // startup so the stub reliably reaches its keep-alive state (the unhappy
      // path we want to exercise) rather than being killed mid-boot.
      await expect(discoverViaStdio(stub.config, 1500)).rejects.toThrow(/timeout/i);

      const pid = await stub.readPid();
      expect(Number.isInteger(pid)).toBe(true);

      const dead = await waitUntilDead(pid, 6000);
      expect(dead).toBe(true);
    } finally {
      stub.cleanup();
    }
  }, 15000);
});
