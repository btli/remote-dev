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

  it("returns false on initial render even when window.innerWidth is mobile-sized", () => {
    // SSR/CSR parity: lazy initializers MUST NOT inspect window during the
    // first render or React 19 throws a hydration mismatch the first time a
    // real mobile user visits.
    installMatchMedia(420);

    // Capture state during the FIRST render before effects flush.
    let firstRenderValue: boolean | null = null;
    const { result } = renderHook(() => {
      const v = useIsMobileViewport();
      if (firstRenderValue === null) firstRenderValue = v;
      return v;
    });

    expect(firstRenderValue).toBe(false);
    // After effects flush we should have the real value.
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
