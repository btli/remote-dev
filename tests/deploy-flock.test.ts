// @vitest-environment node
//
// Integration tests for the OS flock(2) deploy mutex (remote-dev-v7gi flock
// redesign + Codex verify round). scripts/deploy-flock.ts imports bun:ffi, which
// CANNOT load under vitest/node — so these tests orchestrate REAL `bun`
// subprocesses (the fixture tests/fixtures/deploy-flock-fixture.ts) and assert the
// observable behavior:
//
//   1. CONTENTION:   two bun processes contend on one lock → one wins, one "held".
//   2. AUTO-RELEASE: a holder is SIGKILLed (can't release) → the next process
//                    still acquires (the kernel released the flock on death) —
//                    the property that makes the whole userland stale-reclaim
//                    protocol unnecessary.
//   3. FD HANDOFF:   parent acquires, spawns a child with the locked fd as fd 3,
//                    parent closeKeepLocks its own fd → a contender STILL sees the
//                    lock held (the child holds it via the inherited fd), and the
//                    lock file ends up named with the CHILD's pid.
//   4. WRITE ORDER:  writePidInPlace writes bytes (with a trailing "\n" delimiter)
//                    BEFORE truncating (never an empty-file window; a mid-write
//                    crash can't leave a concatenated foreign PID).
//   5. TRANSITION:   a legacy JSON {pid,token} lock + matching DEPLOY_LOCK_HANDOFF
//                    becomes a PLAIN pid under the flock (the one-time compat path).
//   6. PERMANENT FILE: release does NOT unlink deploy.lock; the leftover dead-PID
//                    file persists and the next acquirer reuses the SAME inode.
//   7. FORGED FD:    a DEPLOY_LOCK_FD open to ANOTHER file is REJECTED by adopt
//                    (inode mismatch) → no unlocked deploy (the HIGH finding).
//   8. PRE-ADOPT BARRIER: while the child is blocked BEFORE adopting and the parent
//                    has already dropped its own fd, a contender STILL sees "held" —
//                    proving the inherited fd holds the flock continuously, with no
//                    micro-window before the child actively adopts.
//   9. CREATE-RACE RETRY: ensureLockFilePresent treats a swept-temp ENOENT and a
//                    racer-won EEXIST from linkSync as benign, retryable create
//                    races (it returns with the file present, never throwing) — both
//                    via injected ops (deterministic) AND via a real concurrent two-
//                    process create burst that also age-gate-sweeps the temp dir.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  statSync,
  openSync,
  writeSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Pure codec (no fs/process/bun:ffi) — safe to import directly under vitest/node.
import { parseLockContent } from "../scripts/deploy-lock";

const FIXTURE = join(__dirname, "fixtures", "deploy-flock-fixture.ts");

let dir: string;
let lockFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rdv-flock-"));
  lockFile = join(dir, "deploy.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One parsed `RESULT {...}` line from a fixture's stdout. */
interface FixtureResult {
  outcome?: "acquired" | "held";
  ownerPid?: number;
  content?: string;
  parent?: string;
  child?: string;
  childCode?: number | null;
  finalExists?: boolean;
  order?: string[];
  final?: string;
  forged?: boolean;
  error?: string;
  attempts?: number;
  threw?: string;
}

/** Extract the FIRST `RESULT {...}` JSON line from fixture stdout. */
function parseResult(stdout: string): FixtureResult {
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`no RESULT line in fixture output:\n${stdout}`);
  return JSON.parse(line.slice("RESULT ".length)) as FixtureResult;
}

/** Run the fixture in `mode` synchronously to completion; return its parsed result. */
function runFixtureSync(
  mode: string,
  env: Record<string, string> = {},
): { result: FixtureResult; status: number | null } {
  const res = spawnSync("bun", ["run", FIXTURE, mode], {
    encoding: "utf-8",
    env: { ...process.env, LOCK_FILE: lockFile, ...env },
    timeout: 30_000,
  });
  if (res.error) throw res.error;
  return { result: parseResult(res.stdout ?? ""), status: res.status };
}

/** Spawn the fixture in `mode` as a long-running background process. */
function spawnFixture(mode: string, env: Record<string, string> = {}): ChildProcess {
  return spawn("bun", ["run", FIXTURE, mode], {
    env: { ...process.env, LOCK_FILE: lockFile, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Resolve once a `RESULT {...}` line shows up on the child's stdout. */
function waitForResult(child: ChildProcess): Promise<FixtureResult> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
      if (line) {
        child.stdout?.off("data", onData);
        try {
          resolve(JSON.parse(line.slice("RESULT ".length)) as FixtureResult);
        } catch (err) {
          reject(err);
        }
      }
    };
    child.stdout?.on("data", onData);
    child.on("error", reject);
    child.on("exit", () => {
      const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
      if (line) {
        try {
          resolve(JSON.parse(line.slice("RESULT ".length)) as FixtureResult);
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`fixture exited with no RESULT line:\n${buf}`));
      }
    });
  });
}

describe("deploy flock — basic acquire/release", () => {
  it("a single process acquires the lock and writes its PID", () => {
    const { result, status } = runFixtureSync("acquire");
    expect(status).toBe(0);
    expect(result.outcome).toBe("acquired");
    // The PID file content is the bare PID (steady-state format); trimming drops
    // the trailing "\n" delimiter writePidInPlace now appends.
    expect(result.content?.trim()).toBe(String(result.ownerPid));
    // PERMANENT FILE: release does NOT unlink — the (now dead-PID) file persists.
    expect(existsSync(lockFile)).toBe(true);
    // Its content still trims to the (now-exited) holder PID; readers liveness-check
    // the PID, so a dead PID reads as "not held" and the next acquirer reuses it.
    expect(parseInt(readFileSync(lockFile, "utf-8").trim(), 10)).toBe(result.ownerPid);
  });

  it("a re-acquire after release reuses the SAME permanent inode", () => {
    const first = runFixtureSync("acquire");
    expect(first.result.outcome).toBe("acquired");
    const inoAfterFirst = statSync(lockFile).ino;
    const second = runFixtureSync("acquire");
    expect(second.result.outcome).toBe("acquired");
    // Same inode → new code never replaced the file (no inode divergence).
    expect(statSync(lockFile).ino).toBe(inoAfterFirst);
    // …but it is re-pinned to the new owner.
    expect(second.result.ownerPid).not.toBe(first.result.ownerPid);
  });
});

describe("deploy flock — CONTENTION (two processes, one lock)", () => {
  it("while one process HOLDS the lock, a second gets 'held'; after release it acquires", async () => {
    // Holder acquires and holds for 2s.
    const holder = spawnFixture("acquire", { HOLD_MS: "2000" });
    const holderResult = await waitForResult(holder);
    expect(holderResult.outcome).toBe("acquired");

    // Contender while the holder is alive → held.
    const contended = runFixtureSync("acquire");
    expect(contended.result.outcome).toBe("held");

    // Wait for the holder to finish + release.
    await new Promise<void>((r) => holder.on("exit", () => r()));

    // Now the lock is free → a fresh acquire succeeds.
    const after = runFixtureSync("acquire");
    expect(after.result.outcome).toBe("acquired");
  });
});

describe("deploy flock — AUTO-RELEASE on holder death (the load-bearing property)", () => {
  it("a SIGKILLed holder's lock is reclaimed by the next acquirer (kernel auto-released)", async () => {
    // Holder acquires and holds 30s but is killed before it can release.
    const holder = spawnFixture("acquire", { HOLD_MS: "30000", NO_RELEASE: "1" });
    const held = await waitForResult(holder);
    expect(held.outcome).toBe("acquired");

    // Confirm a contender sees it held while the holder lives.
    expect(runFixtureSync("acquire").result.outcome).toBe("held");

    // SIGKILL the holder — it CANNOT run any release/unlink on its way out. The
    // PID file is left on disk; only the kernel flock is auto-released.
    holder.kill("SIGKILL");
    await new Promise<void>((r) => holder.on("exit", () => r()));

    // The next acquirer must still win the flock (proves the kernel released it),
    // even though the stale PID file is still present.
    const reacquired = runFixtureSync("acquire");
    expect(reacquired.result.outcome).toBe("acquired");
    expect(reacquired.result.ownerPid).not.toBe(held.ownerPid);
  });
});

describe("deploy flock — FD HANDOFF (parent → child via inherited fd 3)", () => {
  it("parent hands the lock to a child via fd 3; a contender still sees it held; lock ends up named with the child PID", async () => {
    // Parent acquires, spawns child (which adopts fd 3 + holds 2s), re-pins PID to
    // the child, closeKeepLocks its OWN fd, and awaits the child. The child's stdout
    // is inherited, so BOTH RESULT lines appear on the parent's piped stdout —
    // collect all of them and pick the `parent` line specifically.
    const parent = spawnFixture("parent", { HOLD_MS: "2000" });
    let buf = "";
    parent.stdout?.on("data", (c: Buffer) => (buf += c.toString()));

    // Give the parent a moment to acquire + spawn the child, then probe: while the
    // CHILD holds the lock (via the inherited fd, the parent's fd already closed),
    // a contender must STILL see it held.
    await new Promise<void>((r) => setTimeout(r, 800));
    const contended = runFixtureSync("acquire");
    expect(contended.result.outcome).toBe("held");

    await new Promise<void>((r) => parent.on("exit", () => r()));
    const parentLine = buf
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("RESULT ") && l.includes('"parent"'));
    expect(parentLine).toBeDefined();
    const parentResult = JSON.parse(parentLine!.slice("RESULT ".length)) as FixtureResult;
    expect(parentResult.parent).toBe("done");
    expect(parentResult.childCode).toBe(0);
    // PERMANENT FILE: the child releases by LOCK_UN + close (no unlink), so the
    // file PERSISTS with the child's now-dead PID.
    expect(parentResult.finalExists).toBe(true);
    expect(existsSync(lockFile)).toBe(true);
    // But the flock is genuinely free now (both parent + child exited) → a fresh
    // acquire wins, reusing the same permanent inode.
    expect(runFixtureSync("acquire").result.outcome).toBe("acquired");
  });

  it("the child writes its OWN pid into the PID file on adoption", async () => {
    // child mode holds the lock so we can read the PID file mid-flight; but here we
    // just let the parent run and assert the child adopted with its own pid by
    // reading the child's emitted content (held briefly, then released).
    const parent = spawnFixture("parent", { HOLD_MS: "600" });
    // Capture both parent and child RESULT lines (child inherits stdout=inherit →
    // its line shows on the parent's piped stdout).
    let buf = "";
    parent.stdout?.on("data", (c: Buffer) => (buf += c.toString()));
    await new Promise<void>((r) => parent.on("exit", () => r()));
    const childLine = buf
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("RESULT ") && l.includes('"child"'));
    expect(childLine).toBeDefined();
    const childResult = JSON.parse(childLine!.slice("RESULT ".length)) as FixtureResult;
    expect(childResult.child).toBe("adopted");
    // The PID file the child observed names the CHILD's pid (a plain PID), proving
    // the parent re-pinned to the child and the child re-pinned to itself.
    expect(childResult.content?.trim()).toBe(String(childResult.ownerPid));
  });
});

describe("deploy flock — writePidInPlace ordering + delimiter", () => {
  it("writes bytes BEFORE truncating (never an empty-file window) and leaves no stale bytes", () => {
    const { result } = runFixtureSync("writeOrder");
    expect(result.order).toEqual(["write", "truncate"]);
    // Started from a 10-char value, re-pinned to 42 → exactly "42\n" (the trailing
    // newline is the delimiter that prevents a concatenated foreign PID on a
    // mid-write crash), with the old tail fully truncated away.
    expect(result.final).toBe("42\n");
    // Crucially, every reader trims/leading-int-parses this back to 42.
    expect(parseInt((result.final ?? "").trim(), 10)).toBe(42);
  });

  it("a mid-write crash (write done, truncate skipped) leaves a parseable NEW pid, never a concatenated foreign PID", () => {
    // Simulate the death window: write "42\n" (3 bytes) over the old "123456" but
    // SKIP the truncate (as if the process died between the two syscalls). The first
    // 3 bytes "123" become "42\n", leaving the stale tail "456" → bytes "42\n456".
    // parseLockContent (and watchdog's leading-int sed) must read 42 — the NEW owner
    // — NOT 423456 (the live-looking foreign PID a delimiter-less "42"+"3456" would
    // have produced, which is exactly the failure the newline delimiter prevents).
    writeFileSync(lockFile, "123456");
    const fd = openSync(lockFile, "r+");
    const bytes = Buffer.from("42\n", "utf-8");
    writeSync(fd, bytes, 0, bytes.length, 0);
    // deliberately NO ftruncate
    closeSync(fd);
    expect(readFileSync(lockFile, "utf-8")).toBe("42\n456");
    expect(parseLockContent(readFileSync(lockFile, "utf-8")).pid).toBe(42);
  });
});

describe("deploy flock — LEGACY JSON transition (exactly one deploy)", () => {
  it("a legacy {pid,token} lock + matching DEPLOY_LOCK_HANDOFF becomes a PLAIN pid under the flock", () => {
    // Pre-write a legacy JSON handoff lock whose owner PID is DEAD (so the flock
    // acquire isn't blocked by a live foreign owner) but carries the token.
    const token = "legacy-handoff-token";
    writeFileSync(lockFile, JSON.stringify({ pid: 2147480000, token }));
    const { result, status } = runFixtureSync("acquire", { DEPLOY_LOCK_HANDOFF: token });
    expect(status).toBe(0);
    expect(result.outcome).toBe("acquired");
    // The JSON was overwritten with our PLAIN pid (new code never writes JSON).
    expect(result.content?.trim()).toBe(String(result.ownerPid));
    expect(result.content).not.toContain("token");
  });

  it("a legacy {pid,token} lock with a NON-matching handoff token is NOT overwritten when its owner is LIVE", () => {
    // Owner is a LIVE pid (our own test-runner pid) and the token does NOT match →
    // the acquire must back off as held (respect the live foreign owner).
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: "some-other-token" }));
    const { result } = runFixtureSync("acquire", { DEPLOY_LOCK_HANDOFF: "wrong-token" });
    expect(result.outcome).toBe("held");
    // Untouched.
    expect(JSON.parse(readFileSync(lockFile, "utf-8")).token).toBe("some-other-token");
  });
});

describe("deploy flock — FORGED FD rejection (HIGH: lock-bypass guard)", () => {
  it("adopting an inherited fd that is NOT the deploy.lock inode is REJECTED (no unlocked deploy)", () => {
    // The fixture seeds the real deploy.lock, then opens an UNRELATED file and
    // tries to adopt THAT fd as the inherited deploy lock. The inode-identity guard
    // must reject it (FlockForgedFdError) so a forged DEPLOY_LOCK_FD pointing at
    // another open file can never smuggle a deploy past the mutex.
    const { result, status } = runFixtureSync("forge");
    expect(status).toBe(0);
    expect(result.child).toBe("rejected");
    expect(result.forged).toBe(true);
    // The decoy file's content is never mistaken for the lock; the real lock file
    // still exists (permanent) and a normal acquire still works afterward.
    expect(existsSync(lockFile)).toBe(true);
    expect(runFixtureSync("acquire").result.outcome).toBe("acquired");
  });
});

describe("deploy flock — PRE-ADOPT BARRIER (no micro-window before the child adopts)", () => {
  it("while the child is blocked BEFORE adoptInheritedFlock and the parent's fd is already closed, a contender STILL sees 'held'", async () => {
    // barrierParent acquires, spawns barrierChild with the locked fd as fd 3 plus a
    // BARRIER_FILE the child blocks on, then IMMEDIATELY closeKeepLocks its OWN fd.
    // From that point the ONLY descriptor holding the flock is the child's inherited
    // fd — and the child has NOT yet called adoptInheritedFlock (it's spinning on the
    // barrier). A contender acquired during THIS window must still get "held",
    // proving the inherited fd holds the kernel flock continuously, with no gap
    // before the child actively adopts.
    const barrier = join(dir, "adopt.barrier");
    const parent = spawnFixture("barrierParent", { BARRIER_FILE: barrier, HOLD_MS: "400" });
    let buf = "";
    parent.stdout?.on("data", (c: Buffer) => (buf += c.toString()));

    // Wait until BOTH (a) the parent reports it armed the barrier + dropped its fd,
    // and (b) the child reports it is waiting (pre-adopt). Poll the captured stdout.
    const sawBoth = async (): Promise<boolean> => {
      const lines = buf.split("\n").map((l) => l.trim());
      return (
        lines.some((l) => l.startsWith("RESULT ") && l.includes('"barrier-armed"')) &&
        lines.some((l) => l.startsWith("RESULT ") && l.includes('"waiting"'))
      );
    };
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(await sawBoth())) {
      await new Promise<void>((r) => setTimeout(r, 25));
    }
    expect(await sawBoth()).toBe(true);
    // Barrier still present → the child is definitively BEFORE adoptInheritedFlock.
    expect(existsSync(barrier)).toBe(true);

    // THE ASSERTION: a contender during the pre-adopt window still sees the lock held
    // (held purely by the inherited fd, parent fd already closed, child not adopted).
    const contended = runFixtureSync("acquire");
    expect(contended.result.outcome).toBe("held");

    // Release the barrier → the child adopts, briefly holds, releases; parent exits.
    rmSync(barrier, { force: true });
    await new Promise<void>((r) => parent.on("exit", () => r()));
    const parentLine = buf
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("RESULT ") && l.includes('"done"'));
    expect(parentLine).toBeDefined();
    const parentResult = JSON.parse(parentLine!.slice("RESULT ".length)) as FixtureResult;
    expect(parentResult.childCode).toBe(0);
  });
});

describe("deploy flock — CREATE-RACE RETRY (swept-temp ENOENT / racer EEXIST are benign)", () => {
  it("ensureLockFilePresent returns (file present) without throwing when linkSync hits ENOENT then EEXIST", () => {
    // Deterministic injected-ops case (matches the writePidInPlace WriteOps style):
    // the fixture drives ensureLockFilePresent with ops whose linkSync throws ENOENT
    // (our temp swept by a concurrent acquirer's sweep) on attempt 1 and EEXIST (a
    // racer won the create) on attempt 2. The function must swallow BOTH as benign,
    // retry, and return with the lock file present — NEVER let the ENOENT escape and
    // crash the contender (the Codex Low finding).
    const { result, status } = runFixtureSync("ensureRace");
    expect(status).toBe(0);
    expect(result.threw).toBeUndefined(); // did NOT throw out of acquisition.
    expect(result.final).toBe("present"); // the permanent lock file is present.
    expect(result.attempts).toBe(2); // exercised both the ENOENT and EEXIST branches.
  });

  it("a burst of concurrent first-create acquirers all succeed (none crashes on a swept-temp ENOENT)", async () => {
    // Real two-process race: from a FRESH dir (no lock file yet) start several
    // `acquire` fixtures AT ONCE. Each runs the full acquire path — the age-gated
    // sweepOrphanLockTemps over the shared dir AND the temp-write→linkSync create —
    // so they genuinely race creating the same permanent inode while sweeping each
    // other's in-flight temps. Pre-fix, B's sweep could unlink A's temp and make A's
    // linkSync throw ENOENT, crashing A. Post-fix every contender must exit cleanly
    // (exactly one "acquired" at a time, the rest "held"), and NONE may crash.
    const N = 6;
    const children = Array.from({ length: N }, () => spawnFixture("acquire"));
    const settled = await Promise.all(
      children.map(
        (child) =>
          new Promise<{ result: FixtureResult; code: number | null }>((resolve, reject) => {
            let buf = "";
            child.stdout?.on("data", (c: Buffer) => (buf += c.toString()));
            child.stderr?.on("data", () => {});
            child.on("error", reject);
            child.on("exit", (code) => {
              const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
              resolve({
                result: line
                  ? (JSON.parse(line.slice("RESULT ".length)) as FixtureResult)
                  : {},
                code,
              });
            });
          }),
      ),
    );
    // EVERY contender exited 0 (no ENOENT/EEXIST crash during the create race).
    for (const s of settled) {
      expect(s.code).toBe(0);
      expect(s.result.outcome === "acquired" || s.result.outcome === "held").toBe(true);
    }
    // At least one actually acquired (the create race resolved to a real lock).
    expect(settled.some((s) => s.result.outcome === "acquired")).toBe(true);
    // The permanent lock file exists afterward and parses to a single PID.
    expect(existsSync(lockFile)).toBe(true);
    expect(parseLockContent(readFileSync(lockFile, "utf-8")).pid).not.toBeNull();
  });
});
