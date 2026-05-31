/**
 * Tests for `src/lib/instance-lock.ts`.
 *
 * The lock only engages in multi-instance mode (non-empty `RDV_BASE_PATH`) or
 * when `RDV_FORCE_INSTANCE_LOCK=1`. `BASE_PATH` is read once at
 * `src/lib/base-path.ts` load, so to exercise both modes we set
 * `RDV_BASE_PATH` BEFORE a fresh dynamic import via `vi.resetModules()` (same
 * approach as `base-path.test.ts`). `loadLock()` returns a fresh
 * `instance-lock` module bound to the requested env.
 *
 * `RDV_DATA_DIR` is still swapped to a per-test tmpdir. We hand-craft lock
 * files in the expected JSON format to simulate cross-pod / cross-host
 * scenarios that can't be reproduced by simply running `acquireInstanceLock()`
 * twice.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_DATA_DIR = process.env.RDV_DATA_DIR;
const ORIGINAL_BASE_PATH = process.env.RDV_BASE_PATH;
const ORIGINAL_FORCE_LOCK = process.env.RDV_FORCE_INSTANCE_LOCK;

let testDir: string;
let lockPath: string;

interface LockRecord {
  pid: number;
  hostname: string;
  startedAt: string;
  writerNonce: string;
}

type InstanceLockModule = typeof import("../instance-lock");

function writeLock(record: LockRecord): void {
  writeFileSync(lockPath, JSON.stringify(record), { mode: 0o600 });
}

function readLock(): LockRecord {
  return JSON.parse(readFileSync(lockPath, "utf-8")) as LockRecord;
}

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

/**
 * Load a fresh `instance-lock` module after setting the lock-mode env vars.
 * `basePath` controls multi-instance vs single-host; `forceLock` toggles the
 * `RDV_FORCE_INSTANCE_LOCK` escape hatch. Both are read at module load.
 */
async function loadLock(opts: {
  basePath?: string;
  forceLock?: boolean;
}): Promise<InstanceLockModule> {
  vi.resetModules();
  if (opts.basePath === undefined) delete process.env.RDV_BASE_PATH;
  else process.env.RDV_BASE_PATH = opts.basePath;
  if (opts.forceLock) process.env.RDV_FORCE_INSTANCE_LOCK = "1";
  else delete process.env.RDV_FORCE_INSTANCE_LOCK;
  const mod = await import("../instance-lock");
  mod.__resetInstanceLockForTests();
  return mod;
}

// Each fresh `instance-lock` module (one per `loadLock()`) registers its own
// process `exit` / `uncaughtException` listeners on first successful acquire.
// Across many cases these would accumulate and trip Node's
// MaxListenersExceededWarning, so we snapshot the baseline and prune anything
// the module-under-test added after each case.
const baselineListeners = {
  exit: process.listeners("exit"),
  uncaughtException: process.listeners("uncaughtException"),
};

function pruneAddedProcessListeners(): void {
  for (const l of process.listeners("exit")) {
    if (!baselineListeners.exit.includes(l)) process.off("exit", l);
  }
  for (const l of process.listeners("uncaughtException")) {
    if (!baselineListeners.uncaughtException.includes(l)) process.off("uncaughtException", l);
  }
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "rdv-lock-test-"));
  lockPath = join(testDir, "instance.lock");
  process.env.RDV_DATA_DIR = testDir;
});

afterEach(() => {
  restoreEnv("RDV_DATA_DIR", ORIGINAL_DATA_DIR);
  restoreEnv("RDV_BASE_PATH", ORIGINAL_BASE_PATH);
  restoreEnv("RDV_FORCE_INSTANCE_LOCK", ORIGINAL_FORCE_LOCK);
  pruneAddedProcessListeners();
  vi.resetModules();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("instance-lock — single-host mode (empty RDV_BASE_PATH)", () => {
  it("acquire is a no-op: writes no lock file", async () => {
    const { acquireInstanceLock } = await loadLock({ basePath: "" });
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("does NOT throw even when a live-looking lock file already exists (no deadlock)", async () => {
    // This is the prod deadlock scenario: the watchdog restart spawns a new
    // server while the old one's lock is still present with a live PID. In
    // single-host mode this MUST NOT refuse to start.
    writeLock({
      pid: process.pid === 1 ? 2 : 1, // PID 1 (init) is guaranteed alive
      hostname: osHostname(),
      startedAt: new Date().toISOString(), // fresh — would block in multi-instance
      writerNonce: "live-but-single-host",
    });
    const { acquireInstanceLock } = await loadLock({ basePath: "" });
    expect(() => acquireInstanceLock()).not.toThrow();
    // The pre-existing file is left untouched — we never read or write it.
    expect(readLock().writerNonce).toBe("live-but-single-host");
  });

  it("release is a harmless no-op when nothing was acquired", async () => {
    const { acquireInstanceLock, releaseInstanceLock } = await loadLock({ basePath: "" });
    acquireInstanceLock();
    expect(() => releaseInstanceLock()).not.toThrow();
  });

  it("engages when RDV_FORCE_INSTANCE_LOCK=1 even with no basePath", async () => {
    const { acquireInstanceLock } = await loadLock({ basePath: "", forceLock: true });
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(true);
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
  });

  it("forced lock still refuses a live same-host conflict", async () => {
    const otherPid = process.pid === 1 ? 2 : 1;
    const fresh: LockRecord = {
      pid: otherPid,
      hostname: osHostname(),
      startedAt: new Date().toISOString(),
      writerNonce: "forced-live-conflict",
    };
    writeLock(fresh);
    const { acquireInstanceLock } = await loadLock({ basePath: "", forceLock: true });
    expect(() => acquireInstanceLock()).toThrow(/Instance lock/);
    expect(readLock()).toEqual(fresh);
  });
});

describe("instance-lock — multi-instance basic acquire/release (RDV_BASE_PATH set)", () => {
  it("creates the lock file with our PID + hostname on acquire", async () => {
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(true);
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
    expect(typeof record.startedAt).toBe("string");
    expect(typeof record.writerNonce).toBe("string");
    expect(record.writerNonce.length).toBeGreaterThan(0);
  });

  it("is idempotent within the same process", async () => {
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    acquireInstanceLock();
    const firstNonce = readLock().writerNonce;
    // Second call must not throw or rewrite a different record.
    expect(() => acquireInstanceLock()).not.toThrow();
    expect(readLock().writerNonce).toBe(firstNonce);
  });

  it("releases the lock cleanly, allowing re-acquisition", async () => {
    const { acquireInstanceLock, releaseInstanceLock } = await loadLock({ basePath: "/alpha" });
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(true);
    releaseInstanceLock();
    expect(existsSync(lockPath)).toBe(false);
    expect(() => acquireInstanceLock()).not.toThrow();
    expect(existsSync(lockPath)).toBe(true);
  });

  it("release is safe to call multiple times", async () => {
    const { acquireInstanceLock, releaseInstanceLock } = await loadLock({ basePath: "/alpha" });
    acquireInstanceLock();
    releaseInstanceLock();
    expect(() => releaseInstanceLock()).not.toThrow();
  });
});

describe("instance-lock — multi-instance stale lock detection (RDV_BASE_PATH set)", () => {
  it("reclaims a stale lock left behind by a dead PID on the same host", async () => {
    // PID 99999999 almost certainly isn't running.
    writeLock({
      pid: 99999999,
      hostname: osHostname(),
      startedAt: new Date().toISOString(),
      writerNonce: "stale-dead-pid",
    });
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    expect(() => acquireInstanceLock()).not.toThrow();
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
  });

  it("reclaims a lock with malformed/unreadable JSON", async () => {
    writeFileSync(lockPath, "not-valid-json{{{");
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    expect(() => acquireInstanceLock()).not.toThrow();
    const record = readLock();
    expect(record.pid).toBe(process.pid);
  });

  it("reclaims a same-host lock that has aged out (>5 min)", async () => {
    // Use a live PID (init) but with an old startedAt. The aged-out branch
    // should let us take over because real container restarts on the same
    // node can present this exact pattern (tini-as-1 is always alive in a
    // fresh PID namespace).
    writeLock({
      pid: process.pid === 1 ? 2 : 1, // PID 1 (init/tini) is always alive
      hostname: osHostname(),
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
      writerNonce: "stale-by-age",
    });
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    expect(() => acquireInstanceLock()).not.toThrow();
    expect(readLock().pid).toBe(process.pid);
  });

  it("reclaims a lock from a different hostname (cross-pod restart)", async () => {
    // K8s scenario: previous pod's terminal server (PID 7 in its PID
    // namespace) crashed without cleanup. New pod starts with a fresh PID
    // namespace; PID 7 may or may not be alive in the new namespace. The
    // hostname differs, so we should always take over.
    writeLock({
      pid: 7,
      hostname: "rdv-alpha-0-previous-incarnation",
      startedAt: new Date().toISOString(), // fresh — would block on same host
      writerNonce: "stale-by-host",
    });
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    expect(() => acquireInstanceLock()).not.toThrow();
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
  });

  it("refuses to start when a same-host PID is alive and recent", async () => {
    // Use a PID guaranteed to be alive (PID 1 = init) and a fresh startedAt.
    // This is the genuine "another rdv is running" case and we must refuse.
    const otherPid = process.pid === 1 ? 2 : 1;
    const fresh: LockRecord = {
      pid: otherPid,
      hostname: osHostname(),
      startedAt: new Date().toISOString(),
      writerNonce: "live-conflict",
    };
    writeLock(fresh);
    const { acquireInstanceLock } = await loadLock({ basePath: "/alpha" });
    expect(() => acquireInstanceLock()).toThrow(/Instance lock/);
    // The existing record must not have been overwritten.
    expect(readLock()).toEqual(fresh);
  });
});

describe("instance-lock — defensive release (RDV_BASE_PATH set)", () => {
  it("release does not delete the lock file if its nonce is no longer ours", async () => {
    const { acquireInstanceLock, releaseInstanceLock } = await loadLock({ basePath: "/alpha" });
    acquireInstanceLock();
    // Simulate another writer winning a TOCTOU race by hand-overwriting
    // the file with a fresh record. `releaseInstanceLock` should NOT
    // unlink it — that would delete the new owner's lock.
    const foreign: LockRecord = {
      pid: 12345,
      hostname: "other-host",
      startedAt: new Date().toISOString(),
      writerNonce: "foreign-nonce",
    };
    writeLock(foreign);

    releaseInstanceLock();
    // File still present, foreign record intact.
    expect(existsSync(lockPath)).toBe(true);
    expect(readLock()).toEqual(foreign);
  });
});
