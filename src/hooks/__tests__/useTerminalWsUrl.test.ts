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

  const cases: Array<{
    name: string;
    location: { protocol: string; hostname: string; port?: string };
    expected: string;
  }> = [
    {
      name: "localhost uses NEXT_PUBLIC_TERMINAL_PORT",
      location: { protocol: "http:", hostname: "localhost", port: "6001" },
      expected: "ws://localhost:6002",
    },
    {
      name: "127.0.0.1 is treated as localhost",
      location: { protocol: "http:", hostname: "127.0.0.1", port: "6001" },
      expected: "ws://localhost:6002",
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
    expect(resolveTerminalWsUrl()).toBe("ws://localhost:3001");
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
