// ─────────────────────────────────────────────────────────────────────────────
// OS flock(2) deploy mutex (remote-dev-v7gi — flock redesign).
//
// THE PROPER FIX for the deploy lock. Previous rounds tried to make a userland
// open/read/unlink/create dance on a regular file atomically reclaim a stale
// lock; every patch added another TOCTOU window (the `.reap` guard recreated the
// same empty-file race). A regular-file mutex CANNOT do this safely. `flock(2)`
// can: the kernel guarantees atomic mutual exclusion AND auto-releases the lock
// when the holding process dies, so "stale-reclaim" ceases to exist — a dead
// holder's lock is simply gone, and the next acquirer's LOCK_EX|LOCK_NB succeeds.
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️  BUN-ONLY. This module imports `bun:ffi` and MUST NEVER be imported by any
//     Next.js route or anything reachable from `src/`. Turbopack would try to
//     bundle `bun:ffi` and fail. Only bun scripts (scripts/deploy.ts) import it.
// ════════════════════════════════════════════════════════════════════════════
//
// deploy.lock is BOTH the flock target AND the PID-visibility file: the holder
// flocks the fd and writes its PID (in place) so PID-liveness readers (the
// status route, watchdog, `--status`) can observe the owner without bun:ffi.
//
// PERMANENT LOCK FILE (Codex verify round). deploy.lock is a PERMANENT inode that
// NEW code NEVER unlinks. It is created ONCE (atomic temp-write + linkSync) if
// absent; every acquirer thereafter just open()s + flock()s the SAME inode and
// overwrites the PID bytes in place. RELEASE = `flock(LOCK_UN)` + `closeSync`
// ONLY — no unlink. This is what removes the two file-replacement races a
// userland mutex suffers:
//   - release-deletes-successor: an acquirer that took the flock on a fresh inode
//     used to be vulnerable to the previous owner's release unlinking the path it
//     had just recreated. With a permanent never-unlinked inode, no release ever
//     unlinks, so a successor's inode can never be deleted out from under it.
//   - new-vs-new inode divergence: two new acquirers can no longer end up flocking
//     DIFFERENT inodes for the same path, because new code never replaces the
//     inode. The acquire-time fstat(fd)-vs-stat(path) dev/ino guard is retained
//     ONLY as defense during the one-time transition from a LEGACY (old,
//     non-flock) process that might still unlink/recreate the file; new-vs-new is
//     inode-stable so the guard is a no-op then.
// A leftover dead-PID file is HARMLESS: every PID reader (status route, watchdog,
// `--status`, the route's best-effort 409) liveness-checks the PID, so a dead PID
// reads as "not held"; the next acquirer flocks the same inode and overwrites it.
//
// Lifecycle:
//   - PROJECT_ROOT/scripts/deploy.ts (the stable entry the webhook spawns)
//     acquires the flock, bootstraps deploy-src, then spawns the FRESH
//     origin/master deploy-src deploy.ts with `--skip-lock`, passing the LOCKED
//     fd as the child's fd 3 (Bun.spawn stdio index 3). The kernel keeps the
//     flock held across that handoff because the child inherits the same open
//     file description.
//   - The child adopts the inherited fd 3 — but FIRST verifies (fstat(fd) vs
//     stat(deploy.lock)) that the inherited fd is genuinely the deploy.lock inode,
//     so a forged DEPLOY_LOCK_FD pointing at ANOTHER open file cannot smuggle a
//     deploy past the mutex — then writes ITS OWN pid in place, runs the deploy
//     body, and unlocks + closes (NO unlink) in a single `finally`.
//   - The parent writes the child's pid into the PID file, closes its OWN fd
//     WITHOUT unlinking (the child owns the lock now), and awaits the child.
//
// Failure behavior (all hold):
//   - FFI cannot load            → throw FlockUnavailableError → deploy.ts FAILS
//                                  CLOSED (logs, writes a failed result, exits;
//                                  NO userland fallback).
//   - flock contention (errno 35) → returns { outcome: "held" } → clean no-op
//                                  exit, deploy.ts does NOT write a failed result
//                                  that would clobber the winner.
//   - partial PID write           → the PID is written WITH a trailing newline
//                                  delimiter BEFORE the truncate, so a death
//                                  mid-write leaves `42\n…oldtail` whose
//                                  leading-integer parse stops at the `\n` → the
//                                  NEW pid, never a concatenated foreign PID, and
//                                  never an empty file.
//   - forged inherited fd        → adopt rejects (fstat/stat dev/ino mismatch) and
//                                  the child refuses to run → no unlocked deploy.
//   - parent dies after spawn     → the child's inherited fd keeps the flock.
//   - child dies                  → the kernel releases the flock.
// ─────────────────────────────────────────────────────────────────────────────

import { dlopen, FFIType, read } from "bun:ffi";
import {
  openSync,
  closeSync,
  writeSync,
  ftruncateSync,
  fstatSync,
  statSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  linkSync,
} from "fs";
import { dirname, join } from "path";
import { formatPlainLock, parseLockContent } from "./deploy-lock";

// flock(2) operation constants. Same numeric values on macOS AND Linux (BSD
// flock op flags), VERIFIED on Bun 1.3.14 / macOS:
//   contention → flock returns -1, errno = EWOULDBLOCK.
const LOCK_EX = 0x02; // exclusive lock
const LOCK_NB = 0x04; // non-blocking (fail instead of waiting on contention)
const LOCK_UN = 0x08; // release

// EAGAIN == EWOULDBLOCK on macOS (35). Linux's EWOULDBLOCK is 11. Production is
// the confirmed Mac/APFS host; we accept BOTH so the module is correct if ever
// run on Linux, since either value unambiguously means "another holder has it".
const EWOULDBLOCK_DARWIN = 35;
const EWOULDBLOCK_LINUX = 11;

/** Thrown when the libc FFI binding cannot be loaded → deploy.ts FAILS CLOSED. */
export class FlockUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`flock FFI unavailable: ${String(cause)}`);
    this.name = "FlockUnavailableError";
  }
}

interface Libc {
  flock(fd: number, op: number): number;
  errno(): number;
}

let libcSingleton: Libc | null = null;

/**
 * Lazily dlopen libc's `flock` + `__error` (the macOS errno-location accessor).
 * On any failure we throw FlockUnavailableError — deploy.ts catches it and FAILS
 * CLOSED (does NOT deploy, no userland fallback). Loading lazily (not at module
 * import) means merely importing this file can't crash a bun script; the throw
 * happens only when a deploy actually tries to lock.
 */
function loadLibc(): Libc {
  if (libcSingleton) return libcSingleton;
  try {
    // libSystem.dylib re-exports the C library on macOS. On Linux the FFI path
    // is not the production target (fail-closed there too); libc.so.6 would be
    // the analog but we deliberately do not load it — prod is the Mac host.
    const lib = dlopen("libSystem.dylib", {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      __error: { args: [], returns: FFIType.ptr },
    });
    const errPtr = lib.symbols.__error;
    libcSingleton = {
      flock: (fd, op) => lib.symbols.flock(fd, op),
      // __error() returns a pointer to the thread's errno; read the int there. A
      // null pointer (shouldn't happen for __error) degrades to 0 — treated as
      // "not contention" by isContention, i.e. fail-closed (held).
      errno: () => {
        const p = errPtr();
        return p ? read.i32(p, 0) : 0;
      },
    };
    return libcSingleton;
  } catch (err) {
    throw new FlockUnavailableError(err);
  }
}

/** Is an errno value the "another holder has the lock" signal? */
function isContention(e: number): boolean {
  return e === EWOULDBLOCK_DARWIN || e === EWOULDBLOCK_LINUX;
}

/** Optional structured logger (matches deploy.ts's logDeploy/logError shape). */
export interface FlockLog {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

/** The outcome of trying to acquire the deploy flock. */
export type FlockOutcome = "acquired" | "held";

/**
 * A held deploy flock. While `outcome === "acquired"`, `fd` is the LOCKED file
 * descriptor (pass it to a child as stdio fd 3 to hand the lock off) and the
 * PID file at `lockFile` names the current owner. `release()` unlocks
 * (LOCK_UN) + closes the fd ONLY — it NEVER unlinks deploy.lock (the file is a
 * PERMANENT inode; the leftover dead-PID content reads as "not held" to every
 * PID-liveness reader). `closeKeepLock` closes our fd WITHOUT unlocking — used by
 * the PARENT after spawning the child that now owns the lock via the inherited fd.
 */
export interface FlockHandle {
  outcome: FlockOutcome;
  /** The locked fd (valid only when outcome === "acquired"). */
  fd: number;
  /** PID currently written into the PID file (the lock owner). */
  ownerPid: number;
  /** Re-pin the on-disk PID to a new owner IN PLACE (write-before-truncate). */
  writeOwnerPid(pid: number): void;
  /** Owner release: unlock (LOCK_UN) + close. NEVER unlinks (permanent file). */
  release(): void;
  /** Parent-after-spawn: close our fd but keep the flock + PID file (child owns it). */
  closeKeepLock(): void;
}

/**
 * The fs ops `writePidInPlace` uses. Injectable so the ordering invariant
 * (write-before-truncate) is unit-testable with recording wrappers; defaults to
 * the real fs syscalls in production.
 */
export interface WriteOps {
  writeSync: (fd: number, buf: Uint8Array, off: number, len: number, pos: number) => number;
  ftruncateSync: (fd: number, len: number) => void;
}

const REAL_WRITE_OPS: WriteOps = {
  writeSync: (fd, buf, off, len, pos) => writeSync(fd, buf, off, len, pos),
  ftruncateSync: (fd, len) => ftruncateSync(fd, len),
};

/**
 * Write `pid` into `fd`'s file IN PLACE: bytes FIRST (with a trailing newline
 * delimiter), then truncate to the EXACT written length.
 *
 * CRITICAL ORDER: write the new bytes at offset 0 FIRST, THEN truncate. NEVER
 * truncate before writing — a crash between truncate(0) and write would leave
 * readers an EMPTY file (→ "no live owner" → a racer could wrongly proceed).
 *
 * CRITICAL DELIMITER: the bytes are `${pid}\n`, NOT a bare `${pid}`. Without the
 * newline, a death AFTER the write but BEFORE the truncate, when the new PID is
 * SHORTER than the old one, would leave the new digits concatenated with the old
 * tail (e.g. write "42" over "123456" → "423456"), which parseLockContent reads
 * as the LIVE foreign PID 423456. With the trailing `\n`, the same crash leaves
 * "42\n3456": parseLockContent's leading-integer parse stops at the `\n` → 42
 * (the correct new owner). Every reader (parseLockContent trims; watchdog.sh's
 * leading-integer sed; the status route + 409 route) reads `42\n` as exactly 42.
 *
 * Handles short writeSync returns (loops until all bytes are written) and
 * ftruncates to the EXACT byte count written, so no stale tail can survive.
 */
export function writePidInPlace(fd: number, pid: number, ops: WriteOps = REAL_WRITE_OPS): void {
  const bytes = Buffer.from(formatPlainLock(pid) + "\n", "utf-8");
  let written = 0;
  while (written < bytes.length) {
    const n = ops.writeSync(fd, bytes, written, bytes.length - written, written);
    // A non-positive return would mean no forward progress; break to avoid an
    // infinite loop (the subsequent truncate still bounds the file to `written`).
    if (n <= 0) break;
    written += n;
  }
  ops.ftruncateSync(fd, written);
}

/** Prefix of the same-dir temp files ensureLockFilePresent links into place. */
const LOCK_TMP_PREFIX = ".deploy.lock.tmp.";

/**
 * Age threshold below which a `.deploy.lock.tmp.*` file is assumed to be an
 * IN-FLIGHT temp belonging to a concurrent acquirer (between its writeFileSync
 * and its linkSync) and is therefore NOT swept. 5 minutes is conservatively far
 * larger than the microseconds a real acquirer spends between those two syscalls,
 * so the sweep only ever reaps genuinely-orphaned temps (a SIGKILL victim) and can
 * never unlink another acquirer's just-created temp out from under its linkSync.
 */
const LOCK_TMP_STALE_MS = 300_000;

/**
 * Best-effort sweep of orphaned `.deploy.lock.tmp.*` temp files in the lock dir.
 * A SIGKILL between writeFileSync(tmp) and the finally-unlink in
 * ensureLockFilePresent can orphan one; nothing else ever reads them, but they
 * accumulate. Swallow every error — this is pure hygiene and must never block or
 * fail an acquire.
 *
 * AGE-GATE (Codex Low): only unlink a temp whose mtime is OLDER than
 * LOCK_TMP_STALE_MS. Without this, acquirer B sweeping the dir could unlink
 * acquirer A's just-written `.deploy.lock.tmp.*` BEFORE A reaches `linkSync(tmp,
 * lockFile)`, making A's link throw ENOENT and crash that contender during a
 * first-create / legacy-transition acquire. A fresh in-flight temp is always far
 * newer than 5 minutes, so this guard makes the sweep never touch one. Per-file
 * stat/unlink errors are swallowed (a temp may be unlinked by its owner — or by a
 * racing sweep — between readdir and stat/unlink).
 */
function sweepOrphanLockTemps(lockFile: string): void {
  try {
    const dir = dirname(lockFile);
    const cutoff = Date.now() - LOCK_TMP_STALE_MS;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(LOCK_TMP_PREFIX)) continue;
      const tmpPath = join(dir, name);
      try {
        // Only sweep temps demonstrably older than the staleness threshold; a
        // newer one may be a concurrent acquirer's in-flight temp (pre-linkSync).
        if (statSync(tmpPath).mtimeMs > cutoff) continue;
        unlinkSync(tmpPath);
      } catch {
        /* best-effort; the file may already be gone, or another acquirer may be
           racing the same sweep — either way, nothing to do. */
      }
    }
  } catch {
    /* dir unreadable → nothing to sweep */
  }
}

/**
 * The fs ops `ensureLockFilePresent` uses. Injectable (matching `WriteOps`) so the
 * create-race retry branch — where `linkSync` throws ENOENT (our temp was swept by a
 * concurrent acquirer's sweepOrphanLockTemps) or EEXIST (a racer won the create) — is
 * unit-testable under vitest/node without orchestrating a real two-process race.
 * Defaults to the real fs syscalls in production.
 */
export interface EnsureOps {
  existsSync: (path: string) => boolean;
  writeFileSync: (path: string, data: string) => void;
  linkSync: (existing: string, next: string) => void;
  unlinkSync: (path: string) => void;
}

const REAL_ENSURE_OPS: EnsureOps = {
  existsSync: (path) => existsSync(path),
  writeFileSync: (path, data) => writeFileSync(path, data),
  linkSync: (existing, next) => linkSync(existing, next),
  unlinkSync: (path) => unlinkSync(path),
};

/** Max attempts for the create-race retry loop in ensureLockFilePresent. */
const ENSURE_CREATE_ATTEMPTS = 8;

/**
 * Ensure the PERMANENT PID file exists WITH content already present (no empty-file
 * window). deploy.lock is created EXACTLY ONCE and thereafter NEVER unlinked by new
 * code (see the module header): if it already exists, this is a no-op and the
 * caller just open()s + flock()s the existing inode. If absent, write `pid` (with a
 * trailing-newline delimiter, matching writePidInPlace) to a same-dir temp file and
 * atomically `linkSync` it into place.
 *
 * CREATE-RACE RETRY (Codex Low). Two link outcomes are BENIGN, RETRYABLE create
 * races — neither is fatal, because all we need is for SOME process to have created
 * the file:
 *   - EEXIST: a concurrent acquirer won the link first. The file is now present →
 *     done (re-check existsSync and return).
 *   - ENOENT: our just-written temp was unlinked out from under us by a concurrent
 *     acquirer's sweepOrphanLockTemps before our `linkSync` could read it. (The age
 *     gate added to that sweep makes this rare, but it is not impossible across two
 *     processes whose clocks/mtimes straddle the threshold, so we still handle it.)
 *     If the file now exists (the racer that swept us also created it), we are done;
 *     otherwise we loop and re-create our temp. We must NOT let this ENOENT escape
 *     acquisition as a crash — it is a transient race, not a real failure.
 * The loop is bounded (ENSURE_CREATE_ATTEMPTS); if it is exhausted without the file
 * appearing, the caller's own openSync("r+") loop will re-ensure and ultimately
 * surface a real ENOENT. The temp is unlinked in a finally on EVERY path (including
 * the ENOENT path, where it is usually already gone — unlink ENOENT is fine).
 * Leaves the file present (content = SOME pid) so the subsequent openSync("r+") +
 * flock never observes an empty lock file.
 */
export function ensureLockFilePresent(
  lockFile: string,
  pid: number,
  ops: EnsureOps = REAL_ENSURE_OPS,
): void {
  if (ops.existsSync(lockFile)) return;
  const dir = dirname(lockFile);
  for (let attempt = 0; attempt < ENSURE_CREATE_ATTEMPTS; attempt++) {
    const tmp = join(
      dir,
      `${LOCK_TMP_PREFIX}${pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}`,
    );
    try {
      ops.writeFileSync(tmp, formatPlainLock(pid) + "\n");
      try {
        ops.linkSync(tmp, lockFile);
        return; // we created the permanent file.
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        // EEXIST: a racer created it first. ENOENT: our temp was swept out from
        // under us before the link. Either way the file may now be present — if so
        // we are done; if not (ENOENT and nobody created it yet), retry.
        if (code === "EEXIST" || code === "ENOENT") {
          if (ops.existsSync(lockFile)) return;
          continue; // benign create race; re-create the temp and try again.
        }
        throw err; // a genuinely unexpected link error → surface it.
      }
    } finally {
      try {
        ops.unlinkSync(tmp);
      } catch {
        /* best-effort temp cleanup; ENOENT here (temp already swept) is fine. */
      }
    }
  }
  // Retries exhausted without the file appearing. Do NOT throw: the caller's
  // openSync("r+") + re-ensure loop owns surfacing a real, persistent ENOENT.
}

/** Build a FlockHandle bound to an open, LOCKED fd. */
function makeHandle(
  libc: Libc,
  lockFile: string,
  fd: number,
  ownerPid: number,
  log?: FlockLog,
): FlockHandle {
  const state = { pid: ownerPid, released: false };
  return {
    outcome: "acquired",
    fd,
    get ownerPid() {
      return state.pid;
    },
    writeOwnerPid(pid: number) {
      writePidInPlace(fd, pid);
      state.pid = pid;
    },
    release() {
      if (state.released) return;
      state.released = true;
      // PERMANENT FILE: release is LOCK_UN + close ONLY — we NEVER unlink
      // deploy.lock. The leftover content names a now-dead PID (us, exiting), which
      // every PID-liveness reader (status route, watchdog, `--status`, the 409
      // route) reads as "not held"; the next acquirer flocks the SAME inode and
      // overwrites the PID. Not unlinking removes the release-deletes-successor race
      // (an acquirer's freshly-linked inode could be deleted by a stale releaser)
      // AND keeps the inode stable across acquirers (no new-vs-new divergence).
      try {
        libc.flock(fd, LOCK_UN);
      } catch (err) {
        log?.warn?.(`deploy flock: LOCK_UN failed (continuing): ${String(err)}`);
      }
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    },
    closeKeepLock() {
      if (state.released) return;
      state.released = true;
      // Close OUR fd but do NOT unlock and do NOT unlink: the child holds the
      // same flock via its inherited fd and owns the PID file now.
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    },
  };
}

export interface AcquireFlockOptions {
  lockFile: string;
  pid: number;
  log?: FlockLog;
  /**
   * Legacy one-time transition (exactly one deploy): when the existing PID file
   * is a JSON `{pid,token}` whose token equals this value, OVERWRITE it with a
   * plain PID after taking the flock. New code never creates JSON locks; this is
   * defensive compat for a v7gi-handoff webhook that may have written one.
   */
  legacyHandoffToken?: string;
}

/**
 * Acquire the deploy flock. Algorithm (deploy.lock is a PERMANENT inode that is
 * BOTH the flock target AND the PID-visibility file, and is NEVER unlinked by new
 * code):
 *
 *   0. Best-effort sweep of orphaned `.deploy.lock.tmp.*` temps (a SIGKILL during
 *      the one-time create can orphan one). AGE-GATED: only temps older than
 *      LOCK_TMP_STALE_MS are swept, so the sweep never unlinks a concurrent
 *      acquirer's in-flight temp before its linkSync.
 *   1. Ensure the PID file exists WITH content (temp-write + linkSync). Created
 *      ONCE; a no-op on every subsequent acquire (the inode is permanent). The
 *      create is RETRYABLE: a benign EEXIST (a racer won) or ENOENT (our temp was
 *      swept by a concurrent acquirer) loops/returns rather than crashing.
 *   2. openSync(lockFile, "r+").
 *   3. flock(fd, LOCK_EX | LOCK_NB). errno === EWOULDBLOCK → another live holder
 *      → close fd, return { outcome: "held" }. (The kernel auto-releases a dead
 *      holder's flock, so this NEVER blocks on a crashed deploy.)
 *   4. fstat(fd) vs stat(lockFile): if dev/ino differ, a LEGACY (old, non-flock)
 *      process unlinked + recreated the path while we held the flock on the OLD
 *      inode → close, retry from step 1 (bounded). Since NEW code never unlinks,
 *      new-vs-new is inode-stable and this guard only fires during the transition.
 *   5. Parse current content. A LIVE foreign PID under our held flock is only
 *      possible for a legacy non-flock writer; respect it (return "held") UNLESS
 *      the legacy handoff token matches (then we overwrite the JSON with our PID).
 *   6. Write OUR pid in place (bytes-before-truncate, with the `\n` delimiter).
 *
 * Throws FlockUnavailableError if the FFI cannot load (deploy.ts FAILS CLOSED).
 */
export function acquireDeployFlock(opts: AcquireFlockOptions): FlockHandle | { outcome: "held" } {
  const { lockFile, pid, log, legacyHandoffToken } = opts;
  const libc = loadLibc(); // throws FlockUnavailableError if FFI is unavailable

  // Hygiene: clear any temp files orphaned by a SIGKILL mid-create (best-effort).
  sweepOrphanLockTemps(lockFile);

  for (let attempt = 0; attempt < 4; attempt++) {
    ensureLockFilePresent(lockFile, pid);

    let fd: number;
    try {
      fd = openSync(lockFile, "r+");
    } catch (err) {
      // The file vanished between ensure and open. New code NEVER unlinks the
      // permanent file, so this can only happen during the one-time transition (a
      // LEGACY non-flock process unlinked it) → re-ensure + re-open. Any other
      // error is unexpected → surface it.
      if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
      throw err;
    }

    // Non-blocking exclusive lock. -1 with EWOULDBLOCK = a LIVE holder has it.
    if (libc.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      const e = libc.errno();
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      if (isContention(e)) {
        log?.info?.("deploy flock held by another process");
        return { outcome: "held" };
      }
      // An unexpected flock error (not contention) — fail closed by treating it
      // as held so we never deploy without the mutex.
      log?.warn?.(`deploy flock: unexpected flock errno ${e}; treating as held`);
      return { outcome: "held" };
    }

    // We hold the flock on `fd`'s inode. Guard against a legacy non-flock writer
    // having unlinked+recreated the path while we waited: if the path now points
    // at a DIFFERENT inode than our fd, we are holding a lock on a stale (unlinked)
    // inode → drop it and retry on the live path.
    let pathStat: ReturnType<typeof statSync> | null = null;
    try {
      pathStat = statSync(lockFile);
    } catch {
      pathStat = null; // path gone (unlinked) → treat as inode mismatch, retry.
    }
    const fdStat = fstatSync(fd);
    if (!pathStat || pathStat.dev !== fdStat.dev || pathStat.ino !== fdStat.ino) {
      try {
        libc.flock(fd, LOCK_UN);
      } catch {
        /* ignore */
      }
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      continue; // retry: re-ensure + re-open the live path.
    }

    // Inspect current content under the held flock.
    let current = "";
    try {
      current = readFileSync(lockFile, "utf-8");
    } catch {
      current = "";
    }
    const parsed = parseLockContent(current);

    // Legacy one-time transition: a JSON {pid,token} lock whose token matches the
    // env handoff token → overwrite with our plain PID. New code never writes JSON.
    const isLegacyHandoff =
      parsed.token !== null &&
      typeof legacyHandoffToken === "string" &&
      legacyHandoffToken.length > 0 &&
      parsed.token === legacyHandoffToken;

    // A LIVE foreign PID under our held flock can only come from a legacy
    // non-flock writer (flock is exclusive, so no flock holder coexists with us).
    // Respect it — EXCEPT the sanctioned legacy-handoff overwrite.
    if (
      !isLegacyHandoff &&
      parsed.pid !== null &&
      parsed.pid !== pid &&
      isPidAlive(parsed.pid)
    ) {
      log?.info?.(`deploy flock acquired but PID file names a live foreign pid ${parsed.pid}; backing off`);
      try {
        libc.flock(fd, LOCK_UN);
      } catch {
        /* ignore */
      }
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      return { outcome: "held" };
    }

    // Claim ownership: write OUR pid in place (delimited bytes-before-truncate).
    writePidInPlace(fd, pid);
    if (isLegacyHandoff) {
      log?.info?.("deploy flock: overwrote legacy JSON handoff lock with plain PID");
    }
    return makeHandle(libc, lockFile, fd, pid, log);
  }

  // Exhausted retries (a legacy writer kept churning the inode under us) → held.
  log?.warn?.("deploy flock: exhausted inode-stability retries; treating as held");
  return { outcome: "held" };
}

export interface AdoptFlockOptions {
  fd: number;
  lockFile: string;
  pid: number;
  log?: FlockLog;
}

/**
 * Thrown when an inherited DEPLOY_LOCK_FD does NOT refer to the real deploy.lock
 * inode (a forged fd that would smuggle a deploy past the mutex). deploy.ts
 * catches it and REFUSES to run unlocked.
 */
export class FlockForgedFdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlockForgedFdError";
  }
}

/**
 * Does the open descriptor `fd` refer to the SAME inode as `lockFile`? Compares
 * fstat(fd) dev/ino against stat(lockFile) dev/ino. A missing path or any stat
 * error → false (treat as NOT the lock file → reject). This is the guard that
 * makes a forged inherited fd (one open to ANOTHER file) unusable.
 */
function fdIsLockFile(fd: number, lockFile: string): boolean {
  let fdStat: ReturnType<typeof fstatSync>;
  try {
    fdStat = fstatSync(fd);
  } catch {
    return false; // not even a valid fd
  }
  let pathStat: ReturnType<typeof statSync>;
  try {
    pathStat = statSync(lockFile);
  } catch {
    return false; // deploy.lock missing → can't be the same inode
  }
  return fdStat.dev === pathStat.dev && fdStat.ino === pathStat.ino;
}

/**
 * Adopt a flock the PARENT acquired and handed to us via an inherited fd (the
 * `--skip-lock` child path). The kernel still holds the flock on this fd (the
 * child inherited the same open file description), so we do NOT re-flock to
 * acquire — but we DO verify the fd genuinely IS the deploy.lock inode and that
 * we truly hold the flock, then assert ownership by writing OUR pid in place.
 * `release()` unlocks + closes (NEVER unlinks — the file is permanent) at the end.
 *
 * SECURITY (forged-fd lock bypass): deploy.ts trusts whatever DEPLOY_LOCK_FD names,
 * so a caller could pass `DEPLOY_LOCK_FD=3` with fd 3 open to ANOTHER file and,
 * without this check, re-flock that unrelated fd + write a PID and "adopt" a lock
 * it never held — running a deploy WITHOUT holding deploy.lock. We defend by
 * requiring fstat(fd).dev/ino === stat(deploy.lock).dev/ino BEFORE trusting the fd,
 * and we RE-CHECK the same identity AFTER writePidInPlace (so a same-inode TOCTOU
 * can't slip between the checks). Either mismatch → throw FlockForgedFdError; the
 * child refuses to run and NO deploy happens.
 *
 * Throws FlockUnavailableError if the FFI cannot load (so release's LOCK_UN is
 * available). We re-flock defensively (LOCK_EX|LOCK_NB on the SAME fd is a no-op
 * success for the lock owner, proven on Bun/macOS) to confirm we truly hold it; a
 * failure there means the handoff was broken → throw.
 */
export function adoptInheritedFlock(opts: AdoptFlockOptions): FlockHandle {
  const { fd, lockFile, pid, log } = opts;
  const libc = loadLibc();

  // GUARD 1 (before trusting the fd): the inherited fd MUST be the deploy.lock
  // inode. A forged DEPLOY_LOCK_FD pointing at another open file is rejected here,
  // BEFORE we write any PID or claim ownership.
  if (!fdIsLockFile(fd, lockFile)) {
    throw new FlockForgedFdError(
      `adopt: inherited fd ${fd} does not refer to the deploy.lock inode (${lockFile}); ` +
        "refusing to run unlocked (possible forged DEPLOY_LOCK_FD).",
    );
  }

  // Re-flocking our OWN inherited fd is a no-op success (same open file
  // description already holds the lock). If it somehow fails, the handoff is
  // broken and we must not silently run unlocked.
  if (libc.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    const e = libc.errno();
    throw new Error(`adopt: inherited fd ${fd} is not a held flock (errno ${e})`);
  }

  writePidInPlace(fd, pid);

  // GUARD 2 (after writePidInPlace, before returning "adopted"): re-verify the fd
  // still IS the deploy.lock inode, closing any window between the first check and
  // claiming ownership. If it no longer matches, we just wrote a PID into the wrong
  // file under a lock we don't hold → reject.
  if (!fdIsLockFile(fd, lockFile)) {
    throw new FlockForgedFdError(
      `adopt: inherited fd ${fd} no longer refers to the deploy.lock inode (${lockFile}) ` +
        "after re-pinning; refusing to run unlocked.",
    );
  }

  log?.info?.(`deploy flock: adopted inherited fd ${fd} (re-pinned to pid ${pid})`);
  return makeHandle(libc, lockFile, fd, pid, log);
}

/**
 * PID liveness with EPERM-is-alive semantics, mirroring deploy.ts's
 * isLockHolderAlive + the status route + watchdog. EPERM ⇒ the process EXISTS
 * but is owned by another user → alive; err toward "alive" so we never treat a
 * live foreign-owned holder as dead.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}
