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
    throw new Error(
      `Invalid RDV_BASE_PATH: ${JSON.stringify(input)}. ` +
        `Must be empty or match /[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*`,
    );
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
  (BASE_PATH ? BASE_PATH.replace(/^\//, "").split("/").pop()! : "");

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
