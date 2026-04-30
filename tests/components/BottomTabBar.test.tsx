import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { BottomTabBar } from "@/components/mobile/BottomTabBar";

// matchMedia shim. happy-dom doesn't ship a usable implementation; tests
// override `prefers-reduced-motion` per case.
function installMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("BottomTabBar", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all four tabs with labels", () => {
    render(
      <BottomTabBar activeTab="sessions" onTabChange={() => {}} />
    );
    expect(screen.getByRole("tab", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Channels" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profile" })).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected and 500-weight styling", () => {
    render(
      <BottomTabBar activeTab="notifications" onTabChange={() => {}} />
    );
    const active = screen.getByRole("tab", { name: "Notifications" });
    const inactive = screen.getByRole("tab", { name: "Sessions" });

    expect(active).toHaveAttribute("aria-selected", "true");
    expect(inactive).toHaveAttribute("aria-selected", "false");

    // Active tab uses font-medium (500); inactive uses font-normal (400).
    // We assert via class presence, since happy-dom does not resolve weights.
    expect(active.className).toContain("font-medium");
    expect(active.className).toContain("text-foreground");
    expect(inactive.className).toContain("font-normal");
    expect(inactive.className).toContain("text-muted-foreground");
  });

  it("never colors the active tab with an accent (achromatic-default)", () => {
    render(<BottomTabBar activeTab="sessions" onTabChange={() => {}} />);
    const active = screen.getByRole("tab", { name: "Sessions" });
    // Hierarchy is by weight + foreground; reject any primary/destructive tint.
    expect(active.className).not.toMatch(/bg-primary|text-primary|text-destructive|bg-destructive/);
  });

  it("calls onTabChange when a tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<BottomTabBar activeTab="sessions" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Channels" }));
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("channels");
  });

  it("each tab meets the 44pt minimum touch target", () => {
    render(<BottomTabBar activeTab="sessions" onTabChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      expect(tab.className).toContain("min-h-[44px]");
      expect(tab.className).toContain("min-w-[44px]");
    }
  });

  it("hides on scroll-down past 80px and reshows on scroll-up", () => {
    // Simulate a scrollable element passed in via scrollContainer.
    const div = document.createElement("div");
    Object.defineProperty(div, "scrollTop", {
      configurable: true,
      get: () => (div as unknown as { _scrollTop: number })._scrollTop ?? 0,
      set(v: number) {
        (div as unknown as { _scrollTop: number })._scrollTop = v;
      },
    });

    const { rerender } = render(
      <BottomTabBar
        activeTab="sessions"
        onTabChange={() => {}}
        scrollContainer={div}
      />
    );
    rerender(
      <BottomTabBar
        activeTab="sessions"
        onTabChange={() => {}}
        scrollContainer={div}
      />
    );

    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.getAttribute("data-state")).toBe("visible");

    // Scroll down past the threshold.
    act(() => {
      div.scrollTop = 200;
      div.dispatchEvent(new Event("scroll"));
    });
    expect(bar.getAttribute("data-state")).toBe("hidden");

    // Scroll up.
    act(() => {
      div.scrollTop = 120;
      div.dispatchEvent(new Event("scroll"));
    });
    expect(bar.getAttribute("data-state")).toBe("visible");
  });

  it("uses an instant transition when prefers-reduced-motion is set", () => {
    installMatchMedia(true);
    render(<BottomTabBar activeTab="sessions" onTabChange={() => {}} />);
    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.style.transitionDuration).toBe("0ms");
  });

  it("uses ease-out-quart at 240ms when motion is allowed", () => {
    installMatchMedia(false);
    render(<BottomTabBar activeTab="sessions" onTabChange={() => {}} />);
    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.style.transitionDuration).toBe("240ms");
    expect(bar.style.transitionTimingFunction.replace(/\s+/g, "")).toBe(
      "cubic-bezier(0.32,0.72,0,1)"
    );
  });

  it("respects forceHidden as a hard override", () => {
    render(
      <BottomTabBar
        activeTab="sessions"
        onTabChange={() => {}}
        forceHidden
      />
    );
    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.getAttribute("data-state")).toBe("hidden");
    expect(bar.className).toContain("translate-y-full");
  });
});
