#!/usr/bin/env bun
// Bun fixture for the deploy-flock integration tests (remote-dev-v7gi flock
// redesign). bun:ffi cannot load under vitest/node, so the integration suite
// (tests/deploy-flock.test.ts) spawns THIS script under real `bun` and asserts
// the observable mutual-exclusion / auto-release / fd-handoff behavior.
//
// NOT a `*.test.ts` file → vitest's include glob never picks it up.
//
// Modes (argv[2]):
//   acquire   — acquire $LOCK_FILE; print one JSON line {outcome, ownerPid?,
//               content?}; if HOLD_MS set, hold that long then release (unless
//               NO_RELEASE=1, e.g. to model a crash via external SIGKILL).
//   parent    — acquire, spawn this fixture in `child` mode with the locked fd as
//               fd 3, re-pin PID to the child, closeKeepLock, await child, print
//               {parent:"done", childCode, finalExists}.
//   child     — adopt the inherited fd named by DEPLOY_LOCK_FD, print
//               {child:"adopted", content}; if HOLD_MS set, hold then release.
//   writeOrder— exercise writePidInPlace with recording ops; print {order:[...]}.
//   ensureRace— CREATE-RACE RETRY: drive ensureLockFilePresent with INJECTED ops
//               that simulate a concurrent acquirer's sweep/create — linkSync first
//               throws ENOENT (our temp swept), then EEXIST (a racer won the
//               create) — and assert it returns (file present) WITHOUT throwing.
//               Prints {final:"present"|"absent", attempts, threw?}.
//   forge     — FORGED-FD REJECTION: ensure $LOCK_FILE exists, then open an
//               UNRELATED file and adopt it as the "inherited" fd. adopt must throw
//               FlockForgedFdError (inode mismatch) → print {child:"rejected"}; if
//               it wrongly succeeds, print {child:"adopted"} (the test fails).
//   barrierParent — PRE-ADOPT BARRIER: acquire, spawn `barrierChild` with the
//               locked fd as fd 3 and a $BARRIER_FILE the child blocks on BEFORE
//               adopting; IMMEDIATELY closeKeepLock our own fd (so ONLY the
//               inherited fd holds the flock, and the child has NOT adopted yet),
//               print {parent:"barrier-armed"}, await child, print {parent:"done"}.
//   barrierChild — print {child:"waiting"} at once, then BLOCK until $BARRIER_FILE
//               is removed, and ONLY THEN adopt the inherited fd + briefly hold +
//               release. Proves the inherited fd holds the flock continuously even
//               in the window before the child actively adopts.
//
// Every JSON line is prefixed with "RESULT " so the test can grep it out of any
// incidental stdout.

import {
  acquireDeployFlock,
  adoptInheritedFlock,
  ensureLockFilePresent,
  writePidInPlace,
  FlockForgedFdError,
  type EnsureOps,
  type WriteOps,
} from "../../scripts/deploy-flock";
import {
  readFileSync,
  existsSync,
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
  writeSync as fsWriteSync,
  ftruncateSync as fsFtruncateSync,
} from "fs";
import { join } from "path";

function emit(obj: Record<string, unknown>): void {
  process.stdout.write("RESULT " + JSON.stringify(obj) + "\n");
}

const mode = process.argv[2];
const LOCK_FILE = process.env.LOCK_FILE ?? "";
const HOLD_MS = process.env.HOLD_MS ? parseInt(process.env.HOLD_MS, 10) : 0;
const NO_RELEASE = process.env.NO_RELEASE === "1";
const BARRIER_FILE = process.env.BARRIER_FILE ?? "";

async function main(): Promise<number> {
  if (mode === "acquire") {
    const res = acquireDeployFlock({
      lockFile: LOCK_FILE,
      pid: process.pid,
      legacyHandoffToken: process.env.DEPLOY_LOCK_HANDOFF || undefined,
    });
    if (res.outcome === "held") {
      emit({ outcome: "held" });
      return 0;
    }
    emit({
      outcome: "acquired",
      ownerPid: res.ownerPid,
      content: readFileSync(LOCK_FILE, "utf-8"),
    });
    if (HOLD_MS > 0) await Bun.sleep(HOLD_MS);
    if (!NO_RELEASE) res.release();
    return 0;
  }

  if (mode === "parent") {
    const res = acquireDeployFlock({ lockFile: LOCK_FILE, pid: process.pid });
    if (res.outcome === "held") {
      emit({ parent: "held" });
      return 1;
    }
    // Spawn the child in `child` mode, handing it the locked fd as fd 3.
    const child = Bun.spawn(["bun", "run", import.meta.path, "child"], {
      env: { ...process.env, DEPLOY_LOCK_FD: "3" },
      stdio: ["ignore", "inherit", "inherit", res.fd],
    });
    const childPid = child.pid;
    if (typeof childPid === "number") {
      res.writeOwnerPid(childPid);
      res.closeKeepLock();
    }
    const code = await child.exited;
    emit({ parent: "done", childCode: code, finalExists: existsSync(LOCK_FILE) });
    return 0;
  }

  if (mode === "child") {
    const fd = parseInt(process.env.DEPLOY_LOCK_FD ?? "", 10);
    const res = adoptInheritedFlock({ fd, lockFile: LOCK_FILE, pid: process.pid });
    emit({ child: "adopted", content: readFileSync(LOCK_FILE, "utf-8"), ownerPid: res.ownerPid });
    if (HOLD_MS > 0) await Bun.sleep(HOLD_MS);
    if (!NO_RELEASE) res.release();
    return 0;
  }

  if (mode === "forge") {
    // FORGED-FD REJECTION. Make the real deploy.lock exist (acquire + release →
    // permanent file remains), then open an UNRELATED file and try to adopt THAT
    // as the inherited deploy lock. The inode won't match deploy.lock, so adopt
    // MUST throw FlockForgedFdError. If it instead succeeds, that is the lock
    // bypass we are guarding against.
    const seed = acquireDeployFlock({ lockFile: LOCK_FILE, pid: process.pid });
    if (seed.outcome === "acquired") seed.release(); // leaves the permanent file
    const decoy = `${LOCK_FILE}.decoy`;
    writeFileSync(decoy, "not-the-lock\n");
    const forgedFd = openSync(decoy, "r+");
    try {
      const res = adoptInheritedFlock({ fd: forgedFd, lockFile: LOCK_FILE, pid: process.pid });
      // Should never get here. Clean up so we don't strand a held flock.
      res.release();
      emit({ child: "adopted", error: "forged fd was NOT rejected" });
    } catch (err) {
      emit({
        child: "rejected",
        forged: err instanceof FlockForgedFdError,
        error: String(err),
      });
    } finally {
      try {
        closeSync(forgedFd);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(decoy);
      } catch {
        /* ignore */
      }
    }
    return 0;
  }

  if (mode === "barrierParent") {
    const res = acquireDeployFlock({ lockFile: LOCK_FILE, pid: process.pid });
    if (res.outcome === "held") {
      emit({ parent: "held" });
      return 1;
    }
    const barrier = BARRIER_FILE || join(LOCK_FILE + ".barrier");
    writeFileSync(barrier, "wait\n"); // child blocks until this is removed
    const child = Bun.spawn(["bun", "run", import.meta.path, "barrierChild"], {
      env: { ...process.env, DEPLOY_LOCK_FD: "3", BARRIER_FILE: barrier },
      stdio: ["ignore", "inherit", "inherit", res.fd],
    });
    // CRITICAL: drop OUR fd immediately, BEFORE the child adopts. From here the
    // ONLY descriptor holding the flock is the child's inherited fd 3, and the
    // child is still blocked at the barrier (has NOT called adoptInheritedFlock).
    res.closeKeepLock();
    emit({ parent: "barrier-armed" });
    const code = await child.exited;
    emit({ parent: "done", childCode: code, finalExists: existsSync(LOCK_FILE) });
    return 0;
  }

  if (mode === "barrierChild") {
    // Announce we are alive but DELIBERATELY have not adopted yet.
    emit({ child: "waiting" });
    const barrier = BARRIER_FILE;
    // Block until the parent/test removes the barrier file.
    while (barrier && existsSync(barrier)) {
      await Bun.sleep(25);
    }
    const fd = parseInt(process.env.DEPLOY_LOCK_FD ?? "", 10);
    const res = adoptInheritedFlock({ fd, lockFile: LOCK_FILE, pid: process.pid });
    emit({ child: "adopted", ownerPid: res.ownerPid, content: readFileSync(LOCK_FILE, "utf-8") });
    if (HOLD_MS > 0) await Bun.sleep(HOLD_MS);
    if (!NO_RELEASE) res.release();
    return 0;
  }

  if (mode === "writeOrder") {
    // Prove the write-before-truncate ordering with recording ops. We start with
    // a LONGER value on disk so a truncate-first bug would be observable, but the
    // assertion is purely on call ORDER.
    const f = LOCK_FILE || "/tmp/flock-write-order.lock";
    writeFileSync(f, "9999999999"); // 10 chars
    const fd = openSync(f, "r+");
    const order: string[] = [];
    const ops: WriteOps = {
      writeSync: (wfd, buf, off, len, pos) => {
        order.push("write");
        return fsWriteSync(wfd, buf, off, len, pos);
      },
      ftruncateSync: (tfd, len) => {
        order.push("truncate");
        fsFtruncateSync(tfd, len);
      },
    };
    writePidInPlace(fd, 42, ops);
    closeSync(fd);
    const final = readFileSync(f, "utf-8");
    try {
      unlinkSync(f);
    } catch {
      /* best effort */
    }
    emit({ order, final });
    return 0;
  }

  if (mode === "ensureRace") {
    // CREATE-RACE RETRY. Drive ensureLockFilePresent with INJECTED ops that model a
    // concurrent acquirer racing our temp-write → linkSync, deterministically (no
    // real second process needed). The injected linkSync fails the first two link
    // attempts the way a real race would:
    //   attempt 1 → throw ENOENT  (our temp was swept by a concurrent sweep before
    //               we could link it; the file does NOT yet exist → must RETRY)
    //   attempt 2 → throw EEXIST  (a concurrent acquirer won the create; we model
    //               that by also making the file "exist" from here on → must RETURN)
    // ensureLockFilePresent must swallow BOTH as benign and return WITHOUT throwing,
    // leaving the (real) lock file present.
    const f = LOCK_FILE || "/tmp/flock-ensure-race.lock";
    try {
      unlinkSync(f);
    } catch {
      /* fresh start */
    }
    let linkCalls = 0;
    let racerCreated = false;
    const ops: EnsureOps = {
      existsSync: (p) => (p === f ? racerCreated : existsSync(p)),
      writeFileSync: (p, data) => writeFileSync(p, data),
      linkSync: (existing, next) => {
        linkCalls += 1;
        if (linkCalls === 1) {
          // Our temp was swept out from under us → link target source is gone.
          const e = new Error("ENOENT: temp swept") as NodeJS.ErrnoException;
          e.code = "ENOENT";
          throw e;
        }
        if (linkCalls === 2) {
          // A racer won the create: the destination now exists.
          racerCreated = true;
          // Actually materialize the real file so the post-condition (file present)
          // holds for a real reader, mirroring what the racer's link would do.
          writeFileSync(next, readFileSync(existing, "utf-8"));
          const e = new Error("EEXIST: racer won") as NodeJS.ErrnoException;
          e.code = "EEXIST";
          throw e;
        }
        // Any further attempt: behave normally (shouldn't be reached).
        writeFileSync(next, readFileSync(existing, "utf-8"));
        racerCreated = true;
      },
      unlinkSync: (p) => unlinkSync(p),
    };
    let threw: string | undefined;
    try {
      ensureLockFilePresent(f, process.pid, ops);
    } catch (err) {
      threw = String(err);
    }
    const present = existsSync(f);
    try {
      unlinkSync(f);
    } catch {
      /* best effort */
    }
    emit({ final: present ? "present" : "absent", attempts: linkCalls, threw });
    return 0;
  }

  emit({ error: `unknown mode ${mode}` });
  return 2;
}

process.exit(await main());
