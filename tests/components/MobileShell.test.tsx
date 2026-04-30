import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { MobileShell } from "@/components/mobile/MobileShell";
import { MOBILE_BREAKPOINT_PX } from "@/hooks/useMobile";

function installMatchMedia(viewportWidth: number, reducedMotion = false) {
  // window.innerWidth used by useIsMobileViewport on first render.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: viewportWidth,
  });

  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const mobileQuery = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;
    const motionQuery = "(prefers-reduced-motion: reduce)";
    let matches = false;
    if (query === mobileQuery) matches = viewportWidth < MOBILE_BREAKPOINT_PX;
    else if (query === motionQuery) matches = reducedMotion;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

describe("MobileShell", () => {
  beforeEach(() => {
    installMatchMedia(1280);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns children unchanged at desktop widths (>=768px)", () => {
    installMatchMedia(1280);
    render(
      <MobileShell activeTab="sessions" onTabChange={() => {}}>
        <main data-testid="desk">Desktop content</main>
      </MobileShell>
    );
    expect(screen.getByTestId("desk")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mobile-bottom-tab-bar")).not.toBeInTheDocument();
  });

  it("renders the shell + tab bar below 768px", () => {
    installMatchMedia(420);
    render(
      <MobileShell activeTab="notifications" onTabChange={() => {}}>
        <section data-testid="phone">Phone content</section>
      </MobileShell>
    );
    expect(screen.getByTestId("mobile-shell")).toBeInTheDocument();
    expect(screen.getByTestId("phone")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-bottom-tab-bar")).toBeInTheDocument();
  });

  it("forwards activeTab and onTabChange to the bar", () => {
    installMatchMedia(420);
    render(
      <MobileShell activeTab="channels" onTabChange={() => {}}>
        <div />
      </MobileShell>
    );
    const channels = screen.getByRole("tab", { name: "Channels" });
    expect(channels).toHaveAttribute("aria-selected", "true");
  });
});
