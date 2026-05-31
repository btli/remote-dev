"use client";

/**
 * Client-side wrappers around the pure `resolveTerminalWsUrlFromHost`
 * resolver (in `@/lib/terminal-ws-url`):
 *
 *   - `resolveTerminalWsUrl()` reads `window.location` directly. Falls
 *     back to `ws://localhost:3001` during SSR (no `window`).
 *   - `useTerminalWsUrl()` memoizes the resolved URL inside React.
 *
 * Server Components must NOT import from this file — anything exported
 * from a `"use client"` module is materialized as a client reference by
 * Next.js and crashes when invoked on the server. Server code should
 * import `resolveTerminalWsUrlFromHost` from `@/lib/terminal-ws-url`
 * directly and pass the host/proto from request headers.
 *
 * basePath: the page's base path is embedded into `window.__RDV_BASE_PATH__`
 * by a SSR script in `src/app/layout.tsx`, so the runtime prefix is known
 * to the browser without rebuilding the image. Empty string means no
 * prefix (the default deployment).
 */

import { useMemo } from "react";

import { resolveTerminalWsUrlFromHost } from "@/lib/terminal-ws-url";

// `Window.__RDV_BASE_PATH__` is declared globally in `src/types/window.d.ts`.

/**
 * Browser-side resolver, exported for unit tests — `renderHook` requires
 * a real `window`, so the SSR branch can only be exercised by calling
 * this directly with `window` stubbed out.
 */
export function resolveTerminalWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const { protocol, host } = window.location;
  return resolveTerminalWsUrlFromHost({
    protocol,
    host,
    basePath: window.__RDV_BASE_PATH__ || "",
  });
}

export function useTerminalWsUrl(): string {
  return useMemo(() => resolveTerminalWsUrl(), []);
}
