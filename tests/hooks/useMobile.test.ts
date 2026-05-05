import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useIsMobileViewport, MOBILE_BREAKPOINT_PX } from "@/hooks/useMobile";

interface MqlListeners {
  change: Set<(e: { matches: boolean }) => void>;
}

function installMatchMedia(viewportWidth: number): {
  setMatches: (matches: boolean) => void;
} {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: viewportWidth,
  });

  const listeners: MqlListeners = { change: new Set() };
  let currentMatches = viewportWidth < MOBILE_BREAKPOINT_PX;

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return currentMatches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn((cb: (e: { matches: boolean }) => void) =>
      listeners.change.add(cb)
    ),
    removeListener: vi.fn((cb: (e: { matches: boolean }) => void) =>
      listeners.change.delete(cb)
    ),
    addEventListener: vi.fn((evt: string, cb: (e: { matches: boolean }) => void) => {
      if (evt === "change") listeners.change.add(cb);
    }),
    removeEventListener: vi.fn((evt: string, cb: (e: { matches: boolean }) => void) => {
      if (evt === "change") listeners.change.delete(cb);
    }),
    dispatchEvent: vi.fn(),
  }));

  return {
    setMatches(matches: boolean) {
      currentMatches = matches;
      for (const cb of listeners.change) cb({ matches });
    },
  };
}

describe("useIsMobileViewport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the live viewport match on initial render at mobile widths", () => {
    // The hook is implemented via useSyncExternalStore, so the first CLIENT
    // render returns the real matchMedia result immediately. SSR safety is
    // provided by the separate getServerSnapshot path (always false) — React
    // 19 treats the controlled server/client mismatch as expected and does
    // NOT emit a hydration warning. See useMobile.ts for details.
    installMatchMedia(420);

    let firstRenderValue: boolean | null = null;
    const { result } = renderHook(() => {
      const v = useIsMobileViewport();
      if (firstRenderValue === null) firstRenderValue = v;
      return v;
    });

    expect(firstRenderValue).toBe(true);
    expect(result.current).toBe(true);
  });

  it("returns false on initial render at desktop widths and stays false", () => {
    installMatchMedia(1280);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);
  });

  it("updates when the matchMedia query flips after mount", () => {
    const handle = installMatchMedia(1280);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);

    act(() => {
      handle.setMatches(true);
    });
    expect(result.current).toBe(true);
  });
});
