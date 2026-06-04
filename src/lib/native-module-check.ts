/**
 * Native-module ABI health probe (remote-dev-7wgn).
 *
 * Homebrew silently auto-upgraded Node (NODE_MODULE_VERSION 141 → 147 in May
 * 2026), which broke the prebuilt `better-sqlite3` native addon by ABI mismatch.
 * Structured logging writes to `logs.db` THROUGH better-sqlite3, and the logger
 * swallows every write error (`AppLogger.writeToDb` has a bare `catch {}` so a
 * broken logger never crashes the app). The net effect: `logs.db` writes were
 * silently dead for ~3 weeks, surfacing only as a generic, easy-to-miss
 * "Log pruning failed" line at startup.
 *
 * This module provides a small, PURE classifier (`isAbiMismatchError`) plus an
 * active probe (`probeBetterSqlite3`) that opens a throwaway in-memory
 * `better-sqlite3` database. `register()` in `src/instrumentation.ts` calls the
 * probe early and, on an ABI mismatch, emits ONE loud, specific, grep-able error
 * via the structured logger — instead of the failure hiding as a generic
 * downstream symptom.
 *
 * It deliberately does NOT crash the process: a logging-DB ABI mismatch is
 * non-fatal to the web app (the app's MAIN DB is libsql, not better-sqlite3), so
 * the right response is "loud and unmistakable", not "down".
 */

/** Marker string the Node loader uses in every native-ABI-mismatch message. */
const NODE_MODULE_VERSION_MARKER = "NODE_MODULE_VERSION";

/** Node's error code when a `.node` addon fails to `dlopen` (incl. ABI skew). */
const DLOPEN_FAILED_CODE = "ERR_DLOPEN_FAILED";

/**
 * Classify whether an unknown thrown value is a native-module ABI mismatch.
 *
 * Node raises this when a prebuilt/compiled `.node` addon was built against a
 * different NODE_MODULE_VERSION than the running runtime. The canonical message
 * is e.g.:
 *
 *   The module '/…/better_sqlite3.node' was compiled against a different
 *   Node.js version using NODE_MODULE_VERSION 141. This version of Node.js
 *   requires NODE_MODULE_VERSION 147. Please try re-compiling or re-installing
 *   the module …
 *
 * …carried on an Error whose `code` is `ERR_DLOPEN_FAILED`. We match on EITHER
 * signal so the classifier is robust to wording changes across Node versions:
 * the `NODE_MODULE_VERSION` marker (present in the message) OR the
 * `ERR_DLOPEN_FAILED` code. Pure and side-effect-free so it is unit-testable
 * without a real broken addon.
 */
export function isAbiMismatchError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code === DLOPEN_FAILED_CODE) return true;

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.includes(NODE_MODULE_VERSION_MARKER)) {
    return true;
  }

  return false;
}

/** Outcome of an active native-module probe. */
export interface NativeModuleProbeResult {
  /** True when the module loaded and a trivial operation succeeded. */
  ok: boolean;
  /** True ONLY when the failure was classified as an ABI / NODE_MODULE_VERSION mismatch. */
  abiMismatch: boolean;
  /** Stringified underlying error (present only when `ok` is false). */
  error?: string;
}

/**
 * Actively probe `better-sqlite3` by opening a throwaway `:memory:` database and
 * running a trivial query, then closing it. Returns a structured result instead
 * of throwing so callers can decide how loud to be.
 *
 * `abiMismatch` is set only when `isAbiMismatchError` classifies the failure as
 * an ABI skew; other failures (e.g. a genuinely missing module) still report
 * `ok: false` but `abiMismatch: false`, so the caller can phrase its message
 * precisely.
 *
 * The `better-sqlite3` import is dynamic so this helper never pulls the Node-only
 * native addon into a non-Node (edge) bundle merely by being imported.
 */
export async function probeBetterSqlite3(): Promise<NativeModuleProbeResult> {
  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    const db = new Database(":memory:");
    try {
      db.prepare("SELECT 1").get();
    } finally {
      db.close();
    }
    return { ok: true, abiMismatch: false };
  } catch (error) {
    return {
      ok: false,
      abiMismatch: isAbiMismatchError(error),
      error: String(error),
    };
  }
}
