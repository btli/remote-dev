/**
 * Tests for `useTerminalWsUrl` — verifies the resolver covers the four
 * deployment shapes the terminal WebSocket runs in:
 *   1. Localhost dev (uses NEXT_PUBLIC_TERMINAL_PORT, fallback 3001)
 *   2. Remote https tunnel (wss://hostname/ws)
 *   3. Remote http tunnel (ws://hostname/ws)
 *   4. SSR / `typeof window === "undefined"` (legacy ws://localhost:3001)
 *
 * Background: this hook was extracted from SessionManager because MobileApp
 * was not passing `wsUrl` into MobileSessionView, leaving the mobile
 * single-session view stuck on "Reconnecting" — see remote-dev-8h39.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  useTerminalWsUrl,
  resolveTerminalWsUrl,
} from "@/hooks/useTerminalWsUrl";

// Save the real `window.location` so we can restore it between tests.
const REAL_LOCATION = window.location;

function setLocation(opts: {
  protocol: string;
  hostname: string;
  port?: string;
}): void {
  // happy-dom: window.location is read-only via assignment but we can
  // replace it via Object.defineProperty.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...REAL_LOCATION,
      protocol: opts.protocol,
      hostname: opts.hostname,
      port: opts.port ?? "",
      host: opts.port ? `${opts.hostname}:${opts.port}` : opts.hostname,
      href: `${opts.protocol}//${opts.hostname}${opts.port ? `:${opts.port}` : ""}/`,
    },
  });
}

describe("useTerminalWsUrl", () => {
  const originalEnv = process.env.NEXT_PUBLIC_TERMINAL_PORT;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TERMINAL_PORT = "6002";
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: REAL_LOCATION,
    });
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    } else {
      process.env.NEXT_PUBLIC_TERMINAL_PORT = originalEnv;
    }
  });

  it("returns ws://localhost:<NEXT_PUBLIC_TERMINAL_PORT> on localhost", () => {
    setLocation({ protocol: "http:", hostname: "localhost", port: "6001" });
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("ws://localhost:6002");
  });

  it("treats 127.0.0.1 as localhost", () => {
    setLocation({ protocol: "http:", hostname: "127.0.0.1", port: "6001" });
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("ws://localhost:6002");
  });

  it("falls back to port 3001 on localhost when NEXT_PUBLIC_TERMINAL_PORT is unset", () => {
    delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    setLocation({ protocol: "http:", hostname: "localhost", port: "6001" });
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("ws://localhost:3001");
  });

  it("returns wss://<host>/ws over https (cloudflared tunnel, default port)", () => {
    setLocation({ protocol: "https:", hostname: "rdv.example.com" });
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("wss://rdv.example.com/ws");
  });

  it("returns wss://<host>:<port>/ws over https with an explicit port", () => {
    setLocation({
      protocol: "https:",
      hostname: "rdv.example.com",
      port: "8443",
    });
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("wss://rdv.example.com:8443/ws");
  });

  it("returns ws://<host>/ws over http on a non-localhost hostname", () => {
    setLocation({ protocol: "http:", hostname: "rdv.lan" });
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("ws://rdv.lan/ws");
  });

  it("returns the legacy ws://localhost:3001 placeholder during SSR", () => {
    // We can't drive useMemo via renderHook with `window` undefined
    // because React itself reads `window` during render. Instead we
    // exercise the pure resolver — the hook is just `useMemo(resolve, [])`
    // and the SSR branch lives entirely in `resolveTerminalWsUrl`.
    vi.stubGlobal("window", undefined);
    try {
      expect(resolveTerminalWsUrl()).toBe("ws://localhost:3001");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
