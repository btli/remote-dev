/**
 * Client-side `fetch` wrapper that prepends `RDV_BASE_PATH`.
 *
 * Next.js's `basePath` only auto-prefixes `<Link href>` and router pushes —
 * it does NOT prefix raw `fetch("/api/...")` calls. The browser resolves
 * `fetch("/api/foo")` against `window.location.origin`, which is the bare
 * host (`https://example.com`) and does not include the deployment prefix.
 * Under multi-instance hosting (`RDV_BASE_PATH=/alpha`), a bare `fetch`
 * call would therefore hit `https://example.com/api/foo` and 404 — every
 * client-side data fetch would break.
 *
 * This module is the single source of truth for client fetches. Every
 * call site that hits a same-origin `/api/...` (or `/login`, `/profile`,
 * etc.) goes through `apiFetch`, which reads the runtime basePath from
 * `window.__RDV_BASE_PATH__` (SSR-injected by `src/app/layout.tsx`) and
 * prepends it before delegating to native `fetch`.
 *
 * Absolute URLs and protocol-relative URLs pass through unchanged.
 *
 * Server-side fetches (route handlers, etc.) MUST NOT use this helper —
 * they have no `window` and call internal APIs via `process.env.AUTH_URL`
 * or relative module imports. The helper falls back to the SSR-friendly
 * value of `BASE_PATH` from `@/lib/base-path` when `window` is undefined,
 * but the recommended pattern is to call `prefixPath` directly server-side.
 */

import { BASE_PATH, prefixPath } from "@/lib/base-path";

/**
 * Resolve the runtime basePath. On the client we read the SSR-injected
 * `window.__RDV_BASE_PATH__` so the same JS bundle works across instances
 * (per spec NF-4: the build artifact does not bake basePath in). On the
 * server we fall back to the import-time `BASE_PATH` constant.
 */
function runtimeBasePath(): string {
  if (typeof window !== "undefined") {
    return window.__RDV_BASE_PATH__ ?? BASE_PATH;
  }
  return BASE_PATH;
}

/**
 * Prepend the runtime basePath to a same-origin absolute path.
 *
 * Pass-through for:
 *  - relative paths (no leading `/`)
 *  - protocol-qualified URLs (`https://...`, `wss://...`)
 *  - protocol-relative URLs (`//host/path`)
 */
export function prefixApiPath(input: string): string {
  if (!input.startsWith("/")) return input;
  if (input.startsWith("//")) return input; // protocol-relative
  const base = runtimeBasePath();
  if (base === "") return input;
  // Use the same semantics as `prefixPath` from `@/lib/base-path`, but with
  // the runtime basePath. Reusing the helper directly is wrong here because
  // it captures `BASE_PATH` at import time on the server.
  if (input === "/") return base;
  return base + input;
}

/**
 * Same-origin fetch wrapper that prefixes absolute `/api/...` paths with
 * the runtime basePath. Other inputs (full URLs, `Request` instances,
 * relative paths) pass through unchanged.
 *
 * Drop-in replacement for `fetch` in client code:
 *
 *   import { apiFetch } from "@/lib/api-fetch";
 *   const res = await apiFetch("/api/sessions");
 *
 * Server code can import `prefixPath` directly from `@/lib/base-path`.
 */
export function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (typeof input === "string") {
    return fetch(prefixApiPath(input), init);
  }
  return fetch(input, init);
}

// Re-export so consumers can build their own URLs (e.g. `new URL(...)`).
export { prefixPath };
