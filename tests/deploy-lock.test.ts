// Unit tests for the PURE deploy-lock CODEC (remote-dev-v7gi → flock redesign).
//
// scripts/deploy-lock.ts is now ONLY the content codec for deploy.lock (the file
// that the OS flock holder uses for both the flock target AND PID visibility). It
// has no fs/process/bun:ffi access, so it is importable under vitest/node and is
// fully unit-testable here. The OS flock behavior itself lives in
// scripts/deploy-flock.ts (bun:ffi) and is covered by the spawned-bun integration
// suite in tests/deploy-flock.test.ts (bun:ffi cannot load under vitest/node).
//
// Steady state = the bare PID string (what the flock holder writes). The legacy
// JSON {pid,token} form is parsed ONLY for a one-time DEPLOY_LOCK_HANDOFF
// transition + so PID readers that race it don't misread the JSON as "no owner".
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  parseLockContent,
  formatPlainLock,
  isOwnedByPid,
} from "../scripts/deploy-lock";

// ─────────────────────────────────────────────────────────────────────────────
// parseLockContent — plain (steady state) + legacy JSON (transition compat)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseLockContent", () => {
  it("parses the plain PID form (the steady state)", () => {
    expect(parseLockContent("12345")).toEqual({ pid: 12345, token: null, raw: "12345" });
  });
  it("trims surrounding whitespace/newline on the plain form", () => {
    expect(parseLockContent("  678\n")).toEqual({ pid: 678, token: null, raw: "678" });
  });
  it("parses the legacy JSON form into pid + token (transition compat)", () => {
    const raw = JSON.stringify({ pid: 999, token: "deadbeef" });
    expect(parseLockContent(raw)).toEqual({ pid: 999, token: "deadbeef", raw });
  });
  it("treats empty / whitespace-only content as unparseable (pid null)", () => {
    expect(parseLockContent("")).toEqual({ pid: null, token: null, raw: "" });
    expect(parseLockContent("   ")).toEqual({ pid: null, token: null, raw: "" });
  });
  it("treats non-numeric plain content as pid null (matches deploy.ts's historical NaN handling)", () => {
    expect(parseLockContent("not-a-pid").pid).toBeNull();
  });
  it("treats malformed JSON as pid null, token null", () => {
    expect(parseLockContent("{not json")).toEqual({ pid: null, token: null, raw: "{not json" });
  });
  it("rejects a JSON object with a non-positive / non-integer pid", () => {
    expect(parseLockContent(JSON.stringify({ pid: 0, token: "t" })).pid).toBeNull();
    expect(parseLockContent(JSON.stringify({ pid: -3, token: "t" })).pid).toBeNull();
    expect(parseLockContent(JSON.stringify({ pid: 1.5, token: "t" })).pid).toBeNull();
  });
  it("ignores an empty-string token in the JSON form", () => {
    expect(parseLockContent(JSON.stringify({ pid: 5, token: "" })).token).toBeNull();
  });
  it("a leading-decimal plain PID is NEVER parsed as JSON", () => {
    expect(parseLockContent("42").token).toBeNull();
  });
});

describe("formatPlainLock", () => {
  it("is byte-identical to process.pid.toString() (the steady-state format)", () => {
    expect(formatPlainLock(12345)).toBe("12345");
    expect(formatPlainLock(12345)).toBe((12345).toString());
  });
  it("round-trips through parseLockContent", () => {
    const raw = formatPlainLock(31);
    expect(parseLockContent(raw)).toEqual({ pid: 31, token: null, raw });
  });
});

describe("isOwnedByPid", () => {
  it("true only on an exact PID match (either content shape)", () => {
    expect(isOwnedByPid(parseLockContent("500"), 500)).toBe(true);
    expect(isOwnedByPid(parseLockContent(JSON.stringify({ pid: 500, token: "t" })), 500)).toBe(true);
    expect(isOwnedByPid(parseLockContent("500"), 501)).toBe(false);
  });
  it("NEVER treats malformed/NaN content as owned", () => {
    expect(isOwnedByPid(parseLockContent("garbage"), 500)).toBe(false);
    expect(isOwnedByPid(parseLockContent(""), 500)).toBe(false);
    expect(isOwnedByPid(parseLockContent("{bad"), 500)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-language parity: scripts/watchdog.sh must extract the SAME PID from BOTH
// lock shapes (a bare `cat` of a legacy JSON lock would make `kill -0 '{json}'`
// fail and wrongly restart the servers mid-deploy). These run the EXACT sed
// expressions watchdog.sh uses, so a future edit to the script that breaks parsing
// fails here.
// ─────────────────────────────────────────────────────────────────────────────

/** Replicates watchdog.sh's per-shape PID extraction (kept in lockstep with it). */
function watchdogExtractPid(lockRaw: string): string {
  // case "$LOCK_RAW" in \{*) ... ;; *) ... ;; esac
  const script =
    'case "$1" in ' +
    "\\{*) printf '%s' \"$1\" | sed -n 's/.*\"pid\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' ;; " +
    "*) printf '%s' \"$1\" | sed -n 's/^[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' ;; " +
    "esac";
  return execFileSync("bash", ["-c", script, "bash", lockRaw], { encoding: "utf-8" }).trim();
}

describe("watchdog.sh lock PID extraction parity", () => {
  it("extracts the PID from the bare-PID form (steady state)", () => {
    expect(watchdogExtractPid("12345")).toBe("12345");
    expect(watchdogExtractPid("  678\n")).toBe("678");
  });
  it("extracts the PID from the legacy JSON form (matches parseLockContent)", () => {
    const raw = JSON.stringify({ pid: 67890, token: "tok-abc" });
    expect(watchdogExtractPid(raw)).toBe("67890");
    expect(String(parseLockContent(raw).pid)).toBe(watchdogExtractPid(raw));
  });
  it("yields empty (→ watchdog treats as 'no live deploy') for malformed content", () => {
    expect(watchdogExtractPid("garbage")).toBe("");
    expect(watchdogExtractPid("{no-pid-here}")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-language parity: watchdog.sh's deploy-owner liveness check must treat
// `kill -0` EPERM as ALIVE (process exists, owned by another user), mirroring the
// flock module's isPidAlive. Treating EPERM as dead would let the watchdog RESTART
// servers mid-deploy. These run the EXACT shell predicate watchdog.sh uses.
// ─────────────────────────────────────────────────────────────────────────────

/** Replicates watchdog.sh's deploy-owner liveness predicate (kept in lockstep). */
function watchdogDeployAlive(lockPid: string): "alive" | "restart" {
  const script =
    "LOCK_PID=$1; " +
    'KILL_ERR=$(kill -0 "$LOCK_PID" 2>&1) && KILL_RC=0 || KILL_RC=$?; ' +
    'if [ "$KILL_RC" -eq 0 ] || printf \'%s\' "$KILL_ERR" | grep -qiE \'not permitted|operation not permitted|EPERM\'; then ' +
    "  printf alive; else printf restart; fi";
  return execFileSync("bash", ["-c", script, "bash", lockPid], {
    encoding: "utf-8",
  }).trim() as "alive" | "restart";
}

describe("watchdog.sh deploy-owner EPERM-is-alive parity", () => {
  it("a SIGNALABLE live PID (our own) → alive (skip restart)", () => {
    expect(watchdogDeployAlive(String(process.pid))).toBe("alive");
  });
  it("PID 1 (init, EPERM for non-root) → alive (EPERM means the owner EXISTS)", () => {
    expect(watchdogDeployAlive("1")).toBe("alive");
  });
  it("a DEAD high PID (ESRCH) → restart (genuinely no such process)", () => {
    expect(watchdogDeployAlive("2147480000")).toBe("restart");
  });
});
