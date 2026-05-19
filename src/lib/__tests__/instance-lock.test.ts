/**
 * Tests for `src/lib/instance-lock.ts`.
 *
 * The module reads `getDataDir()` lazily inside `acquireInstanceLock()`,
 * so we can swap `RDV_DATA_DIR` to a per-test tmpdir without `vi.resetModules`.
 *
 * We hand-craft lock files in the expected JSON format to simulate
 * cross-pod / cross-host scenarios that can't be reproduced by simply
 * running `acquireInstanceLock()` twice.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetInstanceLockForTests,
  acquireInstanceLock,
  releaseInstanceLock,
} from "../instance-lock";

const ORIGINAL_DATA_DIR = process.env.RDV_DATA_DIR;

let testDir: string;
let lockPath: string;

interface LockRecord {
  pid: number;
  hostname: string;
  startedAt: string;
  writerNonce: string;
}

function writeLock(record: LockRecord): void {
  writeFileSync(lockPath, JSON.stringify(record), { mode: 0o600 });
}

function readLock(): LockRecord {
  return JSON.parse(readFileSync(lockPath, "utf-8")) as LockRecord;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "rdv-lock-test-"));
  lockPath = join(testDir, "instance.lock");
  process.env.RDV_DATA_DIR = testDir;
  // Make sure no prior test leaked a lock into this module instance.
  __resetInstanceLockForTests();
});

afterEach(() => {
  releaseInstanceLock();
  __resetInstanceLockForTests();
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.RDV_DATA_DIR;
  } else {
    process.env.RDV_DATA_DIR = ORIGINAL_DATA_DIR;
  }
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("instance-lock — basic acquire/release", () => {
  it("creates the lock file with our PID + hostname on acquire", () => {
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(true);
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
    expect(typeof record.startedAt).toBe("string");
    expect(typeof record.writerNonce).toBe("string");
    expect(record.writerNonce.length).toBeGreaterThan(0);
  });

  it("is idempotent within the same process", () => {
    acquireInstanceLock();
    const firstNonce = readLock().writerNonce;
    // Second call must not throw or rewrite a different record.
    expect(() => acquireInstanceLock()).not.toThrow();
    expect(readLock().writerNonce).toBe(firstNonce);
  });

  it("releases the lock cleanly, allowing re-acquisition", () => {
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(true);
    releaseInstanceLock();
    expect(existsSync(lockPath)).toBe(false);
    expect(() => acquireInstanceLock()).not.toThrow();
    expect(existsSync(lockPath)).toBe(true);
  });

  it("release is safe to call multiple times", () => {
    acquireInstanceLock();
    releaseInstanceLock();
    expect(() => releaseInstanceLock()).not.toThrow();
  });
});

describe("instance-lock — stale lock detection", () => {
  it("reclaims a stale lock left behind by a dead PID on the same host", () => {
    // PID 99999999 almost certainly isn't running.
    writeLock({
      pid: 99999999,
      hostname: osHostname(),
      startedAt: new Date().toISOString(),
      writerNonce: "stale-dead-pid",
    });
    expect(() => acquireInstanceLock()).not.toThrow();
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
  });

  it("reclaims a lock with malformed/unreadable JSON", () => {
    writeFileSync(lockPath, "not-valid-json{{{");
    expect(() => acquireInstanceLock()).not.toThrow();
    const record = readLock();
    expect(record.pid).toBe(process.pid);
  });

  it("reclaims a same-host lock that has aged out (>5 min)", () => {
    // Use our own PID — which IS alive — but with an old startedAt. The
    // aged-out branch should let us take over because real container
    // restarts on the same node can present this exact pattern (tini-as-1
    // is always alive in a fresh PID namespace).
    writeLock({
      pid: process.pid === 1 ? 2 : 1, // PID 1 (init/tini) is always alive
      hostname: osHostname(),
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
      writerNonce: "stale-by-age",
    });
    expect(() => acquireInstanceLock()).not.toThrow();
    expect(readLock().pid).toBe(process.pid);
  });

  it("reclaims a lock from a different hostname (cross-pod restart)", () => {
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
    expect(() => acquireInstanceLock()).not.toThrow();
    const record = readLock();
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(osHostname());
  });

  it("refuses to start when a same-host PID is alive and recent", () => {
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
    expect(() => acquireInstanceLock()).toThrow(/Instance lock/);
    // The existing record must not have been overwritten.
    expect(readLock()).toEqual(fresh);
  });
});

describe("instance-lock — defensive release", () => {
  it("release does not delete the lock file if its nonce is no longer ours", () => {
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
