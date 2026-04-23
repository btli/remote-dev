/**
 * F6 — PR body fetch contract.
 *
 * The PRs detail view previously paged the `/issues?per_page=100` list to
 * hydrate PR bodies, which silently dropped bodies past position 100 on
 * busy repos (issues/PRs above that index never had their body loaded).
 * The fix targets the single-issue endpoint directly.
 *
 * These tests lock in:
 *   1. The hook hits the per-number endpoint (NOT the list endpoint).
 *   2. A 404 is handled gracefully — the consumer renders "No description
 *      provided" because `body` resolves to `null` (not `undefined`, which
 *      would keep the loading spinner up).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePRBody } from "./use-pr-body";

describe("usePRBody (F6)", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the single-issue endpoint with the PR number (NOT the paged list)", async () => {
    // Use an issue number well beyond the old per_page=100 ceiling to make
    // the intent visible: this is the exact scenario the F6 fix targets.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issue: { number: 1234, body: "Hello" } }),
    });

    const { result } = renderHook(() => usePRBody("repo-abc", 1234));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    // Targeted single-issue endpoint
    expect(calledUrl).toBe("/api/github/repositories/repo-abc/issues/1234");
    // NOT the paged list endpoint
    expect(calledUrl).not.toContain("per_page");
    expect(calledUrl).not.toMatch(/\/issues(\?|$)/);

    expect(result.current.body).toBe("Hello");
  });

  it("renders 'No description provided' gracefully on 404 (body resolves to null)", async () => {
    // Suppress the expected console.error from the hook's catch branch.
    vi.spyOn(console, "error").mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    const { result } = renderHook(() => usePRBody("repo-abc", 9999));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // `body === null` drives the "No description provided." branch in the
    // detail view. Anything else (undefined, "") would leave the spinner up
    // or render stale content from a previous PR.
    expect(result.current.body).toBeNull();
  });

  it("treats a missing `body` field as 'no description'", async () => {
    // Some PRs legitimately have no body — the API returns issue.body as
    // null or omits it. Ensure the UI falls through to the same "no
    // description" branch as a 404.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issue: { number: 42 } }),
    });

    const { result } = renderHook(() => usePRBody("repo-abc", 42));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.body).toBeNull();
  });

  it("re-fetches when prNumber changes and reports loading during the transition", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issue: { number: 1, body: "first" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issue: { number: 2, body: "second" } }),
      });

    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => usePRBody("repo-abc", n),
      { initialProps: { n: 1 } }
    );

    await waitFor(() => expect(result.current.body).toBe("first"));

    rerender({ n: 2 });
    // Immediately after rerender the hook should report loading while the
    // new request resolves — body should not leak the previous PR's text.
    expect(result.current.loading).toBe(true);
    expect(result.current.body).toBeNull();

    await waitFor(() => expect(result.current.body).toBe("second"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/github/repositories/repo-abc/issues/2"
    );
  });
});
