"use client";

/**
 * useTerminalWsUrl — shared resolver for the terminal WebSocket URL.
 *
 * Computes the URL based on `window.location` so the same logic works for:
 *   - Localhost development (uses `NEXT_PUBLIC_TERMINAL_PORT`, fallback 3001)
 *   - Remote access via cloudflared (https → wss, http → ws, `/ws` path)
 *   - SSR (returns the legacy `ws://localhost:3001` placeholder which is
 *     immediately replaced on hydration via `useMemo`)
 *
 * Extracted from {@link SessionManager} so the mobile single-session view
 * can reuse the exact same logic — previously {@link MobileApp} did not
 * pass `wsUrl` to {@link MobileSessionView}, so the hook default
 * (`ws://localhost:3001`) was used and the connection failed on every
 * deployment that wasn't dev (no localhost from a phone, wrong port on
 * localhost dev where the project default is 6002).
 */

import { useMemo } from "react";

/**
 * Pure resolver — exported separately so the SSR branch can be unit-tested
 * without rendering a hook (renderHook needs a real `window`, so we'd
 * never be able to exercise the `typeof window === "undefined"` branch
 * via renderHook alone).
 */
export function resolveTerminalWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const { protocol, hostname, port } = window.location;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalhost) {
    // Local development: use terminal server port directly
    return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
  }
  // Remote access via tunnel: use /ws path (cloudflared routes to terminal server)
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
}

export function useTerminalWsUrl(): string {
  return useMemo(() => resolveTerminalWsUrl(), []);
}
