// ─────────────────────────────────────────────────────────────────────────────
// Deploy-lock content codec (remote-dev-v7gi → flock(2) redesign).
//
// The single real deploy mutex is now an OS `flock(2)` advisory lock on
// `~/.remote-dev/deploy/deploy.lock` (held by scripts/deploy-flock.ts, a
// bun:ffi module). The kernel guarantees atomic mutual exclusion AND auto-
// releases the lock when the holder process dies, so the userland
// open/read/unlink/create stale-reclaim protocol that previous rounds kept
// re-racing is GONE entirely (no `.reap` guard, no token handoff, no
// stale-reclaim retry loop).
//
// deploy.lock still doubles as a PID-VISIBILITY file: the flock holder writes
// its PID (in place) so PID-liveness readers — the deploy status route, the
// watchdog, `--status` — can show/observe who holds the lock without needing
// bun:ffi. This module is the PURE codec for that file's content. It contains
// no fs/path/process access, so it is safe to import into the Next bundle
// (Turbopack's fs/path tracing can't trip on it) and into bun scripts alike,
// and it is unit-testable without a filesystem.
//
// Two on-disk shapes are parsed:
//   - PLAIN  : the bare PID string, e.g. `"12345"`. This is the STEADY STATE
//              the flock holder writes (deploy.ts and its spawned child).
//   - LEGACY JSON: `{"pid":12345,"token":"<hex>"}`. NEVER written by new code;
//              parsed ONLY so a one-time legacy `DEPLOY_LOCK_HANDOFF` webhook
//              transition (and any PID reader that races it) still extracts the
//              PID instead of misreading the JSON as "no live owner".
// ─────────────────────────────────────────────────────────────────────────────

/** Parsed deploy-lock file content. */
export interface LockContent {
  /** The owner PID, or null if the content is malformed / NaN. */
  pid: number | null;
  /** The handoff token, or null if this is a plain (PID-only) lock. */
  token: string | null;
  /** The raw bytes as read (trimmed), for exact-match release checks. */
  raw: string;
}

/**
 * Parse deploy-lock file content, accepting BOTH the plain `<pid>` form (the
 * steady state) and the legacy JSON `{"pid":N,"token":"…"}` form (transition
 * compat only).
 *
 * Robustness is the whole point: a PID reader must be able to extract the PID
 * from EITHER shape so it never misreads a live legacy-JSON lock (a bare
 * `parseInt` would yield NaN on the JSON form). A plain integer is the
 * common/steady case and is parsed first; only a leading `{` is treated as JSON.
 * Any parse failure degrades to `{ pid: null, token: null }`, which callers
 * treat as "malformed → no live owner".
 */
export function parseLockContent(raw: string): LockContent {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { pid: null, token: null, raw: trimmed };
  }

  // Legacy JSON form. Only attempt JSON.parse when it actually looks like an
  // object literal, so a plain decimal PID never goes down this path.
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj && typeof obj === "object") {
        const rec = obj as Record<string, unknown>;
        const pidVal = rec.pid;
        const tokenVal = rec.token;
        const pid =
          typeof pidVal === "number" && Number.isInteger(pidVal) && pidVal > 0
            ? pidVal
            : null;
        const token =
          typeof tokenVal === "string" && tokenVal.length > 0 ? tokenVal : null;
        return { pid, token, raw: trimmed };
      }
    } catch {
      // Malformed JSON — fall through to "unparseable".
    }
    return { pid: null, token: null, raw: trimmed };
  }

  // Plain PID form (the steady state). Mirror deploy.ts's historical
  // `parseInt(...)`: a leading integer wins; anything non-numeric → null.
  const pid = parseInt(trimmed, 10);
  return {
    pid: Number.isNaN(pid) ? null : pid,
    token: null,
    raw: trimmed,
  };
}

/**
 * Format the PLAIN lock content the flock holder writes. This is byte-identical
 * to `process.pid.toString()` — the steady-state lock format.
 */
export function formatPlainLock(pid: number): string {
  return pid.toString();
}

/**
 * Is the lock owned by exactly `pid`? Matches on PID identity for either content
 * shape. Malformed content (pid === null) is NOT owned by anyone — never treat
 * NaN/garbage as "mine".
 *
 * NOTE: the flock release no longer unlinks the (now PERMANENT) deploy.lock file,
 * so this is no longer used by release. It is retained as a pure-codec ownership
 * predicate (still unit-tested) for any reader that needs an exact-owner check.
 */
export function isOwnedByPid(content: LockContent, pid: number): boolean {
  return content.pid !== null && content.pid === pid;
}
