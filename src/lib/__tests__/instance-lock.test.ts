/**
 * Tests for `src/lib/instance-lock.ts`.
 *
 * The module reads `getDataDir()` lazily inside `acquireInstanceLock()`,
 * so we can swap `RDV_DATA_DIR` to a per-test tmpdir without `vi.resetModules`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireInstanceLock, releaseInstanceLock } from "../instance-lock";

const ORIGINAL_DATA_DIR = process.env.RDV_DATA_DIR;

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "rdv-lock-test-"));
  process.env.RDV_DATA_DIR = testDir;
  // Make sure no prior test leaked a lock into this module instance.
  releaseInstanceLock();
});

afterEach(() => {
  releaseInstanceLock();
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

describe("instance-lock", () => {
  it("creates the lock file with the current PID on acquire", () => {
    const lockPath = join(testDir, "instance.lock");
    acquireInstanceLock();
    expect(existsSync(lockPath)).toBe(true);
    const recordedPid = Number.parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    expect(recordedPid).toBe(process.pid);
  });

  it("is idempotent within the same process", () => {
    acquireInstanceLock();
    // Second call must not throw or rewrite a different PID.
    expect(() => acquireInstanceLock()).not.toThrow();
    const recordedPid = Number.parseInt(
      readFileSync(join(testDir, "instance.lock"), "utf-8").trim(),
      10,
    );
    expect(recordedPid).toBe(process.pid);
  });

  it("reclaims a stale lock left behind by a dead PID", () => {
    const lockPath = join(testDir, "instance.lock");
    // PID 99999999 almost certainly isn't running. We use a sentinel
    // value rather than relying on `process.kill(pid, 0)` returning
    // ESRCH for a specific number.
    writeFileSync(lockPath, "99999999\n");
    expect(() => acquireInstanceLock()).not.toThrow();
    const recordedPid = Number.parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    expect(recordedPid).toBe(process.pid);
  });

  it("throws when another live PID holds the lock", () => {
    // Use our own PID as the "other holder" — guaranteed alive.
    const lockPath = join(testDir, "instance.lock");
    const otherPid = process.pid === 1 ? 2 : 1; // never our pid
    // PID 1 (init) is always alive on POSIX systems and is reliably not us.
    // If we somehow are PID 1 (containers), use 2. Either way, kill(_, 0)
    // returns success and the lock should refuse to be reclaimed.
    writeFileSync(lockPath, `${otherPid}\n`);
    expect(() => acquireInstanceLock()).toThrow(/Instance lock/);
    // Ensure the existing file was NOT overwritten.
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(otherPid));
  });

  it("releases the lock cleanly, allowing re-acquisition", () => {
    const lockPath = join(testDir, "instance.lock");
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
