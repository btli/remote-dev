// @vitest-environment node
//
// Behavior-split tests for the PURE flock primitive vs the deploy flock
// (remote-dev-7fsq [R14]). The pure `acquireFlock(path)` used by the
// supervision control/foreground locks treats file CONTENT as informational
// only — the kernel flock alone decides ownership. The legacy stale-PID
// backoff (a LIVE foreign PID in the file ⇒ back off as "held") stays ONLY in
// `acquireDeployFlock()` for deploy.lock's transition compat.
//
// deploy-flock imports bun:ffi (unloadable under vitest/node), so these tests
// drive REAL bun subprocesses via tests/fixtures/pure-flock-fixture.ts — the
// same pattern as tests/deploy-flock.test.ts (which stays green unchanged).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(__dirname, "fixtures", "pure-flock-fixture.ts");

let dir: string;
let lockFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rdv-pure-flock-"));
  lockFile = join(dir, "control.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface FixtureResult {
  outcome?: "acquired" | "held";
  ownerPid?: number;
  content?: string;
}

function parseResult(stdout: string): FixtureResult {
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`no RESULT line in fixture output:\n${stdout}`);
  return JSON.parse(line.slice("RESULT ".length)) as FixtureResult;
}

function runFixtureSync(mode: string, env: Record<string, string> = {}): FixtureResult {
  const res = spawnSync("bun", ["run", FIXTURE, mode], {
    encoding: "utf-8",
    env: { ...process.env, LOCK_FILE: lockFile, ...env },
    timeout: 30_000,
  });
  if (res.error) throw res.error;
  return parseResult(res.stdout ?? "");
}

function spawnFixture(mode: string, env: Record<string, string> = {}): ChildProcess {
  return spawn("bun", ["run", FIXTURE, mode], {
    env: { ...process.env, LOCK_FILE: lockFile, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForResult(child: ChildProcess): Promise<FixtureResult> {
  return new Promise((resolve, reject) => {
    let buf = "";
    child.stdout?.on("data", (c: Buffer) => {
      buf += c.toString();
      const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
      if (line) resolve(JSON.parse(line.slice("RESULT ".length)) as FixtureResult);
    });
    child.on("error", reject);
    child.on("exit", () => {
      const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
      if (line) resolve(JSON.parse(line.slice("RESULT ".length)) as FixtureResult);
      else reject(new Error(`fixture exited with no RESULT line:\n${buf}`));
    });
  });
}

describe("pure flock — content is informational, never a liveness signal [R14]", () => {
  it("acquires despite a pre-written LIVE foreign PID (no stale-PID backoff)", () => {
    // Seed the lock file with OUR pid — a demonstrably LIVE foreign process.
    // The legacy deploy-lock protocol would back off; the pure primitive must
    // acquire anyway (the kernel flock is free) and overwrite the pid.
    writeFileSync(lockFile, `${process.pid}\n`);
    const result = runFixtureSync("pure");
    expect(result.outcome).toBe("acquired");
    expect(parseInt((result.content ?? "").trim(), 10)).toBe(result.ownerPid);
  });

  it("...while acquireDeployFlock KEEPS the legacy backoff on the same content (the split)", () => {
    writeFileSync(lockFile, `${process.pid}\n`);
    const result = runFixtureSync("deploy");
    // Same file, same live foreign PID: the deploy path respects it ⇒ held.
    expect(result.outcome).toBe("held");
  });

  it("contends on the kernel flock: a live holder blocks a second acquirer", async () => {
    const holder = spawnFixture("pure", { HOLD_MS: "2000" });
    const held = await waitForResult(holder);
    expect(held.outcome).toBe("acquired");

    const contender = runFixtureSync("pure");
    expect(contender.outcome).toBe("held");

    await new Promise<void>((r) => holder.on("exit", () => r()));
    expect(runFixtureSync("pure").outcome).toBe("acquired");
  });

  it("release never unlinks: the permanent inode survives and is reused", () => {
    const first = runFixtureSync("pure");
    expect(first.outcome).toBe("acquired");
    expect(existsSync(lockFile)).toBe(true);
    const ino = statSync(lockFile).ino;
    const second = runFixtureSync("pure");
    expect(second.outcome).toBe("acquired");
    expect(statSync(lockFile).ino).toBe(ino);
    // The leftover content names the (now dead) last holder — informational.
    expect(parseInt(readFileSync(lockFile, "utf-8").trim(), 10)).toBe(second.ownerPid);
  });
});
