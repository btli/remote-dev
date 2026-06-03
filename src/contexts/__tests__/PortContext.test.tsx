/**
 * PortContext tests (A5 / remote-dev-dk42).
 *
 * Focused on the A4 seam wiring added in A5:
 *  - `livePorts` is populated from `GET /api/ports/proxyable`.
 *  - `isPortActive` reflects the live listening set.
 *  - `getProxyUrl` (B2) returns the prefixed `/proxy/<port>/` proxy path.
 *
 * The global `tests/setup.ts` mocks `@/contexts/PortContext`, so we unmock it
 * here to exercise the real provider, and mock `@/lib/api-fetch` instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { ProxyablePort } from "@/types/port";

vi.unmock("@/contexts/PortContext");

const apiFetchMock = vi.fn();
// `prefixApiPath` is the client-safe base-path prefixer `getProxyUrl` uses.
// The test env has no `RDV_BASE_PATH`, so it is an identity pass-through here.
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  prefixApiPath: (input: string) => input,
}));

// Imported after the mocks above are registered.
import { PortProvider, usePortContext } from "@/contexts/PortContext";

const LIVE_PORTS: ProxyablePort[] = [
  {
    port: 3000,
    isListening: true,
    pid: 4242,
    process: "node",
    sessionId: "sess-1",
    sessionName: "web",
    projectId: "proj-1",
    variableName: "PORT",
    source: "both",
  },
  {
    port: 5173,
    isListening: false,
    pid: null,
    process: null,
    sessionId: "sess-2",
    sessionName: "vite",
    projectId: "proj-1",
    variableName: "VITE_PORT",
    source: "claim",
  },
];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function routeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : String(input);
  if (url.includes("/api/ports/proxyable")) {
    return Promise.resolve(jsonResponse({ ports: LIVE_PORTS }));
  }
  if (url.includes("/api/ports/status")) {
    return Promise.resolve(jsonResponse({ ports: [], checkedAt: "now" }));
  }
  if (url.includes("/api/ports")) {
    return Promise.resolve(jsonResponse({ allocations: [] }));
  }
  return Promise.resolve(jsonResponse({}));
}

function wrapper({ children }: { children: ReactNode }) {
  return <PortProvider>{children}</PortProvider>;
}

describe("PortContext (A5 seam wiring)", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(routeFetch);
  });

  it("populates livePorts from GET /api/ports/proxyable", async () => {
    const { result } = renderHook(() => usePortContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.livePorts).toHaveLength(2);
    });
    expect(result.current.livePorts.map((p) => p.port)).toEqual([3000, 5173]);

    // The proxyable seam endpoint was actually hit.
    const calledUrls = apiFetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/api/ports/proxyable"))).toBe(true);
  });

  it("reflects the live listening set in isPortActive", async () => {
    const { result } = renderHook(() => usePortContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.livePorts.length).toBeGreaterThan(0);
    });

    // 3000 is listening, 5173 is claim-only (not listening).
    expect(result.current.isPortActive(3000)).toBe(true);
    expect(result.current.isPortActive(5173)).toBe(false);
    expect(result.current.isPortActive(9999)).toBe(false);
  });

  it("getProxyUrl returns the prefixed /proxy/<port>/ path", async () => {
    const { result } = renderHook(() => usePortContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.livePorts.length).toBeGreaterThan(0);
    });

    // No RDV_BASE_PATH in the test env → bare `/proxy/<port>/` (trailing slash).
    expect(result.current.getProxyUrl(6000)).toBe("/proxy/6000/");
    expect(result.current.getProxyUrl(3000)).toBe("/proxy/3000/");
    expect(result.current.getProxyUrl(5173)).toBe("/proxy/5173/");
  });

  it("getProxyUrl returns null for an invalid port", async () => {
    const { result } = renderHook(() => usePortContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.livePorts.length).toBeGreaterThan(0);
    });

    expect(result.current.getProxyUrl(0)).toBeNull();
    expect(result.current.getProxyUrl(70000)).toBeNull();
    expect(result.current.getProxyUrl(3.5)).toBeNull();
  });
});
