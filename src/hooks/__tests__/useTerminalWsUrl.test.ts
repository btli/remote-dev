/**
 * Tests for `useTerminalWsUrl` and the underlying `resolveTerminalWsUrl`.
 * Covers the four deployment shapes the terminal WebSocket runs in:
 * localhost dev, https tunnel, http tunnel, and SSR.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  useTerminalWsUrl,
  resolveTerminalWsUrl,
  resolveTerminalWsUrlFromHostHeader,
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

describe("resolveTerminalWsUrlFromHostHeader", () => {
  // Server-side variant used by the `/m/session/[id]` Server Component,
  // which has no `window` and must build the URL from the request `Host`
  // header + `X-Forwarded-Proto`. The header form of the protocol has no
  // trailing colon ("https", not "https:"), so the resolver must accept
  // both shapes.
  const originalEnv = process.env.NEXT_PUBLIC_TERMINAL_PORT;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TERMINAL_PORT = "6002";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    } else {
      process.env.NEXT_PUBLIC_TERMINAL_PORT = originalEnv;
    }
  });

  const cases: Array<{
    name: string;
    input: { host: string; protocol: string };
    expected: string;
  }> = [
    {
      // Production: Cloudflare tunnel terminates TLS at the edge and
      // forwards `/ws` to the terminal server. Direct port hits would
      // be unreachable through the tunnel.
      name: "production CF tunnel → wss://host/ws",
      input: { host: "dev.bryanli.net", protocol: "https" },
      expected: "wss://dev.bryanli.net/ws",
    },
    {
      // Local dev: the Next.js host (port 6001) and terminal server
      // (NEXT_PUBLIC_TERMINAL_PORT) live on different ports, so the
      // resolver must swap to the terminal port, not preserve 6001.
      name: "local dev with host port collapses to NEXT_PUBLIC_TERMINAL_PORT",
      input: { host: "localhost:6001", protocol: "http" },
      expected: "ws://localhost:6002",
    },
    {
      // LAN / direct-IP access: no CF tunnel in front, but the path is
      // still `/ws` because Cloudflare Access reverse-proxies via path
      // routing and we mirror that behavior for any non-localhost host.
      name: "LAN IP → ws://host:port/ws (preserves request port)",
      input: { host: "192.168.1.5:6001", protocol: "http" },
      expected: "ws://192.168.1.5:6001/ws",
    },
    {
      // Regression guard: an explicit port on localhost must NOT cause
      // the resolver to fall through to the `/ws` branch — localhost is
      // always direct to the terminal port.
      name: "localhost:6001 stays on terminal port, not /ws",
      input: { host: "localhost:6001", protocol: "http" },
      expected: "ws://localhost:6002",
    },
    {
      // happy-path: trailing colon accepted (some frameworks pass the
      // protocol in window.location form even server-side).
      name: "accepts trailing-colon protocol form",
      input: { host: "dev.bryanli.net", protocol: "https:" },
      expected: "wss://dev.bryanli.net/ws",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(resolveTerminalWsUrlFromHostHeader(input)).toBe(expected);
    });
  }

  it("falls back to port 3001 on localhost when NEXT_PUBLIC_TERMINAL_PORT is unset", () => {
    delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    expect(
      resolveTerminalWsUrlFromHostHeader({
        host: "localhost:6001",
        protocol: "http",
      }),
    ).toBe("ws://localhost:3001");
  });
});
