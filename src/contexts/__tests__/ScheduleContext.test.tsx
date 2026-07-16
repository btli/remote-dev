/**
 * ScheduleContext client-freshness tests.
 *
 * Covers the polling / anti-clobber logic added for long-lived tabs:
 *  - `refreshSchedules` drops a response that resolves after a newer client
 *    mutation (LOAD_STALE) instead of clobbering the optimistic state, and
 *    applies the payload normally when no mutation raced it.
 *  - A `visibilitychange` to visible triggers a refetch; hidden does not.
 *  - The 60s poll refetches only while the document is visible, and both the
 *    interval and the visibility listener are removed on unmount.
 *  - `toggleEnabled` applies the server row from the PATCH response (e.g. a
 *    re-enabled 'cancelled' schedule renders 'active' immediately).
 *
 * Mirrors PortContext.test.tsx: the real provider is exercised while
 * `@/lib/api-fetch` and `@/contexts/SessionContext` are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { SessionScheduleWithSession } from "@/types/schedule";

const apiFetchMock = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  prefixApiPath: (input: string) => input,
}));

// ScheduleContext only reads `activeSessionId`; the `schedules` it exposes
// are scoped to that session, so fixtures below all use "sess-1".
vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({ activeSessionId: "sess-1" }),
}));

// Imported after the mocks above are registered.
import { ScheduleProvider, useScheduleContext } from "@/contexts/ScheduleContext";

const ACTIVE_SESSION = {
  id: "sess-1",
  name: "web",
  status: "active",
  tmuxSessionName: "rdv-sess-1",
};

function makeSchedule(
  overrides: Partial<SessionScheduleWithSession> = {}
): SessionScheduleWithSession {
  return {
    id: "sched-1",
    userId: "user-1",
    sessionId: "sess-1",
    name: "Nightly build",
    scheduleType: "recurring",
    cronExpression: "0 0 * * *",
    scheduledAt: null,
    timezone: "UTC",
    enabled: true,
    status: "active",
    maxRetries: 3,
    retryDelaySeconds: 30,
    timeoutSeconds: 300,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
    consecutiveFailures: 0,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    session: ACTIVE_SESSION,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function scheduleListFetch(schedules: SessionScheduleWithSession[]) {
  return () => Promise.resolve(jsonResponse({ schedules }));
}

function wrapper({ children }: { children: ReactNode }) {
  return <ScheduleProvider>{children}</ScheduleProvider>;
}

/** Every apiFetch call in these tests hits /api/schedules*, so the raw call
 * count doubles as the refetch counter (mutation calls are counted where a
 * test makes them, and asserted explicitly). */
function fetchCallCount(): number {
  return apiFetchMock.mock.calls.length;
}

// Controllable document visibility. happy-dom exposes `visibilityState` on
// the Document prototype; shadow it with a configurable own property so
// tests can simulate tab hide/show, and remove the shadow after each test.
let visibilityState: DocumentVisibilityState = "visible";

function setVisibility(state: DocumentVisibilityState) {
  visibilityState = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("ScheduleContext (client freshness)", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(scheduleListFetch([]));
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("applies a refetch payload when no mutation raced it", async () => {
    const first = makeSchedule({ id: "sched-a", name: "A" });
    apiFetchMock.mockImplementation(scheduleListFetch([first]));

    const { result } = renderHook(() => useScheduleContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.schedules).toHaveLength(1);
    });

    const second = makeSchedule({ id: "sched-b", name: "B" });
    apiFetchMock.mockImplementation(scheduleListFetch([first, second]));

    await act(async () => {
      await result.current.refreshSchedules();
    });

    expect(result.current.schedules.map((s) => s.id)).toEqual([
      "sched-a",
      "sched-b",
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("drops a stale refetch that resolves after a client mutation", async () => {
    const keep = makeSchedule({ id: "sched-keep", name: "Keep" });
    const doomed = makeSchedule({ id: "sched-doomed", name: "Doomed" });
    apiFetchMock.mockImplementation(scheduleListFetch([keep, doomed]));

    const { result } = renderHook(() => useScheduleContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.schedules).toHaveLength(2);
    });

    // Arm a deferred GET so the next refetch stays in flight until resolved.
    let resolveStaleFetch!: (response: Response) => void;
    const staleFetch = new Promise<Response>((resolve) => {
      resolveStaleFetch = resolve;
    });
    apiFetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ success: true }));
      }
      return staleFetch;
    });

    // Start a background refetch; it snapshots the mutation counter now.
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshSchedules();
    });
    expect(result.current.loading).toBe(true);

    // A mutation lands while the fetch is in flight.
    await act(async () => {
      await result.current.deleteSchedule("sched-doomed");
    });
    expect(result.current.schedules.map((s) => s.id)).toEqual(["sched-keep"]);

    // The stale response resolves with pre-mutation data (still containing
    // the deleted row) — it must be dropped, not applied.
    await act(async () => {
      resolveStaleFetch(jsonResponse({ schedules: [keep, doomed] }));
      await refreshPromise;
    });

    expect(result.current.schedules.map((s) => s.id)).toEqual(["sched-keep"]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("toggleEnabled applies the server row from the PATCH response", async () => {
    const cancelled = makeSchedule({
      id: "sched-cancelled",
      enabled: false,
      status: "cancelled",
    });
    apiFetchMock.mockImplementation(scheduleListFetch([cancelled]));

    const { result } = renderHook(() => useScheduleContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.schedules).toHaveLength(1);
    });
    expect(result.current.schedules[0].status).toBe("cancelled");

    // Server-side, re-enabling resets the terminal status to 'active'.
    // Return the row as the API would serialize it (ISO date strings).
    apiFetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            ...cancelled,
            enabled: true,
            status: "active",
            nextRunAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-16T12:00:00.000Z",
          })
        );
      }
      return scheduleListFetch([cancelled])();
    });

    await act(async () => {
      await result.current.toggleEnabled("sched-cancelled", true);
    });

    const toggled = result.current.schedules[0];
    expect(toggled.enabled).toBe(true);
    expect(toggled.status).toBe("active");
    expect(toggled.nextRunAt).toEqual(new Date("2026-07-17T00:00:00.000Z"));

    // The update came straight from the PATCH response — no extra refetch
    // (1 mount GET + 1 PATCH).
    expect(fetchCallCount()).toBe(2);
  });

  it("refetches when the tab becomes visible, but not when hidden", async () => {
    const { result } = renderHook(() => useScheduleContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetchCallCount()).toBe(1);

    setVisibility("hidden");
    expect(fetchCallCount()).toBe(1);

    setVisibility("visible");
    expect(fetchCallCount()).toBe(2);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("polls every 60s while visible, not while hidden, and stops on unmount", async () => {
    vi.useFakeTimers();

    const { result, unmount } = renderHook(() => useScheduleContext(), {
      wrapper,
    });

    // Flush the mount refetch (microtasks only; no timers due yet).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
    expect(fetchCallCount()).toBe(1);

    // One poll interval while visible → one refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchCallCount()).toBe(2);

    // Hidden tab: the interval fires but must not fetch.
    visibilityState = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchCallCount()).toBe(2);

    // Cleanup: after unmount neither the interval nor the visibility
    // listener may fetch again, even while visible.
    visibilityState = "visible";
    unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(fetchCallCount()).toBe(2);
  });
});
