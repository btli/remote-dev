// @vitest-environment happy-dom
/**
 * Tests for the lazy SSH connections cache that backs the New SSH submenu
 * in the sidebar `+` menu and the project context menu. Verifies:
 *   - First mount triggers exactly one fetch
 *   - Second concurrent mount reuses the cache (no duplicate fetch)
 *   - invalidateSshConnections() clears the cache so the next render fetches again
 *   - Subscriber re-renders fire when the cache mutates
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useSshConnectionsLazy,
  invalidateSshConnections,
  _resetSshConnectionsCache,
} from "../NewSshSubmenu";

const SAMPLE = {
  connections: [
    {
      id: "c1",
      name: "Prod",
      host: "10.0.0.1",
      port: 22,
      username: "root",
      authType: "key",
    },
  ],
};

describe("useSshConnectionsLazy", () => {
  beforeEach(() => {
    _resetSshConnectionsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => SAMPLE,
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches once on first mount and exposes connections", async () => {
    const { result } = renderHook(() => useSshConnectionsLazy());
    await waitFor(() => {
      expect(result.current.connections).not.toBeNull();
    });
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections?.[0].name).toBe("Prod");
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when a second instance mounts during cache hit", async () => {
    const { result: a } = renderHook(() => useSshConnectionsLazy());
    await waitFor(() => expect(a.current.connections).not.toBeNull());

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const beforeSecondMount = fetchMock.mock.calls.length;

    const { result: b } = renderHook(() => useSshConnectionsLazy());
    // Cache hit — synchronous data, no extra fetch.
    expect(b.current.connections).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(beforeSecondMount);
  });

  it("invalidate clears the cache and a subsequent mount refetches", async () => {
    const { result } = renderHook(() => useSshConnectionsLazy());
    await waitFor(() => expect(result.current.connections).not.toBeNull());

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      invalidateSshConnections();
    });

    // After invalidate, the existing hook instance sees `connections === null`.
    expect(result.current.connections).toBeNull();

    // Mount a fresh hook — first-mount path fires the fetch again.
    const { result: r2 } = renderHook(() => useSshConnectionsLazy());
    await waitFor(() => expect(r2.current.connections).not.toBeNull());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("captures the error string when fetch fails", async () => {
    _resetSshConnectionsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      })) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useSshConnectionsLazy());
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.connections).toEqual([]);
    expect(result.current.error).toMatch(/HTTP 500/);
  });
});
