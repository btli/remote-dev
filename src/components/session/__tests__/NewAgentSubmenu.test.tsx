// @vitest-environment happy-dom
/**
 * Tests for the lazy agent-CLI status cache that backs the "Pick Agent"
 * submenu in the sidebar `+` menu and the project context menu. Mirrors
 * NewSshSubmenu.test.tsx — verifies cache freshness semantics and the fact
 * that every provider is projected into the result (even if missing from
 * the response).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useAgentCLIStatusLazy,
  invalidateAgentCLIStatus,
  _resetAgentCLIStatusCache,
} from "../NewAgentSubmenu";

const SAMPLE_RESPONSE = {
  statuses: [
    { provider: "claude", installed: true, version: "1.2.3", command: "claude" },
    { provider: "codex", installed: false, command: "codex" },
  ],
};

describe("useAgentCLIStatusLazy", () => {
  beforeEach(() => {
    _resetAgentCLIStatusCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => SAMPLE_RESPONSE,
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches once on first mount and projects all five providers", async () => {
    const { result } = renderHook(() => useAgentCLIStatusLazy());
    await waitFor(() => {
      expect(result.current.statuses).not.toBeNull();
    });
    // Always returns rows for all five providers, even those missing from
    // the API response (those default to installed=false).
    expect(result.current.statuses).toHaveLength(5);
    const claude = result.current.statuses!.find((s) => s.provider === "claude");
    expect(claude?.installed).toBe(true);
    expect(claude?.version).toBe("1.2.3");
    const gemini = result.current.statuses!.find((s) => s.provider === "gemini");
    expect(gemini?.installed).toBe(false);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when a second instance mounts during cache hit", async () => {
    const { result: a } = renderHook(() => useAgentCLIStatusLazy());
    await waitFor(() => expect(a.current.statuses).not.toBeNull());

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const beforeSecondMount = fetchMock.mock.calls.length;

    const { result: b } = renderHook(() => useAgentCLIStatusLazy());
    expect(b.current.statuses).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(beforeSecondMount);
  });

  it("invalidate clears the cache and a subsequent mount refetches", async () => {
    const { result } = renderHook(() => useAgentCLIStatusLazy());
    await waitFor(() => expect(result.current.statuses).not.toBeNull());

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      invalidateAgentCLIStatus();
    });

    expect(result.current.statuses).toBeNull();

    const { result: r2 } = renderHook(() => useAgentCLIStatusLazy());
    await waitFor(() => expect(r2.current.statuses).not.toBeNull());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("falls back to all-uninstalled rows when fetch fails", async () => {
    _resetAgentCLIStatusCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      })) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useAgentCLIStatusLazy());
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.statuses).toHaveLength(5);
    expect(result.current.statuses?.every((s) => !s.installed)).toBe(true);
    expect(result.current.error).toMatch(/HTTP 500/);
  });
});
