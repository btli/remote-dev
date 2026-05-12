"use client";

/**
 * Resolves the terminal WebSocket URL from `window.location`:
 *   - Localhost dev → `ws://localhost:${NEXT_PUBLIC_TERMINAL_PORT ?? 3001}`
 *   - Remote (cloudflared tunnel) → `wss?://<host>[:port]/ws`
 *   - SSR → `ws://localhost:3001` placeholder (replaced on hydration)
 *
 * Shared between `SessionManager` and `MobileApp` so both views resolve
 * the URL identically.
 */

import { useMemo } from "react";

/**
 * Pure resolver, exported for unit tests — `renderHook` requires a real
 * `window`, so the SSR branch can only be exercised by calling this
 * directly with `window` stubbed out.
 */
export function resolveTerminalWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const { protocol, hostname, port } = window.location;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalhost) {
    return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
  }
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
}

export function useTerminalWsUrl(): string {
  return useMemo(() => resolveTerminalWsUrl(), []);
}
