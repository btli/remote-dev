/**
 * Pure (non-"use client") resolver for the terminal WebSocket URL.
 *
 * Lives in `src/lib/` rather than `src/hooks/` so Server Components can
 * import and call it directly. The client-side `useTerminalWsUrl` hook
 * and the `window`-based `resolveTerminalWsUrl` wrapper live in
 * `src/hooks/useTerminalWsUrl.ts` and delegate here.
 *
 * Behavior:
 *   - Localhost dev → `ws://localhost:${NEXT_PUBLIC_TERMINAL_PORT ?? 3001}`
 *   - Remote (cloudflared tunnel) → `wss?://<host>[:port]/ws`
 *
 * Accepts protocol in either browser form (`"https:"`) or header form
 * (`"https"`); the trailing colon is normalized away.
 */

export function resolveTerminalWsUrlFromHost(input: {
  protocol: string;
  host: string;
}): string {
  // Strip a trailing `:` so this accepts both `window.location.protocol`
  // ("https:") and `x-forwarded-proto` ("https").
  const normalizedProto = input.protocol.replace(/:$/, "");
  const [hostname, port] = splitHost(input.host);
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalhost) {
    return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
  }
  const wsProtocol = normalizedProto === "https" ? "wss:" : "ws:";
  return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
}

function splitHost(host: string): [string, string | undefined] {
  const idx = host.indexOf(":");
  if (idx === -1) return [host, undefined];
  return [host.slice(0, idx), host.slice(idx + 1)];
}
