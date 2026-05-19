/**
 * RDV_BASE_PATH helpers — single source of truth for URL prefix handling.
 *
 * The entire codebase reads basePath through this module; no other file should
 * parse `process.env.RDV_BASE_PATH` directly (with one documented exception:
 * `next.config.ts`, which loads before any module graph exists).
 *
 * Env is read once at module load. Setting RDV_BASE_PATH at runtime has no
 * effect — restart the process to change it. Tests that need to exercise
 * multiple env states must use `vi.resetModules()` plus dynamic
 * `await import("../base-path")` (see `src/lib/__tests__/base-path.test.ts`).
 */

const RAW = process.env.RDV_BASE_PATH ?? "";

function validateBasePath(input: string): string {
  if (input === "") return "";
  if (!/^(\/[a-z0-9][a-z0-9-]*)+$/.test(input)) {
    const message =
      `Invalid RDV_BASE_PATH: ${JSON.stringify(input)}. ` +
      `Must be empty or match /[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*`;
    // The logger isn't safe to import here — base-path.ts sits very low in
    // the module graph (consumed by both server entry points). The throw
    // below would otherwise surface as a bare unhandled-rejection stack
    // trace at process startup, with no namespace. Writing to stderr first
    // gives operators a clear, prefixed error before the crash.
    //
    // Note: next.config.ts bypasses this validation entirely — it reads
    // `process.env.RDV_BASE_PATH` directly because it loads before any
    // module graph exists. Malformed values that Next.js itself can't
    // parse will fail with a separate `next build` error.
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(`[fatal] [BasePath] ${message}\n`);
    }
    throw new Error(message);
  }
  return input;
}

/** The validated URL prefix this instance owns. Empty string for default deployments. */
export const BASE_PATH: string = validateBasePath(RAW);

/**
 * Human-readable instance name. Used in cookie names, response headers,
 * and (eventually) UI titles. Defaults to the last segment of BASE_PATH.
 */
export const INSTANCE_SLUG: string =
  process.env.RDV_INSTANCE_SLUG ??
  (BASE_PATH ? (BASE_PATH.split("/").filter(Boolean).at(-1) ?? "") : "");

/** Cookie path: must be "/" when no prefix, else the prefix itself. */
export const COOKIE_PATH: string = BASE_PATH || "/";

/** Terminal-server WebSocket upgrade path, e.g. "/alpha/ws" or "/ws". */
export const WS_PATH_PREFIX: string = `${BASE_PATH}/ws`;

/**
 * Prepend BASE_PATH to an absolute URL path. Returns `input` unchanged when
 * BASE_PATH is empty or when `input` is not an absolute path.
 *
 * Examples (BASE_PATH=/alpha):
 *   prefixPath("/api/foo") → "/alpha/api/foo"
 *   prefixPath("/")        → "/alpha"
 *   prefixPath("foo")      → "foo"          (unchanged: not absolute)
 *   prefixPath("https://…")→ "https://…"    (unchanged: not absolute)
 */
export function prefixPath(input: string): string {
  if (!input.startsWith("/")) return input;
  if (BASE_PATH === "") return input;
  if (input === "/") return BASE_PATH;
  return BASE_PATH + input;
}
