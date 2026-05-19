/**
 * Pure (non-"use client") resolver for the terminal WebSocket URL.
 *
 * Lives in `src/lib/` rather than `src/hooks/` so Server Components can
 * import and call it directly. The client-side `useTerminalWsUrl` hook
 * and the `window`-based `resolveTerminalWsUrl` wrapper live in
 * `src/hooks/useTerminalWsUrl.ts` and delegate here.
 *
 * Behavior:
 *   - Localhost dev → `ws://localhost:${NEXT_PUBLIC_TERMINAL_PORT ?? 3001}{basePath}/ws`
 *     (terminal server listens on its own port AND enforces the
 *     `WS_PATH_PREFIX` upgrade gate, which is `/ws` when BASE_PATH is
 *     empty or `{basePath}/ws` otherwise — so the client must include
 *     the full path even in dev).
 *   - Remote (cloudflared tunnel) → `wss?://<host>[:port]{basePath}/ws`
 *
 * Accepts protocol in either browser form (`"https:"`) or header form
 * (`"https"`); the trailing colon is normalized away.
 */

export function resolveTerminalWsUrlFromHost(input: {
  protocol: string;
  host: string;
  /**
   * Browser-side base path — `window.__RDV_BASE_PATH__` or "". Server-side
   * callers should pass `BASE_PATH` from `@/lib/base-path`. Empty by default
   * to preserve byte-identical behavior for the no-prefix deployment.
   */
  basePath?: string;
}): string {
  // Strip a trailing `:` so this accepts both `window.location.protocol`
  // ("https:") and `x-forwarded-proto` ("https").
  const normalizedProto = input.protocol.replace(/:$/, "");
  const [hostname, port] = splitHost(input.host);
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  // Defensive trim: callers should already pass a clean prefix, but
  // tolerating a trailing slash avoids `//ws` if a future caller composes
  // the prefix sloppily.
  const prefix = (input.basePath || "").replace(/\/$/, "");
  if (isLocalhost) {
    // Localhost dev: terminal server listens on its own port, but the
    // upgrade gate in `src/server/terminal.ts` requires the path to equal
    // `WS_PATH_PREFIX` (`{BASE_PATH}/ws`). So we still append `{prefix}/ws`
    // even though we're talking directly to the dev terminal port and not
    // going through an ingress.
    return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}${prefix}/ws`;
  }
  const wsProtocol = normalizedProto === "https" ? "wss:" : "ws:";
  return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}${prefix}/ws`;
}

function splitHost(host: string): [string, string | undefined] {
  const idx = host.indexOf(":");
  if (idx === -1) return [host, undefined];
  return [host.slice(0, idx), host.slice(idx + 1)];
}
