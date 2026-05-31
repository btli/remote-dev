/**
 * Tests for `useTerminalWsUrl` and the `window`-backed
 * `resolveTerminalWsUrl`. Covers the four deployment shapes the terminal
 * WebSocket runs in from a browser perspective: localhost dev, https
 * tunnel, http tunnel, and SSR.
 *
 * The pure header-driven resolver lives in `@/lib/terminal-ws-url` and
 * has its own test file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  useTerminalWsUrl,
  resolveTerminalWsUrl,
} from "@/hooks/useTerminalWsUrl";

const REAL_LOCATION = window.location;

function setLocation(opts: {
  protocol: string;
  hostname: string;
  port?: string;
}): void {
  // happy-dom: window.location is read-only via assignment; replace via defineProperty.
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

function setBasePath(value: string | undefined): void {
  if (value === undefined) {
    // Important: the resolver checks for absence, not just empty string.
    delete (window as Window & { __RDV_BASE_PATH__?: string }).__RDV_BASE_PATH__;
  } else {
    (window as Window & { __RDV_BASE_PATH__?: string }).__RDV_BASE_PATH__ = value;
  }
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
    setBasePath(undefined);
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    } else {
      process.env.NEXT_PUBLIC_TERMINAL_PORT = originalEnv;
    }
  });

  const cases: Array<{
    name: string;
    location: { protocol: string; hostname: string; port?: string };
    expected: string;
  }> = [
    {
      name: "localhost uses NEXT_PUBLIC_TERMINAL_PORT + /ws",
      location: { protocol: "http:", hostname: "localhost", port: "6001" },
      expected: "ws://localhost:6002/ws",
    },
    {
      name: "127.0.0.1 is treated as localhost",
      location: { protocol: "http:", hostname: "127.0.0.1", port: "6001" },
      expected: "ws://localhost:6002/ws",
    },
    {
      name: "https tunnel without explicit port → wss://host/ws",
      location: { protocol: "https:", hostname: "rdv.example.com" },
      expected: "wss://rdv.example.com/ws",
    },
    {
      name: "https tunnel with explicit port → wss://host:port/ws",
      location: { protocol: "https:", hostname: "rdv.example.com", port: "8443" },
      expected: "wss://rdv.example.com:8443/ws",
    },
    {
      name: "http on non-localhost hostname → ws://host/ws",
      location: { protocol: "http:", hostname: "rdv.lan" },
      expected: "ws://rdv.lan/ws",
    },
  ];

  for (const { name, location, expected } of cases) {
    it(name, () => {
      setLocation(location);
      const { result } = renderHook(() => useTerminalWsUrl());
      expect(result.current).toBe(expected);
    });
  }

  it("falls back to port 3001 on localhost when NEXT_PUBLIC_TERMINAL_PORT is unset", () => {
    delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    setLocation({ protocol: "http:", hostname: "localhost", port: "6001" });
    expect(resolveTerminalWsUrl()).toBe("ws://localhost:3001/ws");
  });

  it("appends window.__RDV_BASE_PATH__ to remote WS URLs", () => {
    setLocation({ protocol: "https:", hostname: "rdv.example.com" });
    setBasePath("/alpha");
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("wss://rdv.example.com/alpha/ws");
  });

  it("ignores empty basePath on remote WS URLs (back-compat with single-instance)", () => {
    setLocation({ protocol: "https:", hostname: "rdv.example.com" });
    setBasePath("");
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("wss://rdv.example.com/ws");
  });

  it("appends basePath on localhost too — the dev terminal server's upgrade gate matches WS_PATH_PREFIX", () => {
    // Regression guard for Phase 1: pre-fix the localhost branch returned
    // `ws://localhost:6002` (no path), but `WS_PATH_PREFIX` is
    // `{BASE_PATH}/ws` so the upgrade was rejected with 404.
    setLocation({ protocol: "http:", hostname: "localhost", port: "6001" });
    setBasePath("/alpha");
    const { result } = renderHook(() => useTerminalWsUrl());
    expect(result.current).toBe("ws://localhost:6002/alpha/ws");
  });

  it("returns the legacy ws://localhost:3001 placeholder during SSR", () => {
    // `renderHook` always provides a real `window`, so the SSR branch can
    // only be exercised by calling the resolver with `window` stubbed out.
    vi.stubGlobal("window", undefined);
    try {
      expect(resolveTerminalWsUrl()).toBe("ws://localhost:3001");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
