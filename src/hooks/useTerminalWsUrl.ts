"use client";

/**
 * Resolves the terminal WebSocket URL for both client (`window.location`)
 * and server (`headers()`) callers. Behavior:
 *   - Localhost dev → `ws://localhost:${NEXT_PUBLIC_TERMINAL_PORT ?? 3001}`
 *   - Remote (cloudflared tunnel) → `wss?://<host>[:port]/ws`
 *   - SSR with no host context → `ws://localhost:3001` placeholder
 *
 * Shared between `SessionManager`, `MobileApp`, and the Server Component
 * `/m/session/[id]` page so all three views resolve the URL identically.
 *
 * The mobile session page (Server Component) must use
 * `resolveTerminalWsUrlFromHostHeader` since it has no `window` — building
 * the URL from the request `Host` header instead. Both helpers route to
 * the same underlying logic to avoid drift.
 */

import { useMemo } from "react";

/**
 * Core resolver, decoupled from how the protocol/host are sourced. Takes
 * a `protocol` string in either browser form (`"https:"`) or header form
 * (`"https"`) and a `host` value that may include a `:port` suffix.
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

/**
 * Server-side variant for use inside Next.js Server Components / Route
 * Handlers that have access to the request headers but not `window`.
 * Pass `host` from `headers().get("host")` and `protocol` from
 * `headers().get("x-forwarded-proto")` (or `"http"` as a fallback).
 */
export function resolveTerminalWsUrlFromHostHeader(input: {
  host: string;
  protocol: string;
}): string {
  return resolveTerminalWsUrlFromHost(input);
}

/**
 * Client-side resolver, exported for unit tests — `renderHook` requires
 * a real `window`, so the SSR branch can only be exercised by calling
 * this directly with `window` stubbed out.
 */
export function resolveTerminalWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const { protocol, host } = window.location;
  return resolveTerminalWsUrlFromHost({ protocol, host });
}

export function useTerminalWsUrl(): string {
  return useMemo(() => resolveTerminalWsUrl(), []);
}
