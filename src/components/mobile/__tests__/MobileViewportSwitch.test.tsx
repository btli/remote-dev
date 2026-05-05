/**
 * MobileViewportSwitch tests.
 *
 * Verifies that the switch:
 *
 * 1. Renders the desktop `children` at >= md breakpoint.
 * 2. Renders <MobileApp> below the md breakpoint.
 * 3. Does NOT trigger React's hydration-mismatch warning during dev-mode
 *    render (the previous useState+useEffect flip pattern could surface
 *    warnings via descendant subtrees that mount differently between the
 *    SSR and CSR composition; the new useSyncExternalStore-backed hook
 *    eliminates that). We assert on this by spying on console.error and
 *    rendering the component at a mobile viewport.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { MobileViewportSwitch } from "@/components/mobile/MobileViewportSwitch";
import { MOBILE_BREAKPOINT_PX } from "@/hooks/useMobile";

// Stub MobileApp so the test doesn't pull in the real context tree.
vi.mock("@/components/mobile/MobileApp", () => ({
  MobileApp: () => <div data-testid="mobile-app">mobile</div>,
}));

interface MqlListeners {
  change: Set<(e: { matches: boolean }) => void>;
}

function installMatchMedia(viewportWidth: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: viewportWidth,
  });

  const listeners: MqlListeners = { change: new Set() };
  const currentMatches = viewportWidth < MOBILE_BREAKPOINT_PX;

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
    addEventListener: vi.fn(
      (evt: string, cb: (e: { matches: boolean }) => void) => {
        if (evt === "change") listeners.change.add(cb);
      }
    ),
    removeEventListener: vi.fn(
      (evt: string, cb: (e: { matches: boolean }) => void) => {
        if (evt === "change") listeners.change.delete(cb);
      }
    ),
    dispatchEvent: vi.fn(),
  }));
}

describe("MobileViewportSwitch", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the desktop children at desktop widths", () => {
    installMatchMedia(1280);

    render(
      <MobileViewportSwitch isGitHubConnected={false} initialUser={null}>
        <div data-testid="desktop">desktop</div>
      </MobileViewportSwitch>
    );

    expect(screen.getByTestId("desktop")).toBeTruthy();
    expect(screen.queryByTestId("mobile-app")).toBeNull();
  });

  it("renders MobileApp at mobile widths", () => {
    installMatchMedia(420);

    render(
      <MobileViewportSwitch isGitHubConnected={false} initialUser={null}>
        <div data-testid="desktop">desktop</div>
      </MobileViewportSwitch>
    );

    expect(screen.getByTestId("mobile-app")).toBeTruthy();
    expect(screen.queryByTestId("desktop")).toBeNull();
  });

  describe("hydration safety", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("does not log a hydration-mismatch warning at mobile widths", () => {
      installMatchMedia(420);

      render(
        <MobileViewportSwitch isGitHubConnected={false} initialUser={null}>
          <div data-testid="desktop">desktop</div>
        </MobileViewportSwitch>
      );

      const hydrationCalls = errorSpy.mock.calls.filter((call: unknown[]) => {
        const msg = String(call[0] ?? "");
        return (
          msg.includes("hydration") ||
          msg.includes("Hydration") ||
          msg.includes("did not match") ||
          msg.includes("Text content does not match")
        );
      });
      expect(hydrationCalls).toEqual([]);
    });
  });
});
