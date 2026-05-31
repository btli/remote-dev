/**
 * Tests for the pure `resolveTerminalWsUrlFromHost` resolver. This is the
 * shape called by the `/m/session/[id]` Server Component, which has no
 * `window` and must build the WebSocket URL from the request `Host`
 * header + `X-Forwarded-Proto`. The header form of the protocol has no
 * trailing colon ("https", not "https:"), so the resolver must accept
 * both shapes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resolveTerminalWsUrlFromHost } from "@/lib/terminal-ws-url";

describe("resolveTerminalWsUrlFromHost", () => {
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
    input: { host: string; protocol: string; basePath?: string };
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
      // resolver must swap to the terminal port. The path is still `/ws`
      // because the terminal server's upgrade gate matches `WS_PATH_PREFIX`
      // even on localhost.
      name: "local dev with host port collapses to NEXT_PUBLIC_TERMINAL_PORT + /ws",
      input: { host: "localhost:6001", protocol: "http" },
      expected: "ws://localhost:6002/ws",
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
      // Regression guard: an explicit port on localhost must still hit
      // the terminal port — not the request port — and must include /ws.
      name: "localhost:6001 stays on terminal port AND uses /ws",
      input: { host: "localhost:6001", protocol: "http" },
      expected: "ws://localhost:6002/ws",
    },
    {
      // happy-path: trailing colon accepted (some frameworks pass the
      // protocol in window.location form even server-side).
      name: "accepts trailing-colon protocol form",
      input: { host: "dev.bryanli.net", protocol: "https:" },
      expected: "wss://dev.bryanli.net/ws",
    },
    {
      // 127.0.0.1 must be treated the same as the literal "localhost"
      // hostname so the localhost branch fires regardless of which form
      // the caller resolves.
      name: "127.0.0.1 is treated as localhost",
      input: { host: "127.0.0.1:6001", protocol: "http" },
      expected: "ws://localhost:6002/ws",
    },
    {
      // Multi-instance: with a basePath set, the localhost branch must
      // also include the prefix because the upgrade gate enforces
      // `{BASE_PATH}/ws`. Without this the dev terminal server returns
      // 404 on the WS upgrade.
      name: "localhost with basePath → ws://localhost:port{basePath}/ws",
      input: { host: "localhost:6001", protocol: "http", basePath: "/alpha" },
      expected: "ws://localhost:6002/alpha/ws",
    },
    {
      // Multi-instance remote: prefix is appended before /ws on the
      // remote branch too.
      name: "remote with basePath → wss://host{basePath}/ws",
      input: { host: "dev.bryanli.net", protocol: "https", basePath: "/alpha" },
      expected: "wss://dev.bryanli.net/alpha/ws",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(resolveTerminalWsUrlFromHost(input)).toBe(expected);
    });
  }

  it("falls back to port 3001 on localhost when NEXT_PUBLIC_TERMINAL_PORT is unset", () => {
    delete process.env.NEXT_PUBLIC_TERMINAL_PORT;
    expect(
      resolveTerminalWsUrlFromHost({
        host: "localhost:6001",
        protocol: "http",
      }),
    ).toBe("ws://localhost:3001/ws");
  });
});
